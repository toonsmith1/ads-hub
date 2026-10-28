// ==========================================
// แปลงไฟล์ CSV และโฆษณาเดิมให้เป็นรายการสินค้าสำหรับ hub_import_products
// จับคอลัมน์จากชื่อหัวตาราง (ไทย/อังกฤษ/อินโดนีเซีย) ไม่ผูกกับเว็บขายของเว็บใดเว็บหนึ่ง
// ==========================================
const HubImport = (() => {
  // ลำดับสำคัญ: รูปก่อนลิงก์ (หัว "URL รูปภาพ" มีคำว่า url), ลิงก์ก่อนชื่อ (หัว "ลิงก์สินค้า" มีคำว่าสินค้า),
  // ร้านก่อนชื่อ (หัว "ชื่อร้าน" มีคำว่าชื่อ)
  const COLUMNS = [
    ["image", /รูป|ภาพ|image|img|foto|photo|picture|thumbnail/i],
    ["link", /ลิงก์|ลิ้งค์|link|url|href|tautan/i],
    ["price", /ราคา|price|harga/i],
    ["sold", /ยอดขาย|ขายแล้ว|sold|terjual/i],
    ["commission", /คอม|commission|komisi/i],
    ["shop", /ร้าน|ผู้ขาย|แบรนด์|ยี่ห้อ|shop|store|seller|merchant|brand|toko|penjual/i],
    ["category", /หมวด|category|kategori/i],
    ["title", /ชื่อ|สินค้า|title|name|nama|judul|produk|product/i],
  ];

  // RFC 4180: ช่องในเครื่องหมายคำพูดมีจุลภาคหรือขึ้นบรรทัดใหม่ได้ เดาตัวคั่นจากบรรทัดแรก
  function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const delimiter = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some(c => c.trim())) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim())) rows.push(row);
    return rows.map(r => r.map(c => c.trim()));
  }

  const isUrl = (v) => /^https?:\/\//i.test(v);
  const looksLikeImage = (v) => /\.(jpe?g|png|webp|gif|avif)(\?|$)|\/(img|image|images|file)\//i.test(v);
  const firstUrl = (v) => (String(v || "").match(/https?:\/\/[^\s|,;"']+/i) || [""])[0];

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
  }

  // ชื่อเว็บจากลิงก์ใดก็ได้: s.shopee.co.th → shopee, www.lazada.com → lazada
  function siteName(url) {
    // ลิงก์ติดตามของเครือข่าย affiliate ใช้ชื่อเครือข่าย ไม่ใช่ชื่อโดเมนสั้น
    if (/(^|\.)(accesstrade\.|atth\.)/i.test(host(url))) return "accesstrade";
    const labels = host(url).split(".").filter(Boolean);
    if (!labels.length || /^[\d.]+$/.test(labels.join("."))) return "";
    labels.pop();
    if (labels.length > 1 && /^(co|com|or|org|net|ac|go|gov|edu|in|mi)$/i.test(labels[labels.length - 1])) labels.pop();
    return (labels.pop() || "").toLowerCase();
  }

  // รหัสสินค้าในลิงก์หน้าสินค้า: ตัวเลขยาวชุดสุดท้ายใน path (ใช้ได้กับหลายเว็บ เช่น /product/12/345, -i345.html)
  function productId(url) {
    try {
      const ids = new URL(url).pathname.match(/\d{6,}/g);
      return ids ? ids[ids.length - 1] : "";
    } catch (_) { return ""; }
  }

  const firstNumber = (v) => {
    const m = String(v || "").replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? m[0] : "";
  };

  function mapColumns(header) {
    const map = {}, links = [];
    header.forEach((h, i) => {
      const kind = COLUMNS.find(([, re]) => re.test(String(h || "").trim()))?.[0];
      if (kind === "link") links.push({ i, name: String(h) });
      else if (kind && map[kind] === undefined) map[kind] = i;
    });
    // หลายคอลัมน์ลิงก์: ลิงก์ affiliate/ลิงก์สั้นใช้เป็นลิงก์หลัก ที่เหลือใช้หารหัสสินค้า
    const preferred = links.find(l => /affiliate|short|สั้น|aff/i.test(l.name)) || links[0];
    if (preferred) map.link = preferred.i;
    map.links = links.map(l => l.i);
    return map;
  }

  // คืน [{title, link, source, source_id, price, price_text, commission, sold_text, shop, image_url, category}]
  function fromCsv(text) {
    const table = parseCsv(text);
    if (!table.length) return [];
    const map = mapColumns(table[0]);
    const hasHeader = map.title !== undefined || map.link !== undefined || map.image !== undefined;
    const body = hasHeader ? table.slice(1) : table;
    return body.map(cells => {
      const get = (k) => (map[k] !== undefined ? cells[map[k]] || "" : "");
      const urls = cells.map(firstUrl).filter(Boolean);
      const image = firstUrl(get("image")) || urls.find(looksLikeImage) || "";
      const link = firstUrl(get("link")) || urls.find(u => u !== image && !looksLikeImage(u)) || "";
      const pageLinks = (map.links || []).map(i => firstUrl(cells[i])).filter(Boolean);
      const pageLink = pageLinks.find(u => u !== link) || link;
      const title = get("title") || cells.find(c => c && !isUrl(c) && !/^[\d\s.,%฿$-]+$/.test(c)) || "";
      const priceText = get("price").trim();
      return {
        title: title.replace(/\s+/g, " ").trim(),
        link,
        source: siteName(pageLink) || siteName(link),
        source_id: productId(pageLink),
        price: firstNumber(priceText),
        price_text: priceText,
        commission: firstNumber(get("commission")),
        sold_text: get("sold").trim(),
        shop: get("shop").trim(),
        image_url: image,
        category: get("category").trim(),
      };
    }).filter(r => r.title || r.link);
  }

  // โฆษณาเดิมรูปแบบ {title, text, href, image, sponsor, enabled} (เช่นจาก transfer)
  function fromLegacySlots(slots) {
    return (slots || []).filter(s => s && s.href && (s.type || "ad") === "ad").map(s => ({
      title: String(s.title || "").trim(),
      link: s.href,
      source: siteName(s.href),
      source_id: "",
      price: firstNumber(s.text),
      price_text: String(s.text || "").replace(/^ราคา\s*/, "").trim(),
      // ข้อความใต้หัวข้อของโฆษณาเดิมเก็บทั้งก้อนเป็นคำโปรย ให้เว็บแสดงได้เหมือนเดิม
      caption: String(s.text || "").trim(),
      commission: "",
      sold_text: "",
      shop: String(s.sponsor || "").trim(),
      image_url: s.image || "",
      category: "",
      enabled: s.enabled !== false,
    }));
  }

  return { parseCsv, mapColumns, fromCsv, fromLegacySlots, siteName, productId, host };
})();
if (typeof module !== "undefined") module.exports = HubImport;
