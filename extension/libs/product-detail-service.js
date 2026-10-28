/**
 * Product Detail Service: เปิดหน้าสินค้าในแท็บเบื้องหลัง ดึงรูปทั้งหมดและรายละเอียด แล้วปิดแท็บ
 * ใช้ทำข้อมูลรีวิว เพราะหน้าข้อเสนอสินค้าในพอร์ทัล affiliate มีแค่รูปปก ราคา และค่าคอม
 * ไม่ผูกกับเว็บใดเว็บหนึ่ง: อ่านจากข้อมูลมาตรฐานของหน้าสินค้า (JSON-LD schema.org/Product, og:)
 * แล้วเสริมด้วยแกลเลอรีรูปและหัวข้อ "รายละเอียดสินค้า" / "ข้อมูลจำเพาะ" ที่หาจากหน้าตาของหน้า
 * ใช้ใน background (importScripts) ต้องมีสิทธิ์ tabs + scripting และ host ของเว็บนั้น
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProductDetailService = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_HOPS = 4;
  const LOAD_TIMEOUT = 25000;

  // ฉีดเข้าไปรันในหน้าสินค้า (chrome.scripting) จึงต้องไม่ใช้อะไรนอกฟังก์ชันนี้
  // คืน {isProduct, url, title, description, images, details, links}
  //   links: ลิงก์ในหน้าที่มีรหัสสินค้านี้ ใช้ตามต่อเมื่อหน้านี้ไม่ใช่หน้าสินค้า (เช่นหน้าในพอร์ทัล affiliate)
  async function extract(productId, waitMs) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const text = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    const abs = (u) => { try { return new URL(String(u).trim(), location.href).href; } catch (_) { return ''; } };
    // รูปเดียวกันคนละขนาด (…@resize_w200, …_tn) นับเป็นรูปเดียว และเก็บแบบไม่ย่อ
    const full = (u) => abs(u).replace(/@resize_[^/?#]*/i, '').replace(/_tn(?=$|[?#])/, '');
    const key = (u) => full(u).split(/[?#]/)[0];
    const isImg = (u) => /^https?:\/\//i.test(u) && !/\.svg(\?|$)|^data:/i.test(u);
    const meta = (name) => {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      return el ? (el.getAttribute('content') || '').trim() : '';
    };

    function jsonLdProduct() {
      const out = [];
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        const t = [].concat(n['@type'] || []).map(String);
        if (t.some(x => /product/i.test(x))) out.push(n);
        if (n['@graph']) walk(n['@graph']);
      };
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try { walk(JSON.parse(s.textContent)); } catch (_) {}
      });
      return out[0] || null;
    }

    function srcOf(el) {
      if (el.tagName === 'IMG') {
        const set = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
        const best = set.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
        return el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src') || best || '';
      }
      const m = (el.style && el.style.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/);
      return m ? m[1] : '';
    }

    // กรอบโปรโมชัน (เช่น "ส่วนลด", กรอบร้าน) ที่วางทับรูปสินค้า: รูปที่อยู่หลังรูปอื่นในกล่องเดียวกันและทับตำแหน่งเดียวกันเกือบทั้งรูป
    // หรือไฟล์ประเภทกรอบของ Shopee (รหัส 11134258) ไม่ใช่รูปสินค้า
    function isOverlay(el, u) {
      if (/[/-]11134258-/.test(u)) return true;
      const box = el.parentElement, r = el.getBoundingClientRect();
      if (!box || !r.width || !r.height) return false;
      return Array.from(box.querySelectorAll('img')).some(o => {
        if (o === el || !(o.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        const q = o.getBoundingClientRect();
        const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        return w > 0 && h > 0 && w * h >= 0.8 * r.width * r.height;
      });
    }

    function imagesIn(rootEl) {
      const seen = new Map();
      rootEl.querySelectorAll('img, [style*="background-image"]').forEach(el => {
        const u = srcOf(el);
        if (!u || !isImg(abs(u)) || isOverlay(el, abs(u))) return;
        const r = el.getBoundingClientRect();
        // ไอคอน โลโก้ ดาว: เล็กเกินไป
        if (r.width && r.height && (r.width < 40 || r.height < 40)) return;
        if (!seen.has(key(u))) seen.set(key(u), full(u));
      });
      return [...seen.values()];
    }

    // แกลเลอรี: รูปใหญ่สุดด้านบนของหน้า แล้วไล่ขึ้นไปหากล่องแรกที่มีหลายรูป (รูปหลัก + รูปย่อย)
    // skip: กล่องที่ไม่ใช่แกลเลอรี (เช่นคำอธิบายสินค้าที่มีรูปใหญ่) ห้ามเลือกรูปในนั้นเป็นรูปหลัก
    function gallery(skip) {
      let main = null, area = 0;
      document.querySelectorAll('img, [style*="background-image"]').forEach(el => {
        if (skip && skip.contains(el)) return;
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        if (!srcOf(el) || isOverlay(el, abs(srcOf(el))) || top > 1400 || r.width < 150 || r.height < 150 || r.width > window.innerWidth * 0.8) return;
        if (r.width * r.height > area) { area = r.width * r.height; main = el; }
      });
      if (!main) return [];
      let best = imagesIn(main.parentElement || main);
      for (let el = main.parentElement; el && el !== document.body; el = el.parentElement) {
        const imgs = imagesIn(el);
        if (imgs.length > 30) break;
        best = imgs;
        if (imgs.length >= 2 && el.getBoundingClientRect().width < window.innerWidth * 0.75) break;
      }
      if (!best.length) best = [full(srcOf(main))];
      return best;
    }

    // กล่องใต้หัวข้อ เช่น "รายละเอียดสินค้า": หัวข้อที่ตรงคำ แล้วเอากล่องถัดไปหรือกล่องแม่ที่มีข้อความยาวกว่า
    function section(re) {
      const heads = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span, p'))
        .filter(el => el.children.length <= 1 && re.test(text(el)) && text(el).length < 40);
      for (const h of heads) {
        let box = h.nextElementSibling;
        for (let up = h; !box && up.parentElement && up !== document.body; up = up.parentElement) box = up.nextElementSibling;
        if (box && (text(box).length > 1 || box.querySelector('img'))) return box;
      }
      return null;
    }

    function specs() {
      const box = section(/^(ข้อมูลจำเพาะ((ของ)?สินค้า)?|product specifications?|spesifikasi produk|specifications?)$/i);
      const out = {};
      if (!box) return out;
      const rows = box.querySelectorAll('tr, div, li');
      rows.forEach(row => {
        const cells = Array.from(row.children).filter(c => text(c));
        // แถวละ 2 ช่อง (ชื่อ, ค่า) ข้ามกล่องที่ครอบหลายแถว
        if (cells.length !== 2 || Object.keys(out).length >= 30 || cells.some(c => /\n/.test(text(c)))) return;
        const k = text(cells[0]).slice(0, 60), v = text(cells[1]).slice(0, 300);
        if (k && v && !(k in out) && k.length < 60) out[k] = v;
      });
      return out;
    }

    function read() {
      const ld = jsonLdProduct();
      const ldImages = ld ? [].concat(ld.image || []).map(i => (typeof i === 'string' ? i : i && (i.url || i.contentUrl))).filter(Boolean) : [];
      const descBox = section(/^(รายละเอียดสินค้า|คำอธิบายสินค้า|product description|deskripsi produk|description)$/i);
      // รูปในคำอธิบายสินค้า (ร้านมักใส่รูปรายละเอียดแทนข้อความ) ต่อท้ายรูปแกลเลอรี
      const descImages = descBox ? imagesIn(descBox) : [];
      const imgs = new Map();
      [...gallery(descBox), ...ldImages, meta('og:image'), ...descImages].filter(Boolean).forEach(u => {
        const a = full(u);
        if (isImg(a) && !imgs.has(key(a))) imgs.set(key(a), a);
      });
      const descs = [ld && ld.description, text(descBox), meta('og:description'), meta('description')]
        .map(d => String(d || '').trim()).filter(Boolean);
      const description = descs.sort((a, b) => b.length - a.length)[0] || '';
      const rating = ld && ld.aggregateRating;
      const details = {};
      const brand = ld && (typeof ld.brand === 'string' ? ld.brand : ld.brand && ld.brand.name);
      if (brand) details.brand = String(brand).trim();
      if (rating && rating.ratingValue) details.rating = Number(rating.ratingValue) || String(rating.ratingValue);
      if (rating && (rating.ratingCount || rating.reviewCount)) details.rating_count = Number(rating.ratingCount || rating.reviewCount) || 0;
      const sp = specs();
      if (Object.keys(sp).length) details.specs = sp;
      const id = String(productId || '');
      const links = id ? [...new Set(Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
        .filter(h => /^https?:/i.test(h) && h.includes(id) && h.split('#')[0] !== location.href.split('#')[0]))].slice(0, 5) : [];
      return {
        isProduct: !!ld || /product/i.test(meta('og:type')) || (imgs.size >= 2 && description.length > 30),
        url: location.href,
        title: String((ld && ld.name) || meta('og:title') || '').trim(),
        description: description.slice(0, 20000),
        images: [...imgs.values()].slice(0, 30),
        details,
        links,
      };
    }

    // หน้าเว็บแบบ SPA วาดทีหลัง: รอจนข้อมูลนิ่ง (รูปและคำอธิบายไม่เพิ่มแล้ว) หรือหมดเวลา
    // ไม่เจออะไรเลยและหน้านิ่งแล้ว 6 วิ: ถือว่าไม่ใช่หน้าสินค้า ไม่ต้องรอจนหมดเวลา
    const start = Date.now();
    const until = start + (waitMs || 12000);
    let last = null, stable = 0;
    // เลื่อนลงทีละช่วงให้ส่วนรายละเอียดและรูปที่โหลดตอนเลื่อนถึง (lazy) วาดออกมา แล้วกลับขึ้นบนให้แกลเลอรีอยู่ในจอ
    try {
      for (let y = 800; y <= Math.min(document.body.scrollHeight, 8000); y += 800) { window.scrollTo(0, y); await sleep(250); }
      window.scrollTo(0, 0);
      await sleep(300);
    } catch (_) {}
    while (Date.now() < until) {
      const r = read();
      const sig = `${r.images.length}|${r.description.length}|${Object.keys(r.details).length}|${r.links.length}`;
      stable = last && sig === last.sig ? stable + 1 : 0;
      last = { ...r, sig };
      if (stable >= 2 && (r.isProduct || r.links.length)) break;
      if (stable >= 4 && Date.now() - start > 6000) break;
      await sleep(700);
    }
    const { sig, ...result } = last || read();
    return result;
  }

  const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));
  // ลิงก์ affiliate (ลิงก์สั้น s.shopee.* / shope.ee / shp.ee หรือมีพารามิเตอร์ affiliate) ห้ามเปิด
  // เพราะ Shopee นับเป็นคลิกในรายงาน affiliate
  const isAffiliateLink = (u) => {
    try {
      const x = new URL(String(u));
      return /^(s\.shopee\.|shope\.ee$|shp\.ee$)/i.test(x.hostname)
        || /(^|[?&])(aff|af_|affiliate|utm_source=an_|mmp_pid)/i.test(x.search);
    } catch (_) { return false; }
  };
  const canOpen = (u) => isHttp(u) && !isAffiliateLink(u);

  function waitForLoad(tabId, timeout) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); resolve(); };
      const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
      const timer = setTimeout(finish, timeout);
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId, tab => { if (!chrome.runtime.lastError && tab && tab.status === 'complete' && tab.url !== 'about:blank') finish(); });
    });
  }

  const ProductDetailService = {
    extract,
    isAffiliateLink,

    /**
     * urls: หน้าที่จะลองตามลำดับ (เช่น ลิงก์จากการ์ดสินค้า) ลิงก์ affiliate จะถูกข้ามเสมอ
     * productId: รหัสสินค้า ใช้หาลิงก์ไปหน้าสินค้าจริงเมื่อหน้าที่เปิดไม่ใช่หน้าสินค้า
     * คืน {found, url, title, description, images, details} (found = false ถ้าหาหน้าสินค้าไม่เจอ)
     */
    async fetch(urls, productId, options = {}) {
      const queue = [...new Set((urls || []).filter(canOpen))];
      const tried = new Set();
      let tab = null;
      try {
        for (let i = 0; i < queue.length && tried.size < MAX_HOPS; i++) {
          const url = queue[i];
          if (tried.has(url)) continue;
          tried.add(url);
          // เปิดแท็บเปล่าก่อนแล้วค่อยไปหน้าสินค้า ให้เครื่องมือที่ดักการโหลดหน้า (เช่นตัวทดสอบ) จับแท็บได้ทัน
          if (!tab) {
            tab = await chrome.tabs.create({ url: 'about:blank', active: false });
            await new Promise(r => setTimeout(r, 500));
          }
          await chrome.tabs.update(tab.id, { url });
          await new Promise(r => setTimeout(r, 300));
          await waitForLoad(tab.id, options.loadTimeout || LOAD_TIMEOUT);
          let result = null;
          // ลิงก์สั้นบางเจ้าส่งต่อด้วยสคริปต์: หน้าเปลี่ยนระหว่างอ่าน ให้รอหน้าใหม่แล้วอ่านอีกรอบ
          for (let attempt = 0; attempt < 3 && !result; attempt++) {
            try {
              const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extract, args: [productId || '', options.waitMs || 12000] });
              result = res && res.result;
            } catch (err) {
              console.warn('[ProductDetail] อ่านหน้าไม่ได้:', url, err.message);
            }
            if (!result) await waitForLoad(tab.id, options.loadTimeout || LOAD_TIMEOUT);
          }
          if (!result) continue;
          if (result.isProduct) return { found: true, ...result };
          // ไม่ใช่หน้าสินค้า แต่ลิงก์ไปหน้าที่มีรหัสสินค้านี้: ตามไปก่อนลองลิงก์ถัดไปที่ส่งมา
          queue.splice(i + 1, 0, ...result.links.filter(l => canOpen(l) && !tried.has(l) && !queue.includes(l)));
        }
      } finally {
        if (tab) chrome.tabs.remove(tab.id).catch(() => {});
      }
      // รูปจากหน้าที่ไม่ใช่หน้าสินค้าอาจเป็นของสินค้าอื่น จึงไม่ส่งกลับ
      return { found: false, url: '', title: '', description: '', images: [], details: {} };
    },
  };

  return ProductDetailService;
});
