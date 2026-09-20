"use client";

import { useEffect } from "react";

import { useTranslations } from "@/components/i18n-provider";

/**
 * Registers public/sw.js, which keeps the build's CSS and JS in the cache so a
 * cold launch does not sit on a white screen waiting for them, and keeps a copy
 * of `/offline` so the app has something to open with no connection at all. See
 * that file for what it does and does not cache.
 *
 * Development is excluded on purpose. The dev server rewrites the same asset
 * URLs on every edit, and a cache-first worker in front of that serves the
 * build from ten minutes ago and makes it look like the edit did nothing.
 *
 * Registration failing is not worth reporting: the app works exactly as it did
 * before, one frame worse on launch.
 */
/**
 * How long to wait for `load` before registering anyway. Past a couple of
 * seconds the first paint this defers to is long finished, so the only thing
 * left to protect is nothing.
 */
const REGISTER_FALLBACK_MS = 2500;

export function ServiceWorkerRegistration() {
  const { locale, t } = useTranslations();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // After load, so registering never competes with the first paint it exists
    // to protect.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then(async () => {
          /*
           * Hand the worker the build files this page just used. It cannot
           * catch them itself: it does not control the page that registers it,
           * so on this launch every asset is fetched around it. Without this
           * the next launch opens an empty cache and the white frame it exists
           * to remove is still there.
           */
          const worker = (await navigator.serviceWorker.ready).active;

          if (!worker) {
            return;
          }

          const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
          /* Build output, and the optimiser's copies of the app's own pictures. */
          const urls = resources.filter(
            (name) => name.includes("/_next/static/") || name.includes("/_next/image?"),
          );

          if (urls.length > 0) {
            worker.postMessage({ type: "cache-build", urls });
          }

          /*
           * And the icon font, for the same reason and with the same problem:
           * a worker does not control the page that registers it, so the launch
           * that installs it fetches the font around it. Every glyph in this app
           * is a ligature, so a cold offline launch without it is captioned with
           * the names of its own icons — "arrow_back" where the arrow goes.
           */
          const fonts = resources.filter((name) =>
            /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(name),
          );

          /*
           * And the offline shell, which the worker fetches for itself — this
           * page is not it. The language goes with the request because the
           * shell is server-rendered in one, and so do the three strings of
           * the worker's own last-resort page, which is plain HTML built in
           * the worker and has no other way to reach a catalogue.
           */
          worker.postMessage({
            type: "cache-shell",
            fonts,
            locale,
            strings: {
              title: t("offline.screen.title"),
              body: t("offline.screen.body"),
              retry: t("common.retry"),
            },
          });
        })
        .catch(() => {});
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    /*
     * After load, so registering never competes with the first paint it exists
     * to protect — but not *only* after load. `load` waits on every last
     * subresource, and one that never settles (a blocked analytics script, a
     * font request left hanging) means it never fires at all: measured on this
     * app, `document.readyState` sat at "interactive" indefinitely and the
     * worker was never registered, so the next launch had no cached build and
     * no offline shell. The timer is the floor; whichever comes first wins.
     */
    let done = false;

    const registerOnce = () => {
      if (done) {
        return;
      }

      done = true;
      register();
    };

    const timer = window.setTimeout(registerOnce, REGISTER_FALLBACK_MS);

    window.addEventListener("load", registerOnce, { once: true });

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("load", registerOnce);
    };
  }, [locale, t]);

  return null;
}
