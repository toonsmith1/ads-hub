/**
 * @file db.js
 * @description Domain & Storage Layer (Clean Architecture & Repository Pattern) for Shopee & Threads Extension (Manifest V3)
 * Manages persistent local data via chrome.storage.local with Repository Pattern:
 * - QueueRepository (threads_queue): Manages queued posts, schedules, statuses, and retry counters.
 * - LogsRepository (threads_logs / threads_history): Records execution history and operation logs.
 * - SettingsRepository (threads_settings): Extension preferences and scheduler configurations.
 * - TemplatesRepository (threads_templates): Spintax caption templates and presets.
 * - ProductsRepository (threads_products): Scraped product catalog and duplicate detection.
 * 
 * Provides unified facade `DB` & `ShopeeDB` with 100% backwards compatibility and clean JSDoc.
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root) {
  'use strict';

  // =========================================================================
  // CONSTANTS & FALLBACKS
  // =========================================================================

  const APP_CONSTANTS = (typeof root !== 'undefined' && root.CONSTANTS) || {};

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

  const DEFAULT_SETTINGS = APP_CONSTANTS.DEFAULT_SETTINGS || {
    intervalMinutes: 15,
    interval_minutes: 15,
    jitterSeconds: 60,
    jitter_seconds: 60,
    dailyLimit: 25,
    daily_post_limit: 25,
    isQueueRunning: false,
    activeTemplateId: 'preset_racun_viral',
    active_template_id: 'preset_racun_viral',
    hashtagCategory: 'viral',
    hashtag_category: 'viral',
    hashtagCount: 4,
    hashtag_count: 4,
    customHashtagBanks: null,
    autoRetry: true,
    auto_retry: true,
    maxRetries: 3,
    max_retries: 3,
    workingHoursEnabled: false,
    working_hours_enabled: false,
    workingHoursStart: '08:00',
    working_hours_start: '08:00',
    workingHoursEnd: '22:00',
    working_hours_end: '22:00',
    subId1: 'threads',
    sub_id_1: 'threads',
    subId2: 'autopost',
    sub_id_2: 'autopost',
    subId3: '',
    sub_id_3: '',
    autoStart: false,
    notification: true,
    updated_at: new Date().toISOString()
  };

  const DEFAULT_TEMPLATES = APP_CONSTANTS.PRESET_TEMPLATES || APP_CONSTANTS.DEFAULT_TEMPLATES || [
    {
      id: 'preset_racun_viral',
      name: '🔥 Racun Shopee Viral (High Engagement)',
      category: 'viral',
      isDefault: true,
      is_default: true,
      template: `{Gila sih ini|Keren parah|Gak nyangka sebagus ini|Wajib punya nih}! 😍🔥\n{Lagi viral banget|Banyak yang cari|Rekomendasi terbaik hari ini}: {nama_produk}\n\n💸 {Harga cuma|Dapet harga|Cuma}: {harga} {diskon}\n⭐ Rating: {rating} | {terjual} terjual\n\n🔗 {Beli di sini yuk|Cek checkout di sini|Link official promo|Spill link tokonya}:\n{link_affiliate}\n\n{hashtag_random}`,
      content: `{Gila sih ini|Keren parah|Gak nyangka sebagus ini|Wajib punya nih}! 😍🔥\n{Lagi viral banget|Banyak yang cari|Rekomendasi terbaik hari ini}: {nama_produk}\n\n💸 {Harga cuma|Dapet harga|Cuma}: {harga} {diskon}\n⭐ Rating: {rating} | {terjual} terjual\n\n🔗 {Beli di sini yuk|Cek checkout di sini|Link official promo|Spill link tokonya}:\n{link_affiliate}\n\n{hashtag_random}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'preset_aesthetic_review',
      name: '✨ Aesthetic & Honest Review',
      category: 'home_living',
      isDefault: false,
      is_default: false,
      template: `{Spill barang aesthetic check ✨|Honest review produk ini 🤍|Hidden gem Shopee yang wajib kamu tahu 🌿}\n\n{nama_produk}\n{Bener-bener worth to buy|Kualitasnya di luar ekspektasi|Desainnya cakep dan multifungsi banget}!\n\n💰 {Harga normal vs promo}: {harga}\n🌟 {Review rating}: {rating} ({terjual} terjual)\n\n🛒 {Tautan produk original|Link pembelian resmi}:\n{link_affiliate}\n\n{hashtag_random}`,
      content: `{Spill barang aesthetic check ✨|Honest review produk ini 🤍|Hidden gem Shopee yang wajib kamu tahu 🌿}\n\n{nama_produk}\n{Bener-bener worth to buy|Kualitasnya di luar ekspektasi|Desainnya cakep dan multifungsi banget}!\n\n💰 {Harga normal vs promo}: {harga}\n🌟 {Review rating}: {rating} ({terjual} terjual)\n\n🛒 {Tautan produk original|Link pembelian resmi}:\n{link_affiliate}\n\n{hashtag_random}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'preset_diskon_promo',
      name: '🚨 Flash Sale & Promo Alert',
      category: 'viral',
      isDefault: false,
      is_default: false,
      template: `🚨 {PROMO ALERT|FLASH SALE ALERT|DROP PRICE}! 🚨\n{nama_produk}\n\n⚡ {Lagi diskon gede|Harga anjlok parah|Lagi turun harga banget}!\n🏷️ {Sekarang cuma}: {harga} {diskon}\n✨ {Terjual}: {terjual} | Rating {rating}\n\n👇 {Buruan klaim vouchernya sebelum kehabisan|Klik link di bawah ini|Link promo Shopee}:\n{link_affiliate}\n\n{hashtag_random}`,
      content: `🚨 {PROMO ALERT|FLASH SALE ALERT|DROP PRICE}! 🚨\n{nama_produk}\n\n⚡ {Lagi diskon gede|Harga anjlok parah|Lagi turun harga banget}!\n🏷️ {Sekarang cuma}: {harga} {diskon}\n✨ {Terjual}: {terjual} | Rating {rating}\n\n👇 {Buruan klaim vouchernya sebelum kehabisan|Klik link di bawah ini|Link promo Shopee}:\n{link_affiliate}\n\n{hashtag_random}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================

  /**
   * Helper UUID generator yang aman untuk seluruh environment (Node, Browser, MV3)
   * @param {string} [prefix='id']
   * @returns {string}
   */
  function generateId(prefix = 'id') {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
    }
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${timestamp}_${randomPart}`;
  }

  /**
   * Normalisasi struktur item antrean (threads_queue)
   * @param {Object} raw
   * @returns {Object}
   */
  function normalizeQueueItem(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Data antrean tidak valid');
    }

    const id = raw.id || generateId('queue');
    const title = (raw.title || raw.rawTitle || raw.name || raw.product_name || 'Produk Shopee').trim();
    const price = (raw.price || raw.harga || '-').toString().trim();
    const discount = (raw.discount || raw.diskon || '').toString().trim();
    const rating = (raw.rating || '⭐ 4.9').toString().trim();
    const sold = (raw.sold || raw.terjual || '-').toString().trim();
    const commission = (raw.commission || raw.comm_rate || raw.commRate || raw.estimasi_komisi || '-').toString().trim();
    const shortLink = (raw.shortLink || raw.short_link || raw.url || raw.link || raw.link_affiliate || '').trim();

    // Normalisasi array gambar
    let images = [];
    if (Array.isArray(raw.images) && raw.images.length > 0) {
      images = raw.images.filter(Boolean);
    } else if (Array.isArray(raw.imageUrls) && raw.imageUrls.length > 0) {
      images = raw.imageUrls.filter(Boolean);
    } else if (Array.isArray(raw.image_urls) && raw.image_urls.length > 0) {
      images = raw.image_urls.filter(Boolean);
    } else if (raw.primaryImage || raw.imageUrl || raw.cleanImgUrl) {
      images = [raw.primaryImage || raw.imageUrl || raw.cleanImgUrl];
    }

    const primaryImage = raw.primaryImage || (images.length > 0 ? images[0] : '');
    const caption = raw.caption || raw.caption_threads || raw.caption_text || '';
    const rawStatus = (raw.status || QUEUE_STATUS.PENDING).toUpperCase();
    const status = (rawStatus === 'PROCESSING') ? QUEUE_STATUS.POSTING : rawStatus;
    const productId = String(raw.productId || raw.product_id || raw.shopeeId || raw.shopee_id || raw.itemId || id);
    const scheduleTime = raw.scheduleTime || raw.schedule_time || raw.schedule || new Date().toISOString();
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
      status, // PENDING | POSTING | POSTED | FAILED
      scheduleTime,
      schedule_time: scheduleTime,
      postedAt: raw.postedAt || raw.posted_at || null,
      posted_at: raw.postedAt || raw.posted_at || null,
      threadsUrl: raw.threadsUrl || raw.threads_url || null,
      threads_url: raw.threadsUrl || raw.threads_url || null,
      retryCount: raw.retryCount !== undefined ? raw.retryCount : (raw.retry_count || 0),
      retry_count: raw.retryCount !== undefined ? raw.retryCount : (raw.retry_count || 0),
      error: raw.error || raw.errorMessage || raw.error_message || null,
      errorMessage: raw.error || raw.errorMessage || raw.error_message || null,
      createdAt,
      created_at: createdAt,
      updatedAt,
      updated_at: updatedAt
    };
  }

  /**
   * Normalisasi struktur item template (threads_templates)
   * @param {Object} raw
   * @returns {Object}
   */
  function normalizeTemplateItem(raw) {
    if (!raw || typeof raw !== 'object' || (!raw.template && !raw.content)) {
      throw new Error('Format template caption tidak valid');
    }

    const id = raw.id || generateId('tmpl');
    const text = raw.template || raw.content || '';
    const now = new Date().toISOString();

    return {
      id,
      name: raw.name || 'Template Caption Kustom',
      template: text,
      content: text,
      category: raw.category || 'viral',
      is_default: Boolean(raw.is_default || raw.isDefault),
      isDefault: Boolean(raw.is_default || raw.isDefault),
      created_at: raw.created_at || raw.createdAt || now,
      createdAt: raw.created_at || raw.createdAt || now,
      updated_at: now,
      updatedAt: now
    };
  }

  /**
   * Normalisasi struktur item log history (threads_logs / threads_history)
   * @param {Object} raw
   * @returns {Object|null}
   */
  function normalizeLogItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = raw.id || generateId('log');
    const timestamp = raw.timestamp || raw.created_at || raw.createdAt || new Date().toISOString();
    const productId = String(raw.productId || raw.product_id || raw.shopeeId || raw.shopee_id || '');
    const title = raw.title || raw.rawTitle || raw.name || raw.product_name || 'Produk Shopee';
    const price = raw.price || raw.harga || '-';
    const shortLink = raw.shortLink || raw.short_link || raw.url || raw.link || '';
    const threadsUrl = raw.threadsUrl || raw.threads_url || null;
    const status = (raw.status || QUEUE_STATUS.POSTED).toUpperCase();
    const error = raw.error || raw.errorMessage || raw.error_message || null;

    return {
      id,
      productId,
      product_id: productId,
      shopeeId: productId,
      shopee_id: productId,
      title,
      price,
      shortLink,
      short_link: shortLink,
      threadsUrl,
      threads_url: threadsUrl,
      status,
      error,
      errorMessage: error,
      error_message: error,
      timestamp,
      created_at: timestamp,
      createdAt: timestamp
    };
  }

  // =========================================================================
  // 1. STORAGE ADAPTER (Low-Level Storage Infrastructure)
  // =========================================================================

  // In-memory store fallback for Node.js / testing environments
  const _memoryStore = {};

  /**
   * Low-Level Storage Adapter yang membungkus chrome.storage.local dengan Promise
   * dan fallback ke localStorage/memory jika di luar extension runtime
   */
  class StorageAdapter {
    /**
     * Membaca data berdasarkan kunci
     * @param {string|Array<string>} keys
     * @returns {Promise<Object>}
     */
    static async get(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              console.warn('[StorageAdapter] chrome.storage.local get warning:', chrome.runtime.lastError);
              resolve({});
            } else {
              resolve(result || {});
            }
          });
        });
      }

      // Fallback 1: localStorage
      try {
        if (typeof localStorage !== 'undefined') {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
          for (const k of keyList) {
            const raw = localStorage.getItem(k);
            if (raw !== null) {
              try { result[k] = JSON.parse(raw); } catch (e) { result[k] = raw; }
            }
          }
          return result;
        }
      } catch (e) {
        console.warn('[StorageAdapter] localStorage get fallback error:', e);
      }

      // Fallback 2: In-Memory Store
      const result = {};
      const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
      for (const k of keyList) {
        if (_memoryStore[k] !== undefined) {
          result[k] = JSON.parse(JSON.stringify(_memoryStore[k]));
        }
      }
      return result;
    }

    /**
     * Menyimpan data objek ke storage
     * @param {Object} items
     * @returns {Promise<void>}
     */
    static async set(items) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.set(items, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              console.warn('[StorageAdapter] chrome.storage.local set warning:', chrome.runtime.lastError);
            }
            resolve();
          });
        });
      }

      // Fallback 1: localStorage
      try {
        if (typeof localStorage !== 'undefined') {
          for (const [k, v] of Object.entries(items)) {
            localStorage.setItem(k, JSON.stringify(v));
          }
        }
      } catch (e) {
        console.warn('[StorageAdapter] localStorage set fallback error:', e);
      }

      // Fallback 2: In-Memory Store
      for (const [k, v] of Object.entries(items)) {
        _memoryStore[k] = JSON.parse(JSON.stringify(v));
      }
    }

    /**
     * Menghapus kunci dari storage
     * @param {string|Array<string>} keys
     * @returns {Promise<void>}
     */
    static async remove(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.remove(keys, () => resolve());
        });
      }
      try {
        if (typeof localStorage !== 'undefined') {
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) localStorage.removeItem(k);
        }
      } catch (e) {}

      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) delete _memoryStore[k];
    }

    /**
     * Mengosongkan seluruh storage
     * @returns {Promise<void>}
     */
    static async clear() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.clear(() => resolve());
        });
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.clear();
        }
      } catch (e) {}

      for (const k of Object.keys(_memoryStore)) {
        delete _memoryStore[k];
      }
    }
  }

  // =========================================================================
  // 2. REPOSITORIES
  // =========================================================================

  /**
   * Repository Pattern for Queue Management (threads_queue)
   */
  class QueueRepository {
    constructor(adapter = StorageAdapter) {
      this.adapter = adapter;
      this.key = STORAGE_KEYS.QUEUE;
    }

    /**
     * Mengambil daftar antrean posting Threads
     * @param {string|null} [statusFilter=null] - Filter status ('PENDING'|'POSTING'|'POSTED'|'FAILED'|null)
     * @returns {Promise<Array<Object>>}
     */
    async getQueue(statusFilter = null) {
      const data = await this.adapter.get(this.key);
      let list = Array.isArray(data[this.key]) ? data[this.key] : [];

      if (statusFilter) {
        const filterNorm = statusFilter.toUpperCase();
        list = list.filter(item => (item.status || '').toUpperCase() === filterNorm);
      }

      return list;
    }

    async getAll(statusFilter = null) {
      return this.getQueue(statusFilter);
    }

    /**
     * Mengambil satu item antrean berdasarkan ID
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getQueueItem(id) {
      if (!id) return null;
      const list = await this.getQueue();
      return list.find(item => item.id === id) || null;
    }

    async getById(id) {
      return this.getQueueItem(id);
    }

    /**
     * Menambahkan satu item ke dalam antrean
     * @param {Object} item
     * @returns {Promise<Object>} Item yang tersimpan
     */
    async addQueueItem(item) {
      const normalized = normalizeQueueItem(item);
      const list = await this.getQueue();

      const existingIdx = list.findIndex(it => it.id === normalized.id);
      if (existingIdx >= 0) {
        list[existingIdx] = { ...list[existingIdx], ...normalized, updated_at: new Date().toISOString() };
      } else {
        list.push(normalized);
      }

      await this.adapter.set({ [this.key]: list });
      return normalized;
    }

    async add(item) {
      return this.addQueueItem(item);
    }

    /**
     * Menambahkan batch array item ke dalam antrean
     * @param {Array<Object>} items
     * @returns {Promise<Array<Object>>}
     */
    async addQueueItems(items) {
      if (!Array.isArray(items) || items.length === 0) return [];
      const list = await this.getQueue();
      const addedList = [];

      for (const raw of items) {
        if (!raw) continue;
        const normalized = normalizeQueueItem(raw);
        const existingIdx = list.findIndex(it => it.id === normalized.id);
        if (existingIdx >= 0) {
          list[existingIdx] = { ...list[existingIdx], ...normalized, updated_at: new Date().toISOString() };
        } else {
          list.push(normalized);
        }
        addedList.push(normalized);
      }

      await this.adapter.set({ [this.key]: list });
      return addedList;
    }

    async addBatch(items) {
      return this.addQueueItems(items);
    }

    /**
     * Memperbarui item antrean berdasarkan ID
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async updateQueueItem(id, updates = {}) {
      if (!id) throw new Error('ID antrean wajib diisi');
      const list = await this.getQueue();
      const idx = list.findIndex(it => it.id === id);

      if (idx === -1) {
        throw new Error(`Queue item dengan ID '${id}' tidak ditemukan`);
      }

      const current = list[idx];
      const normalizedStatus = updates.status ? updates.status.toUpperCase() : current.status;
      const now = new Date().toISOString();

      const merged = {
        ...current,
        ...updates,
        status: (normalizedStatus === 'PROCESSING') ? QUEUE_STATUS.POSTING : normalizedStatus,
        updated_at: now,
        updatedAt: now
      };

      if (merged.status === QUEUE_STATUS.POSTED) {
        merged.posted_at = updates.posted_at || updates.postedAt || current.posted_at || now;
        merged.postedAt = merged.posted_at;
        merged.threads_url = updates.threads_url || updates.threadsUrl || current.threads_url || null;
        merged.threadsUrl = merged.threads_url;
        merged.error = null;
        merged.errorMessage = null;
      } else if (merged.status === QUEUE_STATUS.FAILED) {
        merged.error = updates.error || updates.errorMessage || current.error || 'Gagal memposting ke Threads';
        merged.errorMessage = merged.error;
        merged.retry_count = (current.retry_count || 0) + 1;
        merged.retryCount = merged.retry_count;
      }

      list[idx] = normalizeQueueItem(merged);
      await this.adapter.set({ [this.key]: list });
      return list[idx];
    }

    async update(id, updates) {
      return this.updateQueueItem(id, updates);
    }

    /**
     * Memperbarui status antrean
     * @param {string} id
     * @param {string} status
     * @param {Object} [extraData={}]
     * @returns {Promise<Object>}
     */
    async updateStatus(id, status, extraData = {}) {
      return this.updateQueueItem(id, { status, ...extraData });
    }

    async updateQueueStatus(id, status, extraData = {}) {
      return this.updateStatus(id, status, extraData);
    }

    /**
     * Menghapus item dari antrean berdasarkan ID
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteQueueItem(id) {
      if (!id) return false;
      const list = await this.getQueue();
      const filtered = list.filter(it => it.id !== id);
      await this.adapter.set({ [this.key]: filtered });
      return true;
    }

    async deleteItem(id) {
      return this.deleteQueueItem(id);
    }

    async delete(id) {
      return this.deleteQueueItem(id);
    }

    /**
     * Mengosongkan antrean (bisa difilter per status)
     * @param {string|null} [statusFilter=null]
     * @returns {Promise<boolean>}
     */
    async clearQueue(statusFilter = null) {
      if (!statusFilter) {
        await this.adapter.set({ [this.key]: [] });
        return true;
      }

      const normFilter = statusFilter.toUpperCase();
      const list = await this.getQueue();
      const filtered = list.filter(it => (it.status || '').toUpperCase() !== normFilter);
      await this.adapter.set({ [this.key]: filtered });
      return true;
    }

    async clear(statusFilter = null) {
      return this.clearQueue(statusFilter);
    }

    /**
     * Mengambil item PENDING berikutnya yang siap diposting berdasarkan jadwal
     * @returns {Promise<Object|null>}
     */
    async getNextPendingItem() {
      const pendingList = await this.getQueue(QUEUE_STATUS.PENDING);
      if (!pendingList || pendingList.length === 0) return null;

      const now = new Date().toISOString();
      const readyItem = pendingList.find(item => {
        const schedule = item.schedule_time || item.scheduleTime;
        return !schedule || schedule <= now;
      });

      return readyItem || pendingList[0] || null;
    }

    async getNextPendingQueueItem() {
      return this.getNextPendingItem();
    }

    /**
     * Mendapatkan statistik status antrean
     * @returns {Promise<Object>}
     */
    async getStats() {
      const allQueue = await this.getQueue();
      const pending = allQueue.filter(q => q.status === QUEUE_STATUS.PENDING).length;
      const posting = allQueue.filter(q => q.status === QUEUE_STATUS.POSTING || q.status === 'PROCESSING').length;
      const posted = allQueue.filter(q => q.status === QUEUE_STATUS.POSTED).length;
      const failed = allQueue.filter(q => q.status === QUEUE_STATUS.FAILED).length;

      const todayStr = new Date().toISOString().substring(0, 10);
      const postedToday = allQueue.filter(q => q.status === QUEUE_STATUS.POSTED && (q.posted_at || q.postedAt || '').startsWith(todayStr)).length;

      return {
        total: allQueue.length,
        pending,
        posting,
        processing: posting,
        posted,
        failed,
        postedToday,
        posted_today: postedToday,
        total_queue: allQueue.length,
        pending_count: pending,
        processing_count: posting,
        posted_count: posted,
        failed_count: failed
      };
    }

    async getQueueStats() {
      return this.getStats();
    }
  }

  /**
   * Repository Pattern for Activity Logs (threads_logs / threads_history)
   */
  class LogsRepository {
    constructor(adapter = StorageAdapter) {
      this.adapter = adapter;
      this.key = STORAGE_KEYS.LOGS;
      this.altKey = STORAGE_KEYS.HISTORY;
    }

    /**
     * Mengambil riwayat log aktivitas (terbaru di atas)
     * @param {number} [limit=200]
     * @returns {Promise<Array<Object>>}
     */
    async getLogs(limit = 200) {
      const data = await this.adapter.get([this.key, this.altKey]);
      let logs = Array.isArray(data[this.key]) ? data[this.key] : (Array.isArray(data[this.altKey]) ? data[this.altKey] : []);

      logs.sort((a, b) => new Date(b.timestamp || b.created_at || 0) - new Date(a.timestamp || a.created_at || 0));
      return logs.slice(0, limit);
    }

    async getAll(limit = 200) {
      return this.getLogs(limit);
    }

    async getHistory(limit = 200) {
      return this.getLogs(limit);
    }

    /**
     * Menambahkan log aktivitas baru
     * @param {Object} logItem
     * @returns {Promise<Object|null>}
     */
    async addLog(logItem) {
      const item = normalizeLogItem(logItem);
      if (!item) return null;

      const logs = await this.getLogs(1000);
      logs.unshift(item);

      const trimmed = logs.slice(0, 1000);
      await this.adapter.set({
        [this.key]: trimmed,
        [this.altKey]: trimmed
      });
      return item;
    }

    async add(logItem) {
      return this.addLog(logItem);
    }

    async addHistoryItem(logItem) {
      return this.addLog(logItem);
    }

    /**
     * Menghapus 1 entri log berdasarkan ID
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteLog(id) {
      if (!id) return false;
      const logs = await this.getLogs(1000);
      const filtered = logs.filter(l => l.id !== id);
      await this.adapter.set({
        [this.key]: filtered,
        [this.altKey]: filtered
      });
      return true;
    }

    async delete(id) {
      return this.deleteLog(id);
    }

    /**
     * Mengosongkan seluruh riwayat log
     * @returns {Promise<boolean>}
     */
    async clearLogs() {
      await this.adapter.set({
        [this.key]: [],
        [this.altKey]: []
      });
      return true;
    }

    async clearHistory() {
      return this.clearLogs();
    }

    async clear() {
      return this.clearLogs();
    }
  }

  /**
   * Repository Pattern for Settings Management (threads_settings)
   */
  class SettingsRepository {
    constructor(adapter = StorageAdapter) {
      this.adapter = adapter;
      this.key = STORAGE_KEYS.SETTINGS;
      this.defaults = DEFAULT_SETTINGS;
    }

    /**
     * Mengambil konfigurasi preferensi ekstensi
     * @returns {Promise<Object>}
     */
    async getSettings() {
      const data = await this.adapter.get(this.key);
      const saved = (data[this.key] && typeof data[this.key] === 'object') ? data[this.key] : {};

      return {
        ...this.defaults,
        ...saved
      };
    }

    async getAll() {
      return this.getSettings();
    }

    /**
     * Mengambil satu nilai konfigurasi spesifik
     * @param {string} key
     * @param {any} [defaultValue=null]
     * @returns {Promise<any>}
     */
    async getSetting(key, defaultValue = null) {
      const settings = await this.getSettings();
      return (settings[key] !== undefined && settings[key] !== null) ? settings[key] : defaultValue;
    }

    async get(key, defaultValue = null) {
      return this.getSetting(key, defaultValue);
    }

    /**
     * Memperbarui pengaturan ekstensi
     * @param {Object} settingsObj
     * @returns {Promise<Object>}
     */
    async updateSettings(settingsObj) {
      if (!settingsObj || typeof settingsObj !== 'object') {
        throw new Error('Data pengaturan tidak valid');
      }

      const current = await this.getSettings();
      const updated = {
        ...current,
        ...settingsObj,
        updated_at: new Date().toISOString()
      };

      await this.adapter.set({ [this.key]: updated });
      return updated;
    }

    async update(settingsObj) {
      return this.updateSettings(settingsObj);
    }

    /**
     * Mengatur nilai satu setting
     * @param {string} key
     * @param {any} value
     * @returns {Promise<Object>}
     */
    async setSetting(key, value) {
      return this.updateSettings({ [key]: value });
    }

    async set(key, value) {
      return this.setSetting(key, value);
    }
  }

  /**
   * Repository Pattern for Caption Templates (threads_templates)
   */
  class TemplatesRepository {
    constructor(adapter = StorageAdapter) {
      this.adapter = adapter;
      this.key = STORAGE_KEYS.TEMPLATES;
      this.defaults = DEFAULT_TEMPLATES;
    }

    /**
     * Mengambil seluruh template caption Spintax
     * @returns {Promise<Array<Object>>}
     */
    async getTemplates() {
      const data = await this.adapter.get(this.key);
      let list = Array.isArray(data[this.key]) ? data[this.key] : [];

      if (list.length === 0) {
        list = JSON.parse(JSON.stringify(this.defaults));
        await this.adapter.set({ [this.key]: list });
      }

      return list;
    }

    async getAll() {
      return this.getTemplates();
    }

    /**
     * Mengambil template caption berdasarkan ID
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getTemplateById(id) {
      if (!id) return null;
      const list = await this.getTemplates();
      return list.find(t => t.id === id) || null;
    }

    async getById(id) {
      return this.getTemplateById(id);
    }

    /**
     * Mengambil template aktif / default
     * @returns {Promise<Object|null>}
     */
    async getDefaultTemplate() {
      const list = await this.getTemplates();
      if (!list || list.length === 0) return null;

      const def = list.find(t => t.is_default || t.isDefault);
      return def || list[0];
    }

    /**
     * Menyimpan atau memperbarui template caption
     * @param {Object} template
     * @returns {Promise<Object>}
     */
    async saveTemplate(template) {
      const normalized = normalizeTemplateItem(template);
      const list = await this.getTemplates();

      if (normalized.is_default) {
        list.forEach(t => {
          if (t.id !== normalized.id) {
            t.is_default = false;
            t.isDefault = false;
          }
        });
      }

      const existingIdx = list.findIndex(t => t.id === normalized.id);
      if (existingIdx >= 0) {
        list[existingIdx] = { ...list[existingIdx], ...normalized };
      } else {
        list.push(normalized);
      }

      await this.adapter.set({ [this.key]: list });
      return normalized;
    }

    async save(template) {
      return this.saveTemplate(template);
    }

    /**
     * Menghapus template caption berdasarkan ID
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteTemplate(id) {
      if (!id) return false;
      let list = await this.getTemplates();
      const filtered = list.filter(t => t.id !== id);

      if (filtered.length > 0 && !filtered.some(t => t.is_default || t.isDefault)) {
        filtered[0].is_default = true;
        filtered[0].isDefault = true;
      }

      await this.adapter.set({ [this.key]: filtered });
      return true;
    }

    async delete(id) {
      return this.deleteTemplate(id);
    }

    /**
     * Menetapkan template sebagai default aktif
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async setDefaultTemplate(id) {
      const list = await this.getTemplates();
      let target = null;

      list.forEach(t => {
        if (t.id === id) {
          t.is_default = true;
          t.isDefault = true;
          target = t;
        } else {
          t.is_default = false;
          t.isDefault = false;
        }
      });

      if (target) {
        await this.adapter.set({ [this.key]: list });
      }

      return target;
    }
  }

  /**
   * Repository Pattern for Scraped Products Catalog (threads_products)
   */
  class ProductsRepository {
    constructor(adapter = StorageAdapter) {
      this.adapter = adapter;
      this.key = STORAGE_KEYS.PRODUCTS;
    }

    /**
     * Mengambil daftar produk tersimpan
     * @param {number} [limit=500]
     * @param {number} [offset=0]
     * @returns {Promise<Array<Object>>}
     */
    async getProducts(limit = 500, offset = 0) {
      const data = await this.adapter.get(this.key);
      const list = Array.isArray(data[this.key]) ? data[this.key] : [];
      return list.slice(offset, offset + limit);
    }

    async getAll(limit = 500, offset = 0) {
      return this.getProducts(limit, offset);
    }

    /**
     * Mengambil produk berdasarkan ID / Shopee ID
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getProductById(id) {
      if (!id) return null;
      const products = await this.getProducts(5000);
      return products.find(p => p.id === id || p.shopee_id === id || p.productId === id) || null;
    }

    async getById(id) {
      return this.getProductById(id);
    }

    /**
     * Menambahkan / memperbarui produk ke katalog
     * @param {Object} product
     * @returns {Promise<Object>}
     */
    async addProduct(product) {
      if (!product || typeof product !== 'object') {
        throw new Error('Data produk tidak valid');
      }

      const list = await this.getProducts(5000);
      const item = {
        id: product.id || generateId('prod'),
        shopee_id: String(product.shopee_id || product.shopeeId || product.itemId || ''),
        productId: String(product.shopee_id || product.shopeeId || product.productId || ''),
        title: product.title || product.rawTitle || product.name || 'Produk Shopee',
        price: product.price || product.harga || '-',
        comm_rate: product.comm_rate || product.commission || '-',
        commission: product.comm_rate || product.commission || '-',
        image_urls: Array.isArray(product.image_urls) ? product.image_urls : (product.images || []),
        images: Array.isArray(product.images) ? product.images : (product.image_urls || []),
        short_link: product.short_link || product.shortLink || product.url || '',
        shortLink: product.short_link || product.shortLink || product.url || '',
        rating: product.rating || '⭐ 4.9',
        terjual: product.terjual || product.sold || '1rb+ terjual',
        category: product.category || 'viral',
        created_at: product.created_at || new Date().toISOString()
      };

      const existingIdx = list.findIndex(p => p.id === item.id || (item.shopee_id && p.shopee_id === item.shopee_id));
      if (existingIdx >= 0) {
        list[existingIdx] = { ...list[existingIdx], ...item };
      } else {
        list.unshift(item);
      }

      await this.adapter.set({ [this.key]: list.slice(0, 2000) });
      return item;
    }

    async add(product) {
      return this.addProduct(product);
    }

    /**
     * Menambahkan batch array produk ke katalog
     * @param {Array<Object>} productsArray
     * @returns {Promise<Array<Object>>}
     */
    async addProducts(productsArray) {
      if (!Array.isArray(productsArray) || productsArray.length === 0) return [];
      const saved = [];
      for (const p of productsArray) {
        const item = await this.addProduct(p);
        saved.push(item);
      }
      return saved;
    }

    async addBatch(productsArray) {
      return this.addProducts(productsArray);
    }

    /**
     * Menghapus produk dari katalog
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteProduct(id) {
      if (!id) return false;
      const list = await this.getProducts(5000);
      const filtered = list.filter(p => p.id !== id && p.shopee_id !== id);
      await this.adapter.set({ [this.key]: filtered });
      return true;
    }

    async delete(id) {
      return this.deleteProduct(id);
    }

    /**
     * Memeriksa apakah produk Shopee tertentu pernah diposting dalam X hari terakhir
     * @param {string} shopeeId
     * @param {number} [days=7]
     * @returns {Promise<boolean>}
     */
    async isProductPostedRecently(shopeeId, days = 7) {
      if (!shopeeId) return false;
      const strId = String(shopeeId);
      const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

      // Cek pada storage antrean
      const qData = await this.adapter.get(STORAGE_KEYS.QUEUE);
      const queue = Array.isArray(qData[STORAGE_KEYS.QUEUE]) ? qData[STORAGE_KEYS.QUEUE] : [];
      const postedInQueue = queue.some(item => {
        const isMatch = String(item.shopeeId || item.shopee_id || item.productId || '') === strId;
        const isPosted = (item.status || '').toUpperCase() === QUEUE_STATUS.POSTED;
        const isRecent = (item.posted_at || item.postedAt || item.created_at || '') >= cutoff;
        return isMatch && isPosted && isRecent;
      });

      if (postedInQueue) return true;

      // Cek pada storage log history
      const lData = await this.adapter.get([STORAGE_KEYS.LOGS, STORAGE_KEYS.HISTORY]);
      const logs = Array.isArray(lData[STORAGE_KEYS.LOGS]) ? lData[STORAGE_KEYS.LOGS] : (Array.isArray(lData[STORAGE_KEYS.HISTORY]) ? lData[STORAGE_KEYS.HISTORY] : []);
      return logs.some(log => {
        const isMatch = String(log.shopeeId || log.shopee_id || log.productId || '') === strId;
        const isPosted = (log.status || '').toUpperCase() === QUEUE_STATUS.POSTED;
        const isRecent = (log.timestamp || log.created_at || '') >= cutoff;
        return isMatch && isPosted && isRecent;
      });
    }
  }

  // =========================================================================
  // 3. UNIFIED FACADE & DATABASE MANAGER
  // =========================================================================

  /**
   * Main DatabaseManager Facade combining all repositories
   */
  class DatabaseManager {
    constructor() {
      this.STORAGE_KEYS = STORAGE_KEYS;
      this.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
      this.DEFAULT_TEMPLATES = DEFAULT_TEMPLATES;
      this.QUEUE_STATUS = QUEUE_STATUS;

      // Inisialisasi modular repositories
      this.queue = new QueueRepository(StorageAdapter);
      this.logs = new LogsRepository(StorageAdapter);
      this.history = this.logs; // Alias
      this.settings = new SettingsRepository(StorageAdapter);
      this.templates = new TemplatesRepository(StorageAdapter);
      this.products = new ProductsRepository(StorageAdapter);
    }

    // Generator ID
    uid(prefix = 'id') {
      return generateId(prefix);
    }

    generateId(prefix = 'id') {
      return generateId(prefix);
    }

    // -------------------------------------------------------------------------
    // Queue Facade Methods
    // -------------------------------------------------------------------------
    async getQueue(statusFilter = null) {
      return this.queue.getQueue(statusFilter);
    }

    async getAllQueue(statusFilter = null) {
      return this.queue.getQueue(statusFilter);
    }

    async getQueueItem(id) {
      return this.queue.getQueueItem(id);
    }

    async getQueueItemById(id) {
      return this.queue.getQueueItem(id);
    }

    async addQueueItem(item) {
      return this.queue.addQueueItem(item);
    }

    async addToQueue(item) {
      return this.queue.addQueueItem(item);
    }

    async addQueueItems(items) {
      return this.queue.addQueueItems(items);
    }

    async addBatchQueue(items) {
      return this.queue.addQueueItems(items);
    }

    async addBatchToQueue(items) {
      return this.queue.addQueueItems(items);
    }

    async updateQueueItem(id, updates = {}) {
      return this.queue.updateQueueItem(id, updates);
    }

    async updateQueueStatus(id, status, extraData = {}) {
      return this.queue.updateStatus(id, status, extraData);
    }

    async updateStatus(id, status, extraData = {}) {
      return this.queue.updateStatus(id, status, extraData);
    }

    async deleteQueueItem(id) {
      return this.queue.deleteQueueItem(id);
    }

    async deleteItem(id) {
      return this.queue.deleteQueueItem(id);
    }

    async clearQueue(statusFilter = null) {
      return this.queue.clearQueue(statusFilter);
    }

    async clearAllQueue(statusFilter = null) {
      return this.queue.clearQueue(statusFilter);
    }

    async getNextPendingQueueItem() {
      return this.queue.getNextPendingItem();
    }

    async getNextPendingItem() {
      return this.queue.getNextPendingItem();
    }

    async getQueueStats() {
      const stats = await this.queue.getStats();
      const products = await this.products.getProducts(5000);
      return {
        ...stats,
        total_products: products.length
      };
    }

    async getStats() {
      return this.getQueueStats();
    }

    // -------------------------------------------------------------------------
    // Logs / History Facade Methods
    // -------------------------------------------------------------------------
    async getHistory(limit = 200) {
      return this.logs.getLogs(limit);
    }

    async getAllLogs(limit = 200) {
      return this.logs.getLogs(limit);
    }

    async getLogs(limit = 200) {
      return this.logs.getLogs(limit);
    }

    async addLog(logItem) {
      return this.logs.addLog(logItem);
    }

    async addHistoryItem(logItem) {
      return this.logs.addLog(logItem);
    }

    async deleteLog(id) {
      return this.logs.deleteLog(id);
    }

    async clearHistory() {
      return this.logs.clearLogs();
    }

    async clearAllLogs() {
      return this.logs.clearLogs();
    }

    async clearLogs() {
      return this.logs.clearLogs();
    }

    // -------------------------------------------------------------------------
    // Settings Facade Methods
    // -------------------------------------------------------------------------
    async getSettings() {
      return this.settings.getSettings();
    }

    async getAllSettings() {
      return this.settings.getSettings();
    }

    async getSetting(key, defaultValue = null) {
      return this.settings.getSetting(key, defaultValue);
    }

    async updateSettings(settingsObj) {
      return this.settings.updateSettings(settingsObj);
    }

    async setSetting(key, value) {
      return this.settings.setSetting(key, value);
    }

    // -------------------------------------------------------------------------
    // Templates Facade Methods
    // -------------------------------------------------------------------------
    async getTemplates() {
      return this.templates.getTemplates();
    }

    async getAllTemplates() {
      return this.templates.getTemplates();
    }

    async getTemplateById(id) {
      return this.templates.getTemplateById(id);
    }

    async getDefaultTemplate() {
      return this.templates.getDefaultTemplate();
    }

    async saveTemplate(template) {
      const saved = await this.templates.saveTemplate(template);
      if (saved.is_default) {
        await this.settings.updateSettings({
          activeTemplateId: saved.id,
          active_template_id: saved.id
        });
      }
      return saved;
    }

    async deleteTemplate(id) {
      return this.templates.deleteTemplate(id);
    }

    async setDefaultTemplate(id) {
      const target = await this.templates.setDefaultTemplate(id);
      if (target) {
        await this.settings.updateSettings({
          activeTemplateId: id,
          active_template_id: id
        });
      }
      return target;
    }

    // -------------------------------------------------------------------------
    // Products Catalog Facade Methods
    // -------------------------------------------------------------------------
    async getProducts(limit = 500, offset = 0) {
      return this.products.getProducts(limit, offset);
    }

    async getProductById(id) {
      return this.products.getProductById(id);
    }

    async addProduct(product) {
      return this.products.addProduct(product);
    }

    async addProducts(productsArray) {
      return this.products.addProducts(productsArray);
    }

    async deleteProduct(id) {
      return this.products.deleteProduct(id);
    }

    async isProductPostedRecently(shopeeId, days = 7) {
      return this.products.isProductPostedRecently(shopeeId, days);
    }

    // -------------------------------------------------------------------------
    // Backup, Restore & Reset
    // -------------------------------------------------------------------------
    /**
     * Menghapus seluruh data dari storage
     * @param {boolean} [retainTemplatesAndSettings=false]
     * @returns {Promise<boolean>}
     */
    async clearAll(retainTemplatesAndSettings = false) {
      if (retainTemplatesAndSettings) {
        await StorageAdapter.set({
          [STORAGE_KEYS.QUEUE]: [],
          [STORAGE_KEYS.LOGS]: [],
          [STORAGE_KEYS.HISTORY]: [],
          [STORAGE_KEYS.PRODUCTS]: []
        });
      } else {
        await StorageAdapter.clear();
        await StorageAdapter.set({
          [STORAGE_KEYS.QUEUE]: [],
          [STORAGE_KEYS.LOGS]: [],
          [STORAGE_KEYS.HISTORY]: [],
          [STORAGE_KEYS.TEMPLATES]: JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)),
          [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS },
          [STORAGE_KEYS.PRODUCTS]: []
        });
      }
      return true;
    }

    /**
     * Mengekspor seluruh database ke format JSON object
     * @returns {Promise<Object>}
     */
    async exportDatabaseJSON() {
      const queue = await this.getQueue();
      const history = await this.getHistory(5000);
      const templates = await this.getTemplates();
      const settings = await this.getSettings();
      const products = await this.getProducts(5000);

      return {
        version: 1,
        exported_at: new Date().toISOString(),
        queue,
        history,
        logs: history,
        templates,
        settings,
        products
      };
    }

    /**
     * Mengimpor database dari JSON object
     * @param {Object} jsonData
     * @returns {Promise<boolean>}
     */
    async importDatabaseJSON(jsonData) {
      if (!jsonData || typeof jsonData !== 'object') {
        throw new Error('Data JSON backup tidak valid');
      }

      if (Array.isArray(jsonData.queue)) {
        await this.addQueueItems(jsonData.queue);
      }
      const logsArray = Array.isArray(jsonData.logs) ? jsonData.logs : (Array.isArray(jsonData.history) ? jsonData.history : null);
      if (logsArray) {
        for (const h of logsArray) {
          await this.addLog(h);
        }
      }
      if (Array.isArray(jsonData.templates)) {
        for (const t of jsonData.templates) {
          await this.saveTemplate(t);
        }
      }
      if (jsonData.settings && typeof jsonData.settings === 'object') {
        await this.updateSettings(jsonData.settings);
      }
      if (Array.isArray(jsonData.products)) {
        await this.addProducts(jsonData.products);
      }

      return true;
    }
  }

  // Create singleton instance
  const dbInstance = new DatabaseManager();

  // Export classes and instances for Node.js / CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dbInstance;
    module.exports.DB = dbInstance;
    module.exports.ShopeeDB = dbInstance;
    module.exports.DatabaseManager = DatabaseManager;
    module.exports.StorageAdapter = StorageAdapter;
    module.exports.QueueRepository = QueueRepository;
    module.exports.LogsRepository = LogsRepository;
    module.exports.SettingsRepository = SettingsRepository;
    module.exports.TemplatesRepository = TemplatesRepository;
    module.exports.ProductsRepository = ProductsRepository;
  }

  // Export to Global Scope (Content Script, Popup, Dashboard, Service Worker)
  if (root) {
    root.DB = dbInstance;
    root.ShopeeDB = dbInstance;
    root.DatabaseManager = DatabaseManager;
    root.StorageAdapter = StorageAdapter;
    root.QueueRepository = QueueRepository;
    root.LogsRepository = LogsRepository;
    root.SettingsRepository = SettingsRepository;
    root.TemplatesRepository = TemplatesRepository;
    root.ProductsRepository = ProductsRepository;
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : typeof global !== 'undefined' ? global
  : this);
