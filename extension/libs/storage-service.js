/**
 * Storage Service
 * Handles Chrome storage local read/write with fallbacks, backward compatibility, and auto-merge.
 * Bulletproof against "Extension context invalidated" errors.
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StorageService = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'shopee_products';
  const LEGACY_KEY = 'threads_queue';

  /**
   * Check if Chrome extension API context is currently alive and valid
   * @returns {boolean}
   */
  function isExtensionValid() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return false;
      }
      if (typeof chrome.runtime !== 'undefined' && typeof chrome.runtime.id !== 'undefined') {
        return !!chrome.runtime.id;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  const StorageService = {
    /**
     * Load all saved shopee products from chrome.storage.local (with localStorage fallback)
     * @returns {Promise<Array<Object>>}
     */
    async getProducts() {
      return new Promise((resolve) => {
        if (isExtensionValid()) {
          try {
            chrome.storage.local.get([STORAGE_KEY, LEGACY_KEY], (res) => {
              if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                console.warn('[StorageService] Error reading storage:', chrome.runtime.lastError);
                resolve(this._getLocalStorageFallback());
                return;
              }

              let list = [];
              if (res && STORAGE_KEY in res && Array.isArray(res[STORAGE_KEY])) {
                list = res[STORAGE_KEY];
              } else if (res && LEGACY_KEY in res && Array.isArray(res[LEGACY_KEY]) && res[LEGACY_KEY].length > 0) {
                list = res[LEGACY_KEY];
              }
              resolve(list);
            });
          } catch (err) {
            console.warn('[StorageService] Context invalidated, using localStorage fallback:', err);
            resolve(this._getLocalStorageFallback());
          }
        } else {
          resolve(this._getLocalStorageFallback());
        }
      });
    },

    /**
     * Save product array directly into storage
     * @param {Array<Object>} products 
     * @returns {Promise<boolean>}
     */
    async saveProducts(products) {
      const sanitized = Array.isArray(products) ? products : [];
      return new Promise((resolve) => {
        if (isExtensionValid()) {
          try {
            chrome.storage.local.set({ [STORAGE_KEY]: sanitized, [LEGACY_KEY]: [] }, () => {
              if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                console.warn('[StorageService] Error saving storage:', chrome.runtime.lastError);
                this._setLocalStorageFallback(sanitized);
              }
              // Keep localStorage synced as persistent backup
              this._setLocalStorageFallback(sanitized);
              resolve(true);
            });
          } catch (err) {
            console.warn('[StorageService] Context invalidated, saving to localStorage backup:', err);
            this._setLocalStorageFallback(sanitized);
            resolve(true);
          }
        } else {
          this._setLocalStorageFallback(sanitized);
          resolve(true);
        }
      });
    },

    /**
     * Merge new items into existing products without duplicate titles / IDs
     * @param {Array<Object>} newProducts 
     * @returns {Promise<{ merged: Array<Object>, addedCount: number }>}
     */
    async mergeProducts(newProducts) {
      if (!Array.isArray(newProducts) || newProducts.length === 0) {
        const current = await this.getProducts();
        return { merged: current, addedCount: 0 };
      }

      const current = await this.getProducts();
      const existingKeys = new Set(
        current.map(p => (p.shopeeId ? `id:${p.shopeeId}` : `title:${(p.title || p.rawTitle || '').trim().toLowerCase()}`))
      );

      const uniqueNew = newProducts.filter(p => {
        const key = p.shopeeId ? `id:${p.shopeeId}` : `title:${(p.title || p.rawTitle || '').trim().toLowerCase()}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

      const merged = [...current, ...uniqueNew];
      await this.saveProducts(merged);

      return {
        merged,
        addedCount: uniqueNew.length
      };
    },

    /**
     * Delete a product by id
     * @param {string} id 
     * @returns {Promise<Array<Object>>}
     */
    async deleteProduct(id) {
      const current = await this.getProducts();
      const updated = current.filter(p => p.id !== id);
      await this.saveProducts(updated);
      return updated;
    },

    /**
     * Clear all products
     * @returns {Promise<boolean>}
     */
    async clearAll() {
      return new Promise((resolve) => {
        if (isExtensionValid()) {
          try {
            chrome.storage.local.set({ [STORAGE_KEY]: [], [LEGACY_KEY]: [] }, () => {
              this._setLocalStorageFallback([]);
              resolve(true);
            });
          } catch (err) {
            this._setLocalStorageFallback([]);
            resolve(true);
          }
        } else {
          this._setLocalStorageFallback([]);
          resolve(true);
        }
      });
    },

    /**
     * Fallback for browser testing environments & invalidated contexts
     * @private
     */
    _getLocalStorageFallback() {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(STORAGE_KEY);
          return raw ? JSON.parse(raw) : [];
        }
      } catch (_) {}
      return [];
    },

    /**
     * @private
     */
    _setLocalStorageFallback(products) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
        }
      } catch (_) {}
    }
  };

  return StorageService;
});
