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
let slow = 0;   // หน่วงคำตอบ (ms) จำลองคลังกลางตอบช้า
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
    req.on("end", async () => {
      if (slow) await new Promise(r => setTimeout(r, slow));
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
      if (req.url === "/rest/v1/rpc/hub_product_info") {
        // สินค้า 5 มีรูปทั้งหมดและรายละเอียด ชิ้นอื่นไม่มี (หยุดแสดง = ไม่อยู่ในผล)
        const info = json.p_ids.filter(id => id === 5).map(id => ({
          id, images: ["https://img.example/5a.png", "https://img.example/5b.png"],
          description: "ใช้ดี <script>x</script>\nบรรทัดสอง", review: "ใช้มาเดือนนึง <b>ดีมาก</b>",
          details: { brand: "ABC", rating: 4.6, rating_count: 1234, specs: { "สี": "ดำ <i>" } },
        }));
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        return res.end(JSON.stringify(info));
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
    res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript" });
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
      <div id="full" data-adhub="detail" data-product="5" data-layout="review"></div>
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

  // กล่องรีวิว: รูปทั้งหมด กดรูปเล็กเปลี่ยนรูปใหญ่ คะแนน สเปก รายละเอียด (เป็นข้อความ ไม่ใช่ HTML) ปุ่มซื้อไปที่ /go/
  await page.waitForSelector("#full .adhub-review");
  const box = await page.$eval("#full .adhub-review", el => ({
    id: el.dataset.adhubId, main: el.querySelector(".adhub-main").src,
    thumbs: [...el.querySelectorAll(".adhub-thumb")].map(b => b.dataset.src),
    meta: el.querySelector(".adhub-meta").textContent, buy: el.querySelector(".adhub-buy").href,
    specs: el.querySelector(".adhub-specs").textContent, desc: el.querySelector(".adhub-desc:not(.adhub-text)").textContent,
    review: el.querySelector(".adhub-text").textContent,
    scripts: el.querySelectorAll("script, i, b").length,
  }));
  assert.equal(box.id, "5");
  assert.deepEqual(box.thumbs, ["https://img.example/5a.png", "https://img.example/5b.png", "https://img.example/5.png"], "รูปทั้งหมด + รูปปก ไม่ซ้ำ");
  assert.equal(box.main, "https://img.example/5a.png");
  assert.match(box.meta, /4\.6 \(1,234 รีวิว\)/);
  assert.match(box.meta, /แบรนด์ ABC/);
  assert.equal(box.buy, `${apiUrl}/functions/v1/go/5?s=transfer&p=detail`);
  assert.equal(box.specs, "สีดำ <i>");
  assert.equal(box.desc, "ใช้ดี <script>x</script>\nบรรทัดสอง");
  assert.equal(box.review, "ใช้มาเดือนนึง <b>ดีมาก</b>");
  assert.equal(box.scripts, 0, "ข้อมูลจากหน้าสินค้าต้องไม่กลายเป็น HTML");
  await page.click("#full .adhub-thumb:nth-child(2)");
  assert.equal(await page.$eval("#full .adhub-main", el => el.src), "https://img.example/5b.png");
  assert.deepEqual(await page.$$eval("#full .adhub-thumb", els => els.map(b => b.getAttribute("aria-current"))), ["false", "true", "false"]);
  const infoCalls = calls.filter(c => c.path === "/rest/v1/rpc/hub_product_info");
  assert.deepEqual(infoCalls.map(c => c.body.p_ids), [[5]], "ขอข้อมูลรีวิวเฉพาะช่องที่เป็นกล่องรีวิว");
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
  assert.deepEqual(views.map(v => [v.body.p_placement, v.body.p_ids]).sort(), [["detail", [4, 8, 5]], ["feed", [1, 2, 3]]]);
  assert(views.every(v => v.body.p_site === "transfer"));

  await page.evaluate(() => scrollTo(0, 0));   // กดรูปเล็กแล้วหน้าเลื่อนลง ให้กล่องที่จะวาดด้านบนอยู่ในจอ

  // ใช้ดึงข้อมูลไปวาดเองได้ และ observe() นับการแสดงของการ์ดที่วาดเอง
  const custom = await page.evaluate(async () => {
    const out = await AdHub.load({ placement: "feed", count: 2 });
    const box = document.createElement("div");
    box.innerHTML = out.ads.map(a => `<a data-adhub-id="${a.id}" data-adhub-placement="${a.placement}" href="${a.href}">${a.title}</a>`).join("");
    document.body.prepend(box);
    AdHub.observe(box);
    return { positions: out.placement.positions, ids: out.ads.map(a => a.id) };
  });
  assert.deepEqual(custom, { positions: [2, 6], ids: [6, 7] });
  const picked = await page.evaluate(async () => (await AdHub.load({ placement: "detail", product: "8, x, 8", allowRepeat: true })).ads.map(a => a.id));
  assert.deepEqual(picked, [8]);
  // full: ชิ้นที่ไม่มีข้อมูลรีวิวได้ค่าว่าง ไม่พัง
  const bare = await page.evaluate(async () => (await AdHub.load({ placement: "detail", product: 1, full: true, allowRepeat: true })).ads[0]);
  assert.deepEqual([bare.id, bare.images, bare.description, bare.review, bare.details], [1, [], "", "", {}]);
  await new Promise(r => setTimeout(r, 2200));
  assert.deepEqual(calls.filter(c => c.path === "/rest/v1/rpc/hub_log_views").at(-1).body.p_ids, [6, 7]);

  // หน้ารีวิวตัวอย่าง web/review.html: กล่องรีวิวของชิ้นที่ขอ + สินค้าที่คล้ายกัน ชื่อหน้าเป็นชื่อสินค้า
  const rv = await browser.newPage();
  rv.on("pageerror", e => errors.push(e.message));
  await rv.goto(`${hubUrl}/review.html?site=transfer&id=5&placement=detail`);
  await rv.waitForSelector("#related .adhub-card");
  assert.equal(await rv.$eval("#review .adhub-review", el => el.dataset.adhubId), "5");
  assert.deepEqual(await rv.$$eval("#related .adhub-card", els => els.map(e => e.dataset.adhubId)), ["1", "2", "3", "4"]);
  assert.equal(await rv.title(), "รีวิว สินค้า 5 <b>");
  assert.equal(await rv.$eval('meta[name="description"]', m => m.content), "ใช้มาเดือนนึง <b>ดีมาก</b>");
  await rv.goto(`${hubUrl}/review.html?site=transfer`);
  assert.match(await rv.textContent("#review"), /ใส่ \?site=/);
  await rv.close();

  // เปิดซ้ำ: วาดจากแคชทันทีไม่รอคลังกลางที่ตอบช้า แล้วยังดึงของใหม่เบื้องหลัง
  slow = 3000;
  const before = calls.length;
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector("#feed .adhub-card");
  await page.waitForSelector("#detail .adhub-card");
  assert(Date.now() - t0 < 2000, `ต้องวาดจากแคชทันที (ใช้ ${Date.now() - t0}ms)`);
  await new Promise(r => setTimeout(r, 3500));
  assert(calls.slice(before).some(c => c.path === "/rest/v1/rpc/hub_ads"), "ต้องดึงของใหม่เบื้องหลัง");
  slow = 0;

  // แคชเก่าเกินวัน: รอคลังกลางเหมือนเดิม
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("adhub:")).forEach(k => {
    const v = JSON.parse(localStorage.getItem(k)); v.at -= 25 * 36e5; localStorage.setItem(k, JSON.stringify(v));
  }));
  const beforeOld = calls.length;
  await page.reload();
  await page.waitForSelector("#feed .adhub-card");
  assert(calls.slice(beforeOld).some(c => c.path === "/rest/v1/rpc/hub_ads"));

  // คลังกลางล่ม: ใช้ผลครั้งล่าสุดที่เก็บไว้ หน้าไม่พัง
  down = true;
  await page.reload();
  await page.waitForSelector("#feed .adhub-card");
  assert.equal(await page.$$eval("#feed .adhub-card", els => els.length), 3);
  await page.waitForSelector("#full .adhub-review .adhub-specs");

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
