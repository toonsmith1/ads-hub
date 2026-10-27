/**
 * @file csv-helper.js
 * @description RFC 4180 Compliant CSV Helper for Shopee Affiliate & Threads Auto-Poster
 * Provides CSV export, state-machine parsing (multiline support, escaped quotes, delimiters),
 * and object mapping for threads_queue items, history logs, and product catalog.
 * 
 * Target: Google Chrome Extension Manifest V3 (Content Script, Popup, Dashboard, Service Worker, Node.js)
 * @author sodikinnaa
 * @license MIT
 */

(function (root) {
  'use strict';

  // Obtain constants from global CONSTANTS if available
  const APP_CONSTANTS = (typeof root !== 'undefined' && root.CONSTANTS) || {};

  /**
   * Standard columns for Threads Queue (threads_queue)
   */
  const DEFAULT_QUEUE_COLUMNS = APP_CONSTANTS.QUEUE_COLUMNS || [
    { key: 'id', header: 'id', label: 'id' },
    { key: 'title', header: 'nama_produk', label: 'nama_produk' },
    { key: 'price', header: 'harga', label: 'harga' },
    { key: 'discount', header: 'diskon', label: 'diskon' },
    { key: 'rating', header: 'rating', label: 'rating' },
    { key: 'sold', header: 'terjual', label: 'terjual' },
    { key: 'commission', header: 'estimasi_komisi', label: 'estimasi_komisi' },
    { key: 'shortLink', header: 'link_affiliate', label: 'link_affiliate' },
    { key: 'primaryImage', header: 'foto_produk', label: 'foto_produk' },
    { key: 'imageUrls', header: 'url_foto_hd', label: 'url_foto_hd' },
    { key: 'caption', header: 'caption_threads', label: 'caption_threads' },
    { key: 'status', header: 'status', label: 'status' },
    { key: 'scheduleTime', header: 'waktu_jadwal', label: 'waktu_jadwal' },
    { key: 'postedAt', header: 'waktu_post', label: 'waktu_post' },
    { key: 'threadsUrl', header: 'link_post_threads', label: 'link_post_threads' },
    { key: 'createdAt', header: 'waktu_dibuat', label: 'waktu_dibuat' }
  ];

  /**
   * Legacy column compatibility list
   */
  const CSV_COLUMNS = [
    { key: 'id', header: 'ID', label: 'ID' },
    { key: 'title', header: 'Judul_Produk', label: 'Judul_Produk' },
    { key: 'price', header: 'Harga', label: 'Harga' },
    { key: 'discount', header: 'Diskon', label: 'Diskon' },
    { key: 'rating', header: 'Rating', label: 'Rating' },
    { key: 'sold', header: 'Terjual', label: 'Terjual' },
    { key: 'commission', header: 'Komisi', label: 'Komisi' },
    { key: 'imageUrls', header: 'URL_Foto_HD', label: 'URL_Foto_HD' },
    { key: 'shortLink', header: 'Short_Link_Shopee', label: 'Short_Link_Shopee' },
    { key: 'caption', header: 'Caption_Threads', label: 'Caption_Threads' },
    { key: 'status', header: 'Status', label: 'Status' },
    { key: 'postedAt', header: 'Waktu_Post', label: 'Waktu_Post' }
  ];

  /**
   * Helper class for CSV Operations
   */
  class CSVHelperEngine {
    constructor() {
      this.QUEUE_COLUMNS = DEFAULT_QUEUE_COLUMNS;
      this.CSV_COLUMNS = CSV_COLUMNS;
      this.DEFAULT_COLUMNS = DEFAULT_QUEUE_COLUMNS;
    }

    /**
     * Meng-escape satu nilai cell agar aman untuk CSV (RFC 4180)
     * @param {any} value - Nilai sel
     * @returns {string} Nilai sel yang sudah diescape
     */
    escapeCSVCell(value) {
      if (value === null || value === undefined) {
        return '';
      }

      let str = String(value);
      const needsQuotes = str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(';');

      if (needsQuotes) {
        str = str.replace(/"/g, '""');
        return `"${str}"`;
      }

      return str;
    }

    /**
     * Mengonversi array objek menjadi string CSV ber-BOM UTF-8 (RFC 4180 compliant)
     * @param {Array<Object>} items - Array data item
     * @param {Array<Object>} [columns=DEFAULT_QUEUE_COLUMNS] - Konfigurasi kolom
     * @returns {string} String CSV
     */
    toCSV(items, columns = DEFAULT_QUEUE_COLUMNS) {
      if (!Array.isArray(items)) {
        items = [];
      }

      const cols = (Array.isArray(columns) ? columns : DEFAULT_QUEUE_COLUMNS).map(c => ({
        key: c.key,
        header: c.label || c.header || c.key
      }));

      const headerRow = cols.map(c => this.escapeCSVCell(c.header)).join(',');
      if (items.length === 0) {
        return '\uFEFF' + headerRow + '\r\n';
      }

      const rows = [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;

        const rowValues = cols.map(col => {
          let val = item[col.key];

          // Format fallback untuk properti umum
          switch (col.key) {
            case 'title':
              val = item.title || item.rawTitle || item.name || item.product_name || '';
              break;
            case 'price':
              val = item.price || item.harga || '-';
              break;
            case 'discount':
              val = item.discount || item.diskon || '';
              break;
            case 'rating':
              val = item.rating || '';
              break;
            case 'sold':
              val = item.sold || item.terjual || '';
              break;
            case 'commission':
              val = item.commission || item.comm_rate || item.commRate || item.estimasi_komisi || '-';
              break;
            case 'shortLink':
              val = item.shortLink || item.short_link || item.url || item.link || item.link_affiliate || '';
              break;
            case 'primaryImage':
              val = item.primaryImage || (Array.isArray(item.images) && item.images[0]) || (Array.isArray(item.imageUrls) && item.imageUrls[0]) || item.imageUrl || '';
              break;
            case 'imageUrls':
              if (Array.isArray(item.images) && item.images.length > 0) {
                val = item.images.join(' | ');
              } else if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) {
                val = item.imageUrls.join(' | ');
              } else if (Array.isArray(item.image_urls) && item.image_urls.length > 0) {
                val = item.image_urls.join(' | ');
              } else {
                val = item.primaryImage || item.imageUrl || '';
              }
              break;
            case 'caption':
              val = item.caption || item.caption_threads || item.caption_text || '';
              break;
            case 'status':
              val = item.status || 'PENDING';
              break;
            case 'scheduleTime':
              val = item.scheduleTime || item.schedule_time || '';
              break;
            case 'postedAt':
              val = item.postedAt || item.posted_at || '';
              break;
            case 'threadsUrl':
              val = item.threadsUrl || item.threads_url || '';
              break;
            case 'createdAt':
              val = item.createdAt || item.created_at || '';
              break;
            default:
              if (val === undefined || val === null) val = '';
          }

          return this.escapeCSVCell(val);
        });

        rows.push(rowValues.join(','));
      }

      // Prepend UTF-8 BOM (\uFEFF) untuk kompatibilitas Excel & karakter emoji
      return '\uFEFF' + headerRow + '\r\n' + rows.join('\r\n') + '\r\n';
    }

    /**
     * Alias toCSV()
     */
    generateCSVString(items, customColumns = CSV_COLUMNS) {
      return this.toCSV(items, customColumns);
    }

    /**
     * Memicu download file CSV di browser DOM
     * @param {string} csvContent - Konten string CSV
     * @param {string} [filename='shopee_threads_queue.csv'] - Nama file target
     * @returns {boolean} Status keberhasilan download
     */
    downloadCSV(csvContent, filename = 'shopee_threads_queue.csv') {
      if (typeof document === 'undefined') {
        console.warn('[CSVHelper] DOM document tidak tersedia di context saat ini.');
        return false;
      }

      try {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        return true;
      } catch (err) {
        console.error('[CSVHelper] Gagal memicu download CSV:', err);
        return false;
      }
    }

    triggerCSVDownload(csvContent, filename = 'shopee_threads_queue.csv') {
      return this.downloadCSV(csvContent, filename);
    }

    /**
     * Ekspor produk / queue langsung dan memicu download otomatis
     * @param {Array<Object>} products
     * @param {string|null} [filename=null]
     * @returns {string} String CSV
     */
    exportProductsToCSV(products, filename = null) {
      let targetFile = filename;
      if (!targetFile) {
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        targetFile = `Shopee_Threads_Queue_${dateStr}.csv`;
      }

      const csvContent = this.toCSV(products, DEFAULT_QUEUE_COLUMNS);
      if (typeof document !== 'undefined') {
        this.downloadCSV(csvContent, targetFile);
      }
      return csvContent;
    }

    /**
     * Parser CSV State-Machine (Mendukung multiline caption, kutip ganda RFC 4180, delimiter koma & titik koma)
     * @param {string} csvText - Teks CSV mentah
     * @returns {Array<Array<string>>} Matrix baris & kolom
     */
    parseCSVToMatrix(csvText) {
      if (!csvText || typeof csvText !== 'string') return [];

      let text = csvText;
      // Strip UTF-8 BOM if present
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
      }

      // Deteksi delimiter
      let delimiter = ',';
      const firstLine = text.split(/\r?\n/)[0] || '';
      if (!firstLine.includes(',') && firstLine.includes(';')) {
        delimiter = ';';
      }

      const rows = [];
      let currentRow = [];
      let currentCell = '';
      let inQuotes = false;
      let i = 0;
      const len = text.length;

      while (i < len) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            currentCell += '"';
            i += 2;
            continue;
          } else {
            inQuotes = !inQuotes;
            i++;
            continue;
          }
        }

        if (!inQuotes) {
          if (char === delimiter) {
            currentRow.push(currentCell.trim());
            currentCell = '';
            i++;
            continue;
          }

          if (char === '\r' || char === '\n') {
            currentRow.push(currentCell.trim());
            currentCell = '';

            if (char === '\r' && nextChar === '\n') {
              i++;
            }

            if (currentRow.length > 0 && currentRow.some(c => c !== '')) {
              rows.push(currentRow);
            }
            currentRow = [];
            i++;
            continue;
          }
        }

        currentCell += char;
        i++;
      }

      // Push remaining cell / row
      if (currentCell !== '' || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c !== '')) {
          rows.push(currentRow);
        }
      }

      return rows;
    }

    /**
     * Memetakan nama kolom header mentah ke properti standar
     * @param {string} rawHeader
     * @returns {string}
     */
    normalizeHeaderKey(rawHeader) {
      const clean = String(rawHeader || '').toLowerCase().replace(/[^a-z0-9_]/g, '');

      if (['id', 'item_id', 'itemid', 'queue_id'].includes(clean)) return 'id';
      if (['title', 'judul', 'judul_produk', 'nama_produk', 'product_name', 'productname', 'name'].includes(clean)) return 'title';
      if (['harga', 'price', 'product_price'].includes(clean)) return 'price';
      if (['diskon', 'discount', 'potongan'].includes(clean)) return 'discount';
      if (['rating', 'rate', 'bintang'].includes(clean)) return 'rating';
      if (['terjual', 'sold', 'sales'].includes(clean)) return 'sold';
      if (['komisi', 'comm_rate', 'commission', 'commrate', 'estimasi_komisi'].includes(clean)) return 'commission';
      if (['short_link', 'shortlink', 'link', 'url', 'link_affiliate', 'affiliate_link', 'short_link_shopee'].includes(clean)) return 'shortLink';
      if (['foto_produk', 'primary_image', 'primaryimage', 'cover', 'thumbnail'].includes(clean)) return 'primaryImage';
      if (['url_foto_hd', 'url_foto', 'images', 'image_urls', 'imageurls', 'foto', 'foto_hd'].includes(clean)) return 'imageUrls';
      if (['caption_threads', 'caption', 'caption_text', 'text', 'spintax_caption'].includes(clean)) return 'caption';
      if (['status', 'queue_status'].includes(clean)) return 'status';
      if (['waktu_jadwal', 'schedule_time', 'scheduletime', 'jadwal'].includes(clean)) return 'scheduleTime';
      if (['waktu_post', 'posted_at', 'postedat', 'waktu'].includes(clean)) return 'postedAt';
      if (['link_post_threads', 'threads_url', 'threadsurl', 'post_url'].includes(clean)) return 'threadsUrl';
      if (['waktu_dibuat', 'created_at', 'createdat'].includes(clean)) return 'createdAt';

      return clean;
    }

    /**
     * Mengonversi satu baris objek menjadi item threads_queue standar
     * @param {Object} row
     * @returns {Object|null}
     */
    mapRowToQueueItem(row) {
      if (!row || typeof row !== 'object') return null;

      const getField = (...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
            return row[k];
          }
        }
        return '';
      };

      const title = getField('title', 'nama_produk', 'judul_produk', 'rawTitle', 'name') || 'Produk Shopee';
      const price = getField('price', 'harga') || '-';
      const discount = getField('discount', 'diskon') || '';
      const rating = getField('rating') || '⭐ 4.9';
      const sold = getField('sold', 'terjual') || '-';
      const commission = getField('commission', 'comm_rate', 'commRate', 'estimasi_komisi') || '-';
      const shortLink = getField('shortLink', 'short_link', 'link_affiliate', 'url', 'link') || '';

      // Parsing daftar gambar
      let images = [];
      const rawImages = getField('imageUrls', 'image_urls', 'images', 'url_foto_hd');
      if (Array.isArray(rawImages)) {
        images = rawImages.filter(Boolean);
      } else if (typeof rawImages === 'string' && rawImages.trim()) {
        if (rawImages.includes('|')) {
          images = rawImages.split('|').map(s => s.trim()).filter(Boolean);
        } else if (rawImages.includes(',')) {
          images = rawImages.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          images = [rawImages.trim()];
        }
      }

      const primaryImage = getField('primaryImage', 'foto_produk') || (images.length > 0 ? images[0] : '');
      if (primaryImage && !images.includes(primaryImage)) {
        images.unshift(primaryImage);
      }

      const caption = getField('caption', 'caption_threads', 'caption_text') || '';
      const statusVal = (getField('status') || 'PENDING').toUpperCase();
      const validStatuses = ['PENDING', 'POSTING', 'PROCESSING', 'POSTED', 'FAILED'];
      const status = validStatuses.includes(statusVal) ? ((statusVal === 'PROCESSING') ? 'POSTING' : statusVal) : 'PENDING';

      const id = getField('id') || `imp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const scheduleTime = getField('scheduleTime', 'schedule_time', 'waktu_jadwal') || new Date().toISOString();
      const postedAt = getField('postedAt', 'posted_at', 'waktu_post') || null;
      const threadsUrl = getField('threadsUrl', 'threads_url', 'link_post_threads') || null;
      const createdAt = getField('createdAt', 'created_at', 'waktu_dibuat') || new Date().toISOString();

      return {
        id,
        productId: id,
        product_id: id,
        shopeeId: id,
        shopee_id: id,
        title,
        price,
        discount,
        rating,
        sold,
        terjual: sold,
        commission,
        comm_rate: commission,
        commRate: commission,
        shortLink,
        short_link: shortLink,
        primaryImage,
        images,
        imageUrls: images,
        image_urls: images,
        caption,
        status,
        scheduleTime,
        schedule_time: scheduleTime,
        postedAt,
        posted_at: postedAt,
        threadsUrl,
        threads_url: threadsUrl,
        retryCount: 0,
        retry_count: 0,
        error: null,
        createdAt,
        created_at: createdAt,
        updatedAt: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }

    /**
     * Membaca teks CSV menjadi array objek dengan key yang sudah dinormalisasi
     * @param {string} csvText
     * @returns {Array<Object>}
     */
    parseCSV(csvText) {
      const matrix = this.parseCSVToMatrix(csvText);
      if (!matrix || matrix.length < 2) {
        return [];
      }

      const rawHeaders = matrix[0];
      const keyMap = rawHeaders.map(h => this.normalizeHeaderKey(h));
      const parsedRows = [];

      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r];
        if (!row || row.length === 0) continue;

        const obj = {};
        let hasData = false;

        for (let c = 0; c < row.length; c++) {
          const key = keyMap[c] || `col_${c}`;
          const val = (row[c] !== undefined) ? row[c] : '';
          obj[key] = val;
          if (val !== '') hasData = true;
        }

        if (hasData) {
          parsedRows.push(obj);
        }
      }

      return parsedRows;
    }

    /**
     * Membaca teks CSV dan langsung mengubahnya menjadi array queue items
     * @param {string} csvText
     * @returns {Array<Object>}
     */
    parseCSVToProducts(csvText) {
      const parsedRows = this.parseCSV(csvText);
      return parsedRows.map(row => this.mapRowToQueueItem(row)).filter(Boolean);
    }

    parseCSVToQueue(csvText) {
      return this.parseCSVToProducts(csvText);
    }
  }

  // Create singleton instance
  const csvHelperInstance = new CSVHelperEngine();

  // Export for CommonJS (Node.js)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = csvHelperInstance;
    module.exports.CSVHelper = csvHelperInstance;
    module.exports.CSVHelperEngine = CSVHelperEngine;
  }

  // Export to Global Scope (Content Script, Popup, Dashboard, Service Worker)
  if (root) {
    root.CSVHelper = csvHelperInstance;
    root.CSVHelperEngine = CSVHelperEngine;
    root.exportProductsToCSV = (...args) => csvHelperInstance.exportProductsToCSV(...args);
    root.parseCSVToProducts = (...args) => csvHelperInstance.parseCSVToProducts(...args);
    root.toCSV = (...args) => csvHelperInstance.toCSV(...args);
    root.downloadCSV = (...args) => csvHelperInstance.downloadCSV(...args);
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : typeof global !== 'undefined' ? global
  : this);
