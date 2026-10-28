-- ข้อมูลทดสอบและการตรวจของเฟส 3 (รันผ่าน tests/db-test.sh)
\set QUIET on
insert into hub_admins (user_id, email) values ('00000000-0000-0000-0000-000000000001', 'admin@example.com');

do $$
declare fashion bigint; coat bigint; computer bigint;
begin
  select id into fashion from hub_categories where name = 'แฟชั่นผู้หญิง';
  select id into computer from hub_categories where name = 'คอมพิวเตอร์';
  insert into hub_categories (name, parent_id, keywords) values ('เสื้อคลุม', fashion, '{ทวิต}') returning id into coat;
  insert into hub_products (id, source, source_id, title, link, category_id, status, weight, commission, starts_on, ends_on) values
    (1, 'shopee', '1', 'เสื้อยืด A', 'https://s.shopee.co.th/a', fashion, 'active', 1, 1, null, null),
    (2, 'shopee', '2', 'เสื้อคลุมทวิต B', 'https://s.shopee.co.th/b', coat, 'active', 1, 1, null, null),
    (3, 'shopee', '3', 'กระโปรง C', 'https://s.shopee.co.th/c', fashion, 'active', 1, 1, null, null),
    (4, 'shopee', '4', 'จอพกพา D', 'https://s.shopee.co.th/d', computer, 'active', 1, 1, null, null),
    (5, 'shopee', '5', 'เมาส์ E', 'https://s.shopee.co.th/e', computer, 'active', 10, 20, null, null),
    (6, 'shopee', '6', 'รอตรวจ F', 'https://s.shopee.co.th/f', fashion, 'pending', 1, 1, null, null),
    (7, 'shopee', '7', 'หมดช่วง G', 'https://s.shopee.co.th/g', fashion, 'active', 1, 1, null, '2020-01-01'),
    (8, 'shopee', '8', 'ยังไม่ถึง H', 'https://s.shopee.co.th/h', fashion, 'active', 1, 1, '2999-01-01', null),
    (9, 'lazada', '9', 'ไม่มีหมวด I', 'https://www.lazada.co.th/i', null, 'active', 1, null, null, null);
  insert into hub_sites (id, key, name) values (1, 'transfer', 'ย้ายราชการ');
  insert into hub_placements (site_id, key, slots, positions, category_ids, pinned_ids) values
    (1, 'feed', 3, '{2,6,10}', array[fashion], '{4}'),
    (1, 'detail', 1, '{}', '{}', '{}');
  insert into hub_placements (site_id, key, enabled) values (1, 'off', false);
end $$;

-- ---------- คนทั่วไป ----------
set role anon;
do $$
declare r jsonb; ids bigint[]; i integer; seen bigint[] := '{}'; heavy integer := 0;
begin
  -- feed: ปักหมุดมาก่อน ที่เหลือมาจากหมวดแฟชั่น (รวมหมวดย่อย) และขึ้นเว็บได้ตอนนี้
  for i in 1..30 loop
    r := hub_ads('transfer', 'feed');
    select array_agg((a ->> 'id')::bigint) into ids from jsonb_array_elements(r -> 'ads') a;
    assert cardinality(ids) = 3, format('feed ควรได้ 3 ชิ้น ได้ %s', r);
    assert ids[1] = 4, 'สินค้าปักหมุดต้องขึ้นก่อน';
    assert ids[2] <> ids[3], 'ห้ามซ้ำในชุดเดียว';
    assert ids[2:3] <@ array[1, 2, 3]::bigint[], format('ต้องมาจากหมวดแฟชั่นที่ขึ้นเว็บได้ ได้ %s', ids);
    seen := seen || ids[2:3];
  end loop;
  assert 2 = any (seen), 'หมวดย่อย (เสื้อคลุม) ต้องสุ่มได้ด้วย';
  assert (r -> 'placement' ->> 'slots')::int = 3 and r -> 'placement' -> 'positions' = '[2, 6, 10]', 'ต้องคืนค่าตั้งของจุดที่วาง';
  assert not (r -> 'ads' -> 0 ? 'link'), 'ไม่ส่งลิงก์ affiliate ตรง ให้ไปผ่าน /go/';
  assert r -> 'ads' -> 0 ? 'caption', 'ต้องส่งคำโปรยไปด้วย';

  -- ไม่ซ้ำกับที่หน้าแสดงไปแล้ว
  r := hub_ads('transfer', 'feed', '', 5, '{4,1,2}');
  select array_agg((a ->> 'id')::bigint) into ids from jsonb_array_elements(r -> 'ads') a;
  assert ids = '{3}', format('exclude ไม่ทำงาน ได้ %s', ids);

  -- บริบทของหน้า: "จอ" ตรงคำของหมวดคอมพิวเตอร์ ได้ของในหมวดนั้นก่อน แล้วค่อยเติมจากหมวดของจุดที่วาง
  r := hub_ads('transfer', 'feed', 'จอคอมสำหรับครู', 4, '{}');
  select array_agg((a ->> 'id')::bigint) into ids from jsonb_array_elements(r -> 'ads') a;
  assert ids[1] = 4 and ids[2] = 5, format('ของตามบริบทต้องมาหลังปักหมุด ได้ %s', ids);
  assert ids[3:4] <@ array[1, 2, 3]::bigint[], format('เติมจากหมวดของจุดที่วาง ได้ %s', ids);

  -- detail: ทุกหมวด สุ่มถ่วงน้ำหนัก ชิ้นน้ำหนัก 10 ค่าคอม 20% (id 5) ต้องขึ้นบ่อยกว่าชิ้นอื่นชัดเจน
  for i in 1..400 loop
    r := hub_ads('transfer', 'detail');
    assert jsonb_array_length(r -> 'ads') = 1;
    assert (r -> 'ads' -> 0 ->> 'id')::bigint not in (6, 7, 8), 'ห้ามมีของที่ยังไม่ขึ้นเว็บ';
    if (r -> 'ads' -> 0 ->> 'id')::bigint = 5 then heavy := heavy + 1; end if;
  end loop;
  assert heavy > 250, format('ถ่วงน้ำหนักไม่ได้ผล: ชิ้นหนักขึ้น %s/400', heavy);

  -- ขอสินค้าตามรหัส (หน้ารีวิว): ได้ชิ้นนั้นก่อน แม้ไม่อยู่ในหมวดของจุดที่วาง และมาก่อนปักหมุด
  r := hub_ads('transfer', 'feed', '', 2, '{}', '{5}');
  select array_agg((a ->> 'id')::bigint) into ids from jsonb_array_elements(r -> 'ads') a;
  assert ids = '{5,4}', format('ขอตามรหัสต้องมาก่อน ได้ %s', ids);
  r := hub_ads('transfer', 'detail', '', 2, '{}', '{3,1}');
  select array_agg((a ->> 'id')::bigint) into ids from jsonb_array_elements(r -> 'ads') a;
  assert ids = '{3,1}', format('ต้องเรียงตามที่ขอ ได้ %s', ids);
  -- ชิ้นที่ขอหยุดแสดงแล้ว (6 รอตรวจ หมวดแฟชั่น): ได้ชิ้นอื่นในหมวดเดียวกันแทน
  for i in 1..20 loop
    r := hub_ads('transfer', 'detail', '', 1, '{}', '{6}');
    assert (r -> 'ads' -> 0 ->> 'id')::bigint in (1, 2, 3), format('ต้องได้ของหมวดเดียวกันแทน ได้ %s', r);
  end loop;

  -- จุดที่ปิดหรือเว็บที่ไม่มี: ไม่มีโฆษณา ไม่ error
  assert hub_ads('transfer', 'off') = '{"ads": [], "placement": null}', 'จุดที่ปิดต้องว่าง';
  assert hub_ads('nosuch', 'feed') = '{"ads": [], "placement": null}', 'เว็บที่ไม่มีต้องว่าง';

  -- /go/
  assert hub_go(2, 'transfer', 'feed') = 'https://s.shopee.co.th/b';
  assert hub_go(7, 'transfer', 'feed') = 'https://s.shopee.co.th/g', 'การ์ดเก่าที่หมดช่วงแล้วยังส่งต่อได้';
  assert hub_go(2, 'transfer', 'feed', false) = 'https://s.shopee.co.th/b';
  assert hub_go(999) is null, 'รหัสที่ไม่มีต้องได้ null';
  perform hub_log_views('transfer', 'feed', '{1,2,999}');
end $$;

-- คนทั่วไปอ่านตารางสถิติและการตั้งค่าตรงๆ ไม่ได้
do $$ begin
  perform 1 from hub_events; raise exception 'anon ไม่ควรอ่าน hub_events ได้';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from hub_sites; raise exception 'anon ไม่ควรอ่าน hub_sites ได้';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform hub_product_stats('{1}'); raise exception 'anon ไม่ควรเรียก hub_product_stats ได้';
exception when insufficient_privilege then null; end $$;
reset role;

do $$ begin
  assert (select count(*) from hub_events where event = 'click') = 2, 'บันทึกคลิกต้องได้ 2 (p_log=false และรหัสที่ไม่มีไม่นับ)';
  assert (select count(*) from hub_events where event = 'view') = 2, 'บันทึกการแสดงต้องได้ 2 (ข้ามรหัสที่ไม่มี)';
  assert (select count(*) from hub_events where site_id = 1 and placement = 'feed') = 4;
end $$;

-- ---------- ผู้ใช้ที่ล็อกอินแต่ไม่ใช่แอดมิน ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$ begin
  assert (select count(*) from hub_sites) = 0, 'คนที่ไม่ใช่แอดมินต้องไม่เห็นเว็บ';
  assert (select count(*) from hub_events) = 0, 'คนที่ไม่ใช่แอดมินต้องไม่เห็นสถิติ';
  begin
    insert into hub_sites (key, name) values ('evil', 'x');
    raise exception 'คนที่ไม่ใช่แอดมินเพิ่มเว็บได้';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------- แอดมิน ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare s record;
begin
  insert into hub_sites (key, name, domain) values ('blog', 'บล็อก', 'blog.example.com');
  insert into hub_placements (site_id, key, slots) select id, 'sidebar', 2 from hub_sites where key = 'blog';
  assert (select count(*) from hub_placements) = 4;
  select * into s from hub_product_stats('{2,1}') where product_id = 2;
  assert s.views = 1 and s.clicks = 1, format('สถิติสินค้า 2 ผิด: %s', s);
  begin
    insert into hub_sites (key, name) values ('Bad Key', 'x');
    raise exception 'คีย์เว็บที่มีเว้นวรรคต้องไม่ผ่าน';
  exception when check_violation then null;
  end;
  -- ลบสินค้าแล้วสถิติหายตาม ลบเว็บแล้วจุดที่วางหายตาม
  delete from hub_products where id = 2;
  delete from hub_sites where key = 'blog';
  assert (select count(*) from hub_events where product_id = 2) = 0;
  assert (select count(*) from hub_placements) = 3;
end $$;
reset role;

-- ---------- นำเข้ารูปทั้งหมดและรายละเอียดจากหน้าสินค้า ----------
select setval('hub_products_id_seq', 1000) \g /dev/null
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare r jsonb; p hub_products;
begin
  r := hub_import_products('[{"title": "หูฟัง J", "link": "https://s.shopee.co.th/j", "source": "shopee", "source_id": "77",
    "images": ["https://cdn.example/1.jpg", "javascript:alert(1)", "https://cdn.example/2.jpg", "https://cdn.example/1.jpg"],
    "description": "  เสียงดี แบตอึด  ", "details": {"brand": "ABC", "rating": 4.8}}]');
  assert r ->> 'added' = '1', format('ต้องเพิ่มได้ %s', r);
  select * into p from hub_products where source_id = '77';
  assert p.images = '{https://cdn.example/1.jpg,https://cdn.example/2.jpg}', format('รูปต้องเป็น http ไม่ซ้ำ ตามลำดับ ได้ %s', p.images);
  assert p.image_url = 'https://cdn.example/1.jpg', 'ไม่มีรูปปกให้ใช้รูปแรก';
  assert p.description = 'เสียงดี แบตอึด' and p.details ->> 'brand' = 'ABC';

  -- ส่งซ้ำโดยไม่มีรายละเอียด (เช่นกดส่งแบบไม่เปิดหน้าสินค้า): ของเดิมต้องอยู่ครบ
  r := hub_import_products('[{"title": "หูฟัง J", "link": "https://s.shopee.co.th/j", "source": "shopee", "source_id": "77", "price": "199"}]');
  select * into p from hub_products where source_id = '77';
  assert r ->> 'updated' = '1' and p.price = 199;
  assert cardinality(p.images) = 2 and p.description = 'เสียงดี แบตอึด' and p.details ->> 'rating' = '4.8', 'ส่งว่างต้องไม่ลบของเดิม';

  -- ส่งรายละเอียดใหม่: แทนรูปและคำอธิบาย รวม details
  r := hub_import_products('[{"title": "หูฟัง J", "link": "https://s.shopee.co.th/j", "source": "shopee", "source_id": "77",
    "images": ["https://cdn.example/3.jpg"], "description": "รุ่นใหม่", "details": {"rating": 4.9}}]');
  select * into p from hub_products where source_id = '77';
  assert p.images = '{https://cdn.example/3.jpg}' and p.description = 'รุ่นใหม่';
  assert p.details = '{"brand": "ABC", "rating": 4.9}', format('details ต้องรวมกัน ได้ %s', p.details);
  assert p.image_url = 'https://cdn.example/1.jpg', 'รูปปกเดิมต้องไม่ถูกแทน';

  -- แอดมินลบรูปไว้ (details.removed_images): นำเข้าซ้ำแล้วรูปที่ลบต้องไม่กลับมา
  update hub_products set images = '{}', details = details || '{"removed_images": ["https://cdn.example/4.jpg"]}' where source_id = '77';
  r := hub_import_products('[{"title": "หูฟัง J", "link": "https://s.shopee.co.th/j", "source": "shopee", "source_id": "77",
    "images": ["https://cdn.example/4.jpg", "https://cdn.example/3.jpg"], "details": {"rating": 4.9}}]');
  select * into p from hub_products where source_id = '77';
  assert p.images = '{https://cdn.example/3.jpg}', format('รูปที่ลบต้องไม่กลับมา ได้ %s', p.images);
  assert p.details -> 'removed_images' = '["https://cdn.example/4.jpg"]', 'ต้องจำรูปที่ลบไว้';
end $$;
reset role;

-- คนทั่วไปอ่านรูปและรายละเอียดของสินค้าที่ขึ้นเว็บได้ (สำหรับหน้ารีวิว)
update hub_products set status = 'active' where source_id = '77';
set role anon;
do $$ begin
  assert (select cardinality(images) from hub_products where source_id = '77') = 1;
end $$;
reset role;

-- คำโปรย: นำเข้าครั้งแรกได้คำโปรย นำเข้าซ้ำไม่ทับของที่มีอยู่ (แอดมินอาจแก้ไว้)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin
  perform hub_import_products('[{"title": "โปรย A", "link": "https://example.com/caption-a", "caption": "  ราคา ฿350 ส่งฟรี  "}]', 'active');
  assert (select caption from hub_products where link = 'https://example.com/caption-a') = 'ราคา ฿350 ส่งฟรี';
  perform hub_import_products('[{"title": "โปรย A", "link": "https://example.com/caption-a", "caption": "อย่างอื่น"}]', 'active');
  assert (select caption from hub_products where link = 'https://example.com/caption-a') = 'ราคา ฿350 ส่งฟรี', 'นำเข้าซ้ำต้องไม่ทับคำโปรย';
end $$;
reset role;

-- ---------- เฟส 3.5: hub_product_info ข้อมูลรีวิว ----------
update hub_products set details = details || '{"specs": {"สี": "ดำ"}, "detail_url": "https://shopee.co.th/x-i.1.77"}', review = 'ใช้มาเดือนนึง' where source_id = '77';
set role anon;
do $$
declare r jsonb; live bigint; hidden bigint;
begin
  select id into live from hub_products where source_id = '77';
  select id into hidden from hub_products where status <> 'active' limit 1;
  r := hub_product_info(array[hidden, live, live]);
  assert jsonb_array_length(r) = 2, format('สินค้าที่หยุดแสดงต้องไม่มีในผล ได้ %s', r);
  assert (r -> 0 ->> 'id')::bigint = live;
  assert r -> 0 -> 'images' = '["https://cdn.example/3.jpg"]';
  assert r -> 0 ->> 'description' = 'รุ่นใหม่' and r -> 0 ->> 'review' = 'ใช้มาเดือนนึง';
  assert r -> 0 -> 'details' = '{"brand": "ABC", "rating": 4.9, "specs": {"สี": "ดำ"}}', format('ไม่ส่ง detail_url ได้ %s', r -> 0 -> 'details');
  assert hub_product_info(null) = '[]' and hub_product_info('{}') = '[]';
end $$;
reset role;
-- ไม่มีรูปจากหน้าสินค้า: ใช้รูปปกแทน
update hub_products set images = '{}' where source_id = '77';
set role anon;
do $$ begin
  assert hub_product_info(array[(select id from hub_products where source_id = '77')]) -> 0 -> 'images' = '["https://cdn.example/1.jpg"]';
end $$;
reset role;

-- ---------- ตั้งค่า AI: คีย์ไม่ถูกส่งกลับ, เว้นว่าง = ใช้คีย์เดิม, เฉพาะแอดมิน ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare r jsonb;
begin
  assert hub_ai_settings() = '{"has_key": false}', 'ยังไม่ตั้ง';
  r := hub_save_ai_settings('{"preset": "claude", "provider": "anthropic", "model": "claude-haiku-5-5", "api_key": " sk-ant-abcd1234 "}');
  assert r = '{"preset": "claude", "provider": "anthropic", "model": "claude-haiku-5-5", "base_url": "", "has_key": true, "key_hint": "1234"}', format('ได้ %s', r);
  assert (select value ->> 'api_key' from hub_settings where key = 'ai') = 'sk-ant-abcd1234';
  r := hub_save_ai_settings('{"preset": "deepseek", "provider": "OpenAI", "model": "deepseek-chat", "base_url": "https://api.deepseek.com", "api_key": ""}');
  assert r ->> 'provider' = 'openai' and r ->> 'key_hint' = '1234', 'คีย์ว่างต้องใช้คีย์เดิม';
  assert not (r ? 'api_key');
  r := hub_save_ai_settings('{"provider": "evil", "clear_key": true, "api_key": "x"}');
  assert r ->> 'provider' = 'anthropic' and r -> 'has_key' = 'false', format('ลบคีย์ ได้ %s', r);
  perform hub_save_ai_settings('{"provider": "anthropic", "api_key": "sk-ant-zzzz9999"}');
end $$;
reset role;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$ begin
  assert hub_ai_settings() = '{"has_key": false}', 'คนที่ไม่ใช่แอดมินต้องไม่เห็นค่า';
  assert (select count(*) from hub_settings) = 0;
  begin
    perform hub_save_ai_settings('{"api_key": "steal"}');
    raise exception 'คนที่ไม่ใช่แอดมินบันทึกได้';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform hub_ai_settings();
    raise exception 'anon เรียกได้';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select value ->> 'api_key' from hub_settings where key = 'ai') = 'sk-ant-zzzz9999';
end $$;
