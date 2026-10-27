/**
 * Shopee Affiliate Downloader & CSV Dashboard (Thai Edition)
 * Background Service Worker — Clean Architecture (Manifest V3)
 * 
 * @author sodikinnaa
 * @license MIT
 */

'use strict';

// ส่งสินค้าเข้าคลังโฆษณากลาง (Ad Hub)
importScripts('libs/hub-service.js');

/**
 * Injected helper into Threads tab to find composer, focus, and paste caption
 * STRICTLY MANUAL ASSISTED: NEVER CLICKS SUBMIT / POST.
 */
function fillThreadsComposerSafe(captionText) {
  try {
    // 1. Try to find open contenteditable element
    let editor = document.querySelector('[contenteditable="true"][role="textbox"]') ||
                 document.querySelector('[contenteditable="true"]');

    // 2. If not found, try clicking the "Start a thread..." or "+" button (Supports TH/EN/ID)
    if (!editor) {
      const composeBtn = document.querySelector('svg[aria-label="Create"]') ||
                         document.querySelector('svg[aria-label="สร้าง"]') ||
                         document.querySelector('svg[aria-label="Buat"]') ||
                         document.querySelector('[aria-label="New thread"]') ||
                         document.querySelector('[aria-label="เธรดใหม่"]') ||
                         document.querySelector('[aria-label="Utas baru"]');
      if (composeBtn) {
        const clickable = composeBtn.closest('button') || composeBtn.closest('div[role="button"]') || composeBtn.parentElement;
        if (clickable) clickable.click();
      }
    }

    setTimeout(() => {
      editor = document.querySelector('[contenteditable="true"][role="textbox"]') ||
               document.querySelector('[contenteditable="true"]');
      if (editor) {
        editor.focus();
        // Insert text safely via execCommand or DataTransfer
        const success = document.execCommand('insertText', false, captionText);
        if (!success) {
          editor.innerText = captionText;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 500);
  } catch (e) {
    console.warn('[ThreadsHelper] Fill composer safe notice:', e);
  }
}

// Global message router
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || !request.action) return;

    if (request.action === 'OPEN_DASHBOARD') {
      const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
      // hash เปิดแท็บที่ต้องการ เช่น #tab-adhub
      const hash = /^#[\w-]+$/.test(request.hash || '') ? request.hash : '';
      chrome.tabs.query({ url: dashboardUrl }, (tabs) => {
        if (tabs && tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, hash ? { active: true, url: dashboardUrl + hash } : { active: true });
          if (tabs[0].windowId && chrome.windows) {
            chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
          }
        } else {
          chrome.tabs.create({ url: dashboardUrl + hash });
        }
        sendResponse({ success: true });
      });
      return true;
    }

    if (request.action === 'HUB_STATUS') {
      HubService.status().then(sendResponse, err => sendResponse({ connected: false, error: err.message }));
      return true;
    }

    if (request.action === 'HUB_IMPORT') {
      HubService.importProducts(request.products, request.keyword, request.status)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'SAVE_PRODUCTS_TO_DASHBOARD' || request.action === 'ADD_TO_QUEUE') {
      const newItems = request.products || request.items || [];
      if (!Array.isArray(newItems) || newItems.length === 0) {
        sendResponse({ success: false, error: 'รายการสินค้าว่างเปล่า' });
        return true;
      }

      chrome.storage.local.get(['shopee_products'], (store) => {
        const current = Array.isArray(store.shopee_products) ? store.shopee_products : [];
        const merged = [...current, ...newItems];

        chrome.storage.local.set({ shopee_products: merged }, () => {
          sendResponse({ success: true, count: merged.length, added: newItems.length });
        });
      });
      return true;
    }

    if (request.action === 'GET_DASHBOARD_PRODUCTS') {
      chrome.storage.local.get(['shopee_products'], (store) => {
        const list = Array.isArray(store.shopee_products) ? store.shopee_products : [];
        sendResponse({ success: true, products: list, count: list.length });
      });
      return true;
    }

    if (request.action === 'OPEN_THREADS_AND_PASTE') {
      const textToPaste = request.text || '';
      // Open Threads web or reuse tab
      chrome.tabs.query({ url: '*://*.threads.net/*' }, (tabs) => {
        const targetUrl = 'https://www.threads.net/';
        if (tabs && tabs.length > 0) {
          const tab = tabs[0];
          chrome.tabs.update(tab.id, { active: true }, (updatedTab) => {
            if (tab.windowId && chrome.windows) {
              chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
            }
            // Execute script to focus composer and insert text safely without clicking post
            chrome.scripting ? chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: fillThreadsComposerSafe,
              args: [textToPaste]
            }).catch(() => {}) : null;
          });
        } else {
          chrome.tabs.create({ url: targetUrl }, (createdTab) => {
            // Wait for tab load
            const listener = (tabId, changeInfo) => {
              if (tabId === createdTab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(() => {
                  if (chrome.scripting) {
                    chrome.scripting.executeScript({
                      target: { tabId: createdTab.id },
                      func: fillThreadsComposerSafe,
                      args: [textToPaste]
                    }).catch(() => {});
                  }
                }, 1500);
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        }
        sendResponse({ success: true });
      });
      return true;
    }

    return true;
  });
}

console.log('📦 [ShopeeAffiliateTH] Background Service Worker พร้อมให้บริการแดชบอร์ด & ตัวดึงข้อมูลแล้ว');
