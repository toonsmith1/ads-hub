/**
 * CSV & Export Service (Thai Edition)
 * Handles CSV parsing, RFC 4180 formatting, TXT export, and ZIP compilation.
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CsvService = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CsvService = {
    /**
     * Generate standard RFC 4180 compliant CSV string from product array
     * @param {Array<Object>} products 
     * @returns {string} CSV string
     */
    generateCSV(products) {
      if (!Array.isArray(products)) return '';
      const headers = ['ลำดับ', 'ชื่อสินค้า', 'ราคา', 'ค่าคอมมิชชัน', 'ยอดขาย', 'ลิงก์ Affiliate', 'ลิงก์สินค้าต้นฉบับ', 'URL รูปภาพ', 'วันที่บันทึก'];
      const rows = products.map((p, idx) => {
        const title = (p.title || p.rawTitle || '').replace(/"/g, '""');
        const price = (p.price || '-').replace(/"/g, '""');
        const commission = (p.commission || '10%').replace(/"/g, '""');
        const sold = (p.sold || '-').replace(/"/g, '""');
        const shortLink = (p.shortLink || p.link || '').replace(/"/g, '""');
        const longLink = (p.longLink || p.url || '').replace(/"/g, '""');
        const image = (p.image || p.cleanImgUrl || '').replace(/"/g, '""');
        const date = p.createdAt || new Date().toISOString().slice(0, 10);

        return [
          idx + 1,
          `"${title}"`,
          `"${price}"`,
          `"${commission}"`,
          `"${sold}"`,
          `"${shortLink}"`,
          `"${longLink}"`,
          `"${image}"`,
          `"${date}"`
        ].join(',');
      });

      return [headers.join(','), ...rows].join('\r\n');
    },

    /**
     * Parse CSV string into product objects with RFC 4180 quote escaping support
     * @param {string} csvText 
     * @returns {Array<Object>} Parsed products array
     */
    parseCSV(csvText) {
      if (!csvText || typeof csvText !== 'string') return [];
      const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length <= 1) return [];

      const parsedItems = [];
      const headerLine = lines[0].toLowerCase();
      const isHeader = headerLine.includes('ชื่อ') || headerLine.includes('สินค้า') || headerLine.includes('nama') || headerLine.includes('produk') || headerLine.includes('title');
      const startIdx = isHeader ? 1 : 0;

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const cols = [];
        let cur = '';
        let inQuotes = false;

        for (let c = 0; c < line.length; c++) {
          const ch = line[c];
          if (ch === '"') {
            if (inQuotes && line[c + 1] === '"') {
              cur += '"';
              c++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === ',' && !inQuotes) {
            cols.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        cols.push(cur.trim());

        if (cols.length >= 2) {
          const title = cols[1] || cols[0] || 'สินค้านำเข้า';
          const price = cols[2] || '-';
          const commission = cols[3] || '10%';
          const sold = cols[4] || 'ขายแล้ว 1พัน+ ชิ้น';
          const shortLink = cols[5] || cols.find(c => c.startsWith('http')) || 'https://s.shopee.co.th';
          const longLink = cols[6] || '';
          const image = cols[7] || cols.find(c => c.includes('.jpg') || c.includes('.png') || c.includes('susercontent')) || '';

          parsedItems.push({
            id: `import_${Date.now()}_${i}`,
            title,
            rawTitle: title,
            price,
            commission,
            sold,
            shortLink,
            longLink,
            image,
            cleanImgUrl: image,
            createdAt: new Date().toISOString()
          });
        }
      }

      return parsedItems;
    },

    /**
     * Generate text summary of affiliate links
     * @param {Array<Object>} products 
     * @returns {string} Formatted text
     */
    generateTXT(products) {
      if (!Array.isArray(products) || products.length === 0) return '';
      let txt = `==================================================\n`;
      txt += `รายการลิงก์สั้น SHOPEE AFFILIATE ประเทศไทย\n`;
      txt += `วันที่: ${new Date().toLocaleDateString('th-TH')}\n`;
      txt += `จำนวนสินค้าทั้งหมด: ${products.length}\n`;
      txt += `==================================================\n\n`;

      products.forEach((p, idx) => {
        const paddedIndex = String(idx + 1).padStart(2, '0');
        const title = p.rawTitle || p.title || `สินค้า ${idx + 1}`;
        const price = p.price ? ((String(p.price).startsWith('฿') || String(p.price).startsWith('Rp')) ? p.price : `฿${p.price}`) : '-';
        const safeTitle = (p.safeTitle || p.title || title).replace(/[^a-zA-Z0-9_\-\s\u0E00-\u0E7F]/g, '').trim().replace(/\s+/g, '_').substring(0, 40);
        const extMatch = (p.image || p.cleanImgUrl || '').match(/\.(jpg|jpeg|png|webp)/i);
        const ext = extMatch ? extMatch[1] : 'webp';
        const filename = `${paddedIndex}_${safeTitle}.${ext}`;

        txt += `[${paddedIndex}] ${title}\n`;
        txt += `- ราคา: ${price}\n`;
        txt += `- ไฟล์รูปภาพ: foto_produk/${filename}\n`;
        txt += `- ลิงก์สั้น Affiliate: ${p.shortLink || p.link || '-'}\n`;
        txt += `--------------------------------------------------\n\n`;
      });
      return txt;
    },

    /**
     * Trigger browser download for CSV
     * @param {Array<Object>} products 
     * @param {string} customFilename 
     */
    downloadCSV(products, customFilename) {
      if (!products || products.length === 0) throw new Error('ไม่มีสินค้าสำหรับส่งออก');
      const csvStr = this.generateCSV(products);
      const blob = new Blob(['\uFEFF' + csvStr], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = customFilename || `Shopee_Affiliate_Products_${dateStr}_${products.length}_items.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },

    /**
     * Trigger browser download for TXT
     * @param {Array<Object>} products 
     * @param {string} customFilename 
     */
    downloadTXT(products, customFilename) {
      if (!products || products.length === 0) throw new Error('ไม่มีสินค้าสำหรับส่งออก');
      const txt = this.generateTXT(products);
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = customFilename || `Shopee_Affiliate_Links_${dateStr}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },

    /**
     * Build ZIP archive with images, CSV, and TXT links
     * @param {Array<Object>} products 
     * @param {Object} [options] 
     * @param {Function} [options.onProgress] 
     * @param {Function} [options.isCancelled] 
     * @returns {Promise<Blob>}
     */
    async buildZipBlob(products, options = {}) {
      if (!Array.isArray(products) || products.length === 0) {
        throw new Error('ไม่มีสินค้าสำหรับสร้างไฟล์ ZIP');
      }
      const JSZipLib = (typeof window !== 'undefined' && window.JSZip) || (typeof global !== 'undefined' && global.JSZip);
      if (!JSZipLib) {
        throw new Error('ไลบรารี JSZip ยังไม่พร้อมใช้งาน');
      }

      const zip = new JSZipLib();
      const folder = zip.folder('foto_produk');

      for (let i = 0; i < products.length; i++) {
        if (options.isCancelled && options.isCancelled()) break;
        const p = products[i];
        const imgUrl = p.image || p.cleanImgUrl || (Array.isArray(p.images) && p.images[0]);
        if (imgUrl) {
          try {
            const res = await fetch(imgUrl);
            const blob = await res.blob();
            const extMatch = imgUrl.match(/\.(jpg|jpeg|png|webp)/i);
            const ext = extMatch ? extMatch[1] : 'jpg';
            const safeTitle = (p.title || p.safeTitle || p.rawTitle || `product_${i+1}`).replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_').substring(0, 35);
            folder.file(`${String(i + 1).padStart(3, '0')}_${safeTitle}.${ext}`, blob);
          } catch (e) {
            console.warn(`ดาวน์โหลดรูปภาพสินค้าลำดับที่ ${i} ไม่สำเร็จ:`, e);
          }
        }
        if (typeof options.onProgress === 'function') {
          options.onProgress(i + 1, products.length);
        }
      }

      // Add TXT & CSV
      zip.file('daftar_produk.csv', this.generateCSV(products));
      zip.file('link_singkat_affiliate.txt', this.generateTXT(products));

      return await zip.generateAsync({ type: 'blob' });
    },

    /**
     * Generate & trigger browser download for ZIP file
     * @param {Array<Object>} products 
     * @param {Object} [options] 
     * @returns {Promise<void>}
     */
    async downloadZIP(products, options = {}) {
      const zipBlob = await this.buildZipBlob(products, options);
      if (options.isCancelled && options.isCancelled()) return;

      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = zipUrl;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = options.filename || `Shopee_Affiliate_Products_${dateStr}_${products.length}_items.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(zipUrl), 30000);
    }
  };

  return CsvService;
});
