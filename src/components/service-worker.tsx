"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which keeps the build's CSS and JS in the cache so a
 * cold launch does not sit on a white screen waiting for them. See that file
 * for what it does and does not cache.
 *
 * Development is excluded on purpose. The dev server rewrites the same asset
 * URLs on every edit, and a cache-first worker in front of that serves the
 * build from ten minutes ago and makes it look like the edit did nothing.
 *
 * Registration failing is not worth reporting: the app works exactly as it did
 * before, one frame worse on launch.
 */
export function ServiceWorkerRegistration() {
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
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
