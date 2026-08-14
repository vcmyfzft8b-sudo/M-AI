import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldDropClientErrorEvent,
  shouldDropInterruptedLoadFailedEvent,
  shouldDropNoStackBrowserNetworkNoise,
  shouldDropWebViewInjectedScriptError,
} from "../src/lib/sentry-client-filters.ts";

// Mirrors the exact exception payload of Sentry issues MEMOAI-WEB-2F / MEMOAI-WEB-2E:
// the Instagram in-app browser's injected performance logger throwing after its native
// bridge was destroyed. Frame filenames/functions are copied from the real events.
function instagramInjectedScriptEvent(innerFunction) {
  return {
    exception: {
      values: [
        {
          type: "Error",
          value: "Error invoking postMessage: Java object is gone",
          stacktrace: {
            frames: [
              { filename: "app://navigation_performance_logger_android", function: null },
              { filename: "app://navigation_performance_logger_android", function: innerFunction },
              { filename: "app://navigation_performance_logger_android", function: "sendDataToNative" },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: "console", message: "FBNavLargestContentfulPaint:1786518420021" },
      {
        category: "fetch",
        data: { method: "GET", status_code: 200, url: "https://www.memoai.eu/?_rsc=1r34m" },
      },
    ],
  };
}

test("drops the real Instagram in-app browser injected-script errors (2F and 2E)", () => {
  // MEMOAI-WEB-2F crashed in sendBeforeUnloadMessage, MEMOAI-WEB-2E in sendLoafMessage.
  for (const fn of ["sendBeforeUnloadMessage", "sendLoafMessage"]) {
    const event = instagramInjectedScriptEvent(fn);
    assert.equal(shouldDropWebViewInjectedScriptError(event), true);
    assert.equal(shouldDropClientErrorEvent(event), true);
  }
});

test("drops injected-script errors even when some frame locations are unknown", () => {
  const event = {
    exception: {
      values: [
        {
          type: "Error",
          value: "Error invoking postMessage: Java object is gone",
          stacktrace: {
            frames: [
              { filename: "<anonymous>" },
              { filename: "app://some_other_injected_helper" },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(event), true);
});

// Raw (pre-symbolication) payload of the event MEMOAI-WEB-2F recorded on 2026-08-14, i.e.
// exactly what beforeSend saw with the injected-script filter already deployed. Instagram's
// logger registered a beforeunload listener, Sentry's browserApiErrors integration wrapped it,
// and the SDK shim shows up as an opaque first-party-looking chunk above the injected frames.
function sdkWrappedInstagramEvent() {
  return {
    exception: {
      values: [
        {
          type: "Error",
          value: "Error invoking postMessage: Java object is gone",
          mechanism: {
            type: "auto.browser.browserapierrors.addEventListener",
            handled: false,
            data: { handler: "<anonymous>", target: "EventTarget" },
          },
          stacktrace: {
            frames: [
              { filename: "app:///_next/static/chunks/8105-ee2560ebd354b3cf.js", function: "n" },
              { filename: "app://navigation_performance_logger_android", function: null },
              {
                filename: "app://navigation_performance_logger_android",
                function: "sendBeforeUnloadMessage",
              },
              {
                filename: "app://navigation_performance_logger_android",
                function: "sendDataToNative",
              },
            ],
          },
        },
      ],
    },
  };
}

test("drops injected-script errors thrown through a listener Sentry wrapped (MEMOAI-WEB-2F)", () => {
  const event = sdkWrappedInstagramEvent();
  assert.equal(shouldDropWebViewInjectedScriptError(event), true);
  assert.equal(shouldDropClientErrorEvent(event), true);
});

test("only the SDK shim frame is excused — real app frames below it still keep the event", () => {
  // Same wrapper mechanism, but our own code is genuinely on the stack under the shim.
  const event = sdkWrappedInstagramEvent();
  event.exception.values[0].stacktrace.frames.splice(1, 0, {
    filename: "app:///_next/static/chunks/app/page-def456.js",
    function: "onBeforeUnload",
  });
  assert.equal(shouldDropWebViewInjectedScriptError(event), false);
  assert.equal(shouldDropClientErrorEvent(event), false);
});

test("an app-code frame is not excused when the mechanism is not an SDK-wrapped callback", () => {
  // Without the browserApiErrors mechanism, frames[0] is ordinary app code and vetoes the drop.
  const event = sdkWrappedInstagramEvent();
  event.exception.values[0].mechanism = { type: "auto.browser.global_handlers.onerror" };
  assert.equal(shouldDropWebViewInjectedScriptError(event), false);
  assert.equal(shouldDropClientErrorEvent(event), false);
});

test("an SDK-wrapped callback failing purely in our own code is still reported", () => {
  const event = {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined (reading 'id')",
          mechanism: { type: "auto.browser.browserapierrors.addEventListener" },
          stacktrace: {
            frames: [
              { filename: "app:///_next/static/chunks/8105-ee2560ebd354b3cf.js", function: "n" },
              { filename: "app:///_next/static/chunks/app/page-def456.js", function: "onClick" },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(event), false);
  assert.equal(shouldDropClientErrorEvent(event), false);
});

test("the SDK shim alone is never enough to drop an event", () => {
  const event = {
    exception: {
      values: [
        {
          type: "Error",
          value: "Error invoking postMessage: Java object is gone",
          mechanism: { type: "auto.browser.browserapierrors.setTimeout" },
          stacktrace: {
            frames: [
              { filename: "app:///_next/static/chunks/8105-ee2560ebd354b3cf.js", function: "n" },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(event), false);
});

test("keeps errors that touch our own code, even if an injected frame is on the stack", () => {
  const event = {
    exception: {
      values: [
        {
          type: "Error",
          value: "Error invoking postMessage: Java object is gone",
          stacktrace: {
            frames: [
              { filename: "app://navigation_performance_logger_android" },
              { filename: "https://www.memoai.eu/_next/static/chunks/main-abc123.js" },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(event), false);
  assert.equal(shouldDropClientErrorEvent(event), false);
});

test("drops injected-script frames collapsed to a bare app:// by SDK frame normalization", () => {
  // The SDK's frame normalization can strip the pseudo-host, leaving exactly "app://".
  // Our own frames always keep their /_next path, so a bare app:// is still foreign.
  const event = {
    exception: {
      values: [
        {
          type: "Error",
          value: "Error invoking postMessage: Java object is gone",
          stacktrace: {
            frames: [{ filename: "app://" }, { filename: "app://" }, { filename: "app://" }],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(event), true);
  assert.equal(shouldDropClientErrorEvent(event), true);
});

test("keeps our own errors after Sentry's rewriteFrames renames bundle URLs to app:///", () => {
  // The Next.js SDK rewrites first-party frames from https://.../_next/... to
  // app:///_next/... — same scheme as injected scripts but with an empty host.
  // These MUST NOT be treated as third-party noise, or we would drop every real
  // client error in production.
  const rewrittenOwnError = {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined (reading 'id')",
          stacktrace: {
            frames: [
              { filename: "app:///_next/static/chunks/main-abc123.js", function: "onClick" },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(rewrittenOwnError), false);
  assert.equal(shouldDropClientErrorEvent(rewrittenOwnError), false);

  const mixedStack = {
    exception: {
      values: [
        {
          type: "Error",
          value: "Error invoking postMessage: Java object is gone",
          stacktrace: {
            frames: [
              { filename: "app://navigation_performance_logger_android", function: "sendDataToNative" },
              { filename: "app:///_next/static/chunks/main-abc123.js", function: "handler" },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(mixedStack), false);
});

// Exact frames of MEMOAI-WEB-2G, recorded 2026-08-14 on Chrome Mobile iOS 151: two functions
// injected by the browser recursing into each other until the stack blew. They are attributed
// to the HTML document (loaded at /app, hence "app:///app" after rewriteFrames) at lines our
// 14-line document does not have — no script of ours is on the stack.
function chromeIosInjectedScriptEvent() {
  return {
    exception: {
      values: [
        {
          type: "RangeError",
          value: "Maximum call stack size exceeded.",
          mechanism: { type: "auto.browser.global_handlers.onerror", handled: false },
          stacktrace: {
            frames: [
              { filename: "app:///app", function: null, lineNo: 195, colNo: 349 },
              { filename: "app:///app", function: "Gk", lineNo: 224, colNo: 25 },
              { filename: "app:///app", function: "Ik", lineNo: 224, colNo: 408 },
              { filename: "app:///app", function: "Gk", lineNo: 224, colNo: 63 },
            ],
          },
        },
      ],
    },
  };
}

test("drops browser-injected script errors attributed to the document (MEMOAI-WEB-2G)", () => {
  const event = chromeIosInjectedScriptEvent();
  assert.equal(shouldDropWebViewInjectedScriptError(event), true);
  assert.equal(shouldDropClientErrorEvent(event), true);
});

test("document-attributed frames are foreign whatever route the document was loaded at", () => {
  for (const filename of ["app:///", "app:///app/lectures/fa0bf303-fc89-4cea-b181-ab3e59306b02"]) {
    const event = chromeIosInjectedScriptEvent();
    for (const frame of event.exception.values[0].stacktrace.frames) {
      frame.filename = filename;
    }
    assert.equal(shouldDropWebViewInjectedScriptError(event), true);
  }
});

test("drops the iOS Instagram browser's logger, the same noise class as 2F/2E (MEMOAI-WEB-2D)", () => {
  // Identical injected logger to the Android events above — note sendDataToNative — but the
  // iOS in-app browser evaluates it in the page, so its frames carry the document URL
  // ("app:///", the landing page) instead of an app://<script-name> pseudo-URL.
  const event = {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
          mechanism: { type: "auto.browser.global_handlers.onerror", handled: false },
          stacktrace: {
            frames: [
              { filename: "app:///", function: null, lineNo: 1, colNo: 5421 },
              { filename: "app:///", function: "sendPageHideMessage", lineNo: 1, colNo: 3712 },
              { filename: "app:///", function: "sendDataToNative", lineNo: 1, colNo: 1142 },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(event), true);
  assert.equal(shouldDropClientErrorEvent(event), true);
});

test("a document frame does not excuse our own bundle frames on the same stack", () => {
  // The document-frame rule must never swallow a real error that merely passed through
  // injected code — a single /_next bundle frame still vetoes the drop.
  const event = chromeIosInjectedScriptEvent();
  event.exception.values[0].stacktrace.frames.push({
    filename: "app:///_next/static/chunks/app/page-def456.js",
    function: "renderLecture",
  });
  assert.equal(shouldDropWebViewInjectedScriptError(event), false);
  assert.equal(shouldDropClientErrorEvent(event), false);
});

test("our own bundle URLs are never mistaken for the document, query strings included", () => {
  for (const filename of [
    "app:///_next/static/chunks/main-abc123.js",
    "app:///_next/static/chunks/app/page-def456.js?dpl=abc",
    "app:///_next/static/chunks/app/page-def456.js#sourceURL",
  ]) {
    const event = chromeIosInjectedScriptEvent();
    for (const frame of event.exception.values[0].stacktrace.frames) {
      frame.filename = filename;
    }
    assert.equal(shouldDropWebViewInjectedScriptError(event), false, filename);
    assert.equal(shouldDropClientErrorEvent(event), false, filename);
  }
});

test("keeps a genuine stack overflow in our own code", () => {
  // Same error class, but the recursion is in a bundle we ship — that is a real bug.
  const event = {
    exception: {
      values: [
        {
          type: "RangeError",
          value: "Maximum call stack size exceeded.",
          mechanism: { type: "auto.browser.global_handlers.onerror", handled: false },
          stacktrace: {
            frames: [
              { filename: "app:///_next/static/chunks/app/page-def456.js", function: "walk" },
              { filename: "app:///_next/static/chunks/app/page-def456.js", function: "walk" },
            ],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropWebViewInjectedScriptError(event), false);
  assert.equal(shouldDropClientErrorEvent(event), false);
});

test("keeps ordinary application errors", () => {
  const event = {
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined (reading 'id')",
          stacktrace: {
            frames: [{ filename: "https://www.memoai.eu/_next/static/chunks/app/page-def456.js" }],
          },
        },
      ],
    },
  };
  assert.equal(shouldDropClientErrorEvent(event), false);
});

test("does not treat stackless or malformed events as injected-script noise", () => {
  assert.equal(shouldDropWebViewInjectedScriptError({}), false);
  assert.equal(shouldDropWebViewInjectedScriptError({ exception: { values: [] } }), false);
  assert.equal(
    shouldDropWebViewInjectedScriptError({
      exception: { values: [{ type: "Error", value: "boom" }] },
    }),
    false,
  );
  assert.equal(
    shouldDropWebViewInjectedScriptError({
      exception: { values: [{ stacktrace: { frames: [{}] } }] },
    }),
    false,
  );
});

test("pre-existing filters still drop their noise classes through the combined gate", () => {
  const interruptedLoad = {
    exception: { values: [{ type: "TypeError", value: "Load failed" }] },
    breadcrumbs: [
      {
        category: "fetch",
        level: "error",
        data: { method: "GET", url: "https://www.memoai.eu/api/lectures/1" },
      },
    ],
  };
  assert.equal(shouldDropInterruptedLoadFailedEvent(interruptedLoad), true);
  assert.equal(shouldDropClientErrorEvent(interruptedLoad), true);

  const connectionClosed = {
    exception: { values: [{ type: "Error", value: "Connection closed." }] },
    breadcrumbs: [{ category: "navigation" }],
  };
  assert.equal(shouldDropNoStackBrowserNetworkNoise(connectionClosed), true);
  assert.equal(shouldDropClientErrorEvent(connectionClosed), true);
});
