import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOutputHeadroom,
  GLM_TEXT_MODEL,
  isLanguageCheckEnabled,
  LANGUAGE_CHECK_MODEL,
  TUTOR_VOICE_MODEL,
  writerNeedsLanguageCheck,
  resolveStageFallbackModel,
  resolveStageFallbackReserveMs,
  resolveStageModelConfig,
  resolveStageTimeoutMs,
  resolveWireReasoningEffort,
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

test("a failed GLM call falls back to the pre-switch Gemini, routed through the same gateway", () => {
  // One gateway, one bill (2026-08-29): the fallback Gemini rides OpenRouter like the primary.
  // json.ts strips these ids to their bare form for the last tier, bought direct from Google,
  // which exists because a fallback that shares the primary's gateway shares its outages.
  assert.equal(resolveStageFallbackModel("note_write"), "or/google/gemini-3.7-flash");
  assert.equal(resolveStageFallbackModel("note_extract"), null);
  assert.equal(resolveStageFallbackModel("note_outline"), null);
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

test("pooled GLM stages reserve a full structured fallback window", () => {
  assert.equal(resolveStageFallbackReserveMs("study_items", GLM_TEXT_MODEL), 90_000);
  assert.equal(resolveStageFallbackReserveMs("coverage_plan", GLM_TEXT_MODEL), 90_000);
  assert.equal(resolveStageFallbackReserveMs("note_outline", GLM_TEXT_MODEL), 0);
  assert.equal(resolveStageFallbackReserveMs("study_items", "gemini-3.7-flash"), 0);
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

test("no assembled part keeps an H1, and section numbering runs continuously", () => {
  // The app displays the note's title above the note, so an H1 in the body doubled it.
  const assembled = assembleSourceNoteParts([
    "# Odvečen naslov\n\n## 1. Prva\n\nvsebina\n\n## 2. Druga\n\nvsebina",
    "# Še en naslov\n\n## 1. Tretja\n\nvsebina",
    "## 1. Četrta\n\nvsebina\n\n## 2. Peta\n\nvsebina",
  ]);

  assert.equal((assembled.match(/^#\s[^#]/gm) ?? []).length, 0, "no H1 survives assembly");
  assert.deepEqual(
    (assembled.match(/^##\s+\d+\./gm) ?? []).map((h) => h.trim()),
    ["## 1.", "## 2.", "## 3.", "## 4.", "## 5."],
    "section numbers run continuously across parts",
  );
  assert.match(assembled, /## 3\. Tretja/);
  assert.match(assembled, /## 5\. Peta/);
});

test("the source-note contract forbids the H1 everywhere", () => {
  const single = buildSourceNoteInstructions({ outputLanguage: "sl" });
  const first = buildSourceNoteInstructions({ outputLanguage: "sl", window: { index: 0, count: 3 } });
  const later = buildSourceNoteInstructions({ outputLanguage: "sl", window: { index: 1, count: 3 } });

  for (const prompt of [single, first, later]) {
    assert.match(prompt, /No emojis/);
    assert.match(prompt, /roughly 60% of the source's word count/);
    assert.match(prompt, /BEGIN REFERENCE EXAMPLE/);
    assert.match(prompt, /Do NOT write an H1 title/);
  }

  assert.match(first, /writing part 1/);
  assert.doesNotMatch(single, /split into/);
});

test("callout labels match exactly what the renderer colours", () => {
  // note-tts-text.ts getCalloutKind matches these bold label prefixes; a label that drifts even
  // slightly falls back to the plain blue box, so the contract and the renderer are pinned to
  // each other here.
  const sl = buildSourceNoteInstructions({ outputLanguage: "sl" });
  const en = buildSourceNoteInstructions({ outputLanguage: "en" });

  for (const label of ["Definicija", "Pogosta napaka", "Ključno"]) {
    assert.match(sl, new RegExp(`> \\*\\*${label}:\\*\\*`));
  }

  for (const label of ["Definition", "Common mistake", "Key takeaway"]) {
    assert.match(en, new RegExp(`> \\*\\*${label}:\\*\\*`));
  }

  // Windowed parts get a per-part budget so joined parts cannot stack up a wall of boxes.
  assert.match(buildSourceNoteInstructions({ window: { index: 1, count: 3 } }), /at most 2 callouts in this part/);
  assert.match(en, /at most 4 callouts in the whole note/);
});

test("the language check does not run on the model whose language it is checking", () => {
  // The whole point of the stage. A checker sharing GLM's weakness would be an expensive no-op,
  // so this is the one stage that must never inherit the shared default.
  const config = resolve("language_check", {});

  assert.equal(config.model, LANGUAGE_CHECK_MODEL);
  assert.notEqual(config.model, GLM_TEXT_MODEL);
  // Latency-sorted for the same reason the tutor stage is: on the spoken path this call sits
  // between the learner and the first sound.
  assert.equal(config.providerSort, "latency");
});

test("an operator can move the language check to another model without a deploy", () => {
  assert.equal(
    resolve("language_check", { GEMINI_LANGUAGE_CHECK_MODEL: "gemini-2.5-flash" }).model,
    "gemini-2.5-flash",
  );
});

test("the language check reasons at no level, because reasoning here is pure latency", () => {
  assert.equal(resolve("language_check", {}).thinkingLevel, "minimal");
  assert.equal(applyOutputHeadroom(600, resolve("language_check", {})), 600);
});

test("the language check is on unless it is explicitly turned off", () => {
  assert.equal(isLanguageCheckEnabled({}), true);
  assert.equal(isLanguageCheckEnabled({ LANGUAGE_CHECK: "on" }), true);
  assert.equal(isLanguageCheckEnabled({ LANGUAGE_CHECK: "" }), true);

  // Spelled the obvious ways, because whoever reaches for this will be in a hurry.
  for (const value of ["off", "OFF", " off ", "0", "false", "disabled"]) {
    assert.equal(isLanguageCheckEnabled({ LANGUAGE_CHECK: value }), false, value);
  }
});

test("the tutor runs on two models, because its halves are judged on different things", () => {
  // The plan decides which topics exist and is marked on coverage: GLM covered 23 of 23 key facts
  // where the turn writer covered 9. The turns are judged on prose and latency, where that is
  // reversed. Collapsing these back into one stage loses whichever half it is not chosen for.
  assert.equal(resolve("tutor_plan", {}).model, GLM_TEXT_MODEL);
  assert.equal(resolve("tutor_turn", {}).model, TUTOR_VOICE_MODEL);
  assert.notEqual(resolve("tutor_plan", {}).model, resolve("tutor_turn", {}).model);
});

test("the plan is not held to the spoken turn's leash", () => {
  // Sharing it aborted GLM on five runs in six (measured 19-51s) and taught the session from a
  // fallback plan covering half the material.
  const planMs = resolveStageTimeoutMs("tutor_plan", GLM_TEXT_MODEL);
  const turnMs = resolveStageTimeoutMs("tutor_turn", TUTOR_VOICE_MODEL);

  assert.ok(planMs >= 90_000, `plan timeout ${planMs} must clear the measured 51s tail`);
  assert.ok(planMs > turnMs);
  // Both tiers plus a fallback still have to fit the route's 300s invocation.
  assert.ok(planMs < 300_000);
});

test("both tutor stages sort hosts for latency, not throughput", () => {
  assert.equal(resolve("tutor_plan", {}).providerSort, "latency");
  assert.equal(resolve("tutor_turn", {}).providerSort, "latency");
});

test("either tutor stage can be moved without a deploy", () => {
  assert.equal(resolve("tutor_plan", { GEMINI_TUTOR_PLAN_MODEL: "gemini-2.5-flash" }).model, "gemini-2.5-flash");
  assert.equal(resolve("tutor_turn", { GEMINI_TUTOR_TURN_MODEL: GLM_TEXT_MODEL }).model, GLM_TEXT_MODEL);
});

test("the language check follows the writer rather than a second setting", () => {
  // Rolling the turn writer back to GLM must bring its checker back in the same breath, and
  // nobody should be able to end up on the fast writer with the slow safety net still attached.
  assert.equal(writerNeedsLanguageCheck(GLM_TEXT_MODEL), true);
  assert.equal(writerNeedsLanguageCheck("glm-5.3-flash"), true);
  assert.equal(writerNeedsLanguageCheck(TUTOR_VOICE_MODEL), false);
  assert.equal(writerNeedsLanguageCheck("gemini-2.5-flash-lite"), false);
  assert.equal(writerNeedsLanguageCheck("or/google/gemini-3.7-flash"), false);
});
