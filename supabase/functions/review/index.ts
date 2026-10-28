// ==========================================
// ร่างรีวิวสินค้าด้วย AI (แอดมินเท่านั้น) เรียกจากปุ่ม "เขียนด้วย AI" ในแผงแก้ไขสินค้า
//   POST /functions/v1/review  {id, style}  → {text, model} หรือ {error, reason} (reason: no_key, quota, failed)
//   style: payaa (ป้ายยา ค่าเริ่มต้น) honest caption story value fun ตรงกับ ReviewWriter.STYLES ในหน้าจัดการ
//   ถ้าได้ error หน้าจัดการจะสลับไปเขียนแบบสุ่ม (ป้ายยา) ให้เอง
// ตั้งคีย์และเจ้า AI ได้จากปุ่ม "ตั้งค่า AI" ในหน้าจัดการ (ตาราง hub_settings แถว 'ai')
// ถ้ายังไม่ได้ตั้งที่นั่น จะใช้ Secrets ของ Edge Functions (Supabase > Edge Functions > Secrets):
//   AI_API_KEY   คีย์ของเจ้าที่ใช้ (จำเป็น)
//   AI_PROVIDER  "anthropic" (Claude, ค่าเริ่มต้น) หรือ "openai" (เจ้าไหนก็ได้ที่ใช้รูปแบบ OpenAI: OpenAI, Gemini, DeepSeek, OpenRouter, Typhoon ฯลฯ)
//   AI_MODEL     ชื่อรุ่น (ว่าง = claude-opus-5-5 สำหรับ anthropic, ต้องใส่เองสำหรับ openai)
//   AI_BASE_URL  เฉพาะ openai: ที่อยู่ API เช่น https://generativelanguage.googleapis.com/v1beta/openai (ว่าง = OpenAI)
// ติดตั้ง: Deploy a new function > Via Editor ตั้งชื่อ "review" วางไฟล์นี้ (เปิด Verify JWT ไว้ตามค่าเริ่มต้น) ดู README
// ==========================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

function publicKey(): string {
  const own = Deno.env.get("HUB_KEY");
  if (own) return own;
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon) return anon;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0] ?? "";
  } catch {
    return "";
  }
}
const KEY = publicKey();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

type Product = {
  title: string; price_text: string; price: number | null; sold_text: string; shop: string;
  description: string; details: Record<string, unknown>;
};

// เรียก Supabase ด้วยสิทธิ์ของคนที่กดปุ่ม (RLS ตัดสินว่าเป็นแอดมินไหม)
async function asCaller(auth: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: auth, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// กติกาที่ใช้ทุกแนว (ความซื่อตรง) + โครงและน้ำเสียงของแต่ละแนว
const RULES = `- เขียนจากข้อมูลที่ให้มาเท่านั้น ห้ามแต่งตัวเลข สเปก คุณสมบัติ หรือคำชมที่ไม่มีในข้อมูล
- ห้ามอ้างว่าเคยใช้เอง ซื้อเอง หรือมีประสบการณ์ส่วนตัว ห้ามรับประกันผลลัพธ์ด้านสุขภาพหรือความงาม
- ถ้ามีราคา ให้บอกว่าราคาอาจเปลี่ยนตามโปร
- ข้อความล้วน ไม่ใช้หัวข้อ markdown ไม่ใส่ลิงก์
- ตอบเป็นตัวข้อความอย่างเดียว ไม่ต้องอธิบายเพิ่ม`;

const STYLES: Record<string, string> = {
  payaa: `สไตล์ "ป้ายยา" น้ำเสียงเป็นกันเอง กระชับ อ่านง่ายบนมือถือ ใส่อีโมจิได้เล็กน้อย
- โครง: ย่อหน้าเปิดชวนอ่าน 1-2 ประโยค, จุดเด่น 3-5 ข้อขึ้นต้นด้วย "• ", เหมาะกับใคร 1 ประโยค, ปิดด้วยชวนกดดูราคาล่าสุดที่ปุ่มด้านล่าง
- ยาวประมาณ 120-220 คำ ไม่ใส่แฮชแท็ก`,
  honest: `สไตล์รีวิวจริงจัง เป็นกลาง น่าเชื่อถือ ไม่เวอร์ ไม่ใช้อีโมจิ
- โครง: สรุปสั้นว่าสินค้าคืออะไร 1-2 ประโยค, "ข้อดี" 3-5 ข้อขึ้นต้นด้วย "• " จากข้อมูลจริง, "ควรรู้ก่อนซื้อ" 2-3 ข้อ (ข้อจำกัดที่เห็นจากข้อมูล หรือสิ่งที่ควรเช็กเช่นขนาด สเปก การรับประกัน), "เหมาะกับใคร" 1 ประโยค, ปิดด้วยดูรายละเอียดที่ปุ่มด้านล่าง
- ยาวประมาณ 150-250 คำ ไม่ใส่แฮชแท็ก`,
  caption: `สไตล์แคปชันสั้นสำหรับโพสต์โซเชียล (Facebook/IG/TikTok)
- 3-6 บรรทัดสั้นๆ ไม่เว้นย่อหน้า บรรทัดแรกดึงดูดให้หยุดเลื่อน ใส่อีโมจิได้ จุดเด่น 2-3 อย่าง ราคา และชวนกดปุ่มด้านล่าง
- ปิดด้วยแฮชแท็กภาษาไทย/อังกฤษที่เกี่ยวข้อง 3-5 อัน
- ยาวไม่เกิน 60 คำ (ไม่นับแฮชแท็ก)`,
  story: `สไตล์เล่าเรื่อง เปิดด้วยสถานการณ์ในชีวิตประจำวันที่ผู้อ่านเจอ (ใช้ "ลองนึกภาพ" หรือ "ใครเคย…") แล้วโยงว่าสินค้านี้ช่วยได้อย่างไรจากข้อมูลจริง
- ห้ามเล่าเป็นประสบการณ์ของผู้เขียนเอง ใช้มุมมองผู้อ่าน ("คุณ") แทน
- 3-4 ย่อหน้าสั้น ใส่จุดเด่นแทรกในเรื่อง ปิดด้วยชวนกดดูที่ปุ่มด้านล่าง
- ยาวประมาณ 120-200 คำ ไม่ใส่แฮชแท็ก ใส่อีโมจิได้เล็กน้อย`,
  value: `สไตล์สายคุ้มค่า เน้นราคาเทียบกับสิ่งที่ได้ ยอดขาย และคะแนนรีวิว
- โครง: เปิดด้วยราคาและคำถามว่าคุ้มไหม, "ราคานี้ได้อะไร" 3-5 ข้อขึ้นต้นด้วย "• ", ยอดขาย/คะแนนเป็นหลักฐาน, แนะนำให้เช็กโค้ดส่วนลดและโปรก่อนสั่ง, ปิดด้วยปุ่มด้านล่าง
- ห้ามเทียบกับยี่ห้อหรือร้านอื่นที่ไม่มีในข้อมูล
- ยาวประมาณ 100-180 คำ ไม่ใส่แฮชแท็ก`,
  fun: `สไตล์ภาษาวัยรุ่น ขำๆ เป็นกันเองมาก ใช้คำแสลงที่คนทั่วไปเข้าใจ อีโมจิได้พอประมาณ แต่ยังสุภาพ ไม่หยาบ
- โครง: เปิดแบบเรียกความสนใจ, จุดเด่น 3-4 ข้อขึ้นต้นด้วย "• " เขียนแบบสนุก, ราคา, ปิดชวนกดปุ่มด้านล่าง
- ยาวประมาณ 80-160 คำ ไม่ใส่แฮชแท็ก`,
};

const systemFor = (style: string) =>
  `คุณเป็นนักเขียนรีวิวสินค้าภาษาไทยที่ซื่อตรง\n${RULES}\n\nแนวการเขียนครั้งนี้: ${STYLES[style] ?? STYLES.payaa}`;

function userPrompt(p: Product, style = "payaa"): string {
  const d = p.details ?? {};
  const specs = d.specs && typeof d.specs === "object"
    ? Object.entries(d.specs as Record<string, unknown>).slice(0, 30).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";
  const facts = [
    `ชื่อสินค้า: ${p.title}`,
    (p.price_text || p.price != null) && `ราคา: ${p.price_text || `฿${p.price}`}`,
    p.sold_text && `ยอดขาย: ${p.sold_text}`,
    d.rating && `คะแนนรีวิว: ${d.rating}/5${d.rating_count ? ` จาก ${d.rating_count} รีวิว` : ""}`,
    d.brand && `แบรนด์: ${d.brand}`,
    p.shop && `ร้าน: ${p.shop}`,
    specs && `ข้อมูลจำเพาะ:\n${specs}`,
    p.description && `รายละเอียดจากหน้าสินค้า:\n${String(p.description).slice(0, 6000)}`,
  ].filter(Boolean).join("\n\n");
  return `เขียน${style === "caption" ? "แคปชันโพสต์" : "รีวิว"}สินค้านี้\n\n<ข้อมูลสินค้า>\n${facts}\n</ข้อมูลสินค้า>`;
}

class AiError extends Error {
  reason: "quota" | "failed";
  constructor(reason: "quota" | "failed", message: string) {
    super(message);
    this.reason = reason;
  }
}

// ข้อความ error ของผู้ให้บริการแบบสั้น เช่น "401: invalid x-api-key" (ตัดส่วนที่ดูเหมือนคีย์ออก)
function aiDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/^(\d{3}): ([\s\S]*)$/);
  let text = m ? m[2] : msg;
  try {
    const j = JSON.parse(text);
    text = j?.error?.message ?? j?.message ?? (typeof j?.error === "string" ? j.error : text);
  } catch { /* ไม่ใช่ JSON */ }
  text = String(text).replace(/\b(sk|key|AIza)[-_A-Za-z0-9]{8,}/g, "***").replace(/\s+/g, " ").trim().slice(0, 200);
  return m ? `${m[1]}: ${text}` : text;
}

// คีย์หมด เครดิตหมด หรือโดนจำกัดความถี่ = quota (หน้าจัดการบอกผู้ใช้ว่าใช้แบบสุ่มแทน)
function failure(status: number, body: string): AiError {
  const quota = status === 402 || status === 429 || status === 529 || /credit|quota|billing|insufficient|exceeded|rate.?limit/i.test(body);
  return new AiError(quota ? "quota" : "failed", `${status}: ${body.slice(0, 300)}`);
}

async function anthropic(key: string, model: string, system: string, prompt: string): Promise<string> {
  const call = (effort: boolean) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 4000, system,
      // งานเขียนสั้น ไม่ต้องคิดลึก ลดเวลาและโทเคน
      ...(effort ? { output_config: { effort: "low" } } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  let res = await call(true);
  let body = await res.text();
  // รุ่นที่ไม่รองรับการตั้ง effort: ลองใหม่แบบไม่ตั้ง
  if (res.status === 400 && /effort|output_config/i.test(body)) {
    res = await call(false);
    body = await res.text();
  }
  if (!res.ok) throw failure(res.status, body);
  const out = JSON.parse(body);
  if (out.stop_reason === "refusal") throw new AiError("failed", "refusal");
  return (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
}

async function openaiCompatible(key: string, model: string, base: string, system: string, prompt: string): Promise<string> {
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 2000,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw failure(res.status, body);
  const out = JSON.parse(body);
  return String(out.choices?.[0]?.message?.content ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "ใช้ POST" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  let id = 0;
  let style = "payaa";
  try {
    const body = await req.json();
    id = Number(body.id);
    if (typeof body.style === "string" && Object.hasOwn(STYLES, body.style)) style = body.style;
  } catch { /* ตรวจด้านล่าง */ }
  if (!Number.isInteger(id) || id <= 0) return json({ error: "ไม่มีรหัสสินค้า" }, 400);

  let product: Product | undefined;
  try {
    if (!(await asCaller(auth, "/rest/v1/rpc/hub_is_admin", { method: "POST", body: "{}" }))) {
      return json({ error: "เฉพาะแอดมิน" }, 403);
    }
    [product] = await asCaller(auth, `/rest/v1/hub_products?id=eq.${id}&select=title,price_text,price,sold_text,shop,description,details`);
  } catch (err) {
    console.error(err);
    return json({ error: "ตรวจสิทธิ์ไม่ได้ ลองล็อกอินใหม่" }, 401);
  }
  if (!product) return json({ error: "ไม่พบสินค้า" }, 404);

  // ค่าที่ตั้งในหน้าจัดการมาก่อน ไม่มีค่อยใช้ Secrets
  let saved: Record<string, string> = {};
  try {
    const [row] = await asCaller(auth, "/rest/v1/hub_settings?key=eq.ai&select=value");
    saved = row?.value ?? {};
  } catch (err) {
    console.error(err);   // ยังไม่ได้รัน schema ที่มีตาราง hub_settings: ใช้ Secrets
  }
  const useSaved = !!saved.api_key;
  const key = useSaved ? saved.api_key : Deno.env.get("AI_API_KEY") ?? "";
  const provider = ((useSaved ? saved.provider : Deno.env.get("AI_PROVIDER")) || "anthropic").toLowerCase();
  const model = (useSaved ? saved.model : Deno.env.get("AI_MODEL")) || (provider === "anthropic" ? "claude-opus-5-5" : "");
  const baseUrl = (useSaved ? saved.base_url : Deno.env.get("AI_BASE_URL")) || "https://api.openai.com/v1";
  if (!key || !model) return json({ error: "ยังไม่ได้ตั้งคีย์ AI (กดปุ่ม ตั้งค่า AI)", reason: "no_key" });

  try {
    const prompt = userPrompt(product, style);
    const system = systemFor(style);
    const text = provider === "anthropic"
      ? await anthropic(key, model, system, prompt)
      : await openaiCompatible(key, model, baseUrl, system, prompt);
    if (!text) throw new AiError("failed", "ได้ข้อความว่าง");
    return json({ text, model });
  } catch (err) {
    console.error("review", err);
    const reason = err instanceof AiError ? err.reason : "failed";
    // บอกสาเหตุจากผู้ให้บริการ (เช่น คีย์ผิด ชื่อรุ่นผิด) ให้แอดมินเห็นในหน้าจัดการ ไม่ต้องเปิด Logs
    return json({
      error: reason === "quota" ? "โทเคนหรือเครดิต AI หมด หรือเรียกถี่เกินไป" : "AI เขียนไม่สำเร็จ",
      reason, detail: aiDetail(err),
    });
  }
});
