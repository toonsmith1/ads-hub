// ทดสอบหน้าเว็บของแอป Android ดูจำนวนคลิก (android/app/src/main/assets) ใน Chromium ด้วย Supabase ปลอม
// รัน: node tests/clicks-app-e2e.js   (ต้องมี playwright และ chromium)
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");

const ASSETS = path.resolve(__dirname, "../android/app/src/main/assets");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const SB = "https://fake.supabase.co";
const KEY = "sb_publishable_test";
const DAY = 864e5;
const TZ = 7 * 3600e3;

// คลิกปลอม: สินค้า 1 วันละ 3 คลิก 10 วันล่าสุด, สินค้า 2 วันนี้ 2 คลิก, สินค้า 99 (ถูกลบแล้ว) เมื่อวาน 1 คลิก
// เวลา 10:00 น. ไทย (ถ้ายังไม่ถึงตอนนี้ วันนี้ใช้เวลาปัจจุบันลบ 1 นาที)
function fakeEvents(now) {
  const todayStart = Math.floor((now + TZ) / DAY) * DAY - TZ;
  const at = d => Math.min(todayStart - d * DAY + 10 * 3600e3, now - 60e3 - d * DAY);
  const ev = [];
  let id = 0;
  for (let d = 0; d < 10; d++) for (let i = 0; i < 3; i++) ev.push({ id: ++id, event: "click", event_at: new Date(at(d) + i * 1000).toISOString(), product_id: 1, site_id: 1, placement: "feed" });
  ev.push({ id: ++id, event: "click", event_at: new Date(at(0) + 5000).toISOString(), product_id: 2, site_id: null, placement: "" });
  ev.push({ id: ++id, event: "click", event_at: new Date(at(0) + 6000).toISOString(), product_id: 2, site_id: 1, placement: "detail" });
  ev.push({ id: ++id, event: "click", event_at: new Date(at(1) + 7000).toISOString(), product_id: 99, site_id: 1, placement: "feed" });
  ev.push({ id: ++id, event: "view", event_at: new Date(at(0)).toISOString(), product_id: 1, site_id: 1, placement: "feed" });
  return ev.sort((a, b) => a.id - b.id);
}

// ผลของ hub_transfer_stats แบบเดียวกับ visitor_stats / analytics_stats ของ transfer
function fakeTransfer(days, now) {
  const today = new Date(now + TZ).toISOString().slice(0, 10);
  const day = n => new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);
  const daily = Array.from({ length: days }, (_, i) => ({ day: day(days - 1 - i), views: (days - 1 - i) % 2 ? 0 : 10, visitors: (days - 1 - i) % 2 ? 0 : 4 }));
  const total = daily.reduce((n, x) => n + x.views, 0);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, views: hour === 9 ? total : 0, visitors: hour === 9 ? 4 : 0 }));
  return {
    visitors: {
      days, total_views: total, unique_visitors: 7, today_views: 10, today_unique: 4, all_time_views: 1234,
      month_start: today.slice(0, 8) + "01", month_views: 50, month_unique: 30, prev_month_unique: 20,
      daily, hourly: hours, today_hourly: hours.map(h => ({ ...h, views: h.hour === 9 ? 10 : 0 })),
      weekday: Array.from({ length: 7 }, (_, i) => ({ dow: i + 1, views: i === 0 ? total : 0, visitors: i === 0 ? 7 : 0 })),
      provinces: [{ province: "กรุงเทพมหานคร", views: 8, visitors: 5 }, { province: "<เชียงใหม่>", views: 2, visitors: 2 }],
      ips: [],
    },
    analytics: fake.noAnalytics ? null : {
      days, views: 6, sessions: 4, clients: 3, new_clients: 2, returning_clients: 1, avg_duration_sec: 75, median_duration_sec: 60,
      sources: [{ source: "google", sessions: 3 }, { source: "line", sessions: 1 }], ref_hosts: [],
      devices: [{ device: "mobile", clients: 3 }],
      top_announcements: [{ id: 5, title: "ประกาศย้าย ครู <สพฐ.>", views: 4, clients: 3, avg_duration_sec: 90 }],
      consent: { accept: 3, decline: 1 },
    },
  };
}
const fake = { admin: true, token: 0, pages: 0, refreshed: 0, expiresIn: 3600, transferDays: [], noTransferFn: false, noAnalytics: false };

(async () => {
  const server = await new Promise(r => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const file = path.join(ASSETS, path.normalize(u.pathname === "/" ? "/index.html" : u.pathname));
      if (!file.startsWith(ASSETS) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
      fs.createReadStream(file).pipe(res);
    }).listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/`;

  const events = fakeEvents(Date.now());
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));

  await page.route(SB + "/**", async route => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "Access-Control-Allow-Origin": "*" } });
    const headers = req.headers();
    if (headers.apikey !== KEY) return json({ message: "Invalid API key" }, 401);
    if (u.pathname === "/auth/v1/settings") return json({});
    if (u.pathname === "/auth/v1/token") {
      const body = JSON.parse(req.postData());
      if (u.searchParams.get("grant_type") === "password") {
        if (body.password !== "pw") return json({ error_description: "Invalid login credentials" }, 400);
      } else fake.refreshed++;
      fake.token++;
      return json({ access_token: "t" + fake.token, refresh_token: "r" + fake.token, expires_in: fake.expiresIn });
    }
    if (headers.authorization !== "Bearer t" + fake.token) return json({ message: "JWT expired" }, 401);
    if (u.pathname === "/rest/v1/rpc/hub_is_admin") return json(fake.admin);
    if (u.pathname === "/rest/v1/rpc/hub_transfer_stats") {
      if (fake.noTransferFn) return json({ code: "PGRST202", message: "Could not find the function public.hub_transfer_stats(p_days) in the schema cache" }, 404);
      const { p_days } = JSON.parse(req.postData());
      fake.transferDays.push(p_days);
      return json(fakeTransfer(p_days, Date.now()));
    }
    if (u.pathname === "/rest/v1/hub_sites") return json([{ id: 1, key: "transfer", name: "Transfer" }]);
    if (u.pathname === "/rest/v1/hub_products") {
      const ids = u.searchParams.get("id").replace(/^in\.\(|\)$/g, "").split(",").map(Number);
      const all = [
        { id: 1, title: "เสื้อยืดคอกลม <ผ้าฝ้าย>", shop: "ร้าน A", image_url: "", source: "shopee", source_id: "111" },
        { id: 2, title: "กระเป๋าผ้า", shop: "ร้าน B", image_url: "", source: "shopee", source_id: "222" },
      ];
      return json(all.filter(p => ids.includes(p.id)));
    }
    if (u.pathname === "/rest/v1/hub_events") {
      // หน้าละ 4 แถว จำลอง max-rows ต่ำกว่าที่แอปขอ
      fake.pages++;
      const p = u.searchParams;
      assert.equal(p.get("event"), "eq.click");
      const [gte, lt] = p.getAll("event_at").map(v => Date.parse(v.slice(v.indexOf(".") + 1)));
      const after = Number(p.get("id").slice(3));
      return json(events.filter(e => e.event === "click" && Date.parse(e.event_at) >= gte && Date.parse(e.event_at) < lt && e.id > after).slice(0, 4));
    }
    return json({ message: "not found " + u.pathname }, 404);
  });

  await page.goto(base);

  // ตั้งค่าครั้งแรก: ไม่รับ Secret key
  await page.waitForSelector("#setup:not([hidden])");
  await page.fill("#setup-form [name=url]", SB + "/");
  await page.fill("#setup-form [name=key]", "sb_secret_abc");
  await page.click("#setup-form button");
  await page.waitForFunction(() => document.querySelector("#setup [data-error]").textContent.includes("Secret key"));
  const jwt = "x." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") + ".y";
  await page.fill("#setup-form [name=key]", jwt);
  await page.click("#setup-form button");
  await page.waitForFunction(() => document.querySelector("#setup [data-error]").textContent.includes("Secret key"));
  await page.fill("#setup-form [name=key]", KEY);
  await page.click("#setup-form button");

  // ล็อกอิน: รหัสผิด / ไม่ใช่แอดมิน / ผ่าน
  await page.waitForSelector("#login:not([hidden])");
  await page.fill("#login-form [name=email]", "a@b.c");
  await page.fill("#login-form [name=password]", "wrong");
  await page.click("#login-form button");
  await page.waitForFunction(() => document.querySelector("#login [data-error]").textContent.includes("ไม่ถูกต้อง"));
  fake.admin = false;
  await page.fill("#login-form [name=password]", "pw");
  await page.click("#login-form button");
  await page.waitForFunction(() => document.querySelector("#login [data-error]").textContent.includes("ไม่ใช่แอดมิน"));
  assert.equal(await page.evaluate(() => localStorage.getItem("session")), null);
  fake.admin = true;
  await page.fill("#login-form [name=password]", "pw");
  await page.click("#login-form button");

  // 7 วัน (ค่าเริ่มต้น): สินค้า 1 = 21, สินค้า 2 = 2, สินค้า 99 = 1 → 24 / ช่วงก่อนหน้า (3 วันที่เหลือ) = 9
  await page.waitForSelector("#main:not([hidden]) .total");
  await page.waitForFunction(() => !document.querySelector("#main").classList.contains("loading"));
  const text = () => page.textContent("#content");
  let t = await text();
  assert(t.includes("24 คลิก") && t.includes("ช่วงก่อนหน้า 9") && t.includes("▲ 167%") && /คลิกล่าสุด \d\d:\d\d/.test(t), t);
  assert(fake.pages > 6, "ต้องไล่โหลดหลายหน้าจนหน้าว่าง");
  assert.equal(await page.locator("#content .chart .bar").count(), 7);
  const rows = await page.$$eval(".rows li", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
  assert(rows[0].includes("เสื้อยืดคอกลม <ผ้าฝ้าย>") && rows[0].endsWith("21"), rows[0]);
  assert(rows[1].includes("กระเป๋าผ้า") && rows[1].endsWith("2"), rows[1]);
  assert(rows[2].includes("สินค้าที่ถูกลบแล้ว") && rows[2].endsWith("1"), rows[2]);
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "clicks-app.png"), fullPage: true });

  // ค้นหา
  await page.fill("#q", "กระเป๋า");
  assert.equal(await page.locator(".rows li").count(), 1);
  assert.equal(await page.inputValue("#q"), "กระเป๋า");
  await page.fill("#q", "");

  // เว็บ/ตำแหน่ง
  await page.click("[data-tab=sites]");
  t = await text();
  assert(t.includes("Transfer · feed22") && t.includes("Transfer · detail1") && t.includes("ไม่ระบุเว็บ1"), t);

  // รายวัน แล้วแตะแท่งของวันนี้ = ดูเฉพาะวันนี้ (สินค้า 1 = 3, สินค้า 2 = 2)
  await page.click("[data-tab=days]");
  assert.equal(await page.locator("table.days tr[data-day]").count(), 7);
  await page.click("#content .chart .bar:last-child");
  t = await text();
  assert(t.includes("ดูเฉพาะ") && t.includes("(5 คลิก)") && t.includes("ชั่วโมง"), t);
  assert.equal(await page.evaluate(() => window.appBack()), true, "ปุ่มย้อนกลับล้างตัวกรองวันก่อน");
  assert.equal(await page.locator(".filter").count(), 0);
  assert.equal(await page.evaluate(() => window.appBack()), false, "ไม่มีอะไรให้ปิดแล้ว ออกจากแอปได้");

  // รายละเอียดสินค้า
  await page.click("[data-tab=products]");
  await page.click(".rows li[data-pid='1']");
  const sheet = await page.textContent("#sheet");
  assert(sheet.includes("21 คลิก") && sheet.includes("รหัสshopee 111") && sheet.includes("Transfer · feed21"), sheet);
  assert.equal(await page.locator("#sheet table.days tr").count(), 8);
  assert.equal(await page.evaluate(() => window.appBack()), true);
  assert(await page.locator("#sheet").isHidden());

  // วันนี้: กราฟรายชั่วโมง เทียบกับเมื่อวานถึงเวลาเดียวกัน
  await page.click("[data-range=today]");
  await page.waitForFunction(() => !document.querySelector("#main").classList.contains("loading") && document.querySelectorAll("#content .chart .bar").length === 24);
  t = await text();
  assert(t.includes("5 คลิก") && t.includes("ช่วงก่อนหน้า 4"), t);

  // เมื่อวาน
  await page.click("[data-range=yesterday]");
  await page.waitForFunction(() => !document.querySelector("#main").classList.contains("loading") && document.querySelector(".total").textContent.startsWith("4 "));

  // ยอดวิว transfer: ไม่มีปุ่มเมื่อวาน เริ่มที่ 7 วัน
  const idle = () => page.waitForFunction(() => !document.querySelector("#main").classList.contains("loading"));
  await page.click("[data-mode=views]");
  await page.waitForFunction(() => document.querySelector("#content .total")?.textContent.includes("ครั้งที่เปิดดู"));
  await idle();
  assert.equal(await page.textContent("#title"), "ยอดวิว transfer");
  assert.equal(await page.locator("[data-vrange=yesterday]").count(), 0);
  assert.deepEqual(fake.transferDays, [7]);
  t = await text();
  assert(t.includes("40 ครั้งที่เปิดดู") && t.includes("ผู้ชมไม่ซ้ำ 7 คน") && t.includes("เดือนก่อน 20 ▲ 50%") && t.includes("1,234"), t);
  assert.equal(await page.locator("#content .chart .bar").count(), 7);
  assert(t.includes("ประกาศย้าย ครู <สพฐ.>") && t.includes("อยู่เฉลี่ย 1 นาที 30 วินาที"), t);
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, "views-app.png"), fullPage: true });
  await page.click("[data-vtab=sources]");
  t = (await text()).replace(/\s+/g, "");
  assert(t.includes("Google3") && t.includes("LINE1") && t.includes("มือถือ3") && t.includes("กลับมาซ้ำ1"), t);
  await page.click("[data-vtab=provinces]");
  t = await text();
  assert(t.includes("กรุงเทพมหานคร") && t.includes("<เชียงใหม่>"), t);
  await page.click("[data-vtab=hours]");
  t = await text();
  assert(t.includes("ช่วง 9:00–9:59 น.") && t.includes("จันทร์"), t);
  await page.click("[data-vtab=days]");
  assert.equal(await page.locator("#content table.days tr").count(), 8);
  // วันนี้: กราฟรายชั่วโมง
  await page.click("[data-vrange=today]");
  await page.waitForFunction(() => document.querySelectorAll("#content .chart .bar").length === 24);
  await idle();
  assert.deepEqual(fake.transferDays, [7, 1]);
  // ยังไม่ได้รัน analytics.sql ของ transfer
  fake.noAnalytics = true;
  await page.click("[data-vrange='30']");
  await page.waitForFunction(() => document.querySelectorAll("#content .chart .bar").length === 30);
  await idle();
  await page.click("[data-vtab=pages]");
  assert((await text()).includes("analytics.sql"));
  // ยังไม่ได้รัน schema.sql ของ Ad Hub รุ่นใหม่
  fake.noTransferFn = true;
  await page.click("[data-act=refresh]");
  await page.waitForFunction(() => document.querySelector("#main-error").textContent.includes("hub_transfer_stats"));
  await idle();
  fake.noTransferFn = false;
  // จำโหมดไว้ตอนเปิดแอปใหม่
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#content .total")?.textContent.includes("ครั้งที่เปิดดู"));
  assert.equal(fake.transferDays.at(-1), 30);
  // กลับไปหน้าคลิก ช่วงเดิม (เมื่อวาน)
  await page.click("[data-mode=clicks]");
  await page.waitForFunction(() => document.querySelector("#content .total")?.textContent.startsWith("4 "));
  await idle();

  // token หมดอายุ: ต่ออายุเองแล้วโหลดต่อได้
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("session")); s.expires_at = 0; localStorage.setItem("session", JSON.stringify(s)); });
  await page.reload();
  await page.waitForSelector("#main:not([hidden]) .total");
  assert.equal(fake.refreshed, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("range")), '"yesterday"', "จำช่วงที่เลือกไว้");

  // ถูกตัดสิทธิ์ (401) → กลับไปหน้าล็อกอิน
  fake.token++;
  await page.click("[data-act=refresh]");
  await page.waitForSelector("#login:not([hidden])");
  assert((await page.textContent("#login [data-error]")).includes("หมดเวลา"));

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("clicks-app-e2e: ผ่านทั้งหมด");
})().catch(e => { console.error(e); process.exit(1); });
