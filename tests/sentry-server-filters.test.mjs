import assert from "node:assert/strict";
import test from "node:test";

import { AI_PROVIDER_SPEND_CAP_MESSAGE, GEMINI_SPEND_CAP_ISSUE_TITLE } from "../src/lib/ai/errors.ts";
import {
  GEMINI_SPEND_CAP_FINGERPRINT,
  groupProviderBillingEvent,
} from "../src/lib/sentry-server-filters.ts";

// Google's answer on 2026-10-20 (MEMOAI-WEB-64), as the SDK and Inngest carried it.
const SPEND_CAP_BODY =
  '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap. Learn more at https://ai.google.dev/gemini-api/docs/billing#project-spend-caps. ","status":"RESOURCE_EXHAUSTED"}}';

const event = (type, value, extra = {}) => ({
  exception: { values: [{ type, value }] },
  tags: { route: "lecture-pipeline" },
  ...extra,
});

/** The four issues one cause opened that afternoon, as their events would read now. */
const DAY_ONE_EVENTS = {
  // MEMOAI-WEB-63: the scan path's rethrown learner sentence.
  scan: event("Error", AI_PROVIDER_SPEND_CAP_MESSAGE),
  // MEMOAI-WEB-64: the document route's raw ApiError.
  document: event("ApiError", SPEND_CAP_BODY),
  // MEMOAI-WEB-65: Inngest's flattened copy of the embeddings error.
  inngest: event("Error", SPEND_CAP_BODY),
  // Our named wrapper, wherever it is thrown from now.
  wrapped: event("AiProviderSpendCapError", `${GEMINI_SPEND_CAP_ISSUE_TITLE}: ${SPEND_CAP_BODY}`),
};

test("every spend-cap event is filed under one issue with a clear title", () => {
  for (const [route, original] of Object.entries(DAY_ONE_EVENTS)) {
    const grouped = groupProviderBillingEvent(structuredClone(original));
    const [exception] = grouped.exception.values;

    assert.deepEqual(grouped.fingerprint, GEMINI_SPEND_CAP_FINGERPRINT, route);
    assert.equal(exception.type, "AiProviderSpendCapError", route);
    assert.equal(exception.value, GEMINI_SPEND_CAP_ISSUE_TITLE, route);
    assert.equal(grouped.tags.ai_provider_billing, "gemini_spend_cap", route);
    assert.equal(grouped.tags.route, "lecture-pipeline", "existing tags are kept");
    assert.equal(grouped.extra.providerMessage, original.exception.values[0].value, "the original text is kept");
  }
});

test("the original exception is enough on its own", () => {
  const grouped = groupProviderBillingEvent(event("Error", "Request failed"), {
    originalException: new Error(SPEND_CAP_BODY),
  });

  assert.deepEqual(grouped.fingerprint, GEMINI_SPEND_CAP_FINGERPRINT);
});

test("a message event is grouped too", () => {
  const grouped = groupProviderBillingEvent({ message: SPEND_CAP_BODY });

  assert.deepEqual(grouped.fingerprint, GEMINI_SPEND_CAP_FINGERPRINT);
});

test("an event that names its own issue keeps it", () => {
  // The cost alarm's monthly cap warning, fingerprinted per provider and month.
  const warning = {
    ...event("Error", "AI spend cap warning: Gemini for 2026-10 is €102, 51% of the €200 monthly spending cap."),
    fingerprint: ["ai-cost-report", "monthly-cap", "google", "2026-10"],
  };

  assert.deepEqual(groupProviderBillingEvent(structuredClone(warning)), warning);

  // Even one that quotes Google's refusal: whoever set the fingerprint chose the issue.
  const quoted = { ...event("Error", SPEND_CAP_BODY), fingerprint: ["ai-cost-report", "monthly-cap"] };
  assert.deepEqual(groupProviderBillingEvent(structuredClone(quoted)), quoted);
});

test("anything else is left exactly as it was", () => {
  const unrelated = [
    event("Error", "Naš ponudnik UI je trenutno preobremenjen. Poskusi znova čez minuto."),
    event("ApiError", '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}'),
    event("TypeError", "x is not a function"),
    { message: "plain log" },
  ];

  for (const original of unrelated) {
    const copy = structuredClone(original);

    assert.deepEqual(groupProviderBillingEvent(copy), original);
  }
});
