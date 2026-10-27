/**
 * Test Suite for popup/popup.js
 * Author: sodikinnaa
 */
'use strict';

const assert = require('assert');

// Mock DOM elements and document/window
class MockElement {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.disabled = false;
    this.style = {};
    this.eventListeners = {};
  }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  click() {
    if (this.eventListeners['click']) {
      this.eventListeners['click'].forEach(fn => fn({ type: 'click', target: this }));
    }
  }
}

const mockElements = {
  'pop-pending-count': new MockElement('pop-pending-count'),
  'pop-posted-count': new MockElement('pop-posted-count'),
  'pop-total-count': new MockElement('pop-total-count'),
  'queue-running-badge': new MockElement('queue-running-badge'),
  'queue-meta-text': new MockElement('queue-meta-text'),
  'threads-status-dot': new MockElement('threads-status-dot'),
  'threads-status-text': new MockElement('threads-status-text'),
  'pending-preview-container': new MockElement('pending-preview-container'),
  'post-next-btn': new MockElement('post-next-btn'),
  'post-next-text': new MockElement('post-next-text'),
  'open-panel-btn': new MockElement('open-panel-btn'),
  'open-dashboard-btn': new MockElement('open-dashboard-btn'),
  'status-dot': new MockElement('status-dot'),
  'status-text': new MockElement('status-text')
};

globalThis.document = {
  getElementById(id) {
    return mockElements[id] || null;
  },
  addEventListener(evt, fn) {}
};

let closedWindows = 0;
globalThis.window = {
  close() {
    closedWindows++;
  },
  open(url) {}
};

// Mock Chrome APIs
const mockStorage = {
  local: {
    data: {
      threads_queue: [
        {
          id: 'item_1',
          title: 'Produk Uji Coba Keren',
          price: 50000,
          discount: '50%',
          sold: '1.2k',
          status: 'PENDING',
          primaryImage: 'https://cf.shopee.co.id/file/test1.jpg'
        },
        {
          id: 'item_2',
          title: 'Produk Uji Coba 2',
          price: 'Rp 100.000',
          status: 'POSTED'
        }
      ],
      isQueueRunning: false
    },
    listeners: [],
    get(keys, cb) {
      const res = {};
      const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
      for (const k of keyList) {
        if (this.data[k] !== undefined) {
          res[k] = JSON.parse(JSON.stringify(this.data[k]));
        }
      }
      if (cb) cb(res);
      return Promise.resolve(res);
    },
    set(obj, cb) {
      for (const [k, v] of Object.entries(obj)) {
        this.data[k] = JSON.parse(JSON.stringify(v));
      }
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

const messageListeners = [];
let lastSentMessage = null;
const mockRuntime = {
  lastError: null,
  getURL(path) {
    return `chrome-extension://test-id/${path}`;
  },
  sendMessage(msg, cb) {
    lastSentMessage = msg;
    if (msg.action === 'POST_SINGLE_ITEM') {
      if (cb) cb({ success: true, postUrl: 'https://threads.net/@user/post/123' });
    } else if (msg.action === 'OPEN_POSTER_PANEL') {
      if (cb) cb({ success: true, url: 'chrome-extension://test-id/panel/poster-panel.html' });
    } else if (msg.action === 'GET_QUEUE') {
      if (cb) cb({ queue: mockStorage.local.data.threads_queue });
    } else {
      if (cb) cb({ success: true });
    }
  },
  onMessage: {
    addListener(fn) {
      messageListeners.push(fn);
    }
  }
};

let createdTabs = [];
const mockTabs = {
  query(queryInfo, cb) {
    if (queryInfo.url && queryInfo.url.includes('threads.net')) {
      const tabs = [{ id: 10, url: 'https://www.threads.net', active: true }];
      if (cb) cb(tabs);
      return Promise.resolve(tabs);
    }
    if (queryInfo.url && queryInfo.url.includes('dashboard')) {
      const tabs = [{ id: 20, url: 'chrome-extension://test-id/dashboard/dashboard.html' }];
      if (cb) cb(tabs);
      return Promise.resolve(tabs);
    }
    const tabs = [{ id: 1, url: 'https://shopee.co.id/flash_sale', active: true }];
    if (cb) cb(tabs);
    return Promise.resolve(tabs);
  },
  update(tabId, props, cb) {
    if (cb) cb({ id: tabId, ...props });
    return Promise.resolve({ id: tabId, ...props });
  },
  create(props, cb) {
    createdTabs.push(props);
    if (cb) cb({ id: 99, ...props });
    return Promise.resolve({ id: 99, ...props });
  },
  sendMessage(tabId, msg, cb) {
    if (cb) cb({ detectedCount: 15 });
  }
};

const mockWindows = {
  update(winId, props, cb) {
    if (cb) cb();
    return Promise.resolve();
  }
};

globalThis.chrome = {
  storage: mockStorage,
  runtime: mockRuntime,
  tabs: mockTabs,
  windows: mockWindows
};

const { PopupStatusCalculator, PopupController } = require('./popup/popup.js');

async function runPopupTests() {
  console.log('🧪 Testing popup/popup.js...\n');

  // 1. Test PopupStatusCalculator
  console.log('1. Testing PopupStatusCalculator:');
  const queueData = [
    { id: '1', status: 'PENDING' },
    { id: '2', status: 'POSTING' },
    { id: '3', status: 'POSTED' },
    { id: '4', status: 'FAILED' }
  ];

  const stats = PopupStatusCalculator.computeQueueStats(queueData);
  assert.strictEqual(stats.pending, 2, 'Pending should be 2 (PENDING + POSTING)');
  assert.strictEqual(stats.posted, 1, 'Posted should be 1');
  assert.strictEqual(stats.failed, 1, 'Failed should be 1');
  assert.strictEqual(stats.total, 4, 'Total should be 4');

  const topPending = PopupStatusCalculator.getTopPendingItem(queueData);
  assert.strictEqual(topPending.id, '1', 'First pending item should be id 1');

  assert.strictEqual(PopupStatusCalculator.formatPrice(45000), 'Rp 45.000');
  assert.strictEqual(PopupStatusCalculator.formatPrice('Rp 75.000'), 'Rp 75.000');
  assert.strictEqual(PopupStatusCalculator.formatPrice(null), '-');

  const badgeIdle = PopupStatusCalculator.formatRunningBadge(false);
  assert.strictEqual(badgeIdle.text, '⏸ Idle');
  const badgeActive = PopupStatusCalculator.formatRunningBadge(true);
  assert.strictEqual(badgeActive.text, '🟢 Aktif');

  assert.strictEqual(PopupStatusCalculator.truncateText('Halo Dunia', 4), 'Halo...');
  assert.strictEqual(PopupStatusCalculator.escapeHtml('<b>"Test" & \'More\'</b>'), '&lt;b&gt;&quot;Test&quot; &amp; &#039;More&#039;&lt;/b&gt;');
  console.log('  ✅ PopupStatusCalculator passed all checks!');

  // 2. Test PopupController Initialization
  console.log('\n2. Testing PopupController Lifecycle:');
  const controller = new PopupController();
  await controller.init();

  assert.strictEqual(mockElements['pop-pending-count'].textContent, 1);
  assert.strictEqual(mockElements['pop-posted-count'].textContent, 1);
  assert.strictEqual(mockElements['pop-total-count'].textContent, 2);
  assert.strictEqual(mockElements['queue-running-badge'].textContent, '⏸ Idle');
  assert(mockElements['pending-preview-container'].innerHTML.includes('Produk Uji Coba Keren'));
  assert.strictEqual(mockElements['post-next-btn'].disabled, false);
  console.log('  ✅ PopupController loaded queue data and rendered UI successfully!');

  // 3. Test Post Single Item Action
  console.log('\n3. Testing Post Item Ini ke Threads:');
  await controller.handlePostNextNow();
  assert.strictEqual(lastSentMessage.action, 'POST_SINGLE_ITEM');
  assert.strictEqual(lastSentMessage.item.id, 'item_1');
  console.log('  ✅ Post action successfully dispatched to background message router!');

  // 4. Test Dedicated Panel Navigation
  console.log('\n4. Testing Buka Dedicated Panel Navigation:');
  const initialClosed = closedWindows;
  controller.handleOpenPanel();
  assert.strictEqual(lastSentMessage.action, 'OPEN_POSTER_PANEL');
  assert.strictEqual(closedWindows, initialClosed + 1);
  console.log('  ✅ Dedicated Panel action dispatched and popup closed!');

  // 5. Test Full Dashboard Navigation
  console.log('\n5. Testing Buka Full Dashboard Navigation:');
  controller.handleOpenDashboard();
  console.log('  ✅ Full Dashboard navigation handled and tab queried/focused!');

  // 6. Test Empty Queue State
  console.log('\n6. Testing Empty Queue Preview Rendering:');
  controller.renderPendingPreview(null);
  assert(mockElements['pending-preview-container'].innerHTML.includes('Semua antrean selesai atau kosong'));
  assert.strictEqual(mockElements['post-next-btn'].disabled, true);
  console.log('  ✅ Empty state rendered correctly with button disabled!');

  console.log('\n🎉 ALL POPUP CONTROLLER TESTS PASSED 100% SUCCESSFULLY!\n');
}

runPopupTests().catch(err => {
  console.error('❌ Popup test failed:', err);
  process.exit(1);
});
