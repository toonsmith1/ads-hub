// ==========================================
// Ad Hub: สคริปต์ฝังโฆษณาจากคลังกลาง ใช้ได้กับเว็บไหนก็ได้
//
//   <script src="https://<เว็บ Ad Hub>/ads.js?site=<คีย์เว็บ>" async></script>
//   <div data-adhub="feed"></div>                       ← วาดการ์ดให้เอง
//   <div data-adhub="detail" data-context="ครู"></div>  ← ส่งคำบอกบริบทของหน้าได้
//   <div data-adhub="review" data-product="12"></div>   ← ขอสินค้าตามรหัส (เช่นหน้ารีวิว)
//
// หรือดึงข้อมูลไปวาดเองด้วย AdHub.load() แล้วเรียก AdHub.observe() เพื่อนับการแสดง (ดู README)
// ลิงก์บนการ์ดชี้ไปที่ /go/<id> ซึ่งนับคลิกแล้วส่งต่อไปลิงก์ affiliate
// ถ้าคลังกลางล่ม ใช้ผลครั้งล่าสุดที่เก็บไว้ในเครื่อง ถ้าไม่มีก็แค่ไม่มีโฆษณา หน้าเว็บไม่พัง
// ==========================================
(function () {
  if (window.AdHub) return;

  const me = document.currentScript;
  const src = me && me.src ? new URL(me.src, location.href) : null;
  const ds = (me && me.dataset) || {};
  const site = String(ds.site || (src && src.searchParams.get("site")) || "").trim().toLowerCase();
  const TIMEOUT_MS = 4000;
  const CACHE_DAYS = 7;
  const shown = new Set();   // ไม่ให้สินค้าชิ้นเดียวกันขึ้นซ้ำในหน้าเดียว

  // ---------- ค่าเชื่อมต่อ: data-url/data-key บนแท็ก > HUB_CONFIG ที่มีอยู่แล้ว > config.js ข้างไฟล์นี้ ----------
  let configPromise;
  function config() {
    return (configPromise ||= new Promise((resolve) => {
      const done = () => {
        const c = window.HUB_CONFIG || {};
        const url = String(ds.url || c.supabaseUrl || "").replace(/\/$/, "");
        const key = String(ds.key || c.supabaseKey || "");
        const go = String(ds.go || c.goUrl || (url ? `${url}/functions/v1/go` : "")).replace(/\/$/, "");
        resolve(url && key ? { url, key, go } : null);
      };
      if ((ds.url && ds.key) || (window.HUB_CONFIG && window.HUB_CONFIG.supabaseUrl) || !src) return done();
      const s = document.createElement("script");
      s.src = new URL("config.js", src).href;
      s.onload = done;
      s.onerror = done;
      document.head.appendChild(s);
    }));
  }

  async function rpc(name, body, opts = {}) {
    const c = await config();
    if (!c) throw new Error("Ad Hub ยังไม่ได้ตั้งค่า Supabase");
    const headers = { apikey: c.key, "Content-Type": "application/json" };
    if (!c.key.startsWith("sb_")) headers.Authorization = `Bearer ${c.key}`;
    const ctrl = "AbortController" in window ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${c.url}/rest/v1/rpc/${name}`, {
        method: "POST", headers, body: JSON.stringify(body), keepalive: !!opts.keepalive, signal: ctrl && ctrl.signal,
      });
      if (!res.ok) throw new Error(`Ad Hub ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function cacheGet(k) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || "null");
      return v && Date.now() - v.at < CACHE_DAYS * 864e5 ? v.data : null;
    } catch (_) { return null; }
  }
  function cacheSet(k, data) {
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch (_) { /* เก็บไม่ได้ก็ไม่เป็นไร */ }
  }

  // ---------- ดึงโฆษณา ----------
  // opts: {placement, context, count, product, allowRepeat}
  //   product: รหัสสินค้าที่ต้องการ (ตัวเลข, array หรือ "12, 40") ขึ้นก่อนตามลำดับ ชิ้นที่หยุดแสดงแล้วได้ชิ้นอื่นในหมวดเดียวกันแทน
  // คืนค่า {placement: {key, slots, positions} | null, ads: [{id, title, price, price_text, sold_text, shop, source, image, href, placement}]}
  async function load(opts) {
    const o = typeof opts === "string" ? { placement: opts } : (opts || {});
    const placement = String(o.placement || "").trim().toLowerCase();
    const context = String(o.context || "").trim();
    const products = [...new Set((Array.isArray(o.product) ? o.product : String(o.product || "").split(/[\s,]+/))
      .map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 24);
    const empty = { placement: null, ads: [] };
    if (!site || !placement) return empty;
    const cacheKey = `adhub:v1:${site}:${placement}:${context}:${products.join(",")}`;
    let data;
    try {
      data = await rpc("hub_ads", {
        p_site: site, p_placement: placement, p_context: context,
        p_count: o.count ? Number(o.count) : null,
        p_exclude: o.allowRepeat ? [] : [...shown],
        p_products: products,
      });
      cacheSet(cacheKey, data);
    } catch (err) {
      data = cacheGet(cacheKey);
      if (!data) { console.warn("[AdHub]", err.message || err); return empty; }
    }
    const c = await config();
    const ads = (data && Array.isArray(data.ads) ? data.ads : [])
      .filter(a => o.allowRepeat || !shown.has(a.id))
      .map(a => ({
        ...a,
        image: a.image_url || "",
        placement,
        href: c && c.go ? `${c.go}/${a.id}?s=${encodeURIComponent(site)}&p=${encodeURIComponent(placement)}` : "",
      }))
      .filter(a => a.href);
    ads.forEach(a => shown.add(a.id));
    return { placement: data ? data.placement : null, ads };
  }

  // ---------- นับการแสดง: การ์ดที่อยู่ในจอครึ่งหนึ่งขึ้นไป ส่งเป็นชุด ----------
  const pending = new Map();   // placement → Set(id)
  const counted = new Set();
  let flushTimer = null;

  function flush(keepalive) {
    clearTimeout(flushTimer);
    flushTimer = null;
    pending.forEach((ids, placement) => {
      const list = [...ids];
      for (let i = 0; i < list.length; i += 24) {
        rpc("hub_log_views", { p_site: site, p_placement: placement, p_ids: list.slice(i, i + 24) }, { keepalive }).catch(() => {});
      }
    });
    pending.clear();
  }

  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      const id = Number(entry.target.getAttribute("data-adhub-id"));
      const placement = entry.target.getAttribute("data-adhub-placement") || "";
      const key = `${placement}:${id}`;
      if (!id || counted.has(key)) return;
      counted.add(key);
      if (!pending.has(placement)) pending.set(placement, new Set());
      pending.get(placement).add(id);
      if (!flushTimer) flushTimer = setTimeout(() => flush(false), 1500);
    });
  }, { threshold: 0.5 }) : null;

  // เฝ้าทุกการ์ดที่มี data-adhub-id และ data-adhub-placement ใน root (หรือ root เอง)
  function observe(root) {
    if (!io || !root) return;
    const els = [root, ...(root.querySelectorAll ? root.querySelectorAll("[data-adhub-id]") : [])];
    els.filter(el => el.getAttribute && el.getAttribute("data-adhub-id")).forEach(el => io.observe(el));
  }

  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });

  // ---------- การ์ดสำเร็จรูป ----------
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const priceText = (a) => a.price_text || (a.price != null ? `฿${Number(a.price).toLocaleString("th-TH")}` : "");

  function injectCss() {
    if (document.getElementById("adhub-css")) return;
    const css = document.createElement("style");
    css.id = "adhub-css";
    // :where() ทำให้ความสำคัญเป็นศูนย์ เว็บที่ฝังเขียนทับได้ง่าย สีปรับได้ด้วยตัวแปร --adhub-*
    css.textContent = `
:where(.adhub-grid){display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--adhub-min,150px),1fr));gap:var(--adhub-gap,12px)}
:where(.adhub-card){position:relative;display:flex;flex-direction:column;border:1px solid var(--adhub-border,#e2e8f0);border-radius:var(--adhub-radius,12px);background:var(--adhub-bg,#fff);color:var(--adhub-fg,#1e293b);text-decoration:none;overflow:hidden;font:inherit}
:where(.adhub-card:hover){box-shadow:0 4px 14px rgba(15,23,42,.08)}
:where(.adhub-img){display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#f1f5f9}
:where(.adhub-body){display:flex;flex-direction:column;gap:4px;padding:8px 10px 10px}
:where(.adhub-title){font-size:.875em;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
:where(.adhub-price){font-weight:600;color:var(--adhub-price,#e11d48)}
:where(.adhub-shop){font-size:.75em;color:var(--adhub-muted,#64748b)}
:where(.adhub-tag){position:absolute;top:6px;left:6px;padding:1px 6px;border-radius:999px;background:rgba(15,23,42,.65);color:#fff;font-size:11px;line-height:1.5}`;
    document.head.appendChild(css);
  }

  function cardHtml(a) {
    return `<a class="adhub-card" href="${esc(a.href)}" target="_blank" rel="sponsored noopener" data-adhub-id="${esc(a.id)}" data-adhub-placement="${esc(a.placement)}">
  <span class="adhub-tag">โฆษณา</span>
  ${a.image ? `<img class="adhub-img" src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer">` : ""}
  <span class="adhub-body"><span class="adhub-title">${esc(a.title)}</span>
  ${priceText(a) ? `<span class="adhub-price">${esc(priceText(a))}</span>` : ""}
  ${a.shop ? `<span class="adhub-shop">${esc(a.shop)}</span>` : ""}</span>
</a>`;
  }

  function render(el, ads) {
    if (!el) return;
    if (!ads || !ads.length) { el.innerHTML = ""; return; }
    injectCss();
    el.innerHTML = `<div class="adhub-grid">${ads.map(cardHtml).join("")}</div>`;
    observe(el);
  }

  // ---------- วาดช่อง data-adhub ทั้งหน้า (เรียกซ้ำได้ เช่นหลังเปลี่ยนหน้าแบบ SPA) ----------
  async function scan(root) {
    const slots = [...(root || document).querySelectorAll("[data-adhub]:not([data-adhub-done])")];
    for (const el of slots) {   // ทีละช่อง เพื่อให้ช่องหลังรู้ว่าช่องก่อนแสดงอะไรไปแล้ว
      el.setAttribute("data-adhub-done", "");
      const out = await load({
        placement: el.getAttribute("data-adhub"), context: el.getAttribute("data-context"),
        count: el.getAttribute("data-count"), product: el.getAttribute("data-product"),
      });
      render(el, out.ads);
    }
  }

  window.AdHub = { site, load, render, observe, scan, cardHtml, flush: () => flush(false) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => scan());
  else scan();
})();
