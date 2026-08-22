import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOutputHeadroom,
  resolveStageModelConfig,
  supportsThinkingLevel,
} from "../src/lib/ai/model-config.ts";
import { dedupeKnowledgeItems } from "../src/lib/notes/note-prompts.ts";

const resolve = (stage, env = {}, fallbackModel = "gemini-3.5-flash-lite") =>
  resolveStageModelConfig({ stage, env, fallbackModel });

test("a 2.5 model never receives a thinking level, because it cannot think", () => {
  // note_outline has no stage default model, so it actually lands on the 2.5 fallback.
  const config = resolve("note_outline", {}, "gemini-2.5-flash-lite");

  assert.equal(supportsThinkingLevel("gemini-2.5-flash-lite"), false);
  assert.equal(config.thinkingLevel, null);
});

test("a non-thinking stage keeps its token budget exactly as the caller sized it", () => {
  // Inflating the budget for a model that produces no thought tokens would just raise the ceiling
  // on runaway output.
  const config = resolve("note_extract");

  assert.equal(config.thinkingLevel, "minimal");
  assert.equal(applyOutputHeadroom(1800, config), 1800);
});

test("a thinking stage gets headroom, because thinking tokens are drawn from maxOutputTokens", () => {
  // Verified against the live API: 300 tokens with thinking on returns 9 answer tokens and
  // finishReason MAX_TOKENS, which structured-output.ts would read as truncation and retry.
  const config = resolve("note_write");

  assert.equal(config.thinkingLevel, "high");
  assert.ok(applyOutputHeadroom(2500, config) > 2500);
});

test("the headroom never pushes a budget past the 65k output ceiling", () => {
  assert.equal(applyOutputHeadroom(40_000, resolve("note_write")), 65_536);
});

test("an env override picks both the model and the thinking level", () => {
  const config = resolve("study_items", {
    GEMINI_STUDY_ITEMS_MODEL: "gemini-3.6-flash",
    GEMINI_STUDY_ITEMS_THINKING: "high",
  });

  assert.equal(config.model, "gemini-3.6-flash");
  assert.equal(config.thinkingLevel, "high");
});

test("an unrecognised thinking level falls back to the stage default instead of reaching the API", () => {
  const config = resolve("note_outline", { GEMINI_NOTE_OUTLINE_THINKING: "extreme" });

  assert.equal(config.thinkingLevel, "medium");
});

test("a claim repeated within one extraction pass collapses and gains importance", () => {
  const items = [
    {
      id: 0,
      claim: "The Laspeyres index uses base-period quantities as weights",
      kind: "definition",
      importance: 3,
      terms: [],
      sectionTitle: "Weighting",
    },
    {
      id: 1,
      claim: "Laspeyres index weights use quantities from the base period",
      kind: "definition",
      importance: 3,
      terms: [],
      sectionTitle: "Recap",
    },
    {
      id: 2,
      claim: "The Paasche index uses current-period quantities as weights",
      kind: "definition",
      importance: 4,
      terms: [],
      sectionTitle: "Weighting",
    },
  ];

  const deduped = dedupeKnowledgeItems(items, { boostRepeats: true });

  assert.equal(deduped.length, 2);
  // A lecturer restating something is evidence it matters, so the surviving copy ranks higher.
  assert.equal(deduped[0].importance, 4);
  assert.equal(deduped[1].claim, items[2].claim);

  // Across passes the same claim is expected twice and means nothing, so the default must not
  // boost — doing so flattened 70% of a source's items onto importance 5.
  const merged = dedupeKnowledgeItems(items);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].importance, 3);
});

test("dedupe keeps claims that merely share vocabulary but state different facts", () => {
  const items = [
    {
      id: 0,
      claim: "The MAC address is a 48-bit physical address written in hexadecimal",
      kind: "fact",
      importance: 4,
      terms: [],
      sectionTitle: "Addressing",
    },
    {
      id: 1,
      claim: "The IPv4 address is 32-bit and the IPv6 address is 128-bit",
      kind: "fact",
      importance: 4,
      terms: [],
      sectionTitle: "Addressing",
    },
  ];

  assert.equal(dedupeKnowledgeItems(items).length, 2);
});

test("note writing defaults to the premium model even when the shared fallback is cheap", () => {
  // The one stage the sweep found worth paying for: everything else inherits the fallback.
  assert.equal(resolve("note_write", {}, "gemini-2.5-flash-lite").model, "gemini-3.5-flash-lite");
  assert.equal(resolve("note_extract", {}, "gemini-2.5-flash-lite").model, "gemini-2.5-flash-lite");
  // An explicit env override still wins over the stage default.
  assert.equal(
    resolve("note_write", { GEMINI_NOTE_WRITE_MODEL: "gemini-3.6-flash" }, "gemini-2.5-flash-lite")
      .model,
    "gemini-3.6-flash",
  );
});
