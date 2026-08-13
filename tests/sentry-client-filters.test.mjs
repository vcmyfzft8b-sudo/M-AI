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
