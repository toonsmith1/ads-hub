/**
 * Shopee Affiliate Product & Image Downloader - Orchestrator & Content Script UI (Thai Edition)
 * Uses CsvService, StorageService, and ShopeeScraperService from libs/
 * 
 * Author: sodikinnaa
 * License: MIT
 */

(function () {
  'use strict';

  if (window.__SHOPEE_AFFILIATE_DL_INITIALIZED__) return;
  window.__SHOPEE_AFFILIATE_DL_INITIALIZED__ = true;

  let isCancelled = false;
  let isProcessing = false;
  let detectedItems = [];

  // References to Services
  const ScraperService = window.ShopeeScraperService;
  const Storage = window.StorageService;
  const CSV = window.CsvService;

  // In-page Toast Helper
  function showInPageToast(message, isSuccess = true) {
    const existing = document.getElementById('shopee-dl-inpage-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'shopee-dl-inpage-toast';
    toast.className = 'shopee-dl-toast';
    if (!isSuccess) toast.style.borderLeftColor = '#ef4444';
    toast.innerHTML = `<span>${isSuccess ? '✅' : '⚠️'}</span> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Create floating trigger button
  function createFloatingTrigger() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createFloatingTrigger, { once: true });
      }
      return;
    }

    let btn = document.getElementById('shopee-dl-float-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'shopee-dl-float-btn';
      btn.innerHTML = `<span>📦 เครื่องมือ Affiliate</span><span class="badge" id="shopee-dl-badge">0</span>`;
      document.body.appendChild(btn);

      btn.addEventListener('click', () => {
        openOrTogglePanel();
      });
    } else if (!document.body.contains(btn)) {
      document.body.appendChild(btn);
    }

    updateDetectedCount();
  }

  function updateDetectedCount() {
    detectedItems = ScraperService ? ScraperService.findProductItems() : [];
    const currentPage = ScraperService ? ScraperService.getCurrentPageNumber() : 1;
    const badge = document.getElementById('shopee-dl-badge');
    if (badge) {
      badge.textContent = `${detectedItems.length}`;
    }
    const countEl = document.getElementById('dl-count-num');
    if (countEl) {
      countEl.textContent = `${detectedItems.length} (หน้า ${currentPage})`;
    }
  }

  // Open or toggle main Downloader Panel
  function openOrTogglePanel() {
    let ui = document.getElementById('shopee-downloader-ui');
    if (ui) {
      ui.remove();
      return;
    }

    detectedItems = ScraperService ? ScraperService.findProductItems() : [];
    const currentPage = ScraperService ? ScraperService.getCurrentPageNumber() : 1;

    ui = document.createElement('div');
    ui.id = 'shopee-downloader-ui';
    ui.innerHTML = `
      <div class="shopee-dl-header">
        <h3 class="shopee-dl-title">
          📦 Shopee <span style="color: #ff7337;">เครื่องมือ Affiliate</span>
        </h3>
        <div class="shopee-dl-header-actions">
          <button id="dl-refresh-btn" class="shopee-dl-icon-btn" title="สแกนสินค้าใหม่">🔄</button>
          <button id="dl-close-btn" class="shopee-dl-icon-btn" title="ปิด">✕</button>
        </div>
      </div>
      
      <div class="shopee-dl-stats">
        <span>สินค้าในหน้านี้:</span>
        <b id="dl-count-num">${detectedItems.length} (หน้า ${currentPage})</b>
      </div>

      <div class="shopee-dl-progress-track">
        <div id="dl-progress-bar" class="shopee-dl-progress-bar"></div>
      </div>

      <div id="dl-status" class="shopee-dl-status">
        พร้อมดึงข้อมูลสินค้า บันทึกลงแดชบอร์ด หรือดาวน์โหลดไฟล์ ZIP
      </div>

      <div class="shopee-dl-controls">
        <button id="dl-save-dash-btn" class="shopee-dl-btn-primary">
          💾 บันทึกลงแดชบอร์ด & CSV (${detectedItems.length})
        </button>

        <button id="dl-hub-btn" class="shopee-dl-btn-primary" style="background: linear-gradient(135deg, #10b981, #0d9488); margin-top: 6px;">
          📤 ส่งเข้าคลังโฆษณา (Ad Hub)
        </button>

        <button id="dl-start-zip-btn" class="shopee-dl-btn-primary" style="background: linear-gradient(135deg, #3b82f6, #6366f1); margin-top: 6px;">
          ⚡ สร้างไฟล์ ZIP & ดาวน์โหลดรูปภาพ
        </button>

        <button id="dl-open-dash-btn" class="shopee-dl-btn-stop" style="display: flex; background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); color: #f1f5f9; margin-top: 6px;">
          📊 เปิดแดชบอร์ดสินค้า & CSV
        </button>

        <button id="dl-stop-btn" class="shopee-dl-btn-stop">
          🛑 ยกเลิกการทำงาน
        </button>
      </div>

      <div class="shopee-dl-options">
        <div class="shopee-dl-option-row">
          <span>📄 จำนวนหน้าที่ต้องการดึง:</span>
          <select id="dl-pages-select">
            <option value="1" selected>เฉพาะหน้าปัจจุบัน (1 หน้า)</option>
            <option value="2">ดึงข้อมูลอัตโนมัติ 2 หน้า</option>
            <option value="3">ดึงข้อมูลอัตโนมัติ 3 หน้า</option>
            <option value="5">ดึงข้อมูลอัตโนมัติ 5 หน้า</option>
            <option value="10">ดึงข้อมูลอัตโนมัติ 10 หน้า</option>
          </select>
        </div>
        <div class="shopee-dl-option-row">
          <span>⏱️ ระยะเวลาหน่วงต่อสินค้า:</span>
          <select id="dl-delay-select">
            <option value="400">เร็ว (400ms)</option>
            <option value="600" selected>ปกติ (600ms)</option>
            <option value="1000">ปลอดภัย (1000ms)</option>
          </select>
        </div>
      </div>
    `;

    document.body.appendChild(ui);

    const saveDashBtn = ui.querySelector('#dl-save-dash-btn');
    const startZipBtn = ui.querySelector('#dl-start-zip-btn');
    const hubBtn = ui.querySelector('#dl-hub-btn');
    const openDashBtn = ui.querySelector('#dl-open-dash-btn');
    const stopBtn = ui.querySelector('#dl-stop-btn');
    const closeBtn = ui.querySelector('#dl-close-btn');
    const refreshBtn = ui.querySelector('#dl-refresh-btn');
    const progressBar = ui.querySelector('#dl-progress-bar');
    const statusText = ui.querySelector('#dl-status');
    const pagesSelect = ui.querySelector('#dl-pages-select');
    const delaySelect = ui.querySelector('#dl-delay-select');

    const setProgressBarPercent = (pct) => {
      if (progressBar) {
        const clamped = Math.min(100, Math.max(0, Math.round(pct)));
        progressBar.style.setProperty('width', `${clamped}%`, 'important');
      }
    };

    refreshBtn.onclick = () => {
      updateDetectedCount();
      const pageNum = ScraperService ? ScraperService.getCurrentPageNumber() : 1;
      statusText.textContent = `พบสินค้า ${detectedItems.length} รายการในหน้า ${pageNum}`;
      setProgressBarPercent(0);
    };

    closeBtn.onclick = () => {
      isCancelled = true;
      ui.remove();
    };

    stopBtn.onclick = () => {
      isCancelled = true;
      statusText.textContent = '🛑 กำลังหยุดการทำงาน...';
      stopBtn.style.display = 'none';
      saveDashBtn.style.display = 'flex';
      hubBtn.style.display = 'flex';
      startZipBtn.style.display = 'flex';
      openDashBtn.style.display = 'flex';
    };

    openDashBtn.onclick = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
      }
    };

    // Helper: Scrape all products across selected pages
    async function runScrapeOperation() {
      const maxPages = parseInt(pagesSelect.value, 10) || 1;
      const delayMs = parseInt(delaySelect.value, 10) || 600;
      setProgressBarPercent(5);

      return await ScraperService.scrapeAcrossPages({
        maxPages,
        delayMs,
        isCancelled: () => isCancelled,
        onProgress: (info) => {
          if (info.phase === 'page_start') {
            statusText.textContent = `📄 กำลังประมวลผลหน้า ${info.pageNum} (${info.pageItemCount} สินค้า)...`;
          } else if (info.phase === 'item_start') {
            const titleCut = (info.product.safeTitle || info.product.title || '').substring(0, 15);
            statusText.textContent = `[หน้า ${info.pageNum} | รายการ ${info.itemIndex}/${info.pageItemCount}] ดึงลิงก์: ${titleCut}...`;
          } else if (info.phase === 'item_complete') {
            const totalTarget = Math.max(1, maxPages * info.pageItemCount);
            const pct = Math.min(85, Math.round((info.totalProcessed / totalTarget) * 85));
            setProgressBarPercent(pct);
          } else if (info.phase === 'switching_page') {
            statusText.textContent = `➡️ กำลังเปลี่ยนไปหน้า ${info.nextPageNum} อัตโนมัติ...`;
          } else if (info.phase === 'switch_failed') {
            statusText.textContent = `⚠️ ไม่มีหน้าถัดไป หรือไม่สามารถโหลดหน้าถัดไปได้`;
          }
        }
      });
    }

    // 1. ACTION: SAVE TO DASHBOARD
    saveDashBtn.onclick = async () => {
      if (isProcessing) return;

      detectedItems = ScraperService ? ScraperService.findProductItems() : [];
      if (detectedItems.length === 0) {
        alert('⚠️ ไม่พบสินค้า Shopee ในหน้านี้ กรุณาเปิดหน้าข้อเสนอสินค้า Affiliate (Product Offer)');
        return;
      }

      isProcessing = true;
      isCancelled = false;
      setProgressBarPercent(0);

      saveDashBtn.style.display = 'none';
      hubBtn.style.display = 'none';
      startZipBtn.style.display = 'none';
      openDashBtn.style.display = 'none';
      stopBtn.style.display = 'flex';

      try {
        const scraped = await runScrapeOperation();

        if (scraped.length > 0 && !isCancelled) {
          statusText.textContent = '💾 กำลังบันทึกข้อมูลสินค้าลงแดชบอร์ด...';
          setProgressBarPercent(92);

          if (Storage) {
            const result = await Storage.mergeProducts(scraped);
            statusText.textContent = `🎉 สำเร็จ! บันทึก ${scraped.length} สินค้าลงแดชบอร์ดแล้ว (ใหม่ ${result.addedCount} รายการ)`;
          } else {
            // Fallback direct storage
            await new Promise((resolve) => {
              if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['shopee_products'], (store) => {
                  const current = Array.isArray(store.shopee_products) ? store.shopee_products : [];
                  const existingMap = new Set(current.map(p => p.title || p.rawTitle));
                  const uniqueNew = scraped.filter(p => !existingMap.has(p.title));
                  const merged = [...current, ...uniqueNew];
                  chrome.storage.local.set({ shopee_products: merged }, () => resolve(merged));
                });
              } else {
                resolve(scraped);
              }
            });
            statusText.textContent = `🎉 สำเร็จ! บันทึก ${scraped.length} สินค้าลงแดชบอร์ดแล้ว`;
          }

          setProgressBarPercent(100);
          showInPageToast(`💾 บันทึกสินค้า ${scraped.length} รายการลงแดชบอร์ดเรียบร้อยแล้ว!`);
        } else if (isCancelled) {
          statusText.textContent = `🛑 หยุดการทำงานแล้ว (ประมวลผลไป ${scraped.length} สินค้า)`;
        }
      } catch (err) {
        console.error(err);
        if (err.message && err.message.includes('Extension context invalidated')) {
          statusText.textContent = `⚠️ ส่วนขยายเพิ่งอัปเดต กรุณารีเฟรช (F5) หน้านี้`;
          alert('⚠️ ส่วนขยายเพิ่งถูกรีโหลด กรุณารีเฟรช (F5) หน้าเว็บ Shopee นี้เพื่อเชื่อมต่อใหม่');
        } else {
          statusText.textContent = `❌ เกิดข้อผิดพลาด: ${err.message}`;
        }
      }

      isProcessing = false;
      stopBtn.style.display = 'none';
      saveDashBtn.style.display = 'flex';
      hubBtn.style.display = 'flex';
      startZipBtn.style.display = 'flex';
      openDashBtn.style.display = 'flex';
    };

    // คำค้นของหน้าที่กำลังดึง: จากพารามิเตอร์ใน URL หรือช่องค้นหาบนหน้า (ใช้เดาหมวดในคลัง)
    function currentSearchKeyword() {
      try {
        const params = new URLSearchParams(window.location.search);
        for (const k of ['keyword', 'q', 'search', 'query', 'k']) {
          if (params.get(k)) return params.get(k).trim();
        }
      } catch (_) {}
      const box = Array.from(document.querySelectorAll('input[type="search"], input[type="text"]'))
        .find(i => i.offsetParent && i.value && !ui.contains(i));
      return box ? box.value.trim() : '';
    }

    const sendMessage = (msg) => new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
      } catch (err) {
        reject(err);
      }
    });

    // 1b. ACTION: ส่งเข้าคลังโฆษณากลาง (Ad Hub) และบันทึกลงแดชบอร์ดในเครื่องด้วย
    hubBtn.onclick = async () => {
      if (isProcessing) return;

      const hub = await sendMessage({ action: 'HUB_STATUS' }).catch(() => null);
      if (!hub || !hub.connected) {
        statusText.textContent = '🔌 ยังไม่ได้เชื่อม Ad Hub กำลังเปิดแดชบอร์ดให้ตั้งค่า...';
        sendMessage({ action: 'OPEN_DASHBOARD', hash: '#tab-adhub' }).catch(() => {});
        return;
      }

      detectedItems = ScraperService ? ScraperService.findProductItems() : [];
      if (detectedItems.length === 0) {
        alert('⚠️ ไม่พบสินค้าในหน้านี้ กรุณาเปิดหน้าข้อเสนอสินค้า Affiliate (Product Offer)');
        return;
      }

      isProcessing = true;
      isCancelled = false;
      setProgressBarPercent(0);
      saveDashBtn.style.display = 'none';
      hubBtn.style.display = 'none';
      startZipBtn.style.display = 'none';
      openDashBtn.style.display = 'none';
      stopBtn.style.display = 'flex';

      try {
        const keyword = currentSearchKeyword();
        const scraped = await runScrapeOperation();

        if (scraped.length > 0 && !isCancelled) {
          setProgressBarPercent(90);
          if (Storage) await Storage.mergeProducts(scraped);

          statusText.textContent = `📤 กำลังส่ง ${scraped.length} สินค้าเข้าคลังโฆษณา...`;
          const pageUrl = window.location.href;
          const res = await sendMessage({
            action: 'HUB_IMPORT',
            keyword,
            products: scraped.map(p => ({ ...p, pageUrl })),
          });
          if (!res || !res.success) throw new Error(res?.error || 'ส่งไม่สำเร็จ');

          setProgressBarPercent(100);
          statusText.textContent = `🎉 ส่งเข้าคลังแล้ว: ใหม่ ${res.added} · อัปเดตของเดิม ${res.updated}${res.skipped ? ` · ข้าม ${res.skipped} (เอาลิงก์ affiliate ไม่ได้)` : ''}`;
          showInPageToast(`📤 ส่งเข้าคลังโฆษณา ใหม่ ${res.added} รายการ อัปเดต ${res.updated} รายการ`);
        } else if (isCancelled) {
          statusText.textContent = `🛑 หยุดการทำงานแล้ว (ยังไม่ได้ส่งเข้าคลัง)`;
        }
      } catch (err) {
        console.error(err);
        if (err.message && err.message.includes('Extension context invalidated')) {
          statusText.textContent = `⚠️ ส่วนขยายเพิ่งอัปเดต กรุณารีเฟรช (F5) หน้านี้`;
        } else {
          statusText.textContent = `❌ ส่งเข้าคลังไม่สำเร็จ: ${err.message}`;
          showInPageToast(`ส่งเข้าคลังไม่สำเร็จ: ${err.message}`, false);
        }
      }

      isProcessing = false;
      stopBtn.style.display = 'none';
      saveDashBtn.style.display = 'flex';
      hubBtn.style.display = 'flex';
      startZipBtn.style.display = 'flex';
      openDashBtn.style.display = 'flex';
    };

    // 2. ACTION: GENERATE ZIP & DOWNLOAD
    startZipBtn.onclick = async () => {
      if (isProcessing) return;

      detectedItems = ScraperService ? ScraperService.findProductItems() : [];
      if (detectedItems.length === 0) {
        alert('⚠️ ไม่พบสินค้า Shopee ในหน้านี้ กรุณาเปิดหน้าข้อเสนอสินค้า Affiliate');
        return;
      }

      isProcessing = true;
      isCancelled = false;
      setProgressBarPercent(0);

      saveDashBtn.style.display = 'none';
      hubBtn.style.display = 'none';
      startZipBtn.style.display = 'none';
      openDashBtn.style.display = 'none';
      stopBtn.style.display = 'flex';

      try {
        const scraped = await runScrapeOperation();

        if (scraped.length > 0 && !isCancelled) {
          statusText.textContent = '📦 กำลังรวบรวมรูปภาพและไฟล์ลงใน ZIP...';

          if (CSV) {
            await CSV.downloadZIP(scraped, {
              isCancelled: () => isCancelled,
              onProgress: (curr, total) => {
                const zipPct = 85 + Math.round((curr / Math.max(1, total)) * 15);
                setProgressBarPercent(zipPct);
                statusText.textContent = `📦 กำลังบีบอัดรูปภาพ [${curr}/${total}]...`;
              }
            });
          }

          setProgressBarPercent(100);
          statusText.textContent = `🎉 เสร็จสิ้น! บันทึก ${scraped.length} สินค้าในไฟล์ ZIP แล้ว`;
          showInPageToast(`ดาวน์โหลดไฟล์ ZIP สำเร็จ (${scraped.length} สินค้า)`);
        }
      } catch (err) {
        console.error(err);
        if (err.message && err.message.includes('Extension context invalidated')) {
          statusText.textContent = `⚠️ ส่วนขยายเพิ่งอัปเดต กรุณารีเฟรช (F5) หน้านี้`;
          alert('⚠️ ส่วนขยายเพิ่งถูกรีโหลด กรุณารีเฟรช (F5) หน้าเว็บ Shopee นี้เพื่อเชื่อมต่อใหม่');
        } else {
          statusText.textContent = `❌ เกิดข้อผิดพลาด: ${err.message}`;
        }
      }

      isProcessing = false;
      stopBtn.style.display = 'none';
      saveDashBtn.style.display = 'flex';
      hubBtn.style.display = 'flex';
      startZipBtn.style.display = 'flex';
      openDashBtn.style.display = 'flex';
    };
  }

  // Setup periodic scanner & DOM observer for dynamically rendered products
  createFloatingTrigger();
  setInterval(() => {
    createFloatingTrigger();
    updateDetectedCount();
  }, 2000);

  // Listen for messages from popup.js
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'GET_STATUS') {
        const items = ScraperService ? ScraperService.findProductItems() : [];
        sendResponse({
          detectedCount: items.length,
          isDownloading: isProcessing,
          url: window.location.href
        });
      } else if (request.action === 'OPEN_PANEL') {
        openOrTogglePanel();
        sendResponse({ success: true });
      }
      return true;
    });
  }

  console.log('📦 [ShopeeAffiliateTH] Content script พร้อมใช้งานบน Shopee ประเทศไทย!');
})();
