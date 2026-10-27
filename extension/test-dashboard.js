/**
 * Test Suite for Shopee Affiliate CSV & Product Dashboard
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 1. Testing dashboard.html Structure...');
const htmlContent = fs.readFileSync(path.join(__dirname, 'dashboard/dashboard.html'), 'utf8');

// Check Header & Navigation
assert(htmlContent.includes('id="btn-header-import-csv"'), 'dashboard.html should have #btn-header-import-csv');
assert(htmlContent.includes('id="btn-header-export-csv"'), 'dashboard.html should have #btn-header-export-csv');
assert(htmlContent.includes('id="btn-header-download-zip"'), 'dashboard.html should have #btn-header-download-zip');

// Check Stat Cards
assert(htmlContent.includes('id="stat-total-products"'), 'dashboard.html should have #stat-total-products');
assert(htmlContent.includes('id="stat-total-value"'), 'dashboard.html should have #stat-total-value');
assert(htmlContent.includes('id="stat-avg-commission"'), 'dashboard.html should have #stat-avg-commission');
assert(htmlContent.includes('id="stat-total-sold"'), 'dashboard.html should have #stat-total-sold');

// Check Table & Dropzone
assert(htmlContent.includes('id="products-table"'), 'dashboard.html should have #products-table');
assert(htmlContent.includes('id="csv-dropzone"'), 'dashboard.html should have #csv-dropzone');
assert(htmlContent.includes('id="csv-file-input"'), 'dashboard.html should have #csv-file-input');

console.log('  ✅ dashboard.html structure verified successfully!');

console.log('\n🧪 2. Testing Modular CsvService & StorageService...');
const CsvService = require('./libs/csv-service.js');
const StorageService = require('./libs/storage-service.js');

const mockProducts = [
  {
    title: 'Kemeja Pria Slim Fit Casual Premium',
    price: 'Rp 149.000',
    commission: '12%',
    sold: '2.5rb+ terjual',
    shortLink: 'https://s.shopee.co.id/xyz123',
    longLink: 'https://shopee.co.id/product/123/456',
    image: 'https://cf.shopee.co.id/file/test.jpg'
  },
  {
    title: 'Sepatu Sneakers Wanita Korean Style "White Edition"',
    price: 'Rp 210.000',
    commission: '10%',
    sold: '500+ terjual',
    shortLink: 'https://s.shopee.co.id/abc789',
    longLink: 'https://shopee.co.id/product/789/101',
    image: 'https://cf.shopee.co.id/file/sneakers.jpg'
  }
];

const csvOutput = CsvService.generateCSV(mockProducts);
assert(csvOutput.includes('Kemeja Pria Slim Fit Casual Premium'), 'CSV should include product 1 title');
assert(csvOutput.includes('https://s.shopee.co.id/xyz123'), 'CSV should include product 1 short link');
assert(csvOutput.includes('Sepatu Sneakers Wanita Korean Style ""White Edition""'), 'CSV should escape inner quotes');

console.log('  ✅ CsvService.generateCSV passed!');

const txtOutput = CsvService.generateTXT(mockProducts);
assert(txtOutput.includes('DAFTAR LINK SINGKAT AFFILIATE SHOPEE'), 'TXT output should contain header');
assert(txtOutput.includes('https://s.shopee.co.id/xyz123'), 'TXT output should contain link');
console.log('  ✅ CsvService.generateTXT passed!');

const reParsed = CsvService.parseCSV(csvOutput);
assert.strictEqual(reParsed.length, 2, 'Parsed items count should match');
assert.strictEqual(reParsed[0].title, 'Kemeja Pria Slim Fit Casual Premium', 'Parsed item 0 title should match');
assert.strictEqual(reParsed[0].price, 'Rp 149.000', 'Parsed item 0 price should match');
assert.strictEqual(reParsed[0].shortLink, 'https://s.shopee.co.id/xyz123', 'Parsed item 0 link should match');

console.log('  ✅ CsvService.parseCSV roundtrip test passed!');

console.log('\n🧪 3. Testing ThreadsContentService & Spintax Generator...');
const ThreadsService = require('./libs/threads-content-service.js');

// 3a. Check Templates
const templates = ThreadsService.getTemplates();
assert(Array.isArray(templates) && templates.length >= 3, 'ThreadsService should provide multiple preset templates');
const templateIds = templates.map(t => t.id);
assert(templateIds.includes('racun_shopee'), 'Should contain racun_shopee template');
assert(templateIds.includes('edukasi_review'), 'Should contain edukasi_review template');
assert(templateIds.includes('promo_diskon'), 'Should contain promo_diskon template');
console.log('  ✅ Template presets verified!');

// 3b. Test Spintax Parser
const spintaxInput = '{Keren|Mantap|Gila} banget {koleksi|produk} ini!';
const spunResults = new Set();
for (let i = 0; i < 30; i++) {
  spunResults.add(ThreadsService.parseSpintax(spintaxInput));
}
assert(spunResults.size > 1, 'Spintax parser should generate varying choices');
console.log('  ✅ Spintax parser verified with multiple unique variations!');

// 3c. Test Variable Replacement & Hashtags
const testProduct = {
  title: 'Jam Tangan Pria Waterproof Original Sport Watch',
  price: 'Rp 189.000',
  discount: '30%',
  rating: '⭐ 4.9',
  sold: '10rb+ terjual',
  shortLink: 'https://s.shopee.co.id/testjam123',
  category: 'elektronik'
};

const generatedCaption = ThreadsService.generateCaption('racun_shopee', testProduct, {
  category: 'elektronik',
  hashtagCount: 3
});

assert(generatedCaption.includes('Jam Tangan Pria Waterproof Original Sport Watch'), 'Generated caption should contain product title');
assert(generatedCaption.includes('189.000'), 'Generated caption should contain price');
assert(generatedCaption.includes('https://s.shopee.co.id/testjam123'), 'Generated caption should contain affiliate short link');
assert(generatedCaption.includes('#'), 'Generated caption should contain hashtags');
assert(!generatedCaption.includes('{nama_produk}'), 'Generated caption should not contain unreplaced variable {nama_produk}');
assert(!generatedCaption.includes('{harga}'), 'Generated caption should not contain unreplaced variable {harga}');
assert(!generatedCaption.includes('terjual terjual'), 'Generated caption should not have duplicated terjual word');
console.log('  ✅ Caption generator & variable replacement verified without duplicate words!');

// 3d. Test Emoji Stripper
const stripped = ThreadsService.stripEmojis('🔥 Keren parah ⭐ Rp 65.000 👉 beli');
assert(!stripped.includes('🔥'), 'Should strip fire emoji');
assert(!stripped.includes('⭐'), 'Should strip star emoji');
assert(!stripped.includes('👉'), 'Should strip pointer emoji');
assert(stripped.includes('Keren parah'), 'Should preserve plain text');
console.log('  ✅ Emoji & broken symbol stripper verified!');

// 3e. Test Character Stats
const charStats = ThreadsService.getCharacterStats(generatedCaption);
assert(typeof charStats.length === 'number', 'CharStats should provide length');
assert(charStats.max === 500, 'CharStats should have max limit of 500');
assert.strictEqual(charStats.isOverLimit, false, 'Caption should be within 500 chars limit');
console.log('  ✅ Character counter & limit stats verified!');

// 3f. Test Threads Web Intent URL
const intentUrl = ThreadsService.getThreadsIntentUrl('Halo Threads!');
assert(intentUrl.startsWith('https://www.threads.net/intent/post?text='), 'Intent URL should match Threads post format');
assert(intentUrl.includes('Halo%20Threads!'), 'Intent URL should encode text query');
console.log('  ✅ Threads intent URL generation verified!');

// 3g. Test Dashboard HTML Threads Components
assert(htmlContent.includes('id="tab-threads-generator"'), 'dashboard.html should have #tab-threads-generator');
assert(htmlContent.includes('id="threads-product-select"'), 'dashboard.html should have #threads-product-select');
assert(htmlContent.includes('id="threads-template-select"'), 'dashboard.html should have #threads-template-select');
assert(htmlContent.includes('id="threads-caption-editor"'), 'dashboard.html should have #threads-caption-editor');
assert(htmlContent.includes('id="btn-threads-clean-emoji"'), 'dashboard.html should have #btn-threads-clean-emoji');
assert(htmlContent.includes('id="btn-threads-spin-caption"'), 'dashboard.html should have #btn-threads-spin-caption');
assert(htmlContent.includes('id="btn-threads-copy-caption"'), 'dashboard.html should have #btn-threads-copy-caption');
assert(htmlContent.includes('id="btn-threads-open-web"'), 'dashboard.html should have #btn-threads-open-web');
assert(htmlContent.includes('id="btn-threads-fill-tab"'), 'dashboard.html should have #btn-threads-fill-tab');
assert(htmlContent.includes('id="preview-threads-text"'), 'dashboard.html should have live preview text #preview-threads-text');
console.log('  ✅ dashboard.html Threads UI components verified!');

console.log('\n🧪 4. Testing StorageService.clearAll() & CRUD...');
(async () => {
  // Mock Chrome Storage Local in test environment
  let mockStorage = {};
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          let res = {};
          keys.forEach(k => { if (k in mockStorage) res[k] = mockStorage[k]; });
          cb(res);
        },
        set: (obj, cb) => {
          Object.assign(mockStorage, obj);
          cb();
        }
      }
    }
  };

  // Test 4a. Save products
  await StorageService.saveProducts(mockProducts);
  let loaded = await StorageService.getProducts();
  assert.strictEqual(loaded.length, 2, 'Should load 2 saved products');

  // Test 4b. Clear All
  await StorageService.clearAll();
  let cleared = await StorageService.getProducts();
  assert.strictEqual(cleared.length, 0, 'Should return empty array after clearAll()');
  assert.deepStrictEqual(mockStorage.shopee_products, [], 'shopee_products in storage should be empty array');
  assert.deepStrictEqual(mockStorage.threads_queue, [], 'threads_queue legacy key should also be cleared');
  console.log('  ✅ StorageService.clearAll() verified without legacy resurrection!');

  console.log('\n===============================================================');
  console.log('🎉 ALL DASHBOARD, CSV, THREADS & STORAGE TESTS PASSED WITH 100% SUCCESS!');
  console.log('===============================================================');
})();

