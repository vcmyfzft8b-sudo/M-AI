import assert from "node:assert/strict";
import test from "node:test";

import { ChatStreamError, requestChatAnswer } from "../src/lib/chat-stream-client.ts";

/*
 * The one thing the chat is judged on is whether it answers, and the failures
 * that stop it answering are mostly not the tutor's: a phone that changed cell
 * mid-question, a socket iOS closed while the screen was locked, an edge 502, a
 * stream that ended without its closing frame. Each of those used to put "the
 * answer could not be generated" on screen over a question that had never
 * reached a model.
 *
 * So the retry rule is "did anything come back?", not "did it work?", and these
 * scenarios are the two halves of that: what must be asked again, and what must
 * not be — a refusal that will refuse again, a failure the server already spent
 * its whole fallback chain on, and anything that arrives after the answer has
 * started painting, where a second attempt would duplicate a saved turn.
 */

const t = (key) => `t:${key}`;

function sse(frames) {
  return new Response(
    frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

/** An `fetch` that plays the given responses in order and counts the calls. */
function fetchScript(...outcomes) {
  const calls = [];

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const outcome = outcomes[calls.length - 1] ?? outcomes.at(-1);

      if (outcome instanceof Error) {
        throw outcome;
      }

      return outcome();
    },
  };
}

async function ask(fetchImpl, onDelta = () => {}) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    return await requestChatAnswer({
      url: "/api/lectures/abc/chat/stream",
      body: { question: "Kaj je entropija?" },
      onDelta,
      onAttemptStart: () => {},
      t,
    });
  } finally {
    globalThis.fetch = original;
  }
}

test("a dropped connection asks again instead of showing an error", async () => {
  const script = fetchScript(
    new TypeError("Load failed"),
    () => sse([["delta", { text: "Entropija je " }], ["done", { answer: { content: "ok" } }]]),
  );

  const { payload } = await ask(script.fetch);

  assert.equal(script.calls.length, 2);
  assert.equal(payload.answer.content, "ok");
});

test("an edge 5xx asks again", async () => {
  const script = fetchScript(
    () => new Response("upstream", { status: 502 }),
    () => sse([["done", { answer: { content: "ok" } }]]),
  );

  const { response, payload } = await ask(script.fetch);

  assert.equal(script.calls.length, 2);
  assert.equal(response.status, 200);
  assert.equal(payload.answer.content, "ok");
});

test("a stream that ends with no frame at all asks again", async () => {
  // The nastiest shape of all, because it looks like success: the body closes
  // cleanly, there is no error, and there is no answer either.
  const script = fetchScript(
    () => sse([]),
    () => sse([["done", { answer: { content: "ok" } }]]),
  );

  const { payload } = await ask(script.fetch);

  assert.equal(script.calls.length, 2);
  assert.equal(payload.answer.content, "ok");
});

test("the second attempt asks the same question", async () => {
  const script = fetchScript(
    new TypeError("Load failed"),
    () => sse([["done", { answer: { content: "ok" } }]]),
  );

  await ask(script.fetch);

  assert.deepEqual(script.calls[0].body, script.calls[1].body);
});

test("it gives up after one retry rather than looping", async () => {
  const script = fetchScript(new TypeError("Load failed"));

  await assert.rejects(() => ask(script.fetch), /Load failed/);
  assert.equal(script.calls.length, 2);
});

test("a refusal is returned as it is, not retried", async () => {
  // 402 (no subscription), 409 (note still processing), 429 (rate limit): every
  // one of them will say the same thing again, and the caller needs the body.
  for (const status of [402, 409, 429]) {
    const script = fetchScript(() =>
      Response.json({ error: "no", code: "billing_required" }, { status }),
    );

    const { response, payload } = await ask(script.fetch);

    assert.equal(script.calls.length, 1, `status ${status} must not be retried`);
    assert.equal(response.status, status);
    assert.equal(payload.code, "billing_required");
  }
});

test("an error frame is not retried — the server already tried everything", async () => {
  const script = fetchScript(() => sse([["error", { error: "The answer could not be generated." }]]));

  await assert.rejects(() => ask(script.fetch), (error) => {
    assert.ok(error instanceof ChatStreamError);
    assert.match(error.message, /could not be generated/);
    return true;
  });
  assert.equal(script.calls.length, 1);
});

test("a failure after the answer started painting is not retried", async () => {
  /*
   * By this point the tutor has answered and the turn is very likely already
   * saved, so asking again would buy a second answer to a question that has one
   * — and, in the note chat, a duplicate pair of rows in the history.
   */
  const script = fetchScript(() =>
    sse([["delta", { text: "Entropija je " }], ["error", { error: "gateway gone" }]]),
  );

  const painted = [];

  await assert.rejects(() => ask(script.fetch, (text) => painted.push(text)), /gateway gone/);
  assert.equal(script.calls.length, 1);
  assert.deepEqual(painted, ["Entropija je "]);
});

test("a retry repaints from scratch rather than continuing the last attempt", async () => {
  // Half of one answer followed by all of another reads as gibberish, so the
  // caller is told when to clear what it has painted.
  const resets = [];
  const original = globalThis.fetch;
  const script = fetchScript(
    new TypeError("Load failed"),
    () => sse([["delta", { text: "Entropija" }], ["done", { answer: { content: "ok" } }]]),
  );

  globalThis.fetch = script.fetch;

  try {
    await requestChatAnswer({
      url: "/api/lectures/abc/chat/stream",
      body: { question: "Kaj je entropija?" },
      onDelta: () => {},
      onAttemptStart: () => resets.push(script.calls.length),
      t,
    });
  } finally {
    globalThis.fetch = original;
  }

  // Once before each attempt, including the first.
  assert.deepEqual(resets, [0, 1]);
});
