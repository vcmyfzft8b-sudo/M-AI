import assert from "node:assert/strict";
import test from "node:test";

import { toClassificationResult } from "../src/lib/ugc/classification.ts";

const ruleVerdict = {
  classification: "personal",
  source: "rule",
  confidence: 1,
  reason: "No Memo AI signal in the caption, hashtags or mentions.",
  matches: ["keyword \"memo\" (+0.5)"],
};

test("a memo verdict counts the post", () => {
  const result = toClassificationResult(
    { verdict: "memo", reason: "Caption carries the creator's discount code." },
    ruleVerdict,
  );

  assert.equal(result.classification, "memo");
  assert.equal(result.source, "ai");
  assert.match(result.reason, /^AI: /);
});

test("a personal verdict is a decision, not a doubt", () => {
  // The bug this guards: an earlier version asked the model for a boolean plus
  // a confidence score and treated low confidence as ambiguity. Models report
  // low confidence on clear negatives too, so plainly personal videos flooded
  // the review queue instead of being excluded.
  const result = toClassificationResult(
    { verdict: "personal", reason: "A family video with no mention of the app." },
    ruleVerdict,
  );

  assert.equal(result.classification, "personal");
  assert.equal(result.source, "ai");
  assert.equal(result.confidence, 1);
});

test("only an explicit unclear verdict reaches the review queue", () => {
  const result = toClassificationResult(
    { verdict: "unclear", reason: "The caption is empty." },
    ruleVerdict,
  );

  assert.equal(result.classification, "unknown");
  assert.match(result.reason, /could not tell/);
});

test("the rule matches are carried through for context", () => {
  const result = toClassificationResult(
    { verdict: "personal", reason: "Ordinary vlog." },
    ruleVerdict,
  );

  assert.deepEqual(result.matches, ruleVerdict.matches);
});
