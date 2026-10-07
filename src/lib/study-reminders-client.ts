"use client";

import { isNativeIOS, nativeRequest } from "@/lib/mobile/client";

/**
 * The browser's half of the study reminder: asking to be allowed to send it,
 * and telling the server where to send it.
 *
 * The onboarding's "When do you usually study?" step promises a nudge at that
 * hour. The hour itself travels with the rest of the answers; what this module
 * owns is the channel. In the app that is the same APNs registration the
 * note-ready notifications use, and in a browser it is a Web Push subscription
 * held by public/sw.js.
 */

/** The bridge version that added the notification commands (see push-prompt.tsx). */
const PUSH_BRIDGE_VERSION = 3;

/**
 * How long to wait for the service worker before giving up on Web Push.
 * It registers a couple of seconds after load, so on any real visit it is long
 * since ready; in development it is never registered at all.
 */
const WORKER_TIMEOUT_MS = 10_000;

export const WEB_PUSH_PUBLIC_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";

/** The learner's IANA time zone, which is what "five in the afternoon" means. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function webPushSupported() {
  return (
    typeof window !== "undefined" &&
    Boolean(WEB_PUSH_PUBLIC_KEY) &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function base64UrlToBytes(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

async function workerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();

  if (existing?.active) {
    return existing;
  }

  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), WORKER_TIMEOUT_MS)),
  ]);
}

/**
 * Hands this browser's push subscription to the server, creating it if there
 * is none yet. Safe to call on every visit: it is an upsert keyed by the
 * endpoint, and it does nothing unless notifications are already allowed.
 *
 * Answers 401 while nobody is signed in — the onboarding runs before there is
 * an account — which is why the app calls this again once there is one (see
 * `WebPushSync`).
 */
export async function syncWebPushSubscription(): Promise<boolean> {
  if (!webPushSupported() || Notification.permission !== "granted") {
    return false;
  }

  const registration = await workerRegistration();

  if (!registration) {
    return false;
  }

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(WEB_PUSH_PUBLIC_KEY),
    }));
  const json = subscription.toJSON();
  const response = await fetch("/api/push/web-subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      locale: document.documentElement.lang || null,
    }),
  });

  return response.ok;
}

/**
 * Asks to be allowed to deliver the reminder.
 *
 * Must be called straight from the press that asked for it: a browser only
 * shows its permission prompt in answer to a gesture, so `requestPermission`
 * is the first thing that runs, before anything is awaited. Never throws — the
 * hour is saved either way, and a learner who says no has simply chosen not to
 * be nudged.
 */
export function enableStudyReminderDelivery(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (isNativeIOS()) {
    if ((window.memoNative?.version ?? 0) < PUSH_BRIDGE_VERSION) {
      return Promise.resolve();
    }

    // iOS asks, then registers. The registration is refused while the survey
    // is still anonymous; the app saves the token again on the first page it
    // loads signed in, which is what attaches it to the new account.
    return nativeRequest("enablePushNotifications").then(
      () => undefined,
      () => undefined,
    );
  }

  if (!webPushSupported()) {
    return Promise.resolve();
  }

  const asked =
    Notification.permission === "default"
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission);

  return asked
    .then(async (permission) => {
      if (permission === "granted") {
        await syncWebPushSubscription();
      }
    })
    .catch(() => undefined);
}
