// ทดสอบ supabase/functions/review/index.ts ด้วย Node (จำลอง Deno.serve / Deno.env, PostgREST และ API ของ AI)
// รัน: node --experimental-strip-types tests/review-test.mjs   (Node 22.6+)
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_x" }) };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

const calls = [];
console.error = () => {};   // ฟังก์ชันพิมพ์ error ที่ตั้งใจให้เกิดในเทสต์
let admin = true;
let ai = () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: " รีวิวจาก Claude " }] }));
const product = { title: "หูฟัง J", price_text: "฿199", price: 199, sold_text: "ขายแล้ว 50", shop: "ร้านเอ", description: "เสียงดี",
  details: { brand: "ABC", rating: 4.8, rating_count: 12, specs: { "สี": "ดำ" }, detail_url: "https://shopee.co.th/x" } };
globalThis.fetch = async (url, init) => {
  calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
  if (url.endsWith("/rpc/hub_is_admin")) return new Response(JSON.stringify(admin));
  if (url.includes("/rest/v1/hub_products?id=eq.5")) return new Response(JSON.stringify([product]));
  if (url.includes("/rest/v1/hub_products")) return new Response("[]");
  return ai(url);
};

const src = path.resolve(import.meta.dirname, "../supabase/functions/review/index.ts");
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "review-")), "index.ts");
fs.copyFileSync(src, tmp);
await import(tmp);
assert(handler, "ต้องเรียก Deno.serve");

const call = async (body) => {
  const res = await handler(new Request("https://proj.supabase.co/functions/v1/review", {
    method: "POST", headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json(), cors: res.headers.get("access-control-allow-origin") };
};

// ยังไม่ตั้งคีย์: บอกให้ใช้แบบสุ่ม ไม่เรียก AI
let r = await call({ id: 5 });
assert.deepEqual([r.status, r.body.reason], [200, "no_key"]);
assert.equal(r.cors, "*");
assert.equal(calls[0].headers.Authorization, "Bearer user-jwt", "ตรวจสิทธิ์ด้วย token ของคนที่กด");
assert.equal(calls[0].headers.apikey, "sb_publishable_x");

// Claude (ค่าเริ่มต้น)
env.AI_API_KEY = "sk-ant-test";
calls.length = 0;
r = await call({ id: 5 });
assert.deepEqual(r.body, { text: "รีวิวจาก Claude", model: "claude-opus-5-5" });
const a = calls.at(-1);
assert.equal(a.url, "https://api.anthropic.com/v1/messages");
assert.equal(a.headers["x-api-key"], "sk-ant-test");
assert.equal(a.headers["anthropic-version"], "2023-06-01");
assert.equal(a.body.model, "claude-opus-5-5");
assert.equal(a.body.temperature, undefined);
const prompt = a.body.messages[0].content;
for (const s of ["หูฟัง J", "฿199", "4.8/5 จาก 12 รีวิว", "แบรนด์: ABC", "- สี: ดำ", "เสียงดี"]) assert(prompt.includes(s), `prompt ต้องมี ${s}`);
assert(!prompt.includes("shopee.co.th/x"), "ไม่ส่งลิงก์หน้าสินค้าให้ AI");
assert.match(a.body.system, /ห้ามอ้างว่าเคยใช้เอง/);

// เครดิตหมด / โดนจำกัด → quota
for (const [status, text] of [[400, '{"error":{"message":"Your credit balance is too low"}}'], [429, "rate_limit_error"], [529, "overloaded"]]) {
  ai = () => new Response(text, { status });
  r = await call({ id: 5 });
  assert.equal(r.body.reason, "quota", `${status} ต้องเป็น quota`);
}
ai = () => new Response("bad model", { status: 404 });
assert.equal((await call({ id: 5 })).body.reason, "failed");
ai = () => new Response(JSON.stringify({ stop_reason: "refusal", content: [] }));
assert.equal((await call({ id: 5 })).body.reason, "failed");

// เจ้าอื่นแบบ OpenAI (เช่น Gemini)
Object.assign(env, { AI_PROVIDER: "openai", AI_MODEL: "gemini-x", AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/" });
ai = () => new Response(JSON.stringify({ choices: [{ message: { content: "รีวิวจาก Gemini" } }] }));
r = await call({ id: 5 });
assert.deepEqual(r.body, { text: "รีวิวจาก Gemini", model: "gemini-x" });
const o = calls.at(-1);
assert.equal(o.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
assert.equal(o.headers.Authorization, "Bearer sk-ant-test");
assert.equal(o.body.messages[0].role, "system");
delete env.AI_MODEL;
assert.equal((await call({ id: 5 })).body.reason, "no_key", "openai ต้องตั้งชื่อรุ่นเอง");
env.AI_MODEL = "gemini-x";

// ไม่ใช่แอดมิน / ไม่มีสินค้า / รหัสผิด
admin = false;
assert.equal((await call({ id: 5 })).status, 403);
admin = true;
assert.equal((await call({ id: 6 })).status, 404);
assert.equal((await call({ id: "x" })).status, 400);
assert.equal((await handler(new Request("https://x/functions/v1/review", { method: "OPTIONS" }))).status, 204);

console.log("review-test: ผ่านทั้งหมด");
