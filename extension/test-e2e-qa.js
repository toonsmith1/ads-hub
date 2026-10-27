/**
 * Comprehensive End-to-End QA, Error Boundary & Single-Post Automation Test Suite
 * For: Shopee Affiliate Downloader & Threads Auto-Poster
 * 
 * Verifies all Scenarios & Requirements:
 * 1. Spintax & Caption Engine Verification
 * 2. Skenario 1: Scrape Shopee -> Queue `threads_queue` storage
 * 3. Skenarios 2 & 3: Threads FAB, Widget & Queue Reading
 * 4. Skenario 4: Single-Post DOM Automation & postingThreads(teks):
 *    - Validasi eksekusi posting 1 per 1 menggunakan logika `postingThreads(teks)`
 *    - Verifikasi XPath `/html/body/div[3]/div/div/div[3]/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/div/div/div/div[4]/div/div[1]/div`
 *    - Verifikasi Fallback tombol Kirim ([role="button"] "kirim" / "post" / "posting")
 *    - Verifikasi penangkap Toast MutationObserver pada `[role="status"] a[href*="/post/"]`
 *    - Verifikasi penangkap Toast Polling (250ms) pada `[role="status"] a[href*="/post/"]`
 *    - Verifikasi update status `PENDING` -> `POSTED` beserta penyimpanan riwayat log
 * 5. Skenario 5: "Mulai Auto-Post" Scheduler & Sequential Dispatch
 * 6. Skenario 6: Realtime synchronization between Popup, Dashboard, Threads, and Background
 * 7. Error Boundaries & Resilience Tests
 * 8. CSV Export & Import Verification
 * 9. Dedicated Poster Panel Routing
 * 10. Centralized Logger & Ring Buffer Verification
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. MOCK DOM & BROWSER ENVIRONMENT SETUP
// ============================================================================

globalThis.XPathResult = {
  FIRST_ORDERED_NODE_TYPE: 9,
  ORDERED_NODE_SNAPSHOT_TYPE: 7
};

class MockMutationObserver {
  constructor(cb) {
    this.cb = cb;
    MockMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {
    const idx = MockMutationObserver.instances.indexOf(this);
    if (idx !== -1) MockMutationObserver.instances.splice(idx, 1);
  }
  static triggerAll(mutations = []) {
    MockMutationObserver.instances.slice().forEach(obs => {
      try { obs.cb(mutations); } catch (e) {}
    });
  }
}
MockMutationObserver.instances = [];
globalThis.MutationObserver = MockMutationObserver;

class MockElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.textContent = attrs.textContent || '';
    this.innerHTML = '';
    this.parentNode = null;
    this.href = attrs.href || '';
    this.id = attrs.id || '';
    this.files = [];
    this.value = '';
    this.style = {};
    this.dataset = {};
    this.classList = {
      classes: new Set(),
      add(...cls) { cls.forEach(c => this.classes.add(c)); },
      remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
      contains(c) { return this.classes.has(c); },
      toggle(c) { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); }
    };
    this.listeners = {};
    this.dispatchedEvents = [];
  }

  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, val) {
    this.attributes[name] = val;
    if (name === 'id') this.id = val;
    if (name === 'href') this.href = val;
  }
  removeAttribute(name) { delete this.attributes[name]; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    MockMutationObserver.triggerAll([{ type: 'childList', addedNodes: [child] }]);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
      MockMutationObserver.triggerAll([{ type: 'childList', removedNodes: [child] }]);
    }
    return child;
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(fn);
      if (idx !== -1) this.listeners[event].splice(idx, 1);
    }
  }

  dispatchEvent(evt) {
    this.dispatchedEvents.push(evt.type);
    if (this.listeners[evt.type]) {
      this.listeners[evt.type].forEach(fn => fn(evt));
    }
    return true;
  }

  click() {
    this.dispatchEvent(new MockEvent('click'));
  }

  focus() {
    this.dispatchEvent(new MockEvent('focus'));
  }

  matches(selector) {
    const s = selector.trim();
    if (s === '*') return true;
    if (s.startsWith('#') && this.id === s.slice(1)) return true;
    if (s.startsWith('.') && this.classList.contains(s.slice(1))) return true;
    if (s === '[contenteditable="true"]') return this.attributes.contenteditable === 'true';
    if (s === '[role="dialog"]') return this.attributes.role === 'dialog';
    if (s === 'div[role="dialog"]') return this.tagName === 'DIV' && this.attributes.role === 'dialog';
    if (s === '[role="button"]') return this.attributes.role === 'button';
    if (s === '[role="status"]') return this.attributes.role === 'status';
    if (s === 'div[role="status"]') return this.tagName === 'DIV' && this.attributes.role === 'status';
    if (s.includes('input[type="file"]')) return this.tagName === 'INPUT' && (this.attributes.type === 'file' || this.attributes.accept !== undefined);
    if (s.includes('a[href*="/post/"]') || s.includes('a[href*="threads.net/@"]')) {
      return this.tagName === 'A' && (this.href || '').includes('/post/');
    }
    if (s.includes('a[href*="/login"]')) return this.tagName === 'A' && (this.href || '').includes('/login');
    if (s.includes('a[href*="/@"]')) return this.tagName === 'A' && (this.href || '').includes('/@');
    return false;
  }

  querySelectorAll(selectorString) {
    const selectors = selectorString.split(',').map(s => s.trim());
    const matched = new Set();

    const checkNode = (node) => {
      for (const sel of selectors) {
        const parts = sel.split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
          if (node.matches(parts[0])) matched.add(node);
        } else if (parts.length === 2) {
          const [ancestorSel, targetSel] = parts;
          if (node.matches(targetSel)) {
            let p = node.parentNode;
            while (p) {
              if (p.matches && p.matches(ancestorSel)) {
                matched.add(node);
                break;
              }
              p = p.parentNode;
            }
          }
        }
      }
      for (const child of node.children) {
        checkNode(child);
      }
    };

    checkNode(this);
    return Array.from(matched);
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

class MockEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles !== undefined ? opts.bubbles : true;
    this.cancelable = opts.cancelable !== undefined ? opts.cancelable : true;
  }
}
globalThis.Event = MockEvent;
globalThis.MouseEvent = MockEvent;
globalThis.PointerEvent = MockEvent;
globalThis.ClipboardEvent = MockEvent;
globalThis.InputEvent = MockEvent;
globalThis.CustomEvent = MockEvent;

globalThis.DataTransfer = class {
  constructor() {
    this.items = { add: (f) => this.files.push(f) };
    this.files = [];
    this.data = {};
  }
  setData(format, val) { this.data[format] = val; }
  getData(format) { return this.data[format] || ''; }
};

globalThis.File = class {
  constructor(parts, filename, opts) {
    this.parts = parts;
    this.name = filename;
    this.type = opts?.type || 'image/jpeg';
    this.size = 1024;
  }
};

globalThis.Blob = class {
  constructor(parts, opts) {
    this.parts = parts;
    this.size = 1024;
    this.type = opts?.type || 'image/jpeg';
  }
};

globalThis.fetch = async (url) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  blob: async () => new globalThis.Blob(['mock_image_bytes'], { type: 'image/jpeg' })
});

const mockHead = new MockElement('HEAD');
const mockBody = new MockElement('BODY');

let explicitXPathElement = null;

const mockDoc = {
  head: mockHead,
  body: mockBody,
  readyState: 'complete',
  createElement(tag) { return new MockElement(tag); },
  getElementById(id) {
    const find = (node) => {
      if (node.id === id) return node;
      for (const c of node.children) {
        const found = find(c);
        if (found) return found;
      }
      return null;
    };
    return find(mockHead) || find(mockBody);
  },
  querySelector(sel) {
    return mockHead.querySelector(sel) || mockBody.querySelector(sel);
  },
  querySelectorAll(sel) {
    return [...mockHead.querySelectorAll(sel), ...mockBody.querySelectorAll(sel)];
  },
  evaluate(xpath, ctx, res, type, result) {
    if (xpath === '/html/body/div[3]/div/div/div[3]/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/div/div/div/div[4]/div/div[1]/div') {
      return { singleNodeValue: explicitXPathElement };
    }
    return { singleNodeValue: null };
  },
  execCommand(cmd, showUI, val) { return true; },
  addEventListener() {},
  removeEventListener() {}
};

globalThis.document = mockDoc;
globalThis.window = {
  document: mockDoc,
  location: { href: 'https://www.threads.net' },
  addEventListener() {},
  removeEventListener() {}
};

// ============================================================================
// 2. MOCK CHROME STORAGE, RUNTIME, TABS & ALARMS
// ============================================================================

const mockStorage = {
  local: {
    data: {},
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
    },
    clear(cb) {
      this.data = {};
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
const mockRuntime = {
  lastError: null,
  onMessage: {
    addListener(fn) {
      messageListeners.push(fn);
    }
  },
  sendMessage(msg, cb) {
    let responded = false;
    for (const listener of messageListeners) {
      listener(msg, {}, (res) => {
        responded = true;
        if (cb) cb(res);
      });
    }
    if (!responded && cb) cb({ success: true });
  },
  getURL(path) {
    return `chrome-extension://mock-id/${path}`;
  }
};

const mockTabs = {
  query(filter, cb) {
    if (cb) cb([{ id: 101, url: 'https://www.threads.net' }]);
    return Promise.resolve([{ id: 101, url: 'https://www.threads.net' }]);
  },
  sendMessage(tabId, msg, cb) {
    mockRuntime.sendMessage(msg, cb);
  },
  create(opts, cb) {
    if (cb) cb({ id: 102, ...opts });
    return Promise.resolve({ id: 102, ...opts });
  }
};

const mockAlarms = {
  alarms: {},
  create(name, opts) {
    this.alarms[name] = opts;
  },
  clear(name, cb) {
    delete this.alarms[name];
    if (cb) cb(true);
    return Promise.resolve(true);
  }
};

const mockNotifications = {
  created: [],
  create(opts, cb) {
    this.created.push(opts);
    if (cb) cb('notif_' + Date.now());
  }
};

// Global polyfills for test suite
globalThis.chrome = {
  storage: mockStorage,
  runtime: mockRuntime,
  tabs: mockTabs,
  alarms: mockAlarms,
  notifications: mockNotifications
};

// Load project libraries
const constants = require('./libs/constants.js');
const spintax = require('./libs/spintax.js');
const db = require('./libs/db.js');
const csvHelper = require('./libs/csv-helper.js');
const Logger = require('./libs/logger.js');
const background = require('./background.js');
const threadsContent = require('./threads-content.js');

// ============================================================================
// 3. MAIN TEST RUNNER & SUITES
// ============================================================================

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🧪 RUNNING COMPREHENSIVE END-TO-END QA & AUTOMATION TEST SUITE');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function it(desc, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✅ PASS: ${desc}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${desc}`);
      console.error(`     Error: ${err.message}`);
      throw err;
    }
  }

  async function itAsync(desc, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${desc}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${desc}`);
      console.error(`     Error: ${err.message}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  console.log('--- 1. SPINTAX & CAPTION ENGINE VERIFICATION ---');
  // --------------------------------------------------------------------------
  it('Should correctly parse nested spintax choices without errors', () => {
    const template = '{{Pilihan 1A|Pilihan 1B}|{Pilihan 2A|Pilihan 2B}}';
    for (let i = 0; i < 20; i++) {
      const res = spintax.parseSpintax(template);
      assert(['Pilihan 1A', 'Pilihan 1B', 'Pilihan 2A', 'Pilihan 2B'].includes(res));
    }
  });

  it('Should replace all dynamic variables and append random hashtags', () => {
    const template = '{Rekomendasi|Spill}: {nama_produk}\nHarga: {harga} {diskon}\nLink: {link_affiliate}\n{hashtag_random}';
    const vars = {
      nama_produk: 'Mouse Wireless RGB',
      harga: 'Rp 75.000',
      diskon: '(Diskon 30%)',
      link_affiliate: 'https://s.shopee.co.id/xyz123'
    };
    const caption = spintax.generateCaption(template, vars, null, 3);
    assert(caption.includes('Mouse Wireless RGB'));
    assert(caption.includes('Rp 75.000 (Diskon 30%)'));
    assert(caption.includes('https://s.shopee.co.id/xyz123'));
    assert(caption.includes('#'));
    assert.strictEqual(caption.match(/#/g).length, 3);
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 2. SKENARIO 1: SCRAPING SHOPEE -> QUEUE INGESTION ---');
  // --------------------------------------------------------------------------
  await itAsync('Should successfully ingest product batches into threads_queue via MessageRouter', async () => {
    const sampleProducts = [
      {
        shopeeId: '1001',
        title: 'Tas Ransel Laptop Anti Air',
        price: 'Rp 149.000',
        rating: '⭐ 4.9',
        sold: '5rb+ terjual',
        commission: '10%',
        shortLink: 'https://s.shopee.co.id/backpack01',
        primaryImage: 'https://cf.shopee.co.id/file/test_img_1.jpg',
        imageUrls: ['https://cf.shopee.co.id/file/test_img_1.jpg', 'https://cf.shopee.co.id/file/test_img_2.jpg'],
        caption: 'Tas Ransel Keren banget! Beli di: https://s.shopee.co.id/backpack01 #RacunShopee'
      },
      {
        shopeeId: '1002',
        title: 'Headset Gaming 7.1 Surround',
        price: 'Rp 220.000',
        rating: '⭐ 4.8',
        sold: '2rb+ terjual',
        commission: '8%',
        shortLink: 'https://s.shopee.co.id/headset02',
        primaryImage: 'https://cf.shopee.co.id/file/test_img_3.jpg',
        caption: 'Headset gaming super jernih! Cek: https://s.shopee.co.id/headset02 #GadgetMurah'
      }
    ];

    const dispatchRes = await background.messageRouter.dispatch({
      action: 'ADD_TO_QUEUE',
      products: sampleProducts
    });

    assert.strictEqual(dispatchRes.success, true);
    assert.strictEqual(dispatchRes.count, 2);

    const queueInStorage = await db.getQueue();
    assert.strictEqual(queueInStorage.length, 2);
    assert.strictEqual(queueInStorage[0].status, 'PENDING');
    assert.strictEqual(queueInStorage[1].status, 'PENDING');
    assert.strictEqual(queueInStorage[0].title, 'Tas Ransel Laptop Anti Air');
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 3. SKENARIOS 2 & 3: THREADS FAB, WIDGET & QUEUE READING ---');
  // --------------------------------------------------------------------------
  await itAsync('Should query and retrieve queue stats accurately for Threads Widget and Popup', async () => {
    const statsRes = await background.messageRouter.dispatch({
      action: 'GET_QUEUE_STATS'
    });

    assert.strictEqual(statsRes.total, 2);
    assert.strictEqual(statsRes.pending, 2);
    assert.strictEqual(statsRes.posted, 0);
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 4. SKENARIO 4: SINGLE-POST DOM AUTOMATION & postingThreads(teks) ---');
  // --------------------------------------------------------------------------

  it('Should verify ThreadsDOM.getSubmitButton finding submit button via primary XPath', () => {
    const mockDialog = new MockElement('DIV', { role: 'dialog' });
    const xpathBtn = new MockElement('DIV', { textContent: 'Kirim' });
    explicitXPathElement = xpathBtn;

    const foundBtn = threadsContent.ThreadsDOM.getSubmitButton(mockDialog);
    assert.strictEqual(foundBtn, xpathBtn, 'Tombol submit harus ditemukan via XPath');

    // Test clickSubmitButton sequence
    threadsContent.ThreadsDOM.clickSubmitButton(foundBtn);
    assert(foundBtn.dispatchedEvents.includes('pointerdown'));
    assert(foundBtn.dispatchedEvents.includes('mousedown'));
    assert(foundBtn.dispatchedEvents.includes('pointerup'));
    assert(foundBtn.dispatchedEvents.includes('mouseup'));
    assert(foundBtn.dispatchedEvents.includes('click'));
  });

  it('Should verify ThreadsDOM.getSubmitButton finding submit button via fallback [role="button"] text', () => {
    const mockDialog = new MockElement('DIV', { role: 'dialog' });
    const fallbackBtn = new MockElement('DIV', { role: 'button', textContent: 'Post' });
    mockDialog.appendChild(fallbackBtn);
    explicitXPathElement = null; // simulate XPath returning null

    const foundBtn = threadsContent.ThreadsDOM.getSubmitButton(mockDialog);
    assert.strictEqual(foundBtn, fallbackBtn, 'Tombol submit harus ditemukan via fallback selector');
  });

  await itAsync('Should verify ThreadsToastObserver capturing post URL via MutationObserver', async () => {
    mockBody.children = [];
    const observerPromise = threadsContent.ThreadsToastObserver.waitForPostUrl(3000);

    // Simulate DOM mutation adding toast with post URL
    const toastDiv = new MockElement('DIV', { role: 'status' });
    const toastLink = new MockElement('A', {
      href: 'https://www.threads.net/@user/post/Cw123456789',
      textContent: 'Lihat'
    });
    toastDiv.appendChild(toastLink);
    mockBody.appendChild(toastDiv);

    const postUrl = await observerPromise;
    assert.strictEqual(postUrl, 'https://www.threads.net/@user/post/Cw123456789');
  });

  await itAsync('Should verify ThreadsToastObserver capturing post URL via 250ms polling fallback', async () => {
    mockBody.children = [];
    // Disable active MutationObservers temporarily to test purely polling mechanism
    const savedObservers = [...MockMutationObserver.instances];
    MockMutationObserver.instances = [];

    const observerPromise = threadsContent.ThreadsToastObserver.waitForPostUrl(3000);

    // Append toast after 100ms so 250ms polling picks it up
    setTimeout(() => {
      const toastDiv = new MockElement('DIV', { role: 'status' });
      const toastLink = new MockElement('A', {
        href: 'https://www.threads.net/@user/post/PollingSuccess999',
        textContent: 'Lihat'
      });
      toastDiv.appendChild(toastLink);
      mockBody.appendChild(toastDiv);
    }, 100);

    const postUrl = await observerPromise;
    MockMutationObserver.instances = savedObservers;
    assert.strictEqual(postUrl, 'https://www.threads.net/@user/post/PollingSuccess999');
  });

  await itAsync('Should execute full single-post flow via postingThreads(teks) and verify state', async () => {
    // Setup full Threads DOM structure
    mockBody.children = [];
    const dialog = new MockElement('DIV', { role: 'dialog' });
    const fileInput = new MockElement('INPUT', { type: 'file' });
    fileInput.setAttribute('accept', 'image/*');
    const editor = new MockElement('DIV', { contenteditable: 'true' });
    const submitBtn = new MockElement('DIV', { role: 'button', textContent: 'Posting' });

    dialog.appendChild(fileInput);
    dialog.appendChild(editor);
    dialog.appendChild(submitBtn);
    mockBody.appendChild(dialog);
    explicitXPathElement = submitBtn;

    // Toast will appear after submit
    submitBtn.addEventListener('click', () => {
      setTimeout(() => {
        const toastDiv = new MockElement('DIV', { role: 'status' });
        const toastLink = new MockElement('A', {
          href: 'https://www.threads.net/@shopeeaff/post/Cw987654321',
          textContent: 'Lihat'
        });
        toastDiv.appendChild(toastLink);
        mockBody.appendChild(toastDiv);
      }, 50);
    });

    const singlePostResult = await threadsContent.postingThreads({
      id: 'queue_1001',
      title: 'Tas Ransel Laptop Anti Air',
      caption: 'Tas Ransel Keren banget! Beli di: https://s.shopee.co.id/backpack01 #RacunShopee',
      imageUrls: ['https://cf.shopee.co.id/file/test_img_1.jpg']
    });

    assert.strictEqual(singlePostResult.success, true);
    assert.strictEqual(singlePostResult.postUrl, 'https://www.threads.net/@shopeeaff/post/Cw987654321');
    assert(singlePostResult.timeTakenMs >= 0);
  });

  await itAsync('Should update status PENDING -> POSTED and store history log in storage', async () => {
    const queueList = await db.getQueue();
    const itemToPost = queueList[0];
    const postUrl = 'https://www.threads.net/@shopeeaff/post/Cw987654321';
    const postedAt = new Date().toISOString();

    // Update queue item state to POSTED
    await db.updateQueueItem(itemToPost.id, {
      status: 'POSTED',
      postedAt,
      threadsUrl: postUrl
    });

    // Record into history log
    await db.addLog({
      id: 'log_single_001',
      productId: itemToPost.shopeeId || itemToPost.productId || '1001',
      title: itemToPost.title,
      price: itemToPost.price,
      shortLink: itemToPost.shortLink,
      threadsUrl: postUrl,
      status: 'POSTED',
      timestamp: postedAt
    });

    const updatedQueue = await db.getQueue();
    const postedItem = updatedQueue.find(q => q.id === itemToPost.id);
    assert.strictEqual(postedItem.status, 'POSTED');
    assert.strictEqual(postedItem.threadsUrl, postUrl);

    const logs = await db.getLogs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].status, 'POSTED');
    assert.strictEqual(logs[0].threadsUrl, postUrl);
    assert.strictEqual(logs[0].title, 'Tas Ransel Laptop Anti Air');
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 5. SKENARIO 5: "MULAI AUTO-POST" SCHEDULER & DISPATCH ---');
  // --------------------------------------------------------------------------
  await itAsync('Should start queue scheduler alarm and dispatch next pending items automatically', async () => {
    const startRes = await background.messageRouter.dispatch({
      action: 'START_QUEUE',
      intervalMinutes: 15
    });

    assert.strictEqual(startRes.isRunning, true);
    assert.strictEqual(mockAlarms.alarms['THREADS_QUEUE_POSTER'].periodInMinutes, 15);

    const isRunning = await db.getSetting('isQueueRunning', false);
    assert.strictEqual(isRunning, true);

    const nextPending = await db.getNextPendingItem();
    assert(nextPending !== null);
    assert.strictEqual(nextPending.title, 'Headset Gaming 7.1 Surround');
    assert.strictEqual(nextPending.status, 'PENDING');

    // Stop queue
    const stopRes = await background.messageRouter.dispatch({ action: 'STOP_QUEUE' });
    assert.strictEqual(stopRes.isRunning, false);
    assert.strictEqual(mockAlarms.alarms['THREADS_QUEUE_POSTER'], undefined);
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 6. SKENARIO 6: REALTIME SYNCHRONIZATION & BROADCASTING ---');
  // --------------------------------------------------------------------------
  await itAsync('Should synchronize state changes across Popup and Dashboard via storage events', async () => {
    let changeFired = false;
    mockStorage.onChanged.addListener((changes) => {
      if (changes.threads_queue) changeFired = true;
    });

    await db.addQueueItem({
      shopeeId: '1003',
      title: 'Smartwatch AMOLED Bluetooth Call',
      price: 'Rp 399.000',
      shortLink: 'https://s.shopee.co.id/watch03',
      status: 'PENDING'
    });

    assert.strictEqual(changeFired, true);
    const stats = await db.getQueueStats();
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.pending, 2);
    assert.strictEqual(stats.posted, 1);
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 7. ERROR BOUNDARIES & RESILIENCE TESTS ---');
  // --------------------------------------------------------------------------
  await itAsync('Should gracefully catch unknown actions without throwing uncaught exceptions', async () => {
    const res = await background.messageRouter.dispatch({ action: 'NON_EXISTENT_ACTION' });
    assert.strictEqual(res.success, false);
    assert(res.error.includes('tidak dikenali'));
  });

  await itAsync('Should handle invalid or corrupted payload in ADD_TO_QUEUE gracefully', async () => {
    const res = await background.messageRouter.dispatch({
      action: 'ADD_TO_QUEUE',
      products: []
    });
    assert.strictEqual(res.success, false);
    assert(res.error.includes('Tidak ada data produk yang valid'));
  });

  await itAsync('Should safely export and import entire database JSON backup', async () => {
    const exportRes = await background.messageRouter.dispatch({ action: 'EXPORT_DATABASE' });
    assert.strictEqual(exportRes.success, true);
    assert(exportRes.data.version !== undefined);
    assert(Array.isArray(exportRes.data.queue));

    // Clear and restore
    await db.clearQueue();
    assert.strictEqual((await db.getQueue()).length, 0);

    const importRes = await background.messageRouter.dispatch({
      action: 'IMPORT_DATABASE',
      data: exportRes.data
    });
    assert.strictEqual(importRes.success, true);
    assert.strictEqual((await db.getQueue()).length, 3);
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 8. CSV EXPORT & IMPORT VERIFICATION ---');
  // --------------------------------------------------------------------------
  it('Should generate valid CSV string and parse back into product objects', () => {
    const sampleItems = [
      { id: '1', title: 'Produk A, Spesial', price: 'Rp 50.000', shortLink: 'https://s.shopee.co.id/a', caption: 'Caption A' },
      { id: '2', title: 'Produk B "Best"', price: 'Rp 100.000', shortLink: 'https://s.shopee.co.id/b', caption: 'Caption B' }
    ];

    const csvStr = csvHelper.generateCSVString(sampleItems);
    assert(csvStr.includes('"Produk A, Spesial"'));
    assert(csvStr.includes('"Produk B ""Best"""'));

    const parsed = csvHelper.parseCSVToProducts(csvStr);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].title, 'Produk A, Spesial');
    assert.strictEqual(parsed[1].title, 'Produk B "Best"');
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 9. DEDICATED POSTER PANEL ROUTING ---');
  // --------------------------------------------------------------------------
  await itAsync('Should successfully handle OPEN_POSTER_PANEL and return poster panel URL', async () => {
    const res = await background.messageRouter.dispatch({ action: 'OPEN_POSTER_PANEL' });
    assert.strictEqual(res.success, true);
    assert(res.url.includes('panel/poster-panel.html'));
  });

  // --------------------------------------------------------------------------
  console.log('\n--- 10. CENTRALIZED LOGGER & RING BUFFER VERIFICATION ---');
  // --------------------------------------------------------------------------
  it('Should log messages across all levels and maintain buffer correctly', () => {
    Logger.clearBuffer();
    assert.strictEqual(Logger.getBuffer().length, 0);

    Logger.info('Test Info Message', { tag: 'TEST', source: 'QA' });
    Logger.debug('Test Debug Message', { tag: 'TEST', source: 'QA' });
    Logger.dom('Test DOM Mutation', { tag: 'DOM_TEST', source: 'QA' });
    Logger.success('Test Success Operation', { tag: 'TEST', source: 'QA' });
    Logger.warn('Test Warning Notice', { tag: 'TEST', source: 'QA' });
    Logger.error('Test Error Triggered', { tag: 'TEST', source: 'QA' });

    const buffer = Logger.getBuffer();
    assert.strictEqual(buffer.length, 6);
    assert.strictEqual(buffer[0].level, 'INFO');
    assert.strictEqual(buffer[1].level, 'DEBUG');
    assert.strictEqual(buffer[2].level, 'DOM');
    assert.strictEqual(buffer[3].level, 'SUCCESS');
    assert.strictEqual(buffer[4].level, 'WARN');
    assert.strictEqual(buffer[5].level, 'ERROR');

    const filtered = Logger.getFilteredBuffer({ level: 'ERROR' });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].message, 'Test Error Triggered');
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED WITH 100% SUCCESS!`);
  console.log('===============================================================\n');

  process.exit(0);
}

runTestSuite().catch((e) => {
  console.error('Fatal Test Suite Error:', e);
  process.exit(1);
});
