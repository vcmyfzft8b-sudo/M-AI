import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_PROVIDER_OVERLOADED_MESSAGE,
  AI_PROVIDER_SPEND_CAP_FAILURE_CODE,
  AI_PROVIDER_SPEND_CAP_MESSAGE,
  AiProviderSpendCapError,
  GEMINI_SPEND_CAP_ISSUE_TITLE,
  isAiProviderSpendCapError,
  isRetryableAiError,
  toAiFailureCode,
  toProviderBillingError,
  toUserFacingAiErrorMessage,
} from "../src/lib/ai/errors.ts";
import {
  LECTURE_FAILURE_MESSAGE_KEYS,
  canRetryLectureFailureCode,
} from "../src/lib/lecture-failure-codes.ts";

/*
 * The body Google answered every Gemini call with on 2026-10-20 from 13:23 to 13:58 UTC, copied
 * from Sentry MEMOAI-WEB-64. `@google/genai` puts it verbatim in an `ApiError`'s message.
 */
const SPEND_CAP_BODY = JSON.stringify({
  error: {
    code: 429,
    message:
      "Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap. Learn more at https://ai.google.dev/gemini-api/docs/billing#project-spend-caps. ",
    status: "RESOURCE_EXHAUSTED",
  },
});

/** The SDK's error for a refused generate/embed/upload call: a 429 with the JSON as its message. */
function apiError(message, status = 429) {
  return Object.assign(new Error(message), { name: "ApiError", status });
}

/** Every shape the cap reached the app in on the day, one per path. */
const SPEND_CAP_SHAPES = {
  // generateTextWithGeminiFile (document and scan reading), generateStructuredObjectWithGemini
  // (UGC classification, the text fallback tier) and createGeminiEmbeddings.
  "SDK ApiError": apiError(SPEND_CAP_BODY),
  // src/lib/gemini-tts.ts, for the tutor, read-aloud and podcast voices.
  "Gemini speech refusal": Object.assign(
    new Error(`Gemini speech refused (429): ${SPEND_CAP_BODY.slice(0, 300)}`),
    { name: "GeminiSpeechError", status: 429 },
  ),
  // The same error after an Inngest step boundary: a plain Error with the text only (MEMOAI-WEB-65).
  "flattened by Inngest": { name: "Error", message: SPEND_CAP_BODY },
  // Our own wrapper, and our own wrapper flattened.
  "wrapped": new AiProviderSpendCapError(SPEND_CAP_BODY),
  "wrapped and flattened": { name: "Error", message: `${GEMINI_SPEND_CAP_ISSUE_TITLE}: ${SPEND_CAP_BODY}` },
  // The scan path rethrows the learner sentence as a fresh Error (MEMOAI-WEB-63).
  "rethrown learner sentence": new Error(AI_PROVIDER_SPEND_CAP_MESSAGE),
};

/** Ordinary 429s and quota answers: busy, not billing, and still worth a retry a minute later. */
const ORDINARY_RATE_LIMITS = [
  apiError(
    JSON.stringify({
      error: {
        code: 429,
        message: "Resource has been exhausted (e.g. check quota).",
        status: "RESOURCE_EXHAUSTED",
      },
    }),
  ),
  apiError("429 Too Many Requests"),
  apiError(
    JSON.stringify({
      error: {
        code: 429,
        message:
          "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generate_content_free_tier_requests, limit: 15",
        status: "RESOURCE_EXHAUSTED",
      },
    }),
  ),
  new Error("Gemini speech refused (429): rate limited"),
];

for (const [shape, error] of Object.entries(SPEND_CAP_SHAPES)) {
  test(`the spend cap is recognised as itself: ${shape}`, () => {
    assert.equal(isAiProviderSpendCapError(error), true);
    assert.equal(isRetryableAiError(error), false, "a retry cannot outlast a monthly cap");
    assert.equal(toUserFacingAiErrorMessage(error), AI_PROVIDER_SPEND_CAP_MESSAGE);
  });
}

test("an ordinary 429 stays a transient rate limit", () => {
  for (const error of ORDINARY_RATE_LIMITS) {
    assert.equal(isAiProviderSpendCapError(error), false, error.message);
    assert.equal(isRetryableAiError(error), true, error.message);
    assert.equal(toUserFacingAiErrorMessage(error), AI_PROVIDER_OVERLOADED_MESSAGE);
  }
});

test("our own cost alarm's wording about the cap is not the cap", () => {
  // src/lib/ai-cost-report.ts: a forecast and a billing-category explanation, not a refusal.
  for (const text of [
    "AI spend cap warning: Gemini for 2026-10 is €102.30 (estimate), 51% of the €200 monthly spending cap.",
    "At $9.80 a day, Gemini reaches the €200 monthly spending cap around 2026-10-26 (month-end forecast €282).",
    "Google refused the call because the Gemini project reached its monthly spending cap; nothing on Google works again until the cap is raised at https://ai.studio/spend.",
  ]) {
    assert.equal(isAiProviderSpendCapError(new Error(text)), false, text);
  }
});

test("the learner is no longer told the provider is overloaded", () => {
  const message = toUserFacingAiErrorMessage(apiError(SPEND_CAP_BODY));

  assert.notEqual(message, AI_PROVIDER_OVERLOADED_MESSAGE);
  assert.doesNotMatch(message, /minut/i, "the cap does not lift in a minute");
});

test("the sentence is stable when it comes round again", () => {
  assert.equal(
    toUserFacingAiErrorMessage(new Error(AI_PROVIDER_SPEND_CAP_MESSAGE)),
    AI_PROVIDER_SPEND_CAP_MESSAGE,
  );
});

test("the failure is recorded with its own code, which the note screen can word", () => {
  assert.equal(toAiFailureCode(AI_PROVIDER_SPEND_CAP_MESSAGE), AI_PROVIDER_SPEND_CAP_FAILURE_CODE);
  assert.equal(LECTURE_FAILURE_MESSAGE_KEYS[AI_PROVIDER_SPEND_CAP_FAILURE_CODE], "ai.providerSpendCap");
  // The learner's own retry works the moment the cap is lifted, so the button stays.
  assert.equal(canRetryLectureFailureCode(AI_PROVIDER_SPEND_CAP_FAILURE_CODE), true);
});

test("the learner sentence matches the Slovenian catalogue it stands in for", () => {
  const sl = readFileSync(new URL("../src/lib/i18n/messages/sl.ts", import.meta.url), "utf8");

  assert.ok(sl.includes(`"ai.providerSpendCap": "${AI_PROVIDER_SPEND_CAP_MESSAGE}"`));
});

test("toProviderBillingError names the cap and leaves everything else alone", () => {
  const wrapped = toProviderBillingError(apiError(SPEND_CAP_BODY));

  assert.ok(wrapped instanceof AiProviderSpendCapError);
  assert.equal(wrapped.name, "AiProviderSpendCapError");
  assert.ok(wrapped.message.startsWith(GEMINI_SPEND_CAP_ISSUE_TITLE));
  assert.ok(wrapped.message.includes("monthly spending cap"), "Google's sentence is kept");

  const already = new AiProviderSpendCapError("x");
  assert.equal(toProviderBillingError(already), already);

  const busy = ORDINARY_RATE_LIMITS[0];
  assert.equal(toProviderBillingError(busy), busy);
});

/*
 * The Gemini loops live in a server-only module the test runner cannot import, so these pin where
 * the cap is handled: before each loop's backoff, so it costs one refused call rather than four
 * calls over a minute.
 */
test("every Gemini retry loop stops on the spend cap", () => {
  const source = readFileSync(new URL("../src/lib/ai/gemini.ts", import.meta.url), "utf8");
  const structured = source.slice(
    source.indexOf("export async function generateStructuredObjectWithGemini"),
    source.indexOf("export async function generateTextWithGeminiFile"),
  );
  const file = source.slice(
    source.indexOf("export async function generateTextWithGeminiFile"),
    source.indexOf("export async function createGeminiEmbeddings"),
  );
  const embeddings = source.slice(source.indexOf("export async function createGeminiEmbeddings"));

  for (const [name, body, backoff] of [
    ["structured generation", structured, "getStructuredGenerationRetryDelayMs(error, attempt)"],
    ["file reading", file, "isGeminiRecitationBlock(error)"],
  ]) {
    const stop = body.indexOf("if (isAiProviderSpendCapError(error)) {");

    assert.ok(stop > 0, `${name} checks for the cap`);
    assert.ok(stop < body.indexOf(backoff), `${name} stops before it backs off`);
    assert.match(body.slice(stop, stop + 120), /throw toProviderBillingError\(error\)/);
  }

  assert.match(file, /\.upload\([\s\S]*?\.catch\(\(error: unknown\) => \{\s*throw toProviderBillingError\(error\);/);
  assert.match(embeddings, /throw toProviderBillingError\(error\);/);
});
