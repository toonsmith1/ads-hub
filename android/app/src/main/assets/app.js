// ==========================================
// แอปดูจำนวนคลิกของ Ad Hub (อ่านอย่างเดียว) คุยกับ Supabase ผ่าน REST ตรงๆ ไม่มีไลบรารีภายนอก
// hub_events อ่านได้เฉพาะแอดมิน (RLS) จึงใช้แค่ publishable/anon key + ล็อกอินแอดมิน ไม่มีคีย์ที่เขียนข้อมูลได้ในแอป
// หน้า "ยอดวิว transfer" อ่านสรุปจาก rpc hub_transfer_stats (แอดมินเท่านั้น ดู supabase/schema.sql)
// ทดสอบในเบราว์เซอร์: node tests/clicks-app-e2e.js
// ==========================================
(function () {
  "use strict";

  const TZ = 7 * 3600e3;      // นับวันตามเวลาไทย เหมือนรายงานของ Shopee Affiliate
  const PAGE = 1000;           // ทีละหน้า (ค่า max-rows เริ่มต้นของ Supabase)
  const MAX_ROWS = 200000;
  const LIST_MAX = 200;

  const RANGES = [
    { id: "today", label: "วันนี้", days: 1, back: 0 },
    { id: "yesterday", label: "เมื่อวาน", days: 1, back: 1 },
    { id: "7", label: "7 วัน", days: 7, back: 0 },
    { id: "30", label: "30 วัน", days: 30, back: 0 },
    { id: "90", label: "90 วัน", days: 90, back: 0 },
  ];
  const TABS = [["products", "สินค้า"], ["sites", "เว็บ/ตำแหน่ง"], ["days", "รายวัน"]];
  // ยอดวิวสรุปฝั่งเซิร์ฟเวอร์ทีละ N วันล่าสุด จึงไม่มี "เมื่อวาน"
  const VRANGES = RANGES.filter(r => r.back === 0);
  const VTABS = [["pages", "ประกาศ"], ["sources", "ช่องทาง"], ["provinces", "จังหวัด"], ["hours", "ช่วงเวลา"], ["days", "รายวัน"]];
  const SOURCES = { direct: "เข้าตรง/บุ๊กมาร์ก", google: "Google", search_other: "เครื่องมือค้นหาอื่น", facebook: "Facebook",
                    line: "LINE", x: "X (Twitter)", tiktok: "TikTok", youtube: "YouTube", other: "เว็บอื่น", internal: "ในเว็บ" };
  const DEVICES = { mobile: "มือถือ", tablet: "แท็บเล็ต", desktop: "คอมพิวเตอร์", unknown: "ไม่ทราบ" };
  const WEEKDAYS = ["", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* เก็บไม่ได้ก็แค่ต้องตั้งใหม่ */ } },
  };
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Number(n).toLocaleString("th-TH");

  // ---------- วันที่ (เวลาไทย) ----------
  const dayKey = ms => new Date(ms + TZ).toISOString().slice(0, 10);
  const hourOf = ms => new Date(ms + TZ).getUTCHours();
  const dayStart = key => Date.parse(key + "T00:00:00Z") - TZ;
  const addDays = (key, n) => new Date(Date.parse(key + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const WEEK = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  const thDate = key => { const [, m, d] = key.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const thDay = key => `${WEEK[new Date(key + "T00:00:00Z").getUTCDay()]} ${thDate(key)}`;
  const thTime = ms => new Date(ms + TZ).toISOString().slice(11, 16);

  // ช่วงที่เลือก [start, end) และช่วงก่อนหน้ายาวเท่ากัน (วันนี้เทียบกับเมื่อวานถึงเวลาเดียวกัน)
  function period(r, now = Date.now()) {
    const to = addDays(dayKey(now), -r.back);
    const from = addDays(to, -(r.days - 1));
    const start = dayStart(from);
    const end = Math.min(dayStart(addDays(to, 1)), now);
    const span = r.days * 864e5;
    return { from, to, start, end, prevStart: start - span, prevEnd: end - span };
  }

  // ---------- Supabase ----------
  let cfg = store.get("cfg");           // {url, key}
  let sess = store.get("session");      // {access_token, refresh_token, expires_at}
  let refreshing = null;

  class AuthError extends Error {}

  async function http(path, { method = "GET", body, auth = true } = {}) {
    if (auth) await fresh();
    const headers = { apikey: cfg.key, "Content-Type": "application/json" };
    if (auth) headers.Authorization = "Bearer " + sess.access_token;
    const res = await fetch(cfg.url + path, { method, headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
    if (!res.ok) {
      if (auth && res.status === 401) { signOut(); throw new AuthError("หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่"); }
      throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function grant(type, body) {
    const d = await http(`/auth/v1/token?grant_type=${type}`, { method: "POST", body, auth: false });
    sess = { access_token: d.access_token, refresh_token: d.refresh_token,
             expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) };
    store.set("session", sess);
  }

  async function fresh() {
    if (!sess) throw new AuthError("");
    if (sess.expires_at - 60 > Date.now() / 1000) return;
    refreshing ??= grant("refresh_token", { refresh_token: sess.refresh_token })
      .catch(() => { signOut(); throw new AuthError("หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่"); })
      .finally(() => { refreshing = null; });
    await refreshing;
  }

  function signOut() { sess = null; store.set("session", null); }

  // คีย์ที่เขียนข้อมูลได้ทุกอย่าง ห้ามเก็บไว้ในมือถือ
  function isSecretKey(k) {
    if (/^sb_secret_/i.test(k)) return true;
    const p = k.split(".");
    if (p.length !== 3) return false;
    try {
      const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4))).role === "service_role";
    } catch { return false; }
  }

  // คลิกทั้งหมดในช่วง ไล่ตามรหัสทีละหน้า (หยุดเมื่อหน้าว่าง เผื่อเซิร์ฟเวอร์ตั้ง max-rows ต่ำกว่า PAGE)
  async function fetchClicks(start, end) {
    const rows = [];
    let last = 0;
    const range = `&event_at=gte.${encodeURIComponent(new Date(start).toISOString())}&event_at=lt.${encodeURIComponent(new Date(end).toISOString())}`;
    while (rows.length < MAX_ROWS) {
      const batch = await http(`/rest/v1/hub_events?select=id,event_at,product_id,site_id,placement&event=eq.click${range}&id=gt.${last}&order=id.asc&limit=${PAGE}`);
      if (!batch.length) break;
      for (const r of batch) rows.push({ t: Date.parse(r.event_at), p: r.product_id, s: r.site_id, pl: r.placement || "" });
      last = batch[batch.length - 1].id;
    }
    return rows;
  }

  const products = new Map();   // id → {title, shop, image_url, source, source_id}
  const sites = new Map();      // id → {key, name}

  async function loadProducts(ids) {
    const need = ids.filter(id => !products.has(id));
    for (let i = 0; i < need.length; i += 150) {
      const part = need.slice(i, i + 150);
      const list = await http(`/rest/v1/hub_products?select=id,title,shop,image_url,source,source_id&id=in.(${part.join(",")})`);
      for (const p of list) products.set(p.id, p);
    }
  }

  async function loadSites() {
    for (const s of await http("/rest/v1/hub_sites?select=id,key,name")) sites.set(s.id, s);
  }

  // ---------- สถานะหน้าจอ ----------
  const state = { range: store.get("range") || "7", tab: "products", day: null, q: "", data: null, loadedAt: 0, seq: 0,
                  mode: store.get("mode") === "views" ? "views" : "clicks", vrange: store.get("vrange") || "7", vtab: "pages", vdata: null };

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
  }

  function showSetup() {
    const f = $("#setup-form");
    f.url.value = cfg?.url || "";
    f.key.value = cfg?.key || "";
    show("setup");
  }

  function showLogin(msg = "") {
    $("#login [data-error]").textContent = msg;
    show("login");
  }

  function start() {
    if (!cfg?.url || !cfg?.key) return showSetup();
    if (!sess) return showLogin();
    show("main");
    renderRanges();
    load();
  }

  async function guardForm(form, fn) {
    const btn = $("button", form), err = $("[data-error]", form);
    btn.disabled = true;
    err.textContent = "";
    try { await fn(); }
    catch (e) { err.textContent = e.message || String(e); }
    finally { btn.disabled = false; }
  }

  $("#setup-form").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    guardForm(f, async () => {
      const url = f.url.value.trim().replace(/\/+$/, "");
      const key = f.key.value.trim();
      if (!/^https:\/\//.test(url)) throw new Error("Project URL ต้องขึ้นต้นด้วย https://");
      if (isSecretKey(key)) throw new Error("นี่คือ Secret key ห้ามใส่ในแอป ใช้ Publishable key (sb_publishable_...) หรือ anon key");
      const res = await fetch(url + "/auth/v1/settings", { headers: { apikey: key } }).catch(() => null);
      if (!res) throw new Error("ต่อ Supabase ไม่ได้ ตรวจ Project URL และอินเทอร์เน็ต");
      if (!res.ok) throw new Error("Supabase ไม่รับคีย์นี้ ตรวจ Publishable key อีกครั้ง");
      if (cfg?.url !== url) { signOut(); products.clear(); sites.clear(); }
      cfg = { url, key };
      store.set("cfg", cfg);
      start();
    });
  });

  $("#login-form").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    guardForm(f, async () => {
      try { await grant("password", { email: f.email.value.trim(), password: f.password.value }); }
      catch (err) { throw new Error(/invalid/i.test(err.message) ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : err.message); }
      if (!(await http("/rest/v1/rpc/hub_is_admin", { method: "POST", body: {} }))) {
        signOut();
        throw new Error("บัญชีนี้ไม่ใช่แอดมินของ Ad Hub จึงดูจำนวนคลิกไม่ได้");
      }
      f.password.value = "";
      start();
    });
  });

  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act], [data-mode], [data-range], [data-vrange], [data-tab], [data-vtab], [data-day], [data-pid]");
    if (!el) { $("#menu").hidden = true; return; }
    if (el.dataset.act !== "menu") $("#menu").hidden = true;
    if (el.dataset.mode) {
      if (el.dataset.mode === state.mode) return;
      state.mode = el.dataset.mode; store.set("mode", state.mode); state.loadedAt = 0;
      renderRanges(); $("#content").innerHTML = `<p class="empty">กำลังโหลด…</p>`; return load();
    }
    if (el.dataset.vrange) { state.vrange = el.dataset.vrange; store.set("vrange", state.vrange); renderRanges(); return load(); }
    if (el.dataset.vtab) { state.vtab = el.dataset.vtab; return renderViews(); }
    if (el.dataset.range) { state.range = el.dataset.range; state.day = null; store.set("range", state.range); renderRanges(); return load(); }
    if (el.dataset.tab) { state.tab = el.dataset.tab; return render(); }
    if (el.dataset.day) { state.day = state.day === el.dataset.day ? null : el.dataset.day; return render(); }
    if (el.dataset.pid) return openProduct(Number(el.dataset.pid));
    switch (el.dataset.act) {
      case "refresh": return load();
      case "menu": $("#menu").hidden = !$("#menu").hidden; return;
      case "logout": signOut(); return showLogin();
      case "setup": return showSetup();
      case "clear-day": state.day = null; return render();
      case "close-sheet": $("#sheet").hidden = true; return;
    }
  });
  $("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") e.target.hidden = true; });

  // ปุ่มย้อนกลับของ Android (MainActivity เรียก) คืน true ถ้าจัดการเองแล้ว
  window.appBack = () => {
    if (!$("#sheet").hidden) { $("#sheet").hidden = true; return true; }
    if (!$("#menu").hidden) { $("#menu").hidden = true; return true; }
    if (state.day) { state.day = null; render(); return true; }
    if (!$("#setup").hidden && cfg?.url && cfg?.key) { start(); return true; }
    return false;
  };

  // กลับเข้าแอปหลังผ่านไปเกินนาที โหลดตัวเลขใหม่เอง
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !$("#main").hidden && Date.now() - state.loadedAt > 60e3) load();
  });

  function renderRanges() {
    const views = state.mode === "views";
    $("#title").textContent = views ? "ยอดวิว transfer" : "จำนวนคลิก";
    for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("on", b.dataset.mode === state.mode);
    $("#ranges").innerHTML = views
      ? VRANGES.map(r => `<button data-vrange="${r.id}" class="${r.id === state.vrange ? "on" : ""}">${r.label}</button>`).join("")
      : RANGES.map(r => `<button data-range="${r.id}" class="${r.id === state.range ? "on" : ""}">${r.label}</button>`).join("");
  }

  async function load() {
    if (state.mode === "views") return loadViews();
    const seq = ++state.seq;
    const r = RANGES.find(x => x.id === state.range) || RANGES[2];
    const p = period(r);
    $("#main").classList.add("loading");
    $("#main-error").textContent = "";
    if (!state.data) $("#content").innerHTML = `<p class="empty">กำลังโหลด…</p>`;
    try {
      const [rows, prev] = await Promise.all([fetchClicks(p.start, p.end), fetchClicks(p.prevStart, p.prevEnd), sites.size ? null : loadSites()]);
      await loadProducts([...new Set(rows.map(x => x.p))]);
      if (seq !== state.seq) return;
      state.data = { r, p, rows, prevCount: prev.length, capped: rows.length >= MAX_ROWS };
      state.loadedAt = Date.now();
      render();
    } catch (e) {
      if (seq !== state.seq) return;
      if (e instanceof AuthError) return showLogin(e.message);
      $("#main-error").textContent = "โหลดไม่สำเร็จ: " + (e.message || e) + (navigator.onLine === false ? " (ไม่มีอินเทอร์เน็ต)" : "");
    } finally {
      if (seq === state.seq) $("#main").classList.remove("loading");
    }
  }

  // ---------- วาดหน้าหลัก ----------
  const count = (rows, keyFn) => {
    const m = new Map();
    for (const x of rows) { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const days = p => { const out = []; for (let d = p.from; d <= p.to; d = addDays(d, 1)) out.push(d); return out; };
  const siteLabel = (s, pl) => `${s == null ? "ไม่ระบุเว็บ" : esc(sites.get(s)?.name || sites.get(s)?.key || "เว็บ #" + s)}${pl ? ` · ${esc(pl)}` : ""}`;

  function render() {
    const d = state.data;
    if (!d || state.mode !== "clicks") return;
    const { r, p, rows } = d;
    const hourly = r.days === 1;
    const rows2 = state.day ? rows.filter(x => dayKey(x.t) === state.day) : rows;

    // สรุป
    const diff = d.prevCount ? Math.round((rows.length - d.prevCount) / d.prevCount * 100) : null;
    const lastT = rows.reduce((m, x) => Math.max(m, x.t), 0);
    const summary = `
      <div class="card">
        <div class="muted">${hourly ? thDay(p.from) : `${thDate(p.from)} – ${thDate(p.to)}`}</div>
        <div class="total">${fmt(rows.length)} <small style="font-size:16px;font-weight:500">คลิก</small></div>
        <div class="stats">
          <span>ช่วงก่อนหน้า ${fmt(d.prevCount)}${diff == null ? "" : ` <b class="${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff)}%</b>`}</span>
          ${hourly ? "" : `<span>เฉลี่ย ${fmt(Math.round(rows.length / r.days * 10) / 10)}/วัน</span>`}
          ${lastT ? `<span>คลิกล่าสุด ${dayKey(lastT) === dayKey(Date.now()) ? "" : thDate(dayKey(lastT)) + " "}${thTime(lastT)} น.</span>` : ""}
        </div>
        ${d.capped ? `<p class="error small">ข้อมูลเยอะเกิน แสดงแค่ ${fmt(MAX_ROWS)} คลิกแรก เลือกช่วงที่สั้นลง</p>` : ""}
        ${chart(rows, p, hourly)}
        ${state.day ? `<div class="filter"><span>ดูเฉพาะ ${thDay(state.day)} (${fmt(rows2.length)} คลิก)</span><button data-act="clear-day">✕</button></div>` : ""}
      </div>`;

    // แท็บ
    const tabs = `<div class="tabs">${TABS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? "on" : ""}">${label}</button>`).join("")}</div>`;
    let body = "";
    if (!rows2.length) body = `<p class="empty">ยังไม่มีคลิกในช่วงนี้</p>`;
    else if (state.tab === "products") body = productList(rows2);
    else if (state.tab === "sites") body = siteList(rows2);
    else body = dayTable(rows2, p, hourly);

    const focused = document.activeElement?.id === "q";
    $("#content").innerHTML = summary + `<div class="card">${tabs}${body}</div>` +
      `<p class="note">นับทุกครั้งที่มีคนกดโฆษณาผ่านลิงก์ /go ของ Ad Hub (ไม่นับบอทที่มาเปิดดูตัวอย่างลิงก์) ไม่เก็บตัวตนผู้ชม คนเดิมกดซ้ำจึงนับซ้ำ ตัวเลขอาจมากกว่ารายงานของ Shopee ที่ตัดคลิกซ้ำออก วันที่ตามเวลาไทย · อัปเดต ${thTime(state.loadedAt)} น.</p>`;
    if (focused) { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function chart(rows, p, hourly) {
    let keys, labels, counts;
    if (hourly) {
      keys = Array.from({ length: 24 }, (_, h) => String(h));
      counts = count(rows, x => String(hourOf(x.t)));
      labels = ["0:00", "12:00", "23:00"];
    } else {
      keys = days(p);
      counts = count(rows, x => dayKey(x.t));
      labels = [thDate(keys[0]), thDate(keys[Math.floor((keys.length - 1) / 2)]), thDate(keys[keys.length - 1])];
    }
    const max = Math.max(1, ...counts.values());
    const bars = keys.map(k => {
      const n = counts.get(k) || 0;
      const attr = hourly ? "" : ` data-day="${k}"`;
      const title = hourly ? `${k}:00 น. ${n} คลิก` : `${thDay(k)} ${n} คลิก`;
      return `<div class="bar${n ? "" : " zero"}${state.day === k ? " sel" : ""}"${attr} title="${title}"><span style="height:${Math.max(1, n / max * 100)}%"></span></div>`;
    }).join("");
    return `<div class="chart">${bars}</div><div class="axis">${labels.map(l => `<span>${l}</span>`).join("")}</div>` +
      (hourly ? "" : `<div class="muted small" style="margin-top:4px">แตะแท่งเพื่อดูเฉพาะวันนั้น · สูงสุด ${fmt(max)}/วัน</div>`);
  }

  function productList(rows) {
    const q = state.q.trim().toLowerCase();
    let list = [...count(rows, x => x.p)].sort((a, b) => b[1] - a[1]);
    const top = list[0][1];
    if (q) list = list.filter(([id]) => (products.get(id)?.title || "").toLowerCase().includes(q) || String(id) === q.replace(/^#/, ""));
    const shown = list.slice(0, LIST_MAX);
    return `<input id="q" class="search" type="search" placeholder="ค้นหาชื่อสินค้า หรือ #รหัส" value="${esc(state.q)}">` +
      (shown.length ? `<ul class="rows">${shown.map(([id, n]) => {
        const pr = products.get(id);
        return `<li data-pid="${id}">
          ${pr?.image_url ? `<img src="${esc(pr.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="thumb"></span>`}
          <div class="name"><b>${esc(pr?.title || "สินค้าที่ถูกลบแล้ว")}</b><small>#${id}${pr?.shop ? " · " + esc(pr.shop) : ""}</small>
            <div class="share"><i style="width:${n / top * 100}%"></i></div></div>
          <div class="n">${fmt(n)}</div></li>`;
      }).join("")}</ul>` : `<p class="empty">ไม่พบสินค้า</p>`) +
      (list.length > LIST_MAX ? `<p class="muted small">แสดง ${LIST_MAX} จาก ${fmt(list.length)} รายการ</p>` : "");
  }

  function siteList(rows) {
    const list = [...count(rows, x => JSON.stringify([x.s, x.pl]))].sort((a, b) => b[1] - a[1]);
    return `<ul class="rows">${list.map(([k, n]) => { const [s, pl] = JSON.parse(k); return `<li><div class="name"><b>${siteLabel(s, pl)}</b></div><div class="n">${fmt(n)}</div></li>`; }).join("")}</ul>`;
  }

  function dayTable(rows, p, hourly) {
    if (hourly || state.day) {
      const c = count(rows, x => hourOf(x.t));
      const hours = Array.from({ length: 24 }, (_, h) => h).filter(h => c.get(h)).reverse();
      return `<table class="days"><tr><th>ชั่วโมง</th><th>คลิก</th></tr>${hours.map(h => `<tr><td>${h}:00 – ${h}:59</td><td>${fmt(c.get(h))}</td></tr>`).join("")}</table>`;
    }
    const c = count(rows, x => dayKey(x.t));
    return `<table class="days"><tr><th>วันที่</th><th>คลิก</th></tr>${days(p).reverse().map(k => `<tr data-day="${k}"><td>${thDay(k)}</td><td>${fmt(c.get(k) || 0)}</td></tr>`).join("")}</table>`;
  }

  // ---------- ยอดวิว transfer ----------
  async function loadViews() {
    const seq = ++state.seq;
    const r = VRANGES.find(x => x.id === state.vrange) || VRANGES[1];
    $("#main").classList.add("loading");
    $("#main-error").textContent = "";
    if (!state.vdata || state.vdata.r !== r) $("#content").innerHTML = `<p class="empty">กำลังโหลด…</p>`;
    try {
      const d = await http("/rest/v1/rpc/hub_transfer_stats", { method: "POST", body: { p_days: r.days } });
      if (seq !== state.seq) return;
      state.vdata = { r, v: d?.visitors || null, a: d?.analytics || null };
      state.loadedAt = Date.now();
      renderViews();
    } catch (e) {
      if (seq !== state.seq) return;
      if (e instanceof AuthError) return showLogin(e.message);
      const missing = /hub_transfer_stats/.test(e.message || "");
      $("#main-error").textContent = missing
        ? "ฐานข้อมูลยังไม่มีฟังก์ชัน hub_transfer_stats ให้รัน supabase/schema.sql ของ Ad Hub ซ้ำอีกครั้งใน SQL Editor"
        : "โหลดไม่สำเร็จ: " + (e.message || e) + (navigator.onLine === false ? " (ไม่มีอินเทอร์เน็ต)" : "");
      if (missing) $("#content").innerHTML = "";
    } finally {
      if (seq === state.seq) $("#main").classList.remove("loading");
    }
  }

  const dur = s => s == null ? "-" : s < 60 ? `${Math.round(s)} วินาที` : `${Math.floor(s / 60)} นาที ${Math.round(s % 60)} วินาที`;
  const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
  const arrow = d => d == null ? "" : ` <b class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}%</b>`;

  function bars(items, n, title) {
    const max = Math.max(1, ...items.map(n));
    return `<div class="chart">${items.map(x => `<div class="bar${n(x) ? "" : " zero"}" title="${esc(title(x))}"><span style="height:${Math.max(1, n(x) / max * 100)}%"></span></div>`).join("")}</div>`;
  }

  function list(items, label, n, sub = () => "") {
    if (!items?.length) return `<p class="empty">ยังไม่มีข้อมูลในช่วงนี้</p>`;
    const top = Math.max(1, ...items.map(n));
    return `<ul class="rows">${items.map(x => `<li><div class="name"><b>${esc(label(x))}</b>${sub(x) ? `<small>${sub(x)}</small>` : ""}
      <div class="share"><i style="width:${n(x) / top * 100}%"></i></div></div><div class="n">${fmt(n(x))}</div></li>`).join("")}</ul>`;
  }

  function renderViews() {
    const d = state.vdata;
    if (!d || state.mode !== "views") return;
    const { r, v, a } = d;
    const updated = ` · อัปเดต ${thTime(state.loadedAt)} น.`;
    if (!v) {
      $("#content").innerHTML = `<div class="card"><p class="empty">ยังไม่พบข้อมูลยอดวิวของเว็บ transfer ในโปรเจกต์ Supabase นี้</p>
        <p class="muted small">ยอดวิวมาจากตาราง page_views ของ transfer ต้องรันไฟล์ <code>supabase/visitors.sql</code> ของ repo transfer ในโปรเจกต์เดียวกับ Ad Hub ก่อน</p></div>`;
      return;
    }
    const hourly = r.days === 1;
    const daily = v.daily || [];
    const series = hourly ? (v.today_hourly || []) : daily;
    const keys = daily.map(x => String(x.day).slice(0, 10));
    const labels = hourly ? ["0:00", "12:00", "23:00"]
      : keys.length ? [thDate(keys[0]), thDate(keys[Math.floor((keys.length - 1) / 2)]), thDate(keys[keys.length - 1])] : [];
    const monthDiff = pct(v.month_unique, v.prev_month_unique);
    const summary = `
      <div class="card">
        <div class="muted">${hourly ? `วันนี้ ${keys.length ? thDay(keys[keys.length - 1]) : ""}` : keys.length ? `${thDate(keys[0])} – ${thDate(keys[keys.length - 1])}` : ""}</div>
        <div class="total">${fmt(v.total_views || 0)} <small style="font-size:16px;font-weight:500">ครั้งที่เปิดดู</small></div>
        <div class="stats">
          <span>ผู้ชมไม่ซ้ำ <b>${fmt(v.unique_visitors || 0)}</b> คน</span>
          ${hourly ? "" : `<span>วันนี้ ${fmt(v.today_views || 0)} ครั้ง (${fmt(v.today_unique || 0)} คน)</span>
          <span>เฉลี่ย ${fmt(Math.round((v.total_views || 0) / r.days * 10) / 10)}/วัน</span>`}
          <span>เดือนนี้ ${fmt(v.month_unique || 0)} คน · เดือนก่อน ${fmt(v.prev_month_unique || 0)}${arrow(monthDiff)}</span>
          <span>ทั้งหมดตั้งแต่เริ่มเก็บ ${fmt(v.all_time_views || 0)} ครั้ง</span>
        </div>
        ${bars(series, x => x.views, x => hourly ? `${x.hour}:00 น. ${x.views} ครั้ง ${x.visitors} คน` : `${thDay(String(x.day).slice(0, 10))} ${x.views} ครั้ง ${x.visitors} คน`)}
        <div class="axis">${labels.map(l => `<span>${l}</span>`).join("")}</div>
      </div>`;

    const tabs = `<div class="tabs">${VTABS.map(([id, label]) => `<button data-vtab="${id}" class="${state.vtab === id ? "on" : ""}">${label}</button>`).join("")}</div>`;
    const consent = `<p class="muted small">เฉพาะผู้ชมที่กดยอมรับคุกกี้บนเว็บ transfer จึงน้อยกว่ายอดวิวด้านบน</p>`;
    const noA = `<p class="empty">ยังไม่มีข้อมูลส่วนนี้ (ต้องรัน <code>supabase/analytics.sql</code> ของ transfer)</p>`;
    let body = "";
    if (state.vtab === "pages") {
      body = !a ? noA : consent + list(a.top_announcements, x => x.title || `ประกาศ #${x.id}`, x => x.views,
        x => `${fmt(x.clients)} คน${x.avg_duration_sec ? ` · อยู่เฉลี่ย ${dur(x.avg_duration_sec)}` : ""}`);
    } else if (state.vtab === "sources") {
      body = !a ? noA : consent +
        `<div class="stats" style="margin:0 0 8px"><span>${fmt(a.sessions || 0)} ครั้งที่เข้าเว็บ</span><span>${fmt(a.clients || 0)} คน</span>
          <span>ใหม่ ${fmt(a.new_clients || 0)} · กลับมาซ้ำ ${fmt(a.returning_clients || 0)}</span>
          <span>อยู่ในหน้าเฉลี่ย ${dur(a.avg_duration_sec)}</span></div>` +
        `<h2>มาจากไหน</h2>` + list(a.sources, x => SOURCES[x.source] || x.source, x => x.sessions) +
        (a.ref_hosts?.length ? `<h2 style="margin-top:12px">เว็บอื่นที่ส่งคนมา</h2>` + list(a.ref_hosts, x => x.ref_host, x => x.sessions) : "") +
        `<h2 style="margin-top:12px">อุปกรณ์ (คน)</h2>` + list(a.devices, x => DEVICES[x.device] || x.device, x => x.clients);
    } else if (state.vtab === "provinces") {
      body = list(v.provinces, x => x.province, x => x.visitors, x => `${fmt(x.views)} ครั้ง`) +
        `<p class="muted small">ตัวเลขด้านขวาคือจำนวนคน (ตามจังหวัดที่ระบบเดาจาก IP)</p>`;
    } else if (state.vtab === "hours") {
      const hours = v.hourly || [];
      const peak = hours.reduce((m, x) => x.views > (m?.views || 0) ? x : m, null);
      body = `<h2>ทุกชั่วโมงในช่วงนี้</h2>${bars(hours, x => x.views, x => `${x.hour}:00 น. ${x.views} ครั้ง`)}
        <div class="axis"><span>0:00</span><span>12:00</span><span>23:00</span></div>
        ${peak ? `<p class="muted small">คนเข้ามากสุดช่วง ${peak.hour}:00–${peak.hour}:59 น. (${fmt(peak.views)} ครั้ง)</p>` : ""}
        <h2 style="margin-top:12px">ตามวันในสัปดาห์</h2>
        <table class="days"><tr><th>วัน</th><th>คน</th><th>ครั้ง</th></tr>${(v.weekday || []).map(x =>
          `<tr><td>${WEEKDAYS[x.dow]}</td><td>${fmt(x.visitors)}</td><td>${fmt(x.views)}</td></tr>`).join("")}</table>`;
    } else {
      body = `<table class="days"><tr><th>วันที่</th><th>คน</th><th>ครั้ง</th></tr>${daily.slice().reverse().map(x =>
        `<tr><td>${thDay(String(x.day).slice(0, 10))}</td><td>${fmt(x.visitors)}</td><td>${fmt(x.views)}</td></tr>`).join("")}</table>`;
    }
    $("#content").innerHTML = summary + `<div class="card">${tabs}${body}</div>` +
      `<p class="note">นับทุกครั้งที่มีคนเปิดหน้าเว็บ transfer ผู้ชมไม่ซ้ำนับจากรหัส hash ของ IP (ไม่เก็บ IP เต็ม) วันที่ตามเวลาไทย${updated}</p>`;
  }

  document.addEventListener("input", e => {
    if (e.target.id !== "q") return;
    state.q = e.target.value;
    render();
  });

  function openProduct(id) {
    const d = state.data;
    const pr = products.get(id);
    const rows = d.rows.filter(x => x.p === id);
    const hourly = d.r.days === 1;
    const c = count(rows, x => dayKey(x.t));
    const daysHtml = hourly ? "" : `<div class="card"><h2>รายวัน</h2><table class="days"><tr><th>วันที่</th><th>คลิก</th></tr>${days(d.p).reverse().map(k => `<tr><td>${thDay(k)}</td><td>${fmt(c.get(k) || 0)}</td></tr>`).join("")}</table></div>`;
    $("#sheet-content").innerHTML = `
      <h2>${esc(pr?.title || "สินค้าที่ถูกลบแล้ว")}</h2>
      <div class="muted small">#${id}${pr?.shop ? " · " + esc(pr.shop) : ""}${pr?.source_id ? ` · รหัส${esc(pr.source || "")} ${esc(pr.source_id)}` : ""}</div>
      <div class="card"><div class="total">${fmt(rows.length)} <small style="font-size:16px;font-weight:500">คลิก</small></div>
        <div class="muted">${hourly ? thDay(d.p.from) : `${thDate(d.p.from)} – ${thDate(d.p.to)}`}</div>
        ${chart(rows, d.p, hourly).replace(/ data-day="[^"]*"/g, "").replace(/<div class="muted small"[\s\S]*$/, "")}</div>
      <div class="card"><h2>เว็บ/ตำแหน่ง</h2>${rows.length ? siteList(rows) : `<p class="empty">ไม่มีคลิก</p>`}</div>
      ${daysHtml}`;
    $("#sheet").hidden = false;
  }

  start();
})();
