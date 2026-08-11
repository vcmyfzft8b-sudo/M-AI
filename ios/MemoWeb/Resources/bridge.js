/*
 * Injected into every main-frame document at document start.
 *
 * Keep this defensive: it runs before the web app's own bundle on a page the wrapper does not
 * control, so a throw here must never take the page down with it.
 */
(function () {
  "use strict";

  if (window.MemoNative) {
    return;
  }

  var config = window.__MEMO_NATIVE_CONFIG__ || {};
  delete window.__MEMO_NATIVE_CONFIG__;

  function post(message) {
    try {
      window.webkit.messageHandlers.memoNative.postMessage(message);
    } catch (error) {
      /* Bridge unavailable (e.g. running in a plain browser) — ignore. */
    }
  }

  /**
   * Public surface for the web app. `window.MemoNative` existing at all is the signal that the
   * page is running inside the iOS shell, so web code can hide browser-only affordances such as
   * the "add to home screen" onboarding step.
   */
  window.MemoNative = Object.freeze({
    platform: "ios",
    appVersion: config.appVersion || "",
    buildNumber: config.buildNumber || "",

    /** Fires a native haptic. `style` is one of light | medium | heavy | success | warning | error. */
    haptic: function (style) {
      post({ type: "haptic", style: String(style || "light") });
    },

    /** Presents the native share sheet. */
    share: function (options) {
      var payload = options || {};
      post({
        type: "share",
        url: payload.url ? String(payload.url) : "",
        text: payload.text ? String(payload.text) : "",
      });
    },

    /** Opens a URL outside the wrapper, in Safari. */
    openExternal: function (url) {
      post({ type: "openExternal", url: String(url) });
    },
  });

  document.documentElement.setAttribute("data-memo-native", "ios");

  /*
   * WebKit cannot download blob:/data: URLs through WKDownloadDelegate, so anchors that generate
   * a file client-side (note exports, generated PDFs) are intercepted and handed to native as a
   * data URL instead. Capture phase, so the web app's own handlers still run.
   */
  document.addEventListener(
    "click",
    function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest("a[download]") : null;
      if (!anchor) {
        return;
      }

      var href = anchor.getAttribute("href") || "";
      if (href.indexOf("blob:") !== 0 && href.indexOf("data:") !== 0) {
        return; // Regular URLs are handled natively by WKDownloadDelegate.
      }

      event.preventDefault();

      fetch(href)
        .then(function (response) {
          return response.blob();
        })
        .then(function (blob) {
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
              resolve(String(reader.result));
            };
            reader.onerror = function () {
              reject(reader.error);
            };
            reader.readAsDataURL(blob);
          });
        })
        .then(function (dataURL) {
          post({
            type: "download",
            filename: anchor.getAttribute("download") || "datoteka",
            dataURL: dataURL,
          });
        })
        .catch(function (error) {
          post({ type: "log", level: "error", message: "blob download failed: " + error });
        });
    },
    true
  );
})();
