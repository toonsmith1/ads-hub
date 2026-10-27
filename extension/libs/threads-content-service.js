/**
 * @file threads-content-service.js
 * @description Threads Content Service for generating captions, managing spintax variations,
 * formatting clean text for Threads posts (Thai Edition). Pure modular utility with zero auto-loop/scheduler.
 * 
 * Target: Google Chrome Extension Manifest V3 (Content Script, Popup, Dashboard, Service Worker, Node.js)
 * @author sodikinnaa
 * @license MIT
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ThreadsContentService = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Default Threads Preset Templates - Clean Text Format (Thai Edition)
   */
  const THREADS_TEMPLATES = [
    {
      id: 'racun_shopee',
      name: 'สไตล์ป้ายยา Shopee / กันเอง (Clean)',
      category: 'viral',
      description: 'สไตล์เป็นกันเอง ดึงดูดความสนใจ อ่านง่าย ไม่มีสัญลักษณ์เพี้ยน',
      template: `{บอกเลยว่าดีมาก!|คุ้มเกินราคามาก!|ไม่คิดว่าจะดีขนาดนี้!|ของมันต้องมีแล้วไหม!}\n{กำลังฮิตสุดๆ|คนตามหาเยอะมาก|ไอเทมแนะนำวันนี้}: {nama_produk}\n\n{ราคาเพียง|ได้มาในราคา|แค่}: {harga} {diskon}\nคะแนน: {rating}/5 | ขายแล้ว {terjual}\n\n{สั่งซื้อตรงนี้เลย|เช็คราคาและกดสั่งที่นี่|ลิงก์โปรโมชั่นของแท้|แปะพิกัดร้านให้แล้ว}:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'edukasi_review',
      name: 'สไตล์รีวิวจริงใจ / Honest Review (Clean)',
      category: 'home_living',
      description: 'รีวิวตรงไปตรงมา ดูดี เน้นจุดเด่นและความคุ้มค่าของสินค้า',
      template: `{รีวิวจากใจหลังลองใช้:|ป้ายยาไอเทมเด็ด:|แนะนำสินค้าคัดมาแล้วว่าดี:}\n\n{nama_produk}\n\n{คุ้มค่ากับการซื้อมาก|คุณภาพเกินความคาดหมาย|ดีไซน์และวัสดุงานดีสุดๆ} เหมาะกับใช้ในชีวิตประจำวันมาก\n\nราคา: {harga} {diskon}\nความพึงพอใจผู้ซื้อ: {rating}/5 (ขายแล้ว {terjual})\n\nพิกัดสั่งซื้อของแท้:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'promo_diskon',
      name: 'สไตล์แจ้งเตือนโปรโมชั่น / Flash Sale (Clean)',
      category: 'viral',
      description: 'เน้นโปรโมชั่นจำกัดเวลา กระตุ้นให้รีบกดสั่งซื้อ',
      template: `แจ้งพิกัดโปรเด็ด SHOPEE!\n{nama_produk}\n\n{กำลังลดราคาแรงมาก|ราคาลงเยอะสุดๆ|โปรโมชั่นพิเศษวันนี้}!\nตอนนี้เหลือเพียง: {harga} {diskon}\nยอดขายปังมาก: {terjual} (คะแนน {rating}/5)\n\nรีบคลิกลิงก์ด้านล่างก่อนของหมด:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'solusi_praktis',
      name: 'สไตล์ตัวช่วยแก้ปัญหา & Lifehack (Clean)',
      category: 'elektronik',
      description: 'นำเสนอสินค้าในมุมที่เป็นตัวช่วยแก้ปัญหาในชีวิตประจำวัน',
      template: `{ตัวช่วยสำหรับคนที่กำลังมองหาสิ่งนี้:|ไอเทมดีๆ ที่ช่วยให้ชีวิตง่ายขึ้นเยอะ:|แนะนำของใช้ฟังก์ชันครบ:}\n\n{nama_produk}\n\n{ใช้งานได้จริง ช่วยประหยัดเวลาสุดๆ|พกพาสะดวก ทนทาน และราคาคุ้มมาก}\n\nราคา: {harga} {diskon}\nคะแนน: {rating}/5 (ขายแล้ว {terjual})\n\nลิงก์โปรโมชั่นทางการ:\n{link_affiliate}\n\n{hashtag_random}`
    },
    {
      id: 'simple_direct',
      name: 'สไตล์สั้นกระชับ & แปะพิกัดทันที (Clean)',
      category: 'viral',
      description: 'สั้น กระชับ วางลิงก์สั่งซื้อทันทีไม่อ้อมค้อม',
      template: `{nama_produk}\n\n{แปะพิกัดสั่งซื้อไว้ให้ตรงนี้นะ:|ลิงก์สั่งซื้อสินค้าของแท้:|รีบกดสั่งก่อนของหมดสต็อก:}\n{link_affiliate}\n\nราคา: {harga} {diskon} | คะแนน {rating}/5 (ขายแล้ว {terjual})\n\n{hashtag_random}`
    }
  ];

  /**
   * Default Hashtag Pool (Thai Edition)
   */
  const HASHTAG_BANKS = {
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
      '#ลุคสบายๆ', '#แบรนด์ไทย', '#สตรีทแวร์', '#เดรสสวยๆ'
    ],
    elektronik: [
      '#แกดเจ็ต', '#ป้ายยาไอที', '#จัดโต๊ะคอม', '#DeskSetupTH',
      '#รีวิวไอที', '#Shopeeอิเล็กทรอนิกส์', '#สมาร์ทโฮม', '#อุปกรณ์มือถือ',
      '#แกดเจ็ตน่าใช้', '#หูฟังบลูทูธ', '#พาวเวอร์แบงค์', '#ShopeeTech'
    ],
    home_living: [
      '#แต่งห้องนอน', '#ของแต่งบ้าน', '#ไอเดียแต่งบ้าน', '#ป้ายยาของแต่งบ้าน',
      '#เครื่องครัว', '#บ้านมินิมอล', '#แต่งห้องมินิมอล', '#ของใช้ในบ้าน',
      '#ครัวมินิมอล', '#ShopeeHome', '#จัดระเบียบบ้าน', '#เฟอร์นิเจอร์มินิมอล'
    ],
    beauty: [
      '#สกินแคร์', '#ป้ายยาสกินแคร์', '#แต่งหน้า', '#เคล็ดลับความสวย',
      '#รูทีนสกินแคร์', '#บิวตี้ไอเทม', '#ShopeeBeautyTH', '#ลิปสติกสีสวย'
    ]
  };

  /**
   * System variable identifiers
   */
  const SYSTEM_VARIABLES = new Set([
    'nama_produk', 'product_name', 'judul', 'title', 'name',
    'harga', 'price',
    'diskon', 'discount',
    'link_affiliate', 'short_link', 'shortlink', 'link', 'url', 'affiliate_link',
    'rating', 'stars', 'rate',
    'terjual', 'sold', 'sales',
    'komisi', 'comm_rate', 'commission', 'commrate', 'estimasi_komisi',
    'kategori', 'category',
    'hashtag_random', 'hashtags'
  ]);

  class ThreadsContentService {
    constructor() {
      this.templates = [...THREADS_TEMPLATES];
      this.hashtagBanks = { ...HASHTAG_BANKS };
      this.characterLimit = 500;
    }

    getTemplates() {
      return JSON.parse(JSON.stringify(this.templates));
    }

    getTemplateById(id) {
      return this.templates.find(t => t.id === id) || this.templates[0];
    }

    /**
     * Remove emojis and non-standard symbols while preserving Thai characters (\u0E00-\u0E7F)
     * @param {string} str 
     * @returns {string} Clean string
     */
    stripEmojis(str) {
      if (!str || typeof str !== 'string') return '';
      return str
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '')
        .replace(/[\u200D\uFE0F]/g, '')
        .replace(/[^\x00-\x7F\u0080-\u00FF\u0E00-\u0E7F\s\r\n.,!?:;'"()\-_/#%@=+฿]/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }

    /**
     * Parse nested spintax {A|B|C}
     * Safe against system variables like {nama_produk}
     * @param {string} text 
     * @returns {string}
     */
    parseSpintax(text) {
      if (!text || typeof text !== 'string') return '';

      const spintaxRegex = /\{([^{}]+)\}/;
      let match;
      let iteration = 0;
      const maxIterations = 500;
      let parsed = text;

      while ((match = spintaxRegex.exec(parsed)) !== null && iteration < maxIterations) {
        iteration++;
        const content = match[1];

        // If system variable without pipe, preserve it
        if (!content.includes('|') && SYSTEM_VARIABLES.has(content.trim().toLowerCase())) {
          parsed = parsed.slice(0, match.index) + `___SYSVAR_${content}___` + parsed.slice(match.index + match[0].length);
          continue;
        }

        const options = content.split('|');
        const chosen = options[Math.floor(Math.random() * options.length)].trim();
        parsed = parsed.slice(0, match.index) + chosen + parsed.slice(match.index + match[0].length);
      }

      parsed = parsed.replace(/___SYSVAR_([a-zA-Z0-9_]+)___/g, '{$1}');
      return parsed;
    }

    /**
     * Pick N unique hashtags randomly from category
     * @param {string} category 
     * @param {number} count 
     * @returns {string}
     */
    getRandomHashtags(category = 'viral', count = 3) {
      const bank = this.hashtagBanks[category] || this.hashtagBanks.viral;
      const shuffled = [...bank].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, Math.min(count, shuffled.length)).join(' ');
    }

    /**
     * Replace all variable placeholders in text with sanitized product details
     * @param {string} text 
     * @param {Object} product 
     * @param {Object} [options] 
     * @returns {string}
     */
    replaceVariables(text, product, options = {}) {
      if (!text || typeof text !== 'string') return '';

      const p = product || {};
      const category = options.category || p.category || p.kategori || 'viral';
      const hashtagCount = options.hashtagCount !== undefined ? options.hashtagCount : 3;

      const title = (p.title || p.rawTitle || p.name || p.product_name || 'สินค้าแนะนำ Shopee').trim();

      let price = (p.price || p.harga || '-').toString().trim();
      if (price !== '-' && !price.startsWith('฿') && !price.toLowerCase().startsWith('thb') && !price.toLowerCase().startsWith('rp')) {
        price = `฿${price}`;
      }

      let discount = (p.discount || p.diskon || '').toString().trim();
      if (discount && !discount.includes('%') && !discount.toLowerCase().includes('ลด')) {
        discount = `(ลด ${discount}%)`;
      } else if (discount && !discount.startsWith('(') && !discount.endsWith(')')) {
        discount = `(${discount})`;
      }

      const shortLink = (p.shortLink || p.short_link || p.affiliate_link || p.link || p.url || '').trim();

      // Clean rating: remove any existing emoji symbol and format as pure number
      let rawRating = (p.rating || p.rating_star || '4.9').toString();
      let ratingNumber = rawRating.replace(/[^0-9.]/g, '').trim() || '4.9';

      // Clean sold: remove redundant words
      let rawSold = (p.sold || p.terjual || '1พัน+').toString().trim();
      let cleanSold = rawSold.replace(/terjual|ขายแล้ว|ชิ้น/gi, '').trim();
      if (!cleanSold) cleanSold = '1พัน+';

      const commission = (p.commission || p.comm_rate || p.komisi || '-').toString().trim();
      const categoryName = (p.category || p.kategori || 'สินค้าแนะนำ').toString().trim();

      const randomHashtags = typeof options.randomHashtags === 'string'
        ? options.randomHashtags
        : this.getRandomHashtags(category, hashtagCount);

      const replacements = {
        '{nama_produk}': title,
        '{product_name}': title,
        '{judul}': title,
        '{title}': title,
        '{name}': title,

        '{harga}': price,
        '{price}': price,

        '{diskon}': discount,
        '{discount}': discount,

        '{link_affiliate}': shortLink,
        '{short_link}': shortLink,
        '{shortlink}': shortLink,
        '{link}': shortLink,
        '{url}': shortLink,
        '{affiliate_link}': shortLink,

        '{rating}': ratingNumber,
        '{stars}': ratingNumber,
        '{rate}': ratingNumber,

        '{terjual}': cleanSold,
        '{sold}': cleanSold,
        '{sales}': cleanSold,

        '{komisi}': commission,
        '{comm_rate}': commission,
        '{commission}': commission,

        '{kategori}': categoryName,
        '{category}': categoryName,

        '{hashtag_random}': randomHashtags,
        '{hashtags}': randomHashtags
      };

      let result = text;
      for (const [placeholder, value] of Object.entries(replacements)) {
        const escaped = placeholder.replace(/[{}]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'gi'), value);
      }

      return this.formatParagraphs(result);
    }

    /**
     * Clean and format paragraphs nicely for Threads
     * @param {string} text 
     * @returns {string}
     */
    formatParagraphs(text) {
      if (!text || typeof text !== 'string') return '';
      return text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    /**
     * Generate complete ready-to-use Threads post caption
     * @param {string|Object} templateInput 
     * @param {Object} product 
     * @param {Object} [options] 
     * @returns {string}
     */
    generateCaption(templateInput, product, options = {}) {
      let rawTemplate = '';
      if (typeof templateInput === 'string') {
        const found = this.getTemplateById(templateInput);
        rawTemplate = found ? found.template : templateInput;
      } else if (templateInput && typeof templateInput.template === 'string') {
        rawTemplate = templateInput.template;
      } else {
        rawTemplate = this.templates[0].template;
      }

      const spun = this.parseSpintax(rawTemplate);
      let filled = this.replaceVariables(spun, product, options);

      if (options.cleanOnly || options.noEmoji) {
        filled = this.stripEmojis(filled);
      }

      return filled;
    }

    /**
     * Get character count and limit stats
     * @param {string} text 
     * @returns {{ length: number, remaining: number, isOverLimit: boolean, max: number }}
     */
    getCharacterStats(text) {
      const length = (text || '').length;
      return {
        length,
        remaining: this.characterLimit - length,
        isOverLimit: length > this.characterLimit,
        max: this.characterLimit
      };
    }

    /**
     * Generate standard Threads web intent URL for 1-click opening with pre-filled text
     * @param {string} text 
     * @returns {string}
     */
    getThreadsIntentUrl(text) {
      const encoded = encodeURIComponent(text || '');
      return `https://www.threads.net/intent/post?text=${encoded}`;
    }
  }

  return new ThreadsContentService();
});
