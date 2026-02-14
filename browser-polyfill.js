/**
 * Minimal browser API polyfill for cross-browser compatibility.
 * Firefox uses `browser.*` (Promise-based), Chrome uses `chrome.*` (callback-based).
 * This shim exposes a unified `browser` global that works in both.
 */
(function () {
  "use strict";

  if (typeof globalThis.browser === "undefined") {
    // We're in Chrome — wrap chrome.* APIs with Promise wrappers
    const chromeApi = typeof chrome !== "undefined" ? chrome : null;
    if (!chromeApi) return;

    /**
     * Wraps a Chrome callback-style API method into a Promise-returning function.
     */
    function promisify(context, method) {
      return function (...args) {
        return new Promise((resolve, reject) => {
          method.call(context, ...args, function (...results) {
            if (chromeApi.runtime.lastError) {
              reject(new Error(chromeApi.runtime.lastError.message));
            } else {
              resolve(results.length <= 1 ? results[0] : results);
            }
          });
        });
      };
    }

    // Build a proxy that wraps chrome.storage.local, chrome.tabs, chrome.runtime
    globalThis.browser = {
      storage: {
        local: {
          get: promisify(chromeApi.storage.local, chromeApi.storage.local.get),
          set: promisify(chromeApi.storage.local, chromeApi.storage.local.set),
          remove: promisify(chromeApi.storage.local, chromeApi.storage.local.remove),
          clear: promisify(chromeApi.storage.local, chromeApi.storage.local.clear),
        },
      },
      tabs: {
        query: promisify(chromeApi.tabs, chromeApi.tabs.query),
        create: promisify(chromeApi.tabs, chromeApi.tabs.create),
      },
      runtime: {
        sendMessage: promisify(chromeApi.runtime, chromeApi.runtime.sendMessage),
        onMessage: chromeApi.runtime.onMessage,
        getURL: chromeApi.runtime.getURL.bind(chromeApi.runtime),
        openOptionsPage: promisify(chromeApi.runtime, chromeApi.runtime.openOptionsPage),
      },
    };
  }
})();
