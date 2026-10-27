/**
 * @file logger.js
 * @description Centralized Logger & Real-Time Debug Stream Service for Shopee Affiliate & Threads Auto-Poster
 * @module Logger
 * 
 * Features:
 * - Unified Logging API: Logger.info(), Logger.debug(), Logger.dom(), Logger.success(), Logger.warn(), Logger.error()
 * - Clean & Concise Output Format: [HH:mm:ss] [LEVEL] [TAG] Pesan singkat
 * - Modern CSS %c Badges & Color Coding for Browser DevTools (F12)
 * - Intelligent Anti-Spam Duplicate Throttling (suppresses rapid polling floods)
 * - Real-Time Stream Broadcaster: Dispatches chrome.runtime.sendMessage({ action: 'DEBUG_LOG_STREAM', logEntry })
 * - 200-item Ring Buffer with sessionStorage sync & flexible querying
 * - Universal Environment Support: Service Worker, Content Scripts, Popup, Dashboard, Window, Node.js
 * 
 * @author sodikinnaa
 * @license MIT
 */

(function (root) {
  'use strict';

  // =============================================================================
  // CONSTANTS & CONFIGURATION
  // =============================================================================

  const BUFFER_MAX_CAPACITY = 200;
  const STORAGE_KEY = 'THREADS_DEBUG_LOG_BUFFER';
  const ACTION_NAME = 'DEBUG_LOG_STREAM';
  const SPAM_THROTTLE_WINDOW_MS = 1200;
  const MAX_DUPLICATE_BURST = 3;

  const LOG_LEVELS = {
    DEBUG:   { priority: 10, name: 'DEBUG',   color: '#0891b2', bg: '#0891b2', fg: '#ffffff' },
    DOM:     { priority: 15, name: 'DOM',     color: '#9333ea', bg: '#9333ea', fg: '#ffffff' },
    INFO:    { priority: 20, name: 'INFO',    color: '#2563eb', bg: '#2563eb', fg: '#ffffff' },
    SUCCESS: { priority: 25, name: 'SUCCESS', color: '#059669', bg: '#059669', fg: '#ffffff' },
    WARN:    { priority: 30, name: 'WARN',    color: '#d97706', bg: '#d97706', fg: '#ffffff' },
    ERROR:   { priority: 40, name: 'ERROR',   color: '#dc2626', bg: '#dc2626', fg: '#ffffff' },
    NONE:    { priority: 100, name: 'NONE',   color: '#64748b', bg: '#64748b', fg: '#ffffff' }
  };

  // =============================================================================
  // CONTEXT DETECTION & STATE
  // =============================================================================

  function detectContext() {
    try {
      if (typeof importScripts === 'function' || (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope)) {
        return 'SERVICE_WORKER';
      }
      if (typeof window !== 'undefined' && window.location) {
        const path = window.location.pathname || '';
        const href = window.location.href || '';
        if (path.includes('dashboard')) return 'DASHBOARD';
        if (path.includes('popup')) return 'POPUP';
        if (href.includes('threads.net')) return 'THREADS_CONTENT';
        if (href.includes('shopee.co.id')) return 'SHOPEE_CONTENT';
        return 'WINDOW';
      }
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        return 'NODE_ENV';
      }
    } catch (e) {
      // Fallback
    }
    return 'EXTENSION_CORE';
  }

  const CURRENT_SOURCE = detectContext();

  let _ringBuffer = [];
  let _currentMinPriority = LOG_LEVELS.DEBUG.priority;
  let _consoleOutputEnabled = true;
  let _broadcasterEnabled = true;
  const _subscribers = new Set();
  let _seqCounter = 0;
  let _isBroadcasting = false;

  // Anti-spam state tracking
  let _lastLogKey = '';
  let _lastLogTime = 0;
  let _duplicateCount = 0;

  // =============================================================================
  // UTILITIES & SERIALIZATION
  // =============================================================================

  /**
   * Format number with zero padding
   */
  function padZero(num, digits = 2) {
    return String(num).padStart(digits, '0');
  }

  /**
   * Format Date to local HH:mm:ss
   */
  function formatTime(date = new Date()) {
    const h = padZero(date.getHours());
    const m = padZero(date.getMinutes());
    const s = padZero(date.getSeconds());
    return `${h}:${m}:${s}`;
  }

  /**
   * Safe serialization to clone data without cyclic references or DOM nodes.
   */
  function safeSerialize(obj, depth = 0, maxDepth = 3) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') {
      if (typeof obj === 'function' || typeof obj === 'symbol') return obj.toString();
      return obj;
    }

    if (depth >= maxDepth) return '[Max Depth]';

    if (obj instanceof Error) {
      return { name: obj.name, message: obj.message, stack: obj.stack };
    }

    if (typeof HTMLElement !== 'undefined' && obj instanceof HTMLElement) {
      return `<${obj.tagName.toLowerCase()}${obj.id ? '#' + obj.id : ''}${obj.className ? '.' + obj.className.split(' ').join('.') : ''}>`;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => safeSerialize(item, depth + 1, maxDepth));
    }

    try {
      const copy = {};
      for (const key of Object.keys(obj)) {
        try {
          copy[key] = safeSerialize(obj[key], depth + 1, maxDepth);
        } catch {
          copy[key] = '[Unserializable]';
        }
      }
      return copy;
    } catch {
      return String(obj);
    }
  }

  /**
   * Parse flexible calling arguments into clean { tag, message, data }
   */
  function parseLogArguments(args, defaultTag) {
    let tag = defaultTag || 'APP';
    let message = '';
    let data = undefined;

    if (!args || args.length === 0) {
      return { tag, message: '', data: undefined };
    }

    if (args.length === 1) {
      const item = args[0];
      if (item instanceof Error) {
        tag = 'ERROR';
        message = item.message || String(item);
        data = { name: item.name, stack: item.stack };
      } else if (typeof item === 'string') {
        const match = item.match(/^\[([A-Za-z0-9_\-\s]{2,20})\]\s*(.*)$/);
        if (match) {
          tag = match[1].trim();
          message = match[2];
        } else {
          tag = defaultTag || 'APP';
          message = item;
        }
      } else if (typeof item === 'object' && item !== null) {
        tag = defaultTag || 'DATA';
        message = JSON.stringify(item);
        data = item;
      } else {
        tag = defaultTag || 'APP';
        message = String(item);
      }
    } else if (args.length === 2) {
      const [first, second] = args;

      if (first instanceof Error) {
        tag = typeof second === 'string' ? second : 'ERROR';
        message = first.message || String(first);
        data = { name: first.name, stack: first.stack };
      } else if (typeof first === 'string' && typeof second === 'string') {
        tag = first;
        message = second;
      } else if (typeof first === 'string' && second instanceof Error) {
        tag = first;
        message = second.message || String(second);
        data = { name: second.name, stack: second.stack };
      } else if (typeof first === 'string' && typeof second === 'object' && second !== null) {
        if (second.tag || second.scope) {
          tag = second.tag || second.scope;
          message = first;
          data = second;
        } else if (/^[A-Za-z0-9_\-]{2,20}$/.test(first.trim()) && !first.includes(' ')) {
          tag = first;
          message = JSON.stringify(second);
          data = second;
        } else {
          const match = first.match(/^\[([A-Za-z0-9_\-\s]{2,20})\]\s*(.*)$/);
          if (match) {
            tag = match[1].trim();
            message = match[2];
          } else {
            tag = defaultTag || 'APP';
            message = first;
          }
          data = second;
        }
      } else {
        tag = defaultTag || 'APP';
        message = String(first);
        data = second;
      }
    } else {
      const [first, second, ...rest] = args;
      tag = typeof first === 'string' ? first : (defaultTag || 'APP');
      message = typeof second === 'string' ? second : JSON.stringify(second);
      data = rest.length === 1 ? rest[0] : rest;
    }

    tag = String(tag || defaultTag || 'APP').trim();
    if (tag.startsWith('[') && tag.endsWith(']')) {
      tag = tag.slice(1, -1).trim();
    }

    return { tag, message: String(message || ''), data };
  }

  // =============================================================================
  // PERSISTENCE & RING BUFFER
  // =============================================================================

  function loadFromSessionStorage() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            _ringBuffer = parsed.slice(-BUFFER_MAX_CAPACITY);
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  function persistToSessionStorage() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_ringBuffer));
      }
    } catch {
      // Ignore
    }
  }

  function appendToBuffer(entry) {
    _ringBuffer.push(entry);
    if (_ringBuffer.length > BUFFER_MAX_CAPACITY) {
      _ringBuffer = _ringBuffer.slice(-BUFFER_MAX_CAPACITY);
    }
    persistToSessionStorage();
  }

  loadFromSessionStorage();

  // =============================================================================
  // CONSOLE OUTPUT & BROADCASTING
  // =============================================================================

  /**
   * Output formatted log to console with clean styling:
   * [HH:mm:ss] [LEVEL] [TAG] Pesan singkat
   */
  function outputToConsole(entry) {
    if (!_consoleOutputEnabled) return;

    const meta = LOG_LEVELS[entry.level] || LOG_LEVELS.INFO;
    const isBrowser = typeof window !== 'undefined' || typeof document !== 'undefined' || (typeof navigator !== 'undefined' && navigator.userAgent);

    if (isBrowser) {
      const timeStyle = 'color: #94a3b8; font-family: monospace; font-size: 11px;';
      const badgeStyle = `background: ${meta.bg}; color: ${meta.fg}; font-weight: 700; border-radius: 3px; padding: 1px 5px; font-size: 10px; text-transform: uppercase;`;
      const tagStyle = `color: ${meta.color}; font-weight: 700; font-family: monospace; font-size: 11px;`;
      const msgStyle = 'color: inherit; font-size: 12px; font-family: system-ui, -apple-system, sans-serif;';
      const resetStyle = '';

      const formatPattern = `%c[${entry.timeStr}]%c %c[${entry.level}]%c %c[${entry.tag}]%c %c${entry.message}`;
      const consoleArgs = [
        formatPattern,
        timeStyle, resetStyle,
        badgeStyle, resetStyle,
        tagStyle, resetStyle,
        msgStyle
      ];

      if (entry.data !== undefined) {
        consoleArgs.push(entry.data);
      }

      switch (entry.level) {
        case 'ERROR':   console.error(...consoleArgs); break;
        case 'WARN':    console.warn(...consoleArgs); break;
        case 'DEBUG':   console.debug(...consoleArgs); break;
        case 'DOM':
        case 'SUCCESS':
        case 'INFO':
        default:        console.log(...consoleArgs); break;
      }
    } else {
      // Node.js or non-browser fallback
      const formatted = `[${entry.timeStr}] [${entry.level}] [${entry.tag}] ${entry.message}`;
      if (entry.data !== undefined) {
        if (entry.level === 'ERROR') console.error(formatted, entry.data);
        else if (entry.level === 'WARN') console.warn(formatted, entry.data);
        else console.log(formatted, entry.data);
      } else {
        if (entry.level === 'ERROR') console.error(formatted);
        else if (entry.level === 'WARN') console.warn(formatted);
        else console.log(formatted);
      }
    }
  }

  /**
   * Broadcast log entry over Chrome Extension runtime message stream.
   * Action: DEBUG_LOG_STREAM
   */
  function broadcastStream(entry) {
    if (!_broadcasterEnabled || _isBroadcasting) return;
    if (CURRENT_SOURCE === 'NODE_ENV') return;

    _isBroadcasting = true;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        const payload = {
          action: ACTION_NAME,
          logEntry: {
            id: entry.id,
            timestamp: entry.timestamp,
            timeStr: entry.timeStr,
            level: entry.level,
            tag: entry.tag,
            message: entry.message,
            data: safeSerialize(entry.data),
            source: entry.source
          }
        };

        try {
          const promise = chrome.runtime.sendMessage(payload, () => {
            if (chrome.runtime.lastError) {
              void chrome.runtime.lastError;
            }
          });
          if (promise && typeof promise.catch === 'function') {
            promise.catch(() => {});
          }
        } catch {
          // Ignore context errors
        }
      }
    } catch {
      // Safe boundary
    } finally {
      _isBroadcasting = false;
    }
  }

  /**
   * Notify in-process reactive subscribers.
   */
  function notifySubscribers(entry) {
    if (_subscribers.size === 0) return;
    _subscribers.forEach(cb => {
      try {
        cb(entry);
      } catch (err) {
        console.error('[Logger] Subscriber error:', err);
      }
    });
  }

  // =============================================================================
  // CORE LOGGER OBJECT
  // =============================================================================

  const Logger = {
    /** Available log levels */
    LEVELS: LOG_LEVELS,

    /** Current execution context */
    SOURCE: CURRENT_SOURCE,

    /**
     * Centralized internal dispatch method
     * @param {string} level Log level name (INFO, DEBUG, DOM, SUCCESS, WARN, ERROR)
     * @param {...*} args Arguments
     * @returns {Object|null} Created LogEntry object
     */
    log(level, ...args) {
      const levelKey = (level || 'INFO').toUpperCase();
      const meta = LOG_LEVELS[levelKey] || LOG_LEVELS.INFO;

      if (meta.priority < _currentMinPriority) {
        return null;
      }

      const { tag, message, data } = parseLogArguments(args, levelKey);
      const now = new Date();
      const nowMs = now.getTime();

      // Anti-Spam Duplicate Detection: throttle rapid identical logs (e.g. DOM polling loops)
      const currentLogKey = `${levelKey}:${tag}:${message}`;
      if (currentLogKey === _lastLogKey && (nowMs - _lastLogTime) < SPAM_THROTTLE_WINDOW_MS) {
        _duplicateCount++;
        if (_duplicateCount > MAX_DUPLICATE_BURST) {
          // Suppress repetitive flood
          return null;
        }
      } else {
        _lastLogKey = currentLogKey;
        _lastLogTime = nowMs;
        _duplicateCount = 1;
      }

      _seqCounter = (_seqCounter + 1) % 1000000;

      const logEntry = {
        id: `log_${nowMs}_${padZero(_seqCounter, 6)}`,
        timestamp: now.toISOString(),
        timeStr: formatTime(now),
        level: levelKey,
        tag: tag,
        message: message,
        data: data,
        source: CURRENT_SOURCE
      };

      // 1. Output to Console with clean [HH:mm:ss] [LEVEL] [TAG] format
      outputToConsole(logEntry);

      // 2. Append to Ring Buffer (max 200 entries)
      appendToBuffer(logEntry);

      // 3. Broadcast to Live Debug Console Stream
      broadcastStream(logEntry);

      // 4. Notify in-process subscribers
      notifySubscribers(logEntry);

      return logEntry;
    },

    /**
     * Log Informational Message [INFO]
     */
    info(...args) {
      return this.log('INFO', ...args);
    },

    /**
     * Log Debug Trace Message [DEBUG]
     */
    debug(...args) {
      return this.log('DEBUG', ...args);
    },

    /**
     * Log DOM & Injection Activity [DOM]
     */
    dom(...args) {
      return this.log('DOM', ...args);
    },

    /**
     * Log Success & Completion [SUCCESS]
     */
    success(...args) {
      return this.log('SUCCESS', ...args);
    },

    /**
     * Log Warning [WARN]
     */
    warn(...args) {
      return this.log('WARN', ...args);
    },

    /**
     * Log Error & Exception [ERROR]
     */
    error(...args) {
      return this.log('ERROR', ...args);
    },

    // ===========================================================================
    // RING BUFFER & REPLAY CONTROLS
    // ===========================================================================

    /**
     * Retrieve a shallow copy of the ring buffer
     * @returns {Array<Object>}
     */
    getBuffer() {
      return [..._ringBuffer];
    },

    /**
     * Retrieve filtered logs from the ring buffer
     */
    getLogs(filterOptions = {}) {
      let results = [..._ringBuffer];

      if (filterOptions.level) {
        const levels = Array.isArray(filterOptions.level)
          ? filterOptions.level.map(l => String(l).toUpperCase())
          : [String(filterOptions.level).toUpperCase()];
        results = results.filter(item => levels.includes(item.level));
      }

      if (filterOptions.tag) {
        const tagFilter = String(filterOptions.tag).toUpperCase();
        results = results.filter(item => item.tag && item.tag.toUpperCase().includes(tagFilter));
      }

      if (filterOptions.search) {
        const q = String(filterOptions.search).toLowerCase();
        results = results.filter(item =>
          (item.message && item.message.toLowerCase().includes(q)) ||
          (item.tag && item.tag.toLowerCase().includes(q)) ||
          (item.source && item.source.toLowerCase().includes(q))
        );
      }

      if (filterOptions.since) {
        const sinceTime = new Date(filterOptions.since).getTime();
        if (!isNaN(sinceTime)) {
          results = results.filter(item => new Date(item.timestamp).getTime() >= sinceTime);
        }
      }

      if (typeof filterOptions.limit === 'number' && filterOptions.limit > 0) {
        results = results.slice(-filterOptions.limit);
      }

      return results;
    },

    /**
     * Alias for getLogs
     */
    getFilteredBuffer(filterOptions) {
      return this.getLogs(filterOptions);
    },

    /**
     * Clear all logs in memory and sessionStorage
     */
    clearBuffer() {
      _ringBuffer = [];
      _lastLogKey = '';
      _lastLogTime = 0;
      _duplicateCount = 0;
      try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage) {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // Ignore
      }
    },

    /**
     * Replay buffered logs
     */
    replayLogs(customHandler) {
      const logs = [..._ringBuffer];
      if (typeof customHandler === 'function') {
        logs.forEach(entry => customHandler(entry));
      } else {
        logs.forEach(entry => outputToConsole(entry));
      }
    },

    /**
     * Export logs as structured plain text
     */
    exportLogsAsText() {
      return _ringBuffer
        .map(e => `[${e.timeStr}] [${e.level}] [${e.tag}] ${e.message}${e.data ? ' -> ' + JSON.stringify(e.data) : ''}`)
        .join('\n');
    },

    /**
     * Export logs as JSON string
     */
    exportLogsAsJSON(pretty = true) {
      return JSON.stringify(_ringBuffer, null, pretty ? 2 : 0);
    },

    // ===========================================================================
    // SUBSCRIBERS & STREAM LISTENER HELPERS
    // ===========================================================================

    /**
     * Subscribe to in-process log events
     */
    subscribe(callback) {
      if (typeof callback !== 'function') return () => {};
      _subscribers.add(callback);
      return () => {
        _subscribers.delete(callback);
      };
    },

    /**
     * Helper for UI views (Live Debug Console, Dashboard, Popup) to listen for stream broadcasts
     */
    listenStream(callback) {
      if (typeof callback !== 'function') return () => {};
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
        return () => {};
      }

      const messageHandler = (message, sender, sendResponse) => {
        if (message && message.action === ACTION_NAME && message.logEntry) {
          try {
            callback(message.logEntry, sender);
            if (typeof sendResponse === 'function') {
              sendResponse({ success: true });
            }
          } catch (err) {
            console.error('[Logger] Stream listener error:', err);
          }
        }
      };

      chrome.runtime.onMessage.addListener(messageHandler);

      return () => {
        try {
          chrome.runtime.removeListener ? chrome.runtime.removeListener(messageHandler) : chrome.runtime.onMessage.removeListener(messageHandler);
        } catch {
          // Ignore
        }
      };
    },

    /**
     * Create a scoped/tagged logger instance
     */
    createTaggedLogger(tag) {
      const boundTag = String(tag || 'APP').trim();
      return {
        tag: boundTag,
        info: (msg, data) => this.info(boundTag, msg, data),
        debug: (msg, data) => this.debug(boundTag, msg, data),
        dom: (msg, data) => this.dom(boundTag, msg, data),
        success: (msg, data) => this.success(boundTag, msg, data),
        warn: (msg, data) => this.warn(boundTag, msg, data),
        error: (msg, data) => this.error(boundTag, msg, data),
        log: (level, msg, data) => this.log(level, boundTag, msg, data)
      };
    },

    // ===========================================================================
    // CONFIGURATION GETTERS & SETTERS
    // ===========================================================================

    /**
     * Set minimum logging priority level
     */
    setLevel(level) {
      const key = (level || 'DEBUG').toUpperCase();
      if (LOG_LEVELS[key]) {
        _currentMinPriority = LOG_LEVELS[key].priority;
      }
    },

    /**
     * Get current minimum log level name
     */
    getLevel() {
      for (const [key, val] of Object.entries(LOG_LEVELS)) {
        if (val.priority === _currentMinPriority) return key;
      }
      return 'DEBUG';
    },

    /**
     * Enable or disable console output
     */
    enableConsole(enable) {
      _consoleOutputEnabled = Boolean(enable);
    },

    /**
     * Enable or disable runtime stream broadcasting
     */
    enableBroadcaster(enable) {
      _broadcasterEnabled = Boolean(enable);
    }
  };

  // =============================================================================
  // UNIVERSAL MODULE EXPORTS
  // =============================================================================

  if (typeof globalThis !== 'undefined') globalThis.Logger = Logger;
  if (typeof window !== 'undefined') window.Logger = Logger;
  if (typeof self !== 'undefined') self.Logger = Logger;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
    module.exports.Logger = Logger;
  }
  if (root) root.Logger = Logger;

})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : typeof global !== 'undefined' ? global
  : this);
