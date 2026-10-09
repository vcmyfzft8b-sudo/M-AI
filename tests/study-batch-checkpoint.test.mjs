import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

/*
 * 2026-10-08 (Sentry 152378828): a deck's only batch came back with no cards, the empty result was
 * checkpointed, and both the skip retry and the Inngest step retry read that empty result back
 * instead of asking again — "Flashcard generation produced no usable cards." on every attempt.
 */
function loadStudyItems({ store, answers }) {
  const calls = { generate: 0 };
  const modules = {
    "server-only": {},
    zod: { z },
    "@/lib/abort-context": { isWorkAbortedError: () => false },
    "@/lib/database-text": { truncateForDatabase: (text) => text },
    "@/lib/ai/json": {
      generateStructuredObject: async () => {
        calls.generate += 1;
        return answers.shift() ?? { flashcards: [], skippedItemIds: [] };
      },
    },
    "@/lib/notes/note-prompts": {},
    "@/lib/notes/study-item-mapping": {
      cardKindForItem: () => "concept",
      itemConceptKey: (item) => `item-${item.id}`,
    },
    "@/lib/notes/study-dedupe": { dedupeCardDraftsByContent: (drafts) => drafts },
    // Same contract as the real checkpoint: a cached payload is used only if the schema accepts it.
    "@/lib/notes/generation-cache": {
      generationCacheKey: (parts) => JSON.stringify(parts),
      stageModelCacheKeyPart: () => "model",
      withGenerationCheckpoint: async ({ cacheKey, schema, generate }) => {
        const cached = schema.safeParse(store.get(cacheKey));
        if (cached.success) return cached.data;
        const value = await generate();
        store.set(cacheKey, value);
        return value;
      },
    },
    "@/lib/notes/study-prompts": {
      buildFlashcardInstructions: () => "instructions",
      chunkStudyItems: (items) => [items],
      formatItemsForStudyGeneration: (items) => items,
    },
    "@/lib/practice-test-scoring": {},
    "@/lib/study-quality": {},
  };
  const context = { exports: {}, require: (name) => modules[name], console };
  const source = fs.readFileSync(new URL("../src/lib/study-items.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { calls, generateItemCardDrafts: context.exports.generateItemCardDrafts };
}

const items = [{ id: 0, claim: "Synthetic claim", primaryUnitIdx: 0, importance: 2 }];
const units = [{ unitIndex: 0, text: "Synthetic unit", startMs: 0, endMs: 0, sourceType: "text" }];
const card = { itemId: 0, front: "Synthetic front", back: "Synthetic back", difficulty: "easy" };
const run = (h) => h.generateItemCardDrafts({ items, units, usageContext: { lectureId: "synthetic-lecture" } });

test("a batch that came back empty is asked again by the skip retry", async () => {
  const h = loadStudyItems({ store: new Map(), answers: [{ flashcards: [], skippedItemIds: [0] }, { flashcards: [card], skippedItemIds: [] }] });
  const { drafts, uncoveredItemIds } = await run(h);
  assert.equal(h.calls.generate, 2);
  assert.equal(drafts.length, 1);
  assert.deepEqual([...uncoveredItemIds], []);
});

test("an empty checkpoint left by an earlier attempt does not answer a step retry", async () => {
  const store = new Map();
  await run(loadStudyItems({ store, answers: [] }));
  const retry = loadStudyItems({ store, answers: [{ flashcards: [card], skippedItemIds: [] }] });
  const { drafts } = await run(retry);
  assert.equal(retry.calls.generate, 1);
  assert.equal(drafts.length, 1);
});

test("a batch that covered its items is still read back without a second model call", async () => {
  const store = new Map();
  await run(loadStudyItems({ store, answers: [{ flashcards: [card], skippedItemIds: [] }] }));
  const replay = loadStudyItems({ store, answers: [] });
  const { drafts } = await run(replay);
  assert.equal(replay.calls.generate, 0);
  assert.equal(drafts.length, 1);
});
