import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOutputHeadroom,
  GLM_TEXT_MODEL,
  resolveStageDirectFallbackModel,
  resolveStageModelConfig,
  resolveStageTimeoutMs,
  resolveWireReasoningEffort,
  shouldFallBackToDirectProvider,
  supportsThinkingLevel,
} from "../src/lib/ai/model-config.ts";
import { z } from "zod";

import {
  assembleSourceNoteParts,
  buildSourceNoteInstructions,
  dedupeKnowledgeItems,
  knowledgeExtractionSchema,
  MAX_ITEMS_PER_EXTRACTION_WINDOW,
  planSourceWriteWindows,
  resolveExtractionMaxOutputTokens,
} from "../src/lib/notes/note-prompts.ts";

const resolve = (stage, env = {}, fallbackModel = "gemini-3.5-flash-lite") =>
  resolveStageModelConfig({ stage, env, fallbackModel });

test("a 2.5 model never receives a thinking level, because it cannot think", () => {
  // Forced onto 2.5 via env (the stage default is GLM since 2026-08-28), the stage's thinking
  // level must collapse away rather than reach the API.
  const config = resolve(
    "note_outline",
    { GEMINI_NOTE_OUTLINE_MODEL: "gemini-2.5-flash-lite" },
    "gemini-3.5-flash-lite",
  );

  assert.equal(supportsThinkingLevel("gemini-2.5-flash-lite"), false);
  assert.equal(config.thinkingLevel, null);
});

test("a non-thinking stage keeps its token budget exactly as the caller sized it", () => {
  // Inflating the budget for a model that produces no thought tokens would just raise the ceiling
  // on runaway output. Only true of a model that can actually abstain from thinking, so the stage
  // is forced onto 2.5 here — the GLM default cannot abstain and is covered below.
  const config = resolve("note_extract", { GEMINI_NOTE_EXTRACT_MODEL: "gemini-2.5-flash-lite" });

  assert.equal(config.thinkingLevel, null);
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

test("every text stage defaults to GLM, and an env override still wins", () => {
  // The 2026-08-28 bake-off: GLM matched or beat the previous per-stage mix on recall at a
  // quarter of the price. json.ts falls back to a proven Gemini if the gateway fails, so this is
  // a price-and-quality choice, not a dependency.
  assert.equal(resolve("note_write", {}, "gemini-2.5-flash-lite").model, GLM_TEXT_MODEL);
  assert.equal(resolve("note_extract", {}, "gemini-2.5-flash-lite").model, GLM_TEXT_MODEL);
  assert.equal(resolve("study_items", {}, "gemini-2.5-flash-lite").model, GLM_TEXT_MODEL);
  // An explicit env override still wins over the stage default.
  assert.equal(
    resolve("note_write", { GEMINI_NOTE_WRITE_MODEL: "gemini-3.6-flash" }, "gemini-2.5-flash-lite")
      .model,
    "gemini-3.6-flash",
  );
});

test("a reasoning model is recognised through a gateway prefix", () => {
  assert.equal(supportsThinkingLevel("or/google/gemini-3.7-flash"), true);
  assert.equal(supportsThinkingLevel("or/openai/gpt-5-nano"), true);
  assert.equal(supportsThinkingLevel("gpt-5-nano"), true);
  assert.equal(supportsThinkingLevel("gpt-5-mini"), true);
  // 2.5 still does not think, routed or not, so its budget must not be inflated.
  assert.equal(supportsThinkingLevel("or/google/gemini-2.5-flash-lite"), false);
  assert.equal(supportsThinkingLevel("gemini-2.5-flash-lite"), false);
});

test("a mandatory-reasoning model gets output headroom even at minimal effort", () => {
  // Measured: gpt-5-nano spent 94,656 reasoning tokens across 27 extraction calls and truncated
  // every time, because extraction budgets assume a model that does not think. GLM reasons on
  // every call by contract, so it carries the same headroom.
  const nano = resolveStageModelConfig({
    stage: "note_extract",
    env: { GEMINI_NOTE_EXTRACT_MODEL: "gpt-5-nano" },
    fallbackModel: "gemini-2.5-flash-lite",
  });

  assert.equal(nano.thinkingLevel, "minimal");
  assert.ok(nano.outputHeadroom > 1, "reasoning at minimal still eats the output budget");
  assert.ok(applyOutputHeadroom(1800, nano) >= 3600);

  const glm = resolveStageModelConfig({
    stage: "note_extract",
    env: {},
    fallbackModel: "gemini-2.5-flash-lite",
  });

  assert.equal(glm.model, GLM_TEXT_MODEL);
  assert.ok(applyOutputHeadroom(1800, glm) >= 3600, "GLM cannot abstain from reasoning");

  const gemini = resolveStageModelConfig({
    stage: "note_extract",
    env: { GEMINI_NOTE_EXTRACT_MODEL: "gemini-2.5-flash-lite" },
    fallbackModel: "gemini-2.5-flash-lite",
  });

  assert.equal(gemini.outputHeadroom, 1, "a model that does not think needs no headroom");
});

test("every GLM level maps to its cheapest effort, by measurement", () => {
  // GLM publishes only max/high/low and an unmapped name silently buys "max". Measured
  // 2026-08-29: low-effort GLM matched or beat high-effort on note recall while writing up to
  // 28% shorter — for this pipeline, extra reasoning bought verbosity, not quality.
  for (const level of ["minimal", "low", "medium", "high"]) {
    assert.equal(resolveWireReasoningEffort(GLM_TEXT_MODEL, level), "low");
  }
  // Other models keep our level names untouched.
  assert.equal(resolveWireReasoningEffort("or/google/gemini-3.7-flash", "medium"), "medium");
});

test("a failed GLM call falls back to the Gemini that ran the stage before the switch", () => {
  // Sending "glm-5.3-flash" to Google's API is a guaranteed second failure, so the fallback for
  // a routed non-Gemini model is a real Gemini: the premium writer for note_write, the shared
  // text model (signalled as null) everywhere else.
  assert.equal(resolveStageDirectFallbackModel("note_write"), "gemini-3.7-flash");
  assert.equal(resolveStageDirectFallbackModel("note_extract"), null);
  assert.equal(resolveStageDirectFallbackModel("note_outline"), null);
});

test("GLM gets a shorter leash than Gemini so its fallback fits the same invocation", () => {
  // 200s of GLM plus ~60-90s of Gemini fallback fits Vercel's 300s ceiling; 240s plus a
  // fallback does not, and a step that dies mid-fallback has cached nothing.
  assert.equal(resolveStageTimeoutMs("note_write", GLM_TEXT_MODEL), 200_000);
  assert.equal(resolveStageTimeoutMs("note_outline", GLM_TEXT_MODEL), 200_000);
  assert.equal(resolveStageTimeoutMs("note_write", "gemini-3.7-flash"), 240_000);
  assert.equal(resolveStageTimeoutMs("note_write"), 240_000);
  assert.equal(resolveStageTimeoutMs("source_condense", GLM_TEXT_MODEL), 60_000);
});

test("a routed model keeps its reasoning level and headroom", () => {
  // The gateway changes the price, not the model, so the writer must still think.
  const config = resolve("note_write", {}, "gemini-2.5-flash-lite");

  assert.equal(config.thinkingLevel, "high");
  assert.ok(applyOutputHeadroom(2500, config) > 2500);
});

test("the extraction budget is sized from the window, not guessed", () => {
  // A flat 1800 was a number for an average English window. Slovene costs about twice the tokens
  // per word, and one recording in nine walked the entire retry ladder to 5832 and still failed.
  assert.ok(resolveExtractionMaxOutputTokens(400) > 1800);
  assert.equal(resolveExtractionMaxOutputTokens(400), 3600);
  assert.equal(resolveExtractionMaxOutputTokens(260), 2400, "short windows keep a sane floor");
  assert.equal(resolveExtractionMaxOutputTokens(10), 2400);
  // Monotonic: a bigger window never gets a smaller budget.
  assert.ok(resolveExtractionMaxOutputTokens(800) > resolveExtractionMaxOutputTokens(400));
});

test("a window's item count is bounded", () => {
  // Enforced in the prompt and after parsing, never in the schema: maxItems on a nested array
  // pushes Gemini's responseSchema past its complexity limit and the call is rejected outright.
  assert.equal(MAX_ITEMS_PER_EXTRACTION_WINDOW, 30);
  // The small cap on `terms` is long-standing and fine. What Gemini rejected was a second bound
  // on `items` — an array of objects — which pushed the schema past its complexity limit.
  const schema = z.toJSONSchema(knowledgeExtractionSchema);

  assert.equal(
    schema.properties.items.maxItems,
    undefined,
    "bounding items in the schema is what makes Gemini reject the call",
  );
  assert.equal(schema.properties.items.items.properties.terms.maxItems, 4);
});

test("the outline and write stages get a timeout sized for their output, others keep the default", async () => {
  const { resolveStageTimeoutMs } = await import("../src/lib/ai/model-config.ts");

  // The outline reads every extracted item and writes a 30-45k token outline; on 2026-08-25 the
  // shared 90s timeout failed 136 of 236 production outline calls, each retry resending ~150k
  // input tokens. The write call was hitting the gateway's timeout the same way and falling back
  // to the direct provider at double the price.
  assert.equal(resolveStageTimeoutMs("note_outline"), 240_000);
  assert.equal(resolveStageTimeoutMs("note_write"), 240_000);
  assert.equal(resolveStageTimeoutMs("note_extract"), undefined);
  assert.equal(resolveStageTimeoutMs("chat"), undefined);
});

const paragraphsOf = (wordsEach, count) =>
  Array.from({ length: count }, (_, i) => Array(wordsEach).fill(`w${i}`).join(" ")).join("\n\n");

test("a source that fits the window budget is written in one call", () => {
  const windows = planSourceWriteWindows(paragraphsOf(500, 4), 4_500);

  assert.equal(windows.length, 1);
});

test("a large source splits on paragraph boundaries into consecutive parts", () => {
  const source = paragraphsOf(1_000, 7);
  const windows = planSourceWriteWindows(source, 3_000);

  assert.equal(windows.length, 3);
  // Nothing lost, nothing duplicated: the parts joined are the source again.
  assert.equal(windows.join("\n\n"), source);
});

test("assembled parts carry one H1 and one continuous section numbering", () => {
  const assembled = assembleSourceNoteParts([
    "# Naslov\n\n## 1. Prva\n\nvsebina\n\n## 2. Druga\n\nvsebina",
    "# Odvečen naslov\n\n## 1. Tretja\n\nvsebina",
    "## 1. Četrta\n\nvsebina\n\n## 2. Peta\n\nvsebina",
  ]);

  assert.equal((assembled.match(/^#\s+/gm) ?? []).length, 1, "exactly one H1 survives");
  assert.deepEqual(
    (assembled.match(/^##\s+\d+\./gm) ?? []).map((h) => h.trim()),
    ["## 1.", "## 2.", "## 3.", "## 4.", "## 5."],
    "section numbers run continuously across parts",
  );
  assert.match(assembled, /## 3\. Tretja/);
  assert.match(assembled, /## 5\. Peta/);
});

test("the source-note contract assigns the H1 to part one alone", () => {
  const single = buildSourceNoteInstructions({ outputLanguage: "sl" });
  const first = buildSourceNoteInstructions({ outputLanguage: "sl", window: { index: 0, count: 3 } });
  const later = buildSourceNoteInstructions({ outputLanguage: "sl", window: { index: 1, count: 3 } });

  for (const prompt of [single, first, later]) {
    assert.match(prompt, /No emojis/);
    assert.match(prompt, /roughly 60% of the source's word count/);
    assert.match(prompt, /BEGIN REFERENCE EXAMPLE/);
  }

  assert.match(single, /Start immediately with a single "#" H1 title/);
  assert.match(first, /writing part 1/);
  assert.match(later, /Do NOT write an H1 title/);
  assert.doesNotMatch(single, /split into/);
});
