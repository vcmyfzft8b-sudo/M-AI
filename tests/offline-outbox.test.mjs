import assert from "node:assert/strict";
import test from "node:test";

/**
 * Study written with no connection, held until there is one.
 *
 * The card screen rolls its whole advance back when a progress write fails, so
 * without a queue behind it a deck offline simply refuses to turn — which is
 * most of what studying offline *is*. These are the rules that make the queue
 * safe to have: it collapses what should collapse, it is bounded, it replays in
 * order, and it never gets stuck on an entry the server has already answered.
 */

function installStorage() {
  const entries = new Map();

  globalThis.localStorage = {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };

  return entries;
}

installStorage();

const { clearOutbox, queueOutboxEntry, readOutbox, replayOutbox } = await import(
  "../src/lib/offline/outbox.ts"
);

test("a card answer is kept per review; a study session collapses to the last", () => {
  clearOutbox();
  queueOutboxEntry({ path: "/api/flashcards/a/progress", method: "POST", body: '{"n":1}' });
  queueOutboxEntry({ path: "/api/flashcards/a/progress", method: "POST", body: '{"n":2}' });
  assert.equal(readOutbox().length, 2, "each review is a separate write the server counts");

  const session = { path: "/api/lectures/x/study-session", method: "PATCH", collapseKey: "s" };
  queueOutboxEntry({ ...session, body: '{"v":1}' });
  queueOutboxEntry({ ...session, body: '{"v":2}' });
  queueOutboxEntry({ ...session, body: '{"v":3}' });

  const sessions = readOutbox().filter((entry) => entry.collapseKey === "s");
  assert.equal(sessions.length, 1, "a whole-state snapshot only needs its latest");
  assert.equal(sessions[0].body, '{"v":3}');
});

test("replay sends in the order the work was done, and drains", async () => {
  clearOutbox();
  queueOutboxEntry({ path: "/api/flashcards/a/progress", method: "POST", body: '{"n":1}' });
  queueOutboxEntry({ path: "/api/flashcards/b/progress", method: "POST", body: '{"n":2}' });

  const sent = [];
  const delivered = await replayOutbox(async (path, init) => {
    sent.push([path, init.body]);
    return { ok: true };
  });

  assert.equal(delivered, 2);
  assert.deepEqual(sent, [
    ["/api/flashcards/a/progress", '{"n":1}'],
    ["/api/flashcards/b/progress", '{"n":2}'],
  ]);
  assert.deepEqual(readOutbox(), [], "nothing is left to send twice");
});

/*
 * A refusal is an answer. Keeping a rejected write would block every write
 * behind it for good, and the queue would never drain again.
 */
test("a write the server rejects is dropped, not retried forever", async () => {
  clearOutbox();
  queueOutboxEntry({ path: "/api/flashcards/a/progress", method: "POST", body: "{}" });

  await replayOutbox(async () => ({ ok: false, status: 403 }));
  assert.deepEqual(readOutbox(), []);
});

/*
 * A transport failure is the connection going again. Everything behind it would
 * fail the same way and be thrown away for nothing.
 */
test("replay stops at the first request that never reaches a server", async () => {
  clearOutbox();
  queueOutboxEntry({ path: "/api/flashcards/a/progress", method: "POST", body: "{}" });
  queueOutboxEntry({ path: "/api/flashcards/b/progress", method: "POST", body: "{}" });

  let attempts = 0;
  const delivered = await replayOutbox(async () => {
    attempts += 1;
    throw new TypeError("Load failed");
  });

  assert.equal(delivered, 0);
  assert.equal(attempts, 1, "the second is not even tried");
  assert.equal(readOutbox().length, 2, "both are still waiting");
});

test("a long stretch offline cannot fill the origin's storage", () => {
  clearOutbox();
  for (let index = 0; index < 620; index += 1) {
    queueOutboxEntry({ path: `/api/flashcards/${index}/progress`, method: "POST", body: "{}" });
  }

  const kept = readOutbox();
  assert.equal(kept.length, 500);
  // The newest answers are the ones worth keeping.
  assert.equal(kept.at(-1).path, "/api/flashcards/619/progress");
});

test("a storage that refuses to be written does not fail the study session", () => {
  clearOutbox();
  const working = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => "[]",
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };

  assert.doesNotThrow(() =>
    queueOutboxEntry({ path: "/api/flashcards/a/progress", method: "POST", body: "{}" }),
  );
  globalThis.localStorage = working;
});
