# สถานะงาน (ส่งต่อให้เธรดถัดไป)

แผนทั้งหมด: https://claude.ai/artifact/1dvKcswDKakxjyattkdVNc

## เสร็จแล้ว
- เฟส 1 (main): `supabase/schema.sql` ทดสอบบน Postgres 16 แล้ว, หน้าจัดการ `web/` ทดสอบด้วย `tests/fake-api.js` แล้ว
- เฟส 2 (branch `claude/extension-hub`):
  - commit `d053034` ก๊อป extension มาไม่แก้อะไร จาก toonsmith1/shopithread@588e31b
  - commit ถัดไป: `extension/libs/hub-service.js`, แท็บ "คลังโฆษณา (Ad Hub)" ในแดชบอร์ด (`dashboard/adhub-tab.js`),
    ปุ่ม "ส่งเข้าคลังโฆษณา" บนแผงหน้า Shopee (`content.js`), ข้อความ `HUB_STATUS` / `HUB_IMPORT` ใน `background.js`
  - ทดสอบ hub-service ด้วย fetch ปลอมแล้ว (ล็อกอิน, ต่ออายุ token, ส่งทีละ 200 รายการ, ข้ามสินค้าที่ไม่มีลิงก์ affiliate)

- ทดสอบในเบราว์เซอร์จริงแล้ว: `xvfb-run -a node tests/extension-e2e.js` (Chromium แบบ headless: false, หน้า Shopee ปลอม + Supabase ปลอม)
  เจอและแก้บั๊ก: สินค้าที่ดึงลิงก์ affiliate ไม่ได้ถูกส่งลิงก์หน้าพอร์ทัลเข้าคลัง ตอนนี้ถูกข้ามแล้ว
- เปิด PR เข้า main แล้ว (จาก branch `claude/project-thread-bcztk5` ซึ่งมีทุก commit ของ `claude/extension-hub` + ที่แก้เพิ่ม)
- หมายเหตุ: `extension/test-dashboard.js`, `test-e2e-qa.js`, `test-popup.js` พังมาตั้งแต่ต้นฉบับ shopithread (พังเหมือนกันที่ `d053034`) ไม่เกี่ยวกับ Ad Hub

- เฟส 3 (PR #2 ของ ads-hub, branch `claude/project-thread-igzbqd`) ไม่แตะ extension ตามที่ผู้ใช้ขอ (ใช้ Shopee ที่เดียว)
  - `supabase/schema.sql` ต่อท้าย: `hub_sites`, `hub_placements`, `hub_events` และ rpc `hub_ads`, `hub_go`, `hub_log_views`, `hub_product_stats`
  - `supabase/functions/go/index.ts`: Edge Function `/go/<id>` นับคลิกแล้ว 302 ไปลิงก์ affiliate
  - `web/ads.js`: สคริปต์ฝัง (`window.AdHub`: load / render / observe / scan)
  - หน้าจัดการ: ปุ่ม "เว็บที่แสดงโฆษณา" (เว็บ จุดที่วาง ปักหมุด โค้ดฝัง) และคลิก 30 วันบนการ์ด/ตาราง/แผงแก้ไข
  - ทดสอบ: `bash tests/db-test.sh` (Postgres 16), `node --experimental-strip-types tests/go-test.mjs`,
    `node tests/ads-e2e.js`, `node tests/admin-sites-e2e.js` ผ่านทั้งหมด
  - สลับ transfer: ทำใน repo toonsmith1/transfer เป็น PR แยก มีสวิตช์ (ตั้งลิงก์ ads.js ในแอดมิน transfer) ไม่ใส่ = ใช้โฆษณาเดิม

- รูปทั้งหมดและรายละเอียดสำหรับรีวิว (branch `claude/project-thread-6jyqes`)
  - `hub_products` เพิ่ม `images text[]`, `description`, `details jsonb` (add column if not exists) และ `hub_import_products` รับค่าเหล่านี้
  - `extension/libs/product-detail-service.js`: เปิดหน้าสินค้าในแท็บเบื้องหลัง อ่าน JSON-LD / og: / แกลเลอรี / หัวข้อรายละเอียดและข้อมูลจำเพาะ
    ถ้าหน้าที่เปิดไม่ใช่หน้าสินค้า ตามลิงก์ที่มีรหัสสินค้า สุดท้ายค่อยไปทางลิงก์ affiliate (ปิดได้ในแผง)
  - ยังไม่เคยลองกับ Shopee จริง (เครื่องคลาวด์เข้า Shopee ไม่ได้) ทดสอบด้วยหน้าปลอมใน `tests/extension-e2e.js`
    ถ้าผู้ใช้บอกว่าได้รูป/รายละเอียดไม่ครบ ให้ขอ HTML ของหน้าสินค้าจริง (Ctrl+S) มาปรับ `gallery()` / `section()`
  - ทดสอบ: `bash tests/db-test.sh` (รวมอัปเกรดจาก schema ที่ `03d6883`), `xvfb-run -a node tests/extension-e2e.js`, `node tests/admin-sites-e2e.js`

- เฟส 3.5 ข้อมูลรีวิว + ตัวเขียนรีวิว (branch `claude/project-thread-qza8h4`)
  - `supabase/schema.sql`: คอลัมน์ `hub_products.review` และ rpc `hub_product_info(p_ids)` (anon, เฉพาะสินค้าที่ขึ้นเว็บ ไม่ส่ง `detail_url`)
  - `web/ads.js`: `load({full: true})`, `render(el, ads, {layout: "review"})`, `data-layout="review"` = กล่องรีวิว
  - `web/review.html`: หน้ารีวิวตัวอย่าง `?site=&id=` + สินค้าที่คล้ายกัน
  - `web/js/review-writer.js`: สุ่มรีวิวแบบป้ายยาจากข้อมูลจริง (spintax ของตัวเอง ไม่ได้ใช้ `extension/libs/spintax.js` เพราะเป็นแคปชันโพสต์)
  - `supabase/functions/review/index.ts`: AI ร่างรีวิว (แอดมินเท่านั้น) Secrets `AI_PROVIDER` anthropic|openai, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`
    error คืน `reason` no_key/quota/failed แล้วหน้าจัดการสุ่มแทน ยังไม่เคยเรียก API จริง (ไม่มีคีย์) ทดสอบด้วย fetch ปลอม
  - ทดสอบ: `bash tests/db-test.sh`, `node tests/ads-e2e.js`, `node tests/admin-sites-e2e.js`, `node --experimental-strip-types tests/review-test.mjs`

## ยังไม่ได้ทำ
- ผู้ใช้ยังไม่ได้ติดตั้งบน Supabase/Netlify ตาม README (รวมขั้นที่ 6-7 ของเฟส 3: Edge Function `go` และเพิ่มเว็บ, ขั้น 8: ฟังก์ชัน `review` + คีย์ AI)
- เปิดสวิตช์ Ad Hub ใน transfer หลังติดตั้งเสร็จ
- เฟส 4: หน้าสถิติ, ตัวแต่งรูปโฆษณา, สุ่มข้อความ (spintax จาก `extension/libs/spintax.js`) ทั้งปุ่มสร้างแคปชันและข้อความโปรยบนการ์ด

## กฎของเจ้าของ
- ตัวดึงสินค้าห้าม hardcode ให้ใช้ได้แค่เว็บเดียว ทุกอย่างต้องใช้ได้กับหลายเว็บ
- ผู้ใช้อยากให้ commit แยกเป็นขั้นๆ เพื่อดูได้ว่าอะไรมาจากไหน
