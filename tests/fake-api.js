// HubAPI ตัวปลอมในหน่วยความจำ ใช้ทดสอบหน้าจัดการโดยไม่ต้องมี Supabase
// โหลดก่อน js/api.js แล้ว api.js จะไม่สร้างตัวจริงทับ
(function () {
  const now = () => new Date().toISOString();
  let seq = 100;
  const cats = [
    { id: 1, name: "แฟชั่นผู้หญิง", parent_id: null, sort: 10, keywords: ["เสื้อ", "กางเกง"] },
    { id: 2, name: "เสื้อคลุม", parent_id: 1, sort: 11, keywords: ["เสื้อคลุม"] },
    { id: 3, name: "คอมพิวเตอร์", parent_id: null, sort: 20, keywords: ["monitor", "จอ"] },
  ];
  const img = (n) => `https://img.example/${n}.png`;
  const products = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1, source: i % 5 === 0 ? "lazada" : "shopee", source_id: String(9000 + i),
    title: i % 3 === 0 ? `เสื้อคลุมทวิต สไตล์เกาหลี รุ่น ${i + 1}` : i % 3 === 1 ? `17.3" Portable Monitor 1080P รุ่น ${i + 1}` : `กางเกง UNIQLO EZY ไซซ์ ${i + 1}`,
    price: 99 + i * 37, price_text: `฿${(99 + i * 37).toLocaleString()}`, commission: (i % 8) + 1, sold_text: `ขายได้ ${i * 3} ชิ้น`,
    shop: i % 4 === 0 ? "Geebeety" : "", link: `https://s.shopee.co.th/x${i}`, image_url: i % 7 === 6 ? "" : img(i % 4),
    category_id: i % 3 === 0 ? 2 : i % 3 === 1 ? 3 : (i % 2 ? 1 : null), tags: [], status: ["active", "pending", "active", "paused"][i % 4],
    weight: 1, starts_on: null, ends_on: null, note: "", search_keyword: "", created_at: now(), updated_at: new Date(Date.now() - i * 3600e3).toISOString(),
  }));
  // สินค้าแรกมีรูปทั้งหมดและรายละเอียดจากหน้าสินค้า (extension ดึงมา)
  Object.assign(products[0], {
    images: [img(0), img("g2"), img("g3")], description: "ผ้าทวิตหนา\nมี 3 สี",
    details: { brand: "Geebeety", rating: 4.8, rating_count: 1520, specs: { "ส่งจาก": "กรุงเทพมหานคร" }, detail_url: "https://shopee.co.th/coat-i.1.9000" },
  });
  const legacy = [
    { type: "ad", title: "กางเกง UNIQLO แท้ (เอว 27-30)", text: "ราคา ฿350", href: "https://s.shopee.co.th/legacy1", image: img(1), sponsor: "Shopee", enabled: true },
    { type: "ad", title: "เครื่องบดสับไร้สาย", text: "ราคา ฿199", href: "https://s.shopee.co.th/legacy2", image: img(2), sponsor: "", enabled: false },
  ];
  const delay = (v) => new Promise(r => setTimeout(() => r(v), 30));

  const sites = [{ id: 1, key: "transfer", name: "ย้ายราชการ", domain: "transfer.example" }];
  const placements = [{ id: 1, site_id: 1, key: "feed", label: "แทรกในรายการ", slots: 4, positions: [2, 6, 10, 14], category_ids: [], pinned_ids: [3], enabled: true }];

  window.__fake = { products, cats, sites, placements, calls: [] };
  window.HubAPI = {
    configured: true,
    session: () => delay({ user: { email: "admin@example.com" } }),
    signIn: () => delay({}),
    signOut: () => delay(),
    isAdmin: () => delay(true),
    categories: () => delay([...cats].sort((a, b) => a.sort - b.sort)),
    async saveCategory(c) {
      if (c.id) Object.assign(cats.find(x => x.id === c.id), c);
      else cats.push({ ...c, id: ++seq });
      return delay(c);
    },
    async deleteCategory(id) {
      cats.splice(cats.findIndex(c => c.id === id), 1);
      products.forEach(p => { if (p.category_id === id) p.category_id = null; });
      return delay(true);
    },
    counts() {
      const m = new Map();
      products.forEach(p => { const k = `${p.category_id}|${p.status}`; m.set(k, (m.get(k) || 0) + 1); });
      return delay([...m].map(([k, total]) => { const [c, status] = k.split("|"); return { category_id: c === "null" ? null : Number(c), status, total }; }));
    },
    products(f) {
      window.__fake.calls.push({ ...f });
      let rows = products.filter(p => {
        const q = (f.q || "").trim().toLowerCase();
        if (q && ![p.title, p.shop, p.note].some(v => String(v).toLowerCase().includes(q))) return false;
        if (f.status && f.status !== "all" && p.status !== f.status) return false;
        if (Array.isArray(f.categoryIds) && (f.categoryIds.length ? !f.categoryIds.includes(p.category_id) : p.category_id !== null)) return false;
        if (f.source && p.source !== f.source) return false;
        if (f.minCommission !== "" && p.commission < Number(f.minCommission)) return false;
        if (f.minPrice !== "" && p.price < Number(f.minPrice)) return false;
        if (f.maxPrice !== "" && p.price > Number(f.maxPrice)) return false;
        return true;
      });
      const by = { commission: (a, b) => b.commission - a.commission, priceAsc: (a, b) => a.price - b.price, priceDesc: (a, b) => b.price - a.price, title: (a, b) => a.title.localeCompare(b.title, "th") }[f.sort]
        || ((a, b) => b.updated_at.localeCompare(a.updated_at));
      rows = rows.sort(by);
      const from = (f.page - 1) * f.pageSize;
      return delay({ rows: rows.slice(from, from + f.pageSize).map(r => ({ ...r })), total: rows.length });
    },
    sources: () => delay([...new Set(products.map(p => p.source))].sort()),
    async saveProduct(p) {
      if (p.id) Object.assign(products.find(x => x.id === p.id), p, { updated_at: now() });
      else products.push({ ...p, id: ++seq, created_at: now(), updated_at: now() });
      return delay(p);
    },
    async updateProducts(ids, patch) {
      products.forEach(p => { if (ids.includes(p.id)) Object.assign(p, patch, { updated_at: now() }); });
      return delay(true);
    },
    async deleteProducts(ids) {
      for (const id of ids) products.splice(products.findIndex(p => p.id === id), 1);
      return delay(true);
    },
    async importProducts(items, status) {
      let added = 0, updated = 0, skipped = 0; const errors = [];
      items.forEach((it, i) => {
        if (!it.title || !/^https?:/.test(it.link || "")) { skipped++; errors.push({ row: i + 1, error: "ไม่มีชื่อสินค้าหรือลิงก์" }); return; }
        const ex = products.find(p => (it.source_id ? p.source === it.source && p.source_id === it.source_id : p.link === it.link));
        if (ex) { Object.assign(ex, { price: Number(it.price) || ex.price, commission: Number(it.commission) || ex.commission }); updated++; return; }
        const cat = cats.find(c => c.name === it.category);
        products.push({ ...it, id: ++seq, price: Number(it.price) || null, commission: Number(it.commission) || null, category_id: cat ? cat.id : null, status, tags: [], weight: 1, created_at: now(), updated_at: now() });
        added++;
      });
      return delay({ added, updated, skipped, errors });
    },
    productStats: (ids) => delay(Object.fromEntries(ids.filter(id => id % 2).map(id => [id, { views: id * 10, clicks: id }]))),
    productTitles: (ids) => delay(products.filter(p => ids.includes(p.id)).map(({ id, title, status }) => ({ id, title, status }))),
    sites: () => delay(sites.map(s => ({ ...s, hub_placements: placements.filter(p => p.site_id === s.id).map(p => ({ ...p })) }))),
    async saveSite(site) {
      if (site.id) Object.assign(sites.find(x => x.id === site.id), site);
      else sites.push({ ...site, id: ++seq });
      return delay(site);
    },
    async deleteSite(id) {
      sites.splice(sites.findIndex(s => s.id === id), 1);
      for (let i = placements.length - 1; i >= 0; i--) if (placements[i].site_id === id) placements.splice(i, 1);
      return delay(true);
    },
    async savePlacement(pl) {
      if (pl.id) Object.assign(placements.find(x => x.id === pl.id), pl);
      else placements.push({ ...pl, id: ++seq });
      return delay(pl);
    },
    async deletePlacement(id) {
      placements.splice(placements.findIndex(p => p.id === id), 1);
      return delay(true);
    },
    uploadImage: () => delay(img("uploaded")),
    // window.__fake.ai: "ok" = ได้ร่างจาก AI, อย่างอื่น = เหตุผลที่ใช้ไม่ได้ (no_key, quota)
    writeReview(id) {
      window.__fake.calls.push({ writeReview: id });
      const mode = window.__fake.ai || "no_key";
      return delay(mode === "ok" ? { text: `รีวิว AI ของ #${id}`, model: "fake-model" } : { error: "โทเคนหมด", reason: mode });
    },
    // เหมือน hub_ai_settings / hub_save_ai_settings: ไม่ส่งคีย์กลับ เว้นว่าง = ใช้คีย์เดิม
    aiSettings() {
      const { api_key, ...v } = window.__fake.aiSettings || {};
      return delay(api_key ? { ...v, has_key: true, key_hint: api_key.slice(-4) } : { ...v, has_key: false });
    },
    saveAiSettings(p) {
      const old = (window.__fake.aiSettings || {}).api_key || "";
      const { clear_key, ...v } = p;
      window.__fake.aiSettings = { ...v, api_key: clear_key ? "" : (p.api_key || old) };
      return this.aiSettings();
    },
    legacyPromos: () => delay(legacy),
  };
})();
