// ==========================================
// ลิงก์ /go/<รหัสสินค้า>?s=<คีย์เว็บ>&p=<จุดที่วาง>
// บันทึกคลิก (rpc hub_go) แล้วส่งต่อไปลิงก์ affiliate ทันที
// ติดตั้ง: Supabase > Edge Functions > Deploy a new function > Via Editor ตั้งชื่อ "go" วางไฟล์นี้
//          แล้วปิด "Verify JWT" ของฟังก์ชันนี้ (คนที่กดโฆษณาไม่ได้ล็อกอิน) ดู README
// ==========================================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// คีย์สาธารณะพอ เพราะ hub_go เปิดให้ anon เรียกได้ ลองชื่อเก่า (anon) ก่อน แล้วค่อยคีย์แบบใหม่ (publishable)
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

// บอทที่มาเปิดดูตัวอย่างลิงก์ (แชร์ในแชต/โซเชียล) ส่งต่อให้ แต่ไม่นับเป็นคลิก
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|line\/|discord|telegram|curl|wget|python|headless/i;

function notFound(): Response {
  const home = Deno.env.get("HUB_FALLBACK_URL");
  if (home) return Response.redirect(home, 302);
  return new Response("ไม่พบสินค้านี้แล้ว", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
  if (!/^\d{1,15}$/.test(id)) return notFound();

  const log = req.method === "GET" && !BOT.test(req.headers.get("user-agent") ?? "");
  const headers: Record<string, string> = { apikey: KEY, "Content-Type": "application/json" };
  if (!KEY.startsWith("sb_")) headers.Authorization = `Bearer ${KEY}`;

  let link: unknown = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hub_go`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_id: Number(id),
        p_site: (url.searchParams.get("s") ?? "").slice(0, 40),
        p_placement: (url.searchParams.get("p") ?? "").slice(0, 40),
        p_log: log,
      }),
    });
    if (res.ok) link = await res.json();
    else console.error("hub_go", res.status, await res.text());
  } catch (err) {
    console.error("hub_go", err);
  }

  if (typeof link !== "string" || !/^https?:\/\//i.test(link)) return notFound();
  return new Response(null, {
    status: 302,
    headers: { Location: link, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
});
