/**
 * Hub Service: ส่งสินค้าที่ดึงได้เข้าคลังโฆษณากลาง (Ad Hub บน Supabase)
 * ใช้ได้ทั้งใน background (importScripts) และหน้าแดชบอร์ด
 * เก็บเฉพาะ URL, คีย์สาธารณะ, อีเมล และ token ของการล็อกอิน ไม่เก็บรหัสผ่าน
 * ไม่ผูกกับเว็บขายของเว็บใดเว็บหนึ่ง: แหล่งสินค้าได้จากชื่อเว็บของลิงก์
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubService = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIG_KEY = 'hub_config';
  const CHUNK = 200;

  const storageGet = (key) => new Promise(resolve => chrome.storage.local.get([key], res => resolve(res[key])));
  const storageSet = (obj) => new Promise(resolve => chrome.storage.local.set(obj, resolve));

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  // s.shopee.co.th → shopee, www.lazada.com → lazada
  function siteName(url) {
    const labels = host(url).split('.').filter(Boolean);
    if (!labels.length || /^[\d.]+$/.test(labels.join('.'))) return '';
    labels.pop();
    if (labels.length > 1 && /^(co|com|or|org|net|ac|go|gov|edu|in|mi)$/i.test(labels[labels.length - 1])) labels.pop();
    return (labels.pop() || '').toLowerCase();
  }

  // รหัสสินค้า: ตัวเลขยาวชุดสุดท้ายใน path ของลิงก์หน้าสินค้า
  function productId(url) {
    try {
      const ids = new URL(url).pathname.match(/\d{6,}/g);
      return ids ? ids[ids.length - 1] : '';
    } catch (_) { return ''; }
  }

  const firstNumber = (v) => {
    const m = String(v || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? m[0] : '';
  };
  const isHttp = (v) => /^https?:\/\//i.test(String(v || ''));

  // สินค้าจากตัวดึง → รายการสำหรับ hub_import_products
  function toHubItem(p, keyword) {
    const pageLink = isHttp(p.longLink) ? p.longLink : '';
    // ต้องเป็นลิงก์ affiliate ที่ผู้ชมกดซื้อได้ ถ้าตัวดึงเอาลิงก์ไม่ได้จะคืนลิงก์หน้าที่ดึงมาแทน
    // ลิงก์แบบนั้นและลิงก์หน้าสินค้าในพอร์ทัล affiliate ใช้ไม่ได้ จึงเว้นว่างให้ถูกข้าม
    // (ตัวดึงคืนลิงก์ของการ์ดสินค้าซึ่งก็คือ longLink หรือคืน URL ของหน้า)
    const fallback = [p.pageUrl, p.longLink].filter(Boolean);
    const link = isHttp(p.shortLink) && !fallback.includes(p.shortLink) ? p.shortLink : (isHttp(p.link) ? p.link : '');
    const price = String(p.price || '').trim();
    return {
      title: String(p.title || p.rawTitle || '').replace(/\s+/g, ' ').trim(),
      link,
      source: siteName(pageLink || link),
      source_id: String(p.shopeeId || p.sourceId || productId(pageLink) || ''),
      price: firstNumber(price),
      price_text: price === '-' ? '' : price,
      commission: firstNumber(p.commission),
      sold_text: String(p.sold || '').trim(),
      shop: String(p.shop || '').trim(),
      image_url: isHttp(p.image) ? p.image : (isHttp(p.cleanImgUrl) ? p.cleanImgUrl : ''),
      search_keyword: String(keyword || '').trim().slice(0, 120),
      // จากหน้าสินค้า (ถ้าเปิดดึงมา) ใช้เป็นข้อมูลรีวิว
      images: Array.isArray(p.images) ? p.images.filter(isHttp) : [],
      description: String(p.description || '').trim(),
      details: p.details && typeof p.details === 'object' ? p.details : {},
    };
  }

  async function getConfig() {
    return (await storageGet(CONFIG_KEY)) || {};
  }

  async function authRequest(cfg, grant, body) {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || `HTTP ${res.status}`);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      email: data.user?.email || '',
    };
  }

  async function rpc(cfg, token, name, args) {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: `Bearer ${token}` },
      body: JSON.stringify(args || {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || `HTTP ${res.status}`);
    return data;
  }

  const HubService = {
    siteName,
    productId,
    toHubItem,
    getConfig,

    async status() {
      const cfg = await getConfig();
      return { connected: !!(cfg.url && cfg.session?.refresh_token), url: cfg.url || '', email: cfg.session?.email || cfg.email || '' };
    },

    // ล็อกอินด้วยบัญชีแอดมินของ Ad Hub แล้วเช็กสิทธิ์ทันที
    async connect(url, key, email, password) {
      const cfg = { url: String(url || '').trim().replace(/\/+$/, ''), key: String(key || '').trim(), email: String(email || '').trim() };
      if (!isHttp(cfg.url) || !cfg.key) throw new Error('ใส่ Project URL และ Publishable key ให้ครบ');
      const session = await authRequest(cfg, 'password', { email: cfg.email, password });
      const admin = await rpc(cfg, session.access_token, 'hub_is_admin');
      if (admin !== true) throw new Error('บัญชีนี้ยังไม่ใช่แอดมินของ Ad Hub (ดู README ข้อ 2)');
      await storageSet({ [CONFIG_KEY]: { ...cfg, session } });
      return { email: session.email || cfg.email };
    },

    async disconnect() {
      const cfg = await getConfig();
      await storageSet({ [CONFIG_KEY]: { url: cfg.url, key: cfg.key, email: cfg.email } });
    },

    // token ที่ใช้ได้ (ต่ออายุเองเมื่อใกล้หมด)
    async token() {
      const cfg = await getConfig();
      if (!cfg.url || !cfg.session?.refresh_token) throw new Error('ยังไม่ได้เชื่อม Ad Hub');
      if (cfg.session.expires_at - Date.now() > 60 * 1000) return { cfg, token: cfg.session.access_token };
      let session;
      try {
        session = await authRequest(cfg, 'refresh_token', { refresh_token: cfg.session.refresh_token });
      } catch (err) {
        throw new Error(`การเชื่อม Ad Hub หมดอายุ กรุณาเชื่อมใหม่ในแดชบอร์ด (${err.message})`);
      }
      session.email = session.email || cfg.session.email;
      await storageSet({ [CONFIG_KEY]: { ...cfg, session } });
      return { cfg, token: session.access_token };
    },

    // products: สินค้าจากตัวดึง คืน {added, updated, skipped, errors, sent}
    async importProducts(products, keyword, status) {
      const items = (products || []).map(p => toHubItem(p, keyword)).filter(it => it.title && isHttp(it.link));
      const total = { added: 0, updated: 0, skipped: (products || []).length - items.length, errors: [], sent: items.length };
      for (let i = 0; i < items.length; i += CHUNK) {
        const { cfg, token } = await this.token();
        const res = await rpc(cfg, token, 'hub_import_products', { p_items: items.slice(i, i + CHUNK), p_status: status || 'pending' });
        total.added += res.added || 0;
        total.updated += res.updated || 0;
        total.skipped += res.skipped || 0;
        total.errors.push(...(res.errors || []));
      }
      return total;
    },
  };

  return HubService;
});
