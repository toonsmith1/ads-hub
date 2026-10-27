/**
 * Shopee Scraper Service
 * Accurate DOM query, metadata extraction, affiliate short link fetching, and pagination management.
 * Supports Shopee Thailand (shopee.co.th) and Shopee Indonesia (shopee.co.id)
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ShopeeScraperService = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ShopeeScraperService = {
    /**
     * Query all possible Shopee Affiliate Product item selectors on the page
     * @param {Document|HTMLElement} [rootNode=document]
     * @returns {Array<HTMLElement>}
     */
    findProductItems(rootNode = (typeof document !== 'undefined' ? document : null)) {
      if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return [];
      
      let items = Array.from(rootNode.querySelectorAll('.product-offer-list .product-offer-item, .product-offer-item'));
      if (items.length === 0) {
        items = Array.from(rootNode.querySelectorAll('.AffiliateItemCard, [class*="AffiliateItemCard"]'));
      }
      if (items.length === 0) {
        items = Array.from(rootNode.querySelectorAll('ul.shopee-search-item-result__items li.shopee-search-item-result__item, [class*="shopee-search-item-result__item"]'));
      }
      if (items.length === 0) {
        items = Array.from(rootNode.querySelectorAll('.ant-table-row, .offer-item, [data-sq*="product-card"], .goods-item'));
      }
      return items;
    },

    /**
     * Get current pagination page number from DOM
     * @param {Document|HTMLElement} [rootNode=document]
     * @returns {number}
     */
    getCurrentPageNumber(rootNode = (typeof document !== 'undefined' ? document : null)) {
      if (!rootNode) return 1;
      const activePageEl = rootNode.querySelector('.offer-list-page .page-item.page-page.active')
                        || rootNode.querySelector('.ant-pagination-item-active');
      if (activePageEl) {
        const num = parseInt(activePageEl.textContent.trim(), 10);
        if (!isNaN(num)) return num;
      }
      return 1;
    },

    /**
     * Check if next pagination page is available
     * @param {Document|HTMLElement} [rootNode=document]
     * @returns {boolean}
     */
    hasNextPage(rootNode = (typeof document !== 'undefined' ? document : null)) {
      if (!rootNode) return false;
      const nextBtn = rootNode.querySelector('.offer-list-page .page-item.page-next')
                   || rootNode.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');
      if (!nextBtn) return false;
      if (nextBtn.classList.contains('disabled') || nextBtn.getAttribute('aria-disabled') === 'true') {
        return false;
      }
      return true;
    },

    /**
     * Trigger transition to next page and wait for DOM refresh
     * @param {Object} [options]
     * @returns {Promise<boolean>}
     */
    async goToNextPage(options = {}) {
      if (typeof document === 'undefined') return false;
      const nextBtn = document.querySelector('.offer-list-page .page-item.page-next')
                   || document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button')
                   || document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) a')
                   || document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');

      if (!nextBtn || !this.hasNextPage()) return false;

      const oldFirstItem = this.findProductItems()[0];
      const oldTitle = oldFirstItem?.querySelector('.ItemCard__name')?.textContent.trim() || '';

      // Scroll into view & click target element
      try {
        nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {}

      const targetClick = nextBtn.querySelector('a, button, .ant-pagination-item-link') || nextBtn;
      try {
        targetClick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        if (typeof targetClick.click === 'function') targetClick.click();
      } catch (_) {}

      // Wait for new page DOM to load & render
      const maxAttempts = options.maxAttempts || 40;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 200));
        const isSpinning = document.querySelector('.ant-spin-spinning, .ant-spin-nested-loading > div.ant-spin');
        if (isSpinning) continue;

        const newItems = this.findProductItems();
        if (newItems.length > 0) {
          const newFirstTitle = newItems[0]?.querySelector('.ItemCard__name')?.textContent.trim() || '';
          if (newFirstTitle && newFirstTitle !== oldTitle) {
            await new Promise(r => setTimeout(r, 600));
            return true;
          }
        }
      }

      await new Promise(r => setTimeout(r, 800));
      return true;
    },

    /**
     * Extract structured product metadata from a DOM item element
     * @param {HTMLElement} item 
     * @param {number} [index=1] 
     * @returns {Object} Product metadata
     */
    extractProductMeta(item, index = 1) {
      if (!item) return null;

      const nameEl = item.querySelector('.ItemCard__name') 
                  || item.querySelector('[role="group"]') 
                  || item.querySelector('.shopee-search-item-result__item-name')
                  || item.querySelector('[class*="item-name"]')
                  || item.querySelector('[class*="title"]');

      const imgEl = item.querySelector('.ItemCard__image img')
                 || item.querySelector('img[src*="susercontent.com"]')
                 || item.querySelector('picture img')
                 || item.querySelector('img');

      const priceEl = item.querySelector('.ItemCard__price .price') 
                   || item.querySelector('.ItemCard__price')
                   || item.querySelector('[class*="price"]');
      
      const soldEl = item.querySelector('.ItemCardSold__wrap span')
                  || item.querySelector('.ItemCardSold__wrap')
                  || item.querySelector('[class*="sold"]');

      const commEl = item.querySelector('.commRate')
                  || item.querySelector('[class*="commission"]')
                  || item.querySelector('[class*="rate"]');

      let cleanImgUrl = '';
      if (imgEl && imgEl.src) {
        cleanImgUrl = imgEl.src.replace(/@resize_[^.\s]+/, '').split('?')[0];
      }

      let rawTitle = nameEl ? nameEl.textContent.trim() : (imgEl?.alt || `สินค้า_${index}`);
      rawTitle = rawTitle.replace(/^Product card:\s*/i, '');
      
      const safeTitle = rawTitle.replace(/[^a-zA-Z0-9_\-\s\u0E00-\u0E7F]/g, '').trim().replace(/\s+/g, '_').substring(0, 40) || `product_${index}`;
      const priceText = priceEl ? priceEl.textContent.trim() : '-';
      const commission = commEl ? commEl.textContent.trim() : '-';
      const soldText = soldEl ? soldEl.textContent.trim() : 'ขายแล้ว 1พัน+ ชิ้น';

      const linkEl = item.querySelector('a[href*="/offer/product_offer/"]')
                  || item.querySelector('a[href*="shopee.co.th"]')
                  || item.querySelector('a[href*="shopee.co.id"]');
      let shopeeId = '';
      let longLink = '';
      if (linkEl && linkEl.href) {
        longLink = linkEl.href;
        const match = linkEl.href.match(/product_offer\/(\d+)/) || linkEl.href.match(/i\.\d+\.(\d+)/);
        if (match) shopeeId = match[1];
      }

      const currentUrl = (typeof window !== 'undefined' && window.location) ? window.location.href : '';

      let formattedPrice = '-';
      if (priceText !== '-') {
        if (priceText.startsWith('฿') || priceText.startsWith('THB') || priceText.startsWith('Rp')) {
          formattedPrice = priceText;
        } else {
          formattedPrice = `฿${priceText}`;
        }
      }

      return {
        id: `shp_${shopeeId || Date.now()}_${index}`,
        shopeeId,
        rawTitle,
        title: rawTitle,
        safeTitle,
        cleanImgUrl,
        image: cleanImgUrl,
        price: formattedPrice,
        commission,
        rating: '⭐ 4.9',
        sold: soldText,
        longLink: longLink || currentUrl,
        createdAt: new Date().toISOString()
      };
    },

    /**
     * Extract affiliate short link by clicking "รับลิงก์ / คัดลอกลิงก์ / Get Link" button
     * @param {HTMLElement} itemElement 
     * @returns {Promise<string>} Short URL or fallback URL
     */
    async fetchShortLink(itemElement) {
      if (!itemElement) return '';
      const btn = itemElement.querySelector('.AffiliateItemCard__getlinkBtn') 
               || itemElement.querySelector('button.ant-btn') 
               || Array.from(itemElement.querySelectorAll('button, a')).find(b => {
                    const text = (b.textContent || '').trim();
                    return text.includes('รับลิงก์')
                        || text.includes('คัดลอกลิงก์')
                        || text.includes('สร้างลิงก์')
                        || text.includes('แชร์')
                        || text.includes('Get Link')
                        || text.includes('Buat Link')
                        || text.includes('Dapatkan Link')
                        || text.includes('Bagikan');
                  });

      const currentUrl = (typeof window !== 'undefined' && window.location) ? window.location.href : '';

      if (!btn) {
        return itemElement.querySelector('a[href*="/offer/"], a[href*="shopee.co.th"], a[href*="shopee.co.id"]')?.href || currentUrl;
      }

      try {
        btn.click();
      } catch (e) {
        console.warn('[ShopeeScraperService] ไม่สามารถคลิกปุ่มรับลิงก์ได้:', e);
      }

      let extractedShortLink = '';
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(r => setTimeout(r, 100));
        
        // Retry click once if modal didn't open after 15 attempts (1.5 seconds)
        if (attempt === 15 && typeof document !== 'undefined' && !document.querySelector('.ant-modal-root, .ant-modal, [role="dialog"]')) {
          try { btn.click(); } catch (e) {}
        }

        if (typeof document === 'undefined') break;
        const modal = document.querySelector('.ant-modal-root, .ant-modal, [role="dialog"]');
        if (modal) {
          const inputs = Array.from(modal.querySelectorAll('input, textarea'));
          const linkInput = inputs.find(i => i.value && (
            i.value.includes('http') ||
            i.value.includes('shopee') ||
            i.value.includes('shope.ee') ||
            i.value.includes('s.shopee.co.th') ||
            i.value.includes('s.shopee.co.id')
          ));
          
          if (linkInput && linkInput.value) {
            extractedShortLink = linkInput.value.trim();
          } else {
            const match = modal.innerText.match(/https?:\/\/[^\s]+/);
            if (match) extractedShortLink = match[0].trim();
          }

          if (extractedShortLink) {
            const urlMatch = extractedShortLink.match(/https?:\/\/[^\s"'<>\\]+/);
            if (urlMatch) extractedShortLink = urlMatch[0];

            const closeBtn = modal.querySelector('.ant-modal-close, .ant-modal-close-x, button[aria-label="Close"], .close');
            if (closeBtn) {
              closeBtn.click();
            } else {
              const bgOverlay = document.querySelector('.ant-modal-wrap, .ant-modal-mask');
              if (bgOverlay) bgOverlay.click();
            }
            // Delay 500ms so Ant Design modal & backdrop completely disappear
            await new Promise(r => setTimeout(r, 500));
            break;
          }
        }
      }

      if (!extractedShortLink) {
        return itemElement.querySelector('a[href*="/offer/"], a[href*="shopee.co.th"], a[href*="shopee.co.id"]')?.href || currentUrl;
      }

      return extractedShortLink;
    },

    /**
     * Multi-page pagination runner to scrape all products across pages
     * @param {Object} config
     * @param {number} [config.maxPages=1]
     * @param {number} [config.delayMs=600]
     * @param {Function} [config.onProgress]
     * @param {Function} [config.isCancelled]
     * @returns {Promise<Array<Object>>}
     */
    async scrapeAcrossPages(config = {}) {
      const {
        maxPages = 1,
        delayMs = 600,
        onProgress = null,
        isCancelled = () => false
      } = config;

      const productList = [];
      let totalProcessed = 0;

      for (let page = 1; page <= maxPages; page++) {
        if (isCancelled()) break;

        const curPageNum = this.getCurrentPageNumber();
        const items = this.findProductItems();

        if (typeof onProgress === 'function') {
          onProgress({
            phase: 'page_start',
            pageNum: curPageNum,
            pageIndex: page,
            maxPages,
            pageItemCount: items.length,
            totalProcessed
          });
        }

        for (let i = 0; i < items.length; i++) {
          if (isCancelled()) break;
          const item = items[i];
          totalProcessed++;
          const meta = this.extractProductMeta(item, totalProcessed);

          if (typeof onProgress === 'function') {
            onProgress({
              phase: 'item_start',
              pageNum: curPageNum,
              itemIndex: i + 1,
              pageItemCount: items.length,
              totalProcessed,
              product: meta
            });
          }

          // Fetch affiliate short link
          const shortLink = await this.fetchShortLink(item);
          meta.shortLink = shortLink;
          productList.push(meta);

          if (typeof onProgress === 'function') {
            onProgress({
              phase: 'item_complete',
              pageNum: curPageNum,
              itemIndex: i + 1,
              pageItemCount: items.length,
              totalProcessed,
              product: meta
            });
          }

          // Delay between items so Shopee DOM stays stable
          await new Promise(r => setTimeout(r, delayMs));
        }

        // Move to next page if requested
        if (page < maxPages && this.hasNextPage() && !isCancelled()) {
          if (typeof onProgress === 'function') {
            onProgress({
              phase: 'switching_page',
              pageNum: curPageNum,
              nextPageNum: curPageNum + 1
            });
          }

          const switched = await this.goToNextPage();
          if (!switched) {
            if (typeof onProgress === 'function') {
              onProgress({
                phase: 'switch_failed',
                pageNum: curPageNum
              });
            }
            break;
          }
        } else {
          break;
        }
      }

      return productList;
    }
  };

  return ShopeeScraperService;
});
