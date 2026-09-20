"use client";

/**
 * Whether the app currently has a connection, and what it does when it does not.
 *
 * `navigator.onLine` alone is not enough in either direction. False is
 * trustworthy — the OS knows there is no route — but true only means an
 * interface is up, which is also what a hotel captive portal and a phone with
 * one bar of nothing look like. And on iOS a backgrounded web view has its
 * requests killed outright, so a failed fetch is just as often a locked screen
 * as it is a dropped connection.
 *
 * So: false is believed immediately, and everything else is decided by a small
 * probe against the app's own health endpoint. Nothing here flips a screen into
 * its offline state on the strength of one failed request.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import { createOfflineFetch } from "@/lib/offline/api";
import { replayOutbox } from "@/lib/offline/outbox";

/** Long enough for a slow connection, short enough not to hold a screen. */
const PROBE_TIMEOUT_MS = 4000;

/** How often to look for the connection again while it is down. */
const RECHECK_INTERVAL_MS = 15000;

/**
 * The floor between two probes. `visibilitychange` fires on every app switch
 * and every sheet that takes the screen, and the health endpoint is rate
 * limited per IP — a lecture hall on one campus NAT would otherwise spend that
 * budget on connection checks.
 */
const PROBE_THROTTLE_MS = 5000;

type OfflineValue = {
  isOffline: boolean;
  /**
   * True when this document is the cached offline shell rather than a page the
   * server rendered — so the app knows it is showing a copy, and that coming
   * back online means reloading rather than carrying on.
   */
  isShell: boolean;
  /** Ask for a fresh check now; resolves to whether the connection is back. */
  recheck: () => Promise<boolean>;
};

const OfflineContext = createContext<OfflineValue>({
  isOffline: false,
  isShell: false,
  recheck: async () => true,
});

/*
 * Read by the fetch stub and by the navigation path, both of which run outside
 * React and need the answer synchronously. The provider keeps it in step with
 * its own state.
 */
let offlineNow = false;

/**
 * Called by the stub when a request it let through died in transport, so the
 * provider can go and find out whether the connection has gone.
 *
 * This is what catches the case `navigator.onLine` cannot: the interface is up
 * and the app is simply not reachable. Without it a screen would keep
 * believing it was online and keep failing one request at a time, each with a
 * dropped-connection message, rather than saying the one true thing once.
 */
let reportTransportFailure: () => void = () => {};
let installedFetch: typeof fetch | null = null;
let realFetch: typeof fetch | null = null;

export function isOfflineNow() {
  return offlineNow;
}

function setOfflineNow(value: boolean) {
  offlineNow = value;
}

/*
 * The same mirror for the other half of the answer: whether this document is
 * the cached shell. The navigation path needs it for every tap, connection or
 * no connection, because the shell has to be left through the document even
 * once the network is back — see `needsDocumentNavigation`.
 */
let shellNow = false;

export function isShellNow() {
  return shellNow;
}

function setShellNow(value: boolean) {
  shellNow = value;
}

function transport() {
  return realFetch ?? fetch;
}

export function reportOfflineTransportFailure() {
  reportTransportFailure();
}

/**
 * Puts the offline stub in front of `window.fetch`.
 *
 * Called during render rather than from an effect, for the same reason the
 * creator demo installs its own stub there: a child's effect runs before its
 * parent's, so a request fired on mount would go out unwrapped. It is
 * idempotent, and while there is a connection the stub is a single boolean
 * check in front of the real `fetch`.
 */
function installOfflineFetch(t: Translate<MessageKey>) {
  if (typeof window === "undefined" || window.fetch === installedFetch) {
    return;
  }

  realFetch = window.fetch.bind(window);
  installedFetch = createOfflineFetch(realFetch, {
    isOffline: isOfflineNow,
    onTransportFailure: reportOfflineTransportFailure,
    t,
  });
  window.fetch = installedFetch;
}

function initialOffline(isShell: boolean) {
  /*
   * The shell starts offline whatever the interface says, because the shell
   * being on screen at all is the evidence: the service worker only hands it
   * back for a navigation the network could not answer. `navigator.onLine` is
   * true for a phone associated with a router that has no route beyond it, and
   * for this app's own server being unreachable — both of which put the reader
   * here with an app that would otherwise believe it was online.
   */
  if (isShell) {
    return true;
  }

  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * One real request to the app's own origin. `no-store` and a cache-busting
 * parameter so a service-worker or HTTP cache hit can never answer "online"
 * for a device that is not.
 */
async function probe(transport: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    await transport(`/api/health?probe=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });

    /*
     * Any answer at all is proof of a connection, including a refusal. The
     * question this asks is "can the device reach us", not "is the endpoint
     * healthy" — a 429 from a busy campus IP is still a reachable server, and
     * reading it as offline would put the whole hall behind a cached copy.
     */
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function OfflineProvider({
  children,
  isShell = false,
}: {
  children: React.ReactNode;
  isShell?: boolean;
}) {
  const t = useT();
  const [isOffline, setIsOffline] = useState(() => initialOffline(isShell));
  const lastProbeAtRef = useRef(0);
  const probeInFlightRef = useRef<Promise<boolean> | null>(null);

  /*
   * The module mirror is the single source the whole app reads, React and
   * otherwise, so it is written here rather than from an effect: the stub
   * installed on the next line and the navigation path both consult it, and
   * both can be reached before any effect in this tree has run.
   */
  setOfflineNow(isOffline);
  setShellNow(isShell);
  installOfflineFetch(t);

  const recheck = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setIsOffline(true);
      return false;
    }

    if (probeInFlightRef.current) {
      return probeInFlightRef.current;
    }

    if (Date.now() - lastProbeAtRef.current < PROBE_THROTTLE_MS) {
      return !isOfflineNow();
    }

    lastProbeAtRef.current = Date.now();
    const request = probe(transport()).then((reachable) => {
      setIsOffline(!reachable);

      if (reachable && isOfflineNow()) {
        // Whatever was answered locally while the connection was down.
        void replayOutbox(transport());
      }

      return reachable;
    }).finally(() => {
      probeInFlightRef.current = null;
    });

    probeInFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    reportTransportFailure = () => void recheck();

    return () => {
      reportTransportFailure = () => {};
    };
  }, [recheck]);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const check = () => void recheck();

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);

    /*
     * A session that begins online still needs its queue flushed: the writes
     * may have been made in a previous one that ended before the connection
     * came back.
     */
    if (isOfflineNow()) {
      check();
    } else {
      void replayOutbox(transport());
    }

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [recheck]);

  useEffect(() => {
    if (!isOffline) {
      return;
    }

    /*
     * `online` does not fire for a connection that was never lost at the
     * interface — walking back into range of a router the phone never
     * disassociated from, a captive portal that has since been signed into. A
     * slow poll is what notices those.
     */
    const timer = window.setInterval(() => void recheck(), RECHECK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isOffline, recheck]);

  const value = useMemo<OfflineValue>(
    () => ({ isOffline, isShell, recheck }),
    [isOffline, isShell, recheck],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  return useContext(OfflineContext);
}

/** Just the flag, for the many places that only need to disable something. */
export function useIsOffline() {
  return useContext(OfflineContext).isOffline;
}
