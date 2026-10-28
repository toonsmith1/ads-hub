// ทดสอบหน้าจัดการส่วน "เว็บที่แสดงโฆษณา" และสถิติคลิกบนการ์ด ใน Chromium ด้วย HubAPI ตัวปลอม (tests/fake-api.js)
// รัน: node tests/admin-sites-e2e.js   (ต้องมี playwright และ chromium)
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

(async () => {
  // เสิร์ฟ web/ โดยแทรก fake-api.js ก่อน js/api.js 
  const server = await new Promise(r => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/fake-api.js") { res.writeHead(200, { "Content-Type": TYPES[".js"] }); return fs.createReadStream(path.join(ROOT, "tests/fake-api.js")).pipe(res); }
      const file = path.join(ROOT, "web", path.normalize(u.pathname === "/" ? "/index.html" : u.pathname));
      if (!file.startsWith(path.join(ROOT, "web")) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      let body = fs.readFileSync(file, "utf8");
      if (file.endsWith("index.html")) body = body.replace('<script src="js/api.js">', '<script src="/fake-api.js"></script><script src="js/api.js">');
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
      res.end(body);
    }).listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // เครื่องทดสอบออกเน็ตไม่ได้: Tailwind ตอบเป็นตัวเปล่า (หน้าไม่มีสไตล์แต่ทำงานครบ) รูปและฟอนต์ตอบว่าง
  await page.route(/^https:\/\/(cdn|fonts|img)\./, route => route.fulfill({ status: 200, contentType: "text/javascript", body: "window.tailwind = {};" }));
  await page.goto(base);
  await page.waitForSelector("article[data-act=edit]");

  // สถิติคลิกบนการ์ด (fake: รหัสคี่มีคลิก = รหัส, แสดง = รหัส × 10)
  await page.waitForFunction(() => document.body.textContent.includes("คลิก 1 · แสดง 10"));
  const firstCard = await page.$eval("article[data-id='1']", el => el.textContent);
  assert(firstCard.includes("คลิก 1 · แสดง 10"), firstCard);
  assert((await page.$eval("article[data-id='2']", el => el.textContent)).includes("ยังไม่มีคลิก"));

  // แผงแก้ไขแสดงรหัสสำหรับปักหมุดและสถิติ
  await page.click("article[data-id='3']");
  const drawer = await page.textContent("#drawer");
  assert(drawer.includes("รหัส Ad Hub #3") && drawer.includes("คลิก 3 · แสดง 30"), drawer);
  assert.equal(await page.textContent("[data-embed='product-3']"), '<div data-adhub="review" data-product="3" data-layout="review"></div>');
  // ไม่มีรูปจากหน้าสินค้า: บอกวิธีดึง
  assert(drawer.includes("รูปทั้งหมดจากหน้าสินค้า (0)") && drawer.includes("เปิดหน้าสินค้า"), drawer);
  // คำโปรยบันทึกไปกับสินค้า
  await page.fill("#drawer [data-d=caption]", "ราคา ฿350 ส่งฟรี");
  await page.click("#drawer [data-act=save-drawer]");
  await page.waitForFunction(() => window.__fake.products.find(p => p.id === 3).caption === "ราคา ฿350 ส่งฟรี");

  // สินค้าที่มีรูปทั้งหมดและรายละเอียด: เห็นรูป คะแนน ข้อมูลจำเพาะ แก้รายละเอียดและเลือกรูปปกได้
  await page.click("article[data-id='1']");
  assert.equal(await page.locator("#drawer [data-act=use-image]").count(), 3);
  const review = await page.textContent("#drawer [data-review]");
  assert(review.includes("แบรนด์ Geebeety") && review.includes("คะแนน 4.8 (1,520 รีวิว)") && review.includes("ส่งจากกรุงเทพมหานคร"), review);
  assert.equal(await page.inputValue("#drawer [data-d=description]"), "ผ้าทวิตหนา\nมี 3 สี");
  await page.fill("#drawer [data-d=description]", "ผ้าทวิตหนา ใส่สบาย");
  await page.click("#drawer [data-act=use-image][data-url$='g2.png']");
  assert.equal(await page.inputValue("#drawer [data-d=image_url]"), "https://img.example/g2.png");
  assert.equal(await page.inputValue("#drawer [data-d=description]"), "ผ้าทวิตหนา ใส่สบาย", "เลือกรูปแล้วข้อความที่พิมพ์ต้องไม่หาย");
  await page.click("#drawer [data-act=save-drawer]");
  await page.waitForFunction(() => window.__fake.products[0].image_url.endsWith("g2.png"));
  assert.equal(await page.evaluate(() => window.__fake.products[0].description), "ผ้าทวิตหนา ใส่สบาย");

  // ร่างรีวิว: สุ่มแบบป้ายยาจากข้อมูลจริง / AI / AI ใช้ไม่ได้ → สุ่มแทน แล้วบันทึก
  await page.waitForTimeout(300);   // รอรายการโหลดใหม่หลังบันทึก
  await page.click("article[data-id='1']");
  await page.click("#drawer [data-act=spin-review]");
  const spun = await page.inputValue("#drawer [data-d=review]");
  assert(spun.includes("4.8/5") && spun.includes("฿99") && spun.includes("ผ้าทวิตหนา ใส่สบาย") && !/[{}]/.test(spun), spun);
  await page.evaluate(() => { window.__fake.ai = "ok"; });
  await page.fill("#drawer [data-d=note]", "พิมพ์ระหว่างรอ");
  await page.click("#drawer [data-act=ai-review]");
  await page.waitForFunction(() => document.querySelector("#drawer [data-d=review]").value === "รีวิว AI ของ #1");
  assert.equal(await page.inputValue("#drawer [data-d=note]"), "พิมพ์ระหว่างรอ");
  await page.evaluate(() => { window.__fake.ai = "quota"; });
  await page.click("#drawer [data-act=ai-review]");
  await page.waitForFunction(() => document.querySelector("#drawer [data-d=review]").value.includes("4.8/5"));
  assert((await page.textContent("#toasts")).includes("โทเคนหมด จึงสุ่มแบบป้ายยาให้แทน"));
  await page.fill("#drawer [data-d=review]", "รีวิวที่แก้แล้ว");
  await page.click("#drawer [data-act=save-drawer]");
  await page.waitForFunction(() => window.__fake.products[0].review === "รีวิวที่แก้แล้ว");
  assert.equal(await page.evaluate(() => "_writing" in window.__fake.products[0]), false);

  // เปิดหน้าต่างเว็บ: เห็นเว็บเดิม จุดที่วาง ชื่อสินค้าที่ปักหมุด และโค้ดฝัง
  await page.click("[data-act=open-sites]");
  await page.waitForSelector("[data-site-row][data-id='1']");
  const embed = await page.textContent("[data-embed='1']");
  assert.equal(embed, `<script src="${base}ads.js?site=transfer" async></script>\n<div data-adhub="feed"></div>`);
  const pinLine = await page.textContent("[data-pl-row][data-id='1']");
  assert(pinLine.includes("#3 กางเกง UNIQLO"), pinLine);

  // เพิ่มจุดที่วาง "detail": 1 ชิ้น หมวดคอมพิวเตอร์ ปักหมุด #5, #2
  const newRow = page.locator("[data-site-row][data-id='1'] [data-pl-row][data-id='']");
  await newRow.locator("[data-pl=key]").fill("Detail");
  await newRow.locator("[data-pl=label]").fill("หน้ารายละเอียด");
  await newRow.locator("[data-pl=slots]").fill("1");
  await newRow.locator("[data-pl=positions]").fill("");
  await newRow.locator("[data-pl=pinned_ids]").fill("#5, 2 5");
  await newRow.locator("[data-pl-cats] summary").click();
  await newRow.locator("[data-pl-cats] input[value='3']").check();
  await newRow.locator("[data-act=save-placement]").click();
  await page.waitForFunction(() => window.__fake.placements.length === 2);
  const added = await page.evaluate(() => window.__fake.placements[1]);
  assert.deepEqual(
    { key: added.key, label: added.label, slots: added.slots, positions: added.positions, pinned: added.pinned_ids, cats: added.category_ids, enabled: added.enabled },
    { key: "detail", label: "หน้ารายละเอียด", slots: 1, positions: [], pinned: [5, 2], cats: [3], enabled: true });
  await page.waitForFunction(() => document.querySelector("[data-embed='1']").textContent.includes('data-adhub="detail"'));

  // ปิดจุด feed และแก้ตำแหน่ง
  const feedRow = page.locator("[data-pl-row][data-id='1']");
  await feedRow.locator("[data-pl=positions]").fill("10, 3, 3");
  await feedRow.locator("[data-pl=enabled]").uncheck();
  await feedRow.locator("[data-act=save-placement]").click();
  await page.waitForFunction(() => window.__fake.placements[0].enabled === false);
  assert.deepEqual(await page.evaluate(() => window.__fake.placements[0].positions), [3, 10]);
  // รอหน้าต่างวาดใหม่หลังบันทึก ก่อนกรอกช่องอื่น
  await page.waitForFunction(() => document.querySelector("[data-pl-row][data-id='1'] [data-pl=positions]").value === "3, 10");

  // คีย์ผิดรูปแบบไม่ถูกบันทึก
  const addSite = page.locator("[data-site-row][data-id='']");
  await addSite.locator("[data-s=name]").fill("บล็อก");
  await addSite.locator("[data-s=key]").fill("my blog");
  await addSite.locator("[data-act=save-site]").click();
  await page.waitForSelector("#toasts .bg-rose-600");
  assert.equal(await page.evaluate(() => window.__fake.sites.length), 1);

  // เพิ่มเว็บใหม่ แล้วลบ
  await addSite.locator("[data-s=key]").fill("Blog");
  await addSite.locator("[data-act=save-site]").click();
  await page.waitForFunction(() => window.__fake.sites.length === 2);
  assert.equal(await page.evaluate(() => window.__fake.sites[1].key), "blog");
  const blogId = await page.evaluate(() => window.__fake.sites[1].id);
  page.once("dialog", d => d.accept());
  await page.click(`[data-act=delete-site][data-id='${blogId}']`);
  await page.waitForFunction(() => window.__fake.sites.length === 1);

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("admin-sites-e2e: ผ่านทั้งหมด");
})().catch(err => { console.error(err); process.exit(1); });
