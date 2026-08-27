import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTheme,
  readStoredThemePreference,
  THEME_STORAGE_KEY,
} from "../src/lib/theme.ts";

/**
 * Safari with site data blocked. Every `localStorage` access throws `SecurityError`
 * (DOMException code 18) — not just writes, and not only when a quota is involved. This is the
 * shape the production crash arrived in (Sentry MEMOAI-WEB-35, Mobile Safari 26.6 / iOS 18.7,
 * 4 events on the landing page).
 */
function blockedStorage() {
  const throwSecurityError = () => {
    const error = new Error("The operation is insecure.");
    error.name = "SecurityError";
    throw error;
  };

  return {
    getItem: throwSecurityError,
    setItem: throwSecurityError,
    removeItem: throwSecurityError,
  };
}

function workingStorage(initial = {}) {
  const store = new Map(Object.entries(initial));

  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    store,
  };
}

/** Minimal stand-ins for the two globals the module touches. */
function withDom({ storage }, run) {
  const element = {
    dataset: {},
    style: {},
    removeAttribute(name) {
      if (name === "data-theme") {
        delete this.dataset.theme;
      }
    },
  };

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  globalThis.window = { localStorage: storage };
  globalThis.document = { documentElement: element };

  try {
    return run(element);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;

    if (previousWindow === undefined) {
      delete globalThis.window;
    }

    if (previousDocument === undefined) {
      delete globalThis.document;
    }
  }
}

test("a blocked localStorage reads as no preference instead of throwing", () => {
  withDom({ storage: blockedStorage() }, () => {
    // This is the exact call that crashed: ThemeController's effect runs
    // applyTheme(readStoredThemePreference()) on mount, and an unguarded getItem took the whole
    // page down with it.
    assert.equal(readStoredThemePreference(), "system");
  });
});

test("applying a theme still works when the preference cannot be saved", () => {
  withDom({ storage: blockedStorage() }, (element) => {
    assert.doesNotThrow(() => applyTheme("dark"));
    // The visitor gets the theme for this page even though nothing can be persisted.
    assert.equal(element.dataset.theme, "dark");
    assert.equal(element.style.colorScheme, "dark");

    assert.doesNotThrow(() => applyTheme("system"));
    assert.equal(element.dataset.theme, undefined);
    assert.equal(element.style.colorScheme, "");
  });
});

test("a working localStorage still round-trips the preference", () => {
  const storage = workingStorage();

  withDom({ storage }, (element) => {
    applyTheme("light");

    assert.equal(storage.store.get(THEME_STORAGE_KEY), "light");
    assert.equal(element.dataset.theme, "light");
    assert.equal(readStoredThemePreference(), "light");

    // "system" is the absence of a preference, so it clears the key rather than storing itself.
    applyTheme("system");

    assert.equal(storage.store.has(THEME_STORAGE_KEY), false);
    assert.equal(readStoredThemePreference(), "system");
  });
});

test("an unrecognised stored value falls back to system", () => {
  withDom({ storage: workingStorage({ [THEME_STORAGE_KEY]: "midnight" }) }, () => {
    assert.equal(readStoredThemePreference(), "system");
  });
});
