/**
 * @file poster-panel.js
 * @description Dedicated Poster & Live Debug Console Panel Controller
 * Architecture: Clean Architecture / Modular MVC Pattern (Chrome Extension Manifest V3)
 * 
 * Focus:
 * 1. Single-Item Post Workflow (1 per 1):
 *    - Prominent "🚀 Post Item Ini Sekarang" hero action button.
 *    - Clear active product preview: HD Photos, Title, IDR Price, Affiliate Link, Editable Spintax Caption.
 *    - Sequential queue navigation (⬅️ Item Sebelumnya, ➡️ Item Berikutnya).
 *    - Minimized / secondary auto-post mode to prioritize stable single-item posting.
 * 2. Clear, Step-by-Step Terminal Logging:
 *    - Step 1: ⏳ Membuka form Utas Baru Threads...
 *    - Step 2: ✍️ Mengetik caption produk...
 *    - Step 3: 🔘 Mengklik tombol Kirim via XPath...
 *    - Step 4: 🎉 SUKSES DIPOSTING! 🔗 Link: https://www.threads.net/@user/post/...
 * 3. Robust Integration & Synchronization:
 *    - Real-time status synchronization to chrome.storage.local (PENDING -> POSTING -> POSTED / FAILED).
 *    - Storage listener for cross-tab / cross-context reactivity (Popup, Dashboard, Threads Content Script).
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root);
  } else {
    root.PosterPanel = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : typeof global !== 'undefined' ? global
  : this, function (root) {
  'use strict';

  // ===========================================================================
  // CONSTANTS & FALLBACK CONFIGURATION
  // ===========================================================================
  const APP_CONSTANTS = (typeof root !== 'undefined' && (root.CONSTANTS || root.ExtensionConstants)) || {};
  
  const STORAGE_KEYS = APP_CONSTANTS.STORAGE_KEYS || {
    QUEUE: 'threads_queue',
    LOGS: 'threads_logs',
    HISTORY: 'threads_history',
    SETTINGS: 'threads_settings',
    TEMPLATES: 'threads_templates',
    PRODUCTS: 'threads_products'
  };

  const QUEUE_STATUS = APP_CONSTANTS.QUEUE_STATUS || {
    PENDING: 'PENDING',
    POSTING: 'POSTING',
    PROCESSING: 'POSTING',
    POSTED: 'POSTED',
    FAILED: 'FAILED'
  };

  const ACTIONS = APP_CONSTANTS.ACTIONS || {
    POST_NEXT_ITEM: 'POST_NEXT_ITEM',
    POST_SINGLE_ITEM: 'POST_SINGLE_ITEM',
    EXECUTE_POST_NOW: 'EXECUTE_POST_NOW',
    INJECT_POST_PAYLOAD: 'INJECT_POST_PAYLOAD',
    START_QUEUE: 'START_QUEUE',
    STOP_QUEUE: 'STOP_QUEUE',
    PAUSE_QUEUE: 'PAUSE_QUEUE',
    FOCUS_OR_OPEN_THREADS: 'FOCUS_OR_OPEN_THREADS',
    OPEN_THREADS_WIDGET: 'OPEN_THREADS_WIDGET',
    CHECK_THREADS_SESSION: 'CHECK_THREADS_SESSION',
    DEBUG_LOG_STREAM: 'DEBUG_LOG_STREAM',
    QUEUE_UPDATED: 'QUEUE_UPDATED',
    POST_COMPLETED: 'POST_COMPLETED',
    POST_FAILED: 'POST_FAILED',
    NOTIFY_POST_SUCCESS: 'NOTIFY_POST_SUCCESS',
    NOTIFY_POST_FAILED: 'NOTIFY_POST_FAILED'
  };

  // ===========================================================================
  // UTILITY HELPERS
  // ===========================================================================
  const PanelUtils = {
    /**
     * Escape HTML string to prevent XSS injection
     * @param {string} str 
     * @returns {string}
     */
    escapeHTML(str) {
      if (!str && str !== 0) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },

    /**
     * Generate unique identifier
     * @param {string} prefix 
     * @returns {string}
     */
    generateId(prefix = 'id') {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID().replace(/-/g, '').substring(0, 10)}`;
      }
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    },

    /**
     * Format price cleanly as Indonesian Rupiah (Rp)
     * @param {string|number} price 
     * @returns {string}
     */
    formatPrice(price) {
      if (!price && price !== 0) return '-';
      const str = String(price).trim();
      if (str.startsWith('Rp') || str.startsWith('rp')) return str;
      const num = parseFloat(str.replace(/[^0-9.-]+/g, ''));
      if (!isNaN(num) && isFinite(num)) {
        return 'Rp ' + Math.round(num).toLocaleString('id-ID');
      }
      return str || '-';
    },

    /**
     * Format timestamp to HH:mm:ss or HH:mm:ss.SSS
     * @param {Date|number|string} [date] 
     * @param {boolean} [includeMs=false]
     * @returns {string}
     */
    formatTime(date = new Date(), includeMs = false) {
      try {
        const d = date instanceof Date ? date : new Date(date);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        if (includeMs) {
          const ms = String(d.getMilliseconds()).padStart(3, '0');
          return `${hours}:${minutes}:${seconds}.${ms}`;
        }
        return `${hours}:${minutes}:${seconds}`;
      } catch (_) {
        return '00:00:00';
      }
    },

    /**
     * Format date & time to localized string
     * @param {Date|string} date 
     * @returns {string}
     */
    formatDateTime(date = new Date()) {
      try {
        const d = date instanceof Date ? date : new Date(date);
        return d.toLocaleString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch (_) {
        return '-';
      }
    },

    /**
     * Truncate string with ellipsis
     * @param {string} str 
     * @param {number} maxLen 
     * @returns {string}
     */
    truncate(str, maxLen = 40) {
      if (!str) return '';
      const clean = String(str).trim();
      if (clean.length <= maxLen) return clean;
      return clean.substring(0, maxLen).trim() + '...';
    },

    /**
     * Copy text to clipboard with modern API & execCommand fallback
     * @param {string} text 
     * @returns {Promise<boolean>}
     */
    async copyToClipboard(text) {
      if (!text) return false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (_) {}

      // Fallback
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
      } catch (_) {
        return false;
      }
    },

    /**
     * Download text payload as a local file
     * @param {string} content 
     * @param {string} filename 
     * @param {string} mimeType 
     */
    downloadFile(content, filename = 'debug-log.txt', mimeType = 'text/plain;charset=utf-8') {
      try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 300);
      } catch (err) {
        console.error('[PanelUtils] Error saat mengunduh file:', err);
      }
    },

    /**
     * Pure Spintax parser fallback if external libs/spintax.js is not loaded
     * @param {string} text 
     * @returns {string}
     */
    parseSpintaxFallback(text) {
      if (!text || typeof text !== 'string') return '';
      let parsed = text;
      const spintaxRegex = /\{([^{}]+)\}/;
      let match;
      let iterations = 0;
      while ((match = spintaxRegex.exec(parsed)) !== null && iterations < 300) {
        iterations++;
        const content = match[1];
        const options = content.split('|');
        const selected = options[Math.floor(Math.random() * options.length)];
        parsed = parsed.slice(0, match.index) + selected + parsed.slice(match.index + match[0].length);
      }
      return parsed;
    },

    /**
     * Replace dynamic variables in caption
     * @param {string} template 
     * @param {Object} product 
     * @returns {string}
     */
    fillTemplateVariables(template, product = {}) {
      if (!template) return '';
      let text = template;
      const title = product.title || product.name || 'Produk Rekomendasi Shopee';
      const price = PanelUtils.formatPrice(product.price || '-');
      const discount = product.discount ? `(Diskon ${String(product.discount).replace(/[^0-9%]/g, '')})` : '';
      const shortLink = product.shortLink || product.short_link || product.url || '';
      const rating = product.rating || '⭐ 4.9';
      const sold = product.sold ? `${product.sold} terjual` : '';
      const commission = product.commission || product.comm_rate || '-';
      const hashtags = product.hashtags || '#RacunShopee #ShopeeHaul #BarangViral #ShopeeAffiliateID';

      const replacements = {
        '{nama_produk}': title,
        '{product_name}': title,
        '{judul}': title,
        '{title}': title,
        '{harga}': price,
        '{price}': price,
        '{diskon}': discount,
        '{discount}': discount,
        '{link_affiliate}': shortLink,
        '{short_link}': shortLink,
        '{link}': shortLink,
        '{url}': shortLink,
        '{rating}': rating,
        '{terjual}': sold,
        '{sold}': sold,
        '{komisi}': commission,
        '{comm_rate}': commission,
        '{hashtag_random}': hashtags,
        '{hashtags}': hashtags
      };

      for (const [key, val] of Object.entries(replacements)) {
        const escapedKey = key.replace(/[{}]/g, '\\$&');
        text = text.replace(new RegExp(escapedKey, 'gi'), val);
      }

      return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }
  };

  // ===========================================================================
  // 1. PANEL QUEUE MANAGER
  // ===========================================================================
  /**
   * Manages local queue dataset from chrome.storage.local ('threads_queue'),
   * handles real-time synchronization, active item selection, and state mutations.
   */
  class PanelQueueManager {
    constructor() {
      this.queue = [];
      this.activeItemId = null;
      this.subscribers = new Set();
      this.storageKey = STORAGE_KEYS.QUEUE || 'threads_queue';
      this.isListening = false;
    }

    /**
     * Initialize queue manager & load initial dataset
     */
    async init() {
      await this.loadQueue();
      this.setupStorageListener();
      return this;
    }

    /**
     * Normalize raw queue item object
     * @param {Object} raw 
     * @param {number} [idx=0] 
     * @returns {Object|null}
     */
    normalizeItem(raw, idx = 0) {
      if (!raw || typeof raw !== 'object') return null;

      const id = String(raw.id || PanelUtils.generateId(`item_${idx}`));
      const productId = String(raw.productId || raw.product_id || raw.shopeeId || raw.shopee_id || id);
      const title = (raw.title || raw.rawTitle || raw.name || raw.product_name || 'Produk Shopee').trim();
      const price = raw.price || raw.harga || '-';
      const originalPrice = raw.originalPrice || raw.original_price || raw.hargaCoret || '';
      const discount = raw.discount || raw.diskon || '';
      const rating = raw.rating || '⭐ 4.9';
      const sold = raw.sold || raw.terjual || '';
      const commission = raw.commission || raw.comm_rate || raw.commRate || '-';
      const shortLink = (raw.shortLink || raw.short_link || raw.url || raw.link || '').trim();

      // Normalize images array
      let imageUrls = [];
      if (Array.isArray(raw.imageUrls) && raw.imageUrls.length > 0) {
        imageUrls = raw.imageUrls.filter(Boolean);
      } else if (Array.isArray(raw.images) && raw.images.length > 0) {
        imageUrls = raw.images.filter(Boolean);
      } else if (Array.isArray(raw.image_urls) && raw.image_urls.length > 0) {
        imageUrls = raw.image_urls.filter(Boolean);
      } else if (raw.primaryImage || raw.imageUrl || raw.cleanImgUrl) {
        imageUrls = [raw.primaryImage || raw.imageUrl || raw.cleanImgUrl];
      }

      const primaryImage = raw.primaryImage || (imageUrls.length > 0 ? imageUrls[0] : '');
      const caption = raw.caption || raw.caption_threads || '';
      const rawStatus = (raw.status || QUEUE_STATUS.PENDING).toUpperCase();
      const status = (rawStatus === 'PROCESSING') ? QUEUE_STATUS.POSTING : rawStatus;
      const scheduleTime = raw.scheduleTime || raw.schedule_time || new Date().toISOString();
      const postedAt = raw.postedAt || raw.posted_at || null;
      const threadsUrl = raw.threadsUrl || raw.threads_url || null;
      const retryCount = Number(raw.retryCount || raw.retry_count || 0);
      const error = raw.error || raw.errorMessage || null;
      const createdAt = raw.createdAt || raw.created_at || new Date().toISOString();
      const updatedAt = raw.updatedAt || raw.updated_at || new Date().toISOString();

      return {
        id,
        productId,
        product_id: productId,
        shopeeId: productId,
        shopee_id: productId,
        title,
        price,
        originalPrice,
        discount,
        rating,
        sold,
        commission,
        shortLink,
        short_link: shortLink,
        primaryImage,
        imageUrls,
        images: imageUrls,
        caption,
        status, // PENDING, POSTING, POSTED, FAILED
        scheduleTime,
        postedAt,
        threadsUrl,
        retryCount,
        error,
        createdAt,
        updatedAt
      };
    }

    /**
     * Load queue dataset from chrome.storage.local with fallbacks
     * @returns {Promise<Array>}
     */
    async loadQueue() {
      let rawItems = null;

      // 1. chrome.storage.local
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          const res = await new Promise((resolve) => {
            chrome.storage.local.get([this.storageKey], (data) => {
              if (chrome.runtime?.lastError) resolve({});
              else resolve(data || {});
            });
          });
          if (Array.isArray(res[this.storageKey])) {
            rawItems = res[this.storageKey];
          }
        } catch (_) {}
      }

      // 2. Database Fallback (libs/db.js)
      if (!rawItems) {
        const dbObj = (typeof root.DB !== 'undefined') ? root.DB : (typeof root.ShopeeDB !== 'undefined' ? root.ShopeeDB : null);
        if (dbObj && typeof dbObj.getQueue === 'function') {
          try {
            const dbList = await dbObj.getQueue();
            if (Array.isArray(dbList)) rawItems = dbList;
          } catch (_) {}
        }
      }

      // 3. Background Message Fallback
      if (!rawItems && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'GET_QUEUE' }, (r) => {
              if (chrome.runtime?.lastError) resolve(null);
              else resolve(r);
            });
          });
          if (response && Array.isArray(response.queue)) {
            rawItems = response.queue;
          }
        } catch (_) {}
      }

      this.queue = Array.isArray(rawItems)
        ? rawItems.map((item, i) => this.normalizeItem(item, i)).filter(Boolean)
        : [];

      // Ensure valid activeItemId
      if (!this.activeItemId || !this.getItemById(this.activeItemId)) {
        const firstPending = this.getPendingItems()[0];
        this.activeItemId = firstPending ? firstPending.id : (this.queue[0] ? this.queue[0].id : null);
      }

      this.notify('queue_loaded', { queue: this.queue, stats: this.getStats() });
      return this.queue;
    }

    /**
     * Save queue to chrome.storage.local & DB
     * @param {Array} newQueue 
     */
    async saveQueue(newQueue) {
      const normalized = (newQueue || []).map((it, i) => this.normalizeItem(it, i)).filter(Boolean);
      this.queue = normalized;

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await new Promise((resolve) => {
          chrome.storage.local.set({ [this.storageKey]: normalized }, resolve);
        });
      }

      // Database sync
      try {
        const dbObj = (typeof root.DB !== 'undefined') ? root.DB : (typeof root.ShopeeDB !== 'undefined' ? root.ShopeeDB : null);
        if (dbObj && typeof dbObj.clearQueue === 'function' && typeof dbObj.addQueueItems === 'function') {
          await dbObj.clearQueue();
          if (normalized.length > 0) {
            await dbObj.addQueueItems(normalized);
          }
        }
      } catch (_) {}

      // Notify background
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({ action: ACTIONS.QUEUE_UPDATED || 'QUEUE_UPDATED', queue: normalized }, () => {
            if (chrome.runtime?.lastError) {}
          });
        } catch (_) {}
      }

      this.notify('queue_updated', { queue: this.queue, stats: this.getStats() });
      return this.queue;
    }

    /**
     * Attach chrome.storage.onChanged listener for real-time multi-context sync
     */
    setupStorageListener() {
      if (this.isListening) return;
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes[this.storageKey]) {
          const raw = Array.isArray(changes[this.storageKey].newValue)
            ? changes[this.storageKey].newValue
            : [];
          this.queue = raw.map((item, i) => this.normalizeItem(item, i)).filter(Boolean);

          // Keep activeItemId valid
          if (this.activeItemId && !this.getItemById(this.activeItemId)) {
            const firstPending = this.getPendingItems()[0];
            this.activeItemId = firstPending ? firstPending.id : (this.queue[0] ? this.queue[0].id : null);
          }

          this.notify('storage_changed', { queue: this.queue, stats: this.getStats() });
        }
      });

      this.isListening = true;
    }

    /**
     * Get all queue items
     * @returns {Array}
     */
    getAllItems() {
      return [...this.queue];
    }

    /**
     * Get PENDING items
     * @returns {Array}
     */
    getPendingItems() {
      return this.queue.filter(it => (it.status || '').toUpperCase() === QUEUE_STATUS.PENDING);
    }

    /**
     * Get POSTED items
     * @returns {Array}
     */
    getPostedItems() {
      return this.queue.filter(it => (it.status || '').toUpperCase() === QUEUE_STATUS.POSTED);
    }

    /**
     * Get FAILED items
     * @returns {Array}
     */
    getFailedItems() {
      return this.queue.filter(it => (it.status || '').toUpperCase() === QUEUE_STATUS.FAILED);
    }

    /**
     * Get queue statistics summary
     * @returns {{total: number, pending: number, posting: number, posted: number, failed: number}}
     */
    getStats() {
      let pending = 0;
      let posting = 0;
      let posted = 0;
      let failed = 0;

      for (const it of this.queue) {
        const st = (it.status || '').toUpperCase();
        if (st === QUEUE_STATUS.PENDING) pending++;
        else if (st === QUEUE_STATUS.POSTING || st === 'PROCESSING') posting++;
        else if (st === QUEUE_STATUS.POSTED) posted++;
        else if (st === QUEUE_STATUS.FAILED) failed++;
      }

      return {
        total: this.queue.length,
        pending,
        posting,
        posted,
        failed
      };
    }

    /**
     * Find item by ID or productId
     * @param {string} id 
     * @returns {Object|null}
     */
    getItemById(id) {
      if (!id) return null;
      const targetId = String(id);
      return this.queue.find(it => String(it.id) === targetId || String(it.productId) === targetId) || null;
    }

    /**
     * Get active item currently previewed
     * @returns {Object|null}
     */
    getActiveItem() {
      if (this.activeItemId) {
        const found = this.getItemById(this.activeItemId);
        if (found) return found;
      }
      const pending = this.getPendingItems();
      if (pending.length > 0) return pending[0];
      return this.queue.length > 0 ? this.queue[0] : null;
    }

    /**
     * Set active item by ID
     * @param {string} id 
     */
    setActiveItem(id) {
      const item = this.getItemById(id);
      if (item) {
        this.activeItemId = item.id;
        this.notify('active_item_changed', { item, id: item.id });
        return item;
      }
      return null;
    }

    /**
     * Select next queue item sequentially
     */
    selectNextItem() {
      if (this.queue.length === 0) return null;
      const currentActive = this.getActiveItem();
      const currentId = this.activeItemId || (currentActive ? currentActive.id : null);
      const currentIndex = this.queue.findIndex(it => it.id === currentId);
      const nextIndex = (currentIndex >= 0 && currentIndex + 1 < this.queue.length) ? currentIndex + 1 : 0;
      const nextItem = this.queue[nextIndex];
      if (nextItem) {
        return this.setActiveItem(nextItem.id);
      }
      return null;
    }

    /**
     * Select previous queue item sequentially
     */
    selectPrevItem() {
      if (this.queue.length === 0) return null;
      const currentActive = this.getActiveItem();
      const currentId = this.activeItemId || (currentActive ? currentActive.id : null);
      const currentIndex = this.queue.findIndex(it => it.id === currentId);
      const prevIndex = (currentIndex > 0) ? currentIndex - 1 : this.queue.length - 1;
      const prevItem = this.queue[prevIndex];
      if (prevItem) {
        return this.setActiveItem(prevItem.id);
      }
      return null;
    }

    /**
     * Update item fields in queue
     * @param {string} id 
     * @param {Object} updates 
     */
    async updateItem(id, updates = {}) {
      const index = this.queue.findIndex(it => String(it.id) === String(id));
      if (index === -1) return null;

      const now = new Date().toISOString();
      this.queue[index] = {
        ...this.queue[index],
        ...updates,
        updatedAt: now
      };

      await this.saveQueue(this.queue);
      const updated = this.queue[index];
      this.notify('item_updated', { item: updated, id });
      return updated;
    }

    /**
     * Update item caption specifically
     * @param {string} id 
     * @param {string} newCaption 
     */
    async updateItemCaption(id, newCaption) {
      return this.updateItem(id, { caption: String(newCaption || '').trim() });
    }

    /**
     * Update item status (PENDING, POSTING, POSTED, FAILED)
     * @param {string} id 
     * @param {string} status 
     * @param {Object} [extra={}] 
     */
    async updateItemStatus(id, status, extra = {}) {
      return this.updateItem(id, {
        status: status.toUpperCase(),
        ...extra
      });
    }

    /**
     * Delete single item from queue
     * @param {string} id 
     */
    async deleteItem(id) {
      const targetId = String(id);
      const remaining = this.queue.filter(it => String(it.id) !== targetId);
      if (this.activeItemId === targetId) {
        const nextPending = remaining.find(it => it.status === QUEUE_STATUS.PENDING) || remaining[0];
        this.activeItemId = nextPending ? nextPending.id : null;
      }
      await this.saveQueue(remaining);
      this.notify('item_deleted', { id: targetId });
      return true;
    }

    /**
     * Clear all items or filtered items from queue
     * @param {string} [statusFilter='ALL'] 
     */
    async clearQueue(statusFilter = 'ALL') {
      let remaining = [];
      if (statusFilter !== 'ALL') {
        remaining = this.queue.filter(it => (it.status || '').toUpperCase() !== statusFilter.toUpperCase());
      }
      this.activeItemId = null;
      await this.saveQueue(remaining);
      this.notify('queue_cleared', { statusFilter });
      return true;
    }

    /**
     * Subscribe to queue events
     * @param {Function} callback (event, data) => void
     * @returns {Function} unsubscribe
     */
    subscribe(callback) {
      if (typeof callback === 'function') {
        this.subscribers.add(callback);
      }
      return () => this.subscribers.delete(callback);
    }

    /**
     * Dispatch event to all subscribers
     */
    notify(event, data = {}) {
      this.subscribers.forEach(cb => {
        try {
          cb(event, data);
        } catch (err) {
          console.warn('[PanelQueueManager] Subscriber error:', err);
        }
      });
    }
  }

  // ===========================================================================
  // 2. PANEL PRODUCT PREVIEW
  // ===========================================================================
  /**
   * Renders active product card: HD Image, Title, IDR Price, Affiliate Link,
   * Editable Spintax Caption, Char Counter, and Sequential Navigator (⬅️/➡️).
   */
  class PanelProductPreview {
    /**
     * @param {PanelQueueManager} queueManager 
     * @param {PanelDebugConsole} [debugConsole=null] 
     */
    constructor(queueManager, debugConsole = null) {
      this.manager = queueManager;
      this.debugConsole = debugConsole;
      this.currentImageIndex = 0;
      this.debounceTimer = null;
      this.dom = {};
    }

    /**
     * Cache DOM elements with flexible selectors matching poster-panel.html
     */
    cacheDOM() {
      if (typeof document === 'undefined') return;
      this.dom = {
        // Active Product Card & Status
        productCard: document.getElementById('active-product-card'),
        statusTag: document.getElementById('product-status-tag'),
        statusLabel: document.getElementById('product-status-label'),
        itemIdDisplay: document.getElementById('product-item-id'),

        // Product Details
        title: document.getElementById('product-title-display') || document.getElementById('preview-title'),
        price: document.getElementById('product-price-display') || document.getElementById('preview-price'),
        originalPrice: document.getElementById('product-original-price-display'),
        discount: document.getElementById('product-discount-display') || document.getElementById('preview-discount'),
        rating: document.getElementById('product-rating-val') || document.getElementById('preview-rating'),
        sales: document.getElementById('product-sales-val') || document.getElementById('preview-sold'),

        // Affiliate Link Group
        affiliateUrlInput: document.getElementById('product-affiliate-url') || document.getElementById('preview-shortlink'),
        btnCopyAffiliateLink: document.getElementById('btn-copy-affiliate-link') || document.getElementById('btn-copy-shortlink'),
        btnOpenShopeeLink: document.getElementById('btn-open-shopee-link'),

        // Image Preview
        mainImg: document.getElementById('product-image-preview') || document.getElementById('preview-image'),
        btnZoomImage: document.getElementById('btn-zoom-image'),

        // Caption Editor & Tools
        captionEditor: document.getElementById('product-caption-editor') || document.getElementById('preview-caption'),
        captionCharCount: document.getElementById('caption-char-count'),
        btnTestSpintax: document.getElementById('btn-test-spintax') || document.getElementById('btn-spin-caption'),
        btnInsertLink: document.getElementById('btn-insert-link'),
        btnInsertHashtags: document.getElementById('btn-insert-hashtags'),
        btnResetCaption: document.getElementById('btn-reset-caption'),
        btnSaveCaption: document.getElementById('btn-save-caption-change') || document.getElementById('btn-save-caption'),
        spintaxPreviewBox: document.getElementById('spintax-preview-box'),
        spintaxPreviewText: document.getElementById('spintax-preview-text'),

        // Queue Navigator
        queueSelect: document.getElementById('queue-select-dropdown'),
        queuePositionBadge: document.getElementById('queue-position-badge'),
        currentItemIndex: document.getElementById('current-item-index'),
        totalQueueItems: document.getElementById('total-queue-items'),
        btnPrevItem: document.getElementById('btn-prev-item'),
        btnNextItem: document.getElementById('btn-next-item'),
        btnRefreshQueue: document.getElementById('btn-refresh-queue'),

        // Metric Statistics Grid
        statPending: document.getElementById('stat-pending-count'),
        statSuccess: document.getElementById('stat-success-count'),
        statFailed: document.getElementById('stat-failed-count'),
        statQuotaText: document.getElementById('stat-quota-text'),
        statQuotaBar: document.getElementById('stat-quota-bar')
      };
    }

    /**
     * Bind all event listeners safely
     */
    bindEvents() {
      if (typeof document === 'undefined') return;

      // 1. Caption editor live input with character count & debounce auto-save
      if (this.dom.captionEditor) {
        this.dom.captionEditor.addEventListener('input', (e) => {
          const newCaption = e.target.value;
          this.updateCharCount(newCaption.length);

          clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            const activeItem = this.manager.getActiveItem();
            if (activeItem) {
              this.manager.updateItemCaption(activeItem.id, newCaption);
            }
          }, 400);
        });
      }

      // 2. Button: Save Caption Manually
      if (this.dom.btnSaveCaption) {
        this.dom.btnSaveCaption.addEventListener('click', () => {
          const activeItem = this.manager.getActiveItem();
          if (activeItem && this.dom.captionEditor) {
            const captionVal = this.dom.captionEditor.value;
            this.manager.updateItemCaption(activeItem.id, captionVal);
            if (this.debugConsole) {
              this.debugConsole.info(`💾 Draft caption tersimpan untuk item: "${PanelUtils.truncate(activeItem.title, 30)}"`);
            }
          }
        });
      }

      // 3. Button: Test / Randomize Spintax
      if (this.dom.btnTestSpintax) {
        this.dom.btnTestSpintax.addEventListener('click', () => this.spinCaption());
      }

      // 4. Button: Insert Affiliate Shortlink
      if (this.dom.btnInsertLink) {
        this.dom.btnInsertLink.addEventListener('click', () => this.insertAffiliateLink());
      }

      // 5. Button: Insert Viral Hashtags
      if (this.dom.btnInsertHashtags) {
        this.dom.btnInsertHashtags.addEventListener('click', () => this.insertHashtags());
      }

      // 6. Button: Reset Caption to Default Template
      if (this.dom.btnResetCaption) {
        this.dom.btnResetCaption.addEventListener('click', () => this.resetCaption());
      }

      // 7. Button: Copy Affiliate Shortlink
      if (this.dom.btnCopyAffiliateLink) {
        this.dom.btnCopyAffiliateLink.addEventListener('click', async () => {
          const activeItem = this.manager.getActiveItem();
          const link = (activeItem && activeItem.shortLink) || (this.dom.affiliateUrlInput ? this.dom.affiliateUrlInput.value : '');
          if (link) {
            const ok = await PanelUtils.copyToClipboard(link);
            if (ok && this.debugConsole) {
              this.debugConsole.info(`📋 Link Shopee disalin: ${link}`);
            }
          }
        });
      }

      // 8. Button: Zoom HD Image
      if (this.dom.btnZoomImage) {
        this.dom.btnZoomImage.addEventListener('click', () => {
          const imgPreview = this.dom.mainImg;
          const zoomModal = document.getElementById('modal-image-zoom');
          const zoomImg = document.getElementById('zoom-modal-img');
          if (zoomModal && zoomImg && imgPreview) {
            zoomImg.src = imgPreview.src;
            zoomModal.classList.add('active');
            zoomModal.removeAttribute('aria-hidden');
          }
        });
      }

      // 9. Queue Sequential Navigator: Prev / Next
      if (this.dom.btnPrevItem) {
        this.dom.btnPrevItem.addEventListener('click', () => {
          const item = this.manager.selectPrevItem();
          if (item && this.debugConsole) {
            this.debugConsole.debug(`⬅️ Beralih ke item sebelumnya: "${PanelUtils.truncate(item.title, 25)}"`);
          }
        });
      }

      if (this.dom.btnNextItem) {
        this.dom.btnNextItem.addEventListener('click', () => {
          const item = this.manager.selectNextItem();
          if (item && this.debugConsole) {
            this.debugConsole.debug(`➡️ Beralih ke item berikutnya: "${PanelUtils.truncate(item.title, 25)}"`);
          }
        });
      }

      // 10. Dropdown Selection
      if (this.dom.queueSelect) {
        this.dom.queueSelect.addEventListener('change', (e) => {
          if (e.target.value) {
            this.manager.setActiveItem(e.target.value);
          }
        });
      }

      // 11. Refresh Queue
      if (this.dom.btnRefreshQueue) {
        this.dom.btnRefreshQueue.addEventListener('click', async () => {
          await this.manager.loadQueue();
          if (this.debugConsole) {
            this.debugConsole.info('🔄 Antrean produk dimuat ulang dari storage.');
          }
        });
      }
    }

    /**
     * Render active item data to preview card & form fields
     * @param {Object|null} [itemParam] 
     */
    render(itemParam) {
      if (typeof document === 'undefined') return;
      const item = itemParam !== undefined ? itemParam : this.manager.getActiveItem();

      // Render Statistics Metrics Bar
      this.renderStats();

      // Handle Empty State
      if (!item) {
        if (this.dom.title) this.dom.title.textContent = 'Belum ada produk di antrean Shopee';
        if (this.dom.price) this.dom.price.textContent = '-';
        if (this.dom.originalPrice) this.dom.originalPrice.textContent = '';
        if (this.dom.discount) this.dom.discount.textContent = '';
        if (this.dom.affiliateUrlInput) this.dom.affiliateUrlInput.value = '';
        if (this.dom.captionEditor) this.dom.captionEditor.value = '';
        if (this.dom.mainImg) this.dom.mainImg.src = 'https://via.placeholder.com/600x600?text=Antrean+Shopee+Kosong';
        if (this.dom.statusLabel) this.dom.statusLabel.textContent = 'STATUS: ANTREAN KOSONG';
        if (this.dom.itemIdDisplay) this.dom.itemIdDisplay.textContent = 'NONE';
        this.updateCharCount(0);
        this.updateQueueDropdown();
        return;
      }

      // 1. Product Metadata
      if (this.dom.title) {
        this.dom.title.textContent = item.title || 'Produk Rekomendasi Shopee';
        this.dom.title.title = item.title || '';
      }

      if (this.dom.price) {
        this.dom.price.textContent = String(item.price || '').replace(/^Rp\s*/i, '') || '-';
      }

      if (this.dom.originalPrice) {
        if (item.originalPrice) {
          this.dom.originalPrice.textContent = PanelUtils.formatPrice(item.originalPrice);
          this.dom.originalPrice.style.display = 'inline-block';
        } else {
          this.dom.originalPrice.style.display = 'none';
        }
      }

      if (this.dom.discount) {
        if (item.discount) {
          const discText = String(item.discount).includes('%') ? item.discount : `-${item.discount}%`;
          this.dom.discount.textContent = discText;
          this.dom.discount.style.display = 'inline-block';
        } else {
          this.dom.discount.style.display = 'none';
        }
      }

      if (this.dom.rating) {
        this.dom.rating.textContent = String(item.rating || '4.9').replace(/[^0-9.]/g, '') || '4.9';
      }

      if (this.dom.sales) {
        this.dom.sales.textContent = item.sold ? `${item.sold}` : '100+';
      }

      if (this.dom.itemIdDisplay) {
        this.dom.itemIdDisplay.textContent = item.productId || item.id || 'SHP-AUTO';
      }

      // 2. Affiliate Shortlink
      const cleanLink = item.shortLink || item.short_link || '';
      if (this.dom.affiliateUrlInput) {
        this.dom.affiliateUrlInput.value = cleanLink;
      }
      if (this.dom.btnOpenShopeeLink) {
        this.dom.btnOpenShopeeLink.href = cleanLink || '#';
      }

      // 3. Status Tag Badge
      if (this.dom.statusLabel && this.dom.statusTag) {
        const st = (item.status || QUEUE_STATUS.PENDING).toUpperCase();
        this.dom.statusLabel.textContent = `STATUS: ${st === 'POSTED' ? 'SUKSES DIPOSTING' : (st === 'POSTING' ? 'SEDANG MEMPOSTING...' : (st === 'FAILED' ? 'GAGAL DIPOSTING' : 'READY TO POST'))}`;
        this.dom.statusTag.className = `product-status-tag status-${st.toLowerCase()}`;
      }

      // 4. Editable Caption
      if (this.dom.captionEditor && document.activeElement !== this.dom.captionEditor) {
        const defaultCaption = item.caption || this.generateDefaultCaption(item);
        this.dom.captionEditor.value = defaultCaption;
        this.updateCharCount(defaultCaption.length);
      }

      // 5. Image Preview
      const imgUrl = (Array.isArray(item.imageUrls) && item.imageUrls.length > 0)
        ? item.imageUrls[0]
        : (item.primaryImage || 'https://via.placeholder.com/600x600?text=Foto+Produk+Shopee');

      if (this.dom.mainImg) {
        this.dom.mainImg.src = imgUrl;
        this.dom.mainImg.onerror = () => {
          this.dom.mainImg.src = 'https://via.placeholder.com/600x600?text=Gambar+Gagal+Dimuat';
        };
      }

      // 6. Sync Dropdown & Queue Position Counter
      this.updateQueueDropdown();
    }

    /**
     * Render stats metrics cards
     */
    renderStats() {
      const stats = this.manager.getStats();
      if (this.dom.statPending) this.dom.statPending.textContent = stats.pending;
      if (this.dom.statSuccess) this.dom.statSuccess.textContent = stats.posted;
      if (this.dom.statFailed) this.dom.statFailed.textContent = stats.failed;

      if (this.dom.statQuotaText) {
        this.dom.statQuotaText.textContent = `${stats.posted} / 25`;
      }
      if (this.dom.statQuotaBar) {
        const pct = Math.min(100, Math.round((stats.posted / 25) * 100));
        this.dom.statQuotaBar.style.width = `${pct}%`;
      }
    }

    /**
     * Update character counter label
     * @param {number} count 
     */
    updateCharCount(count = 0) {
      if (this.dom.captionCharCount) {
        this.dom.captionCharCount.textContent = count;
      }
    }

    /**
     * Generate default Spintax caption template for a product
     * @param {Object} item 
     * @returns {string}
     */
    generateDefaultCaption(item = {}) {
      const title = item.title || 'Produk Rekomendasi Shopee';
      const link = item.shortLink || '';
      return `{Rekomendasi|Spill|Racun} ${title} yang super recommended & aesthetic banget! ✨\n\n💸 Harga: ${PanelUtils.formatPrice(item.price)} ${item.discount ? `(Diskon ${item.discount})` : ''}\n⭐ Rating: ${item.rating || '4.9'} | ${item.sold || 'Terjual ribuan'}\n\n👇 Cek produk & diskon spesial disini:\n${link}\n\n#RacunShopee #ShopeeHaul #ShopeeAffiliateID #RekomendasiRacun`;
    }

    /**
     * Test / randomize Spintax caption and update preview box
     */
    spinCaption() {
      const item = this.manager.getActiveItem();
      if (!item) return;

      const currentCaption = (this.dom.captionEditor && this.dom.captionEditor.value.trim())
        ? this.dom.captionEditor.value
        : this.generateDefaultCaption(item);

      const spun = PanelUtils.parseSpintaxFallback(currentCaption);
      const finalSpun = PanelUtils.fillTemplateVariables(spun, item);

      if (this.dom.spintaxPreviewText) {
        this.dom.spintaxPreviewText.textContent = `"${PanelUtils.truncate(finalSpun, 140)}"`;
      }
      if (this.dom.spintaxPreviewBox) {
        this.dom.spintaxPreviewBox.classList.add('highlight-pulse');
        setTimeout(() => this.dom.spintaxPreviewBox?.classList.remove('highlight-pulse'), 1000);
      }

      if (this.debugConsole) {
        this.debugConsole.debug(`🎲 Spintax variation generated: "${PanelUtils.truncate(finalSpun, 40)}"`);
      }
    }

    /**
     * Append affiliate shortlink to caption editor
     */
    insertAffiliateLink() {
      const item = this.manager.getActiveItem();
      if (!item || !this.dom.captionEditor) return;
      const link = item.shortLink || '';
      if (!link) return;

      if (!this.dom.captionEditor.value.includes(link)) {
        this.dom.captionEditor.value = `${this.dom.captionEditor.value.trim()}\n\n🔗 Link Produk: ${link}`;
        this.updateCharCount(this.dom.captionEditor.value.length);
        this.manager.updateItemCaption(item.id, this.dom.captionEditor.value);
      }
    }

    /**
     * Append viral hashtags to caption editor
     */
    insertHashtags() {
      const item = this.manager.getActiveItem();
      if (!item || !this.dom.captionEditor) return;
      const hashtags = '#RacunShopee #ShopeeHaul #ShopeeAffiliateID #SpillBarangViral';

      if (!this.dom.captionEditor.value.includes('#RacunShopee')) {
        this.dom.captionEditor.value = `${this.dom.captionEditor.value.trim()}\n\n${hashtags}`;
        this.updateCharCount(this.dom.captionEditor.value.length);
        this.manager.updateItemCaption(item.id, this.dom.captionEditor.value);
      }
    }

    /**
     * Reset caption editor to default Spintax template
     */
    resetCaption() {
      const item = this.manager.getActiveItem();
      if (!item || !this.dom.captionEditor) return;
      const def = this.generateDefaultCaption(item);
      this.dom.captionEditor.value = def;
      this.updateCharCount(def.length);
      this.manager.updateItemCaption(item.id, def);
      if (this.debugConsole) {
        this.debugConsole.info('↺ Caption dikembalikan ke template Spintax default.');
      }
    }

    /**
     * Step through multiple images if product has carousel
     * @param {number} delta 
     */
    stepImage(delta) {
      const item = this.manager.getActiveItem();
      if (!item) return;
      const images = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
        ? item.imageUrls
        : (item.primaryImage ? [item.primaryImage] : []);

      if (images.length <= 1) return;
      this.currentImageIndex = (this.currentImageIndex + delta + images.length) % images.length;
      if (this.dom.mainImg) {
        this.dom.mainImg.src = images[this.currentImageIndex];
      }
    }

    /**
     * Synchronize dropdown selector and badge counter with current queue state
     */
    updateQueueDropdown() {
      const allItems = this.manager.getAllItems();
      const activeItem = this.manager.getActiveItem();

      // Position badge
      if (this.dom.currentItemIndex && this.dom.totalQueueItems) {
        if (!activeItem || allItems.length === 0) {
          this.dom.currentItemIndex.textContent = '0';
          this.dom.totalQueueItems.textContent = '0';
        } else {
          const currIdx = allItems.findIndex(it => it.id === activeItem.id);
          this.dom.currentItemIndex.textContent = String(currIdx + 1);
          this.dom.totalQueueItems.textContent = String(allItems.length);
        }
      }

      // Dropdown options
      if (this.dom.queueSelect) {
        this.dom.queueSelect.innerHTML = '';
        if (allItems.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '(Antrean Kosong)';
          this.dom.queueSelect.appendChild(opt);
          return;
        }

        allItems.forEach((it, idx) => {
          const opt = document.createElement('option');
          opt.value = it.id;
          const statusIcon = it.status === QUEUE_STATUS.POSTED ? '✅' : (it.status === QUEUE_STATUS.FAILED ? '❌' : (it.status === QUEUE_STATUS.POSTING ? '⏳' : '⏳'));
          opt.textContent = `[${idx + 1}/${allItems.length}] ${statusIcon} ${PanelUtils.truncate(it.title, 45)}`;
          if (activeItem && it.id === activeItem.id) {
            opt.selected = true;
          }
          this.dom.queueSelect.appendChild(opt);
        });
      }
    }
  }

  // ===========================================================================
  // 3. PANEL THREADS TAB BRIDGE
  // ===========================================================================
  /**
   * Bridges communication with Meta Threads tab (threads.net):
   * Probes active tabs, focuses / creates Threads tabs, and injects posting payloads.
   */
  class PanelThreadsTabBridge {
    /**
     * @param {PanelDebugConsole} [debugConsole=null] 
     */
    constructor(debugConsole = null) {
      this.debugConsole = debugConsole;
      this.threadsTabId = null;
      this.isConnected = false;
      this.dom = {};
    }

    cacheDOM() {
      if (typeof document === 'undefined') return;
      this.dom = {
        statusPill: document.getElementById('threads-status-pill'),
        statusDot: document.getElementById('threads-status-dot'),
        statusText: document.getElementById('threads-status-text'),
        statusSub: document.getElementById('threads-status-sub'),
        btnFocusThreads: document.getElementById('btn-focus-threads') || document.getElementById('btn-open-threads')
      };
    }

    bindEvents() {
      if (typeof document === 'undefined') return;
      if (this.dom.btnFocusThreads) {
        this.dom.btnFocusThreads.addEventListener('click', () => this.focusOrOpenThreads(true));
      }
    }

    /**
     * Find existing Threads tab in browser
     * @returns {Promise<chrome.tabs.Tab|null>}
     */
    async findThreadsTab() {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
        return null;
      }
      try {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({ url: '*://*.threads.net/*' }, (res) => {
            if (chrome.runtime?.lastError) resolve([]);
            else resolve(res || []);
          });
        });
        if (Array.isArray(tabs) && tabs.length > 0) {
          const active = tabs.find(t => t.active) || tabs[0];
          this.threadsTabId = active.id;
          return active;
        }
      } catch (_) {}
      return null;
    }

    /**
     * Focus or open Threads tab
     * @param {boolean} [bringToFront=true] 
     * @returns {Promise<{tab: Object, tabId: number, created: boolean}>}
     */
    async focusOrOpenThreads(bringToFront = true) {
      if (typeof chrome === 'undefined' || !chrome.tabs) {
        if (typeof window !== 'undefined') window.open('https://www.threads.net', '_blank');
        return { tab: null, tabId: null, created: true };
      }

      const existingTab = await this.findThreadsTab();
      if (existingTab && existingTab.id) {
        if (bringToFront) {
          await new Promise((resolve) => {
            chrome.tabs.update(existingTab.id, { active: true }, resolve);
          });
          if (existingTab.windowId && chrome.windows) {
            try {
              await new Promise((resolve) => {
                chrome.windows.update(existingTab.windowId, { focused: true }, resolve);
              });
            } catch (_) {}
          }
        }
        this.threadsTabId = existingTab.id;
        this.updateStatus(true, `Tab ID: #${existingTab.id} (threads.net)`);
        return { tab: existingTab, tabId: existingTab.id, created: false };
      }

      // Create new tab if none open
      const newTab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: 'https://www.threads.net', active: bringToFront }, (tab) => {
          if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(tab);
        });
      });

      if (bringToFront && newTab && newTab.windowId && chrome.windows) {
        try {
          await new Promise((resolve) => chrome.windows.update(newTab.windowId, { focused: true }, resolve));
        } catch (_) {}
      }

      this.threadsTabId = newTab ? newTab.id : null;
      this.updateStatus(true, 'Tab Baru Dibuka (Memuat...)');

      // Allow page to load content script
      await new Promise(r => setTimeout(r, 3000));
      return { tab: newTab, tabId: newTab?.id, created: true };
    }

    /**
     * Check connection state with Threads tab
     */
    async checkConnection() {
      const tab = await this.findThreadsTab();
      const connected = !!tab;
      this.isConnected = connected;
      if (connected) {
        this.updateStatus(true, `Tab ID: #${tab.id} (threads.net)`);
      } else {
        this.updateStatus(false, 'Belum terhubung ke Threads Web');
      }
      return connected;
    }

    /**
     * Update connection status pill in UI
     * @param {boolean} isConnected 
     * @param {string} subtext 
     */
    updateStatus(isConnected, subtext = '') {
      this.isConnected = isConnected;
      if (this.dom.statusDot) {
        this.dom.statusDot.className = `pulsing-status-dot ${isConnected ? 'connected' : 'disconnected'}`;
      }
      if (this.dom.statusText) {
        this.dom.statusText.textContent = isConnected ? '🟢 Threads Web Terhubung' : '🔴 Threads Web Belum Terbuka';
      }
      if (this.dom.statusSub) {
        this.dom.statusSub.textContent = subtext || (isConnected ? 'Siap melakukan posting' : 'Klik "Buka / Fokus Threads"');
      }
    }

    /**
     * Send post payload to Threads content script
     * @param {Object} item 
     * @returns {Promise<{success: boolean, postUrl?: string, error?: string}>}
     */
    async injectPost(item) {
      const { tabId } = await this.focusOrOpenThreads(true);
      if (!tabId) {
        throw new Error('Gagal mendeteksi atau membuka tab Threads');
      }

      return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, {
          action: ACTIONS.INJECT_POST_PAYLOAD || 'INJECT_POST_PAYLOAD',
          item: item
        }, (response) => {
          if (chrome.runtime?.lastError) {
            const err = chrome.runtime.lastError.message;
            resolve({ success: false, error: err });
          } else {
            resolve(response || { success: true });
          }
        });
      });
    }
  }

  // ===========================================================================
  // 4. PANEL POSTING CONTROLLER (FOCUSED ON SINGLE-ITEM POST)
  // ===========================================================================
  /**
   * Controller prioritizing Single-Item Post (1 per 1):
   * - Primary button: "🚀 Post Item Ini Sekarang"
   * - Step-by-step progress logging in the terminal
   * - Synchronizes status to chrome.storage.local (PENDING -> POSTING -> POSTED / FAILED)
   * - Secondary auto-posting scheduler kept clean & unobtrusive
   */
  class PanelPostingController {
    /**
     * @param {PanelQueueManager} queueManager 
     * @param {PanelThreadsTabBridge} bridge 
     * @param {PanelDebugConsole} [debugConsole=null] 
     */
    constructor(queueManager, bridge, debugConsole = null) {
      this.manager = queueManager;
      this.bridge = bridge;
      this.debugConsole = debugConsole;
      this.isPosting = false;
      this.isAutoPosting = false;
      this.countdownSeconds = 0;
      this.countdownInterval = null;
      this.dom = {};
    }

    cacheDOM() {
      if (typeof document === 'undefined') return;
      this.dom = {
        btnPostNow: document.getElementById('btn-post-now'),
        btnToggleAuto: document.getElementById('btn-toggle-autopost'),
        btnSkipItem: document.getElementById('btn-skip-item'),
        btnStopAuto: document.getElementById('btn-stop-autopost'),
        autopostStatus: document.getElementById('autopost-mode-status'),
        autopostStepDesc: document.getElementById('autopost-step-desc'),
        countdownTimerDisplay: document.getElementById('countdown-timer-display'),
        autopostProgressBar: document.getElementById('autopost-progress-bar'),
        progressPercentageText: document.getElementById('progress-percentage-text'),
        progressItemsText: document.getElementById('progress-items-text')
      };
    }

    bindEvents() {
      if (typeof document === 'undefined') return;

      // 1. Primary Action: Post Active Item Now (Single Post 1-per-1)
      if (this.dom.btnPostNow) {
        this.dom.btnPostNow.addEventListener('click', () => {
          const item = this.manager.getActiveItem();
          if (item) this.executePostSingle(item);
        });
      }

      // 2. Skip Current Item
      if (this.dom.btnSkipItem) {
        this.dom.btnSkipItem.addEventListener('click', () => {
          const next = this.manager.selectNextItem();
          if (this.debugConsole && next) {
            this.debugConsole.info(`⏭️ Item dilewati. Sekarang memilih: "${PanelUtils.truncate(next.title, 30)}"`);
          }
        });
      }

      // 3. Toggle Batch Auto-Post (Secondary Mode)
      if (this.dom.btnToggleAuto) {
        this.dom.btnToggleAuto.addEventListener('click', () => {
          if (this.isAutoPosting) {
            this.stopAutoPost();
          } else {
            this.startAutoPost();
          }
        });
      }

      if (this.dom.btnStopAuto) {
        this.dom.btnStopAuto.addEventListener('click', () => this.stopAutoPost());
      }
    }

    /**
     * Execute immediate posting for a single product item with step-by-step terminal logs
     * @param {Object} item 
     * @returns {Promise<{success: boolean, postUrl?: string, error?: string}>}
     */
    async executePostSingle(item) {
      if (!item) {
        if (this.debugConsole) this.debugConsole.warn('Pilih produk Shopee dari antrean terlebih dahulu.');
        return { success: false, error: 'Item tidak ditemukan' };
      }

      if (this.isPosting) {
        if (this.debugConsole) this.debugConsole.warn('Sedang ada posting yang berjalan. Mohon tunggu...');
        return { success: false, error: 'Posting in progress' };
      }

      this.isPosting = true;
      this.updateButtonStates();

      const itemId = item.id;
      const titleShort = PanelUtils.truncate(item.title, 32);

      // -----------------------------------------------------------------------
      // STEP 1: Update status to POSTING & log step 1
      // -----------------------------------------------------------------------
      await this.manager.updateItemStatus(itemId, QUEUE_STATUS.POSTING);
      
      if (this.debugConsole) {
        this.debugConsole.info('POST-FLOW', `⏳ Membuka form Utas Baru Threads...`);
      }

      try {
        // Ensure Threads tab is focused/ready
        await this.bridge.focusOrOpenThreads(true);

        // ---------------------------------------------------------------------
        // STEP 2: Log typing caption & preparing media
        // ---------------------------------------------------------------------
        if (this.debugConsole) {
          const imgCount = Array.isArray(item.imageUrls) ? item.imageUrls.length : (item.primaryImage ? 1 : 0);
          this.debugConsole.dom('POST-FLOW', `✍️ Mengetik caption produk... (${imgCount} foto dilampirkan)`);
        }

        // Brief delay for visual natural feeling
        await new Promise(r => setTimeout(r, 500));

        // ---------------------------------------------------------------------
        // STEP 3: Log clicking submit button via XPath/DOM
        // ---------------------------------------------------------------------
        if (this.debugConsole) {
          this.debugConsole.dom('POST-FLOW', `🔘 Mengklik tombol Kirim via XPath...`);
        }

        // Inject post payload to Threads Content Script
        const result = await this.bridge.injectPost(item);

        // ---------------------------------------------------------------------
        // STEP 4: Handle Success or Failure
        // ---------------------------------------------------------------------
        if (result && result.success) {
          const postUrl = result.postUrl || 'https://www.threads.net';
          const nowIso = new Date().toISOString();

          // Update storage status to POSTED
          await this.manager.updateItemStatus(itemId, QUEUE_STATUS.POSTED, {
            postedAt: nowIso,
            threadsUrl: postUrl,
            error: null
          });

          if (this.debugConsole) {
            this.debugConsole.success('POST-FLOW', `🎉 SUKSES DIPOSTING! 🔗 Link: ${postUrl}`);
          }

          // Notify background service worker
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: ACTIONS.NOTIFY_POST_SUCCESS || 'NOTIFY_POST_SUCCESS',
              item: { ...item, status: QUEUE_STATUS.POSTED, threadsUrl: postUrl, postedAt: nowIso }
            }, () => {
              if (chrome.runtime?.lastError) {}
            });
          }

          this.isPosting = false;
          this.updateButtonStates();

          return { success: true, postUrl };
        } else {
          throw new Error(result?.error || 'Gagal memposting ke Threads');
        }
      } catch (err) {
        const errorMsg = err.message || 'Terjadi kesalahan saat memposting';

        await this.manager.updateItemStatus(itemId, QUEUE_STATUS.FAILED, {
          error: errorMsg
        });

        if (this.debugConsole) {
          this.debugConsole.error('POST-FLOW', `❌ GAGAL DIPOSTING: ${errorMsg}`);
        }

        // Notify background service worker
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: ACTIONS.NOTIFY_POST_FAILED || 'NOTIFY_POST_FAILED',
            item,
            error: errorMsg
          }, () => {
            if (chrome.runtime?.lastError) {}
          });
        }

        this.isPosting = false;
        this.updateButtonStates();
        return { success: false, error: errorMsg };
      }
    }

    /**
     * Start secondary auto-post batch
     */
    async startAutoPost() {
      const pending = this.manager.getPendingItems();
      if (pending.length === 0) {
        if (this.debugConsole) {
          this.debugConsole.warn('Antrean pending kosong. Tambahkan produk Shopee terlebih dahulu.');
        }
        return;
      }

      this.isAutoPosting = true;
      this.updateButtonStates();

      if (this.debugConsole) {
        this.debugConsole.info(`[AUTO-POST] Memulai auto-posting berurutan (${pending.length} item tersisa)...`);
      }

      // Execute first pending item immediately
      await this.executePostSingle(pending[0]);

      // Schedule next item countdown if auto-posting still active
      if (this.isAutoPosting) {
        this.scheduleNextCountdown();
      }
    }

    /**
     * Schedule countdown for next batch post
     */
    scheduleNextCountdown() {
      if (!this.isAutoPosting) return;
      const pending = this.manager.getPendingItems();
      if (pending.length === 0) {
        if (this.debugConsole) {
          this.debugConsole.success('🎉 Seluruh antrean produk telah selesai diposting!');
        }
        this.stopAutoPost();
        return;
      }

      this.countdownSeconds = 45; // 45 seconds safe interval
      this.clearCountdown();

      this.countdownInterval = setInterval(() => {
        if (!this.isAutoPosting) {
          this.clearCountdown();
          return;
        }

        this.countdownSeconds--;
        this.updateCountdownUI();

        if (this.countdownSeconds <= 0) {
          this.clearCountdown();
          const nextItems = this.manager.getPendingItems();
          if (nextItems.length > 0) {
            this.executePostSingle(nextItems[0]).then(() => {
              if (this.isAutoPosting) {
                this.scheduleNextCountdown();
              }
            });
          } else {
            this.stopAutoPost();
          }
        }
      }, 1000);

      this.updateCountdownUI();
    }

    /**
     * Stop auto-post batch
     */
    stopAutoPost() {
      this.isAutoPosting = false;
      this.clearCountdown();
      this.countdownSeconds = 0;
      this.updateButtonStates();
      if (this.debugConsole) {
        this.debugConsole.info('[AUTO-POST] Mode Auto-Posting dihentikan.');
      }
      this.updateCountdownUI();
    }

    clearCountdown() {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    }

    /**
     * Update countdown UI
     */
    updateCountdownUI() {
      if (this.dom.countdownTimerDisplay) {
        if (!this.isAutoPosting) {
          this.dom.countdownTimerDisplay.textContent = '00:00';
        } else {
          const m = String(Math.floor(this.countdownSeconds / 60)).padStart(2, '0');
          const s = String(this.countdownSeconds % 60).padStart(2, '0');
          this.dom.countdownTimerDisplay.textContent = `${m}:${s}`;
        }
      }
    }

    /**
     * Update button states & visual indicators
     */
    updateButtonStates() {
      if (this.dom.btnPostNow) {
        this.dom.btnPostNow.disabled = this.isPosting;
        const titleEl = this.dom.btnPostNow.querySelector('.btn-hero-title');
        const subEl = this.dom.btnPostNow.querySelector('.btn-hero-subtitle');
        if (titleEl) {
          titleEl.textContent = this.isPosting ? '⏳ Sedang Memposting...' : 'Post Item Ini Sekarang';
        }
        if (subEl) {
          subEl.textContent = this.isPosting ? 'Mengirim data ke tab Threads Web...' : 'Eksekusi posting instan ke tab Threads aktif';
        }
      }

      if (this.dom.btnToggleAuto) {
        const label = this.dom.btnToggleAuto.querySelector('#autopost-btn-label') || this.dom.btnToggleAuto;
        const icon = this.dom.btnToggleAuto.querySelector('#autopost-btn-icon');
        if (this.isAutoPosting) {
          if (label) label.textContent = 'Jeda Auto-Post';
          if (icon) icon.textContent = '⏸';
          this.dom.btnToggleAuto.className = 'btn-autopost-start running';
        } else {
          if (label) label.textContent = 'Mulai Auto-Post Antrean';
          if (icon) icon.textContent = '▶';
          this.dom.btnToggleAuto.className = 'btn-autopost-start';
        }
      }

      if (this.dom.btnStopAuto) {
        this.dom.btnStopAuto.classList.toggle('hidden', !this.isAutoPosting);
      }

      if (this.dom.autopostStatus) {
        if (this.isPosting) {
          this.dom.autopostStatus.textContent = 'POSTING...';
          this.dom.autopostStatus.className = 'status-label-pill posting';
        } else if (this.isAutoPosting) {
          this.dom.autopostStatus.textContent = 'AUTO-POST AKTIF';
          this.dom.autopostStatus.className = 'status-label-pill active';
        } else {
          this.dom.autopostStatus.textContent = 'IDLE (SIAP)';
          this.dom.autopostStatus.className = 'status-label-pill idle';
        }
      }
    }
  }

  // ===========================================================================
  // 5. PANEL DEBUG CONSOLE & TERMINAL
  // ===========================================================================
  /**
   * Live Debug Console Terminal:
   * - Displays clear, step-by-step formatted logs in #terminal-screen
   * - Filters: ALL, DEBUG, DOM, INFO, SUCCESS, ERROR
   * - Search, Auto-Scroll lock, Clipboard Copy, TXT Export
   */
  class PanelDebugConsole {
    constructor() {
      this.logs = [];
      this.maxLogs = 1000;
      this.activeFilter = 'ALL';
      this.searchQuery = '';
      this.isAutoScroll = true;
      this.domElements = {
        filterButtons: [],
        counts: {}
      };
      this.isListening = false;
    }

    cacheDOM() {
      if (typeof document === 'undefined') return;
      this.domElements = {
        container: document.getElementById('terminal-screen') || document.getElementById('log-container'),
        searchInput: document.getElementById('terminal-search-input') || document.getElementById('log-search-input'),
        btnClearSearch: document.getElementById('btn-clear-search'),
        filterButtons: document.querySelectorAll('.filter-pill, [data-filter], [data-log-filter]'),
        btnAutoScroll: document.getElementById('toggle-autoscroll') || document.getElementById('btn-toggle-autoscroll'),
        btnCopy: document.getElementById('btn-copy-logs'),
        btnDownload: document.getElementById('btn-download-logs') || document.getElementById('btn-export-logs'),
        btnClear: document.getElementById('btn-clear-logs'),
        counts: {
          all: document.getElementById('count-all') || document.getElementById('count-log-all'),
          debug: document.getElementById('count-debug') || document.getElementById('count-log-debug'),
          dom: document.getElementById('count-dom') || document.getElementById('count-log-dom'),
          info: document.getElementById('count-info'),
          success: document.getElementById('count-success') || document.getElementById('count-log-success'),
          error: document.getElementById('count-error') || document.getElementById('count-log-error')
        },
        footTotal: document.getElementById('foot-total-logs')
      };
    }

    bindEvents() {
      if (typeof document === 'undefined') return;

      // 1. Search filter input
      if (this.domElements.searchInput) {
        this.domElements.searchInput.addEventListener('input', (e) => {
          this.searchQuery = (e.target.value || '').toLowerCase().trim();
          if (this.domElements.btnClearSearch) {
            this.domElements.btnClearSearch.classList.toggle('hidden', !this.searchQuery);
          }
          this.render();
        });
      }

      if (this.domElements.btnClearSearch) {
        this.domElements.btnClearSearch.addEventListener('click', () => {
          if (this.domElements.searchInput) this.domElements.searchInput.value = '';
          this.searchQuery = '';
          this.domElements.btnClearSearch.classList.add('hidden');
          this.render();
        });
      }

      // 2. Filter buttons
      if (this.domElements.filterButtons) {
        this.domElements.filterButtons.forEach(btn => {
          btn.addEventListener('click', () => {
            const filter = btn.getAttribute('data-filter') || btn.getAttribute('data-log-filter') || 'ALL';
            this.setFilter(filter);
          });
        });
      }

      // 3. Toggle Auto-Scroll
      if (this.domElements.btnAutoScroll) {
        this.domElements.btnAutoScroll.addEventListener('change', (e) => {
          this.isAutoScroll = e.target.checked;
          if (this.isAutoScroll) this.scrollToBottom();
        });
      }

      // 4. Copy logs to clipboard
      if (this.domElements.btnCopy) {
        this.domElements.btnCopy.addEventListener('click', () => this.copyToClipboard());
      }

      // 5. Download logs
      if (this.domElements.btnDownload) {
        this.domElements.btnDownload.addEventListener('click', () => this.exportToTXT());
      }

      // 6. Clear logs
      if (this.domElements.btnClear) {
        this.domElements.btnClear.addEventListener('click', () => this.clearLogs());
      }

      // 7. Auto-scroll lock detection
      if (this.domElements.container) {
        this.domElements.container.addEventListener('scroll', () => {
          const { scrollTop, scrollHeight, clientHeight } = this.domElements.container;
          const isAtBottom = (scrollHeight - scrollTop - clientHeight) < 40;
          this.isAutoScroll = isAtBottom;
          if (this.domElements.btnAutoScroll && this.domElements.btnAutoScroll.type === 'checkbox') {
            this.domElements.btnAutoScroll.checked = isAtBottom;
          }
        });
      }

      this.initRuntimeMessageListener();
    }

    /**
     * Listen for runtime log messages
     */
    initRuntimeMessageListener() {
      if (this.isListening) return;
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

      chrome.runtime.onMessage.addListener((message) => {
        if (!message) return;
        if (
          message.action === ACTIONS.DEBUG_LOG_STREAM ||
          message.action === 'DEBUG_LOG_STREAM' ||
          message.action === 'DEBUG_LOG' ||
          message.action === 'POST_LOG'
        ) {
          const entry = message.logEntry || message;
          const level = (entry.level || 'DEBUG').toUpperCase();
          const tag = entry.tag || entry.scope || '';
          const text = entry.message || entry.text || '';
          const details = entry.details || entry.data || null;
          this.addLogEntry(level, tag, text, details, entry.timestamp);
        }
      });

      this.isListening = true;
    }

    /**
     * Add single log entry to memory & DOM
     * @param {'DEBUG'|'DOM'|'SUCCESS'|'ERROR'|'INFO'|'WARN'} level 
     * @param {string} [tag=''] 
     * @param {string} [message=''] 
     * @param {any} [details=null] 
     * @param {string|Date} [timestamp=null] 
     */
    addLogEntry(level = 'DEBUG', tag = '', message = '', details = null, timestamp = null) {
      if (message === '' && details === null && typeof tag === 'string' && !tag.startsWith('[') && tag.includes(' ')) {
        message = tag;
        tag = '';
      }

      let parsedTag = tag;
      let cleanMessage = message;
      if (!parsedTag && typeof cleanMessage === 'string') {
        const tagMatch = cleanMessage.match(/^\[([A-Z0-9_\-]+)\]\s*(.*)$/i);
        if (tagMatch) {
          parsedTag = tagMatch[1];
          cleanMessage = tagMatch[2];
        }
      }

      const validLevel = String(level || 'DEBUG').toUpperCase();
      const timeObj = timestamp ? new Date(timestamp) : new Date();
      const timeFormatted = PanelUtils.formatTime(timeObj);

      const logObj = {
        id: PanelUtils.generateId('log'),
        level: validLevel,
        tag: parsedTag ? parsedTag.toUpperCase() : '',
        message: String(cleanMessage || ''),
        details: details,
        timeFormatted,
        timestamp: timeObj.toISOString()
      };

      this.logs.push(logObj);
      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }

      this.updateCounts();

      if (this.matchesFilter(logObj)) {
        this.appendLogToDOM(logObj);
        if (this.isAutoScroll) {
          this.scrollToBottom();
        }
      }
    }

    /**
     * Render welcome banner line in terminal
     */
    addRawTerminalBanner() {
      if (!this.domElements?.container) return;
      const bannerLine = document.createElement('div');
      bannerLine.className = 'terminal-banner-line';
      bannerLine.innerHTML = `<span class="banner-prompt">threads-automator@engine-worker:~$</span> <span class="banner-text">session initialized [PID: 4920] — Realtime logging pipeline active.</span>`;
      this.domElements.container.appendChild(bannerLine);
    }

    // Convenience Methods
    info(tagOrMsg, msgOrDetails = null, details = null) {
      if (details !== null || (typeof msgOrDetails === 'string' && typeof tagOrMsg === 'string')) {
        this.addLogEntry('INFO', tagOrMsg, msgOrDetails, details);
      } else {
        this.addLogEntry('INFO', '', tagOrMsg, msgOrDetails);
      }
    }

    debug(tagOrMsg, msgOrDetails = null, details = null) {
      if (details !== null || (typeof msgOrDetails === 'string' && typeof tagOrMsg === 'string')) {
        this.addLogEntry('DEBUG', tagOrMsg, msgOrDetails, details);
      } else {
        this.addLogEntry('DEBUG', '', tagOrMsg, msgOrDetails);
      }
    }

    dom(tagOrMsg, msgOrDetails = null, details = null) {
      if (details !== null || (typeof msgOrDetails === 'string' && typeof tagOrMsg === 'string')) {
        this.addLogEntry('DOM', tagOrMsg, msgOrDetails, details);
      } else {
        this.addLogEntry('DOM', '', tagOrMsg, msgOrDetails);
      }
    }

    success(tagOrMsg, msgOrDetails = null, details = null) {
      if (details !== null || (typeof msgOrDetails === 'string' && typeof tagOrMsg === 'string')) {
        this.addLogEntry('SUCCESS', tagOrMsg, msgOrDetails, details);
      } else {
        this.addLogEntry('SUCCESS', '', tagOrMsg, msgOrDetails);
      }
    }

    error(tagOrMsg, msgOrDetails = null, details = null) {
      if (details !== null || (typeof msgOrDetails === 'string' && typeof tagOrMsg === 'string')) {
        this.addLogEntry('ERROR', tagOrMsg, msgOrDetails, details);
      } else {
        this.addLogEntry('ERROR', '', tagOrMsg, msgOrDetails);
      }
    }

    warn(tagOrMsg, msgOrDetails = null, details = null) {
      if (details !== null || (typeof msgOrDetails === 'string' && typeof tagOrMsg === 'string')) {
        this.addLogEntry('WARN', tagOrMsg, msgOrDetails, details);
      } else {
        this.addLogEntry('WARN', '', tagOrMsg, msgOrDetails);
      }
    }

    /**
     * Check if log item matches current filter & search query
     * @param {Object} log 
     * @returns {boolean}
     */
    matchesFilter(log) {
      if (!log) return false;

      let matchLevel = true;
      if (this.activeFilter !== 'ALL') {
        matchLevel = (log.level === this.activeFilter);
      }

      let matchQuery = true;
      if (this.searchQuery) {
        const fullContent = `${log.timeFormatted} ${log.level} ${log.tag} ${log.message} ${log.details ? JSON.stringify(log.details) : ''}`.toLowerCase();
        matchQuery = fullContent.includes(this.searchQuery);
      }

      return matchLevel && matchQuery;
    }

    /**
     * Render full log list to DOM
     */
    render() {
      if (!this.domElements?.container) return;
      this.domElements.container.innerHTML = '';
      this.addRawTerminalBanner();

      const filtered = this.logs.filter(l => this.matchesFilter(l));
      filtered.forEach(log => {
        this.appendLogToDOM(log);
      });

      if (this.isAutoScroll) {
        this.scrollToBottom();
      }
    }

    /**
     * Append single log element to terminal container DOM
     * @param {Object} log 
     */
    appendLogToDOM(log) {
      if (!this.domElements?.container) return;

      const line = document.createElement('div');
      line.className = `log-entry-row level-${log.level.toLowerCase()}`;
      line.setAttribute('data-level', log.level);

      const safeMsg = PanelUtils.escapeHTML(log.message);
      let detailsHtml = '';
      if (log.details) {
        try {
          const detailStr = typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : String(log.details);
          detailsHtml = `
            <details class="log-payload-details">
              <summary class="payload-summary-toggle">
                <span class="summary-arrow">▶</span>
                <span class="summary-label">Details</span>
              </summary>
              <div class="payload-code-box">
                <pre class="payload-json">${PanelUtils.escapeHTML(detailStr)}</pre>
              </div>
            </details>
          `;
        } catch (_) {}
      }

      const scopeTagHtml = log.tag ? `<span class="log-scope">[${PanelUtils.escapeHTML(log.tag)}]</span>` : '';

      line.innerHTML = `
        <span class="log-timestamp">[${log.timeFormatted}]</span>
        <span class="log-badge badge-${log.level.toLowerCase()}">[${log.level}]</span>
        ${scopeTagHtml}
        <span class="log-message">${safeMsg}</span>
        ${detailsHtml}
      `;

      this.domElements.container.appendChild(line);
    }

    /**
     * Set level filter
     * @param {string} filter 
     */
    setFilter(filter = 'ALL') {
      this.activeFilter = String(filter).toUpperCase();
      if (this.domElements?.filterButtons) {
        this.domElements.filterButtons.forEach(btn => {
          const val = (btn.getAttribute('data-filter') || btn.getAttribute('data-log-filter') || 'ALL').toUpperCase();
          btn.classList.toggle('active', val === this.activeFilter);
        });
      }
      this.render();
    }

    /**
     * Update log counts in badges
     */
    updateCounts() {
      const counts = { ALL: this.logs.length, DEBUG: 0, DOM: 0, SUCCESS: 0, ERROR: 0, INFO: 0, WARN: 0 };
      this.logs.forEach(l => {
        if (counts[l.level] !== undefined) counts[l.level]++;
      });

      if (this.domElements && this.domElements.counts) {
        if (this.domElements.counts.all) this.domElements.counts.all.textContent = counts.ALL;
        if (this.domElements.counts.debug) this.domElements.counts.debug.textContent = counts.DEBUG;
        if (this.domElements.counts.dom) this.domElements.counts.dom.textContent = counts.DOM;
        if (this.domElements.counts.info) this.domElements.counts.info.textContent = counts.INFO;
        if (this.domElements.counts.success) this.domElements.counts.success.textContent = counts.SUCCESS;
        if (this.domElements.counts.error) this.domElements.counts.error.textContent = counts.ERROR;
      }

      if (this.domElements && this.domElements.footTotal) {
        this.domElements.footTotal.textContent = counts.ALL;
      }
    }

    scrollToBottom() {
      if (this.domElements?.container) {
        this.domElements.container.scrollTop = this.domElements.container.scrollHeight;
      }
    }

    /**
     * Copy filtered logs to clipboard
     */
    async copyToClipboard() {
      const filtered = this.logs.filter(l => this.matchesFilter(l));
      if (filtered.length === 0) return false;

      const lines = filtered.map(l => {
        const details = l.details ? ` | Data: ${JSON.stringify(l.details)}` : '';
        return `[${l.timeFormatted}] [${l.level}] ${l.tag ? `[${l.tag}] ` : ''}${l.message}${details}`;
      });

      const text = lines.join('\n');
      const ok = await PanelUtils.copyToClipboard(text);
      if (ok) {
        this.info('📋 Log terminal disalin ke clipboard!');
      }
      return ok;
    }

    /**
     * Export logs as a .TXT file
     */
    exportToTXT() {
      const now = new Date();
      const filename = `threads_debug_logs_${now.toISOString().slice(0, 10)}.txt`;
      const header = [
        '=================================================================',
        '  SHOPEE AFFILIATE & THREADS AUTO-POSTER — LIVE TERMINAL LOGS',
        `  Tanggal Ekspor : ${PanelUtils.formatDateTime(now)}`,
        `  Total Baris    : ${this.logs.length} entries`,
        '=================================================================\n'
      ].join('\n');

      const body = this.logs.map(l => {
        const details = l.details ? `\n    Details: ${JSON.stringify(l.details, null, 2)}` : '';
        return `[${l.timeFormatted}] [${l.level.padEnd(7, ' ')}] ${l.tag ? `[${l.tag}] ` : ''}${l.message}${details}`;
      }).join('\n');

      PanelUtils.downloadFile(`${header}\n${body}`, filename);
      this.info(`📥 Log debug diekspor ke file: ${filename}`);
    }

    /**
     * Clear all logs
     */
    clearLogs() {
      this.logs = [];
      this.updateCounts();
      this.render();
    }
  }

  // ===========================================================================
  // 6. MAIN CONTROLLER & APPLICATION COORDINATOR
  // ===========================================================================
  /**
   * Main application coordinator, lifecycle manager, modal handlers, and keyboard shortcuts.
   */
  class PosterPanelApp {
    constructor() {
      this.debugConsole = new PanelDebugConsole();
      this.queueManager = new PanelQueueManager();
      this.tabBridge = new PanelThreadsTabBridge(this.debugConsole);
      this.productPreview = new PanelProductPreview(this.queueManager, this.debugConsole);
      this.postingController = new PanelPostingController(this.queueManager, this.tabBridge, this.debugConsole);
      this.isInitialized = false;
    }

    /**
     * Initialize all modules & listeners
     */
    async init() {
      if (this.isInitialized) return;

      console.log('[PosterPanelApp] Inisialisasi Dedicated Poster & Live Debug Console...');

      // 1. Cache DOM and bind events across all components
      this.debugConsole.cacheDOM();
      this.debugConsole.bindEvents();

      this.productPreview.cacheDOM();
      this.productPreview.bindEvents();

      this.tabBridge.cacheDOM();
      this.tabBridge.bindEvents();

      this.postingController.cacheDOM();
      this.postingController.bindEvents();

      // 2. Initial terminal banner & startup log
      this.debugConsole.addRawTerminalBanner();
      this.debugConsole.debug('CORE-INIT', 'Initializing Poster Control Center context & extension storage sync.');

      // 3. Load Queue from Storage
      await this.queueManager.init();
      const allItems = this.queueManager.getAllItems();
      const pendingItems = this.queueManager.getPendingItems();
      this.debugConsole.info('QUEUE-DB', `Loaded ${allItems.length} items from storage (${pendingItems.length} pending).`);

      // 4. Subscribe Queue Manager updates to Product Preview
      this.queueManager.subscribe((event, data) => {
        if (event === 'queue_loaded' || event === 'queue_updated' || event === 'storage_changed' || event === 'item_deleted' || event === 'queue_cleared') {
          this.productPreview.render();
        } else if (event === 'active_item_changed') {
          this.productPreview.render(data.item);
        }
      });

      // 5. Initial Render
      this.productPreview.render();

      // 6. Check Threads Web tab connection
      const isConnected = await this.tabBridge.checkConnection();
      if (isConnected) {
        this.debugConsole.success('INJECTOR', 'Threads Content Script ping response received: { status: "ready" }');
      } else {
        this.debugConsole.info('THREADS-TAB', 'Tab Threads belum aktif. Buka tab Threads Web untuk memulai posting.');
      }

      // 7. Setup Live Clock & Modals
      this.setupLiveClock();
      this.setupModals();
      this.setupHeaderActions();
      this.bindKeyboardShortcuts();

      // 8. Window focus refresh
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', () => {
          this.tabBridge.checkConnection();
        });
      }

      this.isInitialized = true;
      console.log('[PosterPanelApp] Dedicated Poster Panel siap digunakan!');
    }

    /**
     * Realtime Clock in WIB (UTC+7)
     */
    setupLiveClock() {
      if (typeof document === 'undefined') return;
      const clockEl = document.getElementById('live-clock');
      if (!clockEl) return;

      const updateClock = () => {
        const now = new Date();
        const timeStr = PanelUtils.formatTime(now);
        clockEl.textContent = `${timeStr} WIB`;
      };

      updateClock();
      setInterval(updateClock, 1000);
    }

    /**
     * Setup Header button actions (Dashboard, Layout Toggle)
     */
    setupHeaderActions() {
      if (typeof document === 'undefined') return;
      const btnDashboard = document.getElementById('btn-open-dashboard');
      if (btnDashboard) {
        btnDashboard.addEventListener('click', () => {
          if (typeof window !== 'undefined') {
            window.location.href = '../dashboard/dashboard.html';
          }
        });
      }

      const btnToggleLayout = document.getElementById('btn-toggle-layout');
      const layoutContainer = document.getElementById('panel-dual-layout');
      if (btnToggleLayout && layoutContainer) {
        btnToggleLayout.addEventListener('click', () => {
          layoutContainer.classList.toggle('layout-stacked');
        });
      }
    }

    /**
     * Setup modals for Spintax & Image Zoom
     */
    setupModals() {
      if (typeof document === 'undefined') return;

      // Close modal buttons with [data-close]
      document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const targetId = btn.getAttribute('data-close');
          const modal = document.getElementById(targetId);
          if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
          }
        });
      });

      // Spintax Modal Actions
      const btnGenSpintax = document.getElementById('btn-generate-spintax-variations');
      const inputSpintax = document.getElementById('modal-spintax-input');
      const resultsSpintax = document.getElementById('modal-spintax-results');
      const btnApplySpintax = document.getElementById('btn-apply-spintax-to-caption');

      if (btnGenSpintax && inputSpintax && resultsSpintax) {
        btnGenSpintax.addEventListener('click', () => {
          const tpl = inputSpintax.value;
          resultsSpintax.innerHTML = '';
          for (let i = 1; i <= 5; i++) {
            const spun = PanelUtils.parseSpintaxFallback(tpl);
            const item = document.createElement('div');
            item.className = 'spintax-result-item';
            item.textContent = `${i}. ${spun}`;
            resultsSpintax.appendChild(item);
          }
        });
      }

      if (btnApplySpintax && inputSpintax) {
        btnApplySpintax.addEventListener('click', () => {
          const item = this.queueManager.getActiveItem();
          if (item) {
            this.queueManager.updateItemCaption(item.id, inputSpintax.value);
            const captionEditor = document.getElementById('product-caption-editor');
            if (captionEditor) captionEditor.value = inputSpintax.value;
          }
          const modal = document.getElementById('modal-spintax');
          if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
          }
        });
      }
    }

    /**
     * Bind operational keyboard shortcuts
     */
    bindKeyboardShortcuts() {
      if (typeof document === 'undefined') return;

      document.addEventListener('keydown', (e) => {
        // Do not intercept when typing in input or textarea
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) {
          return;
        }

        // Space / Enter -> Post Active Item Now
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          const item = this.queueManager.getActiveItem();
          if (item) {
            this.postingController.executePostSingle(item);
          }
        }

        // Arrow Right -> Next Item
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.queueManager.selectNextItem();
        }

        // Arrow Left -> Prev Item
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.queueManager.selectPrevItem();
        }

        // Key R -> Randomize Spintax
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          this.productPreview.spinCaption();
        }
      });
    }
  }

  // Singleton instance
  const posterPanelInstance = new PosterPanelApp();

  // Auto-bootstrap when loaded in browser DOM
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => posterPanelInstance.init());
    } else {
      posterPanelInstance.init();
    }
  }

  return {
    PanelUtils,
    PanelQueueManager,
    PanelProductPreview,
    PanelThreadsTabBridge,
    PanelPostingController,
    PanelDebugConsole,
    PosterPanelApp,
    posterPanelApp: posterPanelInstance,
    app: posterPanelInstance
  };
});
