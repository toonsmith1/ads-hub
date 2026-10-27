// ==========================================
// ชั้นข้อมูลของหน้าจัดการ: คุยกับ Supabase ทั้งหมดผ่านไฟล์นี้ไฟล์เดียว
// หน้าเว็บเรียกเฉพาะ HubAPI.* (ทดสอบได้โดยใส่ window.HubAPI ตัวปลอมก่อนโหลดไฟล์นี้)
// ==========================================
(function () {
  if (window.HubAPI) return;

  const BUCKET = "hub-images";
  const client = window.supabase && window.HUB_CONFIG?.supabaseUrl
    ? window.supabase.createClient(window.HUB_CONFIG.supabaseUrl, window.HUB_CONFIG.supabaseKey)
    : null;

  const must = ({ data, error, count }) => {
    if (error) throw new Error(error.message || String(error));
    return count === undefined || count === null ? data : { data, count };
  };

  // ค่าที่ใส่ใน or=() ของ PostgREST ต้องไม่มีเครื่องหมายคำพูด/วงเล็บ/จุลภาคหลุดเข้าไป
  // เว้นวรรคกลายเป็น * เพื่อให้ "เสื้อ คลุม" เจอ "เสื้อคลุม" ด้วย
  const cleanTerm = (q) => String(q || "").replace(/["\\(),*%]/g, " ").trim().replace(/\s+/g, "*");

  window.HubAPI = {
    configured: !!client,

    async session() {
      if (!client) return null;
      return must(await client.auth.getSession()).session;
    },
    async signIn(email, password) {
      return must(await client.auth.signInWithPassword({ email, password })).session;
    },
    async signOut() {
      await client.auth.signOut();
    },
    async isAdmin() {
      return !!must(await client.rpc("hub_is_admin"));
    },

    async categories() {
      return must(await client.from("hub_categories").select("*").order("sort").order("name"));
    },
    async saveCategory(cat) {
      const row = { name: cat.name, parent_id: cat.parent_id || null, sort: cat.sort || 0, keywords: cat.keywords || [] };
      const q = cat.id ? client.from("hub_categories").update(row).eq("id", cat.id) : client.from("hub_categories").insert(row);
      return must(await q.select().single());
    },
    async deleteCategory(id) {
      must(await client.from("hub_categories").delete().eq("id", id));
      return true;
    },
    async counts() {
      return must(await client.rpc("hub_counts"));
    },

    // f: {q, status, categoryIds (null = ทุกหมวด, [] = ไม่มีหมวด), source, minCommission, minPrice, maxPrice, sort, page, pageSize}
    async products(f) {
      let q = client.from("hub_products").select("*", { count: "exact" });
      const term = cleanTerm(f.q);
      if (term) q = q.or(["title", "shop", "note", "search_keyword"].map(c => `${c}.ilike.*${term}*`).join(","));
      if (f.status && f.status !== "all") q = q.eq("status", f.status);
      if (Array.isArray(f.categoryIds)) q = f.categoryIds.length ? q.in("category_id", f.categoryIds) : q.is("category_id", null);
      if (f.source) q = q.eq("source", f.source);
      if (f.minCommission !== "" && f.minCommission != null) q = q.gte("commission", Number(f.minCommission));
      if (f.minPrice !== "" && f.minPrice != null) q = q.gte("price", Number(f.minPrice));
      if (f.maxPrice !== "" && f.maxPrice != null) q = q.lte("price", Number(f.maxPrice));
      const order = {
        updated: ["updated_at", false], created: ["created_at", false], commission: ["commission", false],
        priceAsc: ["price", true], priceDesc: ["price", false], title: ["title", true],
      }[f.sort] || ["updated_at", false];
      q = q.order(order[0], { ascending: order[1], nullsFirst: false }).order("id", { ascending: false });
      const from = (f.page - 1) * f.pageSize;
      const { data, count } = must(await q.range(from, from + f.pageSize - 1));
      return { rows: data || [], total: count || 0 };
    },
    async sources() {
      const rows = must(await client.from("hub_products").select("source").neq("source", "").limit(1000));
      return [...new Set(rows.map(r => r.source))].sort();
    },
    async saveProduct(p) {
      const { id, created_at, updated_at, last_seen_at, ...row } = p;
      const q = id ? client.from("hub_products").update(row).eq("id", id) : client.from("hub_products").insert(row);
      return must(await q.select().single());
    },
    async updateProducts(ids, patch) {
      must(await client.from("hub_products").update(patch).in("id", ids));
      return true;
    },
    async deleteProducts(ids) {
      must(await client.from("hub_products").delete().in("id", ids));
      return true;
    },
    async importProducts(items, status) {
      return must(await client.rpc("hub_import_products", { p_items: items, p_status: status }));
    },
    async uploadImage(file) {
      const ext = ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[file.type] || "jpg";
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      must(await client.storage.from(BUCKET).upload(name, file, { contentType: file.type, upsert: false }));
      return client.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
    },
    // โฆษณาเดิมที่เว็บอื่นเก็บไว้ในตาราง site_meta (เช่น transfer เก็บที่ name = "promos")
    async legacyPromos(name) {
      const res = await client.from("site_meta").select("data").eq("name", name).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return Array.isArray(res.data?.data) ? res.data.data : [];
    },
  };
})();
