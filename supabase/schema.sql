-- ==========================================
-- Ad Hub: คลังสินค้า affiliate กลาง ใช้ร่วมกันได้หลายเว็บ
-- วิธีใช้: Supabase > SQL Editor > วางไฟล์นี้ทั้งไฟล์แล้วกด Run (รันซ้ำได้ ไม่ทำให้ข้อมูลหาย)
--
-- ใครอ่าน/เขียนอะไรได้
--   คนทั่วไป (คีย์ publishable/anon ในหน้าเว็บ): อ่านหมวด และสินค้าที่ "กำลังแสดง" ในช่วงวันที่ตั้งไว้เท่านั้น
--   แอดมิน (ผู้ใช้ที่ล็อกอินและอยู่ในตาราง hub_admins): อ่าน/เขียนทุกอย่าง
-- ตารางขึ้นต้นด้วย hub_ ทั้งหมด จึงอยู่ร่วมกับตารางของเว็บอื่นในโปรเจกต์ Supabase เดียวกันได้
-- ==========================================
create extension if not exists pg_trgm;

create table if not exists public.hub_admins (
  user_id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.hub_categories (
  id bigserial primary key,
  name text not null check (length(trim(name)) between 1 and 60),
  parent_id bigint references public.hub_categories (id) on delete set null,
  sort integer not null default 0,
  -- คำที่ใช้เดาหมวดตอนนำเข้า เทียบกับชื่อสินค้าและคำค้นที่ใช้ดึง
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.hub_products (
  id bigserial primary key,
  -- แหล่งที่มา เช่น "shopee", "lazada" ได้จากชื่อเว็บของลิงก์ ไม่ได้ล็อกไว้กับเว็บใดเว็บหนึ่ง
  source text not null default '',
  -- รหัสสินค้าที่เว็บต้นทาง ใช้กันซ้ำ (ว่างได้ ถ้าว่างจะกันซ้ำด้วยลิงก์แทน)
  source_id text not null default '',
  title text not null check (length(trim(title)) between 1 and 300),
  price numeric(12, 2),
  price_text text not null default '',
  commission numeric(5, 2),
  sold_text text not null default '',
  shop text not null default '',
  link text not null check (link ~* '^https?://'),
  image_url text not null default '',
  category_id bigint references public.hub_categories (id) on delete set null,
  tags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'expired')),
  weight integer not null default 1 check (weight between 1 and 10),
  starts_on date,
  ends_on date,
  note text not null default '',
  search_keyword text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- รูปทั้งหมดและรายละเอียดจากหน้าสินค้า ใช้เป็นข้อมูลทำรีวิว (เพิ่มทีหลัง จึงใช้ add column ให้อัปเกรดจากรุ่นก่อนได้)
alter table public.hub_products add column if not exists images text[] not null default '{}';
alter table public.hub_products add column if not exists description text not null default '';
-- ข้อมูลอื่นจากหน้าสินค้า เช่น {brand, rating, rating_count, specs: {ชื่อ: ค่า}, detail_url, detail_at}
alter table public.hub_products add column if not exists details jsonb not null default '{}';
-- คำโปรยสั้นๆ บนการ์ดโฆษณา เช่น "ราคา ฿350 ส่งฟรี" (เว็บที่แสดงเลือกเองว่าจะโชว์ตรงไหน)
alter table public.hub_products add column if not exists caption text not null default '';
-- รีวิวที่เขียนแล้ว (AI ร่าง หรือสุ่มแบบป้ายยา แล้วแก้ในแผงแก้ไข) แสดงในกล่องรีวิวของ ads.js
alter table public.hub_products add column if not exists review text not null default '';

create unique index if not exists hub_products_source_key on public.hub_products (source, source_id) where source_id <> '';
create unique index if not exists hub_products_link_key on public.hub_products (link) where source_id = '';
create index if not exists hub_products_status_idx on public.hub_products (status, updated_at desc);
create index if not exists hub_products_category_idx on public.hub_products (category_id);
-- ค้นหาภาษาไทยแบบมีคำนี้อยู่ตรงไหนก็ได้ (ilike '%คำ%') ให้เร็วด้วย trigram
create index if not exists hub_products_title_trgm on public.hub_products using gin (title gin_trgm_ops);
create index if not exists hub_products_shop_trgm on public.hub_products using gin (shop gin_trgm_ops);

create or replace function public.hub_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists hub_products_touch on public.hub_products;
create trigger hub_products_touch before update on public.hub_products
  for each row execute function public.hub_touch_updated_at();

-- ---------- สิทธิ์ ----------
create or replace function public.hub_is_admin() returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from hub_admins where user_id = auth.uid());
$$;
revoke all on function public.hub_is_admin() from public;
grant execute on function public.hub_is_admin() to anon, authenticated;

alter table public.hub_admins enable row level security;
alter table public.hub_categories enable row level security;
alter table public.hub_products enable row level security;

grant select on public.hub_categories, public.hub_products to anon, authenticated;
grant insert, update, delete on public.hub_categories, public.hub_products to authenticated;
grant usage on sequence public.hub_categories_id_seq, public.hub_products_id_seq to authenticated;
grant select on public.hub_admins to authenticated;

drop policy if exists "self read" on public.hub_admins;
create policy "self read" on public.hub_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists "public read" on public.hub_categories;
create policy "public read" on public.hub_categories for select to anon, authenticated using (true);
drop policy if exists "admin write" on public.hub_categories;
create policy "admin write" on public.hub_categories for all to authenticated
  using (public.hub_is_admin()) with check (public.hub_is_admin());

drop policy if exists "public read live" on public.hub_products;
create policy "public read live" on public.hub_products for select to anon, authenticated
  using (status = 'active'
         and (starts_on is null or starts_on <= (now() at time zone 'Asia/Bangkok')::date)
         and (ends_on is null or ends_on >= (now() at time zone 'Asia/Bangkok')::date));
drop policy if exists "admin read" on public.hub_products;
create policy "admin read" on public.hub_products for select to authenticated using (public.hub_is_admin());
drop policy if exists "admin write" on public.hub_products;
create policy "admin write" on public.hub_products for all to authenticated
  using (public.hub_is_admin()) with check (public.hub_is_admin());

-- ---------- นำเข้าสินค้าทีละหลายรายการ ----------
-- p_items: [{title, link, source, source_id, price, price_text, commission, sold_text, shop, image_url, category, search_keyword,
--            images: [url], description, details: {}, caption}]
-- มีอยู่แล้ว (แหล่ง + รหัสเดียวกัน หรือลิงก์เดียวกันเมื่อไม่มีรหัส): อัปเดตราคา ค่าคอม ยอดขาย ไม่แตะหมวด สถานะ และสิ่งที่แอดมินแก้ไว้
--   รูปทั้งหมด รายละเอียด และ details: ใช้ของใหม่เมื่อส่งมา (หน้าสินค้าเปลี่ยนได้) ส่งมาว่าง = คงของเดิม
--   รูปที่แอดมินลบไว้ (details.removed_images) ไม่ถูกเพิ่มกลับ
-- คืนค่า {added, updated, skipped, errors: [{row, error}]}
create or replace function public.hub_import_products(p_items jsonb, p_status text default 'pending')
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  item jsonb;
  idx integer := 0;
  v_title text; v_link text; v_source text; v_source_id text; v_cat bigint; v_existing bigint;
  v_haystack text;
  v_images text[]; v_desc text; v_details jsonb;
  added integer := 0; updated integer := 0; skipped integer := 0;
  errors jsonb := '[]'::jsonb;
begin
  if not public.hub_is_admin() then
    raise exception 'ต้องเป็นแอดมินของ Ad Hub' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'active', 'paused') then
    p_status := 'pending';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items ต้องเป็น array';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    v_title := left(regexp_replace(trim(coalesce(item ->> 'title', '')), '\s+', ' ', 'g'), 300);
    v_link := trim(coalesce(item ->> 'link', ''));
    if v_title = '' or v_link !~* '^https?://' then
      skipped := skipped + 1;
      errors := errors || jsonb_build_object('row', idx, 'error', 'ไม่มีชื่อสินค้าหรือลิงก์');
      continue;
    end if;
    v_source := lower(left(trim(coalesce(item ->> 'source', '')), 40));
    v_source_id := left(trim(coalesce(item ->> 'source_id', '')), 80);
    -- รูป: เฉพาะ http(s) ไม่ซ้ำ ตามลำดับเดิม ไม่เกิน 30 รูป
    v_images := '{}';
    if jsonb_typeof(item -> 'images') = 'array' then
      select coalesce(array_agg(u order by o), '{}') into v_images from (
        select u, min(o) as o from jsonb_array_elements_text(item -> 'images') with ordinality as t(u, o)
        where u ~* '^https?://' group by u order by min(o) limit 30
      ) s;
    end if;
    v_desc := left(trim(coalesce(item ->> 'description', '')), 20000);
    v_details := case when jsonb_typeof(item -> 'details') = 'object' then item -> 'details' else '{}'::jsonb end;

    if v_source_id <> '' then
      select id into v_existing from hub_products where source = v_source and source_id = v_source_id;
    else
      select id into v_existing from hub_products where link = v_link and source_id = '';
    end if;

    begin
      if v_existing is not null then
        update hub_products set
          price = coalesce(nullif(item ->> 'price', '')::numeric, price),
          price_text = coalesce(nullif(item ->> 'price_text', ''), price_text),
          commission = coalesce(nullif(item ->> 'commission', '')::numeric, commission),
          sold_text = coalesce(nullif(item ->> 'sold_text', ''), sold_text),
          shop = case when shop = '' then coalesce(item ->> 'shop', '') else shop end,
          image_url = case when image_url <> '' then image_url
                           else coalesce(nullif(item ->> 'image_url', ''), v_images[1], '') end,
          images = case when cardinality(v_images) > 0 then array(
                     select u from unnest(v_images) with ordinality as t(u, o)
                     where not coalesce(details -> 'removed_images', '[]'::jsonb) ? u order by o)
                   else images end,
          description = case when v_desc <> '' then v_desc else description end,
          details = details || v_details,
          caption = case when caption = '' then left(trim(coalesce(item ->> 'caption', '')), 300) else caption end,
          link = v_link,
          last_seen_at = now()
        where id = v_existing;
        updated := updated + 1;
      else
        -- หมวด: ชื่อหมวดที่ส่งมาตรงๆ ก่อน ไม่มีก็เดาจากคำของหมวดที่อยู่ในชื่อสินค้าหรือคำค้น
        v_cat := null;
        if coalesce(item ->> 'category', '') <> '' then
          select id into v_cat from hub_categories where lower(name) = lower(trim(item ->> 'category')) limit 1;
        end if;
        if v_cat is null then
          v_haystack := lower(v_title || ' ' || coalesce(item ->> 'search_keyword', ''));
          select c.id into v_cat from hub_categories c, unnest(c.keywords) k
          where k <> '' and position(lower(k) in v_haystack) > 0
          order by length(k) desc, c.sort limit 1;
        end if;
        insert into hub_products (source, source_id, title, price, price_text, commission, sold_text, shop,
                                  link, image_url, category_id, status, search_keyword, images, description, details, caption)
        values (v_source, v_source_id, v_title,
                nullif(item ->> 'price', '')::numeric, coalesce(item ->> 'price_text', ''),
                nullif(item ->> 'commission', '')::numeric, coalesce(item ->> 'sold_text', ''),
                left(coalesce(item ->> 'shop', ''), 80), v_link,
                coalesce(nullif(item ->> 'image_url', ''), v_images[1], ''),
                v_cat, p_status, left(coalesce(item ->> 'search_keyword', ''), 120), v_images, v_desc, v_details,
                left(trim(coalesce(item ->> 'caption', '')), 300));
        added := added + 1;
      end if;
    exception when others then
      skipped := skipped + 1;
      errors := errors || jsonb_build_object('row', idx, 'error', sqlerrm);
    end;
    v_existing := null;
  end loop;

  return jsonb_build_object('added', added, 'updated', updated, 'skipped', skipped, 'errors', errors);
end;
$$;
revoke all on function public.hub_import_products(jsonb, text) from public, anon;
grant execute on function public.hub_import_products(jsonb, text) to authenticated;

-- จำนวนสินค้าต่อหมวดและต่อสถานะ สำหรับแถบด้านข้างของหน้าจัดการ (เห็นตามสิทธิ์ของคนเรียก)
create or replace function public.hub_counts()
returns table (category_id bigint, status text, total bigint)
language sql stable
set search_path = public
as $$
  select category_id, status, count(*) from hub_products group by category_id, status;
$$;
grant execute on function public.hub_counts() to anon, authenticated;

-- ---------- รูปสินค้า ----------
-- bucket สาธารณะ hub-images: ใครก็เปิดรูปได้ แต่อัปโหลด/ลบได้เฉพาะแอดมิน
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('hub-images', 'hub-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
    on conflict (id) do update set public = true;

    execute 'drop policy if exists "hub images admin insert" on storage.objects';
    execute 'create policy "hub images admin insert" on storage.objects for insert to authenticated
             with check (bucket_id = ''hub-images'' and public.hub_is_admin())';
    execute 'drop policy if exists "hub images admin update" on storage.objects';
    execute 'create policy "hub images admin update" on storage.objects for update to authenticated
             using (bucket_id = ''hub-images'' and public.hub_is_admin())';
    execute 'drop policy if exists "hub images admin delete" on storage.objects';
    execute 'create policy "hub images admin delete" on storage.objects for delete to authenticated
             using (bucket_id = ''hub-images'' and public.hub_is_admin())';
  end if;
end;
$$;

-- หมวดเริ่มต้น (เพิ่มเฉพาะตอนยังไม่มีหมวดเลย แก้ชื่อหรือคำได้ในหน้าจัดการ)
insert into public.hub_categories (name, sort, keywords)
select v.name, v.sort, v.keywords
from (values
  ('แฟชั่นผู้หญิง', 10, array['เสื้อ', 'กางเกง', 'กระโปรง', 'เดรส', 'ชุด']),
  ('แฟชั่นผู้ชาย', 20, array['เสื้อผู้ชาย', 'กางเกงผู้ชาย']),
  ('กระเป๋าและรองเท้า', 30, array['กระเป๋า', 'รองเท้า']),
  ('ความงาม', 40, array['ครีม', 'เซรั่ม', 'ลิป', 'แป้ง', 'สกินแคร์']),
  ('สุขภาพ', 50, array['วิตามิน', 'อาหารเสริม']),
  ('มือถือและแท็บเล็ต', 60, array['มือถือ', 'โทรศัพท์', 'แท็บเล็ต', 'เคส']),
  ('คอมพิวเตอร์', 70, array['monitor', 'จอ', 'คีย์บอร์ด', 'เมาส์', 'โน้ตบุ๊ค']),
  ('เครื่องใช้ไฟฟ้า', 80, array['พัดลม', 'หม้อ', 'เครื่องปั่น', 'เครื่องบด', 'ไฟฟ้า']),
  ('บ้านและสวน', 90, array['ชั้นวาง', 'ผ้าม่าน', 'ที่นอน', 'หมอน']),
  ('เครื่องเขียนและหนังสือ', 100, array['ปากกา', 'สมุด', 'หนังสือ']),
  ('แม่และเด็ก', 110, array['เด็ก', 'ผ้าอ้อม']),
  ('กีฬาและกิจกรรม', 120, array['กีฬา', 'ฟิตเนส', 'โยคะ'])
) as v(name, sort, keywords)
where not exists (select 1 from public.hub_categories);

-- ==========================================
-- เฟส 3: เว็บที่นำโฆษณาไปแสดง จุดที่วาง และการนับการแสดง/คลิก
--   เว็บเรียก ads.js?site=<คีย์เว็บ> → rpc hub_ads ได้สินค้าตามจุดที่วาง
--   การ์ดลิงก์ไปที่ /go/<รหัสสินค้า> (Edge Function supabase/functions/go) → rpc hub_go บันทึกคลิกแล้วส่งต่อ
-- ==========================================
create table if not exists public.hub_sites (
  id bigserial primary key,
  -- คีย์ที่ใส่ในโค้ดฝัง เช่น "transfer" (ตัวเล็ก ตัวเลข ขีด)
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  domain text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.hub_placements (
  id bigserial primary key,
  site_id bigint not null references public.hub_sites (id) on delete cascade,
  -- คีย์ของจุดที่วาง เช่น "feed" (แทรกในรายการ) "detail" (หน้ารายละเอียด)
  key text not null check (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  label text not null default '',
  -- จำนวนโฆษณาต่อหน้า
  slots integer not null default 4 check (slots between 1 and 24),
  -- ตำแหน่งในหน้า (แทรกหลังรายการที่ N) ส่งให้เว็บใช้เอง ว่างได้
  positions integer[] not null default '{}',
  -- หมวดที่ให้สุ่ม (รวมหมวดย่อย) ว่าง = ทุกหมวด
  category_ids bigint[] not null default '{}',
  -- สินค้าที่ปักหมุด ขึ้นก่อนเสมอตามลำดับนี้
  pinned_ids bigint[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (site_id, key)
);

-- การแสดง (view) และคลิก (click) ต่อสินค้า ไม่เก็บข้อมูลส่วนตัวของผู้ชม
create table if not exists public.hub_events (
  id bigserial primary key,
  event_at timestamptz not null default now(),
  event text not null check (event in ('view', 'click')),
  product_id bigint not null references public.hub_products (id) on delete cascade,
  site_id bigint references public.hub_sites (id) on delete set null,
  placement text not null default ''
);
create index if not exists hub_events_product_idx on public.hub_events (product_id, event, event_at desc);
create index if not exists hub_events_time_idx on public.hub_events (event_at desc);

alter table public.hub_sites enable row level security;
alter table public.hub_placements enable row level security;
alter table public.hub_events enable row level security;

-- คนทั่วไปไม่อ่านตารางพวกนี้ตรงๆ ใช้ผ่าน hub_ads / hub_go / hub_log_views เท่านั้น
revoke all on public.hub_sites, public.hub_placements, public.hub_events from anon;
grant select, insert, update, delete on public.hub_sites, public.hub_placements to authenticated;
grant select on public.hub_events to authenticated;
grant usage on sequence public.hub_sites_id_seq, public.hub_placements_id_seq to authenticated;

drop policy if exists "admin all" on public.hub_sites;
create policy "admin all" on public.hub_sites for all to authenticated
  using (public.hub_is_admin()) with check (public.hub_is_admin());
drop policy if exists "admin all" on public.hub_placements;
create policy "admin all" on public.hub_placements for all to authenticated
  using (public.hub_is_admin()) with check (public.hub_is_admin());
drop policy if exists "admin read" on public.hub_events;
create policy "admin read" on public.hub_events for select to authenticated using (public.hub_is_admin());

-- สินค้าที่ขึ้นเว็บได้ตอนนี้ (เงื่อนไขเดียวกับ policy "public read live")
create or replace function public.hub_is_live(p public.hub_products) returns boolean
language sql stable
as $$
  select p.status = 'active'
     and (p.starts_on is null or p.starts_on <= (now() at time zone 'Asia/Bangkok')::date)
     and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Bangkok')::date);
$$;

-- หมวดที่ตรงกับคำบอกบริบทของหน้า: ชื่อหมวดตรงกัน หรือคำของหมวดอยู่ในข้อความ (รวมหมวดย่อย)
create or replace function public.hub_context_categories(p_context text) returns bigint[]
language sql stable
set search_path = public
as $$
  with hit as (
    select c.id from hub_categories c
    where lower(c.name) = lower(trim(p_context))
       or exists (select 1 from unnest(c.keywords) k where k <> '' and position(lower(k) in lower(p_context)) > 0)
  )
  select coalesce(array_agg(distinct id), '{}') from (
    select id from hit
    union select c.id from hub_categories c join hit on c.parent_id = hit.id
  ) s;
$$;

-- โฆษณาสำหรับจุดที่วางหนึ่งจุด
--   สินค้าที่หน้าขอตามรหัส (p_products เช่นหน้ารีวิว) → ปักหมุด → สินค้าในหมวดตามบริบทของหน้า → สินค้าในหมวดของจุดที่วาง
--   สินค้าที่ขอตามรหัสแต่หยุดแสดงแล้ว: ได้ชิ้นอื่นในหมวดเดียวกันแทน
--   สุ่มแบบถ่วงน้ำหนัก: น้ำหนักที่ตั้งไว้ × ค่าคอม × คลิกใน 30 วัน ไม่ซ้ำกันและไม่ซ้ำกับ p_exclude (ที่หน้าแสดงไปแล้ว)
-- คืนค่า {placement: {key, slots, positions} | null, ads: [{id, title, caption, price, price_text, sold_text, shop, source, image_url}]}
-- รุ่นก่อนไม่มี p_products ต้องลบทิ้งก่อน ไม่งั้น PostgREST เลือกไม่ได้ว่าจะเรียกตัวไหน
drop function if exists public.hub_ads(text, text, text, integer, bigint[]);
create or replace function public.hub_ads(
  p_site text, p_placement text, p_context text default '', p_count integer default null, p_exclude bigint[] default '{}',
  p_products bigint[] default '{}'
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  pl hub_placements;
  n integer;
  ctx bigint[] := '{}';
  cats bigint[];
  ads jsonb;
begin
  select p.* into pl from hub_placements p join hub_sites s on s.id = p.site_id
  where s.key = lower(trim(p_site)) and p.key = lower(trim(p_placement)) and p.enabled;
  if pl.id is null then
    return jsonb_build_object('placement', null, 'ads', '[]'::jsonb);
  end if;
  n := least(greatest(coalesce(p_count, pl.slots), 1), 24);
  if coalesce(trim(p_context), '') <> '' then
    ctx := hub_context_categories(p_context);
  end if;
  p_products := coalesce(p_products, '{}');
  if cardinality(p_products) > 0 then
    ctx := ctx || coalesce((select array_agg(distinct category_id) from hub_products
                            where id = any (p_products) and category_id is not null), '{}');
  end if;
  if cardinality(pl.category_ids) > 0 then
    -- หมวดที่ตั้งไว้ถูกลบหมดแล้ว = ไม่มีสินค้าให้สุ่ม (ไม่ใช่กลายเป็นทุกหมวด)
    select coalesce(array_agg(distinct id), '{-1}') into cats from hub_categories
    where id = any (pl.category_ids) or parent_id = any (pl.category_ids);
  end if;

  with live as (
    select hp.*, (select count(*) from hub_events e
                  where e.product_id = hp.id and e.event = 'click' and e.event_at > now() - interval '30 days') as clicks
    from hub_products hp
    where hub_is_live(hp) and not (hp.id = any (coalesce(p_exclude, '{}')))
  ),
  ranked as (
    select l.*,
           case when l.id = any (p_products) then 0
                when l.id = any (pl.pinned_ids) then 1
                when l.category_id = any (ctx) then 2
                when cats is null or l.category_id = any (cats) then 3
           end as tier,
           coalesce(array_position(p_products, l.id), array_position(pl.pinned_ids, l.id)) as pin_order,
           -- Efraimidis–Spirakis: ค่าน้อยได้ก่อน ยิ่งน้ำหนักมากยิ่งมีโอกาสได้ค่าน้อย
           -ln(1 - random()) / (l.weight * (1 + coalesce(l.commission, 0) / 10.0) * (1 + ln(1 + l.clicks))) as roll
    from live l
  ),
  picked as (
    select * from ranked where tier is not null
    order by tier, pin_order nulls last, roll
    limit n
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'caption', caption, 'price', price, 'price_text', price_text, 'sold_text', sold_text,
           'shop', shop, 'source', source, 'image_url', image_url)
         order by tier, pin_order nulls last, roll), '[]'::jsonb)
  into ads from picked;

  return jsonb_build_object(
    'placement', jsonb_build_object('key', pl.key, 'slots', pl.slots, 'positions', to_jsonb(pl.positions)),
    'ads', ads);
end;
$$;
revoke all on function public.hub_ads(text, text, text, integer, bigint[], bigint[]) from public;
grant execute on function public.hub_ads(text, text, text, integer, bigint[], bigint[]) to anon, authenticated;

-- ลิงก์ /go/<id>: คืนลิงก์ affiliate และบันทึกคลิก (p_log = false สำหรับบอทที่มาเปิดดูตัวอย่างลิงก์)
-- ส่งต่อได้แม้สินค้าหยุดแสดงแล้ว เพราะหน้าเว็บที่เปิดค้างไว้อาจยังมีการ์ดเก่าอยู่
create or replace function public.hub_go(
  p_id bigint, p_site text default '', p_placement text default '', p_log boolean default true
) returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_link text;
begin
  select link into v_link from hub_products where id = p_id;
  if v_link is null then
    return null;
  end if;
  if p_log then
    insert into hub_events (event, product_id, site_id, placement)
    values ('click', p_id, (select id from hub_sites where key = lower(trim(coalesce(p_site, '')))),
            left(lower(trim(coalesce(p_placement, ''))), 40));
  end if;
  return v_link;
end;
$$;
revoke all on function public.hub_go(bigint, text, text, boolean) from public;
grant execute on function public.hub_go(bigint, text, text, boolean) to anon, authenticated, service_role;

-- นับการแสดง: ads.js ส่งรหัสสินค้าที่ขึ้นจอครึ่งหนึ่งขึ้นไปมาเป็นชุด (ไม่เกิน 24 รายการต่อครั้ง)
create or replace function public.hub_log_views(p_site text, p_placement text, p_ids bigint[])
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into hub_events (event, product_id, site_id, placement)
  select 'view', hp.id, (select id from hub_sites where key = lower(trim(coalesce(p_site, '')))),
         left(lower(trim(coalesce(p_placement, ''))), 40)
  from hub_products hp
  where hp.id = any ((coalesce(p_ids, '{}'))[1:24]);
end;
$$;
revoke all on function public.hub_log_views(text, text, bigint[]) from public;
grant execute on function public.hub_log_views(text, text, bigint[]) to anon, authenticated;

-- จำนวนการแสดงและคลิกต่อสินค้าย้อนหลัง N วัน (แอดมินเท่านั้น ตาม RLS ของ hub_events)
create or replace function public.hub_product_stats(p_ids bigint[], p_days integer default 30)
returns table (product_id bigint, views bigint, clicks bigint)
language sql stable
set search_path = public
as $$
  select e.product_id,
         count(*) filter (where e.event = 'view'),
         count(*) filter (where e.event = 'click')
  from hub_events e
  where e.product_id = any (p_ids)
    and e.event_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
  group by e.product_id;
$$;
grant execute on function public.hub_product_stats(bigint[], integer) to authenticated;

-- ==========================================
-- เฟส 3.5: ข้อมูลรีวิว
--   รูปทั้งหมด รายละเอียด และข้อมูลจำเพาะของสินค้าที่ขึ้นเว็บได้ สำหรับหน้ารีวิว (ads.js layout "review" หรือเรียกตรง)
--   ใช้คู่กับ hub_ads: ได้รหัสสินค้าจาก hub_ads ก่อน แล้วขอข้อมูลเต็มของรหัสเหล่านั้น
-- คืนค่า [{id, images, description, review, details: {brand, rating, rating_count, specs}}] ตามลำดับรหัสที่ขอ
-- สินค้าที่หยุดแสดงแล้วจะไม่มีในผล (ตาม RLS) และไม่ส่งลิงก์หน้าสินค้าต้นทาง (detail_url) ออกไป
-- ==========================================
create or replace function public.hub_product_info(p_ids bigint[])
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', hp.id,
           'images', to_jsonb(case when cardinality(hp.images) > 0 then hp.images
                                   when hp.image_url <> '' then array[hp.image_url] else '{}' end),
           'description', hp.description,
           'review', hp.review,
           'details', jsonb_strip_nulls(jsonb_build_object(
             'brand', hp.details -> 'brand', 'rating', hp.details -> 'rating',
             'rating_count', hp.details -> 'rating_count', 'specs', hp.details -> 'specs')))
         order by ids.o), '[]'::jsonb)
  from unnest((coalesce(p_ids, '{}'))[1:24]) with ordinality as ids(id, o)
  join hub_products hp on hp.id = ids.id
  where hub_is_live(hp);
$$;
revoke all on function public.hub_product_info(bigint[]) from public;
grant execute on function public.hub_product_info(bigint[]) to anon, authenticated;
