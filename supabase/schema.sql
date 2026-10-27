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
-- p_items: [{title, link, source, source_id, price, price_text, commission, sold_text, shop, image_url, category, search_keyword}]
-- มีอยู่แล้ว (แหล่ง + รหัสเดียวกัน หรือลิงก์เดียวกันเมื่อไม่มีรหัส): อัปเดตราคา ค่าคอม ยอดขาย ไม่แตะหมวด สถานะ และสิ่งที่แอดมินแก้ไว้
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
          image_url = case when image_url = '' then coalesce(item ->> 'image_url', '') else image_url end,
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
                                  link, image_url, category_id, status, search_keyword)
        values (v_source, v_source_id, v_title,
                nullif(item ->> 'price', '')::numeric, coalesce(item ->> 'price_text', ''),
                nullif(item ->> 'commission', '')::numeric, coalesce(item ->> 'sold_text', ''),
                left(coalesce(item ->> 'shop', ''), 80), v_link, coalesce(item ->> 'image_url', ''),
                v_cat, p_status, left(coalesce(item ->> 'search_keyword', ''), 120));
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
