"use client";

/**
 * Writes made with no connection, held until there is one.
 *
 * Only two kinds of write are queued, and both for the same reason: they are
 * the byproduct of *reading* rather than an act of authorship. Answering a
 * flashcard and moving through a study session are what studying offline
 * consists of, and a study screen that cannot record an answer is not usable at
 * all — the card screen rolls its whole advance back when the request fails, so
 * without this the deck simply refuses to turn.
 *
 * Everything else a user can write — creating a note, editing one, renaming,
 * deleting, moving to a folder, anything that asks the model a question — stays
 * refused offline and says so. Those are authored changes; replaying them
 * silently hours later against a library that has moved on is a worse outcome
 * than being told to come back online.
 *
 * Replay is in-order and at-most-once: an entry is dropped when the server
 * answers at all, including with an error, because a rejected write will be
 * rejected again and a queue that never drains is a queue that blocks every
 * write behind it.
 */
const STORAGE_KEY = "memo-offline-outbox";

/**
 * Bounded so a long stretch offline cannot fill the origin's storage. Oldest
 * out first: the newest answers are the ones worth keeping, and a flashcard's
 * progress row is a running total the server recomputes from what does arrive.
 */
const MAX_ENTRIES = 500;

export type OutboxEntry = {
  id: string;
  path: string;
  method: string;
  body: string;
  /**
   * Entries sharing a key replace one another instead of stacking: a study
   * session is a whole-state snapshot, so only the last one matters. Left
   * undefined the entry is kept as its own, which is what a flashcard answer
   * needs — each is a separate review the server counts.
   */
  collapseKey?: string;
  queuedAt: number;
};

function read(): OutboxEntry[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");

    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is OutboxEntry =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as OutboxEntry).path === "string" &&
            typeof (entry as OutboxEntry).body === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* A full or disabled store is not worth failing the study session over. */
  }
}

export function readOutbox() {
  return read();
}

export function queueOutboxEntry(entry: Omit<OutboxEntry, "id" | "queuedAt">) {
  const entries = read().filter(
    (existing) => !entry.collapseKey || existing.collapseKey !== entry.collapseKey,
  );

  entries.push({
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    queuedAt: Date.now(),
  });
  write(entries);
}

export function clearOutbox() {
  write([]);
}

let replaying = false;

/**
 * Sends what is queued, oldest first, and returns how many were delivered.
 * Stops at the first transport failure — the connection has gone again, and
 * everything after it would fail the same way and be dropped for nothing.
 */
export async function replayOutbox(transport: typeof fetch = fetch) {
  if (replaying) {
    return 0;
  }

  replaying = true;

  try {
    let delivered = 0;

    for (const entry of read()) {
      try {
        await transport(entry.path, {
          method: entry.method,
          headers: { "Content-Type": "application/json" },
          body: entry.body,
        });
      } catch {
        return delivered;
      }

      delivered += 1;
      write(read().filter((remaining) => remaining.id !== entry.id));
    }

    return delivered;
  } finally {
    replaying = false;
  }
}
