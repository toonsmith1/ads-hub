// ค่าของโปรเจกต์ Supabase (Project Settings > API Keys)
// ใส่ได้เฉพาะ Project URL กับ Publishable key (หรือ anon key) ห้ามใส่ Secret key ในไฟล์นี้
window.HUB_CONFIG = {
  supabaseUrl: "https://gcdbqthffhxazrprlxaa.supabase.co",
  supabaseKey: "sb_publishable_RXPpI9u8Qr5_Dc_itBvEJw_M19WAnJh",
  // ลิงก์นับคลิก เว้นว่าง = ใช้ Edge Function ของ Supabase (<Project URL>/functions/v1/go)
  // ถ้าตั้ง redirect /go/* ใน netlify.toml แล้ว ใส่ "https://<เว็บ Ad Hub>/go" เพื่อให้ลิงก์สั้นลง
  goUrl: "",
  // ตาราง site_meta ของเว็บเดิมที่มีโฆษณาอยู่แล้ว ใช้ตอน "ย้ายโฆษณาเดิม" (เว้นว่างถ้าไม่มี)
  legacyPromos: { label: "transfer", name: "promos" },
};
