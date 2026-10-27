/**
 * Test Suite for panel/poster-panel.js
 * Comprehensive unit and integration verification for Single-Post Flow,
 * Step-by-Step Terminal Logging, Spintax, and Storage Sync.
 */
'use strict';

const assert = require('assert');

// Mock Chrome Storage, Runtime, and Tabs Environment
const mockStorage = {
  local: {
    data: {
      threads_queue: [
        {
          id: 'test_1',
          productId: 'prod_1',
          title: 'Produk Uji Coba 1',
          price: 'Rp 50.000',
          shortLink: 'https://s.shopee.co.id/test1',
          primaryImage: 'https://cf.shopee.co.id/file/test1.jpg',
          imageUrls: ['https://cf.shopee.co.id/file/test1.jpg', 'https://cf.shopee.co.id/file/test1_2.jpg'],
          caption: '{Rekomendasi|Spill} Produk Uji Coba 1!',
          status: 'PENDING'
        },
        {
          id: 'test_2',
          productId: 'prod_2',
          title: 'Produk Uji Coba 2',
          price: 'Rp 120.000',
          shortLink: 'https://s.shopee.co.id/test2',
          primaryImage: 'https://cf.shopee.co.id/file/test2.jpg',
          caption: 'Caption Uji Coba 2',
          status: 'PENDING'
        },
        {
          id: 'test_3',
          productId: 'prod_3',
          title: 'Produk Uji Coba 3 (Fail Test)',
          price: 'Rp 75.000',
          shortLink: 'https://s.shopee.co.id/test3',
          primaryImage: 'https://cf.shopee.co.id/file/test3.jpg',
          caption: 'Caption Uji Coba 3',
          status: 'PENDING'
        }
      ]
    },
    listeners: [],
    get(keys, cb) {
      const res = {};
      const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
      for (const k of keyList) {
        if (this.data[k] !== undefined) {
          res[k] = JSON.parse(JSON.stringify(this.data[k]));
        }
      }
      if (cb) cb(res);
      return Promise.resolve(res);
    },
    set(obj, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: this.data[k], newValue: v };
        this.data[k] = JSON.parse(JSON.stringify(v));
      }
      this.listeners.forEach(fn => fn(changes, 'local'));
      if (cb) cb();
      return Promise.resolve();
    }
  },
  onChanged: {
    addListener(fn) {
      mockStorage.local.listeners.push(fn);
    }
  }
};

let shouldSimulateTabFailure = false;

const messageListeners = [];
const mockRuntime = {
  lastError: null,
  onMessage: {
    addListener(fn) {
      messageListeners.push(fn);
    }
  },
  sendMessage(msg, cb) {
    let handled = false;
    for (const l of messageListeners) {
      l(msg, {}, (res) => {
        handled = true;
        if (cb) cb(res);
      });
    }
    if (!handled && cb) cb({ success: true });
  }
};

const mockTabs = {
  query(queryInfo, cb) {
    const tabs = [{ id: 99, url: 'https://www.threads.net', active: true, windowId: 1 }];
    if (cb) cb(tabs);
    return Promise.resolve(tabs);
  },
  update(tabId, updateProps, cb) {
    if (cb) cb({ id: tabId, ...updateProps });
    return Promise.resolve({ id: tabId, ...updateProps });
  },
  sendMessage(tabId, msg, cb) {
    if (shouldSimulateTabFailure) {
      if (cb) cb({ success: false, error: 'Tombol Kirim / Post Threads tidak ditemukan!' });
    } else {
      if (cb) cb({ success: true, postUrl: 'https://www.threads.net/@user/post/test12345' });
    }
  }
};

const mockWindows = {
  update(winId, updateProps, cb) {
    if (cb) cb({ id: winId, ...updateProps });
    return Promise.resolve({ id: winId, ...updateProps });
  }
};

globalThis.chrome = {
  storage: mockStorage,
  runtime: mockRuntime,
  tabs: mockTabs,
  windows: mockWindows
};

// Require the poster panel module
const PosterPanel = require('./panel/poster-panel.js');

async function testPosterPanel() {
  console.log('🧪 Testing poster-panel.js components...\n');

  // 1. Test PanelQueueManager
  console.log('1. Testing PanelQueueManager:');
  const qm = new PosterPanel.PanelQueueManager();
  await qm.init();

  const allItems = qm.getAllItems();
  assert.strictEqual(allItems.length, 3, 'Should load 3 items from storage');
  assert.strictEqual(qm.getPendingItems().length, 3, 'All 3 items should initially be PENDING');

  const stats = qm.getStats();
  assert.strictEqual(stats.total, 3);
  assert.strictEqual(stats.pending, 3);
  assert.strictEqual(stats.posted, 0);
  assert.strictEqual(stats.failed, 0);

  const activeItem = qm.getActiveItem();
  assert.strictEqual(activeItem.id, 'test_1');

  // Update caption
  await qm.updateItemCaption('test_1', 'Updated Caption Test');
  const updatedItem = qm.getItemById('test_1');
  assert.strictEqual(updatedItem.caption, 'Updated Caption Test');
  console.log('  ✅ PanelQueueManager passes all tests!');

  // 2. Test PanelDebugConsole
  console.log('2. Testing PanelDebugConsole:');
  const debugConsole = new PosterPanel.PanelDebugConsole();
  debugConsole.info('Testing info log');
  debugConsole.debug('Testing debug log');
  debugConsole.dom('Testing DOM log');
  debugConsole.success('Testing success log');
  debugConsole.error('Testing error log');

  assert.strictEqual(debugConsole.logs.length, 5, 'Should have 5 logs recorded');
  debugConsole.updateCounts();
  assert.strictEqual(debugConsole.logs.filter(l => l.level === 'SUCCESS').length, 1);
  assert.strictEqual(debugConsole.logs.filter(l => l.level === 'ERROR').length, 1);
  console.log('  ✅ PanelDebugConsole passes all tests!');

  // 3. Test PanelThreadsTabBridge
  console.log('3. Testing PanelThreadsTabBridge:');
  const bridge = new PosterPanel.PanelThreadsTabBridge(debugConsole);
  const connected = await bridge.checkConnection();
  assert.strictEqual(connected, true, 'Bridge should detect open threads tab');
  const postRes = await bridge.injectPost(activeItem);
  assert.strictEqual(postRes.success, true, 'Bridge injectPost should succeed');
  assert.strictEqual(postRes.postUrl, 'https://www.threads.net/@user/post/test12345');
  console.log('  ✅ PanelThreadsTabBridge passes all tests!');

  // 4. Test Single Post (1 per 1) Flow & Step-by-Step Terminal Logging
  console.log('4. Testing PanelPostingController (Single Post & Step Logging):');
  debugConsole.clearLogs();
  const postCtrl = new PosterPanel.PanelPostingController(qm, bridge, debugConsole);

  // Execute single post on test_1
  const singleRes = await postCtrl.executePostSingle(activeItem);
  assert.strictEqual(singleRes.success, true);
  assert.strictEqual(singleRes.postUrl, 'https://www.threads.net/@user/post/test12345');

  // Verify step-by-step terminal logs are recorded cleanly
  const logMessages = debugConsole.logs.map(l => l.message);
  assert(logMessages.some(m => m.includes('⏳ Membuka form Utas Baru Threads...')), 'Step 1 log should exist');
  assert(logMessages.some(m => m.includes('✍️ Mengetik caption produk...')), 'Step 2 log should exist');
  assert(logMessages.some(m => m.includes('🔘 Mengklik tombol Kirim via XPath...')), 'Step 3 log should exist');
  assert(logMessages.some(m => m.includes('🎉 SUKSES DIPOSTING! 🔗 Link: https://www.threads.net/@user/post/test12345')), 'Step 4 success log should exist');

  // Verify item status transitioned to POSTED
  const postedItem = qm.getItemById('test_1');
  assert.strictEqual(postedItem.status, 'POSTED');
  assert.strictEqual(postedItem.threadsUrl, 'https://www.threads.net/@user/post/test12345');
  assert(postedItem.postedAt !== null);

  const postedStats = qm.getStats();
  assert.strictEqual(postedStats.posted, 1, 'Should have 1 posted item');
  assert.strictEqual(postedStats.pending, 2, 'Should have 2 remaining pending items');
  console.log('  ✅ Single Post success and step-by-step logging verified!');

  // Test Failure flow on test_3
  console.log('  Testing Single Post failure handling:');
  shouldSimulateTabFailure = true;
  const item3 = qm.getItemById('test_3');
  const failRes = await postCtrl.executePostSingle(item3);
  assert.strictEqual(failRes.success, false);
  const updatedItem3 = qm.getItemById('test_3');
  assert.strictEqual(updatedItem3.status, 'FAILED');
  assert(debugConsole.logs.some(l => l.message.includes('❌ GAGAL DIPOSTING:')), 'Error log should exist');
  shouldSimulateTabFailure = false;
  console.log('  ✅ Single Post failure handling verified!');

  // 5. Test Sequential Navigation (Prev / Next Item)
  console.log('5. Testing PanelProductPreview & Navigation:');
  const preview = new PosterPanel.PanelProductPreview(qm, debugConsole);
  
  // Select Next Item -> should be test_2
  qm.selectNextItem();
  const nextItem = qm.getActiveItem();
  assert.strictEqual(nextItem.id, 'test_2');

  // Select Prev Item -> should return to test_1
  qm.selectPrevItem();
  const prevItem = qm.getActiveItem();
  assert.strictEqual(prevItem.id, 'test_1');

  // Test Spintax generation
  qm.setActiveItem('test_2');
  preview.spinCaption();
  const activeSpun = qm.getActiveItem();
  assert(activeSpun.caption.length > 0, 'Caption should be generated');
  console.log('  ✅ PanelProductPreview & Navigation passes all tests!');

  // 6. Test PosterPanelApp Coordinator
  console.log('6. Testing PosterPanelApp Coordinator:');
  const app = new PosterPanel.PosterPanelApp();
  await app.init();
  assert.strictEqual(app.isInitialized, true, 'App should initialize cleanly');
  console.log('  ✅ PosterPanelApp passes all tests!');

  console.log('\n🎉 ALL 6 TEST SCENARIOS PASSED WITH 100% SUCCESS!\n');
}

testPosterPanel().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
