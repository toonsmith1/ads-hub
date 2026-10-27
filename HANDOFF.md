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

## ยังไม่ได้ทำ
- ผู้ใช้ยังไม่ได้ติดตั้งบน Supabase/Netlify ตาม README (รวมขั้นที่ 6-7 ของเฟส 3: Edge Function `go` และเพิ่มเว็บ)
- เปิดสวิตช์ Ad Hub ใน transfer หลังติดตั้งเสร็จ
- เฟส 4: หน้าสถิติ, ตัวแต่งรูปโฆษณา, สุ่มข้อความ (spintax จาก `extension/libs/spintax.js`) ทั้งปุ่มสร้างแคปชันและข้อความโปรยบนการ์ด

## กฎของเจ้าของ
- ตัวดึงสินค้าห้าม hardcode ให้ใช้ได้แค่เว็บเดียว ทุกอย่างต้องใช้ได้กับหลายเว็บ
- ผู้ใช้อยากให้ commit แยกเป็นขั้นๆ เพื่อดูได้ว่าอะไรมาจากไหน
