// ทดสอบ supabase/functions/go/index.ts ด้วย Node (จำลอง Deno.serve / Deno.env และ PostgREST)
// รัน: node --experimental-strip-types tests/go-test.mjs   (Node 22.6+)
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_x" }) };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

const calls = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, headers: init.headers, body });
  const links = { 1: "https://s.shopee.co.th/abc", 2: "javascript:alert(1)" };
  return new Response(JSON.stringify(links[body.p_id] ?? null), { status: 200 });
};

// Node ไม่ยอม strip type จากไฟล์ใน node_modules หรือไม่มีนามสกุล .ts จึงคัดลอกไปไว้ที่ชั่วคราวก่อน
const src = path.resolve(import.meta.dirname, "../supabase/functions/go/index.ts");
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "go-")), "index.ts");
fs.copyFileSync(src, tmp);
await import(tmp);
assert(handler, "ต้องเรียก Deno.serve");

const ua = { "user-agent": "Mozilla/5.0 (iPhone)" };
let res = await handler(new Request("https://proj.supabase.co/functions/v1/go/1?s=transfer&p=feed", { headers: ua }));
assert.equal(res.status, 302);
assert.equal(res.headers.get("location"), "https://s.shopee.co.th/abc");
assert.equal(calls[0].url, "https://proj.supabase.co/rest/v1/rpc/hub_go");
assert.deepEqual(calls[0].body, { p_id: 1, p_site: "transfer", p_placement: "feed", p_log: true });
assert.equal(calls[0].headers.apikey, "sb_publishable_x");
assert.equal(calls[0].headers.Authorization, undefined, "คีย์แบบใหม่ไม่ใช่ JWT ห้ามส่งเป็น Bearer");

// บอทพรีวิวลิงก์: ส่งต่อแต่ไม่นับ
res = await handler(new Request("https://x/functions/v1/go/1", { headers: { "user-agent": "facebookexternalhit/1.1" } }));
assert.equal(res.status, 302);
assert.equal(calls.at(-1).body.p_log, false);

// รหัสไม่ถูก ไม่มีสินค้า หรือลิงก์ไม่ใช่ http: ไม่ส่งต่อ
const before = calls.length;
assert.equal((await handler(new Request("https://x/functions/v1/go/abc", { headers: ua }))).status, 404);
assert.equal(calls.length, before, "รหัสไม่ใช่ตัวเลขไม่ต้องเรียกฐานข้อมูล");
assert.equal((await handler(new Request("https://x/functions/v1/go/99", { headers: ua }))).status, 404);
assert.equal((await handler(new Request("https://x/functions/v1/go/2", { headers: ua }))).status, 404);

// ตั้งหน้าสำรองไว้: ไปหน้านั้นแทน 404
env.HUB_FALLBACK_URL = "https://transfer.example/";
res = await handler(new Request("https://x/functions/v1/go/99", { headers: ua }));
assert.equal(res.status, 302);
assert.equal(res.headers.get("location"), "https://transfer.example/");

console.log("go-test: ผ่านทั้งหมด");
