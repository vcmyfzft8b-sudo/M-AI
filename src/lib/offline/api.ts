"use client";

/**
 * The app's `/api` surface, answered from the offline snapshot.
 *
 * Installed over `window.fetch` for as long as the browser reports no
 * connection, and a straight pass-through the moment one returns — so this is
 * not a second implementation of the app running in parallel, it is a layer
 * that exists only while the real one cannot be reached.
 *
 * Three kinds of answer:
 *
 * - **Reads that the snapshot holds** are served from it, so the note screen's
 *   own refresh and the mind map's lazy fetch behave exactly as they do online.
 * - **Study writes** are queued (see `outbox.ts`) and answered as if they had
 *   been accepted, because the card screen rolls its whole advance back when a
 *   progress write fails and a deck that will not turn is not a usable deck.
 * - **Everything else** is refused with `503` and a translated message under
 *   `code: "offline"`, which is what every screen in the app already knows how
 *   to put in front of the reader.
 *
 * The refusal is the important part. Without it, a note upload offline fails
 * with whatever the engine calls a dropped connection — "Load failed" in
 * Safari — which is English, unexplained, and reads as a crash.
 */
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import { queueOutboxEntry } from "@/lib/offline/outbox";
import { readOfflineLecture, readOfflineMindmap } from "@/lib/offline/snapshot";
import { resolveOfflineRoute } from "@/lib/offline/paths";
import type { FlashcardWithCitations } from "@/lib/types";

/** What the app checks for to tell "offline" from any other refusal. */
export const OFFLINE_ERROR_CODE = "offline";

export type OfflineFetchOptions = {
  /** Whether the connection is currently considered down. */
  isOffline: () => boolean;
  /** Told when a request that was let through died before reaching a server. */
  onTransportFailure?: () => void;
  t: Translate<MessageKey>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function offlineRefusal(t: Translate<MessageKey>) {
  return json({ error: t("offline.requestBlocked"), code: OFFLINE_ERROR_CODE }, 503);
}

function toUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return new URL(input, window.location.origin);
  }

  return input instanceof URL ? input : new URL(input.url, window.location.origin);
}

function methodOf(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

async function bodyOf(input: RequestInfo | URL, init?: RequestInit) {
  const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof Blob) {
    return await body.text();
  }

  return null;
}

/**
 * The progress row the server would have written, computed from the copy we
 * already hold. The card screen renders `review_count` and the bucket straight
 * back, so an answer given offline has to look like an answer given online.
 */
function nextProgressRow(
  flashcardId: string,
  card: FlashcardWithCitations | undefined,
  confidenceBucket: string,
) {
  const existing = card?.progress ?? null;

  return {
    ...(existing ?? {}),
    /*
     * From the address, not from the card: the note may not be in the snapshot
     * at all (answered from the memory palace of a note opened on another
     * device), and a row that names the wrong card is worse than a count that
     * starts from one.
     */
    flashcard_id: flashcardId,
    confidence_bucket: confidenceBucket,
    review_count: (existing?.review_count ?? 0) + 1,
    last_reviewed_at: new Date().toISOString(),
  };
}

async function answerOffline(
  url: URL,
  method: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  t: Translate<MessageKey>,
): Promise<Response> {
  const path = url.pathname;

  /* Analytics and the language cookie: silently accepted, never an error. */
  if (path === "/api/track" || path === "/api/locale") {
    return json({ ok: true });
  }

  const detail = /^\/api\/lectures\/([^/]+)$/.exec(path);

  if (detail && method === "GET") {
    const snapshot = await readOfflineLecture(detail[1]);

    return snapshot ? json(snapshot.detail) : offlineRefusal(t);
  }

  const mindmap = /^\/api\/lectures\/([^/]+)\/mindmap$/.exec(path);

  if (mindmap && method === "GET") {
    const cached = await readOfflineMindmap(mindmap[1]);

    return cached ? json(cached.payload) : offlineRefusal(t);
  }

  const progress = /^\/api\/flashcards\/([^/]+)\/progress$/.exec(path);

  if (progress && method === "POST") {
    const body = (await bodyOf(input, init)) ?? "{}";
    /*
     * "again" rather than anything cheerier: a body this cannot read is an
     * answer nobody can vouch for, and the safe way to be wrong about a
     * flashcard is to show it again.
     */
    let confidenceBucket = "again";

    try {
      const parsed = JSON.parse(body) as { confidenceBucket?: string };
      confidenceBucket = parsed.confidenceBucket ?? confidenceBucket;
    } catch {
      /* Keep the default; the queued body is what the server will parse. */
    }

    queueOutboxEntry({ path, method: "POST", body });

    /*
     * The row the screen renders back is rebuilt from the note's own snapshot.
     * Which note that is comes from the address rather than from the request:
     * cards are only ever answered from inside a note — the deck screen and the
     * memory palace both live at `/app/lectures/<id>` — and the endpoint itself
     * carries no lecture in it.
     */
    const route = resolveOfflineRoute(window.location.pathname);
    const snapshot = route.kind === "lecture" ? await readOfflineLecture(route.lectureId) : null;
    const card = snapshot?.detail.flashcards.find((entry) => entry.id === progress[1]);

    return json({ progress: nextProgressRow(progress[1], card, confidenceBucket) });
  }

  const studySession = /^\/api\/lectures\/([^/]+)\/study-session$/.exec(path);

  if (studySession && (method === "PATCH" || method === "POST")) {
    const body = await bodyOf(input, init);

    if (body) {
      /*
       * A whole-state snapshot, so only the last one matters — collapsed by
       * note, or an hour of revision would queue several hundred copies of the
       * same object to replay one after another.
       */
      queueOutboxEntry({ path, method, body, collapseKey: path });
    }

    return json({ ok: true });
  }

  return offlineRefusal(t);
}

export function createOfflineFetch(originalFetch: typeof fetch, options: OfflineFetchOptions) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!options.isOffline()) {
      /*
       * While the app believes it is online, requests go straight out — but a
       * transport failure is reported back, because `navigator.onLine` cannot
       * see the difference between "connected" and "connected to a router with
       * nothing behind it". The provider checks; the next request is then
       * answered from the snapshot rather than failing the same way.
       *
       * An abort is not evidence of anything: it is the app cancelling its own
       * request, and on iOS it is also what a backgrounded web view does to
       * every request it has in flight.
       */
      try {
        return await originalFetch(input, init);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          options.onTransportFailure?.();
        }

        throw error;
      }
    }

    let url: URL;

    try {
      url = toUrl(input);
    } catch {
      return originalFetch(input, init);
    }

    /*
     * Only this origin's API. A cross-origin request — Supabase storage for a
     * note's photos, the icon font — goes to the network and, where the service
     * worker has a copy, is answered by it.
     */
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    try {
      return await answerOffline(url, methodOf(input, init), input, init, options.t);
    } catch {
      return offlineRefusal(options.t);
    }
  }) as typeof fetch;
}
