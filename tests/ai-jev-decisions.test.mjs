import assert from "node:assert/strict";
import test from "node:test";

import {
  batchJevQuestions,
  isJevEnabled,
  JEV_MAX_CHOICE_OPTIONS,
  jevCostUsd,
  parseJevAnswer,
  parseJevAnswers,
} from "../src/lib/ai/jev.ts";
import {
  importanceFromScore,
  IMPORTANCE_RUBRIC,
  linkDuplicateItems,
  MARK_CRITERIA,
} from "../src/lib/ai/decisions.ts";

/**
 * The wire shape is the fragile part of this integration and the only part that fails silently.
 *
 * Every decision falls back to the model it replaced when an answer will not parse, which is the
 * right behaviour and also means a field renamed at the gateway would show up as "Jev is never
 * used" rather than as an error. These fixtures are copied from a real
 * POST https://ai-gateway.vercel.sh/v1/evaluate response captured on 2026-09-19; if the gateway
 * changes its shape, this is the thing that is supposed to go red.
 */
const LIVE_RESPONSE = {
  model: "typesafe-ai/jev",
  answers: {
    about_animals: { type: "boolean", probability: 0.99 },
    mood: {
      type: "choice",
      choice: "calm",
      probabilities: { angry: 0, calm: 1, sad: 0 },
      confidence: 1,
    },
    vividness: {
      type: "score",
      score: 0.95,
      probabilities: { 0: 0.05, 1: 0.94, 2: 0.01 },
      confidence: 0.91,
    },
  },
  usage: { inputTokens: 392, outputTokens: 77 },
};

test("reads a live gateway response", () => {
  const parsed = parseJevAnswers(LIVE_RESPONSE);

  assert.equal(parsed.usage.inputTokens, 392);
  assert.deepEqual(parsed.answers.about_animals, { type: "boolean", probability: 0.99 });
  assert.equal(parsed.answers.mood.choice, "calm");
  assert.equal(parsed.answers.mood.confidence, 1);
  assert.equal(parsed.answers.vividness.score, 0.95);
});

test("a boolean answer carries no confidence field, and that is not a parse failure", () => {
  // The probability is the answer, so there is nothing else to be confident about. An earlier
  // draft of the parser required a confidence and would have discarded every boolean answer.
  const parsed = parseJevAnswer({ type: "boolean", probability: 0.02 });

  assert.equal(parsed.type, "boolean");
  assert.equal(parsed.probability, 0.02);
});

test("a score is normalised against the width of its own rubric", () => {
  const top = parseJevAnswer({
    type: "score",
    score: 4,
    probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 },
    confidence: 0.9,
  });
  const middle = parseJevAnswer({
    type: "score",
    score: 2,
    probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 },
    confidence: 0.9,
  });

  assert.equal(top.normalized, 1);
  assert.equal(middle.normalized, 0.5);
});

test("an unreadable answer is dropped rather than defaulted", () => {
  // A score silently read as 0 marks a fact disposable and a boolean read as false drops it, so
  // there is no safe default here — only "no answer", which costs the caller its fallback.
  assert.equal(parseJevAnswer({ type: "score", score: "high" }), null);
  assert.equal(parseJevAnswer({ type: "choice", probabilities: {} }), null);
  assert.equal(parseJevAnswer({ type: "verdict", value: "yes" }), null);
  assert.equal(parseJevAnswer(null), null);
  assert.equal(parseJevAnswers({ answers: "none" }), null);
});

test("the five-level rubric maps onto the 1-5 scale the pipeline already stores", () => {
  assert.equal(IMPORTANCE_RUBRIC.length, 5);
  assert.equal(importanceFromScore({ type: "score", score: 0, normalized: 0, confidence: 1, probabilities: {} }), 1);
  assert.equal(importanceFromScore({ type: "score", score: 4, normalized: 1, confidence: 1, probabilities: {} }), 5);
  // Continuous in, integer out — 3.6 is nearer "must know" than "core".
  assert.equal(importanceFromScore({ type: "score", score: 3.6, normalized: 0.9, confidence: 1, probabilities: {} }), 5);
  assert.equal(importanceFromScore({ type: "boolean", probability: 1 }), null);
});

test("marking uses exactly the three marks the rubric arithmetic knows", () => {
  // scoreFromRubric in practice-test-scoring.ts credits met/partial/missed and nothing else, so a
  // fourth criterion here would produce a mark that scores as zero without being "missed".
  assert.deepEqual(Object.keys(MARK_CRITERIA).sort(), ["met", "missed", "partial"]);
});

test("questions are split into request-sized batches without losing any", () => {
  const questions = Object.fromEntries(
    Array.from({ length: 120 }, (_unused, index) => [
      `q${index}`,
      { type: "boolean", instructions: "?" },
    ]),
  );
  const batches = batchJevQuestions(questions, 50);

  assert.deepEqual(batches.map((batch) => Object.keys(batch).length), [50, 50, 20]);
  assert.equal(
    batches.reduce((total, batch) => total + Object.keys(batch).length, 0),
    120,
  );
});

test("a choice never offers more options than Jev accepts", () => {
  assert.equal(JEV_MAX_CHOICE_OPTIONS, 255);
});

test("output tokens are free, so cost follows input alone", () => {
  assert.equal(jevCostUsd({ inputTokens: 1_000_000, outputTokens: 999_999 }), 0.042);
});

test("both switches have to be on", () => {
  const key = process.env.AI_GATEWAY_API_KEY;
  const flag = process.env.JEV_DECISIONS;

  try {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    process.env.JEV_DECISIONS = "on";
    assert.equal(isJevEnabled(), false, "a flag without a key must not enable it");

    process.env.AI_GATEWAY_API_KEY = "test-key";
    process.env.JEV_DECISIONS = "off";
    assert.equal(isJevEnabled(), false, "a key without the flag must not enable it");

    process.env.JEV_DECISIONS = "on";
    assert.equal(isJevEnabled(), true);
  } finally {
    if (key === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = key;
    if (flag === undefined) delete process.env.JEV_DECISIONS;
    else process.env.JEV_DECISIONS = flag;
  }
});

/**
 * The fallback contract, which is the only reason this is safe to switch on in production.
 *
 * Every call site keeps the model it already used and only *prefers* a Jev answer when one comes
 * back whole. So the thing that must be true, under every way a young vendor can fail, is that
 * `linkDuplicateItems` returns null — never a throw, and never a partial answer that would be
 * mistaken for a complete one. A partial answer is the dangerous case: verdicts for 200 of 300
 * facts would read as "the other 100 have no duplicates" and ship a deck full of repeats.
 */
const FAILURES = {
  "rate limited": { ok: false, status: 429 },
  "server error": { ok: false, status: 503 },
  "unauthorized": { ok: false, status: 401 },
  "body is not json": { ok: true, json: async () => { throw new SyntaxError("not json"); } },
  "body has no answers": { ok: true, json: async () => ({ model: "typesafe-ai/jev" }) },
  "answers are a string": { ok: true, json: async () => ({ answers: "nope" }) },
  "answer fields renamed": {
    ok: true,
    json: async () => ({ answers: { dup_1: { verdict: "none", certainty: 1 } }, usage: {} }),
  },
  "short answer set": {
    ok: true,
    json: async () => ({
      answers: { dup_1: { type: "choice", choice: "none", probabilities: {}, confidence: 1 } },
      usage: { inputTokens: 5, outputTokens: 0 },
    }),
  },
};

const THREE_ITEMS = [{ claim: "Alpha is the first letter." }, { claim: "Beta is the second." }, { claim: "Gamma is the third." }];

for (const [name, response] of Object.entries(FAILURES)) {
  test(`dedupe falls back when the gateway ${name}`, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => response;

    try {
      const decided = await linkDuplicateItems({ items: THREE_ITEMS }, { force: true, apiKey: "k" });

      assert.equal(decided, null, "must be null so the caller uses the writer");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
}

test("dedupe falls back when the network throws outright", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };

  try {
    assert.equal(await linkDuplicateItems({ items: THREE_ITEMS }, { force: true, apiKey: "k" }), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("with no key and no flag, nothing is called at all", async () => {
  const key = process.env.AI_GATEWAY_API_KEY;
  const flag = process.env.JEV_DECISIONS;
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should never be reached"); };

  try {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_DECISIONS;

    // This is production's state today: the decision layer is inert and costs not even a socket.
    assert.equal(await linkDuplicateItems({ items: THREE_ITEMS }), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = key;
    if (flag === undefined) delete process.env.JEV_DECISIONS; else process.env.JEV_DECISIONS = flag;
  }
});

test("a confident duplicate is linked; an unsure one is left alone", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { questions } = JSON.parse(init.body);
    const answers = {};

    for (const key of Object.keys(questions)) {
      // Item 1 confidently duplicates item 0; item 2 duplicates item 0 but only barely.
      answers[key] =
        key === "dup_1"
          ? { type: "choice", choice: "0", probabilities: {}, confidence: 0.95 }
          : { type: "choice", choice: "0", probabilities: {}, confidence: 0.4 };
    }

    return { ok: true, json: async () => ({ answers, usage: { inputTokens: 9, outputTokens: 0 } }) };
  };

  try {
    const decided = await linkDuplicateItems({ items: THREE_ITEMS }, { force: true, apiKey: "k" });

    // A wrong link deletes a fact from the deck for good, so the unsure one keeps its item.
    assert.deepEqual(decided.value, [
      { index: 1, duplicateOf: 0 },
      { index: 2, duplicateOf: null },
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
