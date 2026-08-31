"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import { CreatorDemoBasePathProvider } from "@/components/creator-demo/creator-demo-context";
import { useT } from "@/components/i18n-provider";
import { createCreatorDemoFetch } from "@/lib/creator-demo/api";
import { setCreatorDemoTranslator } from "@/lib/creator-demo/demo-translator";
import { CREATOR_DEMO_BASE_PATH, setCreatorDemoClientBasePath } from "@/lib/creator-demo/paths";
import {
  getCreatorDemoState,
  hydrateCreatorDemoFromSession,
  initCreatorDemoState,
  subscribeToCreatorDemo,
  type CreatorDemoState,
} from "@/lib/creator-demo/store";
import type { AppLectureListItem, AppLibraryFolder, LectureDetail } from "@/lib/types";

let demoFetch: typeof fetch | null = null;
let demoSendBeacon: typeof navigator.sendBeacon | null = null;
let originalFetch: typeof fetch | null = null;
let originalSendBeacon: typeof navigator.sendBeacon | null = null;

/**
 * Swaps in the offline API before any child effect can fire a request. Runs
 * during render on purpose: child effects run before the parent's, so an effect
 * here would install the stub too late.
 *
 * Idempotent and re-assertable: if anything (a remount without a re-render, a
 * later wrapper) has replaced our patch, this puts it back. The demo must never
 * end up issuing real `/api` calls with a signed-in visitor's cookies.
 */
function installCreatorDemoRuntime(seed: CreatorDemoState, basePath: string) {
  if (typeof window === "undefined") {
    return;
  }

  initCreatorDemoState(seed);
  setCreatorDemoClientBasePath(basePath);

  if (window.fetch !== demoFetch) {
    originalFetch = window.fetch.bind(window);
    demoFetch = createCreatorDemoFetch(originalFetch);
    window.fetch = demoFetch;
  }

  if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon !== demoSendBeacon) {
    originalSendBeacon = navigator.sendBeacon.bind(navigator);
    demoSendBeacon = () => true;
    navigator.sendBeacon = demoSendBeacon;
  }
}

/** Restores the real transports, but only if ours are still the ones installed. */
function uninstallCreatorDemoRuntime() {
  if (typeof window === "undefined") {
    return;
  }

  setCreatorDemoClientBasePath(null);

  if (originalFetch && window.fetch === demoFetch) {
    window.fetch = originalFetch;
  }

  if (originalSendBeacon && navigator.sendBeacon === demoSendBeacon) {
    navigator.sendBeacon = originalSendBeacon;
  }

  demoFetch = null;
  demoSendBeacon = null;
  originalFetch = null;
  originalSendBeacon = null;
}

export function CreatorDemoProvider({
  seed,
  basePath = CREATOR_DEMO_BASE_PATH,
  children,
}: {
  seed: CreatorDemoState;
  basePath?: string;
  children: React.ReactNode;
}) {
  /*
   * Registered during render, alongside the runtime install and for the same
   * reason: the store and the offline API are called from child effects, which
   * run before this component's own would.
   */
  setCreatorDemoTranslator(useT());
  installCreatorDemoRuntime(seed, basePath);

  // Re-assert on mount so an effect remount that skips render (StrictMode,
  // bfcache-style restores) can't leave the demo talking to the real API.
  useLayoutEffect(() => {
    installCreatorDemoRuntime(seed, basePath);
    hydrateCreatorDemoFromSession();
    return uninstallCreatorDemoRuntime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  return (
    <CreatorDemoBasePathProvider value={basePath}>{children}</CreatorDemoBasePathProvider>
  );
}

/**
 * Subscribes to the demo store. `initial` is what the server rendered, so the
 * first client render matches it exactly and hydration stays clean.
 */
function useCreatorDemoSelector<T>(select: (state: CreatorDemoState) => T, initial: T) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const sync = () => setValue(select(getCreatorDemoState()));

    sync();
    return subscribeToCreatorDemo(sync);
    // `select` is a stable, module-level projection at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}

const selectLectures = (state: CreatorDemoState): AppLectureListItem[] =>
  state.order.map((id) => state.details[id]?.lecture).filter(Boolean) as AppLectureListItem[];

const selectFolders = (state: CreatorDemoState): AppLibraryFolder[] => state.folders;

export function useCreatorDemoLectures(initial: AppLectureListItem[]) {
  return useCreatorDemoSelector(selectLectures, initial);
}

export function useCreatorDemoFolders(initial: AppLibraryFolder[]) {
  return useCreatorDemoSelector(selectFolders, initial);
}

/**
 * Resolves a note once and then holds the reference steady: the workspace
 * resets its entire session whenever `initialDetail` changes identity, and it
 * writes its own updates back through the offline API. Notes created earlier in
 * the tab only appear once session state is restored, so the lookup keeps
 * listening until it finds one.
 */
export function useCreatorDemoDetail(lectureId: string, initial: LectureDetail | null) {
  const [detail, setDetail] = useState(initial);

  useEffect(() => {
    if (detail) {
      return;
    }

    const resolve = () => {
      const found = getCreatorDemoState().details[lectureId] ?? null;

      if (found) {
        setDetail(found);
      }
    };

    resolve();
    return subscribeToCreatorDemo(resolve);
  }, [detail, lectureId]);

  return detail;
}
