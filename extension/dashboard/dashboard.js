/**
 * Shopee Affiliate TH — CSV & Product Dashboard Controller (Thai Edition)
 * Refactored to modular architecture using CsvService and StorageService.
 * 
 * Author: sodikinnaa
 * License: MIT
 */

(function () {
  'use strict';

  // Modular Services
  const Storage = window.StorageService;
  const CSV = window.CsvService;
  const ThreadsService = window.ThreadsContentService;

  // State Management
  const state = {
    products: [],
    searchQuery: '',
    sortBy: 'newest',
    activeTab: 'tab-products',
    csvImportPending: [],
    selectedThreadsProductId: null,
    selectedThreadsTemplateId: 'racun_shopee',
    selectedHashtagCategory: 'viral',
    selectedHashtagCount: 3,
    threadsGeneratedCaption: ''
  };

  // DOM Elements Cache
  let dom = {};

  function initDOM() {
    dom = {
      // Tabs
      navItems: document.querySelectorAll('.nav-item'),
      tabPanes: document.querySelectorAll('.tab-pane'),
      activeTabTitle: document.getElementById('active-tab-title'),

      // Metrics
      statTotalProducts: document.getElementById('stat-total-products'),
      statTotalValue: document.getElementById('stat-total-value'),
      statAvgCommission: document.getElementById('stat-avg-commission'),
      statTotalSold: document.getElementById('stat-total-sold'),
      sidebarProductCount: document.getElementById('sidebar-product-count'),
      badgeTotalProducts: document.getElementById('badge-total-products'),

      // Table & Toolbar
      productsTableBody: document.getElementById('products-table-body'),
      emptyTableState: document.getElementById('empty-table-state'),
      productSearchInput: document.getElementById('product-search-input'),
      searchClearBtn: document.getElementById('search-clear-btn'),
      productSortFilter: document.getElementById('product-sort-filter'),
      btnAddManualProduct: document.getElementById('btn-add-manual-product'),
      btnClearAllProducts: document.getElementById('btn-clear-all-products'),

      // Header Buttons
      btnHeaderImportCsv: document.getElementById('btn-header-import-csv'),
      btnHeaderExportCsv: document.getElementById('btn-header-export-csv'),
      btnHeaderDownloadZip: document.getElementById('btn-header-download-zip'),
      emptyImportBtn: document.getElementById('empty-import-btn'),

      // Import / Export Section
      csvDropzone: document.getElementById('csv-dropzone'),
      csvFileInput: document.getElementById('csv-file-input'),
      btnBrowseCsv: document.getElementById('btn-browse-csv'),
      csvImportPreviewBox: document.getElementById('csv-import-preview-box'),
      csvPreviewFilename: document.getElementById('csv-preview-filename'),
      csvPreviewCount: document.getElementById('csv-preview-count'),
      csvPreviewTbody: document.getElementById('csv-preview-tbody'),
      btnCancelImport: document.getElementById('btn-cancel-import'),
      btnConfirmImport: document.getElementById('btn-confirm-import'),
      btnExportCsvDirect: document.getElementById('btn-export-csv-direct'),
      btnExportTxtDirect: document.getElementById('btn-export-txt-direct'),
      btnExportZipDirect: document.getElementById('btn-export-zip-direct'),

      // Threads Content Generator Section
      threadsProductSelect: document.getElementById('threads-product-select'),
      threadsTemplateSelect: document.getElementById('threads-template-select'),
      threadsHashtagCategory: document.getElementById('threads-hashtag-category'),
      threadsHashtagCount: document.getElementById('threads-hashtag-count'),
      threadsCaptionEditor: document.getElementById('threads-caption-editor'),
      threadsCharCount: document.getElementById('threads-char-count'),
      threadsCharStatus: document.getElementById('threads-char-status'),
      btnThreadsCleanEmoji: document.getElementById('btn-threads-clean-emoji'),
      btnThreadsSpinCaption: document.getElementById('btn-threads-spin-caption'),
      btnThreadsCopyCaption: document.getElementById('btn-threads-copy-caption'),
      btnThreadsOpenWeb: document.getElementById('btn-threads-open-web'),
      btnThreadsFillTab: document.getElementById('btn-threads-fill-tab'),

      // Threads Live Preview Mockup
      previewThreadsText: document.getElementById('preview-threads-text'),
      previewThreadsImageWrap: document.getElementById('preview-threads-image-wrap'),
      previewThreadsImage: document.getElementById('preview-threads-image'),
      previewThreadsLinkCard: document.getElementById('preview-threads-link-card'),
      previewLinkTitle: document.getElementById('preview-link-title'),
      previewLinkSub: document.getElementById('preview-link-sub'),

      // Modals
      modalProductEdit: document.getElementById('modal-product-edit'),
      formProductEdit: document.getElementById('form-product-edit'),
      modalEditTitle: document.getElementById('modal-edit-title'),
      modalEditClose: document.getElementById('modal-edit-close'),
      modalEditCancel: document.getElementById('modal-edit-cancel'),
      editProductId: document.getElementById('edit-product-id'),
      editProductTitle: document.getElementById('edit-product-title'),
      editProductPrice: document.getElementById('edit-product-price'),
      editProductCommission: document.getElementById('edit-product-commission'),
      editProductSold: document.getElementById('edit-product-sold'),
      editProductImage: document.getElementById('edit-product-image'),
      editProductShortlink: document.getElementById('edit-product-shortlink'),
      editProductLonglink: document.getElementById('edit-product-longlink'),

      // Image Preview Modal
      modalImagePreview: document.getElementById('modal-image-preview'),
      modalImgClose: document.getElementById('modal-img-close'),
      imgPreviewTarget: document.getElementById('img-preview-target'),
      imgPreviewTitle: document.getElementById('img-preview-title'),
      imgPreviewDownloadLink: document.getElementById('img-preview-download-link'),

      // Toast
      dashboardToast: document.getElementById('dashboard-toast'),
      toastMessage: document.getElementById('toast-message')
    };
  }

  // ==========================================================================
  // 1. Toast & UI Notification Helper
  // ==========================================================================
  function showToast(message, isSuccess = true) {
    if (!dom.dashboardToast || !dom.toastMessage) return;
    dom.toastMessage.textContent = message;
    dom.dashboardToast.querySelector('.toast-icon').textContent = isSuccess ? '✅' : '⚠️';
    dom.dashboardToast.style.borderLeftColor = isSuccess ? 'var(--color-emerald)' : 'var(--color-red)';
    dom.dashboardToast.classList.add('show');

    setTimeout(() => {
      dom.dashboardToast.classList.remove('show');
    }, 3500);
  }

  // ==========================================================================
  // 2. Formatting & Math Utilities
  // ==========================================================================
  function parsePriceNumber(priceStr) {
    if (!priceStr) return 0;
    const clean = String(priceStr).replace(/,/g, '').replace(/[^0-9.]/g, '');
    return parseFloat(clean) || 0;
  }

  function formatBaht(num) {
    if (isNaN(num) || num === 0) return '฿0';
    return '฿' + Math.round(num).toLocaleString('th-TH');
  }

  function parseSoldNumber(soldStr) {
    if (!soldStr) return 0;
    const lower = String(soldStr).toLowerCase().replace(/terjual|ขายแล้ว|ชิ้น/g, '').trim();
    if (lower.includes('หมื่น')) {
      const floatVal = parseFloat(lower.replace(/[^0-9.]/g, '')) || 0;
      return Math.round(floatVal * 10000);
    }
    if (lower.includes('พัน') || lower.includes('rb') || lower.includes('k')) {
      const floatVal = parseFloat(lower.replace(/[^0-9.]/g, '')) || 0;
      return Math.round(floatVal * 1000);
    }
    return parseInt(lower.replace(/[^0-9]/g, ''), 10) || 0;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ==========================================================================
  // 3. Metrics & Stats Calculator
  // ==========================================================================
  function updateDashboardMetrics() {
    const totalCount = state.products.length;
    let totalValue = 0;
    let totalSold = 0;
    let commissionSum = 0;
    let commissionCount = 0;

    state.products.forEach(p => {
      totalValue += parsePriceNumber(p.price);
      totalSold += parseSoldNumber(p.sold);

      if (p.commission) {
        const commNum = parseFloat(String(p.commission).replace(/[^0-9.]/g, ''));
        if (!isNaN(commNum) && commNum > 0) {
          commissionSum += commNum;
          commissionCount++;
        }
      }
    });

    const avgComm = commissionCount > 0 ? (commissionSum / commissionCount).toFixed(1) + '%' : '10.0%';

    if (dom.statTotalProducts) dom.statTotalProducts.textContent = totalCount;
    if (dom.statTotalValue) dom.statTotalValue.textContent = formatBaht(totalValue);
    if (dom.statAvgCommission) dom.statAvgCommission.textContent = avgComm;
    if (dom.statTotalSold) dom.statTotalSold.textContent = totalSold >= 1000 ? (totalSold / 1000).toFixed(1) + 'พัน+' : `${totalSold}+`;
    if (dom.sidebarProductCount) dom.sidebarProductCount.textContent = `บันทึกไว้ ${totalCount} สินค้า`;
    if (dom.badgeTotalProducts) dom.badgeTotalProducts.textContent = totalCount;
  }

  // ==========================================================================
  // 4. Products Table Renderer
  // ==========================================================================
  function renderProductsTable() {
    if (!dom.productsTableBody) return;

    let items = [...state.products];

    // Filter by search query
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      items = items.filter(it => {
        const title = (it.title || it.rawTitle || '').toLowerCase();
        const link = (it.shortLink || it.link || '').toLowerCase();
        const id = (it.id || it.shopeeId || '').toLowerCase();
        return title.includes(q) || link.includes(q) || id.includes(q);
      });
    }

    // Sort items
    if (state.sortBy === 'newest') {
      items.reverse();
    } else if (state.sortBy === 'price_high') {
      items.sort((a, b) => parsePriceNumber(b.price) - parsePriceNumber(a.price));
    } else if (state.sortBy === 'price_low') {
      items.sort((a, b) => parsePriceNumber(a.price) - parsePriceNumber(b.price));
    } else if (state.sortBy === 'title_asc') {
      items.sort((a, b) => (a.title || a.rawTitle || '').localeCompare(b.title || b.rawTitle || ''));
    }

    if (items.length === 0) {
      dom.productsTableBody.innerHTML = '';
      if (dom.emptyTableState) dom.emptyTableState.style.display = 'flex';
      return;
    }

    if (dom.emptyTableState) dom.emptyTableState.style.display = 'none';

    dom.productsTableBody.innerHTML = items.map((p, idx) => {
      const title = p.title || p.rawTitle || 'สินค้า Shopee';
      const imageUrl = p.image || p.cleanImgUrl || (Array.isArray(p.images) && p.images[0]) || '';
      const rawP = p.price ? String(p.price).trim() : '-';
      const price = rawP !== '-' ? ((rawP.startsWith('฿') || rawP.startsWith('THB') || rawP.startsWith('Rp')) ? rawP : `฿${rawP}`) : '-';
      const commission = p.commission || '10%';
      const sold = p.sold || 'ขายแล้ว 1พัน+ ชิ้น';
      const shortLink = p.shortLink || p.link || 'https://s.shopee.co.th';
      const longLink = p.longLink || p.url || `https://affiliate.shopee.co.th/offer/product_offer/${p.shopeeId || ''}`;
      const id = p.id || `prod_${idx}`;

      return `
        <tr data-id="${id}">
          <td style="text-align: center; color: var(--text-dim); font-weight: 700;">${idx + 1}</td>
          <td style="text-align: center;">
            <img src="${imageUrl}" alt="Thumbnail" class="table-product-thumb" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'52\\' height=\\'52\\' fill=\\'%23333\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%231e293b\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%2364748b\\' font-size=\\'9\\'>No Img</text></svg>'">
          </td>
          <td>
            <a href="${longLink}" target="_blank" class="table-product-title" title="${escapeHtml(title)}">${escapeHtml(title)}</a>
            <span class="table-meta-text">ID: ${p.shopeeId || id.substring(0, 10)}</span>
          </td>
          <td>
            <span class="table-price-badge">${escapeHtml(price)}</span>
          </td>
          <td>
            <div style="font-weight: 700; color: var(--color-emerald); font-size: 12.5px;">${escapeHtml(commission)}</div>
            <div class="table-meta-text">${escapeHtml(sold)}</div>
          </td>
          <td>
            <div class="table-link-box">
              <span class="table-link-code" title="${escapeHtml(shortLink)}">${escapeHtml(shortLink)}</span>
              <button class="btn-mini-copy" data-copy="${escapeHtml(shortLink)}" title="คัดลอกลิงก์ Affiliate">📋 คัดลอก</button>
            </div>
          </td>
          <td>
            <div class="table-actions-cell">
              <button class="btn-action-icon btn-threads-prod" data-id="${id}" title="🧵 สร้างแคปชัน Threads">🧵</button>
              <button class="btn-action-icon btn-dl-img" data-img="${imageUrl}" data-title="${escapeHtml(title)}" title="ดาวน์โหลดรูปภาพ HD">📥</button>
              <button class="btn-action-icon btn-edit-prod" data-id="${id}" title="แก้ไขข้อมูล">✏️</button>
              <button class="btn-action-icon danger btn-del-prod" data-id="${id}" title="ลบสินค้า">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    bindTableEvents();
  }

  // ==========================================================================
  // 5. Event Bindings
  // ==========================================================================
  function bindTableEvents() {
    // 1. Copy Link Buttons
    document.querySelectorAll('.btn-mini-copy').forEach(btn => {
      btn.onclick = () => {
        const text = btn.getAttribute('data-copy');
        if (text) {
          navigator.clipboard.writeText(text);
          btn.textContent = '✅ คัดลอกแล้ว!';
          setTimeout(() => { btn.textContent = '📋 คัดลอก'; }, 1500);
          showToast('คัดลอกลิงก์ Affiliate ไปยังคลิปบอร์ดแล้ว!');
        }
      };
    });

    // 2. Image Thumbnail Click (HD Preview Modal)
    document.querySelectorAll('.table-product-thumb').forEach(img => {
      img.onclick = () => {
        const src = img.src;
        if (src && !src.startsWith('data:')) {
          dom.imgPreviewTarget.src = src;
          dom.imgPreviewDownloadLink.href = src;
          dom.imgPreviewDownloadLink.download = `shopee_product_${Date.now()}.jpg`;
          dom.modalImagePreview.classList.add('show');
        }
      };
    });

    // 2b. Open in Threads Generator Button
    document.querySelectorAll('.btn-threads-prod').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        openThreadsGeneratorForProduct(id);
      };
    });

    // 3. Download Single Image Button
    document.querySelectorAll('.btn-dl-img').forEach(btn => {
      btn.onclick = async () => {
        const url = btn.getAttribute('data-img');
        const title = (btn.getAttribute('data-title') || 'product').replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_').substring(0, 30);
        if (url) {
          try {
            const res = await fetch(url);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${title}_${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            showToast('ดาวน์โหลดรูปภาพสินค้าเรียบร้อยแล้ว!');
          } catch (e) {
            window.open(url, '_blank');
          }
        }
      };
    });

    // 4. Edit Product Button
    document.querySelectorAll('.btn-edit-prod').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const product = state.products.find(p => p.id === id);
        if (product) {
          openEditModal(product);
        }
      };
    });

    // 5. Delete Single Product Button
    document.querySelectorAll('.btn-del-prod').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบสินค้ารายการนี้ออกจากแดชบอร์ด?')) {
          if (Storage) {
            state.products = await Storage.deleteProduct(id);
          } else {
            state.products = state.products.filter(p => p.id !== id);
          }
          updateDashboardMetrics();
          renderProductsTable();
          showToast('ลบสินค้าเรียบร้อยแล้ว!');
        }
      };
    });
  }

  function openEditModal(product = null) {
    if (product) {
      dom.modalEditTitle.textContent = '✏️ แก้ไขข้อมูลสินค้า Shopee';
      dom.editProductId.value = product.id || '';
      dom.editProductTitle.value = product.title || product.rawTitle || '';
      dom.editProductPrice.value = product.price || '';
      dom.editProductCommission.value = product.commission || '';
      dom.editProductSold.value = product.sold || '';
      dom.editProductImage.value = product.image || product.cleanImgUrl || '';
      dom.editProductShortlink.value = product.shortLink || product.link || '';
      dom.editProductLonglink.value = product.longLink || product.url || '';
    } else {
      dom.modalEditTitle.textContent = '➕ เพิ่มสินค้าด้วยตนเอง';
      dom.formProductEdit.reset();
      dom.editProductId.value = `manual_${Date.now()}`;
    }
    dom.modalProductEdit.classList.add('show');
  }

  // ==========================================================================
  // 5b. Threads Content Generator Logic
  // ==========================================================================
  function updateThreadsProductOptions() {
    if (!dom.threadsProductSelect) return;
    const currentVal = dom.threadsProductSelect.value;
    dom.threadsProductSelect.innerHTML = '<option value="">-- เลือกสินค้า Shopee --</option>' +
      state.products.map(p => {
        const title = p.title || p.rawTitle || 'สินค้า Shopee';
        const rawP = p.price ? String(p.price).trim() : '';
        const price = rawP ? ((rawP.startsWith('฿') || rawP.startsWith('Rp')) ? rawP : `฿${rawP}`) : '';
        const shortTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;
        return `<option value="${p.id}">${escapeHtml(shortTitle)} (${escapeHtml(price)})</option>`;
      }).join('');

    if (currentVal && state.products.some(p => p.id === currentVal)) {
      dom.threadsProductSelect.value = currentVal;
    } else if (state.selectedThreadsProductId) {
      dom.threadsProductSelect.value = state.selectedThreadsProductId;
    }
  }

  function openThreadsGeneratorForProduct(productId) {
    state.selectedThreadsProductId = productId;
    const tabBtn = document.querySelector('[data-tab="tab-threads-generator"]');
    if (tabBtn) tabBtn.click();

    updateThreadsProductOptions();
    if (dom.threadsProductSelect) {
      dom.threadsProductSelect.value = productId;
    }
    generateAndRenderThreadsCaption();
  }

  function getSelectedThreadsProduct() {
    const prodId = dom.threadsProductSelect ? dom.threadsProductSelect.value : state.selectedThreadsProductId;
    return state.products.find(p => p.id === prodId) || null;
  }

  function generateAndRenderThreadsCaption() {
    const product = getSelectedThreadsProduct();
    if (!product) {
      if (dom.threadsCaptionEditor) dom.threadsCaptionEditor.value = '';
      if (dom.previewThreadsText) dom.previewThreadsText.textContent = 'เลือกสินค้าทางด้านซ้ายเพื่อดูตัวอย่างโพสต์บน Threads...';
      if (dom.previewThreadsImageWrap) dom.previewThreadsImageWrap.style.display = 'none';
      if (dom.previewThreadsLinkCard) dom.previewThreadsLinkCard.style.display = 'none';
      updateThreadsCharacterCount('');
      return;
    }

    const templateId = dom.threadsTemplateSelect ? dom.threadsTemplateSelect.value : state.selectedThreadsTemplateId;
    const hashtagCategory = dom.threadsHashtagCategory ? dom.threadsHashtagCategory.value : state.selectedHashtagCategory;
    const hashtagCount = dom.threadsHashtagCount ? parseInt(dom.threadsHashtagCount.value, 10) : state.selectedHashtagCount;

    let templateObj = null;
    if (ThreadsService && typeof ThreadsService.getTemplateById === 'function') {
      templateObj = ThreadsService.getTemplateById(templateId);
    }

    let caption = '';
    if (ThreadsService && typeof ThreadsService.generateCaption === 'function') {
      caption = ThreadsService.generateCaption(templateObj || templateId, product, {
        category: hashtagCategory,
        hashtagCount
      });
    } else {
      caption = `${product.title || product.rawTitle}\n\n💸 ราคา: ${product.price}\n🔗 พิกัด: ${product.shortLink || product.link}\n\n#ป้ายยาShopee #รีวิวShopee`;
    }

    state.threadsGeneratedCaption = caption;
    if (dom.threadsCaptionEditor) {
      dom.threadsCaptionEditor.value = caption;
    }

    updateThreadsLivePreview(caption, product);
    updateThreadsCharacterCount(caption);
  }

  function updateThreadsLivePreview(captionText, product = null) {
    const prod = product || getSelectedThreadsProduct();

    if (dom.previewThreadsText) {
      dom.previewThreadsText.textContent = captionText || (prod ? prod.title : 'เลือกสินค้าเพื่อดูตัวอย่าง...');
    }

    const imgUrl = prod ? (prod.image || prod.cleanImgUrl || (Array.isArray(prod.images) && prod.images[0]) || '') : '';
    if (dom.previewThreadsImageWrap && dom.previewThreadsImage) {
      if (imgUrl) {
        dom.previewThreadsImage.src = imgUrl;
        dom.previewThreadsImageWrap.style.display = 'block';
      } else {
        dom.previewThreadsImageWrap.style.display = 'none';
      }
    }

    const shortLink = prod ? (prod.shortLink || prod.link || '') : '';
    if (dom.previewThreadsLinkCard && dom.previewLinkTitle && dom.previewLinkSub) {
      if (shortLink) {
        dom.previewLinkTitle.textContent = prod.title || 'สินค้า Shopee';
        dom.previewLinkSub.textContent = `ราคา: ${prod.price || '-'} | ${prod.sold || 'ขายดี'}`;
        dom.previewThreadsLinkCard.style.display = 'block';
      } else {
        dom.previewThreadsLinkCard.style.display = 'none';
      }
    }
  }

  function updateThreadsCharacterCount(text) {
    if (!dom.threadsCharCount || !dom.threadsCharStatus) return;
    const len = (text || '').length;
    dom.threadsCharCount.textContent = `${len} / 500 ตัวอักษร`;

    if (len > 500) {
      dom.threadsCharStatus.textContent = `⚠️ เกินกำหนด (${len - 500} ตัวอักษร)`;
      dom.threadsCharStatus.className = 'status-over';
    } else {
      dom.threadsCharStatus.textContent = 'รองรับบน Threads';
      dom.threadsCharStatus.className = 'status-ok';
    }
  }

  // ==========================================================================
  // 6. CSV File Handler
  // ==========================================================================
  function handleCsvFileSelected(file) {
    if (!file.name.endsWith('.csv')) {
      alert('⚠️ กรุณาเลือกไฟล์นามสกุล .csv เท่านั้น');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsed = CSV ? CSV.parseCSV(text) : [];
      if (parsed.length === 0) {
        alert('⚠️ ไม่สามารถอ่านรูปแบบไฟล์ CSV ได้ หรือไฟล์ว่างเปล่า');
        return;
      }

      state.csvImportPending = parsed;
      dom.csvPreviewFilename.textContent = file.name;
      dom.csvPreviewCount.textContent = `พร้อมนำเข้า ${parsed.length} สินค้า`;

      dom.csvPreviewTbody.innerHTML = parsed.slice(0, 5).map(p => `
        <tr>
          <td>${escapeHtml(p.title)}</td>
          <td>${escapeHtml(p.price)}</td>
          <td>${escapeHtml(p.commission)}</td>
          <td style="color: #93c5fd;">${escapeHtml(p.shortLink)}</td>
        </tr>
      `).join('');

      dom.csvImportPreviewBox.style.display = 'block';
    };
    reader.readAsText(file);
  }

  // ==========================================================================
  // 7. Main App Initializer
  // ==========================================================================
  function initApp() {
    initDOM();

    // 1. Navigation Tab Switching
    dom.navItems.forEach(btn => {
      btn.onclick = () => {
        const targetTab = btn.getAttribute('data-tab');
        state.activeTab = targetTab;

        dom.navItems.forEach(b => b.classList.remove('active'));
        dom.tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetPane = document.getElementById(targetTab);
        if (targetPane) targetPane.classList.add('active');

        if (targetTab === 'tab-products') {
          dom.activeTabTitle.textContent = 'รายการสินค้า & CSV';
        } else if (targetTab === 'tab-threads-generator') {
          dom.activeTabTitle.textContent = 'สร้างแคปชัน Threads';
          updateThreadsProductOptions();
          if (!state.selectedThreadsProductId && state.products.length > 0) {
            state.selectedThreadsProductId = state.products[0].id;
            if (dom.threadsProductSelect) dom.threadsProductSelect.value = state.products[0].id;
          }
          generateAndRenderThreadsCaption();
        } else if (targetTab === 'tab-import-export') {
          dom.activeTabTitle.textContent = 'นำเข้า & ส่งออก CSV';
        } else if (targetTab === 'tab-guide') {
          dom.activeTabTitle.textContent = 'คู่มือการใช้งาน';
        }
      };
    });

    // 1b. Threads Content Generator Event Listeners
    if (dom.threadsProductSelect) {
      dom.threadsProductSelect.onchange = () => {
        state.selectedThreadsProductId = dom.threadsProductSelect.value;
        generateAndRenderThreadsCaption();
      };
    }

    if (dom.threadsTemplateSelect) {
      dom.threadsTemplateSelect.onchange = () => {
        state.selectedThreadsTemplateId = dom.threadsTemplateSelect.value;
        generateAndRenderThreadsCaption();
      };
    }

    if (dom.threadsHashtagCategory) {
      dom.threadsHashtagCategory.onchange = () => {
        state.selectedHashtagCategory = dom.threadsHashtagCategory.value;
        generateAndRenderThreadsCaption();
      };
    }

    if (dom.threadsHashtagCount) {
      dom.threadsHashtagCount.onchange = () => {
        state.selectedHashtagCount = parseInt(dom.threadsHashtagCount.value, 10) || 3;
        generateAndRenderThreadsCaption();
      };
    }

    if (dom.btnThreadsCleanEmoji) {
      dom.btnThreadsCleanEmoji.onclick = () => {
        if (!dom.threadsCaptionEditor) return;
        let currentText = dom.threadsCaptionEditor.value;
        if (!currentText) return;
        if (ThreadsService && typeof ThreadsService.stripEmojis === 'function') {
          currentText = ThreadsService.stripEmojis(currentText);
        }
        dom.threadsCaptionEditor.value = currentText;
        state.threadsGeneratedCaption = currentText;
        updateThreadsLivePreview(currentText);
        updateThreadsCharacterCount(currentText);
        showToast('🧹 ล้างสัญลักษณ์และอิโมจิเรียบร้อยแล้ว!');
      };
    }

    if (dom.btnThreadsSpinCaption) {
      dom.btnThreadsSpinCaption.onclick = () => {
        const prod = getSelectedThreadsProduct();
        if (!prod) {
          showToast('กรุณาเลือกสินค้า Shopee ก่อน!', false);
          return;
        }
        generateAndRenderThreadsCaption();
        showToast('🎲 สุ่มรูปแบบแคปชันใหม่เรียบร้อยแล้ว!');
      };
    }

    if (dom.threadsCaptionEditor) {
      dom.threadsCaptionEditor.oninput = () => {
        const val = dom.threadsCaptionEditor.value;
        state.threadsGeneratedCaption = val;
        updateThreadsLivePreview(val);
        updateThreadsCharacterCount(val);
      };
    }

    if (dom.btnThreadsCopyCaption) {
      dom.btnThreadsCopyCaption.onclick = () => {
        const text = dom.threadsCaptionEditor ? dom.threadsCaptionEditor.value : state.threadsGeneratedCaption;
        if (!text) {
          showToast('แคปชันว่างเปล่า กรุณาเลือกสินค้าก่อน!', false);
          return;
        }
        navigator.clipboard.writeText(text);
        showToast('📋 คัดลอกแคปชัน Threads ไปยังคลิปบอร์ดแล้ว!');
      };
    }

    if (dom.btnThreadsOpenWeb) {
      dom.btnThreadsOpenWeb.onclick = () => {
        const text = dom.threadsCaptionEditor ? dom.threadsCaptionEditor.value : state.threadsGeneratedCaption;
        const url = ThreadsService && typeof ThreadsService.getThreadsIntentUrl === 'function'
          ? ThreadsService.getThreadsIntentUrl(text)
          : 'https://www.threads.net/';
        window.open(url, '_blank');
        showToast('🔗 กำลังเปิด Threads.net...');
      };
    }

    if (dom.btnThreadsFillTab) {
      dom.btnThreadsFillTab.onclick = () => {
        const text = dom.threadsCaptionEditor ? dom.threadsCaptionEditor.value : state.threadsGeneratedCaption;
        if (!text) {
          showToast('แคปชันว่างเปล่า กรุณาเลือกสินค้าก่อน!', false);
          return;
        }

        // Copy to clipboard as safety guarantee
        navigator.clipboard.writeText(text);

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'OPEN_THREADS_AND_PASTE',
            text: text
          }, (res) => {
            showToast('✍️ กำลังเตรียมโพสต์ในแท็บ Threads (ตรวจสอบก่อนกดโพสต์)...');
          });
        } else {
          window.open(`https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`, '_blank');
          showToast('✍️ กำลังเปิดแท็บ Threads...');
        }
      };
    }

    // 2. Search & Sort Handlers
    if (dom.productSearchInput) {
      dom.productSearchInput.oninput = () => {
        state.searchQuery = dom.productSearchInput.value.trim();
        if (dom.searchClearBtn) dom.searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
        renderProductsTable();
      };
    }

    if (dom.searchClearBtn) {
      dom.searchClearBtn.onclick = () => {
        dom.productSearchInput.value = '';
        state.searchQuery = '';
        dom.searchClearBtn.style.display = 'none';
        renderProductsTable();
      };
    }

    if (dom.productSortFilter) {
      dom.productSortFilter.onchange = () => {
        state.sortBy = dom.productSortFilter.value;
        renderProductsTable();
      };
    }

    // 3. Clear All Products
    if (dom.btnClearAllProducts) {
      dom.btnClearAllProducts.onclick = async () => {
        if (state.products.length === 0) {
          showToast('ฐานข้อมูลสินค้าว่างเปล่าอยู่แล้ว', false);
          return;
        }
        if (confirm(`⚠️ คุณต้องการลบสินค้าทั้งหมด ${state.products.length} รายการออกจากแดชบอร์ดหรือไม่?`)) {
          if (Storage) {
            await Storage.clearAll();
          }
          state.products = [];
          state.selectedThreadsProductId = null;
          state.threadsGeneratedCaption = '';
          updateDashboardMetrics();
          renderProductsTable();
          updateThreadsProductOptions();
          generateAndRenderThreadsCaption();
          showToast('ล้างข้อมูลสินค้าทั้งหมดเรียบร้อยแล้ว');
        }
      };
    }

    // 4. Add Manual Product
    if (dom.btnAddManualProduct) {
      dom.btnAddManualProduct.onclick = () => openEditModal(null);
    }

    // 5. Form Edit / Add Submit
    if (dom.formProductEdit) {
      dom.formProductEdit.onsubmit = async (e) => {
        e.preventDefault();
        const id = dom.editProductId.value;
        const newProduct = {
          id,
          title: dom.editProductTitle.value.trim(),
          rawTitle: dom.editProductTitle.value.trim(),
          price: dom.editProductPrice.value.trim(),
          commission: dom.editProductCommission.value.trim() || '10%',
          sold: dom.editProductSold.value.trim() || 'ขายแล้ว 1พัน+ ชิ้น',
          image: dom.editProductImage.value.trim(),
          cleanImgUrl: dom.editProductImage.value.trim(),
          shortLink: dom.editProductShortlink.value.trim(),
          longLink: dom.editProductLonglink.value.trim(),
          createdAt: new Date().toISOString()
        };

        const existingIdx = state.products.findIndex(p => p.id === id);
        let updated = [...state.products];
        if (existingIdx >= 0) {
          updated[existingIdx] = { ...updated[existingIdx], ...newProduct };
        } else {
          updated.unshift(newProduct);
        }

        if (Storage) {
          await Storage.saveProducts(updated);
        }
        state.products = updated;
        updateDashboardMetrics();
        renderProductsTable();
        dom.modalProductEdit.classList.remove('show');
        showToast('บันทึกข้อมูลสินค้าเรียบร้อยแล้ว!');
      };
    }

    // 6. Modal Close Buttons
    if (dom.modalEditClose) dom.modalEditClose.onclick = () => dom.modalProductEdit.classList.remove('show');
    if (dom.modalEditCancel) dom.modalEditCancel.onclick = () => dom.modalProductEdit.classList.remove('show');
    if (dom.modalImgClose) dom.modalImgClose.onclick = () => dom.modalImagePreview.classList.remove('show');

    // 7. Export CSV / TXT / ZIP Handlers
    const handleExportCSV = () => {
      try {
        if (CSV) {
          CSV.downloadCSV(state.products);
          showToast(`ส่งออกสินค้า ${state.products.length} รายการเป็นไฟล์ CSV สำเร็จ!`);
        }
      } catch (err) {
        alert(err.message);
      }
    };

    const handleExportTXT = () => {
      try {
        if (CSV) {
          CSV.downloadTXT(state.products);
          showToast('ดาวน์โหลดไฟล์ TXT สำเร็จ!');
        }
      } catch (err) {
        alert(err.message);
      }
    };

    const handleExportZIP = async () => {
      try {
        if (CSV) {
          showToast('⏳ กำลังรวบรวมรูปภาพสินค้าลงในไฟล์ ZIP...');
          await CSV.downloadZIP(state.products);
          showToast(`ดาวน์โหลดไฟล์ ZIP สำเร็จ!`);
        }
      } catch (err) {
        alert(err.message);
      }
    };

    if (dom.btnHeaderExportCsv) dom.btnHeaderExportCsv.onclick = handleExportCSV;
    if (dom.btnExportCsvDirect) dom.btnExportCsvDirect.onclick = handleExportCSV;
    if (dom.btnExportTxtDirect) dom.btnExportTxtDirect.onclick = handleExportTXT;
    if (dom.btnHeaderDownloadZip) dom.btnHeaderDownloadZip.onclick = handleExportZIP;
    if (dom.btnExportZipDirect) dom.btnExportZipDirect.onclick = handleExportZIP;

    if (dom.btnHeaderImportCsv || dom.emptyImportBtn) {
      const switchTab = () => {
        const importTabBtn = document.querySelector('[data-tab="tab-import-export"]');
        if (importTabBtn) importTabBtn.click();
      };
      if (dom.btnHeaderImportCsv) dom.btnHeaderImportCsv.onclick = switchTab;
      if (dom.emptyImportBtn) dom.emptyImportBtn.onclick = switchTab;
    }

    // 8. CSV Drag & Drop and File Picker
    if (dom.btnBrowseCsv && dom.csvFileInput) {
      dom.btnBrowseCsv.onclick = () => dom.csvFileInput.click();
    }
    if (dom.csvDropzone && dom.csvFileInput) {
      dom.csvDropzone.onclick = (e) => {
        if (e.target !== dom.btnBrowseCsv) dom.csvFileInput.click();
      };

      dom.csvDropzone.ondragover = (e) => {
        e.preventDefault();
        dom.csvDropzone.classList.add('drag-over');
      };
      dom.csvDropzone.ondragleave = () => dom.csvDropzone.classList.remove('drag-over');
      dom.csvDropzone.ondrop = (e) => {
        e.preventDefault();
        dom.csvDropzone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleCsvFileSelected(e.dataTransfer.files[0]);
        }
      };

      dom.csvFileInput.onchange = () => {
        if (dom.csvFileInput.files && dom.csvFileInput.files[0]) {
          handleCsvFileSelected(dom.csvFileInput.files[0]);
        }
      };
    }

    // 9. Confirm CSV Import
    if (dom.btnConfirmImport) {
      dom.btnConfirmImport.onclick = async () => {
        if (state.csvImportPending.length > 0) {
          const importList = state.csvImportPending;
          let addedCount = importList.length;

          if (Storage) {
            const res = await Storage.mergeProducts(importList);
            state.products = res.merged;
            addedCount = res.addedCount;
          } else {
            state.products = [...state.products, ...importList];
          }

          updateDashboardMetrics();
          renderProductsTable();
          dom.csvImportPreviewBox.style.display = 'none';
          state.csvImportPending = [];
          showToast(`🎉 นำเข้าสินค้าใหม่ ${addedCount} รายการเข้าสู่ฐานข้อมูลสำเร็จ!`);

          // Switch back to products tab
          const tabProdBtn = document.querySelector('[data-tab="tab-products"]');
          if (tabProdBtn) tabProdBtn.click();
        }
      };
    }

    if (dom.btnCancelImport) {
      dom.btnCancelImport.onclick = () => {
        dom.csvImportPreviewBox.style.display = 'none';
        state.csvImportPending = [];
      };
    }

    // 10. Load Initial Products from Storage
    if (Storage) {
      Storage.getProducts().then(products => {
        state.products = products || [];
        updateDashboardMetrics();
        renderProductsTable();
        updateThreadsProductOptions();
      });
    }

    // 11. Listen for Storage Changes (e.g. Scraper from content.js)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.shopee_products || changes.threads_queue)) {
          if (Storage) {
            Storage.getProducts().then(products => {
              state.products = products || [];
              updateDashboardMetrics();
              renderProductsTable();
              updateThreadsProductOptions();
            });
          }
        }
      });
    }
  }

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
