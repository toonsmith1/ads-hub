/**
 * @file constants.js
 * @description Centralized Constants for Shopee Affiliate Downloader & Threads Auto-Poster (Thai Edition)
 * Compatible across Chrome Extension MV3 contexts: Content Scripts, Popup, Dashboard, Service Worker, and Node.js.
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root) {
  'use strict';

  /**
   * Runtime Message Action Types
   * Used for communication between Content Scripts, Popup, Dashboard, and Service Worker.
   */
  const ACTIONS = {
    // Queue Operations
    ADD_TO_QUEUE: 'ADD_TO_QUEUE',
    ADD_BATCH_TO_QUEUE: 'ADD_BATCH_TO_QUEUE',
    GET_QUEUE: 'GET_QUEUE',
    UPDATE_QUEUE_ITEM: 'UPDATE_QUEUE_ITEM',
    DELETE_QUEUE_ITEM: 'DELETE_QUEUE_ITEM',
    CLEAR_QUEUE: 'CLEAR_QUEUE',
    GET_QUEUE_STATS: 'GET_QUEUE_STATS',
    POST_SINGLE_ITEM: 'POST_SINGLE_ITEM',
    POST_NEXT_ITEM: 'POST_NEXT_ITEM',
    EXECUTE_POST_NOW: 'EXECUTE_POST_NOW',

    // Queue Alarm & Scheduler Controls
    START_QUEUE: 'START_QUEUE',
    START_QUEUE_ALARM: 'START_QUEUE_ALARM',
    STOP_QUEUE: 'STOP_QUEUE',
    STOP_QUEUE_ALARM: 'STOP_QUEUE_ALARM',
    PAUSE_QUEUE: 'PAUSE_QUEUE',
    GET_QUEUE_STATUS: 'GET_QUEUE_STATUS',

    // Threads Composer & Injection & Widget
    INJECT_POST_PAYLOAD: 'INJECT_POST_PAYLOAD',
    FOCUS_OR_OPEN_THREADS: 'FOCUS_OR_OPEN_THREADS',
    OPEN_THREADS_WIDGET: 'OPEN_THREADS_WIDGET',

    // Broadcast Events & Desktop Notifications
    QUEUE_UPDATED: 'QUEUE_UPDATED',
    QUEUE_STATUS_CHANGED: 'QUEUE_STATUS_CHANGED',
    POST_COMPLETED: 'POST_COMPLETED',
    POST_FAILED: 'POST_FAILED',
    NOTIFY_POST_SUCCESS: 'NOTIFY_POST_SUCCESS',
    NOTIFY_POST_FAILED: 'NOTIFY_POST_FAILED',

    // Activity & Debug Logs
    GET_LOGS: 'GET_LOGS',
    ADD_LOG: 'ADD_LOG',
    DELETE_LOG: 'DELETE_LOG',
    CLEAR_LOGS: 'CLEAR_LOGS',
    DEBUG_LOG_STREAM: 'DEBUG_LOG_STREAM',

    // Settings
    GET_SETTINGS: 'GET_SETTINGS',
    UPDATE_SETTINGS: 'UPDATE_SETTINGS',

    // Navigation & Window
    OPEN_DASHBOARD: 'OPEN_DASHBOARD',
    OPEN_POSTER_PANEL: 'OPEN_POSTER_PANEL',

    // Scraper & Affiliate Actions
    SCRAPE_PRODUCT_DATA: 'SCRAPE_PRODUCT_DATA',
    GENERATE_SHORTLINK: 'GENERATE_SHORTLINK',
    DOWNLOAD_IMAGES: 'DOWNLOAD_IMAGES',
    DOWNLOAD_ZIP: 'DOWNLOAD_ZIP'
  };

  /**
   * Chrome Storage Keys
   */
  const STORAGE_KEYS = {
    QUEUE: 'threads_queue',
    LOGS: 'threads_logs',
    HISTORY: 'threads_history',
    SETTINGS: 'threads_settings',
    TEMPLATES: 'threads_templates',
    PRODUCTS: 'threads_products'
  };

  /**
   * Queue Item Statuses
   */
  const QUEUE_STATUS = {
    PENDING: 'PENDING',
    POSTING: 'POSTING',
    PROCESSING: 'POSTING',
    POSTED: 'POSTED',
    FAILED: 'FAILED'
  };

  /**
   * Default Extension Settings
   */
  const DEFAULT_SETTINGS = {
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
   * Preset Spintax Templates (Thai Edition)
   */
  const PRESET_TEMPLATES = [
    {
      id: 'preset_racun_viral',
      name: '🔥 ป้ายยา Shopee ไวรัล (ยอดมีส่วนร่วมสูง)',
      category: 'viral',
      isDefault: true,
      is_default: true,
      template: `{บอกเลยว่าดีมาก|คุ้มเกินราคา|ไม่คิดว่าจะดีขนาดนี้|ของมันต้องมี}! 😍🔥\n{กำลังฮิตสุดๆ|คนตามหาเยอะมาก|ไอเทมแนะนำวันนี้}: {nama_produk}\n\n💸 {ราคาเพียง|ได้มาในราคา|แค่}: {harga} {diskon}\n⭐ คะแนน: {rating} | ขายแล้ว {terjual}\n\n🔗 {พิกัดสั่งซื้อตรงนี้เลย|กดสั่งซื้อที่นี่|ลิงก์โปรโมชั่นของแท้|แปะพิกัดร้านให้แล้ว}:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'preset_aesthetic_review',
      name: '✨ รีวิวมินิมอล & รีวิวจากผู้ใช้จริง',
      category: 'home_living',
      isDefault: false,
      is_default: false,
      template: `{ป้ายยาของแต่งบ้านมินิมอล ✨|รีวิวแบบไม่อวย 🤍|ไอเทมลับใน Shopee ที่ต้องบอกต่อ 🌿}\n\n{nama_produk}\n{คุ้มค่าแก่การตำมาก|คุณภาพเกินราคาไปไกล|ดีไซน์สวย ใช้งานได้จริง}!\n\n💰 {ราคาโปรโมชั่น}: {harga}\n🌟 {คะแนนรีวิว}: {rating} (ขายแล้ว {terjual})\n\n🛒 {พิกัดสินค้าของแท้|ลิงก์สั่งซื้อทางการ}:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'preset_diskon_promo',
      name: '🚨 แจ้งเตือน Flash Sale & โปรเด็ด',
      category: 'viral',
      isDefault: false,
      is_default: false,
      template: `🚨 {โปรเด็ดห้ามพลาด|FLASH SALE มาแล้ว|ลดราคาแรงมาก}! 🚨\n{nama_produk}\n\n⚡ {กำลังลดจัดหนัก|ราคาดิ่งลงสุดๆ|โปรพิเศษวันนี้เท่านั้น}!\n🏷️ {เหลือเพียง}: {harga} {diskon}\n✨ {ขายแล้ว}: {terjual} | คะแนน {rating}\n\n👇 {รีบกดเก็บโค้ดก่อนของหมด|คลิกลิงก์ด้านล่างนี้เลย|พิกัดโปร Shopee}:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'preset_solusi_lifehack',
      name: '💡 ไอเทมแก้ปัญหา & ตัวช่วยชีวิตง่ายขึ้น',
      category: 'elektronik',
      isDefault: false,
      is_default: false,
      template: `{ตัวช่วยสำหรับคนที่กำลังหาสิ่งนี้|ไอเทมมีประโยชน์ที่ช่วยให้ชีวิตง่ายขึ้น|รู้งี้ซื้อมาใช้ตั้งนานแล้ว}! 🙌\n\n📌 {nama_produk}\n{ใช้งานได้จริง ตอบโจทย์สุดๆ|พกพาง่าย ทนทาน ราคาสบายกระเป๋า}\n\n💵 {ราคา}: {harga}\n⭐ {ความพึงพอใจ}: {rating} (ขายแล้ว {terjual})\n\n👉 {รายละเอียด & สั่งซื้อ|ลิงก์โปรโมชั่น}:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'preset_simple_direct',
      name: '🎯 สั้น กระชับ แปะพิกัดทันที',
      category: 'viral',
      isDefault: false,
      is_default: false,
      template: `{nama_produk}\n\n{แปะพิกัดให้แล้วนะทุกคน|ใครที่ถามหาพิกัดอยู่ กดตรงนี้เลย|รีบกดก่อนของหมดสต็อก}:\n👉 {link_affiliate}\n\n💸 {ราคา}: {harga} | ⭐ คะแนน: {rating} ({terjual})\n\n{hashtag_random}`
    }
  ];

  /**
   * Categorized Hashtag Bank (Thai Edition)
   */
  const HASHTAG_BANK = {
    viral: [
      '#ป้ายยาShopee', '#รีวิวShopee', '#ของดีบอกต่อ', '#ShopeeTH',
      '#ของมันต้องมี', '#ถูกและดี', '#ชี้เป้าโปรถูก', '#ShopeeAffiliateTH',
      '#พิกัดของดี', '#ลดราคา', '#FlashSaleShopee', '#โปรโมชั่น',
      '#รีวิวของดี', '#ป้ายยา', '#ช้อปปี้ป้ายยา', '#ดีลเด็ดShopee',
      '#ไอเทมฮิต', '#ช้อปปี้', '#ซื้ออะไรดี', '#ป้ายยาของกุ๊กกิ๊ก'
    ],
    fashion: [
      '#OOTDThailand', '#แฟชั่นShopee', '#แต่งตัวกัน', '#ป้ายยาแฟชั่น',
      '#สไตล์เกาหลี', '#เสื้อผ้าแฟชั่น', '#ไอเดียแต่งตัว', '#ช้อปปี้แฟชั่น',
      '#ลุคสบายๆ', '#แบรนด์ไทย', '#สตรีทแวร์', '#เดรสสวยๆ',
      '#รองเท้าผ้าใบ', '#พิกัดเสื้อผ้า', '#ชุดไปคาเฟ่', '#เสื้อผ้าราคาถูก',
      '#กางเกงขายาว', '#กระเป๋าสะพายข้าง', '#แต่งตัวมินิมอล', '#แฟชั่นผู้หญิง'
    ],
    elektronik: [
      '#แกดเจ็ต', '#ป้ายยาไอที', '#จัดโต๊ะคอม', '#DeskSetupTH',
      '#รีวิวไอที', '#Shopeeอิเล็กทรอนิกส์', '#สมาร์ทโฮม', '#อุปกรณ์มือถือ',
      '#แกดเจ็ตน่าใช้', '#หูฟังบลูทูธ', '#พาวเวอร์แบงค์', '#ShopeeTech',
      '#หูฟังไร้สาย', '#คีย์บอร์ดไร้สาย', '#สมาร์ทวอทช์',
      '#อุปกรณ์เกมมิ่ง', '#ของมันต้องมีไอที', '#อุปกรณ์คอมพิวเตอร์', '#ไอเทมไอที', '#รีวิวแกดเจ็ต'
    ],
    home_living: [
      '#แต่งห้องนอน', '#ของแต่งบ้าน', '#ไอเดียแต่งบ้าน', '#ป้ายยาของแต่งบ้าน',
      '#เครื่องครัว', '#บ้านมินิมอล', '#แต่งห้องมินิมอล', '#ของใช้ในบ้าน',
      '#ครัวมินิมอล', '#ShopeeHome', '#จัดระเบียบบ้าน', '#เฟอร์นิเจอร์มินิมอล',
      '#ไอเดียแต่งห้อง', '#ของใช้จุกจิก', '#ห้องครัวสวยๆ', '#ห้องนอนในฝัน',
      '#อุปกรณ์ทำความสะอาด', '#แม่บ้านรีวิว', '#บ้านในฝัน', '#รีวิวของแต่งบ้าน'
    ],
    beauty: [
      '#สกินแคร์', '#ป้ายยาสกินแคร์', '#แต่งหน้า', '#เคล็ดลับความสวย',
      '#รูทีนสกินแคร์', '#บิวตี้ไอเทม', '#ShopeeBeautyTH', '#ลิปสติกสีสวย',
      '#รีวิวกันแดด', '#สกินแคร์ถูกและดี', '#ไอเดียแต่งหน้า', '#เซรั่มหน้าใส',
      '#มอยส์เจอไรเซอร์', '#รีวิวบิวตี้', '#ดูแลผิว', '#คุชชั่นงานผิว',
      '#รักษาสิว', '#ผิวแพ้ง่าย', '#ผิวใส', '#เครื่องสำอางถูกและดี'
    ],
    food_snack: [
      '#ของกินอร่อย', '#ขนมShopee', '#ขนมกินเล่น', '#รีวิวของกิน',
      '#ขนมสุดฮิต', '#ป้ายยาของกิน', '#อาหารรสเด็ด', '#สายกิน',
      '#ShopeeFoodTH', '#ขนมเผ็ดๆ', '#ขนมราคาถูก', '#อร่อยบอกต่อ',
      '#ของว่าง', '#อาหารสำเร็จรูป', '#ของกินเล่น', '#ขนมนำเข้า'
    ]
  };

  /**
   * Standard Column Mapping for CSV Exports/Imports
   */
  const QUEUE_COLUMNS = [
    { key: 'id', header: 'id', label: 'id' },
    { key: 'title', header: 'nama_produk', label: 'nama_produk' },
    { key: 'price', header: 'harga', label: 'harga' },
    { key: 'discount', header: 'diskon', label: 'diskon' },
    { key: 'rating', header: 'rating', label: 'rating' },
    { key: 'sold', header: 'terjual', label: 'terjual' },
    { key: 'commission', header: 'estimasi_komisi', label: 'estimasi_komisi' },
    { key: 'shortLink', header: 'link_affiliate', label: 'link_affiliate' },
    { key: 'primaryImage', header: 'foto_produk', label: 'foto_produk' },
    { key: 'imageUrls', header: 'url_foto_hd', label: 'url_foto_hd' },
    { key: 'caption', header: 'caption_threads', label: 'caption_threads' },
    { key: 'status', header: 'status', label: 'status' },
    { key: 'scheduleTime', header: 'waktu_jadwal', label: 'waktu_jadwal' },
    { key: 'postedAt', header: 'waktu_post', label: 'waktu_post' },
    { key: 'threadsUrl', header: 'link_post_threads', label: 'link_post_threads' },
    { key: 'createdAt', header: 'waktu_dibuat', label: 'waktu_dibuat' }
  ];

  /**
   * Unified Constants Container
   */
  const CONSTANTS = {
    ACTIONS,
    MESSAGE_ACTIONS: ACTIONS,
    STORAGE_KEYS,
    QUEUE_STATUS,
    DEFAULT_SETTINGS,
    DEFAULT_TEMPLATES: PRESET_TEMPLATES,
    PRESET_TEMPLATES,
    HASHTAG_BANK,
    DEFAULT_HASHTAGS: HASHTAG_BANK,
    QUEUE_COLUMNS
  };

  // Export for CommonJS (Node.js)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONSTANTS;
    module.exports.CONSTANTS = CONSTANTS;
    module.exports.ExtensionConstants = CONSTANTS;
    module.exports.ACTIONS = ACTIONS;
    module.exports.MESSAGE_ACTIONS = ACTIONS;
    module.exports.STORAGE_KEYS = STORAGE_KEYS;
    module.exports.QUEUE_STATUS = QUEUE_STATUS;
    module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
    module.exports.DEFAULT_TEMPLATES = PRESET_TEMPLATES;
    module.exports.PRESET_TEMPLATES = PRESET_TEMPLATES;
    module.exports.HASHTAG_BANK = HASHTAG_BANK;
    module.exports.DEFAULT_HASHTAGS = HASHTAG_BANK;
    module.exports.QUEUE_COLUMNS = QUEUE_COLUMNS;
  }

  // Export to global scope (Browser Window, Content Script, Service Worker)
  if (root) {
    root.CONSTANTS = CONSTANTS;
    root.ExtensionConstants = CONSTANTS;
    root.ACTIONS = ACTIONS;
    root.MESSAGE_ACTIONS = ACTIONS;
    root.STORAGE_KEYS = STORAGE_KEYS;
    root.QUEUE_STATUS = QUEUE_STATUS;
    root.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
    root.DEFAULT_TEMPLATES = PRESET_TEMPLATES;
    root.PRESET_TEMPLATES = PRESET_TEMPLATES;
    root.HASHTAG_BANK = HASHTAG_BANK;
    root.DEFAULT_HASHTAGS = HASHTAG_BANK;
    root.QUEUE_COLUMNS = QUEUE_COLUMNS;
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : typeof global !== 'undefined' ? global
  : this);
