# สถานะงาน (ส่งต่อให้เธรดถัดไป)

แผนทั้งหมด: https://claude.ai/artifact/1dvKcswDKakxjyattkdVNc

## เสร็จแล้ว
- เฟส 1 (main): `supabase/schema.sql` ทดสอบบน Postgres 16 แล้ว, หน้าจัดการ `web/` ทดสอบด้วย `tests/fake-api.js` แล้ว
- เฟส 2 (branch `claude/extension-hub`):
  - commit `d053034` ก๊อป extension มาไม่แก้อะไร จาก toonsmith1/shopithread@588e31b
  - commit ถัดไป: `extension/libs/hub-service.js`, แท็บ "คลังโฆษณา (Ad Hub)" ในแดชบอร์ด (`dashboard/adhub-tab.js`),
    ปุ่ม "ส่งเข้าคลังโฆษณา" บนแผงหน้า Shopee (`content.js`), ข้อความ `HUB_STATUS` / `HUB_IMPORT` ใน `background.js`
  - ทดสอบ hub-service ด้วย fetch ปลอมแล้ว (ล็อกอิน, ต่ออายุ token, ส่งทีละ 200 รายการ, ข้ามสินค้าที่ไม่มีลิงก์ affiliate)

## ยังไม่ได้ทำ
- ทดสอบ extension ทั้งชุดในเบราว์เซอร์ (Playwright โหลด extension แบบ headless แล้วรอ service worker ไม่ขึ้น ลอง headless: false + xvfb หรือ channel chromium)
- เปิด PR `claude/extension-hub` → main
- ผู้ใช้ยังไม่ได้ติดตั้งบน Supabase/Netlify ตาม README
- เฟส 3: `ads.js` + ลิงก์ `/go/<id>` นับคลิก แล้วสลับเว็บ transfer มาใช้
- เฟส 4: หน้าสถิติ, ตัวแต่งรูปโฆษณา, สุ่มข้อความ (spintax จาก `extension/libs/spintax.js`) ทั้งปุ่มสร้างแคปชันและข้อความโปรยบนการ์ด

## กฎของเจ้าของ
- ตัวดึงสินค้าห้าม hardcode ให้ใช้ได้แค่เว็บเดียว ทุกอย่างต้องใช้ได้กับหลายเว็บ
- ผู้ใช้อยากให้ commit แยกเป็นขั้นๆ เพื่อดูได้ว่าอะไรมาจากไหน
