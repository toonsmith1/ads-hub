// ==========================================
// หน้าจัดการ Ad Hub: คลังสินค้า ค้นหา กรอง หมวด แก้ทีละหลายรายการ นำเข้า เว็บที่แสดงโฆษณา
// ข้อมูลทั้งหมดผ่าน HubAPI (js/api.js) แต่ละส่วนของหน้ามีกล่องของตัวเอง วาดใหม่เฉพาะส่วนที่เปลี่ยน
// ==========================================
const STATUS = {
  pending: { label: "รอตรวจ", dot: "bg-amber-400", pill: "bg-amber-50 text-amber-700 ring-amber-200" },
  active: { label: "กำลังแสดง", dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  paused: { label: "พักไว้", dot: "bg-slate-400", pill: "bg-slate-100 text-slate-600 ring-slate-200" },
  expired: { label: "หมดอายุ", dot: "bg-rose-400", pill: "bg-rose-50 text-rose-700 ring-rose-200" },
};
const SORTS = [
  ["updated", "แก้ไขล่าสุด"], ["created", "เพิ่มล่าสุด"], ["commission", "ค่าคอมสูงสุด"],
  ["priceAsc", "ราคาต่ำไปสูง"], ["priceDesc", "ราคาสูงไปต่ำ"], ["title", "ชื่อ ก-ฮ"],
];
const PAGE_SIZE = 48;
const IMPORT_CHUNK = 200;
const STATS_DAYS = 30;

const state = {
  admin: false,
  cats: [],
  counts: [],
  sources: [],
  f: { q: "", status: "all", cat: "all", source: "", minCommission: "", minPrice: "", maxPrice: "", sort: "updated" },
  page: 1,
  rows: [],
  total: 0,
  loading: false,
  selected: new Set(),
  view: localGet("hub.view") || "grid",
  drawer: null,   // สินค้าที่กำลังแก้ (สำเนา)
  modal: null,    // "import" | "categories" | "sites" | "ai" | "stats"
  ai: null,       // ฟอร์มตั้งค่า AI (โหลดตอนเปิดหน้าต่าง)
  dash: null,     // แดชบอร์ดสถิติ {days, data}
  importer: null,
  stats: {},      // { [product_id]: {views, clicks} } ของสินค้าในหน้านี้ ย้อนหลัง STATS_DAYS วัน
  sites: null,    // เว็บที่แสดงโฆษณา พร้อม hub_placements (โหลดตอนเปิดหน้าต่าง)
  pinTitles: {},  // ชื่อสินค้าที่ปักหมุด { [id]: {title, status} }
};

// ---------- เครื่องมือเล็กๆ ----------
function localGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ไม่มีที่เก็บก็ใช้ค่าเริ่มต้น */ } }
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtNum = (v) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 }));
const priceLabel = (p) => p.price_text || (p.price != null ? `฿${fmtNum(p.price)}` : "-");
const catById = (id) => state.cats.find(c => c.id === id);
const catName = (id) => catById(id)?.name || "";

function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `px-4 py-2.5 rounded-lg shadow-lg text-sm text-white ${kind === "error" ? "bg-rose-600" : "bg-slate-900"}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 3000);
}

async function guard(fn, okMsg) {
  try {
    const out = await fn();
    if (okMsg) toast(okMsg);
    return out;
  } catch (err) {
    console.error(err);
    toast(`ทำไม่สำเร็จ: ${err.message}`, "error");
    return undefined;
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- เริ่มต้น / ล็อกอิน ----------
async function boot() {
  if (!HubAPI.configured) return renderSetupNeeded();
  const session = await guard(() => HubAPI.session());
  if (!session) return renderLogin();
  state.admin = await guard(() => HubAPI.isAdmin());
  if (!state.admin) return renderNotAdmin(session);
  renderShell();
  await Promise.all([loadCats(), loadSources()]);
  await refresh();
}

function centered(inner) {
  $("#app").innerHTML = `<div class="min-h-screen grid place-items-center p-4"><div class="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-6">${inner}</div></div>`;
}

function renderSetupNeeded() {
  centered(`<h1 class="text-lg font-semibold">ยังไม่ได้ตั้งค่า Supabase</h1>
    <p class="mt-2 text-sm text-slate-600">ใส่ Project URL และ Publishable key ในไฟล์ <code class="px-1 bg-slate-100 rounded">web/config.js</code> ตามขั้นตอนใน README</p>`);
}

function renderLogin() {
  centered(`<div class="flex items-center gap-2 mb-5">${logo()}<span class="text-lg font-semibold">Ad Hub</span></div>
    <form id="loginForm" class="space-y-3">
      <label class="block"><span class="text-sm text-slate-600">อีเมล</span>
        <input name="email" type="email" required autocomplete="username" class="${INPUT} mt-1 w-full"></label>
      <label class="block"><span class="text-sm text-slate-600">รหัสผ่าน</span>
        <input name="password" type="password" required autocomplete="current-password" class="${INPUT} mt-1 w-full"></label>
      <button class="${BTN_PRIMARY} w-full h-10">เข้าสู่ระบบ</button>
    </form>`);
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ok = await guard(() => HubAPI.signIn(fd.get("email"), fd.get("password")));
    if (ok) boot();
  };
}

function renderNotAdmin(session) {
  centered(`<h1 class="text-lg font-semibold">บัญชีนี้ยังไม่ใช่แอดมิน</h1>
    <p class="mt-2 text-sm text-slate-600">รันคำสั่งนี้ใน SQL Editor ของ Supabase หนึ่งครั้ง แล้วรีเฟรชหน้านี้</p>
    <pre class="mt-3 p-3 bg-slate-900 text-slate-100 rounded-lg text-xs whitespace-pre-wrap break-all">insert into hub_admins (user_id, email)
select id, email from auth.users where email = '${esc(session.user?.email || "")}';</pre>
    <button data-act="signout" class="${BTN} mt-4 w-full h-9">ออกจากระบบ</button>`);
  $("#app").onclick = (e) => { if (e.target.closest("[data-act=signout]")) HubAPI.signOut().then(boot); };
}

// ---------- โครงหน้า ----------
const INPUT = "h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500";
const BTN = "inline-flex items-center justify-center gap-1.5 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const BTN_PRIMARY = "inline-flex items-center justify-center gap-1.5 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50";
const BTN_DANGER = "inline-flex items-center justify-center gap-1.5 px-3 rounded-lg border border-rose-200 bg-white text-sm text-rose-600 hover:bg-rose-50";

function logo() {
  return `<span class="w-8 h-8 rounded-lg bg-brand-600 text-white grid place-items-center font-bold text-sm">AH</span>`;
}

function renderShell() {
  $("#app").innerHTML = `
    <header class="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
      <div class="h-16 px-4 lg:px-6 flex items-center gap-4">
        <div class="flex items-center gap-2 shrink-0">${logo()}<span class="font-semibold hidden sm:inline">Ad Hub</span></div>
        <div class="relative flex-1 max-w-2xl">
          <svg class="absolute left-3 top-2.5 w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.64 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.64A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd"/></svg>
          <input id="search" type="search" placeholder="ค้นหาชื่อสินค้า ร้าน หรือโน้ต  ( / )" class="${INPUT} w-full pl-9 h-10" autocomplete="off">
        </div>
        <button data-act="open-stats" class="${BTN} h-10 shrink-0">สถิติ</button>
        <button data-act="open-sites" class="${BTN} h-10 shrink-0">เว็บที่แสดงโฆษณา</button>
        <button data-act="open-ai" class="${BTN} h-10 shrink-0">ตั้งค่า AI</button>
        <button data-act="new-product" class="${BTN} h-10 shrink-0">+ เพิ่มสินค้าเอง</button>
        <button data-act="open-import" class="${BTN_PRIMARY} h-10 shrink-0">+ นำเข้าสินค้า</button>
        <button data-act="signout" class="${BTN} h-10 shrink-0 hidden md:inline-flex">ออกจากระบบ</button>
      </div>
    </header>
    <div class="flex">
      <aside id="sidebar" class="hidden lg:block w-64 shrink-0 border-r border-slate-200 bg-white min-h-[calc(100vh-4rem)] sticky top-16 self-start max-h-[calc(100vh-4rem)] overflow-y-auto"></aside>
      <main class="flex-1 min-w-0 px-4 lg:px-6 py-5">
        <div id="filters"></div>
        <div id="results" class="mt-4"></div>
      </main>
    </div>
    <div id="bulkbar"></div>
    <div id="drawer"></div>
    <div id="modal"></div>`;

  const search = $("#search");
  const onSearch = debounce(() => { state.f.q = search.value; state.page = 1; refresh(); }, 250);
  search.oninput = onSearch;
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); search.focus(); }
    if (e.key === "Escape") { if (state.modal) closeModal(); else if (state.drawer) closeDrawer(); }
  });
  $("#app").onclick = onClick;
  $("#app").onchange = onChange;
  renderFilters();
}

// ---------- โหลดข้อมูล ----------
async function loadCats() {
  state.cats = (await guard(() => HubAPI.categories())) || [];
  state.counts = (await guard(() => HubAPI.counts())) || [];
  renderSidebar();
}

async function loadSources() {
  state.sources = (await guard(() => HubAPI.sources())) || [];
  renderFilters();
}

// หมวดที่เลือก + หมวดย่อยของมัน
function categoryFilter() {
  if (state.f.cat === "all") return null;
  if (state.f.cat === "none") return [];
  const id = Number(state.f.cat);
  return [id, ...state.cats.filter(c => c.parent_id === id).map(c => c.id)];
}

let refreshSeq = 0;
async function refresh() {
  const seq = ++refreshSeq;
  state.loading = true;
  renderResults();
  const out = await guard(() => HubAPI.products({ ...state.f, categoryIds: categoryFilter(), page: state.page, pageSize: PAGE_SIZE }));
  if (seq !== refreshSeq) return;   // มีการค้นหาใหม่ระหว่างรอ
  state.loading = false;
  state.rows = out?.rows || [];
  state.total = out?.total || 0;
  renderResults();
  loadStats(seq);
}

// สถิติไม่ใช่ส่วนสำคัญของหน้า โหลดตามหลัง ถ้าพลาด (เช่นยังไม่ได้รัน schema เฟส 3) ก็แค่ไม่แสดง
async function loadStats(seq) {
  const ids = state.rows.map(r => r.id);
  let stats = {};
  try { stats = await HubAPI.productStats(ids, STATS_DAYS); } catch (err) { console.warn("stats", err); }
  if (seq !== refreshSeq) return;
  state.stats = stats;
  renderResults();
}

function statsText(id) {
  const st = state.stats[id];
  return st ? `คลิก ${fmtNum(st.clicks)} · แสดง ${fmtNum(st.views)}` : "ยังไม่มีคลิก";
}

async function reloadAll() {
  await Promise.all([loadCats(), loadSources()]);
  await refresh();
}

// ---------- แถบด้านข้าง: สถานะ + หมวด ----------
function countWhere(fn) {
  return state.counts.filter(fn).reduce((n, r) => n + Number(r.total), 0);
}

function renderSidebar() {
  const el = $("#sidebar");
  if (!el) return;
  const statusItem = (key, label, dot) => {
    const n = key === "all" ? countWhere(() => true) : countWhere(r => r.status === key);
    const on = state.f.status === key;
    return `<button data-act="status" data-v="${key}" class="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm ${on ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-50"}">
      ${dot ? `<span class="w-2 h-2 rounded-full ${dot}"></span>` : `<span class="w-2 h-2"></span>`}
      <span class="flex-1 text-left">${label}</span><span class="text-xs ${on ? "text-brand-600" : "text-slate-400"}">${fmtNum(n)}</span></button>`;
  };
  const catCount = (id) => countWhere(r => r.category_id === id);
  const catItem = (c, depth) => {
    const kids = state.cats.filter(k => k.parent_id === c.id);
    const n = catCount(c.id) + kids.reduce((s, k) => s + catCount(k.id), 0);
    const on = String(state.f.cat) === String(c.id);
    return `<button data-act="cat" data-v="${c.id}" class="w-full flex items-center gap-2 h-8 pr-3 rounded-lg text-sm ${on ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-50"}" style="padding-left:${12 + depth * 16}px">
        <span class="flex-1 text-left truncate">${esc(c.name)}</span><span class="text-xs ${on ? "text-brand-600" : "text-slate-400"}">${fmtNum(n)}</span></button>`
      + kids.map(k => catItem(k, depth + 1)).join("");
  };
  const roots = state.cats.filter(c => !c.parent_id || !catById(c.parent_id));
  const noneOn = state.f.cat === "none";
  el.innerHTML = `
    <div class="p-3">
      <div class="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400">สถานะ</div>
      ${statusItem("all", "ทั้งหมด", "")}
      ${Object.entries(STATUS).map(([k, s]) => statusItem(k, s.label, s.dot)).join("")}
      <div class="mt-4 px-3 pt-2 pb-1 flex items-center justify-between">
        <span class="text-[11px] font-semibold tracking-wide text-slate-400">หมวดหมู่</span>
        <button data-act="open-categories" class="text-xs text-brand-600 hover:underline">จัดการ</button>
      </div>
      <button data-act="cat" data-v="all" class="w-full flex items-center h-8 px-3 rounded-lg text-sm ${state.f.cat === "all" ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-600 hover:bg-slate-50"}">ทุกหมวด</button>
      ${roots.map(c => catItem(c, 0)).join("")}
      <button data-act="cat" data-v="none" class="w-full flex items-center gap-2 h-8 px-3 rounded-lg text-sm ${noneOn ? "bg-brand-50 text-brand-700 font-semibold" : "text-slate-500 hover:bg-slate-50"}">
        <span class="flex-1 text-left italic">ยังไม่มีหมวด</span><span class="text-xs text-slate-400">${fmtNum(countWhere(r => r.category_id === null))}</span></button>
    </div>`;
}

// ---------- แถวตัวกรอง ----------
function renderFilters() {
  const el = $("#filters");
  if (!el) return;
  const f = state.f;
  const catOptions = [`<option value="all">ทุกหมวด</option>`, `<option value="none" ${f.cat === "none" ? "selected" : ""}>ยังไม่มีหมวด</option>`]
    .concat(state.cats.map(c => `<option value="${c.id}" ${String(f.cat) === String(c.id) ? "selected" : ""}>${c.parent_id ? "— " : ""}${esc(c.name)}</option>`)).join("");
  el.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <select data-f="cat" class="${INPUT} lg:hidden">${catOptions}</select>
      <select data-f="status" class="${INPUT} lg:hidden">
        <option value="all">ทุกสถานะ</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
      <select data-f="source" class="${INPUT}">
        <option value="">ทุกแหล่ง</option>${state.sources.map(s => `<option value="${esc(s)}" ${f.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
      <div class="flex items-center gap-1">
        <input data-f="minPrice" type="number" min="0" placeholder="ราคาต่ำสุด" value="${esc(f.minPrice)}" class="${INPUT} w-28">
        <span class="text-slate-400">–</span>
        <input data-f="maxPrice" type="number" min="0" placeholder="สูงสุด" value="${esc(f.maxPrice)}" class="${INPUT} w-24">
      </div>
      <input data-f="minCommission" type="number" min="0" max="100" placeholder="ค่าคอมขั้นต่ำ %" value="${esc(f.minCommission)}" class="${INPUT} w-36">
      <div class="flex-1"></div>
      <select data-f="sort" class="${INPUT}">${SORTS.map(([k, l]) => `<option value="${k}" ${f.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <div class="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
        ${["grid", "table"].map(v => `<button data-act="view" data-v="${v}" class="h-8 px-3 rounded-md text-sm ${state.view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}">${v === "grid" ? "การ์ด" : "ตาราง"}</button>`).join("")}
      </div>
    </div>`;
}

// ---------- ผลลัพธ์ ----------
function renderResults() {
  const el = $("#results");
  if (!el) return;
  if (state.loading && !state.rows.length) {
    el.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">${Array.from({ length: 12 }, () =>
      `<div class="rounded-xl border border-slate-200 bg-white overflow-hidden"><div class="skeleton aspect-square"></div><div class="p-3 space-y-2"><div class="skeleton h-3 rounded"></div><div class="skeleton h-3 w-2/3 rounded"></div></div></div>`).join("")}</div>`;
    return;
  }
  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  const allOnPage = state.rows.length > 0 && state.rows.every(r => state.selected.has(r.id));
  const head = `
    <div class="flex items-center gap-3 mb-3 text-sm text-slate-600">
      <label class="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" data-act="select-page" ${allOnPage ? "checked" : ""} class="rounded border-slate-300"> เลือกทั้งหน้า</label>
      <span class="text-slate-400">·</span>
      <span>พบ <b class="text-slate-800">${fmtNum(state.total)}</b> รายการ${state.loading ? ' <span class="text-slate-400">กำลังโหลด…</span>' : ""}</span>
    </div>`;
  const body = !state.rows.length ? emptyState() : state.view === "table" ? tableHtml() : gridHtml();
  const pager = pages > 1 ? `
    <div class="mt-6 flex items-center justify-center gap-2 text-sm">
      <button data-act="page" data-v="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""} class="${BTN} h-9">ก่อนหน้า</button>
      <span class="px-3 text-slate-600">หน้า ${state.page} / ${pages}</span>
      <button data-act="page" data-v="${state.page + 1}" ${state.page >= pages ? "disabled" : ""} class="${BTN} h-9">ถัดไป</button>
    </div>` : "";
  el.innerHTML = head + body + pager;
  renderBulkbar();
}

function emptyState() {
  const filtered = state.f.q || state.f.status !== "all" || state.f.cat !== "all" || state.f.source || state.f.minPrice || state.f.maxPrice || state.f.minCommission;
  return `<div class="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
    <div class="text-slate-800 font-semibold">${filtered ? "ไม่พบสินค้าที่ตรงกับตัวกรอง" : "ยังไม่มีสินค้าในคลัง"}</div>
    <div class="mt-1 text-sm text-slate-500">${filtered ? "ลองล้างตัวกรองหรือค้นด้วยคำอื่น" : "เริ่มจากนำเข้าไฟล์ CSV หรือย้ายโฆษณาเดิมเข้ามา"}</div>
    <div class="mt-4">${filtered ? `<button data-act="clear-filters" class="${BTN} h-9">ล้างตัวกรอง</button>` : `<button data-act="open-import" class="${BTN_PRIMARY} h-9">+ นำเข้าสินค้า</button>`}</div>
  </div>`;
}

function statusPill(s) {
  const st = STATUS[s] || STATUS.pending;
  return `<span class="inline-flex items-center gap-1 px-2 h-5 rounded-full text-[11px] font-medium ring-1 ${st.pill}"><span class="w-1.5 h-1.5 rounded-full ${st.dot}"></span>${st.label}</span>`;
}

function thumb(p, cls) {
  return p.image_url
    ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="${cls}">`
    : `<div class="${cls} grid place-items-center bg-slate-100 text-slate-400 text-xs">ไม่มีรูป</div>`;
}

function gridHtml() {
  return `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">${state.rows.map(p => {
    const sel = state.selected.has(p.id);
    return `<article data-act="edit" data-id="${p.id}" class="group relative rounded-xl border ${sel ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200"} bg-white overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
      <div class="relative">
        ${thumb(p, "card-img w-full")}
        <label data-stop class="absolute top-2 left-2 ${sel ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity">
          <input type="checkbox" data-act="select" data-id="${p.id}" ${sel ? "checked" : ""} class="w-5 h-5 rounded border-slate-300 shadow"></label>
        ${p.commission != null ? `<span class="absolute top-2 right-2 px-2 h-6 inline-flex items-center rounded-full bg-white/95 text-[11px] font-semibold text-brand-700 shadow-sm">คอม ${fmtNum(p.commission)}%</span>` : ""}
      </div>
      <div class="p-3">
        <h3 class="text-sm leading-snug text-slate-800 line-clamp-2 min-h-[2.5rem]">${esc(p.title)}</h3>
        <div class="mt-1.5 text-base font-semibold text-rose-600">${esc(priceLabel(p))}</div>
        <div class="mt-2 flex items-center justify-between gap-2">${statusPill(p.status)}<span class="text-[11px] text-slate-400 truncate">${esc(p.shop || p.source)}</span></div>
        ${p.category_id ? `<div class="mt-2 text-[11px] text-slate-500 truncate">${esc(catName(p.category_id))}</div>` : `<div class="mt-2 text-[11px] text-amber-600">ยังไม่มีหมวด</div>`}
        <div class="mt-1 text-[11px] text-slate-400 truncate" title="${STATS_DAYS} วันล่าสุด">${statsText(p.id)}</div>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function tableHtml() {
  return `<div class="rounded-xl border border-slate-200 bg-white overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-xs text-slate-500"><tr>
        <th class="w-10 py-2.5 px-3"></th><th class="py-2.5 px-3 text-left font-medium">สินค้า</th>
        <th class="py-2.5 px-3 text-left font-medium">หมวด</th><th class="py-2.5 px-3 text-right font-medium">ราคา</th>
        <th class="py-2.5 px-3 text-right font-medium">ค่าคอม</th><th class="py-2.5 px-3 text-right font-medium">คลิก ${STATS_DAYS} วัน</th><th class="py-2.5 px-3 text-left font-medium">สถานะ</th>
        <th class="py-2.5 px-3 text-left font-medium">แก้ไขล่าสุด</th></tr></thead>
      <tbody>${state.rows.map(p => `
        <tr data-act="edit" data-id="${p.id}" class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${state.selected.has(p.id) ? "bg-brand-50/60" : ""}">
          <td class="py-2 px-3" data-stop><input type="checkbox" data-act="select" data-id="${p.id}" ${state.selected.has(p.id) ? "checked" : ""} class="rounded border-slate-300"></td>
          <td class="py-2 px-3"><div class="flex items-center gap-3 min-w-[260px]">${thumb(p, "w-11 h-11 rounded-lg object-cover shrink-0")}
            <div class="min-w-0"><div class="text-slate-800 line-clamp-2">${esc(p.title)}</div><div class="text-xs text-slate-400">${esc([p.shop, p.source].filter(Boolean).join(" · "))}</div></div></div></td>
          <td class="py-2 px-3 text-slate-600 whitespace-nowrap">${esc(catName(p.category_id)) || '<span class="text-amber-600">-</span>'}</td>
          <td class="py-2 px-3 text-right whitespace-nowrap font-medium">${esc(priceLabel(p))}</td>
          <td class="py-2 px-3 text-right whitespace-nowrap">${p.commission != null ? `${fmtNum(p.commission)}%` : "-"}</td>
          <td class="py-2 px-3 text-right whitespace-nowrap">${fmtNum(state.stats[p.id]?.clicks || 0)}</td>
          <td class="py-2 px-3">${statusPill(p.status)}</td>
          <td class="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">${p.updated_at ? new Date(p.updated_at).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : ""}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

// ---------- แก้ทีละหลายรายการ ----------
function renderBulkbar() {
  const el = $("#bulkbar");
  if (!el) return;
  const n = state.selected.size;
  if (!n) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-4xl">
      <div class="flex flex-wrap items-center gap-2 px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl">
        <span class="text-sm font-semibold mr-1">เลือก ${fmtNum(n)} รายการ</span>
        <select data-bulk="category" class="h-9 px-2 rounded-lg bg-slate-800 border border-slate-700 text-sm">
          <option value="">ย้ายไปหมวด…</option><option value="none">(ไม่มีหมวด)</option>
          ${state.cats.map(c => `<option value="${c.id}">${c.parent_id ? "— " : ""}${esc(c.name)}</option>`).join("")}
        </select>
        <select data-bulk="status" class="h-9 px-2 rounded-lg bg-slate-800 border border-slate-700 text-sm">
          <option value="">เปลี่ยนสถานะ…</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("")}
        </select>
        <button data-act="bulk-delete" class="h-9 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm">ลบ</button>
        <div class="flex-1"></div>
        <button data-act="bulk-clear" class="h-9 px-3 rounded-lg hover:bg-slate-800 text-sm text-slate-300">ยกเลิกการเลือก</button>
      </div>
    </div>`;
}

async function bulkUpdate(patch, label) {
  const ids = [...state.selected];
  if (!(await guard(() => HubAPI.updateProducts(ids, patch), `${label} ${ids.length} รายการแล้ว`))) return renderBulkbar();
  state.selected.clear();
  await reloadAll();
}

// ---------- แผงแก้ไขสินค้า ----------
function openDrawer(id) {
  // เพิ่มเอง (เช่นลิงก์จาก AccessTrade): แอดมินเลือกมาแล้ว จึงเริ่มเป็น "กำลังแสดง"
  const p = id === "new" ? { title: "", link: "", status: "active", weight: 1, tags: [] } : state.rows.find(r => r.id === id);
  if (!p) return;
  state.drawer = { ...p, tags: [...(p.tags || [])] };
  renderDrawer();
}

function closeDrawer() {
  state.drawer = null;
  renderDrawer();
}

function field(label, inner, hint = "") {
  return `<label class="block"><span class="text-xs font-medium text-slate-600">${label}</span>${inner}${hint ? `<span class="block mt-1 text-[11px] text-slate-400">${hint}</span>` : ""}</label>`;
}

function renderDrawer() {
  const el = $("#drawer");
  if (!el) return;
  const p = state.drawer;
  if (!p) { el.innerHTML = ""; return; }
  const input = (k, attrs = "") => `<input data-d="${k}" value="${esc(p[k] ?? "")}" ${attrs} class="${INPUT} mt-1 w-full">`;
  el.innerHTML = `
    <div class="fixed inset-0 z-50">
      <div data-act="close-drawer" class="absolute inset-0 bg-slate-900/30"></div>
      <section class="drawer-enter absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <header class="h-14 px-5 flex items-center justify-between border-b border-slate-200">
          <h2 class="font-semibold">${p.id ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</h2>
          <button data-act="close-drawer" class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="ปิด">✕</button>
        </header>
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <div class="flex gap-4">
            <div class="w-36 shrink-0">
              ${thumb(p, "w-36 h-36 rounded-xl object-cover border border-slate-200")}
              <label class="${BTN} h-8 w-full mt-2 cursor-pointer">${p._uploading ? "กำลังอัปโหลด…" : "อัปโหลดรูปใหม่"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-act="upload" class="hidden"></label>
            </div>
            <div class="flex-1 space-y-3">
              ${field("ชื่อสินค้า", `<textarea data-d="title" rows="3" class="${INPUT} h-auto py-2 mt-1 w-full">${esc(p.title)}</textarea>`)}
              ${field("สถานะ", `<select data-d="status" class="${INPUT} mt-1 w-full">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${s.label}</option>`).join("")}</select>`)}
            </div>
          </div>
          ${field("ลิงก์ affiliate", `<div class="flex gap-2 mt-1"><input data-d="link" value="${esc(p.link)}" class="${INPUT} flex-1"><a href="${esc(p.link)}" target="_blank" rel="noopener" class="${BTN} h-9">เปิด</a></div>`)}
          ${field("ลิงก์รูป", input("image_url"), "วางลิงก์รูป หรือกดอัปโหลดรูปใหม่ด้านบน")}
          <div class="grid grid-cols-2 gap-3">
            ${field("ราคา (ข้อความที่แสดง)", input("price_text", 'placeholder="฿320"'))}
            ${field("ราคา (ตัวเลข ใช้กรอง)", input("price", 'type="number" min="0" step="0.01"'))}
            ${field("ค่าคอม %", input("commission", 'type="number" min="0" max="100" step="0.01"'))}
            ${field("ยอดขาย", input("sold_text"))}
            ${field("ร้าน / ผู้ลงโฆษณา", input("shop"))}
            ${field("หมวดหมู่", `<select data-d="category_id" class="${INPUT} mt-1 w-full"><option value="">(ไม่มีหมวด)</option>${state.cats.map(c => `<option value="${c.id}" ${p.category_id === c.id ? "selected" : ""}>${c.parent_id ? "— " : ""}${esc(c.name)}</option>`).join("")}</select>`)}
          </div>
          ${field("คำโปรย", `<textarea data-d="caption" rows="2" maxlength="300" placeholder="เช่น ราคา ฿350 ส่งฟรี" class="${INPUT} h-auto py-2 mt-1 w-full">${esc(p.caption || "")}</textarea>`, "ข้อความสั้นใต้หัวข้อบนการ์ดโฆษณา เว้นว่างได้ (เว็บที่แสดงจะใช้ราคาแทน)")}
          ${field("แท็ก", `<input data-d="tags" value="${esc((p.tags || []).join(", "))}" class="${INPUT} mt-1 w-full">`, "คั่นด้วยจุลภาค เช่น ลดราคา, ของขวัญ")}
          <div class="grid grid-cols-3 gap-3">
            ${field("น้ำหนักการสุ่ม", input("weight", 'type="number" min="1" max="10"'), "1–10 ยิ่งมากยิ่งขึ้นบ่อย")}
            ${field("เริ่มแสดง", input("starts_on", 'type="date"'))}
            ${field("หยุดแสดง", input("ends_on", 'type="date"'))}
          </div>
          ${reviewSection(p)}
          ${field("โน้ต", `<textarea data-d="note" rows="2" class="${INPUT} h-auto py-2 mt-1 w-full">${esc(p.note || "")}</textarea>`)}
          ${p.id ? `<div class="text-xs text-slate-600">${STATS_DAYS} วันล่าสุด: ${statsText(p.id)}</div>` : ""}
          ${p.id ? `<div>
            <div class="flex items-center justify-between text-[11px] text-slate-500"><span>โค้ดฝังสินค้านี้ เช่นในหน้ารีวิว (เปลี่ยน review เป็นคีย์จุดที่วางของเว็บนั้น)</span>
              <button data-act="copy-embed" data-id="product-${p.id}" class="text-brand-600 hover:underline">คัดลอก</button></div>
            <pre class="mt-1 p-2 bg-slate-900 text-slate-100 rounded-lg text-xs whitespace-pre-wrap break-all" data-embed="product-${p.id}">${esc(`<div data-adhub="review" data-product="${p.id}" data-layout="review"></div>`)}</pre>
          </div>` : ""}
          ${p.id ? `<div class="text-[11px] text-slate-400">รหัส Ad Hub #${p.id} (ใช้ปักหมุด) · แหล่ง ${esc(p.source || "-")}${p.source_id ? ` · รหัส ${esc(p.source_id)}` : ""} · เพิ่มเมื่อ ${p.created_at ? new Date(p.created_at).toLocaleString("th-TH") : "-"}</div>` : ""}
        </div>
        <!-- เว้นด้านล่างให้พ้นป้าย "Powered by Netlify" ที่ลอยอยู่มุมขวาล่าง -->
        <footer class="px-5 pt-3 pb-20 border-t border-slate-200 flex items-center gap-2">
          ${p.id ? `<button data-act="delete-one" class="${BTN_DANGER} h-9">ลบ</button>` : ""}
          <div class="flex-1"></div>
          <button data-act="close-drawer" class="${BTN} h-9">ยกเลิก</button>
          <button data-act="save-drawer" class="${BTN_PRIMARY} h-9">บันทึก</button>
        </footer>
      </section>
    </div>`;
}

// รูปทั้งหมด รายละเอียด และข้อมูลจำเพาะจากหน้าสินค้า (extension ดึงมา) ใช้เป็นข้อมูลทำรีวิว
function reviewSection(p) {
  const imgs = p.images || [];
  const d = p.details || {};
  const facts = [
    d.brand && `แบรนด์ ${esc(d.brand)}`,
    d.rating && `คะแนน ${esc(d.rating)}${d.rating_count ? ` (${Number(d.rating_count).toLocaleString("th-TH")} รีวิว)` : ""}`,
    d.detail_url && `<a href="${esc(d.detail_url)}" target="_blank" rel="noopener" class="text-brand-600 hover:underline">หน้าสินค้า</a>`,
  ].filter(Boolean);
  const specs = Object.entries(d.specs || {});
  return `<div class="space-y-2" data-review>
    <div class="text-xs font-medium text-slate-600">รูปทั้งหมดจากหน้าสินค้า (${imgs.length})
      ${imgs.length ? `<span class="font-normal text-slate-400">· กดรูปเพื่อใช้เป็นรูปปก · กด × เพื่อลบรูปที่ไม่เอา</span>` : ""}</div>
    ${imgs.length ? `<div class="grid grid-cols-5 gap-2">${imgs.map(u => `
      <div class="relative aspect-square">
        <button type="button" data-act="use-image" data-url="${esc(u)}" title="ใช้เป็นรูปปก"
          class="w-full h-full rounded-lg overflow-hidden border ${u === p.image_url ? "border-brand-500 ring-2 ring-brand-200" : "border-slate-200"}">
          <img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover"></button>
        <button type="button" data-act="remove-image" data-url="${esc(u)}" title="ลบรูปนี้"
          class="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 hover:bg-red-600 text-white text-sm leading-6">×</button>
      </div>`).join("")}</div>`
      : `<div class="text-[11px] text-slate-400">ยังไม่มี ส่งเข้าคลังจาก extension โดยเลือก "เปิดหน้าสินค้า" เพื่อดึงรูปทั้งหมดและรายละเอียด</div>`}
    ${facts.length ? `<div class="text-xs text-slate-600">${facts.join(" · ")}</div>` : ""}
    ${specs.length ? `<dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">${specs.map(([k, v]) => `<dt class="text-slate-500">${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
    ${field("รายละเอียดสินค้า", `<textarea data-d="description" rows="6" class="${INPUT} h-auto py-2 mt-1 w-full">${esc(p.description || "")}</textarea>`)}
    <div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-medium text-slate-600">รีวิว (แสดงในกล่องรีวิวของเว็บรีวิว)</span>
        <span class="flex gap-2">
          <button type="button" data-act="ai-review" ${p.id && !p._writing ? "" : "disabled"} class="${BTN} h-8 disabled:opacity-50"
            title="${p.id ? "ใช้ข้อมูลที่บันทึกแล้ว ถ้า AI ใช้ไม่ได้จะสุ่มแบบป้ายยาแทน" : "บันทึกสินค้าก่อน"}">${p._writing ? "AI กำลังเขียน…" : "เขียนด้วย AI"}</button>
          <button type="button" data-act="spin-review" class="${BTN} h-8">สุ่มแบบป้ายยา</button>
        </span>
      </div>
      <textarea data-d="review" rows="8" class="${INPUT} h-auto py-2 mt-1 w-full" placeholder="กดปุ่มด้านบนเพื่อร่าง แล้วแก้ก่อนกดบันทึก">${esc(p.review || "")}</textarea>
      <div class="text-[11px] text-slate-400 mt-1">ตรวจข้อความก่อนบันทึก AI อาจเขียนผิด ส่วนแบบสุ่มใช้ได้ทันทีไม่เสียโทเคน</div>
    </div>
  </div>`;
}

// ลบรูปออกจากรูปทั้งหมด (มีผลเมื่อกดบันทึก) และจำไว้ใน details.removed_images
// เพื่อให้นำเข้าสินค้าชิ้นเดิมซ้ำแล้วรูปที่ลบไม่กลับมา ถ้าลบรูปที่เป็นรูปปก ใช้รูปถัดไปแทน
function removeImage(p, url) {
  p.images = (p.images || []).filter(u => u !== url);
  const removed = new Set((p.details && p.details.removed_images) || []);
  removed.add(url);
  p.details = { ...(p.details || {}), removed_images: [...removed] };
  if (p.image_url === url) p.image_url = p.images[0] || "";
}

function readDrawerInputs() {
  const p = state.drawer;
  document.querySelectorAll("#drawer [data-d]").forEach(inp => {
    const k = inp.dataset.d;
    let v = inp.value;
    if (k === "tags") v = v.split(",").map(t => t.trim()).filter(Boolean);
    else if (["price", "commission"].includes(k)) v = v === "" ? null : Number(v);
    else if (k === "weight") v = Math.min(10, Math.max(1, Number(v) || 1));
    else if (k === "category_id") v = v ? Number(v) : null;
    else if (["starts_on", "ends_on"].includes(k)) v = v || null;
    p[k] = v;
  });
  return p;
}

async function saveDrawer() {
  const p = readDrawerInputs();
  if (!String(p.title || "").trim()) return toast("ใส่ชื่อสินค้าก่อน", "error");
  if (!/^https?:\/\//i.test(p.link || "")) return toast("ลิงก์ต้องขึ้นต้นด้วย https://", "error");
  if (!p.source) p.source = HubImport.siteName(p.link);
  const { _uploading, _writing, ...row } = p;
  const saved = await guard(() => HubAPI.saveProduct(row), "บันทึกแล้ว");
  if (!saved) return;
  state.drawer = null;
  renderDrawer();
  await reloadAll();
}

// ร่างรีวิว: AI ก่อน ถ้าใช้ไม่ได้ (ยังไม่ตั้งคีย์ โทเคนหมด ช้า/ล่ม) สุ่มแบบป้ายยาจากข้อมูลในแผงแทน
async function writeReview(useAi) {
  const p = readDrawerInputs();
  if (!useAi || !p.id) {
    p.review = ReviewWriter.random(p);
    return renderDrawer();
  }
  p._writing = true;
  renderDrawer();
  const out = await guard(() => HubAPI.writeReview(p.id));
  if (state.drawer !== p) return;   // ปิดแผงไปแล้ว
  readDrawerInputs();                // เก็บที่พิมพ์ระหว่างรอ
  p._writing = false;
  if (out && out.text) {
    p.review = out.text;
    toast("AI ร่างรีวิวแล้ว ตรวจแล้วกดบันทึก");
  } else {
    p.review = ReviewWriter.random(p);
    toast(`${(out && out.error) || "AI ใช้ไม่ได้"} จึงสุ่มแบบป้ายยาให้แทน`, "error");
  }
  renderDrawer();
}

async function uploadDrawerImage(input) {
  const file = input.files?.[0];
  if (!file || !state.drawer) return;
  readDrawerInputs();
  state.drawer._uploading = true;
  renderDrawer();
  const url = await guard(() => HubAPI.uploadImage(file));
  if (!state.drawer) return;
  state.drawer._uploading = false;
  if (url) state.drawer.image_url = url;
  renderDrawer();
}

// ---------- นำเข้า ----------
function openImport() {
  state.modal = "import";
  state.importer = { items: [], fileName: "", status: "pending", keyword: "", category: "", busy: false, result: null };
  renderModal();
}

function closeModal() {
  state.modal = null;
  state.importer = null;
  state.ai = null;
  state.dash = null;
  renderModal();
}

function importModalHtml() {
  const im = state.importer;
  const legacy = window.HUB_CONFIG?.legacyPromos;
  const preview = im.items.slice(0, 8);
  const noLink = im.items.filter(r => !r.link || !r.title).length;
  return `
    <h2 class="text-lg font-semibold">นำเข้าสินค้า</h2>
    <p class="mt-1 text-sm text-slate-500">สินค้าที่มีอยู่แล้ว (รหัสสินค้าหรือลิงก์เดียวกัน) จะอัปเดตราคา ค่าคอม ยอดขาย ให้ ไม่สร้างซ้ำ และไม่แตะหมวดหรือสถานะที่ตั้งไว้</p>
    ${im.result ? resultHtml(im.result) : `
    <div class="mt-4 grid sm:grid-cols-2 gap-3">
      <label class="block rounded-xl border-2 border-dashed border-slate-300 hover:border-brand-500 p-4 cursor-pointer text-center">
        <div class="text-sm font-semibold text-slate-700">เลือกไฟล์ CSV</div>
        <div class="text-xs text-slate-500 mt-1">${im.fileName ? esc(im.fileName) : "จาก extension หรือเว็บใดก็ได้ที่มีชื่อสินค้าและลิงก์"}</div>
        <input type="file" accept=".csv,text/csv,text/plain" data-act="import-file" class="hidden">
      </label>
      ${legacy?.name ? `<button data-act="import-legacy" class="rounded-xl border border-slate-200 hover:border-brand-500 p-4 text-center">
        <div class="text-sm font-semibold text-slate-700">ย้ายโฆษณาเดิมจาก ${esc(legacy.label || legacy.name)}</div>
        <div class="text-xs text-slate-500 mt-1">อ่านจาก site_meta "${esc(legacy.name)}" ในโปรเจกต์เดียวกัน</div></button>` : ""}
    </div>
    ${im.items.length ? `
      <div class="mt-4 grid sm:grid-cols-3 gap-3">
        ${field("สถานะของสินค้าใหม่", `<select data-im="status" class="${INPUT} mt-1 w-full">
          <option value="pending" ${im.status === "pending" ? "selected" : ""}>รอตรวจ (แนะนำ)</option>
          <option value="active" ${im.status === "active" ? "selected" : ""}>แสดงทันที</option>
          <option value="paused" ${im.status === "paused" ? "selected" : ""}>พักไว้</option></select>`)}
        ${field("หมวดของไฟล์นี้", `<select data-im="category" class="${INPUT} mt-1 w-full"><option value="">เดาจากชื่อสินค้า</option>${state.cats.map(c => `<option value="${esc(c.name)}" ${im.category === c.name ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`)}
        ${field("คำค้นที่ใช้ดึง", `<input data-im="keyword" value="${esc(im.keyword)}" placeholder="เช่น เสื้อคลุมทวิต" class="${INPUT} mt-1 w-full">`, "ช่วยเดาหมวดและค้นหาภายหลัง")}
      </div>
      <div class="mt-4 rounded-xl border border-slate-200 overflow-hidden">
        <div class="px-3 py-2 bg-slate-50 text-xs text-slate-600">พบ ${fmtNum(im.items.length)} รายการ${noLink ? ` · <span class="text-rose-600">${noLink} รายการไม่มีชื่อหรือลิงก์ จะถูกข้าม</span>` : ""} · ตัวอย่าง ${preview.length} รายการแรก</div>
        <div class="divide-y divide-slate-100 max-h-72 overflow-y-auto">${preview.map(r => `
          <div class="flex items-center gap-3 px-3 py-2">${thumb(r, "w-10 h-10 rounded-md object-cover shrink-0")}
            <div class="min-w-0 flex-1"><div class="text-sm truncate">${esc(r.title || "(ไม่มีชื่อ)")}</div>
            <div class="text-[11px] text-slate-400 truncate">${esc([r.price_text, r.commission && `คอม ${r.commission}%`, r.source, r.source_id && `#${r.source_id}`].filter(Boolean).join(" · "))}</div></div></div>`).join("")}
        </div>
      </div>` : ""}`}
    <div class="mt-5 flex items-center justify-end gap-2">
      <button data-act="close-modal" class="${BTN} h-9">${im.result ? "ปิด" : "ยกเลิก"}</button>
      ${!im.result && im.items.length ? `<button data-act="run-import" ${im.busy ? "disabled" : ""} class="${BTN_PRIMARY} h-9">${im.busy ? esc(im.busy) : `นำเข้า ${fmtNum(im.items.length)} รายการ`}</button>` : ""}
    </div>`;
}

function resultHtml(r) {
  const box = (n, label, cls) => `<div class="rounded-xl ${cls} p-4 text-center"><div class="text-2xl font-bold">${fmtNum(n)}</div><div class="text-xs mt-1">${label}</div></div>`;
  return `<div class="mt-4 grid grid-cols-3 gap-3">
      ${box(r.added, "เพิ่มใหม่", "bg-emerald-50 text-emerald-700")}${box(r.updated, "อัปเดตของเดิม", "bg-brand-50 text-brand-700")}${box(r.skipped, "ข้าม", "bg-slate-100 text-slate-600")}
    </div>
    ${r.errors.length ? `<div class="mt-3 max-h-40 overflow-y-auto text-xs text-rose-600 space-y-0.5">${r.errors.slice(0, 50).map(e => `<div>แถว ${e.row}: ${esc(e.error)}</div>`).join("")}</div>` : ""}`;
}

async function readImportFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const im = state.importer;
  im.fileName = file.name;
  im.items = HubImport.fromCsv(await file.text());
  if (!im.items.length) toast("ไม่พบรายการสินค้าในไฟล์นี้", "error");
  renderModal();
}

async function loadLegacy() {
  const legacy = window.HUB_CONFIG?.legacyPromos;
  const slots = await guard(() => HubAPI.legacyPromos(legacy.name));
  if (!slots) return;
  const im = state.importer;
  im.items = HubImport.fromLegacySlots(slots);
  im.fileName = `โฆษณาเดิมจาก ${legacy.label || legacy.name}`;
  im.status = "active";
  if (!im.items.length) toast("ไม่พบโฆษณาเดิม", "error");
  renderModal();
}

async function runImport() {
  const im = state.importer;
  readImportInputs();
  const total = { added: 0, updated: 0, skipped: 0, errors: [] };
  // โฆษณาเดิมที่ปิดไว้ นำเข้าเป็น "พักไว้" ที่เหลือใช้สถานะที่เลือก
  const groups = [
    [im.items.filter(r => r.enabled !== false), im.status],
    [im.items.filter(r => r.enabled === false), "paused"],
  ];
  let done = 0;
  for (const [items, status] of groups) {
    for (let i = 0; i < items.length; i += IMPORT_CHUNK) {
      const chunk = items.slice(i, i + IMPORT_CHUNK).map(({ enabled, ...r }) => ({
        ...r,
        category: r.category || im.category,
        search_keyword: im.keyword,
      }));
      im.busy = `กำลังนำเข้า ${fmtNum(done)}/${fmtNum(im.items.length)}`;
      renderModal();
      const res = await guard(() => HubAPI.importProducts(chunk, status));
      if (!res) { im.busy = false; renderModal(); return; }
      total.added += res.added; total.updated += res.updated; total.skipped += res.skipped;
      total.errors.push(...(res.errors || []).map(e => ({ ...e, row: e.row + done })));
      done += chunk.length;
    }
  }
  im.busy = false;
  im.result = total;
  renderModal();
  await reloadAll();
}

function readImportInputs() {
  document.querySelectorAll("#modal [data-im]").forEach(inp => { state.importer[inp.dataset.im] = inp.value; });
}

// ---------- จัดการหมวด ----------
function categoriesModalHtml() {
  const row = (c) => `
    <div class="grid grid-cols-12 gap-2 items-center py-2 border-t border-slate-100" data-cat-row="${c.id || "new"}">
      <input data-c="name" value="${esc(c.name || "")}" placeholder="ชื่อหมวด" class="${INPUT} col-span-3">
      <select data-c="parent_id" class="${INPUT} col-span-3"><option value="">(หมวดหลัก)</option>${state.cats.filter(p => p.id !== c.id && !p.parent_id).map(p => `<option value="${p.id}" ${c.parent_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <input data-c="keywords" value="${esc((c.keywords || []).join(", "))}" placeholder="คำที่ใช้เดาหมวด คั่นด้วยจุลภาค" class="${INPUT} col-span-4">
      <div class="col-span-2 flex justify-end gap-1">
        <button data-act="save-cat" data-id="${c.id || ""}" class="${BTN} h-9">${c.id ? "บันทึก" : "เพิ่ม"}</button>
        ${c.id ? `<button data-act="delete-cat" data-id="${c.id}" class="${BTN_DANGER} h-9 px-2" aria-label="ลบหมวด">ลบ</button>` : ""}
      </div>
    </div>`;
  return `
    <h2 class="text-lg font-semibold">จัดการหมวดหมู่</h2>
    <p class="mt-1 text-sm text-slate-500">ลบหมวดแล้วสินค้าในหมวดนั้นจะกลายเป็น "ยังไม่มีหมวด" ไม่ถูกลบ</p>
    <div class="mt-4 max-h-[60vh] overflow-y-auto pr-1">${state.cats.map(row).join("")}${row({})}</div>
    <div class="mt-5 flex justify-end"><button data-act="close-modal" class="${BTN} h-9">เสร็จ</button></div>`;
}

async function saveCat(btn) {
  const rowEl = btn.closest("[data-cat-row]");
  const get = (k) => rowEl.querySelector(`[data-c=${k}]`).value;
  const id = btn.dataset.id ? Number(btn.dataset.id) : null;
  const cat = {
    id, name: get("name").trim(), parent_id: get("parent_id") ? Number(get("parent_id")) : null,
    keywords: get("keywords").split(",").map(k => k.trim()).filter(Boolean),
    sort: id ? catById(id)?.sort || 0 : (Math.max(0, ...state.cats.map(c => c.sort || 0)) + 10),
  };
  if (!cat.name) return toast("ใส่ชื่อหมวดก่อน", "error");
  if (await guard(() => HubAPI.saveCategory(cat), "บันทึกหมวดแล้ว")) {
    await loadCats();
    renderFilters();
    renderModal();
  }
}

async function deleteCat(id) {
  const c = catById(id);
  if (!c || !confirm(`ลบหมวด "${c.name}"?`)) return;
  if (state.f.cat === String(id)) state.f.cat = "all";
  await guard(() => HubAPI.deleteCategory(id), "ลบหมวดแล้ว");
  await reloadAll();
  renderFilters();
  renderModal();
}

function renderModal() {
  const el = $("#modal");
  if (!el) return;
  if (!state.modal) { el.innerHTML = ""; return; }
  const inner = state.modal === "import" ? importModalHtml() : state.modal === "sites" ? sitesModalHtml()
    : state.modal === "ai" ? aiModalHtml() : state.modal === "stats" ? statsModalHtml() : categoriesModalHtml();
  el.innerHTML = `
    <div class="fixed inset-0 z-[60] grid place-items-center p-4">
      <div data-act="close-modal" class="absolute inset-0 bg-slate-900/40"></div>
      <div class="relative w-full ${{ import: "max-w-3xl", ai: "max-w-xl", stats: "max-w-5xl" }[state.modal] || "max-w-4xl"} max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6">${inner}</div>
    </div>`;
}

// ---------- แดชบอร์ดสถิติ ----------
const DASH_RANGES = [[7, "7 วัน"], [30, "30 วัน"], [90, "90 วัน"], [365, "1 ปี"], [0, "ทั้งหมด"]];
const ctr = (v, c) => (v ? `${(c / v * 100).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%` : "-");

async function openStats(days) {
  if (days === undefined) days = Number(localGet("hub.dashDays") ?? 30);
  if (!DASH_RANGES.some(([d]) => d === days)) days = 30;
  localSet("hub.dashDays", String(days));
  state.modal = "stats";
  state.dash = { days, data: state.dash?.days === days ? state.dash.data : null };
  renderModal();
  const data = await guard(() => HubAPI.dashboard(days));
  if (state.modal !== "stats" || state.dash?.days !== days) return;
  state.dash.data = data || { totals: { views: 0, clicks: 0, products: 0 }, series: [], top: [], placements: [] };
  renderModal();
}

function trend(now, before) {
  if (before == null) return "";
  if (!before) return now ? `<span class="text-emerald-600">ใหม่</span>` : "";
  const pct = Math.round((now - before) / before * 100);
  const cls = pct > 0 ? "text-emerald-600" : pct < 0 ? "text-rose-600" : "text-slate-400";
  return `<span class="${cls}">${pct > 0 ? "+" : ""}${pct}%</span> <span class="text-slate-400">จากช่วงก่อน</span>`;
}

// กราฟแท่งแบบ SVG ไม่ต้องใช้ไลบรารี (ชี้ที่แท่งเพื่อดูตัวเลข)
function barChart(series, key, color, unit) {
  const W = 760, H = 120, n = series.length || 1;
  const max = Math.max(1, ...series.map(s => Number(s[key])));
  const bw = W / n;
  const label = (t) => new Date(`${t}T00:00:00`).toLocaleDateString("th-TH", unit === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
  const bars = series.map((s, i) => {
    const h = Number(s[key]) / max * (H - 4);
    return `<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(h, Number(s[key]) ? 1.5 : 0).toFixed(1)}" rx="2" fill="${color}"><title>${label(s.t)}: ${fmtNum(s[key])}</title></rect>`;
  }).join("");
  const step = Math.ceil(n / 5);
  // วันแรกชิดซ้าย วันสุดท้ายชิดขวา ป้ายไม่ล้นออกนอกกราฟ
  const ticks = series.map((s, i) => (i % step === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= step)
    ? `<span class="absolute whitespace-nowrap" style="${i === 0 ? "left:0" : i === n - 1 ? "right:0" : `left:${((i + 0.5) / n * 100).toFixed(2)}%;transform:translateX(-50%)`}">${label(s.t)}</span>` : "").join("");
  return `<div class="relative">
      <div class="absolute right-0 -top-5 text-[11px] text-slate-400">สูงสุด ${fmtNum(max)}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="w-full h-28 block border-b border-slate-200">${bars}</svg>
      <div class="relative h-5 mt-1 text-[11px] text-slate-400">${ticks}</div>
    </div>`;
}

function statsModalHtml() {
  const { days, data: d } = state.dash;
  const tabs = DASH_RANGES.map(([v, l]) => `<button data-act="stats-range" data-v="${v}" class="h-8 px-3 rounded-md text-sm whitespace-nowrap ${v === days ? "bg-white shadow-sm font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800"}">${l}</button>`).join("");
  const head = `<div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">สถิติการแสดงและคลิก</h2>
      <div class="flex gap-1 p-1 rounded-lg bg-slate-100 max-w-full overflow-x-auto">${tabs}</div>
    </div>`;
  if (!d) return `${head}<div class="py-16 text-center text-sm text-slate-400">กำลังโหลด…</div>`;
  const t = d.totals, p = d.prev;
  const tile = (label, value, sub) => `<div class="rounded-xl border border-slate-200 p-4">
      <div class="text-xs text-slate-500">${label}</div>
      <div class="mt-1 text-2xl font-semibold tabular-nums">${value}</div>
      <div class="mt-1 text-xs min-h-[1rem]">${sub}</div></div>`;
  const range = d.from ? `${new Date(`${d.from}T00:00:00`).toLocaleDateString("th-TH", { dateStyle: "medium" })} – ${new Date(`${d.to}T00:00:00`).toLocaleDateString("th-TH", { dateStyle: "medium" })}` : "";
  const empty = !t.views && !t.clicks;
  const th = "py-2 px-3 font-medium";
  const num = "py-2 px-3 text-right tabular-nums whitespace-nowrap";
  const topRows = d.top.map((r, i) => `<tr class="border-t border-slate-100">
      <td class="py-2 px-3 text-slate-400 tabular-nums">${i + 1}</td>
      <td class="py-2 px-3"><div class="flex items-center gap-2 min-w-0">
        ${r.image_url ? `<img src="${esc(r.image_url)}" alt="" class="w-9 h-9 rounded object-cover shrink-0 bg-slate-100" loading="lazy">` : `<div class="w-9 h-9 rounded bg-slate-100 shrink-0"></div>`}
        <div class="min-w-0"><div class="truncate max-w-[22rem]" title="${esc(r.title)}">${esc(r.title)}</div>
        <div class="text-[11px] text-slate-400">#${r.id}${r.source ? ` · ${esc(r.source)}` : ""}${STATUS[r.status] && r.status !== "active" ? ` · ${STATUS[r.status].label}` : ""}</div></div></div></td>
      <td class="${num}">${fmtNum(r.views)}</td><td class="${num} font-semibold">${fmtNum(r.clicks)}</td><td class="${num} text-slate-500">${ctr(r.views, r.clicks)}</td>
    </tr>`).join("");
  const plRows = d.placements.map(r => `<tr class="border-t border-slate-100">
      <td class="py-2 px-3">${r.site ? esc(r.site) : `<span class="text-slate-400">ไม่ระบุเว็บ (ลิงก์ /go/ ตรง)</span>`}</td>
      <td class="py-2 px-3 text-slate-500">${esc(r.placement || "-")}</td>
      <td class="${num}">${fmtNum(r.views)}</td><td class="${num} font-semibold">${fmtNum(r.clicks)}</td><td class="${num} text-slate-500">${ctr(r.views, r.clicks)}</td>
    </tr>`).join("");
  const table = (cols, rows) => `<div class="mt-2 overflow-x-auto rounded-xl border border-slate-200"><table class="w-full text-sm">
      <thead class="bg-slate-50 text-slate-500 text-xs"><tr>${cols}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const nums = `<th class="${th} text-right">แสดง</th><th class="${th} text-right">คลิก</th><th class="${th} text-right">อัตราคลิก</th>`;
  return `${head}
    <p class="mt-1 text-xs text-slate-400">${range} (เวลาไทย) ข้อมูลเก็บไว้ทั้งหมด ไม่ถูกลบ</p>
    <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
      ${tile("การแสดง", fmtNum(t.views), trend(t.views, p?.views))}
      ${tile("คลิก", fmtNum(t.clicks), trend(t.clicks, p?.clicks))}
      ${tile("อัตราคลิก (CTR)", ctr(t.views, t.clicks), `<span class="text-slate-400">คลิก ÷ การแสดง</span>`)}
      ${tile("สินค้าที่มีคนเห็น/คลิก", fmtNum(t.products), "")}
    </div>
    ${empty ? `<div class="mt-6 rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">ยังไม่มีคนเห็นหรือกดโฆษณาในช่วงนี้<br><span class="text-xs text-slate-400">ยอดจะขึ้นเมื่อมีคนเปิดหน้าเว็บที่ฝังโค้ด หรือกดลิงก์ /go/</span></div>` : `
    <div class="mt-6 grid md:grid-cols-2 gap-6">
      <div><div class="text-sm font-medium mb-6">คลิก${d.unit === "month" ? "รายเดือน" : "รายวัน"}</div>${barChart(d.series, "clicks", "#3b6ef6", d.unit)}</div>
      <div><div class="text-sm font-medium mb-6">การแสดง${d.unit === "month" ? "รายเดือน" : "รายวัน"}</div>${barChart(d.series, "views", "#94a3b8", d.unit)}</div>
    </div>
    <h3 class="mt-6 text-sm font-semibold">สินค้าที่คลิกมากที่สุด</h3>
    ${table(`<th class="${th} text-left w-8">#</th><th class="${th} text-left">สินค้า</th>${nums}`, topRows)}
    <h3 class="mt-6 text-sm font-semibold">แยกตามเว็บและจุดที่วาง</h3>
    ${table(`<th class="${th} text-left">เว็บ</th><th class="${th} text-left">จุดที่วาง</th>${nums}`, plRows)}`}
    <div class="mt-5 flex justify-end"><button data-act="close-modal" class="${BTN} h-9">ปิด</button></div>`;
}

// ---------- ตั้งค่า AI ----------
// คีย์เก็บในตาราง hub_settings (แอดมินเท่านั้น) ฟังก์ชัน review อ่านไปใช้ตอนกด "เขียนด้วย AI"
const AI_PRESETS = {
  claude: { label: "Claude (Anthropic)", provider: "anthropic", base_url: "", model: "claude-opus-5-5", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI (ChatGPT)", provider: "openai", base_url: "https://api.openai.com/v1", model: "", models: [], keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", provider: "openai", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", models: ["gemini-2.5-flash", "gemini-2.5-pro"], keyUrl: "https://aistudio.google.com/apikey" },
  deepseek: { label: "DeepSeek", provider: "openai", base_url: "https://api.deepseek.com", model: "deepseek-chat", models: ["deepseek-chat"], keyUrl: "https://platform.deepseek.com/api_keys" },
  openrouter: { label: "OpenRouter", provider: "openai", base_url: "https://openrouter.ai/api/v1", model: "", models: [], keyUrl: "https://openrouter.ai/keys" },
  custom: { label: "อื่นๆ (รูปแบบ OpenAI)", provider: "openai", base_url: "", model: "", models: [], keyUrl: "" },
};

async function openAi() {
  state.modal = "ai";
  state.ai = null;
  state.dash = null;
  renderModal();
  const s = await guard(() => HubAPI.aiSettings());
  if (state.modal !== "ai") return;
  const v = s || {};
  const preset = AI_PRESETS[v.preset] ? v.preset : "claude";
  state.ai = {
    preset, provider: v.provider || AI_PRESETS[preset].provider, base_url: v.base_url ?? AI_PRESETS[preset].base_url,
    model: v.model || AI_PRESETS[preset].model, api_key: "", has_key: !!v.has_key, key_hint: v.key_hint || "", busy: false,
  };
  renderModal();
}

function readAiInputs() {
  document.querySelectorAll("#modal [data-ai]").forEach(inp => { state.ai[inp.dataset.ai] = inp.value.trim(); });
}

function aiModalHtml() {
  const a = state.ai;
  const head = `<h2 class="text-lg font-semibold">ตั้งค่า AI เขียนรีวิว</h2>
    <p class="mt-1 text-sm text-slate-500">ใช้กับปุ่ม "เขียนด้วย AI" ในแผงแก้ไขสินค้า คีย์เก็บใน Supabase อ่านได้เฉพาะแอดมิน และไม่แสดงกลับมาที่หน้านี้</p>`;
  if (!a) return `${head}<div class="mt-6 text-sm text-slate-400">กำลังโหลด…</div>`;
  const pre = AI_PRESETS[a.preset];
  const field = (label, html, hint = "") => `<label class="block mt-4 text-sm font-medium text-slate-700">${label}${html}${hint ? `<span class="block mt-1 text-xs font-normal text-slate-400">${hint}</span>` : ""}</label>`;
  return `${head}
    ${field("เจ้า AI", `<select data-act="ai-preset" class="${INPUT} mt-1 w-full">${Object.entries(AI_PRESETS).map(([k, p]) => `<option value="${k}" ${k === a.preset ? "selected" : ""}>${p.label}</option>`).join("")}</select>`,
      pre.keyUrl ? `ขอคีย์ได้ที่ <a href="${pre.keyUrl}" target="_blank" rel="noopener" class="text-brand-600 hover:underline">${esc(new URL(pre.keyUrl).host)}</a>` : "")}
    ${field("API key", `<input data-ai="api_key" type="password" autocomplete="off" value="${esc(a.api_key)}" placeholder="${a.has_key ? `ตั้งไว้แล้ว (…${esc(a.key_hint)}) เว้นว่าง = ใช้คีย์เดิม` : "วางคีย์ที่นี่"}" class="${INPUT} mt-1 w-full">`)}
    ${field("รุ่น (model)", `<input data-ai="model" list="ai-models" value="${esc(a.model)}" placeholder="${pre.provider === "anthropic" ? "claude-opus-5-5" : "ชื่อรุ่น เช่น gpt-5-mini"}" class="${INPUT} mt-1 w-full">
      <datalist id="ai-models">${pre.models.map(m => `<option value="${m}">`).join("")}</datalist>`,
      a.preset === "claude" ? "claude-haiku-5-5 ถูกและเร็วกว่า เหมาะกับเขียนรีวิวจำนวนมาก" : "")}
    ${pre.provider === "openai" ? field("ที่อยู่ API (base URL)", `<input data-ai="base_url" value="${esc(a.base_url)}" placeholder="https://…/v1" class="${INPUT} mt-1 w-full">`) : ""}
    <div class="mt-6 flex flex-wrap items-center justify-between gap-2">
      <div>${a.has_key ? `<button data-act="ai-clear" class="${BTN_DANGER} h-9" ${a.busy ? "disabled" : ""}>ลบคีย์</button>` : ""}</div>
      <div class="flex gap-2">
        <button data-act="close-modal" class="${BTN} h-9">ปิด</button>
        <button data-act="ai-save" class="${BTN_PRIMARY} h-9" ${a.busy ? "disabled" : ""}>${a.busy ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
    </div>`;
}

function setAiPreset(key) {
  readAiInputs();
  const p = AI_PRESETS[key];
  Object.assign(state.ai, { preset: key, provider: p.provider, base_url: p.base_url, model: p.model });
  renderModal();
}

async function saveAi(clear) {
  const a = state.ai;
  readAiInputs();
  if (clear && !confirm("ลบคีย์ AI? ปุ่มเขียนด้วย AI จะกลับไปสุ่มแบบป้ายยา")) return;
  if (!clear) {
    if (!a.api_key && !a.has_key) return toast("วางคีย์ก่อน", "error");
    if (!a.model && a.provider !== "anthropic") return toast("ใส่ชื่อรุ่นก่อน", "error");
    if (a.provider === "openai" && !/^https:\/\//.test(a.base_url)) return toast("ที่อยู่ API ต้องขึ้นต้นด้วย https://", "error");
  }
  a.busy = true;
  renderModal();
  const out = await guard(() => HubAPI.saveAiSettings({
    preset: a.preset, provider: a.provider, model: a.model, base_url: a.provider === "openai" ? a.base_url : "",
    api_key: clear ? "" : a.api_key, clear_key: !!clear,
  }), clear ? "ลบคีย์แล้ว" : "บันทึกตั้งค่า AI แล้ว");
  if (state.modal !== "ai") return;
  a.busy = false;
  if (out) Object.assign(a, { api_key: "", has_key: !!out.has_key, key_hint: out.key_hint || "" });
  renderModal();
}

// ---------- เว็บที่แสดงโฆษณา ----------
// แต่ละเว็บมีคีย์ที่ใส่ในโค้ดฝัง (ads.js?site=<คีย์>) และจุดที่วางหลายจุด เช่น feed (แทรกในรายการ) detail (หน้ารายละเอียด)
const listText = (arr) => (arr || []).join(", ");
const listNums = (v) => [...new Set(String(v || "").split(/[\s,]+/).map(x => parseInt(x.replace(/^#/, ""), 10)).filter(n => n > 0))];

async function openSites() {
  state.modal = "sites";
  state.sites = null;
  renderModal();
  await loadSites();
}

async function loadSites() {
  const sites = await guard(() => HubAPI.sites());
  if (state.modal !== "sites") return;
  state.sites = sites || [];
  const pinned = [...new Set(state.sites.flatMap(s => s.hub_placements.flatMap(p => p.pinned_ids || [])))];
  const rows = pinned.length ? (await guard(() => HubAPI.productTitles(pinned))) || [] : [];
  state.pinTitles = Object.fromEntries(rows.map(r => [r.id, r]));
  renderModal();
}

function embedCode(site) {
  const src = new URL("ads.js", location.href).href;
  const slots = site.hub_placements.length ? site.hub_placements.map(p => `<div data-adhub="${p.key}"></div>`) : [`<div data-adhub="feed"></div>`];
  return `<script src="${src}?site=${site.key}" async></script>\n${slots.join("\n")}`;
}

function categoryPicker(pl) {
  const chosen = new Set(pl.category_ids || []);
  const names = (pl.category_ids || []).map(catName).filter(Boolean);
  return `<details class="relative" data-pl-cats>
    <summary class="${INPUT} flex items-center cursor-pointer list-none truncate">${names.length ? esc(names.join(", ")) : "ทุกหมวด"}</summary>
    <div class="absolute z-10 mt-1 w-64 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg p-2">
      ${state.cats.map(c => `<label class="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-slate-50" style="padding-left:${c.parent_id ? 24 : 8}px">
        <input type="checkbox" value="${c.id}" ${chosen.has(c.id) ? "checked" : ""} class="rounded border-slate-300"> ${esc(c.name)}</label>`).join("")}
      <div class="px-2 pt-1 text-[11px] text-slate-400">ไม่เลือกเลย = สุ่มจากทุกหมวด เลือกหมวดหลักแล้วได้หมวดย่อยด้วย</div>
    </div></details>`;
}

function placementRow(site, pl) {
  const pins = (pl.pinned_ids || []).map(id => {
    const t = state.pinTitles[id];
    return `<span class="inline-flex items-center gap-1 px-1.5 rounded bg-slate-100 ${t && t.status === "active" ? "" : "text-rose-600"}" title="${t ? esc(STATUS[t.status]?.label || "") : "ไม่พบสินค้านี้"}">#${id} ${esc(t ? t.title.slice(0, 24) : "ไม่พบ")}</span>`;
  }).join(" ");
  return `
    <div class="grid grid-cols-12 gap-2 items-start py-2 border-t border-slate-100" data-pl-row data-site="${site.id}" data-id="${pl.id || ""}">
      <input data-pl="key" value="${esc(pl.key || "")}" placeholder="feed" class="${INPUT} col-span-2" title="คีย์ของจุดที่วาง ใช้ใน data-adhub">
      <input data-pl="label" value="${esc(pl.label || "")}" placeholder="ชื่อเรียก" class="${INPUT} col-span-2">
      <input data-pl="slots" type="number" min="1" max="24" value="${esc(pl.slots || 4)}" class="${INPUT} col-span-1" title="จำนวนโฆษณาต่อหน้า">
      <input data-pl="positions" value="${esc(listText(pl.positions))}" placeholder="2, 6, 10" class="${INPUT} col-span-2" title="แทรกหลังรายการที่ (เว็บที่วาดเองใช้)">
      <div class="col-span-2">${categoryPicker(pl)}</div>
      <div class="col-span-3 flex items-center justify-end gap-1">
        <label class="inline-flex items-center gap-1 text-xs text-slate-600 mr-1"><input data-pl="enabled" type="checkbox" ${pl.enabled === false ? "" : "checked"} class="rounded border-slate-300"> เปิด</label>
        <button data-act="save-placement" class="${BTN} h-9">${pl.id ? "บันทึก" : "เพิ่ม"}</button>
        ${pl.id ? `<button data-act="delete-placement" data-id="${pl.id}" class="${BTN_DANGER} h-9 px-2">ลบ</button>` : ""}
      </div>
      <div class="col-span-12 flex items-center gap-2">
        <span class="text-[11px] text-slate-500 shrink-0">ปักหมุด</span>
        <input data-pl="pinned_ids" value="${esc(listText(pl.pinned_ids))}" placeholder="รหัสสินค้า เช่น 12, 40 (ดูได้ในแผงแก้ไขสินค้า) ขึ้นก่อนเสมอตามลำดับนี้" class="${INPUT} h-8 flex-1 text-xs">
      </div>
      ${pins ? `<div class="col-span-12 text-[11px] text-slate-500 flex flex-wrap gap-1">${pins}</div>` : ""}
    </div>`;
}

function siteCard(site) {
  return `
    <section class="rounded-xl border border-slate-200 p-4" data-site-row data-id="${site.id}">
      <div class="grid grid-cols-12 gap-2 items-center">
        <input data-s="name" value="${esc(site.name)}" placeholder="ชื่อเว็บ" class="${INPUT} col-span-4">
        <input data-s="key" value="${esc(site.key)}" placeholder="คีย์" class="${INPUT} col-span-2" title="ตัวเล็ก ตัวเลข ขีด">
        <input data-s="domain" value="${esc(site.domain || "")}" placeholder="โดเมน (จดไว้ดู)" class="${INPUT} col-span-3">
        <div class="col-span-3 flex justify-end gap-1">
          <button data-act="save-site" class="${BTN} h-9">บันทึก</button>
          <button data-act="delete-site" data-id="${site.id}" class="${BTN_DANGER} h-9 px-2">ลบเว็บ</button>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-12 gap-2 text-[11px] font-medium text-slate-500">
        <span class="col-span-2">จุดที่วาง</span><span class="col-span-2">ชื่อเรียก</span><span class="col-span-1">จำนวน</span>
        <span class="col-span-2">ตำแหน่งในหน้า</span><span class="col-span-2">หมวดที่ให้สุ่ม</span>
      </div>
      ${site.hub_placements.map(pl => placementRow(site, pl)).join("")}
      ${placementRow(site, { slots: 4, enabled: true })}
      <div class="mt-3">
        <div class="flex items-center justify-between text-[11px] text-slate-500"><span>โค้ดฝังในเว็บนี้</span>
          <button data-act="copy-embed" data-id="${site.id}" class="text-brand-600 hover:underline">คัดลอก</button></div>
        <pre class="mt-1 p-3 bg-slate-900 text-slate-100 rounded-lg text-xs whitespace-pre-wrap break-all" data-embed="${site.id}">${esc(embedCode(site))}</pre>
      </div>
    </section>`;
}

function sitesModalHtml() {
  const body = state.sites === null
    ? `<div class="py-10 text-center text-sm text-slate-400">กำลังโหลด…</div>`
    : `${state.sites.length ? "" : `<div class="rounded-xl border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">ยังไม่มีเว็บ เพิ่มเว็บแรกด้านล่าง</div>`}
       ${state.sites.map(siteCard).join("")}
       <section class="rounded-xl bg-slate-50 p-4" data-site-row data-id="">
         <div class="text-sm font-semibold text-slate-700">เพิ่มเว็บ</div>
         <div class="mt-2 grid grid-cols-12 gap-2">
           <input data-s="name" placeholder="ชื่อเว็บ เช่น ย้ายราชการ" class="${INPUT} col-span-5">
           <input data-s="key" placeholder="คีย์ เช่น transfer" class="${INPUT} col-span-3">
           <input data-s="domain" placeholder="โดเมน" class="${INPUT} col-span-2">
           <button data-act="save-site" class="${BTN_PRIMARY} h-9 col-span-2">เพิ่มเว็บ</button>
         </div>
       </section>`;
  return `
    <h2 class="text-lg font-semibold">เว็บที่แสดงโฆษณา</h2>
    <p class="mt-1 text-sm text-slate-500">แต่ละเว็บฝังสคริปต์บรรทัดเดียว แล้ววางช่อง <code class="px-1 bg-slate-100 rounded">data-adhub="คีย์จุดที่วาง"</code> ตรงที่อยากให้โฆษณาขึ้น
      สินค้าที่ขึ้นคือ "กำลังแสดง" เท่านั้น ปักหมุดขึ้นก่อน ที่เหลือสุ่มตามน้ำหนัก ค่าคอม และคลิก ลิงก์บนการ์ดนับคลิกผ่าน /go/</p>
    <div class="mt-4 space-y-4 max-h-[65vh] overflow-y-auto pr-1">${body}</div>
    <div class="mt-5 flex justify-end"><button data-act="close-modal" class="${BTN} h-9">เสร็จ</button></div>`;
}

async function saveSite(btn) {
  const row = btn.closest("[data-site-row]");
  const get = (k) => row.querySelector(`[data-s=${k}]`).value.trim();
  const site = { id: row.dataset.id ? Number(row.dataset.id) : null, name: get("name"), key: get("key").toLowerCase(), domain: get("domain") };
  if (!site.name) return toast("ใส่ชื่อเว็บก่อน", "error");
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(site.key)) return toast("คีย์ใช้ได้เฉพาะ a-z 0-9 และขีด เช่น transfer", "error");
  if (await guard(() => HubAPI.saveSite(site), site.id ? "บันทึกเว็บแล้ว" : "เพิ่มเว็บแล้ว")) await loadSites();
}

async function deleteSite(id) {
  const site = state.sites.find(s => s.id === id);
  if (!site || !confirm(`ลบเว็บ "${site.name}" และจุดที่วางทั้งหมดของเว็บนี้? เว็บที่ฝังโค้ดไว้จะไม่มีโฆษณาขึ้น`)) return;
  if (await guard(() => HubAPI.deleteSite(id), "ลบเว็บแล้ว")) await loadSites();
}

async function savePlacement(btn) {
  const row = btn.closest("[data-pl-row]");
  const get = (k) => row.querySelector(`[data-pl=${k}]`);
  const pl = {
    id: row.dataset.id ? Number(row.dataset.id) : null,
    site_id: Number(row.dataset.site),
    key: get("key").value.trim().toLowerCase(),
    label: get("label").value.trim(),
    slots: Math.min(24, Math.max(1, Number(get("slots").value) || 1)),
    positions: listNums(get("positions").value).sort((a, b) => a - b),
    pinned_ids: listNums(get("pinned_ids").value),
    category_ids: [...row.querySelectorAll("[data-pl-cats] input:checked")].map(i => Number(i.value)),
    enabled: get("enabled").checked,
  };
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(pl.key)) return toast("คีย์จุดที่วางใช้ได้เฉพาะ a-z 0-9 _ - เช่น feed", "error");
  if (await guard(() => HubAPI.savePlacement(pl), pl.id ? "บันทึกจุดที่วางแล้ว" : "เพิ่มจุดที่วางแล้ว")) await loadSites();
}

async function deletePlacement(id) {
  if (!confirm("ลบจุดที่วางนี้? ช่องนี้บนเว็บจะไม่มีโฆษณาขึ้น")) return;
  if (await guard(() => HubAPI.deletePlacement(id), "ลบจุดที่วางแล้ว")) await loadSites();
}

async function copyEmbed(btn) {
  const text = document.querySelector(`[data-embed="${btn.dataset.id}"]`)?.textContent || "";
  try { await navigator.clipboard.writeText(text); toast("คัดลอกโค้ดแล้ว"); } catch (_) { toast("คัดลอกไม่ได้ ลากเลือกข้อความแทน", "error"); }
}

// ---------- เหตุการณ์ ----------
async function onClick(e) {
  // คลิกช่องเลือกบนการ์ด: ให้ติ๊กอย่างเดียว ไม่เปิดแผงแก้ไข (การติ๊กจัดการใน onChange)
  if (e.target.closest("[data-stop]")) return;
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const v = el.dataset.v;
  if (["select", "select-page", "upload", "import-file"].includes(act)) return;   // จัดการใน onChange
  switch (act) {
    case "edit": openDrawer(Number(el.dataset.id)); break;
    case "new-product": openDrawer("new"); break;
    case "close-drawer": closeDrawer(); break;
    case "save-drawer": saveDrawer(); break;
    case "delete-one": {
      const p = state.drawer;
      if (!confirm(`ลบ "${p.title}"?`)) return;
      if (await guard(() => HubAPI.deleteProducts([p.id]), "ลบแล้ว")) { closeDrawer(); reloadAll(); }
      break;
    }
    case "status": state.f.status = v; state.page = 1; state.selected.clear(); renderSidebar(); renderFilters(); refresh(); break;
    case "cat": state.f.cat = v; state.page = 1; state.selected.clear(); renderSidebar(); renderFilters(); refresh(); break;
    case "view": state.view = v; localSet("hub.view", v); renderFilters(); renderResults(); break;
    case "page": state.page = Number(v); refresh(); window.scrollTo({ top: 0, behavior: "smooth" }); break;
    case "clear-filters":
      state.f = { ...state.f, q: "", status: "all", cat: "all", source: "", minCommission: "", minPrice: "", maxPrice: "" };
      $("#search").value = "";
      state.page = 1; renderSidebar(); renderFilters(); refresh();
      break;
    case "bulk-clear": state.selected.clear(); renderResults(); break;
    case "bulk-delete":
      if (!confirm(`ลบ ${state.selected.size} รายการ? ย้อนกลับไม่ได้`)) return;
      if (await guard(() => HubAPI.deleteProducts([...state.selected]), `ลบ ${state.selected.size} รายการแล้ว`)) {
        state.selected.clear(); reloadAll();
      }
      break;
    case "open-import": openImport(); break;
    case "open-categories": state.modal = "categories"; renderModal(); break;
    case "close-modal": closeModal(); break;
    case "import-legacy": loadLegacy(); break;
    case "run-import": runImport(); break;
    case "save-cat": saveCat(el); break;
    case "delete-cat": deleteCat(Number(el.dataset.id)); break;
    case "open-sites": openSites(); break;
    case "open-ai": openAi(); break;
    case "open-stats": openStats(); break;
    case "stats-range": openStats(Number(v)); break;
    case "ai-save": saveAi(false); break;
    case "ai-clear": saveAi(true); break;
    case "save-site": saveSite(el); break;
    case "delete-site": deleteSite(Number(el.dataset.id)); break;
    case "save-placement": savePlacement(el); break;
    case "delete-placement": deletePlacement(Number(el.dataset.id)); break;
    case "copy-embed": copyEmbed(el); break;
    case "ai-review": writeReview(true); break;
    case "spin-review": writeReview(false); break;
    case "use-image": if (state.drawer) { readDrawerInputs(); state.drawer.image_url = el.dataset.url; renderDrawer(); } break;
    case "remove-image": if (state.drawer) { readDrawerInputs(); removeImage(state.drawer, el.dataset.url); renderDrawer(); } break;
    case "signout": await HubAPI.signOut(); boot(); break;
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.dataset.f) {
    state.f[t.dataset.f] = t.value;
    state.page = 1;
    if (t.dataset.f === "cat" || t.dataset.f === "status") renderSidebar();
    refresh();
    return;
  }
  if (t.dataset.bulk && t.value) {
    const val = t.value;
    if (t.dataset.bulk === "category") await bulkUpdate({ category_id: val === "none" ? null : Number(val) }, "ย้ายหมวด");
    else await bulkUpdate({ status: val }, `ตั้งเป็น "${STATUS[val].label}"`);
    return;
  }
  if (t.dataset.im) { state.importer[t.dataset.im] = t.value; return; }
  switch (t.dataset.act) {
    case "select": {
      const id = Number(t.dataset.id);
      if (t.checked) state.selected.add(id); else state.selected.delete(id);
      renderResults();
      break;
    }
    case "select-page":
      state.rows.forEach(r => (t.checked ? state.selected.add(r.id) : state.selected.delete(r.id)));
      renderResults();
      break;
    case "upload": uploadDrawerImage(t); break;
    case "import-file": readImportFile(t); break;
    case "ai-preset": setAiPreset(t.value); break;
  }
}

boot();
