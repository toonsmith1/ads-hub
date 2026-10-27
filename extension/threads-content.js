/**
 * @file threads-content.js
 * @description Threads Web Content Script, Post Automator, Item Selector & Carousel Controller Widget
 * 
 * Target: https://www.threads.net and https://threads.net
 * Clean Architecture Modular Design:
 * 1. ThreadsDOM: DOM Queries, Composer Modal, Button Interaction & Session Detector.
 * 2. ThreadsMedia: Multi-Image Attachment, File Conversion & Drag-and-Drop / File Input Injection.
 * 3. ThreadsEditor: Text Input Simulation (Paste + execCommand + InputEvent).
 * 4. ThreadsToastObserver: Toast MutationObserver for Live Thread Link Detection.
 * 5. ThreadsPostController: Full Posting Lifecycle Orchestrator.
 * 6. ThreadsQueueSyncService: Real-Time Queue & Settings Synchronization Service (chrome.storage.onChanged).
 * 7. ThreadsWidgetController: Interactive Floating Widget, Queue Dropdown Selector, Carousel Controller & Caption Editor.
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root) {
  'use strict';

  if (typeof window !== 'undefined' && window.__THREADS_CONTENT_INITIALIZED__) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__THREADS_CONTENT_INITIALIZED__ = true;
    window.__THREADS_AUTOPOST_INITIALIZED__ = true;
  }

  // ==========================================================================
  // LOGGER INTEGRATION & SAFE FALLBACK
  // ==========================================================================
  const Logger = (typeof root !== 'undefined' && root.Logger) ||
                 (typeof window !== 'undefined' && window.Logger) || {
                   debug: (tag, msg, meta) => console.log(`[DEBUG][${tag}] ${msg}`, meta !== undefined && meta !== null ? meta : ''),
                   info: (tag, msg, meta) => console.log(`[INFO][${tag}] ${msg}`, meta !== undefined && meta !== null ? meta : ''),
                   dom: (msg, meta) => console.log(`[DOM] ${msg}`, meta !== undefined && meta !== null ? meta : ''),
                   success: (tag, msg, meta) => console.log(`[SUCCESS][${tag}] ${msg}`, meta !== undefined && meta !== null ? meta : ''),
                   warn: (tag, msg, meta) => console.warn(`[WARN][${tag}] ${msg}`, meta !== undefined && meta !== null ? meta : ''),
                   error: (tag, msg, meta) => console.error(`[ERROR][${tag}] ${msg}`, meta !== undefined && meta !== null ? meta : ''),
                   log: (lvl, tag, msg, meta) => console.log(`[${lvl}][${tag}] ${msg}`, meta !== undefined && meta !== null ? meta : '')
                 };

  Logger.info('ThreadsContent', 'Shopee Affiliate Threads Content Script & Carousel Controller Ready! 🧵✨');

  // ==========================================================================
  // CONSTANTS & FALLBACKS (Aligned with libs/constants.js & libs/db.js)
  // ==========================================================================

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
    notification: true
  };

  /**
   * Normalisasi struktur item antrean (konsisten 100% dengan libs/db.js)
   * @param {Object} raw
   * @returns {Object}
   */
  function normalizeQueueItem(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const id = raw.id || `queue_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
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

  // ==========================================================================
  // 1. ThreadsDOM - DOM Queries, Composer Modal & Button Interaction Service
  // ==========================================================================
  class ThreadsDOM {
    /**
     * Cek apakah user sedang login di Threads Web
     * @returns {{isLoggedIn: boolean, url: string}}
     */
    static checkLoginStatus() {
      Logger.debug('ThreadsDOM', 'Memeriksa status login Threads Web...', { url: window.location.href });
      const loginLink = document.querySelector('a[href*="/login"]');
      const composerTrigger = Array.from(document.querySelectorAll('[role="button"]'))
        .find(btn => btn.textContent?.includes('Utas baru') 
                  || btn.textContent?.includes('New thread') 
                  || btn.querySelector('svg[aria-label="Utas baru"]') 
                  || btn.querySelector('svg[aria-label="New thread"]')
                  || btn.getAttribute('aria-label')?.includes('Utas')
                  || btn.getAttribute('aria-label')?.includes('thread'));

      const hasProfile = !!document.querySelector('a[href*="/@"], a[aria-label*="Profil"], a[aria-label*="Profile"]');
      const isLoggedIn = !loginLink && (!!composerTrigger || hasProfile);

      Logger.dom(`[Session Check] Status login: ${isLoggedIn ? 'LOGGED_IN' : 'NOT_LOGGED_IN'} (loginLink: ${!!loginLink}, composerTrigger: ${!!composerTrigger}, hasProfile: ${hasProfile})`);

      return {
        isLoggedIn,
        url: window.location.href
      };
    }

    /**
     * Mengambil modal composer dialog jika sedang terbuka
     * @returns {HTMLElement|null}
     */
    static getComposerDialog() {
      Logger.dom('Querying selector modal: div[role="dialog"]');
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        Logger.dom('Modal dialog div[role="dialog"] ditemukan.', { element: dialog.tagName, role: dialog.getAttribute('role') });
      } else {
        Logger.dom('Modal dialog div[role="dialog"] tidak ditemukan di DOM saat ini.');
      }
      return dialog;
    }

    /**
     * Membuka modal composer jika belum terbuka
     * @returns {Promise<HTMLElement|null>}
     */
    static async openComposerModal() {
      Logger.info('ThreadsDOM', 'Membuka modal composer Threads...');
      let dialog = this.getComposerDialog();
      if (!dialog) {
        Logger.dom('Querying selector tombol "Utas baru" / "New thread" / [role="button"]...');
        const tombolUtasBaru = Array.from(document.querySelectorAll('[role="button"]'))
          .find(btn => {
            const t = (btn.textContent || '').toLowerCase();
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            const svgLabel = (btn.querySelector('svg')?.getAttribute('aria-label') || '').toLowerCase();
            return t.includes('utas baru') || t.includes('new thread') || t.includes('buat') 
                || label.includes('utas baru') || label.includes('new thread') || label.includes('create')
                || svgLabel.includes('utas baru') || svgLabel.includes('new thread');
          });

        if (tombolUtasBaru) {
          Logger.dom('Tombol trigger "Utas baru" / "New thread" ditemukan di DOM.', {
            text: (tombolUtasBaru.textContent || '').trim(),
            ariaLabel: tombolUtasBaru.getAttribute('aria-label')
          });
          tombolUtasBaru.click();
          Logger.dom('Dispatched click event pada tombol "Utas baru". Menunggu rendering modal (1200ms)...');
          await new Promise(r => setTimeout(r, 1200));
        } else {
          Logger.warn('ThreadsDOM', 'Tombol trigger "Utas baru" tidak ditemukan di DOM!');
        }
        dialog = this.getComposerDialog();
      }

      if (dialog) {
        Logger.dom('Modal composer dialog div[role="dialog"] siap digunakan.');
      } else {
        Logger.error('ThreadsDOM', 'Gagal memunculkan modal composer dialog!');
      }

      return dialog;
    }

    /**
     * Mengambil elemen area teks contenteditable
     * @param {HTMLElement} dialog
     * @returns {HTMLElement|null}
     */
    static getTextEditor(dialog) {
      Logger.dom('Querying selector editor teks: [contenteditable="true"]');
      const editor = (dialog || document).querySelector('[contenteditable="true"]');
      if (editor) {
        Logger.dom('Editor teks [contenteditable="true"] ditemukan.', {
          tagName: editor.tagName,
          ariaLabel: editor.getAttribute('aria-label') || 'none',
          role: editor.getAttribute('role') || 'none'
        });
      } else {
        Logger.dom('Editor teks [contenteditable="true"] TIDAK ditemukan!');
      }
      return editor;
    }

    /**
     * Mengambil tombol Kirim / Post
     * @param {HTMLElement} dialog
     * @returns {HTMLElement|null}
     */
    static getSubmitButton(dialog) {
      const xpath = "/html/body/div[3]/div/div/div[3]/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/div/div/div/div[4]/div/div[1]/div";
      Logger.dom('Querying selector submit button via primary XPath: ' + xpath);
      let submitBtn = null;
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        submitBtn = result.singleNodeValue;
      } catch (e) {
        Logger.dom('XPath query evaluasi error: ' + e.message);
      }

      if (submitBtn) {
        Logger.dom('Submit button ditemukan melalui primary XPath.', {
          text: (submitBtn.textContent || '').trim()
        });
      } else {
        Logger.dom('Submit button XPath null, menjalankan query fallback selector [role="button"] ("kirim" / "post" / "posting")...');
        submitBtn = Array.from((dialog || document).querySelectorAll('[role="button"]'))
          .find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            return t === 'kirim' || t === 'post' || t === 'posting';
          });

        if (submitBtn) {
          Logger.dom(`Submit button ditemukan melalui fallback button text: "${(submitBtn.textContent || '').trim()}"`);
        } else {
          Logger.dom('Submit button TIDAK ditemukan pada dialog maupun document!');
        }
      }

      return submitBtn;
    }

    /**
     * Melakukan dispatch event klik mouse & pointer secara lengkap
     * @param {HTMLElement} submitBtn
     */
    static clickSubmitButton(submitBtn) {
      if (!submitBtn) {
        Logger.error('ThreadsDOM', 'clickSubmitButton dipanggil dengan submitBtn bernilai null');
        return;
      }

      Logger.dom('Menjalankan dispatch event sequence ke submit button: pointerdown -> mousedown -> pointerup -> mouseup -> click...');
      const clickOpts = { bubbles: true, cancelable: true, view: window };
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', clickOpts));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', clickOpts));
      submitBtn.dispatchEvent(new PointerEvent('pointerup', clickOpts));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', clickOpts));
      submitBtn.dispatchEvent(new MouseEvent('click', clickOpts));
      if (typeof submitBtn.click === 'function') {
        submitBtn.click();
      }
      Logger.dom('Submit button event sequence selesai di-dispatch.');
    }
  }

  // ==========================================================================
  // 2. ThreadsMedia - Image Attachment & File Injection Service
  // ==========================================================================
  class ThreadsMedia {
    /**
     * Konversi daftar URL gambar menjadi Array File Object
     * @param {Array<string|File>} rawImages
     * @returns {Promise<File[]>}
     */
    static async fetchFilesFromUrls(rawImages) {
      if (!rawImages || !Array.isArray(rawImages) || rawImages.length === 0) {
        return [];
      }

      const files = [];
      const maxImages = Math.min(rawImages.length, 5);

      for (let i = 0; i < maxImages; i++) {
        const item = rawImages[i];
        if (!item) continue;

        if (typeof File !== 'undefined' && item instanceof File) {
          files.push(item);
          continue;
        }

        if (typeof item === 'string' && (item.startsWith('http://') || item.startsWith('https://') || item.startsWith('blob:') || item.startsWith('data:'))) {
          try {
            Logger.dom(`[ThreadsMedia] Mengunduh gambar produk (${i + 1}/${maxImages}): ${item.substring(0, 60)}...`);
            const res = await fetch(item);
            if (!res.ok) {
              Logger.warn('ThreadsMedia', `HTTP ${res.status} saat fetch gambar: ${item}`);
              continue;
            }
            const blob = await res.blob();
            const ext = blob.type && blob.type.includes('png') ? 'png' : 'jpg';
            const filename = `shopee_product_${Date.now()}_${i + 1}.${ext}`;
            const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
            files.push(file);
          } catch (e) {
            Logger.warn('ThreadsMedia', `Gagal mengunduh gambar [${item}]: ${e.message}`);
          }
        }
      }

      return files;
    }

    /**
     * Injeksi file gambar ke input file Threads
     * @param {HTMLElement} dialog
     * @param {string[]} imageUrls
     * @returns {Promise<boolean>}
     */
    static async attachImageFiles(dialog, imageUrls) {
      if (!imageUrls || imageUrls.length === 0) {
        Logger.debug('ThreadsMedia', 'Tidak ada URL gambar yang perlu diunggah.');
        return false;
      }

      Logger.info('ThreadsMedia', `Memulai injeksi ${imageUrls.length} file gambar ke Threads...`);

      try {
        Logger.dom('Querying selector input file: input[type="file"][accept*="image"], input[type="file"]');
        const fileInput = (dialog || document).querySelector('input[type="file"][accept*="image"], input[type="file"]');
        if (!fileInput) {
          Logger.warn('ThreadsMedia', 'File input element tidak ditemukan pada dialog Threads!');
          return false;
        }
        Logger.dom('File input element ditemukan di DOM.');

        const files = await ThreadsMedia.fetchFilesFromUrls(imageUrls);

        if (files.length > 0) {
          const dt = new DataTransfer();
          files.forEach(f => dt.items.add(f));
          Logger.dom(`DataTransfer file count: ${dt.files.length} file(s) berhasil dimuat ke DataTransfer.`);

          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));

          Logger.dom('Event change dan input berhasil di-dispatch ke file input. Menunggu thumbnail render (2000ms)...');
          // Tunggu thumbnail media selesai ter-render di Threads
          await new Promise(r => setTimeout(r, 2000));
          Logger.info('ThreadsMedia', `Injeksi ${files.length} media selesai.`);
          return true;
        } else {
          Logger.warn('ThreadsMedia', 'Tidak ada file gambar yang berhasil diproses ke DataTransfer.');
        }
      } catch (err) {
        Logger.error('ThreadsMedia', `Error saat upload gambar: ${err.message}`, { stack: err.stack });
      }
      return false;
    }
  }

  // ==========================================================================
  // 3. ThreadsEditor - Text Input Simulation (Paste + execCommand + InputEvent)
  // ==========================================================================
  class ThreadsEditor {
    /**
     * Simulasi input teks caption ke dalam contenteditable
     * @param {HTMLElement} editor
     * @param {string} text
     */
    static async insertCaption(editor, text) {
      if (!editor) {
        const errMsg = "Area teks editor contenteditable tidak ditemukan pada dialog Threads!";
        Logger.error('ThreadsEditor', errMsg);
        throw new Error(errMsg);
      }

      Logger.info('ThreadsEditor', `Memulai simulasi pengisian teks caption (${text.length} karakter)...`);

      // 1. Focus event
      editor.focus();
      Logger.dom('Focus event di-trigger pada editor [contenteditable="true"]');

      // 2. ClipboardEvent paste
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        Logger.dom('ClipboardEvent "paste" di-dispatch dengan DataTransfer plain text payload.');
      } catch (e) {
        Logger.warn('ThreadsEditor', 'ClipboardEvent dispatch fallback: ' + e.message);
      }

      // 3. insertText execCommand
      document.execCommand('selectAll', false, null);
      const execSuccess = document.execCommand('insertText', false, text);
      Logger.dom(`document.execCommand("insertText") dieksekusi (success: ${execSuccess}).`);

      // 4. Input event payload
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
      Logger.dom(`InputEvent "input" di-dispatch (inputType: "insertText", payload data length: ${text.length} chars).`);

      await new Promise(r => setTimeout(r, 1200));
      Logger.info('ThreadsEditor', 'Pengisian teks caption berhasil diselesaikan.');
    }
  }

  // ==========================================================================
  // 4. ThreadsToastObserver - Toast Observer for Link Detection
  // ==========================================================================
  class ThreadsToastObserver {
    /**
     * MutationObserver & polling fallback (250ms) untuk menangkap link postingan resmi dari notifikasi toast
     * @param {number} timeoutMs
     * @returns {Promise<string|null>}
     */
    static waitForPostUrl(timeoutMs = 12000) {
      Logger.info('ThreadsToastObserver', `Menghubungkan Toast MutationObserver & Polling 250ms (timeout: ${timeoutMs}ms)...`);
      return new Promise((resolve) => {
        let isResolved = false;
        let observer = null;
        let poller = null;

        const cleanup = () => {
          if (observer) {
            try { observer.disconnect(); } catch (e) {}
            observer = null;
          }
          if (poller) {
            clearInterval(poller);
            poller = null;
          }
        };

        const checkToast = () => {
          if (isResolved) return true;
          const toastLink = typeof document !== 'undefined' && document.querySelector
            ? document.querySelector('div[role="status"] a[href*="/post/"], [role="status"] a[href*="/post/"], a[href*="threads.net/@"][href*="/post/"]')
            : null;
          if (toastLink && toastLink.href) {
            isResolved = true;
            const capturedUrl = toastLink.href;
            Logger.dom(`Toast matching href [role="status"] a[href*="/post/"] terdeteksi!`, {
              capturedPostUrl: capturedUrl,
              text: (toastLink.textContent || '').trim()
            });
            cleanup();
            Logger.dom('Toast MutationObserver / Poller disconnected.');
            resolve(capturedUrl);
            return true;
          }
          return false;
        };

        // 1. Immediate check
        if (checkToast()) return;

        // 2. MutationObserver
        if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
          try {
            observer = new MutationObserver(() => {
              checkToast();
            });
            observer.observe(document.body, { childList: true, subtree: true });
            Logger.dom('Toast MutationObserver connected: memantau document.body subtree untuk [role="status"] a[href*="/post/"]');
          } catch (err) {
            Logger.warn('ThreadsToastObserver', 'MutationObserver init fallback: ' + err.message);
          }
        }

        // 3. Polling fallback 250ms
        poller = setInterval(() => {
          checkToast();
        }, 250);

        // 4. Timeout
        setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            Logger.dom(`Toast observer timeout setelah ${timeoutMs}ms (link notifikasi tidak tertangkap).`);
            resolve(null);
          }
        }, timeoutMs);
      });
    }
  }

  // ==========================================================================
  // 5. postingThreads - Core Posting Engine
  // ==========================================================================
  async function postingThreads(teks, imageFiles = []) {
    const startTime = Date.now();
    const textContent = typeof teks === 'object' && teks !== null ? (teks.caption || teks.title || '') : (teks || '');
    const imagesToProcess = typeof teks === 'object' && teks !== null
      ? (teks.imageUrls || (teks.primaryImage ? [teks.primaryImage] : []))
      : (imageFiles || []);

    console.log("⏳ Membuka form Utas Baru...");

    // 1. Buka popup modal jika belum terbuka
    let dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) {
      const tombolUtasBaru = Array.from(document.querySelectorAll('[role="button"]'))
        .find(btn => btn.textContent?.includes('Utas baru') || btn.querySelector('svg[aria-label="Utas baru"]'));

      if (tombolUtasBaru) {
        tombolUtasBaru.click();
        await new Promise(r => setTimeout(r, 1000));
      }
      dialog = document.querySelector('div[role="dialog"]');
    }

    // 1.5. Jika ada file gambar/foto produk Shopee, inject ke input file jika tersedia
    if (imagesToProcess && imagesToProcess.length > 0) {
      try {
        const fileInput = (dialog || document).querySelector('input[type="file"][accept*="image"]');
        if (fileInput) {
          // Siapkan File objects (konversi URL jika diberikan string)
          let preparedFiles = [];
          for (let i = 0; i < imagesToProcess.length; i++) {
            const item = imagesToProcess[i];
            if (typeof File !== 'undefined' && item instanceof File) {
              preparedFiles.push(item);
            } else if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('blob:') || item.startsWith('data:'))) {
              try {
                const res = await fetch(item);
                if (res.ok) {
                  const blob = await res.blob();
                  const ext = blob.type && blob.type.includes('png') ? 'png' : 'jpg';
                  preparedFiles.push(new File([blob], `shopee_product_${Date.now()}_${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
                }
              } catch (_) {}
            }
          }
          if (preparedFiles.length === 0 && imagesToProcess.length > 0) {
            preparedFiles = imagesToProcess;
          }

          const dt = new DataTransfer();
          preparedFiles.forEach(f => {
            try { dt.items.add(f); } catch (_) {}
          });
          if (dt.files.length > 0) {
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 1200));
          }
        }
      } catch (_) {}
    }

    // 2. Cari area editor teks
    const editor = (dialog || document).querySelector('[contenteditable="true"]');
    if (!editor) {
      console.error("❌ Area teks editor tidak ditemukan!");
      return { success: false, error: "Area teks editor tidak ditemukan!", timeTakenMs: Date.now() - startTime };
    }

    // 3. Masukkan teks ke editor
    editor.focus();
    
    // Simulasi Paste & Input
    const dt = new DataTransfer();
    dt.setData('text/plain', textContent);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));

    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, textContent);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: textContent }));

    console.log("✍️ Teks berhasil diisi!");
    await new Promise(r => setTimeout(r, 1000)); // Tunggu tombol Kirim aktif

    // 4. Cari tombol Kirim lewat XPath (dengan fallback text 'Kirim')
    const xpath = "/html/body/div[3]/div/div/div[3]/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/div/div/div/div[4]/div/div[1]/div";
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    let submitBtn = result.singleNodeValue;

    // Fallback jika div indeks berubah sedikit
    if (!submitBtn) {
      submitBtn = Array.from((dialog || document).querySelectorAll('[role="button"]'))
        .find(b => b.textContent?.trim() === 'Kirim' || b.textContent?.trim() === 'Post');
    }

    if (!submitBtn) {
      console.error("❌ Tombol Kirim lewat XPath tidak ditemukan!");
      return { success: false, error: "Tombol Kirim tidak ditemukan", timeTakenMs: Date.now() - startTime };
    }

    // 5. Siapkan penangkap link notifikasi Toast ("Diposting -> Lihat")
    const tungguToastLink = new Promise((resolve) => {
      let checkInterval = null;
      let observer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (checkInterval) clearInterval(checkInterval);
      };

      const cariLink = () => {
        const toastLink = document.querySelector('[role="status"] a[href*="/post/"], div[aria-live="polite"] a[href*="/post/"]');
        if (toastLink && toastLink.href) {
          cleanup();
          resolve(toastLink.href);
          return true;
        }
        return false;
      };

      observer = new MutationObserver(() => {
        cariLink();
      });

      observer.observe(document.body, { childList: true, subtree: true });
      checkInterval = setInterval(cariLink, 250);

      // Batas waktu timeout 10 detik
      setTimeout(() => {
        cleanup();
        resolve(null);
      }, 10000);
    });

    console.log("🔘 Tombol Kirim ditemukan via XPath, langsung klik...");

    // 6. Eksekusi klik penuh
    const clickOpts = { bubbles: true, cancelable: true, view: window };
    submitBtn.dispatchEvent(new PointerEvent('pointerdown', clickOpts));
    submitBtn.dispatchEvent(new MouseEvent('mousedown', clickOpts));
    submitBtn.dispatchEvent(new PointerEvent('pointerup', clickOpts));
    submitBtn.dispatchEvent(new MouseEvent('mouseup', clickOpts));
    submitBtn.dispatchEvent(new MouseEvent('click', clickOpts));
    if (typeof submitBtn.click === 'function') submitBtn.click();

    console.log("🚀 Postingan dikirim! Menunggu toast link notifikasi...");

    // 7. Ambil URL Postingan dari toast
    const postUrl = await tungguToastLink;
    const timeTakenMs = Date.now() - startTime;

    if (postUrl) {
      console.log("🎉 SUKSES DIPOSTING!");
      console.log("🔗 Link Postingan Kamu:", postUrl);
      return { success: true, postUrl, timeTakenMs, message: 'Berhasil diposting ke Threads!' };
    } else {
      console.log("✅ Berhasil dikirim, lek! (Link toast tidak tertangkap dalam batas waktu)");
      return { success: true, postUrl: "https://www.threads.net", timeTakenMs, message: 'Postingan terkirim.' };
    }
  }

  // ==========================================================================
  // 5.5. ThreadsPostController - Orchestrator for 1-by-1 Posting Lifecycle
  // ==========================================================================
  class ThreadsPostController {
    static isPosting = false;

    /**
     * Orchestrator utama proses posting ke Threads (1 item by 1 item)
     * @param {Object} itemData
     * @returns {Promise<{success: boolean, postUrl: string, timeTakenMs: number, message: string, error?: string}>}
     */
    static async post(itemData) {
      if (ThreadsPostController.isPosting) {
        const warnMsg = "⚠️ Sedang ada proses posting yang berjalan. Harap tunggu hingga selesai (1 item by 1 item).";
        console.warn(`[ThreadsPostController] ${warnMsg}`);
        return {
          success: false,
          error: warnMsg,
          timeTakenMs: 0
        };
      }

      ThreadsPostController.isPosting = true;
      const startTime = Date.now();

      try {
        if (!itemData || typeof itemData !== 'object') {
          throw new Error('Data item posting tidak valid!');
        }

        const teks = (itemData.caption || itemData.title || itemData.caption_threads || itemData.caption_text || '').trim();
        if (!teks) {
          throw new Error('Teks caption posting kosong!');
        }

        console.log(`🚀 [ThreadsPostController] Memulai posting 1 item: "${itemData.title || 'Untitled'}" (ID: ${itemData.id || '-'})`);

        // Kumpulkan daftar gambar (URL atau File)
        let rawImages = [];
        if (Array.isArray(itemData.imageFiles) && itemData.imageFiles.length > 0) {
          rawImages = itemData.imageFiles;
        } else if (Array.isArray(itemData.images) && itemData.images.length > 0) {
          rawImages = itemData.images;
        } else if (Array.isArray(itemData.imageUrls) && itemData.imageUrls.length > 0) {
          rawImages = itemData.imageUrls;
        } else if (Array.isArray(itemData.image_urls) && itemData.image_urls.length > 0) {
          rawImages = itemData.image_urls;
        } else if (itemData.primaryImage || itemData.imageUrl) {
          rawImages = [itemData.primaryImage || itemData.imageUrl];
        }

        // Siapkan File objects jika ada gambar
        let imageFiles = [];
        if (rawImages.length > 0) {
          console.log(`🖼️ [ThreadsPostController] Menyiapkan ${rawImages.length} file gambar untuk posting...`);
          imageFiles = await ThreadsMedia.fetchFilesFromUrls(rawImages);
        }

        // Eksekusi engine postingThreads inti
        const result = await postingThreads(teks, imageFiles);
        const timeTakenMs = Date.now() - startTime;

        if (result && result.success) {
          console.log(`✅ [ThreadsPostController] Selesai posting item: "${itemData.title || 'Untitled'}" (${timeTakenMs}ms). Link: ${result.postUrl}`);
          return {
            success: true,
            postUrl: result.postUrl || 'https://www.threads.net',
            timeTakenMs,
            message: 'Postingan berhasil dipublikasikan ke Threads!'
          };
        } else {
          const errorMsg = result?.error || 'Gagal memposting ke Threads';
          console.error(`❌ [ThreadsPostController] Gagal memposting item: ${errorMsg}`);
          return {
            success: false,
            error: errorMsg,
            timeTakenMs
          };
        }
      } catch (err) {
        const timeTakenMs = Date.now() - startTime;
        console.error(`❌ [ThreadsPostController] Exception saat posting: ${err.message}`, err);
        return {
          success: false,
          error: err.message,
          timeTakenMs
        };
      } finally {
        ThreadsPostController.isPosting = false;
      }
    }

    /**
     * Mendaftarkan listener pesan runtime dari Background Service Worker / Popup / Panel
     */
    static initMessageListener() {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
          if (!request) return;

          if (request.action === 'CHECK_THREADS_SESSION') {
            console.log('[ThreadsPostController] Menerima pesan CHECK_THREADS_SESSION');
            sendResponse(ThreadsDOM.checkLoginStatus());
            return true;
          }

          if (
            request.action === 'EXECUTE_POST_NOW' ||
            request.action === 'POST_SINGLE_ITEM' ||
            request.action === 'INJECT_POST_PAYLOAD' ||
            request.action === 'POST_NOW' ||
            request.action === 'POST_NEXT_ITEM'
          ) {
            const item = request.item || request.product || request.payload || {};
            console.log(`📨 [ThreadsPostController] Menerima instruksi posting item (Action: ${request.action}): "${item.title || 'Untitled'}"`);

            // Eksekusi satu per satu (1 item by 1 item)
            ThreadsPostController.post(item)
              .then((result) => {
                sendResponse({
                  success: result.success,
                  postUrl: result.postUrl,
                  timeTakenMs: result.timeTakenMs,
                  message: result.message || (result.success ? 'Berhasil diposting ke Threads!' : result.error),
                  error: result.error
                });
              })
              .catch((err) => {
                console.error(`❌ [ThreadsPostController] Error listener message: ${err.message}`);
                sendResponse({
                  success: false,
                  error: err.message || 'Terjadi kesalahan saat memposting di Threads'
                });
              });

            return true; // Keep message channel open for async response
          }

          return true;
        });
      }
    }
  }

  // ==========================================================================
  // 6. ThreadsQueueSyncService - Real-Time Queue Synchronization Service
  // ==========================================================================
  class ThreadsQueueSyncService {
    constructor() {
      this.queue = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.templates = [];
      this.subscribers = new Set();
      this.isInitialized = false;
      this.isListening = false;
      this.storageKeyQueue = STORAGE_KEYS.QUEUE;
      this.storageKeySettings = STORAGE_KEYS.SETTINGS;
      this.storageKeyTemplates = STORAGE_KEYS.TEMPLATES;

      if (!ThreadsQueueSyncService._instance) {
        ThreadsQueueSyncService._instance = this;
      }

      this.setupStorageListener();
    }

    static getInstance() {
      if (!ThreadsQueueSyncService._instance) {
        ThreadsQueueSyncService._instance = new ThreadsQueueSyncService();
      }
      return ThreadsQueueSyncService._instance;
    }

    async init() {
      await this.loadAll();
      this.isInitialized = true;
      return this;
    }

    async loadAll() {
      const data = await this._getStorageData([
        this.storageKeyQueue,
        this.storageKeySettings,
        this.storageKeyTemplates,
        'isQueueRunning'
      ]);

      const rawQueue = Array.isArray(data[this.storageKeyQueue]) ? data[this.storageKeyQueue] : [];
      this.queue = rawQueue.map(normalizeQueueItem).filter(Boolean);

      const rawSettings = data[this.storageKeySettings] || {};
      this.settings = {
        ...DEFAULT_SETTINGS,
        ...rawSettings,
        isQueueRunning: (data.isQueueRunning !== undefined) ? Boolean(data.isQueueRunning) : Boolean(rawSettings.isQueueRunning)
      };

      this.templates = Array.isArray(data[this.storageKeyTemplates]) ? data[this.storageKeyTemplates] : [];

      const stats = this.getStats();
      this._notifySubscribers('init', {
        queue: this.queue,
        settings: this.settings,
        templates: this.templates,
        stats
      });

      return {
        queue: this.queue,
        settings: this.settings,
        templates: this.templates,
        stats
      };
    }

    async loadQueue() {
      const data = await this._getStorageData([this.storageKeyQueue]);
      const rawQueue = Array.isArray(data[this.storageKeyQueue]) ? data[this.storageKeyQueue] : [];
      this.queue = rawQueue.map(normalizeQueueItem).filter(Boolean);
      return this.queue;
    }

    setupStorageListener() {
      if (this.isListening) return;
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        let queueChanged = false;
        let settingsChanged = false;

        if (changes[this.storageKeyQueue]) {
          const raw = Array.isArray(changes[this.storageKeyQueue].newValue)
            ? changes[this.storageKeyQueue].newValue
            : [];
          this.queue = raw.map(normalizeQueueItem).filter(Boolean);
          queueChanged = true;
        }

        if (changes[this.storageKeySettings]) {
          this.settings = {
            ...this.settings,
            ...(changes[this.storageKeySettings].newValue || {})
          };
          settingsChanged = true;
        }

        if (changes.isQueueRunning !== undefined) {
          this.settings.isQueueRunning = Boolean(changes.isQueueRunning.newValue);
          settingsChanged = true;
        }

        if (changes[this.storageKeyTemplates]) {
          this.templates = Array.isArray(changes[this.storageKeyTemplates].newValue)
            ? changes[this.storageKeyTemplates].newValue
            : [];
        }

        if (queueChanged) {
          const stats = this.getStats();
          this._notifySubscribers('queue_updated', {
            queue: this.queue,
            stats,
            currentItem: this.getCurrentItem(),
            nextItem: this.getNextItem(),
            pendingItems: this.getPendingItems(),
            change: changes[this.storageKeyQueue]
          });

          this._dispatchDOMEvent('threads-queue-updated', {
            queue: this.queue,
            stats,
            currentItem: this.getCurrentItem(),
            nextItem: this.getNextItem(),
            pendingItems: this.getPendingItems()
          });
        }

        if (settingsChanged) {
          this._notifySubscribers('settings_updated', {
            settings: this.settings,
            change: changes[this.storageKeySettings]
          });

          this._dispatchDOMEvent('threads-settings-updated', {
            settings: this.settings
          });
        }
      });

      this.isListening = true;
    }

    getAllItems() {
      return [...this.queue];
    }

    getQueue() {
      return this.getAllItems();
    }

    getPendingItems() {
      return this.queue.filter(item => {
        const s = (item.status || '').toUpperCase();
        return s === QUEUE_STATUS.PENDING;
      });
    }

    getCurrentItem() {
      const postingItem = this.queue.find(item => {
        const s = (item.status || '').toUpperCase();
        return s === QUEUE_STATUS.POSTING || s === 'PROCESSING';
      });
      if (postingItem) return { ...postingItem };

      const pendingItems = this.getPendingItems();
      return pendingItems.length > 0 ? { ...pendingItems[0] } : null;
    }

    getNextItem() {
      const pendingItems = this.getPendingItems();
      const current = this.getCurrentItem();

      if (!current) {
        return pendingItems.length > 0 ? { ...pendingItems[0] } : null;
      }

      if ((current.status || '').toUpperCase() === QUEUE_STATUS.POSTING || (current.status || '').toUpperCase() === 'PROCESSING') {
        return pendingItems.length > 0 ? { ...pendingItems[0] } : null;
      }

      const currentIndex = pendingItems.findIndex(it => it.id === current.id);
      if (currentIndex >= 0 && currentIndex + 1 < pendingItems.length) {
        return { ...pendingItems[currentIndex + 1] };
      }

      return null;
    }

    getItemById(id) {
      if (!id) return null;
      const targetId = String(id);
      const found = this.queue.find(item => 
        String(item.id) === targetId ||
        String(item.productId) === targetId ||
        String(item.product_id) === targetId ||
        String(item.shopeeId) === targetId ||
        String(item.shopee_id) === targetId
      );
      return found ? { ...found } : null;
    }

    getStats() {
      const total = this.queue.length;
      const pending = this.queue.filter(q => (q.status || '').toUpperCase() === QUEUE_STATUS.PENDING).length;
      const posting = this.queue.filter(q => {
        const s = (q.status || '').toUpperCase();
        return s === QUEUE_STATUS.POSTING || s === 'PROCESSING';
      }).length;
      const posted = this.queue.filter(q => (q.status || '').toUpperCase() === QUEUE_STATUS.POSTED).length;
      const failed = this.queue.filter(q => (q.status || '').toUpperCase() === QUEUE_STATUS.FAILED).length;

      const todayStr = new Date().toISOString().substring(0, 10);
      const postedToday = this.queue.filter(q => {
        const isPosted = (q.status || '').toUpperCase() === QUEUE_STATUS.POSTED;
        const postDate = (q.posted_at || q.postedAt || '');
        return isPosted && postDate.startsWith(todayStr);
      }).length;

      return {
        total,
        pending,
        posting,
        processing: posting,
        posted,
        failed,
        postedToday,
        posted_today: postedToday,
        isQueueRunning: Boolean(this.settings.isQueueRunning)
      };
    }

    async markItemPosting(id) {
      return this.updateItemStatus(id, QUEUE_STATUS.POSTING);
    }

    async markItemPosted(id, postUrl = null) {
      const now = new Date().toISOString();
      const updates = {
        status: QUEUE_STATUS.POSTED,
        postedAt: now,
        posted_at: now,
        threadsUrl: postUrl || 'https://www.threads.net',
        threads_url: postUrl || 'https://www.threads.net',
        error: null,
        errorMessage: null
      };

      const updatedItem = await this.updateItem(id, updates);

      await this._recordLog({
        id: `log_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`,
        productId: updatedItem.productId || updatedItem.product_id || '',
        title: updatedItem.title || '',
        price: updatedItem.price || '',
        shortLink: updatedItem.shortLink || updatedItem.short_link || '',
        threadsUrl: updatedItem.threadsUrl || updatedItem.threads_url || '',
        status: QUEUE_STATUS.POSTED,
        timestamp: now
      });

      return updatedItem;
    }

    async markItemFailed(id, errorMessage = 'Gagal memposting ke Threads') {
      const item = this.getItemById(id);
      const retryCount = item ? ((item.retryCount || item.retry_count || 0) + 1) : 1;
      const now = new Date().toISOString();

      const updates = {
        status: QUEUE_STATUS.FAILED,
        error: errorMessage,
        errorMessage: errorMessage,
        retryCount: retryCount,
        retry_count: retryCount,
        updatedAt: now,
        updated_at: now
      };

      const updatedItem = await this.updateItem(id, updates);

      await this._recordLog({
        id: `log_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`,
        productId: updatedItem.productId || updatedItem.product_id || '',
        title: updatedItem.title || '',
        price: updatedItem.price || '',
        shortLink: updatedItem.shortLink || updatedItem.short_link || '',
        threadsUrl: null,
        status: QUEUE_STATUS.FAILED,
        error: errorMessage,
        timestamp: now
      });

      return updatedItem;
    }

    async updateItem(id, updates = {}) {
      if (!id) throw new Error('ID antrean wajib diisi');

      const idx = this.queue.findIndex(it => String(it.id) === String(id));
      if (idx === -1) {
        throw new Error(`Item dengan ID '${id}' tidak ditemukan di antrean`);
      }

      const current = this.queue[idx];
      const now = new Date().toISOString();
      const merged = normalizeQueueItem({
        ...current,
        ...updates,
        updated_at: now,
        updatedAt: now
      });

      this.queue[idx] = merged;

      await this._setStorageData({
        [this.storageKeyQueue]: this.queue
      });

      const stats = this.getStats();

      this._notifySubscribers('item_updated', {
        item: merged,
        queue: this.queue,
        stats
      });

      this._dispatchDOMEvent('threads-queue-updated', {
        queue: this.queue,
        stats,
        item: merged
      });

      return merged;
    }

    async deleteItem(id) {
      if (!id) return false;

      this.queue = this.queue.filter(it => String(it.id) !== String(id));
      await this._setStorageData({ [this.storageKeyQueue]: this.queue });

      const stats = this.getStats();
      this._notifySubscribers('queue_updated', {
        queue: this.queue,
        stats
      });

      this._dispatchDOMEvent('threads-queue-updated', {
        queue: this.queue,
        stats
      });

      return true;
    }

    subscribe(callback) {
      if (typeof callback === 'function') {
        this.subscribers.add(callback);
      }
      return () => this.unsubscribe(callback);
    }

    unsubscribe(callback) {
      if (this.subscribers.has(callback)) {
        this.subscribers.delete(callback);
      }
    }

    _notifySubscribers(eventType, data) {
      for (const callback of this.subscribers) {
        try {
          callback(eventType, data, this);
        } catch (err) {
          console.error('[ThreadsQueueSyncService] Error in subscriber callback:', err);
        }
      }
    }

    _dispatchDOMEvent(name, detail) {
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          const event = new CustomEvent(name, { detail, bubbles: true });
          window.dispatchEvent(event);
        }
      } catch (e) {
        // Ignored
      }
    }

    async _getStorageData(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              console.warn('[ThreadsQueueSyncService] storage get warning:', chrome.runtime.lastError);
              resolve({});
            } else {
              resolve(res || {});
            }
          });
        });
      }
      return {};
    }

    async _setStorageData(obj) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.set(obj, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              console.warn('[ThreadsQueueSyncService] storage set warning:', chrome.runtime.lastError);
            }
            resolve();
          });
        });
      }
    }

    async _recordLog(logEntry) {
      try {
        const data = await this._getStorageData([STORAGE_KEYS.LOGS, STORAGE_KEYS.HISTORY]);
        const currentLogs = Array.isArray(data[STORAGE_KEYS.LOGS]) ? data[STORAGE_KEYS.LOGS] : (Array.isArray(data[STORAGE_KEYS.HISTORY]) ? data[STORAGE_KEYS.HISTORY] : []);
        currentLogs.unshift(logEntry);
        const trimmed = currentLogs.slice(0, 500);
        await this._setStorageData({
          [STORAGE_KEYS.LOGS]: trimmed,
          [STORAGE_KEYS.HISTORY]: trimmed
        });
      } catch (e) {
        console.warn('[ThreadsQueueSyncService] Gagal merekam log aktivitas:', e);
      }
    }
  }

  // ==========================================================================
  // 7. ThreadsWidgetDOM - Floating Widget DOM Component & Controls Panel
  // ==========================================================================
  class ThreadsWidgetDOM {
    static STYLES_ID = 'threads-widget-styles';
    static FAB_ID = 'threads-widget-fab';
    static BADGE_ID = 'threads-widget-badge';
    static PANEL_ID = 'threads-widget-panel';
    static TOAST_ID = 'threads-widget-toast';
    static _toastTimer = null;

    /**
     * Injeksi CSS native untuk styling widget Threads Auto-Poster
     */
    static injectStyles() {
      if (document.getElementById(this.STYLES_ID)) return;

      const style = document.createElement('style');
      style.id = this.STYLES_ID;
      style.textContent = `
        /* ==========================================================================
           Threads Floating Widget DOM Styles (Simplified & Modern)
           ========================================================================== */

        /* FAB Trigger Button */
        #threads-widget-fab,
        #threads-widget-float-btn {
          position: fixed !important;
          bottom: 24px !important;
          right: 24px !important;
          z-index: 2147483640 !important;
          background: linear-gradient(135deg, #18181b 0%, #09090b 100%) !important;
          color: #f4f4f5 !important;
          border: 1px solid rgba(255, 255, 255, 0.16) !important;
          border-radius: 50px !important;
          padding: 10px 18px !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          font-size: 13.5px !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06) !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
          user-select: none !important;
          backdrop-filter: blur(16px) !important;
          -webkit-backdrop-filter: blur(16px) !important;
        }

        #threads-widget-fab:hover,
        #threads-widget-float-btn:hover {
          transform: translateY(-2px) scale(1.03) !important;
          border-color: rgba(167, 139, 250, 0.5) !important;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7), 0 0 18px rgba(139, 92, 246, 0.35) !important;
        }

        #threads-widget-fab:active,
        #threads-widget-float-btn:active {
          transform: translateY(0) scale(0.98) !important;
        }

        #threads-widget-fab .tw-fab-icon,
        #threads-widget-float-btn .tw-fab-icon {
          font-size: 16px !important;
          display: flex !important;
          align-items: center !important;
        }

        #threads-widget-fab .tw-fab-label,
        #threads-widget-float-btn .tw-fab-label {
          letter-spacing: -0.2px !important;
        }

        #threads-widget-fab .tw-badge,
        #threads-widget-fab #threads-widget-badge,
        #threads-widget-float-btn .threads-badge {
          background: #8b5cf6 !important;
          color: #ffffff !important;
          font-size: 11px !important;
          font-weight: 800 !important;
          padding: 2px 7px !important;
          border-radius: 20px !important;
          min-width: 14px !important;
          text-align: center !important;
          box-shadow: 0 2px 6px rgba(139, 92, 246, 0.4) !important;
          transition: all 0.2s ease !important;
        }

        #threads-widget-fab .tw-badge.tw-badge-active,
        #threads-widget-fab #threads-widget-badge.tw-badge-active,
        #threads-widget-float-btn .threads-badge.tw-badge-active {
          background: #ee4d2d !important;
          box-shadow: 0 2px 8px rgba(238, 77, 45, 0.5) !important;
          animation: twPulseBadge 2s infinite !important;
        }

        @keyframes twPulseBadge {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.12); }
        }

        /* Main Floating Panel */
        #threads-widget-panel {
          position: fixed !important;
          bottom: 80px !important;
          right: 24px !important;
          z-index: 2147483645 !important;
          width: 360px !important;
          max-width: calc(100vw - 32px) !important;
          max-height: calc(100vh - 100px) !important;
          background: rgba(18, 18, 22, 0.96) !important;
          backdrop-filter: blur(24px) !important;
          -webkit-backdrop-filter: blur(24px) !important;
          color: #f4f4f5 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          border-radius: 18px !important;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
          padding: 16px !important;
          box-sizing: border-box !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          display: none !important;
          flex-direction: column !important;
          gap: 12px !important;
          animation: twPanelSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
          user-select: none !important;
        }

        #threads-widget-panel.tw-visible {
          display: flex !important;
        }

        @keyframes twPanelSlideUp {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* Custom Scrollbar */
        #threads-widget-panel::-webkit-scrollbar {
          width: 5px !important;
        }
        #threads-widget-panel::-webkit-scrollbar-track {
          background: transparent !important;
        }
        #threads-widget-panel::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18) !important;
          border-radius: 10px !important;
        }

        /* Header */
        .tw-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          padding-bottom: 10px !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        }

        .tw-title-group {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
        }

        .tw-title-icon {
          font-size: 17px !important;
        }

        .tw-title {
          margin: 0 !important;
          font-size: 14.5px !important;
          font-weight: 800 !important;
          color: #f8fafc !important;
          letter-spacing: -0.3px !important;
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
        }

        .tw-title span.tw-accent {
          background: linear-gradient(135deg, #a78bfa, #818cf8) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }

        .tw-header-actions {
          display: flex !important;
          align-items: center !important;
          gap: 5px !important;
        }

        .tw-icon-btn {
          background: rgba(255, 255, 255, 0.06) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          color: #a1a1aa !important;
          font-size: 12px !important;
          cursor: pointer !important;
          width: 26px !important;
          height: 26px !important;
          border-radius: 7px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s ease !important;
          padding: 0 !important;
        }

        .tw-icon-btn:hover {
          background: rgba(255, 255, 255, 0.16) !important;
          color: #ffffff !important;
          border-color: rgba(255, 255, 255, 0.2) !important;
          transform: translateY(-1px) !important;
        }

        /* Item Navigation Row */
        .tw-item-nav-row {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 8px !important;
          background: rgba(255, 255, 255, 0.03) !important;
          border: 1px solid rgba(255, 255, 255, 0.06) !important;
          border-radius: 10px !important;
          padding: 4px 8px !important;
        }

        .tw-nav-btn {
          background: rgba(255, 255, 255, 0.06) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          color: #e4e4e7 !important;
          width: 26px !important;
          height: 26px !important;
          border-radius: 6px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.15s ease !important;
          padding: 0 !important;
        }

        .tw-nav-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.14) !important;
          color: #ffffff !important;
        }

        .tw-nav-btn:disabled {
          opacity: 0.3 !important;
          cursor: not-allowed !important;
        }

        .tw-item-counter-box {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
        }

        .tw-item-counter {
          font-size: 11.5px !important;
          font-weight: 700 !important;
          color: #c4b5fd !important;
          letter-spacing: -0.2px !important;
        }

        /* Active Item Preview Card */
        #tw-active-card,
        .tw-active-card {
          background: rgba(255, 255, 255, 0.035) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          border-radius: 14px !important;
          padding: 12px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 10px !important;
          transition: all 0.2s ease !important;
        }

        .tw-item-main {
          display: flex !important;
          gap: 10px !important;
        }

        .tw-item-thumb-box {
          position: relative !important;
          width: 68px !important;
          height: 68px !important;
          min-width: 68px !important;
          border-radius: 10px !important;
          overflow: hidden !important;
          background: #27272a !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
        }

        .tw-item-thumb,
        #tw-item-img {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
        }

        .tw-item-details {
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
          flex: 1 !important;
          min-width: 0 !important;
        }

        .tw-item-title,
        #tw-item-title {
          font-size: 12.5px !important;
          font-weight: 700 !important;
          color: #f4f4f5 !important;
          line-height: 1.35 !important;
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }

        .tw-item-meta {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 6px !important;
          margin-top: 4px !important;
        }

        .tw-item-price,
        #tw-item-price {
          font-size: 12px !important;
          font-weight: 800 !important;
          color: #34d399 !important;
        }

        .tw-item-link-container {
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
        }

        .tw-item-link-pill,
        #tw-item-link {
          display: inline-flex !important;
          align-items: center !important;
          gap: 3px !important;
          font-size: 10.5px !important;
          color: #60a5fa !important;
          background: rgba(96, 165, 250, 0.1) !important;
          padding: 2px 6px !important;
          border-radius: 6px !important;
          text-decoration: none !important;
          max-width: 110px !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          cursor: pointer !important;
          border: 1px solid rgba(96, 165, 250, 0.2) !important;
          transition: all 0.2s ease !important;
        }

        .tw-item-link-pill:hover,
        #tw-item-link:hover {
          background: rgba(96, 165, 250, 0.2) !important;
          color: #93c5fd !important;
        }

        .tw-btn-copy,
        #threads-btn-copy-link {
          background: rgba(255, 255, 255, 0.08) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          color: #d1d5db !important;
          padding: 2px 5px !important;
          border-radius: 5px !important;
          font-size: 10px !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
        }

        .tw-btn-copy:hover,
        #threads-btn-copy-link:hover {
          background: rgba(255, 255, 255, 0.2) !important;
          color: #ffffff !important;
        }

        /* Caption Preview */
        .tw-caption-wrapper {
          display: flex !important;
          flex-direction: column !important;
          gap: 4px !important;
        }

        .tw-caption-header {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          font-size: 10.5px !important;
          color: #a1a1aa !important;
          font-weight: 600 !important;
        }

        .tw-caption-actions {
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
        }

        .tw-btn-text-action {
          background: none !important;
          border: none !important;
          color: #a78bfa !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          padding: 1px 4px !important;
          border-radius: 4px !important;
          transition: all 0.15s ease !important;
        }

        .tw-btn-text-action:hover {
          background: rgba(139, 92, 246, 0.15) !important;
          color: #c4b5fd !important;
        }

        .tw-btn-text-action.tw-btn-danger {
          color: #f87171 !important;
        }

        .tw-btn-text-action.tw-btn-danger:hover {
          background: rgba(239, 68, 68, 0.15) !important;
          color: #fca5a5 !important;
        }

        .tw-caption-box,
        #tw-item-caption {
          background: rgba(0, 0, 0, 0.35) !important;
          border: 1px solid rgba(255, 255, 255, 0.05) !important;
          border-radius: 8px !important;
          padding: 8px 10px !important;
          font-size: 11.5px !important;
          color: #d4d4d8 !important;
          line-height: 1.4 !important;
          max-height: 68px !important;
          overflow-y: auto !important;
          white-space: pre-wrap !important;
          word-break: break-word !important;
          font-family: inherit !important;
        }

        .tw-caption-box::-webkit-scrollbar {
          width: 4px !important;
        }
        .tw-caption-box::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15) !important;
          border-radius: 4px !important;
        }

        /* Visual Progress Log & Steps Tracker */
        .tw-progress-section {
          display: flex !important;
          flex-direction: column !important;
          gap: 8px !important;
          background: rgba(255, 255, 255, 0.02) !important;
          border: 1px solid rgba(255, 255, 255, 0.05) !important;
          border-radius: 10px !important;
          padding: 10px !important;
        }

        .tw-steps-tracker {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 2px !important;
        }

        .tw-step-pill {
          font-size: 10px !important;
          font-weight: 700 !important;
          color: #71717a !important;
          background: rgba(255, 255, 255, 0.04) !important;
          padding: 3px 6px !important;
          border-radius: 6px !important;
          border: 1px solid rgba(255, 255, 255, 0.06) !important;
          transition: all 0.25s ease !important;
          white-space: nowrap !important;
        }

        .tw-step-arrow {
          font-size: 9px !important;
          color: #52525b !important;
        }

        .tw-step-pill.tw-step-active {
          color: #c4b5fd !important;
          background: rgba(139, 92, 246, 0.18) !important;
          border-color: rgba(139, 92, 246, 0.4) !important;
        }

        .tw-step-pill.tw-step-current {
          color: #ffffff !important;
          background: linear-gradient(135deg, #8b5cf6, #6366f1) !important;
          border-color: #a78bfa !important;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.5) !important;
        }

        .tw-progress-track {
          background: rgba(255, 255, 255, 0.08) !important;
          height: 5px !important;
          border-radius: 5px !important;
          overflow: hidden !important;
          position: relative !important;
        }

        .tw-progress-bar,
        #tw-progress-bar {
          width: 0% !important;
          height: 100% !important;
          background: linear-gradient(90deg, #8b5cf6, #3b82f6, #10b981) !important;
          border-radius: 5px !important;
          transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }

        .tw-status-text,
        #tw-status-text {
          font-size: 11.5px !important;
          color: #a1a1aa !important;
          text-align: center !important;
          min-height: 16px !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          font-weight: 600 !important;
        }

        /* Single Primary Action Button */
        .tw-controls {
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
        }

        .tw-btn-primary,
        #threads-btn-post-now {
          width: 100% !important;
          background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%) !important;
          color: #ffffff !important;
          border: none !important;
          padding: 11px 16px !important;
          border-radius: 12px !important;
          font-weight: 800 !important;
          font-size: 13.5px !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35) !important;
          user-select: none !important;
        }

        .tw-btn-primary:hover:not(:disabled),
        #threads-btn-post-now:hover:not(:disabled) {
          filter: brightness(1.12) !important;
          transform: translateY(-1.5px) !important;
          box-shadow: 0 8px 22px rgba(139, 92, 246, 0.5) !important;
        }

        .tw-btn-primary:active:not(:disabled),
        #threads-btn-post-now:active:not(:disabled) {
          transform: translateY(0) scale(0.98) !important;
        }

        .tw-btn-primary:disabled,
        #threads-btn-post-now:disabled {
          opacity: 0.45 !important;
          cursor: not-allowed !important;
          box-shadow: none !important;
          transform: none !important;
        }

        /* Empty State */
        #tw-empty-state,
        .tw-empty-state {
          display: none !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          text-align: center !important;
          padding: 24px 12px !important;
          background: rgba(255, 255, 255, 0.02) !important;
          border: 1px dashed rgba(255, 255, 255, 0.1) !important;
          border-radius: 14px !important;
          gap: 6px !important;
        }

        .tw-empty-icon {
          font-size: 28px !important;
          margin-bottom: 2px !important;
        }

        .tw-empty-title {
          font-size: 13px !important;
          font-weight: 700 !important;
          color: #e4e4e7 !important;
        }

        .tw-empty-desc {
          font-size: 11.5px !important;
          color: #71717a !important;
          max-width: 240px !important;
          line-height: 1.4 !important;
        }

        /* In-Page Toast */
        #threads-widget-toast {
          position: fixed !important;
          bottom: 24px !important;
          left: 50% !important;
          transform: translateX(-50%) translateY(20px) !important;
          z-index: 2147483647 !important;
          background: rgba(24, 24, 27, 0.95) !important;
          backdrop-filter: blur(16px) !important;
          -webkit-backdrop-filter: blur(16px) !important;
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
          border-left: 4px solid #10b981 !important;
          color: #f4f4f5 !important;
          padding: 10px 18px !important;
          border-radius: 12px !important;
          font-size: 12.5px !important;
          font-weight: 600 !important;
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.7) !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          opacity: 0 !important;
          pointer-events: none !important;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
          user-select: none !important;
          max-width: calc(100vw - 48px) !important;
        }

        #threads-widget-toast.tw-toast-show {
          opacity: 1 !important;
          transform: translateX(-50%) translateY(0) !important;
          pointer-events: auto !important;
        }

        #threads-widget-toast.tw-toast-error {
          border-left-color: #ef4444 !important;
        }
      `;

      document.head.appendChild(style);
    }

    /**
     * Membuat tombol FAB #threads-widget-fab dengan badge antrean di pojok layar Threads
     * @returns {HTMLElement}
     */
    static createFloatingTrigger() {
      this.injectStyles();

      let fab = document.getElementById(this.FAB_ID);
      if (!fab) {
        fab = document.createElement('button');
        fab.id = this.FAB_ID;
        fab.setAttribute('title', 'Buka Antrean Threads Poster');
        fab.innerHTML = `
          <span class="tw-fab-icon">🧵</span>
          <span class="tw-fab-label">Threads Poster</span>
          <span class="tw-badge" id="${this.BADGE_ID}">0</span>
        `;

        fab.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePanel();
        });

        document.body.appendChild(fab);
      }

      return fab;
    }

    /**
     * Merender panel kontrol #threads-widget-panel sederhana & modern
     * @returns {HTMLElement}
     */
    static renderPanel() {
      this.injectStyles();

      let panel = document.getElementById(this.PANEL_ID);
      if (panel) return panel;

      panel = document.createElement('div');
      panel.id = this.PANEL_ID;
      panel.innerHTML = `
        <!-- Header -->
        <div class="tw-header">
          <div class="tw-title-group">
            <span class="tw-title-icon">🧵</span>
            <h3 class="tw-title">
              Threads <span class="tw-accent">Poster</span>
            </h3>
          </div>
          <div class="tw-header-actions">
            <button id="tw-btn-refresh" class="tw-icon-btn" title="Refresh Antrean">🔄</button>
            <button id="tw-btn-panel" class="tw-icon-btn" title="Buka Dedicated Poster Panel">🖥️</button>
            <button id="tw-btn-dashboard" class="tw-icon-btn" title="Buka Dashboard">📊</button>
            <button id="tw-btn-close" class="tw-icon-btn" title="Tutup Panel">✕</button>
          </div>
        </div>

        <!-- Item Navigation Row -->
        <div class="tw-item-nav-row">
          <button id="threads-btn-prev" class="tw-nav-btn" title="Item Sebelumnya">◀</button>
          <div class="tw-item-counter-box">
            <span id="tw-item-index-label" class="tw-item-counter">Item 0 dari 0 Pending</span>
          </div>
          <button id="threads-btn-next" class="tw-nav-btn" title="Item Berikutnya">▶</button>
        </div>

        <!-- Active Item Card Preview -->
        <div id="tw-active-card" class="tw-active-card">
          <div class="tw-item-main">
            <div class="tw-item-thumb-box">
              <img id="tw-item-img" class="tw-item-thumb" src="" alt="Thumbnail Produk" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'72\\' height=\\'72\\' fill=\\'%23555\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%2327272a\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%2371717a\\' font-size=\\'10\\'>No Image</text></svg>'">
            </div>
            <div class="tw-item-details">
              <div id="tw-item-title" class="tw-item-title">-</div>
              <div class="tw-item-meta">
                <span id="tw-item-price" class="tw-item-price">Rp -</span>
                <div class="tw-item-link-container">
                  <a id="tw-item-link" class="tw-item-link-pill" href="#" target="_blank" title="Buka Link Produk">
                    <span>🔗</span> <span id="tw-item-link-text">shope.ee/...</span>
                  </a>
                  <button id="threads-btn-copy-link" class="tw-btn-copy" title="Salin Link">📋</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Caption Wrapper -->
          <div class="tw-caption-wrapper">
            <div class="tw-caption-header">
              <span class="tw-caption-label">Caption Postingan:</span>
              <div class="tw-caption-actions">
                <button id="threads-btn-edit-caption" class="tw-btn-text-action" title="Edit Caption">✏️ Edit</button>
                <button id="threads-btn-delete-item" class="tw-btn-text-action tw-btn-danger" title="Hapus Item">🗑️</button>
              </div>
            </div>
            <div id="tw-item-caption" class="tw-caption-box">Teks caption belum dimuat...</div>
          </div>
        </div>

        <!-- Empty State -->
        <div id="tw-empty-state" class="tw-empty-state">
          <div class="tw-empty-icon">📭</div>
          <div class="tw-empty-title">Tidak Ada Antrean Pending</div>
          <div class="tw-empty-desc">Tambahkan produk dari Shopee Affiliate untuk posting ke Threads.</div>
        </div>

        <!-- Visual Progress Log & Steps Tracker -->
        <div class="tw-progress-section">
          <div class="tw-steps-tracker">
            <div class="tw-step-pill" id="tw-step-1">⏳ Form</div>
            <span class="tw-step-arrow">→</span>
            <div class="tw-step-pill" id="tw-step-2">✍️ Teks</div>
            <span class="tw-step-arrow">→</span>
            <div class="tw-step-pill" id="tw-step-3">🔘 Kirim</div>
            <span class="tw-step-arrow">→</span>
            <div class="tw-step-pill" id="tw-step-4">🎉 Selesai</div>
          </div>
          <div class="tw-progress-track">
            <div id="tw-progress-bar" class="tw-progress-bar"></div>
          </div>
          <div id="tw-status-text" class="tw-status-text">Siap posting item ini.</div>
        </div>

        <!-- Single Primary Action Button -->
        <div class="tw-controls">
          <button id="threads-btn-post-now" class="tw-btn-primary">
            <span>🚀</span> <span>Post Item Ini Sekarang</span>
          </button>
        </div>

        <!-- Backward compatible hidden selector -->
        <select id="threads-queue-selector" style="display:none;"></select>
      `;

      document.body.appendChild(panel);

      // Close handler
      const closeBtn = panel.querySelector('#tw-btn-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePanel(false);
        });
      }

      return panel;
    }

    /**
     * Menampilkan/menyembunyikan panel kontrol
     * @param {boolean|null} forceState
     * @returns {boolean}
     */
    static togglePanel(forceState = null) {
      let panel = document.getElementById(this.PANEL_ID);
      if (!panel) {
        panel = this.renderPanel();
      }

      const shouldOpen = forceState !== null ? forceState : !panel.classList.contains('tw-visible');

      if (shouldOpen) {
        panel.classList.add('tw-visible');
      } else {
        panel.classList.remove('tw-visible');
      }

      return shouldOpen;
    }

    /**
     * Memperbarui badge dan ringkasan angka statistik
     * @param {number} total
     * @param {number} pending
     * @param {number} posted
     * @param {number} failed
     */
    static updateStats(total = 0, pending = 0, posted = 0, failed = 0) {
      const badge = document.getElementById(this.BADGE_ID);
      if (badge) {
        badge.textContent = `${pending}`;
        if (pending > 0) {
          badge.classList.add('tw-badge-active');
        } else {
          badge.classList.remove('tw-badge-active');
        }
      }

      const totalEl = document.getElementById('tw-stat-total');
      const pendingEl = document.getElementById('tw-stat-pending');
      const postedEl = document.getElementById('tw-stat-posted');
      const failedEl = document.getElementById('tw-stat-failed');
      const selectCountEl = document.getElementById('tw-select-count');

      if (totalEl) totalEl.textContent = `${total}`;
      if (pendingEl) pendingEl.textContent = `${pending}`;
      if (postedEl) postedEl.textContent = `${posted}`;
      if (failedEl) failedEl.textContent = `${failed}`;
      if (selectCountEl) selectCountEl.textContent = `${pending} Pending`;
    }

    /**
     * Menampilkan foto produk, nama produk, harga, shortlink, dan caption teks dari item antrean yang sedang aktif.
     * @param {Object|null} item
     * @param {number} currentIndex
     * @param {number} totalPending
     */
    static renderActiveItem(item, currentIndex = 0, totalPending = 0) {
      const activeCard = document.getElementById('tw-active-card');
      const emptyState = document.getElementById('tw-empty-state');
      const postNowBtn = document.getElementById('threads-btn-post-now');
      const prevBtn = document.getElementById('threads-btn-prev');
      const nextBtn = document.getElementById('threads-btn-next');
      const editBtn = document.getElementById('threads-btn-edit-caption');
      const deleteBtn = document.getElementById('threads-btn-delete-item');
      const indexLabel = document.getElementById('tw-item-index-label');

      if (!item || totalPending === 0) {
        if (activeCard) activeCard.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        if (postNowBtn) postNowBtn.disabled = true;
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (editBtn) editBtn.disabled = true;
        if (deleteBtn) deleteBtn.disabled = true;
        if (indexLabel) indexLabel.textContent = 'Tidak Ada Antrean';
        return;
      }

      if (activeCard) activeCard.style.display = 'flex';
      if (emptyState) emptyState.style.display = 'none';
      if (postNowBtn) postNowBtn.disabled = false;
      if (prevBtn) prevBtn.disabled = (currentIndex <= 0);
      if (nextBtn) nextBtn.disabled = (currentIndex >= totalPending - 1);
      if (editBtn) editBtn.disabled = false;
      if (deleteBtn) deleteBtn.disabled = false;

      // Index label
      if (indexLabel) {
        indexLabel.textContent = `Item ${currentIndex + 1} dari ${totalPending} Pending`;
      }

      // Thumbnail
      const imgEl = document.getElementById('tw-item-img');
      const imageUrls = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
        ? item.imageUrls
        : (item.primaryImage || item.image ? [item.primaryImage || item.image] : []);

      if (imgEl) {
        imgEl.src = imageUrls[0] || '';
      }

      // Title
      const titleEl = document.getElementById('tw-item-title');
      if (titleEl) {
        titleEl.textContent = item.title || item.name || 'Produk Tanpa Judul';
        titleEl.setAttribute('title', item.title || '');
      }

      // Price
      const priceEl = document.getElementById('tw-item-price');
      if (priceEl) {
        let priceText = item.price || item.formattedPrice || '-';
        if (typeof priceText === 'number') {
          priceText = 'Rp ' + priceText.toLocaleString('id-ID');
        } else if (typeof priceText === 'string' && !priceText.startsWith('Rp') && !isNaN(Number(priceText))) {
          priceText = 'Rp ' + Number(priceText).toLocaleString('id-ID');
        }
        priceEl.textContent = priceText;
      }

      // Shortlink
      const linkEl = document.getElementById('tw-item-link');
      const linkTextEl = document.getElementById('tw-item-link-text');
      const linkUrl = item.shortLink || item.affiliateLink || item.short_url || item.url || '#';
      if (linkEl) {
        linkEl.href = linkUrl;
      }
      if (linkTextEl) {
        let displayUrl = linkUrl.replace(/^https?:\/\//i, '');
        if (displayUrl.length > 20) {
          displayUrl = displayUrl.slice(0, 18) + '...';
        }
        linkTextEl.textContent = displayUrl || 'shope.ee/...';
      }

      // Caption
      const captionEl = document.getElementById('tw-item-caption');
      if (captionEl) {
        captionEl.textContent = item.caption || item.text || item.title || 'Tidak ada teks caption.';
      }
    }

    /**
     * Update progress bar, teks status, dan step tracker pills secara visual
     * @param {number} percent
     * @param {string} statusMessage
     * @param {number} [stepNumber]
     */
    static showProgress(percent = 0, statusMessage = '', stepNumber = 0) {
      const clamped = Math.min(100, Math.max(0, percent));
      const progressBar = document.getElementById('tw-progress-bar');
      const statusText = document.getElementById('tw-status-text');

      if (progressBar) {
        progressBar.style.width = `${clamped}%`;
      }

      if (statusText && statusMessage) {
        statusText.textContent = statusMessage;
      }

      // Hitung step aktif (1: Form, 2: Teks, 3: Kirim, 4: Selesai)
      let activeStep = stepNumber;
      if (!activeStep && statusMessage) {
        if (statusMessage.includes('Buka form') || clamped === 25) activeStep = 1;
        else if (statusMessage.includes('Isi teks') || statusMessage.includes('media') || clamped === 50) activeStep = 2;
        else if (statusMessage.includes('Kirim') || clamped === 75) activeStep = 3;
        else if (statusMessage.includes('Berhasil') || clamped === 100) activeStep = 4;
      }

      const steps = [1, 2, 3, 4];
      steps.forEach((s) => {
        const stepPill = document.getElementById(`tw-step-${s}`);
        if (stepPill) {
          if (activeStep >= s) {
            stepPill.classList.add('tw-step-active');
          } else {
            stepPill.classList.remove('tw-step-active');
          }

          if (activeStep === s) {
            stepPill.classList.add('tw-step-current');
          } else {
            stepPill.classList.remove('tw-step-current');
          }
        }
      });
    }

    /**
     * Menampilkan toast notifikasi in-page di Threads
     * @param {string} message
     * @param {boolean} isSuccess
     * @param {number} durationMs
     */
    static showToast(message, isSuccess = true, durationMs = 3500) {
      this.injectStyles();

      let toast = document.getElementById(this.TOAST_ID);
      if (!toast) {
        toast = document.createElement('div');
        toast.id = this.TOAST_ID;
        document.body.appendChild(toast);
      }

      toast.className = isSuccess ? '' : 'tw-toast-error';
      toast.innerHTML = `<span>${isSuccess ? '✅' : '⚠️'}</span> <span>${message}</span>`;
      
      // Force reflow
      void toast.offsetWidth;
      toast.classList.add('tw-toast-show');

      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
      }

      this._toastTimer = setTimeout(() => {
        toast.classList.remove('tw-toast-show');
      }, durationMs);
    }

    // Instance delegation methods
    createFloatingTrigger() { return ThreadsWidgetDOM.createFloatingTrigger(); }
    renderPanel() { return ThreadsWidgetDOM.renderPanel(); }
    togglePanel(forceState = null) { return ThreadsWidgetDOM.togglePanel(forceState); }
    updateStats(total, pending, posted, failed) { return ThreadsWidgetDOM.updateStats(total, pending, posted, failed); }
    renderActiveItem(item, currentIndex, totalPending) { return ThreadsWidgetDOM.renderActiveItem(item, currentIndex, totalPending); }
    showProgress(percent, statusMessage, stepNumber) { return ThreadsWidgetDOM.showProgress(percent, statusMessage, stepNumber); }
    showToast(message, isSuccess, durationMs) { return ThreadsWidgetDOM.showToast(message, isSuccess, durationMs); }
  }

  // ==========================================================================
  // 8. ThreadsWidgetController - Item Selector & Single Post Controller UI
  // ==========================================================================
  class ThreadsWidgetController {
    constructor() {
      this.syncService = ThreadsQueueSyncService.getInstance();
      this.currentIndex = 0;
      this.isPanelOpen = false;
      this.isPosting = false;
      this.initialized = false;
    }

    static getInstance() {
      if (!ThreadsWidgetController._instance) {
        ThreadsWidgetController._instance = new ThreadsWidgetController();
      }
      return ThreadsWidgetController._instance;
    }

    /**
     * Inisialisasi UI Widget & event listener
     */
    async init() {
      if (this.initialized) return;
      this.initialized = true;

      // 1. Pastikan antrean termuat
      await this.syncService.init();

      // 2. Buat FAB trigger floating button & render panel
      ThreadsWidgetDOM.createFloatingTrigger();
      const panel = ThreadsWidgetDOM.renderPanel();

      // 3. Pasang subscription ke syncService untuk re-render real-time
      this.syncService.subscribe((eventType, data) => {
        this.updateStats();
        this.render();
      });

      // 4. Bind event panel
      this.bindPanelEvents(panel);

      // 5. Initial stats update & render
      this.updateStats();
      this.render();

      console.log('[ThreadsWidgetController] ThreadsWidgetDOM & Controller ready! 🧵🚀');
    }

    /**
     * Memperbarui angka statistik di widget
     */
    updateStats() {
      const stats = this.syncService.getStats();
      ThreadsWidgetDOM.updateStats(stats.total, stats.pending, stats.posted, stats.failed);
    }

    /**
     * Render item aktif
     */
    render() {
      const pendingItems = this.syncService.getPendingItems();
      const totalPending = pendingItems.length;

      if (this.currentIndex >= totalPending) {
        this.currentIndex = Math.max(0, totalPending - 1);
      }
      if (this.currentIndex < 0) {
        this.currentIndex = 0;
      }

      const currentItem = totalPending > 0 ? pendingItems[this.currentIndex] : null;

      // Render Active Item Card
      ThreadsWidgetDOM.renderActiveItem(currentItem, this.currentIndex, totalPending);

      // Update backward compatible selector if exists
      const selector = document.getElementById('threads-queue-selector');
      if (selector) {
        if (totalPending === 0) {
          selector.innerHTML = '<option disabled selected>(Antrean Kosong / Selesai)</option>';
        } else {
          selector.innerHTML = pendingItems.map((item, idx) => {
            const safeTitle = (item.title || 'Produk').substring(0, 32);
            const priceStr = item.price || '-';
            const isSelected = idx === this.currentIndex ? 'selected' : '';
            return `<option value="${item.id}" ${isSelected}>[${idx + 1}/${totalPending}] ${safeTitle} - ${priceStr}</option>`;
          }).join('');
        }
      }
    }

    /**
     * Pasang event listener ke elemen-elemen panel widget
     * @param {HTMLElement} panel
     */
    bindPanelEvents(panel) {
      if (!panel) return;

      // 1. Refresh Button
      const refreshBtn = panel.querySelector('#tw-btn-refresh');
      if (refreshBtn) {
        refreshBtn.onclick = async () => {
          await this.syncService.loadAll();
          this.updateStats();
          this.render();
          ThreadsWidgetDOM.showToast('Data antrean diperbarui!');
        };
      }

      // 1b. Dedicated Poster Panel Button
      const panelBtn = panel.querySelector('#tw-btn-panel');
      if (panelBtn) {
        panelBtn.onclick = () => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'OPEN_POSTER_PANEL' });
          }
        };
      }

      // 2. Dashboard Button
      const dashBtn = panel.querySelector('#tw-btn-dashboard');
      if (dashBtn) {
        dashBtn.onclick = () => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
          }
        };
      }

      // 3. Dropdown Selector Change (for compatibility)
      const selector = panel.querySelector('#threads-queue-selector');
      if (selector) {
        selector.onchange = (e) => {
          const selectedId = e.target.value;
          const pendingItems = this.syncService.getPendingItems();
          const foundIdx = pendingItems.findIndex(it => String(it.id) === String(selectedId));
          if (foundIdx !== -1) {
            this.currentIndex = foundIdx;
            this.render();
          }
        };
      }

      // 4. Previous Item Button
      const prevBtn = panel.querySelector('#threads-btn-prev');
      if (prevBtn) {
        prevBtn.onclick = () => {
          if (this.currentIndex > 0) {
            this.currentIndex--;
            this.render();
          }
        };
      }

      // 5. Next Item Button
      const nextBtn = panel.querySelector('#threads-btn-next');
      if (nextBtn) {
        nextBtn.onclick = () => {
          const pendingItems = this.syncService.getPendingItems();
          if (this.currentIndex < pendingItems.length - 1) {
            this.currentIndex++;
            this.render();
          }
        };
      }

      // 6. Copy Shortlink Button
      const copyBtn = panel.querySelector('#threads-btn-copy-link');
      if (copyBtn) {
        copyBtn.onclick = () => {
          const pendingItems = this.syncService.getPendingItems();
          const currentItem = pendingItems[this.currentIndex];
          const link = currentItem?.shortLink || currentItem?.affiliateLink || currentItem?.url;
          if (link) {
            navigator.clipboard.writeText(link)
              .then(() => ThreadsWidgetDOM.showToast('Link afiliasi berhasil disalin!'))
              .catch(() => ThreadsWidgetDOM.showToast('Gagal menyalin link', false));
          }
        };
      }

      // 7. Edit Caption Button
      const editBtn = panel.querySelector('#threads-btn-edit-caption');
      if (editBtn) {
        editBtn.onclick = () => {
          const pendingItems = this.syncService.getPendingItems();
          const currentItem = pendingItems[this.currentIndex];
          if (currentItem) {
            this.openEditCaptionModal(currentItem);
          }
        };
      }

      // 8. Delete Item Button
      const deleteBtn = panel.querySelector('#threads-btn-delete-item');
      if (deleteBtn) {
        deleteBtn.onclick = async () => {
          const pendingItems = this.syncService.getPendingItems();
          const currentItem = pendingItems[this.currentIndex];
          if (currentItem && confirm(`Hapus "${currentItem.title || 'produk ini'}" dari antrean Threads?`)) {
            await this.syncService.deleteItem(currentItem.id);
            ThreadsWidgetDOM.showToast('Item berhasil dihapus dari antrean!');
            this.updateStats();
            this.render();
          }
        };
      }

      // 9. Single Action Button: "🚀 Post Item Ini Sekarang"
      const postNowBtn = panel.querySelector('#threads-btn-post-now');
      if (postNowBtn) {
        postNowBtn.onclick = async () => {
          if (this.isPosting) return;

          const pendingItems = this.syncService.getPendingItems();
          const currentItem = pendingItems[this.currentIndex];
          if (!currentItem) {
            ThreadsWidgetDOM.showToast('Tidak ada item antrean yang dipilih!', false);
            return;
          }

          // Cek status login
          const login = ThreadsDOM.checkLoginStatus();
          if (!login.isLoggedIn) {
            alert('⚠️ Anda belum login ke Threads Web. Silakan login ke akun Threads Anda terlebih dahulu.');
            return;
          }

          this.isPosting = true;
          postNowBtn.disabled = true;

          // Progres awal
          ThreadsWidgetDOM.showProgress(25, '⏳ Buka form...', 1);

          try {
            await this.syncService.markItemPosting(currentItem.id);

            // Eksekusi posting dengan visual progress callback 4 langkah
            const postResult = await ThreadsPostController.post(currentItem, (percent, msg, stepNum) => {
              ThreadsWidgetDOM.showProgress(percent, msg, stepNum);
            });

            if (postResult && postResult.success) {
              await this.syncService.markItemPosted(currentItem.id, postResult.postUrl);
              ThreadsWidgetDOM.showProgress(100, '🎉 Berhasil!', 4);
              ThreadsWidgetDOM.showToast('🎉 Berhasil dipublikasikan ke Threads!');
            } else {
              throw new Error(postResult?.message || 'Gagal memposting');
            }
          } catch (err) {
            console.error('[ThreadsWidgetController] Error saat posting:', err);
            await this.syncService.markItemFailed(currentItem.id, err.message);
            ThreadsWidgetDOM.showProgress(0, `❌ Gagal: ${err.message}`, 0);
            ThreadsWidgetDOM.showToast(`❌ Gagal: ${err.message}`, false);
          } finally {
            this.isPosting = false;
            postNowBtn.disabled = false;
            this.updateStats();
            this.render();
          }
        };
      }
    }

    /**
     * Membuka modal dialog mini untuk mengedit caption produk
     * @param {Object} item 
     */
    openEditCaptionModal(item) {
      const existing = document.getElementById('threads-edit-caption-modal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'threads-edit-caption-modal';
      modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 2147483646; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px);">
          <div style="width: 420px; max-width: 90vw; background: #18181b; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; padding: 18px; color: #f4f4f5; display: flex; flex-direction: column; gap: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
              <h4 style="margin: 0; font-size: 14px; font-weight: 700;">✏️ Edit Caption Postingan</h4>
              <button id="threads-modal-close" style="background: none; border: none; color: #a1a1aa; font-size: 16px; cursor: pointer;">✕</button>
            </div>

            <div style="font-size: 11.5px; color: #a1a1aa; line-height: 1.35;">
              <b>Produk:</b> ${(item.title || 'Produk Shopee').substring(0, 50)}...
            </div>

            <textarea id="threads-edit-caption-textarea" style="width: 100%; height: 110px; background: #27272a; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px; color: #ffffff; font-size: 12px; font-family: inherit; resize: vertical; box-sizing: border-box;" placeholder="Tulis atau edit caption Threads di sini...">${item.caption || ''}</textarea>

            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px;">
              <span id="threads-modal-char-counter" style="font-size: 11px; color: #71717a;">${(item.caption || '').length} Karakter</span>
              <div style="display: flex; gap: 8px;">
                <button id="threads-modal-btn-cancel" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #e4e4e7; padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;">Batal</button>
                <button id="threads-modal-btn-save" style="background: #8b5cf6; border: none; color: #ffffff; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;">💾 Simpan</button>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const textarea = modal.querySelector('#threads-edit-caption-textarea');
      const counter = modal.querySelector('#threads-modal-char-counter');
      const saveBtn = modal.querySelector('#threads-modal-btn-save');
      const cancelBtn = modal.querySelector('#threads-modal-btn-cancel');
      const closeBtn = modal.querySelector('#threads-modal-close');

      textarea.focus();

      textarea.oninput = () => {
        counter.textContent = `${textarea.value.length} Karakter`;
      };

      const closeModal = () => modal.remove();
      cancelBtn.onclick = closeModal;
      closeBtn.onclick = closeModal;

      saveBtn.onclick = async () => {
        const newCaption = textarea.value.trim();
        if (!newCaption) {
          alert('Caption tidak boleh kosong!');
          return;
        }

        await this.syncService.updateItem(item.id, { caption: newCaption });
        ThreadsWidgetDOM.showToast('✅ Caption berhasil disimpan!');
        closeModal();
        this.render();
      };
    }
  }

  // ==========================================================================
  // 9. INITIALIZATION & EXPORTS
  // ==========================================================================

  // Inisialisasi Message Listener Threads Automator
  ThreadsPostController.initMessageListener();

  // Inisialisasi Singleton ThreadsQueueSyncService & ThreadsWidgetController
  const queueSyncService = ThreadsQueueSyncService.getInstance();
  const widgetController = ThreadsWidgetController.getInstance();

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        widgetController.init().catch(err => console.warn('[ThreadsWidgetController] Init error:', err));
      });
    } else {
      widgetController.init().catch(err => console.warn('[ThreadsWidgetController] Init error:', err));
    }
  }

  // Export ke global, window & module.exports
  if (root) {
    root.postingThreads = postingThreads;
    root.ThreadsDOM = ThreadsDOM;
    root.ThreadsMedia = ThreadsMedia;
    root.ThreadsEditor = ThreadsEditor;
    root.ThreadsToastObserver = ThreadsToastObserver;
    root.ThreadsPostController = ThreadsPostController;
    root.ThreadsQueueSyncService = ThreadsQueueSyncService;
    root.ThreadsWidgetDOM = ThreadsWidgetDOM;
    root.ThreadsWidgetController = ThreadsWidgetController;
    root.threadsQueueSync = queueSyncService;
    root.threadsWidget = widgetController;
  }

  if (typeof window !== 'undefined') {
    window.postingThreads = postingThreads;
    window.ThreadsDOM = ThreadsDOM;
    window.ThreadsMedia = ThreadsMedia;
    window.ThreadsEditor = ThreadsEditor;
    window.ThreadsToastObserver = ThreadsToastObserver;
    window.ThreadsPostController = ThreadsPostController;
    window.ThreadsQueueSyncService = ThreadsQueueSyncService;
    window.ThreadsWidgetDOM = ThreadsWidgetDOM;
    window.ThreadsWidgetController = ThreadsWidgetController;
    window.threadsQueueSync = queueSyncService;
    window.threadsWidget = widgetController;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      postingThreads,
      ThreadsDOM,
      ThreadsMedia,
      ThreadsEditor,
      ThreadsToastObserver,
      ThreadsPostController,
      ThreadsQueueSyncService,
      ThreadsWidgetDOM,
      ThreadsWidgetController,
      threadsQueueSync: queueSyncService,
      threadsWidget: widgetController
    };
  }

})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : typeof global !== 'undefined' ? global
  : this);
