"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

function subscribeToHydration(onStoreChange: () => void) {
  const timeoutId = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(timeoutId);
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

/**
 * False on the server and on the pass that hydrates it, true from the tick
 * after. Anything a page knows only because it is running in a browser —
 * `sessionStorage`, `matchMedia`, the presence of an API — has to wait behind
 * this before it can change what is rendered, because the first client pass is
 * checked against HTML the server built without any of it.
 */
export function useIsHydrated() {
  return useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);
}

export function ViewportPortal({ children }: { children: ReactNode }) {
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return null;
  }

  return createPortal(children, document.body);
}
