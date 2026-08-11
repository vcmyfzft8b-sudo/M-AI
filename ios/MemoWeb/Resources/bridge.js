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

  /** Fire-and-wait counterpart to `post`, for the handlers that reply. */
  function send(message) {
    try {
      return window.webkit.messageHandlers.memoRecorder.postMessage(message);
    } catch (error) {
      return Promise.reject(error);
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

    /**
     * Native audio capture. Present only in the app, so web code can feature-detect it and fall
     * back to MediaRecorder in a browser.
     *
     * Unlike MediaRecorder, this keeps recording when the screen locks or the user switches
     * apps, and it drives the Lock Screen activity.
     *
     *   await MemoNative.recorder.start();
     *   const result = await MemoNative.recorder.stop();
     *   const file = await MemoNative.recorder.toFile(result);
     */
    recorder: {
      start: function () {
        return send({ action: "start" });
      },
      pause: function () {
        return send({ action: "pause" });
      },
      resume: function () {
        return send({ action: "resume" });
      },
      cancel: function () {
        return send({ action: "cancel" });
      },
      state: function () {
        return send({ action: "state" });
      },
      stop: function () {
        return send({ action: "stop" });
      },

      /**
       * Pulls the finished recording into the page as a File, then releases the native copy.
       * The bytes come over a custom scheme rather than the message bridge, because a long
       * lecture is tens of megabytes and base64 would inflate it by a third.
       */
      toFile: function (result) {
        return fetch(result.url)
          .then(function (response) {
            return response.blob();
          })
          .then(function (blob) {
            var file = new File([blob], result.fileName, { type: result.mimeType });
            send({ action: "release", url: result.url });
            return file;
          });
      },
    },
  });

  document.documentElement.setAttribute("data-memo-native", "ios");

  /*
   * The web view runs edge to edge, so the page must opt into `viewport-fit=cover` or
   * `env(safe-area-inset-*)` stays 0 and content renders under the notch and the home indicator.
   * The stylesheet already uses those variables in ~55 places; this just turns them on.
   *
   * Next injects its own viewport meta, so patch whichever tag exists and keep watching until
   * the document is parsed in case ours is replaced.
   */
  function ensureViewportFitCover() {
    var meta = document.querySelector('meta[name="viewport"]');

    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "viewport");
      meta.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
      (document.head || document.documentElement).appendChild(meta);
      return;
    }

    var content = meta.getAttribute("content") || "";
    if (content.indexOf("viewport-fit") === -1) {
      meta.setAttribute("content", content + ", viewport-fit=cover");
    }
  }

  ensureViewportFitCover();

  if (typeof MutationObserver === "function") {
    var observer = new MutationObserver(ensureViewportFitCover);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", function () {
      ensureViewportFitCover();
      observer.disconnect();
    });
  }

  /*
   * Legal pages open in the browser, not in the app.
   *
   * The native navigation policy covers full page loads, but these links are Next.js <Link>
   * components: the App Router navigates with history.pushState and re-renders in place, so
   * WebKit never issues a navigation action and the native delegate is never consulted. The
   * click has to be caught here instead.
   *
   * Capture phase with stopPropagation, so React's delegated handler on the root container
   * never sees the event and the client-side route change does not happen.
   */
  var browserPathPrefixes = config.browserPathPrefixes || [];

  function opensInBrowser(pathname) {
    for (var i = 0; i < browserPathPrefixes.length; i += 1) {
      var prefix = browserPathPrefixes[i];
      if (pathname === prefix || pathname.indexOf(prefix + "/") === 0) {
        return true;
      }
    }
    return false;
  }

  document.addEventListener(
    "click",
    function (event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.button !== 0) {
        return;
      }

      var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor || anchor.target === "_blank") {
        return; // New windows are already routed natively.
      }

      var target;
      try {
        target = new URL(anchor.href, location.href);
      } catch (error) {
        return;
      }

      // Off-origin links reach WebKit as real navigations, so the native policy handles them.
      if (target.origin !== location.origin || !opensInBrowser(target.pathname)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      post({ type: "openExternal", url: target.href });
    },
    true
  );

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
