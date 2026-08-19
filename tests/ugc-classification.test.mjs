import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyVideo,
  extractHashtags,
  extractMentions,
} from "../src/lib/ugc/classification.ts";

// The seeded rule set from supabase/migrations/0027_admin_dashboard.sql.
const RULES = [
  { kind: "link", pattern: "memoai.eu", weight: 1 },
  { kind: "mention", pattern: "memo_ai", weight: 1 },
  { kind: "mention", pattern: "memoai", weight: 1 },
  { kind: "mention", pattern: "memo.ai", weight: 1 },
  { kind: "hashtag", pattern: "memoai", weight: 1 },
  { kind: "hashtag", pattern: "memo", weight: 1 },
  { kind: "hashtag", pattern: "memoaiapp", weight: 1 },
  { kind: "keyword", pattern: "memo ai", weight: 1 },
  { kind: "keyword", pattern: "memoai", weight: 1 },
  { kind: "keyword", pattern: "memo.ai", weight: 1 },
  { kind: "keyword", pattern: "memo app", weight: 1 },
  { kind: "keyword", pattern: "memo", weight: 0.5 },
  { kind: "keyword", pattern: "zapiski", weight: 0.25 },
  { kind: "keyword", pattern: "aplikacija za učenje", weight: 0.5 },
];

function classify(input) {
  return classifyVideo(
    { contentMode: "mixed", hashtags: [], mentions: [], promoCodes: [], ...input },
    RULES,
  );
}

// The two real captions scraped from @studywithpija, verbatim.
const REAL_CAPTION_A =
  "‼️Koda PIJA50 za 50% popusta‼️@Memo AI \n#5 #school #ai #zapiski #how ";
const REAL_CAPTION_B =
  "‼️koda PIJA50 za 50% popusta‼️ @Memo AI \n#study #popravci #app #dontworry #ai ";

test("counts a real campaign post from a mixed personal account", () => {
  // TikTok renders the mention with the display name, not the handle, so the
  // mention normaliser has to collapse "@Memo AI" down to "memoai".
  const result = classify({
    caption: REAL_CAPTION_A,
    hashtags: ["5", "school", "ai", "zapiski", "how"],
    mentions: ["@Memo AI"],
    promoCodes: ["PIJA50"],
  });

  assert.equal(result.classification, "memo");
  assert.equal(result.source, "rule");
  assert.ok(result.matches.some((match) => match.includes("PIJA50")));
});

test("still counts the post when the promo code is lowercase", () => {
  const result = classify({
    caption: REAL_CAPTION_B,
    hashtags: ["study", "popravci", "app", "dontworry", "ai"],
    mentions: ["@Memo AI"],
    promoCodes: ["PIJA50"],
  });

  assert.equal(result.classification, "memo");
});

test("counts the post from the mention alone when the promo code is absent", () => {
  const result = classify({
    caption: "novi zapiski so tukaj @Memo AI",
    mentions: ["@Memo AI"],
    promoCodes: ["PIJA50"],
  });

  assert.equal(result.classification, "memo");
});

test("does not count a genuinely personal post", () => {
  const result = classify({
    caption: "grem na morje z družino, končno počitnice",
    hashtags: ["summer", "vlog"],
  });

  assert.equal(result.classification, "personal");
});

test("does not fire on 'memo' inside an unrelated word", () => {
  // The bug this guards: a substring match would score "memories" as a hit and
  // silently move a personal vlog into the campaign totals.
  const result = classify({ caption: "core memories from this summer" });

  assert.equal(result.classification, "personal");
  assert.deepEqual(result.matches, []);
});

test("sends a weak-signal post to the review queue instead of guessing", () => {
  // "zapiski" (0.25) + "memo" as a standalone word (0.5) = 0.75: over the review
  // threshold, under the counting threshold.
  const result = classify({ caption: "moji zapiski in memo za jutri" });

  assert.equal(result.classification, "unknown");
  assert.ok(result.confidence < 1);
});

test("a dedicated account counts every post without scoring the caption", () => {
  const result = classify({
    caption: "grem na morje",
    contentMode: "dedicated",
  });

  assert.equal(result.classification, "memo");
  assert.equal(result.source, "account_default");
});

test("a personal-flagged account never contributes to campaign totals", () => {
  const result = classify({
    caption: "koda EMA50 za 50% popusta @Memo AI",
    contentMode: "personal",
    promoCodes: ["EMA50"],
  });

  assert.equal(result.classification, "personal");
  assert.equal(result.source, "account_default");
});

test("matches a memoai.eu link written without spaces around it", () => {
  const result = classify({ caption: "prenesi na memoai.eu/app zdaj" });

  assert.equal(result.classification, "memo");
});

test("matches diacritic and separator variants of the brand", () => {
  for (const caption of ["MEMO AI je top", "memo-ai je top", "Memo.AI je top"]) {
    assert.equal(classify({ caption }).classification, "memo", caption);
  }
});

test("extracts hashtags and mentions from a Slovenian caption", () => {
  assert.deepEqual(extractHashtags("#zapiski in #učenje danes"), [
    "zapiski",
    "učenje",
  ]);
  assert.deepEqual(extractMentions("hvala @memo_ai in @studywithpija"), [
    "memo_ai",
    "studywithpija",
  ]);
});
