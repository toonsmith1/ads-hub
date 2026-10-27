// ทดสอบ extension ทั้งชุดใน Chromium จริง: หน้า Shopee ปลอม + Supabase ปลอม
// รัน: xvfb-run -a node tests/extension-e2e.js   (ต้องมี playwright และ chromium)
// ไม่ใช้ headless เพราะ service worker ของ extension ไม่ขึ้นในโหมดนั้น
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");

const EXT = path.resolve(__dirname, "../extension");
const SHOPEE = "https://affiliate.shopee.co.th/offer/product_offer?keyword=" + encodeURIComponent("เสื้อคลุม");

// --- Supabase ปลอม: auth + rpc ที่ hub-service เรียก ---
const calls = [];
let tokenSeq = 0;
function fakeSupabase() {
  const server = http.createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "apikey, authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      const url = new URL(req.url, "http://x");
      calls.push({ path: url.pathname, grant: url.searchParams.get("grant_type"), auth: req.headers.authorization, apikey: req.headers.apikey, body: json });
      const send = (status, data) => { res.writeHead(status, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
      if (req.headers.apikey !== "sb_publishable_test") return send(401, { message: "bad apikey" });
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "password" && json.password !== "pw") return send(400, { error_description: "Invalid login credentials" });
        tokenSeq++;
        // อายุสั้นกว่า 60 วิ ให้ hub-service ต้องต่ออายุก่อนส่งทุกครั้ง
        return send(200, { access_token: "at" + tokenSeq, refresh_token: "rt" + tokenSeq, expires_in: 30, user: { email: "admin@example.com" } });
      }
      if (url.pathname === "/rest/v1/rpc/hub_is_admin") return send(200, true);
      if (url.pathname === "/rest/v1/rpc/hub_import_products") {
        const items = json.p_items || [];
        return send(200, { added: items.length, updated: 0, skipped: 0, errors: [] });
      }
      send(404, { message: "not found" });
    });
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

// --- หน้าข้อเสนอสินค้า Affiliate ปลอม (โครงเดียวกับที่ตัวดึงมองหา) ---
const PRODUCTS = [
  { id: "2233445566", name: "เสื้อคลุมทวิต สไตล์เกาหลี", price: "฿259", comm: "10%", short: "https://s.shopee.co.th/aaa111" },
  { id: "3344556677", name: "เสื้อคลุมไหมพรม oversize", price: "1,290", comm: "7%", short: "https://s.shopee.co.th/bbb222" },
  // ปุ่มรับลิงก์ไม่ตอบสนอง: ตัวดึงจะได้ลิงก์หน้าสินค้าในพอร์ทัลแทน ซึ่งเอาไปลงโฆษณาไม่ได้
  { id: "4455667788", name: "เสื้อคลุมกันหนาว ขนแกะ", price: "฿599", comm: "5%", short: "" },
];
function shopeeHtml() {
  const cards = PRODUCTS.map(p => `
    <div class="product-offer-item">
      <a href="https://affiliate.shopee.co.th/offer/product_offer/${p.id}">
        <div class="ItemCard__image"><img src="https://down-th.img.susercontent.com/file/${p.id}@resize_w200"></div>
        <div class="ItemCard__name">${p.name}</div>
      </a>
      <div class="ItemCard__price"><span class="price">${p.price}</span></div>
      <div class="ItemCardSold__wrap"><span>ขายแล้ว 1พัน+ ชิ้น</span></div>
      <div class="commRate">${p.comm}</div>
      <button class="AffiliateItemCard__getlinkBtn" data-short="${p.short}">รับลิงก์</button>
    </div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Product Offer</title></head><body>
    <input type="text" id="search" value="เสื้อคลุม">
    <div class="product-offer-list">${cards}</div>
    <script>
      document.addEventListener('click', e => {
        const b = e.target.closest('.AffiliateItemCard__getlinkBtn');
        if (!b || !b.dataset.short) return;
        const m = document.createElement('div');
        m.className = 'ant-modal-root';
        m.innerHTML = '<input value="' + b.dataset.short + '"><button class="ant-modal-close">x</button>';
        m.querySelector('.ant-modal-close').onclick = () => m.remove();
        document.body.appendChild(m);
      });
    </script></body></html>`;
}

const step = (msg) => console.log("✓ " + msg);

(async () => {
  const server = await fakeSupabase();
  const hubUrl = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adhub-ext-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const consoleErrors = [];
  ctx.on("page", p => p.on("pageerror", e => consoleErrors.push(`${p.url()}: ${e.message}`)));

  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    step(`service worker ขึ้น (importScripts hub-service ผ่าน) id=${extId}`);
    assert.strictEqual(await sw.evaluate(() => typeof HubService), "object");

    await ctx.route("https://affiliate.shopee.co.th/**", route =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: shopeeHtml() }));
    // รูปปลอม ไม่ต้องออกเน็ต
    await ctx.route("https://down-th.img.susercontent.com/**", route => route.fulfill({ status: 404, body: "" }));

    // 1) ยังไม่เชื่อม: กดปุ่มบนหน้า Shopee แล้วต้องเปิดแดชบอร์ดที่แท็บ Ad Hub
    const shop = await ctx.newPage();
    shop.on("pageerror", e => consoleErrors.push(`shopee: ${e.message}`));
    await shop.goto(SHOPEE);
    await shop.waitForSelector("#shopee-dl-float-btn", { timeout: 10000 });
    assert.strictEqual((await shop.textContent("#shopee-dl-badge")).trim(), "3");
    step("content script ขึ้นบนหน้า Shopee เจอสินค้า 3 รายการ");
    await shop.click("#shopee-dl-float-btn");
    await shop.waitForSelector("#dl-hub-btn");
    const dashPromise = ctx.waitForEvent("page");
    await shop.click("#dl-hub-btn");
    const dash = await dashPromise;
    await dash.waitForLoadState();
    assert.ok(dash.url().endsWith("/dashboard/dashboard.html#tab-adhub"), dash.url());
    await dash.waitForSelector("#tab-adhub.active", { timeout: 5000 });
    assert.strictEqual((await dash.textContent("#adhub-nav-badge")).trim(), "ปิด");
    assert.ok(await dash.isVisible("#adhub-form"));
    step("ยังไม่เชื่อม: ปุ่มส่งเข้าคลังเปิดแดชบอร์ดที่แท็บ Ad Hub พร้อมฟอร์มเชื่อมต่อ");

    // 2) รหัสผิดต้องแจ้ง และไม่บันทึกการเชื่อม
    await dash.fill("#adhub-input-url", hubUrl + "/");
    await dash.fill("#adhub-input-key", "sb_publishable_test");
    await dash.fill("#adhub-input-email", "admin@example.com");
    await dash.fill("#adhub-input-password", "wrong");
    await dash.click("#adhub-connect");
    await dash.waitForFunction(() => document.getElementById("adhub-message").textContent.includes("ไม่สำเร็จ"));
    assert.match(await dash.textContent("#adhub-message"), /Invalid login credentials/);
    assert.strictEqual(await sw.evaluate(() => HubService.status().then(s => s.connected)), false);
    step("รหัสผ่านผิด: แสดงข้อความจาก Supabase และไม่เชื่อม");

    // 3) เชื่อมสำเร็จ ไม่เก็บรหัสผ่าน
    await dash.fill("#adhub-input-password", "pw");
    await dash.click("#adhub-connect");
    await dash.waitForSelector("#adhub-connected", { state: "visible" });
    assert.strictEqual((await dash.textContent("#adhub-nav-badge")).trim(), "เชื่อมแล้ว");
    assert.strictEqual((await dash.textContent("#adhub-email")).trim(), "admin@example.com");
    assert.strictEqual((await dash.textContent("#adhub-url")).trim(), hubUrl);
    assert.strictEqual(await dash.inputValue("#adhub-input-password"), "");
    const stored = await sw.evaluate(() => new Promise(r => chrome.storage.local.get(null, r)));
    assert.ok(!JSON.stringify(stored).includes('"pw"'), "ห้ามเก็บรหัสผ่าน");
    step("เชื่อมสำเร็จ: badge เปลี่ยน, ตัด / ท้าย URL, ไม่เก็บรหัสผ่าน");

    // 4) ส่งจากหน้า Shopee
    calls.length = 0;
    await shop.bringToFront();
    await shop.selectOption("#dl-delay-select", { index: 0 }).catch(() => {});
    await shop.click("#dl-hub-btn");
    await shop.waitForFunction(() => /ส่งเข้าคลังแล้ว|ไม่สำเร็จ/.test(document.getElementById("dl-status").textContent), null, { timeout: 30000 });
    const status = (await shop.textContent("#dl-status")).trim();
    console.log("  สถานะบนแผง:", status);
    const imports = calls.filter(c => c.path === "/rest/v1/rpc/hub_import_products");
    assert.strictEqual(imports.length, 1);
    const sent = imports[0].body.p_items;
    console.log("  ส่งไป:", JSON.stringify(sent.map(i => [i.title, i.link, i.source, i.source_id, i.price, i.commission])));
    assert.ok(calls.some(c => c.grant === "refresh_token"), "token อายุสั้นต้องถูกต่ออายุก่อนส่ง");
    assert.strictEqual(imports[0].auth, `Bearer at${tokenSeq}`);
    assert.strictEqual(imports[0].body.p_status, "pending");
    const first = sent.find(i => i.source_id === "2233445566");
    assert.deepStrictEqual(
      { link: first.link, source: first.source, price: first.price, price_text: first.price_text, commission: first.commission, search_keyword: first.search_keyword },
      { link: "https://s.shopee.co.th/aaa111", source: "shopee", price: "259", price_text: "฿259", commission: "10", search_keyword: "เสื้อคลุม" });
    assert.strictEqual(sent.find(i => i.source_id === "3344556677").price, "1290");
    assert.ok(!sent.some(i => i.source_id === "4455667788"), "สินค้าที่เอาลิงก์ affiliate ไม่ได้ต้องถูกข้าม ไม่ใช่ส่งลิงก์พอร์ทัลเข้าคลัง");
    assert.match(status, /ใหม่ 2 · อัปเดตของเดิม 0 · ข้าม 1/);
    step("ส่งจากหน้า Shopee: ต่ออายุ token, ส่ง 2 รายการ, ข้ามรายการที่ไม่มีลิงก์ affiliate");

    // 5) บันทึกลงแดชบอร์ดในเครื่องด้วย แล้วส่งทั้งหมดจากแดชบอร์ด
    const local = await sw.evaluate(() => new Promise(r => chrome.storage.local.get(["shopee_products"], x => r(x.shopee_products || []))));
    assert.strictEqual(local.length, 3);
    calls.length = 0;
    await dash.bringToFront();
    await dash.reload();
    await dash.click('[data-tab="tab-adhub"]');
    await dash.click("#adhub-send-all");
    await dash.waitForFunction(() => /ส่งแล้ว|ไม่สำเร็จ/.test(document.getElementById("adhub-send-result").textContent));
    assert.match(await dash.textContent("#adhub-send-result"), /ส่งแล้ว: ใหม่ 2 · อัปเดตของเดิม 0 · ข้าม 1/);
    step("ปุ่มส่งทั้งหมดในแดชบอร์ดส่งสินค้าที่บันทึกไว้ได้");

    // 6) ตัดการเชื่อม: เก็บ URL/คีย์ไว้กรอกใหม่ แต่ลบ session
    await dash.click("#adhub-disconnect");
    await dash.waitForSelector("#adhub-form", { state: "visible" });
    assert.strictEqual(await dash.inputValue("#adhub-input-url"), hubUrl);
    const cfg = await sw.evaluate(() => new Promise(r => chrome.storage.local.get(["hub_config"], x => r(x.hub_config))));
    assert.ok(!cfg.session);
    step("ตัดการเชื่อม: ลบ session เก็บ URL กับคีย์ไว้");

    assert.deepStrictEqual(consoleErrors, []);
    step("ไม่มี JS error บนหน้าใดเลย");
    console.log("\nผ่านทั้งหมด");
  } finally {
    await ctx.close();
    server.close();
  }
})().catch(err => { console.error("\n✗", err); process.exit(1); });
