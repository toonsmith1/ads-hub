/**
 * @file spintax.js
 * @description Spintax Parser & Dynamic Caption Engine for Shopee Affiliate & Threads Auto-Poster (Thai Edition)
 * Generates unique caption variations using nested spintax, dynamic product variables, and category hashtag banks.
 * 
 * Target: Google Chrome Extension Manifest V3 (Content Script, Popup, Dashboard, Service Worker, Node.js)
 * @author sodikinnaa
 * @license MIT
 */

(function (root) {
  'use strict';

  // Obtain constants from global CONSTANTS if available
  const APP_CONSTANTS = (typeof root !== 'undefined' && root.CONSTANTS) || {};

  /**
   * Default Category Hashtag Banks (Thai Edition)
   */
  const DEFAULT_HASHTAG_BANK = APP_CONSTANTS.HASHTAG_BANK || {
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
   * Default High-Converting Preset Templates (Thai Edition)
   */
  const DEFAULT_PRESET_TEMPLATES = APP_CONSTANTS.PRESET_TEMPLATES || APP_CONSTANTS.DEFAULT_TEMPLATES || [
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
   * System variable identifiers that should not be spun if un-piped
   */
  const SYSTEM_VARIABLES = new Set([
    'nama_produk', 'product_name', 'judul', 'title', 'name',
    'harga', 'price',
    'diskon', 'discount',
    'link_affiliate', 'short_link', 'link', 'url', 'affiliate_link',
    'rating', 'stars', 'rate',
    'terjual', 'sold', 'sales',
    'komisi', 'comm_rate', 'commission', 'commrate', 'estimasi_komisi',
    'kategori', 'category',
    'hashtag_random', 'hashtags'
  ]);

  /**
   * Core Spintax & Caption Engine Class
   */
  class SpintaxEngine {
    constructor(customBank = null, customTemplates = null) {
      this.hashtagBank = customBank || DEFAULT_HASHTAG_BANK;
      this.defaultTemplates = customTemplates || DEFAULT_PRESET_TEMPLATES;
    }

    static get HASHTAG_BANK() { return DEFAULT_HASHTAG_BANK; }
    static get defaultHashtags() { return DEFAULT_HASHTAG_BANK; }
    static get hashtagBank() { return DEFAULT_HASHTAG_BANK; }
    static get DEFAULT_TEMPLATES() { return DEFAULT_PRESET_TEMPLATES; }
    static get defaultTemplates() { return DEFAULT_PRESET_TEMPLATES; }

    _isSystemVariable(token) {
      if (!token) return false;
      return SYSTEM_VARIABLES.has(token.trim().toLowerCase());
    }

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

        if (!content.includes('|') && this._isSystemVariable(content)) {
          parsed = parsed.slice(0, match.index) + `___SYSVAR_${content}___` + parsed.slice(match.index + match[0].length);
          continue;
        }

        const options = content.split('|');
        const randomIndex = Math.floor(Math.random() * options.length);
        const selected = options[randomIndex];

        parsed = parsed.slice(0, match.index) + selected + parsed.slice(match.index + match[0].length);
      }

      return parsed.replace(/___SYSVAR_([a-zA-Z0-9_]+)___/g, '{$1}');
    }

    getRandomHashtags(category = 'viral', count = 3, customBank = null) {
      const bank = customBank || this.hashtagBank || DEFAULT_HASHTAG_BANK;
      let pool = [];

      if (Array.isArray(bank)) {
        pool = [...bank];
      } else if (typeof bank === 'object' && bank !== null) {
        if (category === 'all' || !bank[category]) {
          Object.values(bank).forEach(tags => {
            if (Array.isArray(tags)) pool.push(...tags);
          });
        } else if (Array.isArray(bank[category])) {
          pool = [...bank[category]];
        }
      }

      if (pool.length === 0) {
        pool = (DEFAULT_HASHTAG_BANK.viral && DEFAULT_HASHTAG_BANK.viral.length > 0)
          ? [...DEFAULT_HASHTAG_BANK.viral]
          : ['#ป้ายยาShopee', '#รีวิวShopee', '#ShopeeTH'];
      }

      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const targetCount = Math.max(1, Math.min(typeof count === 'number' ? count : 3, shuffled.length));
      return shuffled.slice(0, targetCount).join(' ');
    }

    replaceVariables(text, product = {}, options = {}) {
      if (!text || typeof text !== 'string') return '';

      const p = product || {};
      const hashtagCategory = options.hashtagCategory || p.category || p.kategori || 'viral';
      const hashtagCount = (options.hashtagCount !== undefined) ? options.hashtagCount : 3;

      const title = (p.title || p.rawTitle || p.name || p.product_name || p.nama_produk || p.judul || 'สินค้าแนะนำ Shopee').trim();

      let price = (p.price || p.harga || p.formatted_price || '-').toString().trim();
      if (price !== '-' && !price.startsWith('฿') && !price.toLowerCase().startsWith('thb') && !price.toLowerCase().startsWith('rp')) {
        price = `฿${price}`;
      }

      let discount = (p.discount || p.diskon || '').toString().trim();
      if (discount && !discount.includes('%') && !discount.toLowerCase().includes('ลด')) {
        discount = `(ลด ${discount}%)`;
      } else if (discount && !discount.startsWith('(') && !discount.endsWith(')')) {
        discount = `(${discount})`;
      }

      const shortLink = (p.short_link || p.shortLink || p.affiliate_link || p.link_affiliate || p.link || p.url || '').trim();
      const rating = (p.rating || p.rating_star || p.stars || '⭐ 4.9').toString().trim();
      const sold = (p.sold || p.terjual || '1พัน+').toString().trim();
      const commRate = (p.comm_rate || p.commission || p.commRate || p.komisi || '-').toString().trim();
      const categoryName = (p.category || p.kategori || 'สินค้าแนะนำ').toString().trim();

      let randomHashtags = '';
      if (typeof options.randomHashtags === 'string') {
        randomHashtags = options.randomHashtags;
      } else {
        const customBank = options.customBank || options.hashtagBanks || options.customHashtags || null;
        randomHashtags = this.getRandomHashtags(hashtagCategory, hashtagCount, customBank);
      }

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
        '{link}': shortLink,
        '{url}': shortLink,
        '{affiliate_link}': shortLink,

        '{rating}': rating,
        '{stars}': rating,
        '{rate}': rating,

        '{terjual}': sold,
        '{sold}': sold,
        '{sales}': sold,

        '{komisi}': commRate,
        '{comm_rate}': commRate,
        '{commission}': commRate,
        '{estimasi_komisi}': commRate,

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

      return result
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    formatTemplate(template, product = {}, options = {}) {
      let tpl = template;
      if (!tpl || typeof tpl !== 'string') {
        if (this.defaultTemplates && this.defaultTemplates.length > 0 && this.defaultTemplates[0].template) {
          tpl = this.defaultTemplates[0].template;
        } else {
          return '';
        }
      }

      const spun = this.parseSpintax(tpl);
      return this.replaceVariables(spun, product, options);
    }

    generateCaption(template, product = {}, customHashtags = null, hashtagCount = 3) {
      let count = hashtagCount;
      let customBank = customHashtags;

      if (typeof customHashtags === 'number') {
        count = customHashtags;
        customBank = null;
      }

      const options = {
        hashtagCount: typeof count === 'number' ? count : 3
      };

      if (typeof customBank === 'string') {
        options.randomHashtags = customBank;
      } else if (customBank && typeof customBank === 'object') {
        options.customBank = customBank;
      }

      return this.formatTemplate(template, product, options);
    }

    generatePreview(template, product = {}, count = 3, options = {}) {
      const dummyProduct = {
        title: 'หูฟังบลูทูธไร้สาย TWS 5.3 เสียงเบสแน่น กันน้ำ แบตอึด',
        price: '฿259',
        diskon: 'ลด 45%',
        rating: '⭐ 4.9',
        terjual: 'ขายแล้ว 1หมื่น+ ชิ้น',
        comm_rate: '12%',
        short_link: 'https://s.shopee.co.th/sample123',
        category: 'elektronik',
        ...product
      };

      const results = [];
      for (let i = 0; i < count; i++) {
        results.push(this.formatTemplate(template, dummyProduct, options));
      }
      return results;
    }

    calculateVariations(template) {
      if (!template || typeof template !== 'string') return 1;

      try {
        let temp = template;
        let totalCombinations = 1;
        const spintaxRegex = /\{([^{}]+)\}/;
        let match;
        let iterations = 0;

        while ((match = spintaxRegex.exec(temp)) !== null && iterations < 200) {
          iterations++;
          const content = match[1];
          if (content.includes('|')) {
            const options = content.split('|');
            totalCombinations *= options.length;
            temp = temp.slice(0, match.index) + options[0] + temp.slice(match.index + match[0].length);
          } else {
            temp = temp.slice(0, match.index) + content + temp.slice(match.index + match[0].length);
          }
        }

        return Math.max(1, totalCombinations);
      } catch (e) {
        return 1;
      }
    }

    getDefaultTemplates() {
      return JSON.parse(JSON.stringify(this.defaultTemplates));
    }

    getAllHashtagBank() {
      return JSON.parse(JSON.stringify(this.hashtagBank));
    }
  }

  const spintaxInstance = new SpintaxEngine();

  Object.getOwnPropertyNames(SpintaxEngine.prototype).forEach(prop => {
    if (prop !== 'constructor' && typeof SpintaxEngine.prototype[prop] === 'function' && !SpintaxEngine[prop]) {
      SpintaxEngine[prop] = function (...args) {
        return spintaxInstance[prop](...args);
      };
    }
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = spintaxInstance;
    module.exports.SpintaxEngine = SpintaxEngine;
    module.exports.SpintaxParser = spintaxInstance;
    module.exports.default = spintaxInstance;
  }

  if (root) {
    root.SpintaxParser = spintaxInstance;
    root.SpintaxEngine = SpintaxEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : typeof global !== 'undefined' ? global
  : this);
