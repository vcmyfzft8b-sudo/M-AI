/**
 * Why the paywall is showing, so it can name the thing the learner just tried.
 *
 * Every limit a free account can reach sends it to the same screen, `/app/start`.
 * Before this, that screen said the same sentence whatever brought the learner
 * there — a chat question, a second recording, the read-aloud running out — and
 * its close button always went home, away from the note they were working on.
 * `?for=` picks the headline and the first benefit; `?back=` is where the close
 * button returns to. Neither changes what anything costs or what is free.
 *
 * Pure and dependency-free: the server builds 402 bodies with it and the client
 * builds links with it.
 */
export const PAYWALL_REASONS = [
  /** Making a note after the free one. */
  "note",
  /** Opening a note the account can no longer read (made while subscribed). */
  "locked",
  /** The free chat questions on the trial note are used up. */
  "chat",
  /** Today's free read-aloud minutes are used up. */
  "listen",
  /** The free tutor minute is used up. */
  "tutor",
  /** The free podcast minute is used up. */
  "podcast",
  /** New flashcards, mind map or practice test are paid only. */
  "regenerate",
  /** Asking across every note is paid only. */
  "library",
  /** Exam prep (its plan, lessons and mock exam) is paid only. */
  "exam",
  /**
   * No limit at all: an offer that finds a free learner while they browse
   * (`paywall-nudge.tsx`), each one better than the last.
   */
  "offer",
] as const;

export type PaywallReason = (typeof PAYWALL_REASONS)[number];

const PAYWALL_BASE_PATH = "/app/start";
const MAX_BACK_PATH_LENGTH = 512;

export function isPaywallReason(value: unknown): value is PaywallReason {
  return typeof value === "string" && (PAYWALL_REASONS as readonly string[]).includes(value);
}

/**
 * The close button's destination, or null when the value is not one of ours.
 *
 * Only paths inside the app (or its creator demo) are accepted, and never the
 * paywall itself, so `?back=` cannot be turned into a way off the site or into
 * a loop.
 */
export function readPaywallBack(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BACK_PATH_LENGTH) {
    return null;
  }

  if (value.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(value)) {
    return null;
  }

  const path = value.split(/[?#]/, 1)[0];
  const inApp = path === "/app" || path.startsWith("/app/") || path === "/creator" || path.startsWith("/creator/");

  if (!inApp || path.endsWith("/start")) {
    return null;
  }

  return value;
}

/** `/app/start`, optionally saying why and where to return to. */
export function paywallPath(reason?: PaywallReason | null, back?: string | null) {
  const params = new URLSearchParams();

  if (reason) {
    params.set("for", reason);
  }

  const safeBack = readPaywallBack(back);

  if (safeBack) {
    params.set("back", safeBack);
  }

  const query = params.toString();
  return query ? `${PAYWALL_BASE_PATH}?${query}` : PAYWALL_BASE_PATH;
}

/**
 * Adds the reader's current page as `back` to a paywall link built on the
 * server, which could not know it. Leaves any other link alone.
 */
export function withPaywallBack(href: string, back: string | null | undefined) {
  const safeBack = readPaywallBack(back);

  if (!safeBack || !href.split("?", 1)[0].endsWith("/start")) {
    return href;
  }

  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("back", safeBack);
  return `${path}?${params.toString()}`;
}

/** The page the reader is on, as `back` wants it. Browser only. */
export function currentPaywallBack() {
  if (typeof window === "undefined") {
    return null;
  }

  return readPaywallBack(`${window.location.pathname}${window.location.search}`);
}
