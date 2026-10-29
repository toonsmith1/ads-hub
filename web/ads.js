// ==========================================
// Ad Hub: สคริปต์ฝังโฆษณาจากคลังกลาง ใช้ได้กับเว็บไหนก็ได้
//
//   <script src="https://<เว็บ Ad Hub>/ads.js?site=<คีย์เว็บ>" async></script>
//   <div data-adhub="feed"></div>                       ← วาดการ์ดให้เอง
//   <div data-adhub="detail" data-context="ครู"></div>  ← ส่งคำบอกบริบทของหน้าได้
//   <div data-adhub="feed" data-show="image,title,shop"></div>  ← เลือกช่องบนการ์ด (ไม่ใส่ = ตามที่ตั้งในจุดที่วาง)
//   <div data-adhub="review" data-product="12"></div>   ← ขอสินค้าตามรหัส (เช่นหน้ารีวิว)
//   <div data-adhub="review" data-product="12" data-layout="review"></div>  ← กล่องรีวิว: รูปทั้งหมด สเปก รายละเอียด ปุ่มซื้อ
//   <div data-adhub="feed" data-cta="เช็คราคาวันนี้"></div>   ← ข้อความบนปุ่มของการ์ด (ไม่ใส่ = "ดูราคาใน Shopee" ตามแหล่งสินค้า)
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
  // opts: {placement, context, count, product, full, allowRepeat}
  //   product: รหัสสินค้าที่ต้องการ (ตัวเลข, array หรือ "12, 40") ขึ้นก่อนตามลำดับ ชิ้นที่หยุดแสดงแล้วได้ชิ้นอื่นในหมวดเดียวกันแทน
  //   full: ขอข้อมูลรีวิวด้วย (images, description, review, details: {brand, rating, rating_count, specs})
  // คืนค่า {placement: {key, slots, positions, show} | null, ads: [{id, title, price, price_text, sold_text, shop, source, image, href, placement}]}
  async function load(opts) {
    const o = typeof opts === "string" ? { placement: opts } : (opts || {});
    const placement = String(o.placement || "").trim().toLowerCase();
    const context = String(o.context || "").trim();
    const products = [...new Set((Array.isArray(o.product) ? o.product : String(o.product || "").split(/[\s,]+/))
      .map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 24);
    const empty = { placement: null, ads: [] };
    if (!site || !placement) return empty;
    const cacheKey = `adhub:v1:${site}:${placement}:${context}:${products.join(",")}${o.full ? ":full" : ""}`;
    let data;
    try {
      data = await rpc("hub_ads", {
        p_site: site, p_placement: placement, p_context: context,
        p_count: o.count ? Number(o.count) : null,
        p_exclude: o.allowRepeat ? [] : [...shown],
        p_products: products,
      });
      if (o.full && data && Array.isArray(data.ads) && data.ads.length) {
        // ขอข้อมูลรีวิวไม่ได้ (เช่นยังไม่ได้รัน schema รุ่นใหม่) ก็ยังแสดงด้วยรูปปกได้
        const info = new Map((await rpc("hub_product_info", { p_ids: data.ads.map(a => a.id) }).catch(() => null) || []).map(i => [i.id, i]));
        data.ads = data.ads.map(a => ({ images: [], description: "", review: "", details: {}, ...a, ...info.get(a.id) }));
      }
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
      entry.target.classList.add("adhub-in");   // ปุ่มวาวหนึ่งครั้งตอนเลื่อนมาเห็น
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
  const SOURCES = { shopee: "Shopee", lazada: "Lazada", tiktok: "TikTok Shop", amazon: "Amazon" };
  const ctaText = (a, cta) => String(cta || "").trim() || (SOURCES[a.source] ? `ดูราคาใน ${SOURCES[a.source]}` : "ดูราคาและรายละเอียด");

  function injectCss() {
    if (document.getElementById("adhub-css")) return;
    const css = document.createElement("style");
    css.id = "adhub-css";
    // :where() ทำให้ความสำคัญเป็นศูนย์ เว็บที่ฝังเขียนทับได้ง่าย สีปรับได้ด้วยตัวแปร --adhub-*
    css.textContent = `
:where(.adhub-grid){display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--adhub-min,150px),1fr));gap:var(--adhub-gap,12px)}
:where(.adhub-card){position:relative;display:flex;flex-direction:column;border:1px solid var(--adhub-border,#e2e8f0);border-radius:var(--adhub-radius,12px);background:var(--adhub-bg,#fff);color:var(--adhub-fg,#1e293b);text-decoration:none;overflow:hidden;font:inherit;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;-webkit-tap-highlight-color:transparent}
:where(.adhub-card:hover){transform:translateY(-2px);border-color:var(--adhub-accent,#e11d48);box-shadow:0 8px 20px rgba(15,23,42,.12)}
:where(.adhub-card:active){transform:scale(.98);box-shadow:0 2px 6px rgba(15,23,42,.1)}
:where(.adhub-card:focus-visible,.adhub-buy:focus-visible){outline:3px solid var(--adhub-accent,#e11d48);outline-offset:2px}
:where(.adhub-img){display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#f1f5f9;transition:transform .3s ease}
:where(.adhub-card:hover .adhub-img){transform:scale(1.04)}
:where(.adhub-body){display:flex;flex-direction:column;gap:4px;padding:8px 10px 10px;flex:1}
:where(.adhub-cta,.adhub-buy){position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;gap:6px;border-radius:999px;background:var(--adhub-accent,#e11d48);color:var(--adhub-accent-fg,#fff);font-weight:600;line-height:1.2;text-align:center;box-shadow:0 2px 6px rgba(225,29,72,.3);transition:filter .15s ease,box-shadow .15s ease}
:where(.adhub-cta){margin-top:auto;min-height:36px;padding:6px 12px;font-size:.85em}
:where(.adhub-card:hover .adhub-cta,.adhub-buy:hover){filter:brightness(1.08);box-shadow:0 4px 12px rgba(225,29,72,.4)}
:where(.adhub-arrow){display:inline-block;transition:transform .15s ease}
:where(.adhub-card:hover .adhub-arrow,.adhub-buy:hover .adhub-arrow){transform:translateX(3px)}
.adhub-cta::after,.adhub-buy::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-20deg);pointer-events:none;opacity:0}
.adhub-in .adhub-cta::after,.adhub-in.adhub-review .adhub-buy::after{animation:adhub-shine 1.1s ease .3s 2}
@keyframes adhub-shine{0%{left:-60%;opacity:1}100%{left:130%;opacity:1}}
@media (prefers-reduced-motion:reduce){.adhub-card,.adhub-img,.adhub-arrow{transition:none!important;transform:none!important}.adhub-cta::after,.adhub-buy::after{animation:none!important}}
:where(.adhub-title){font-size:.875em;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
:where(.adhub-caption){font-size:.8em;color:var(--adhub-muted,#64748b)}
:where(.adhub-price){font-weight:600;color:var(--adhub-price,#e11d48)}
:where(.adhub-shop){font-size:.75em;color:var(--adhub-muted,#64748b)}
:where(.adhub-tag){position:absolute;top:6px;left:6px;padding:1px 6px;border-radius:999px;background:rgba(15,23,42,.65);color:#fff;font-size:11px;line-height:1.5}
:where(.adhub-review){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:20px;color:var(--adhub-fg,#1e293b);font:inherit}
:where(.adhub-review+.adhub-review){margin-top:28px;padding-top:28px;border-top:1px solid var(--adhub-border,#e2e8f0)}
:where(.adhub-gallery){display:flex;flex-direction:column;gap:8px;min-width:0}
:where(.adhub-main){display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#f8fafc;border:1px solid var(--adhub-border,#e2e8f0);border-radius:var(--adhub-radius,12px)}
:where(.adhub-thumbs){display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
:where(.adhub-thumb){flex:0 0 56px;height:56px;padding:0;border:2px solid transparent;border-radius:8px;background:#f1f5f9;cursor:pointer;overflow:hidden}
:where(.adhub-thumb[aria-current="true"]){border-color:var(--adhub-accent,#e11d48)}
:where(.adhub-thumb img){width:100%;height:100%;object-fit:cover;display:block}
:where(.adhub-info){display:flex;flex-direction:column;gap:10px;min-width:0}
:where(.adhub-info h3){margin:0;font-size:1.15em;line-height:1.4}
:where(.adhub-meta){font-size:.85em;color:var(--adhub-muted,#64748b)}
:where(.adhub-stars){color:#f59e0b;letter-spacing:1px}
:where(.adhub-review .adhub-price){font-size:1.4em}
:where(.adhub-buy){display:inline-flex;align-self:flex-start;min-height:48px;padding:0 26px;font-size:1.05em;text-decoration:none}
:where(.adhub-specs){display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:.875em}
:where(.adhub-specs dt){color:var(--adhub-muted,#64748b)}
:where(.adhub-specs dd){margin:0;overflow-wrap:anywhere}
:where(.adhub-desc){font-size:.9em;line-height:1.65;white-space:pre-line;overflow-wrap:anywhere}
:where(.adhub-text){font-size:1em}
:where(.adhub-desc summary){cursor:pointer;font-weight:600;white-space:normal}
:where(.adhub-note){font-size:.75em;color:var(--adhub-muted,#64748b)}`;
    document.head.appendChild(css);
  }

  // ช่องบนการ์ด: image title caption price shop ว่าง = ทุกช่อง (ป้าย "โฆษณา" และปุ่ม CTA แสดงเสมอ)
  const FIELDS = ["image", "title", "caption", "price", "shop"];
  function showSet(show) {
    const list = (Array.isArray(show) ? show : String(show || "").split(/[\s,]+/))
      .map(f => String(f).trim().toLowerCase()).filter(f => FIELDS.includes(f));
    return new Set(list.length ? list : FIELDS);
  }

  function cardHtml(a, show, cta) {
    const on = showSet(show);
    const body = [
      on.has("title") && `<span class="adhub-title">${esc(a.title)}</span>`,
      on.has("caption") && a.caption && `<span class="adhub-caption">${esc(a.caption)}</span>`,
      on.has("price") && priceText(a) && `<span class="adhub-price">${esc(priceText(a))}</span>`,
      on.has("shop") && a.shop && `<span class="adhub-shop">${esc(a.shop)}</span>`,
      `<span class="adhub-cta">${esc(ctaText(a, cta))} <span class="adhub-arrow" aria-hidden="true">›</span></span>`,
    ].filter(Boolean);
    return `<a class="adhub-card" href="${esc(a.href)}" target="_blank" rel="sponsored noopener" data-adhub-id="${esc(a.id)}" data-adhub-placement="${esc(a.placement)}"${on.has("title") ? "" : ` aria-label="${esc(a.title)}"`}>
  <span class="adhub-tag">โฆษณา</span>
  ${on.has("image") && a.image ? `<img class="adhub-img" src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer">` : ""}
  <span class="adhub-body">${body.join("\n  ")}</span>
</a>`;
  }

  // กล่องรีวิว: รูปทั้งหมด (กดรูปเล็กเพื่อเปลี่ยนรูปใหญ่) คะแนน ราคา ปุ่มซื้อ ข้อมูลจำเพาะ และรายละเอียด
  // ต้องได้ข้อมูลจาก load({full: true}) ถ้าไม่มีจะใช้รูปปกรูปเดียว
  function reviewHtml(a, cta) {
    const imgs = [...new Set([...(a.images || []), a.image].filter(Boolean))].slice(0, 12);
    const d = a.details || {};
    const rating = Number(d.rating);
    const stars = rating > 0 ? "★★★★★".slice(0, Math.round(Math.min(rating, 5))).padEnd(5, "☆") : "";
    const meta = [
      stars && `<span class="adhub-stars" aria-hidden="true">${stars}</span> ${esc(rating.toFixed(1))}${d.rating_count ? ` (${esc(Number(d.rating_count).toLocaleString("th-TH"))} รีวิว)` : ""}`,
      d.brand && `แบรนด์ ${esc(d.brand)}`,
      a.sold_text && esc(a.sold_text),
      a.shop && `ร้าน ${esc(a.shop)}`,
    ].filter(Boolean);
    const specs = d.specs && typeof d.specs === "object" ? Object.entries(d.specs).slice(0, 30) : [];
    const desc = String(a.description || "").trim();
    const review = String(a.review || "").trim();
    return `<div class="adhub-review" data-adhub-id="${esc(a.id)}" data-adhub-placement="${esc(a.placement)}">
  <div class="adhub-gallery">
    ${imgs.length ? `<img class="adhub-main" src="${esc(imgs[0])}" alt="${esc(a.title)}" referrerpolicy="no-referrer">` : ""}
    ${imgs.length > 1 ? `<div class="adhub-thumbs">${imgs.map((u, i) => `<button type="button" class="adhub-thumb" data-src="${esc(u)}" aria-current="${i === 0}" aria-label="รูปที่ ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join("")}</div>` : ""}
  </div>
  <div class="adhub-info">
    <h3>${esc(a.title)}</h3>
    ${meta.length ? `<div class="adhub-meta">${meta.join(" · ")}</div>` : ""}
    ${priceText(a) ? `<div class="adhub-price">${esc(priceText(a))}</div>` : ""}
    <a class="adhub-buy" href="${esc(a.href)}" target="_blank" rel="sponsored noopener">${esc(String(cta || "").trim() || (SOURCES[a.source] ? `ดูราคาล่าสุดใน ${SOURCES[a.source]}` : "ดูราคาล่าสุด / สั่งซื้อ"))} <span class="adhub-arrow" aria-hidden="true">›</span></a>
    <div class="adhub-note">ลิงก์ affiliate: เราอาจได้ค่าคอมมิชชันเมื่อคุณซื้อผ่านลิงก์นี้ ราคาอาจเปลี่ยนแปลง</div>
    ${review ? `<div class="adhub-desc adhub-text">${esc(review)}</div>` : ""}
    ${specs.length ? `<dl class="adhub-specs">${specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
    ${desc ? (desc.length > 600
      ? `<details class="adhub-desc"><summary>รายละเอียดสินค้า</summary>${esc(desc)}</details>`
      : `<div class="adhub-desc">${esc(desc)}</div>`) : ""}
  </div>
</div>`;
  }

  // กดรูปเล็กในกล่องรีวิว: เปลี่ยนรูปใหญ่ (ฟังที่ document ครั้งเดียว ใช้ได้กับกล่องที่วาดทีหลัง)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".adhub-thumb");
    const box = btn && btn.closest(".adhub-review");
    const main = box && box.querySelector(".adhub-main");
    if (!main) return;
    main.src = btn.getAttribute("data-src");
    box.querySelectorAll(".adhub-thumb").forEach(b => b.setAttribute("aria-current", String(b === btn)));
  });

  // opts.layout: "grid" (การ์ด ค่าเริ่มต้น) หรือ "review" (กล่องรีวิว), opts.cta: ข้อความบนปุ่ม
  // opts.show: ช่องบนการ์ด เช่น ["image", "title", "shop"] หรือ "image,title,shop" (ไม่ใส่ = ทุกช่อง ใช้กับการ์ดเท่านั้น)
  function render(el, ads, opts) {
    if (!el) return;
    if (!ads || !ads.length) { el.innerHTML = ""; return; }
    injectCss();
    const o = opts || {};
    el.innerHTML = o.layout === "review"
      ? ads.map(a => reviewHtml(a, o.cta)).join("")
      : `<div class="adhub-grid">${ads.map(a => cardHtml(a, o.show, o.cta)).join("")}</div>`;
    observe(el);
  }

  // ---------- วาดช่อง data-adhub ทั้งหน้า (เรียกซ้ำได้ เช่นหลังเปลี่ยนหน้าแบบ SPA) ----------
  async function scan(root) {
    const slots = [...(root || document).querySelectorAll("[data-adhub]:not([data-adhub-done])")];
    for (const el of slots) {   // ทีละช่อง เพื่อให้ช่องหลังรู้ว่าช่องก่อนแสดงอะไรไปแล้ว
      el.setAttribute("data-adhub-done", "");
      const layout = el.getAttribute("data-layout") || "grid";
      const out = await load({
        placement: el.getAttribute("data-adhub"), context: el.getAttribute("data-context"),
        count: el.getAttribute("data-count"), product: el.getAttribute("data-product"),
        full: layout === "review",
      });
      // data-show บนช่อง > ที่ตั้งไว้ในจุดที่วาง > ทุกช่อง
      const show = el.getAttribute("data-show") || (out.placement && out.placement.show) || "";
      render(el, out.ads, { layout, show, cta: el.getAttribute("data-cta") });
    }
  }

  // เว็บที่วาดเองใช้ cardHtml(ad, show, cta) ได้ แต่ต้องเรียก style() ก่อนหนึ่งครั้งเพื่อใส่ CSS ของการ์ด
  window.AdHub = { site, load, render, observe, scan, cardHtml, reviewHtml, style: injectCss, flush: () => flush(false) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => scan());
  else scan();
})();
