// ทดสอบ web/ads.js ใน Chromium: เว็บปลายทางปลอม + Supabase ปลอม
// รัน: node tests/ads-e2e.js   (ต้องมี playwright และ chromium)
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");

const WEB = path.resolve(__dirname, "../web");
const calls = [];
let down = false;
const products = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, title: `สินค้า ${i + 1} <b>`, price: 100 + i, price_text: i % 2 ? `฿${100 + i}` : "", sold_text: "", shop: i === 0 ? "ร้านเอ" : "", source: "shopee",
  image_url: `https://img.example/${i + 1}.png`,
}));

function listen(handler) {
  return new Promise(r => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => r(s)); });
}

(async () => {
  // Supabase ปลอม: hub_ads คืนสินค้าที่ไม่อยู่ใน p_exclude ตามจำนวนที่ขอ, hub_log_views จดไว้
  const api = await listen((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      calls.push({ path: req.url, apikey: req.headers.apikey, auth: req.headers.authorization, body: json });
      if (down) { res.writeHead(503, cors); return res.end("down"); }
      if (req.url === "/rest/v1/rpc/hub_ads") {
        const slots = { feed: 3, detail: 1 }[json.p_placement];
        // สินค้าที่ขอตามรหัสขึ้นก่อน (ตัวจริงทำใน hub_ads)
        const pool = [...json.p_products.map(id => products.find(p => p.id === id)), ...products.filter(p => !json.p_products.includes(p.id))];
        const out = slots ? { placement: { key: json.p_placement, slots, positions: [2, 6] }, ads: pool.filter(p => !json.p_exclude.includes(p.id)).slice(0, json.p_count || slots) } : { placement: null, ads: [] };
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        return res.end(JSON.stringify(out));
      }
      res.writeHead(204, cors);
      res.end();
    });
  });
  const apiUrl = `http://127.0.0.1:${api.address().port}`;

  // เว็บ Ad Hub (เสิร์ฟ web/) + เว็บปลายทางที่ฝังสคริปต์ คนละพอร์ต = คนละ origin
  const hub = await listen((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/config.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(`window.HUB_CONFIG = { supabaseUrl: "${apiUrl}", supabaseKey: "sb_publishable_test" };`);
    }
    const file = path.join(WEB, path.normalize(u.pathname));
    if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/javascript" });
    fs.createReadStream(file).pipe(res);
  });
  const hubUrl = `http://127.0.0.1:${hub.address().port}`;
  const site = await listen((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0">
      <div id="feed" data-adhub="feed" data-context="ครู"></div>
      <div id="detail" data-adhub="detail"></div>
      <div id="none" data-adhub="nosuch"></div>
      <div id="review" data-adhub="detail" data-product="8"></div>
      <div style="height:3000px"></div>
      <script src="${hubUrl}/ads.js?site=Transfer" async></script></body>`);
  });
  const siteUrl = `http://127.0.0.1:${site.address().port}/`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));

  await page.goto(siteUrl);
  await page.waitForSelector("#detail .adhub-card");

  // วาดการ์ดครบ ไม่ซ้ำกันระหว่างช่อง ลิงก์ไปที่ /go/ ของ Supabase พร้อมคีย์เว็บและจุดที่วาง
  const feed = await page.$$eval("#feed .adhub-card", els => els.map(e => ({ id: e.dataset.adhubId, href: e.href, rel: e.rel, target: e.target, title: e.querySelector(".adhub-title").textContent })));
  const detail = await page.$$eval("#detail .adhub-card", els => els.map(e => e.dataset.adhubId));
  assert.deepEqual(feed.map(f => f.id), ["1", "2", "3"]);
  assert.deepEqual(detail, ["4"], "ช่องที่สองต้องไม่ซ้ำกับช่องแรก");
  await page.waitForSelector("#review .adhub-card");
  assert.deepEqual(await page.$$eval("#review .adhub-card", els => els.map(e => e.dataset.adhubId)), ["8"], "data-product ต้องได้ชิ้นที่ขอ");
  assert.equal(feed[0].href, `${apiUrl}/functions/v1/go/1?s=transfer&p=feed`);
  assert.equal(feed[0].rel, "sponsored noopener");
  assert.equal(feed[0].target, "_blank");
  assert.equal(feed[0].title, "สินค้า 1 <b>", "ชื่อสินค้าต้องแสดงเป็นข้อความ ไม่ใช่ HTML");
  assert.equal(await page.$eval("#none", el => el.innerHTML), "", "จุดที่ไม่มีต้องว่าง");

  const adsCalls = calls.filter(c => c.path === "/rest/v1/rpc/hub_ads");
  assert.deepEqual(adsCalls[0].body, { p_site: "transfer", p_placement: "feed", p_context: "ครู", p_count: null, p_exclude: [], p_products: [] });
  assert.deepEqual(adsCalls.find(c => c.body.p_products.length).body.p_products, [8]);
  assert.deepEqual(adsCalls[1].body.p_exclude, [1, 2, 3]);
  assert.equal(adsCalls[0].apikey, "sb_publishable_test");
  assert.equal(adsCalls[0].auth, undefined, "คีย์แบบใหม่ไม่ส่งเป็น Bearer");

  // นับการแสดงเป็นชุดเดียวต่อจุดที่วาง (การ์ดทั้งหมดอยู่ในจอ)
  await new Promise(r => setTimeout(r, 2200));
  const views = calls.filter(c => c.path === "/rest/v1/rpc/hub_log_views");
  assert.deepEqual(views.map(v => [v.body.p_placement, v.body.p_ids]).sort(), [["detail", [4, 8]], ["feed", [1, 2, 3]]]);
  assert(views.every(v => v.body.p_site === "transfer"));

  // ใช้ดึงข้อมูลไปวาดเองได้ และ observe() นับการแสดงของการ์ดที่วาดเอง
  const custom = await page.evaluate(async () => {
    const out = await AdHub.load({ placement: "feed", count: 2 });
    const box = document.createElement("div");
    box.innerHTML = out.ads.map(a => `<a data-adhub-id="${a.id}" data-adhub-placement="${a.placement}" href="${a.href}">${a.title}</a>`).join("");
    document.body.prepend(box);
    AdHub.observe(box);
    return { positions: out.placement.positions, ids: out.ads.map(a => a.id) };
  });
  assert.deepEqual(custom, { positions: [2, 6], ids: [5, 6] });
  const picked = await page.evaluate(async () => (await AdHub.load({ placement: "detail", product: "7, x, 7" })).ads.map(a => a.id));
  assert.deepEqual(picked, [7]);
  await new Promise(r => setTimeout(r, 2200));
  assert.deepEqual(calls.filter(c => c.path === "/rest/v1/rpc/hub_log_views").at(-1).body.p_ids, [5, 6]);

  // คลังกลางล่ม: ใช้ผลครั้งล่าสุดที่เก็บไว้ หน้าไม่พัง
  down = true;
  await page.reload();
  await page.waitForSelector("#feed .adhub-card");
  assert.equal(await page.$$eval("#feed .adhub-card", els => els.length), 3);

  // ล่มและไม่เคยมีแคช: ไม่มีโฆษณา ไม่มี error
  const fresh = await browser.newPage();
  fresh.on("pageerror", e => errors.push(e.message));
  await fresh.goto(siteUrl);
  await fresh.waitForFunction(() => window.AdHub && document.querySelector("#none[data-adhub-done]"));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await fresh.$$eval(".adhub-card", els => els.length), 0);

  assert.deepEqual(errors, []);
  await browser.close();
  [api, hub, site].forEach(s => s.close());
  console.log("ads-e2e: ผ่านทั้งหมด");
})().catch(err => { console.error(err); process.exit(1); });
