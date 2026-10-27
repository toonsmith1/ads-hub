document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const productCount = document.getElementById('product-count');
  const dbCount = document.getElementById('db-count');
  const openDashboardBtn = document.getElementById('open-dashboard-btn');
  const openPanelBtn = document.getElementById('open-panel-btn');
  const openShopeeBtn = document.getElementById('open-shopee-btn');

  // Load database count
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['shopee_products', 'threads_queue'], (store) => {
      const list = store.shopee_products || store.threads_queue || [];
      if (dbCount) dbCount.textContent = list.length;
    });
  }

  // Open Dashboard Button Handler
  if (openDashboardBtn) {
    openDashboardBtn.onclick = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      window.close();
    };
  }

  // Get current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url) {
    statusText.textContent = 'ไม่สามารถตรวจจับแท็บปัจจุบันได้';
    return;
  }

  const isShopee = tab.url.includes('shopee.co.th') || tab.url.includes('shopee.co.id') || tab.url.includes('shopee.com');

  if (!isShopee) {
    statusDot.className = 'dot warning';
    statusText.textContent = 'กรุณาเปิดหน้าเว็บ Shopee / Affiliate';
    productCount.textContent = '-';
    openPanelBtn.style.display = 'none';
    openShopeeBtn.style.display = 'block';

    openShopeeBtn.onclick = () => {
      chrome.tabs.create({ url: 'https://affiliate.shopee.co.th/offer/product_offer' });
    };
    return;
  }

  // Ask content script for current status
  chrome.tabs.sendMessage(tab.id, { action: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      statusDot.className = 'dot warning';
      statusText.textContent = 'เปิด Shopee แล้ว (กดรีเฟรช F5 หากยังไม่ทำงาน)';
      productCount.textContent = '0';
      return;
    }

    statusDot.className = 'dot active';
    statusText.textContent = 'พร้อมใช้งานบน Shopee';
    productCount.textContent = response.detectedCount || 0;
  });

  if (openPanelBtn) {
    openPanelBtn.addEventListener('click', () => {
      chrome.tabs.sendMessage(tab.id, { action: 'OPEN_PANEL' }, () => {
        window.close();
      });
    });
  }
});
