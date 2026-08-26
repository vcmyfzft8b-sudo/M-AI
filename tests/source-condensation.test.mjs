import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCondensationUnits,
  condenseSourceMaterial,
  condenseTranscriptForNotes,
  dropRepeatedBoilerplate,
  enforceChunkSelection,
  MAX_RAW_SOURCE_TEXT_CHARS,
  PIPELINE_SOURCE_TEXT_TARGET_CHARS,
  selectUnitsMechanically,
} from "../src/lib/source-condensation.ts";
import { resolveStageModelConfig, applyOutputHeadroom } from "../src/lib/ai/model-config.ts";

const sentence = (topic, index) =>
  `${topic} fact ${index}: the measured value of parameter ${index} determines the outcome of process ${topic}.`;

function makeParagraphs(count, topic = "alpha") {
  return Array.from({ length: count }, (_, index) => sentence(topic, index)).join("\n\n");
}

const keepEverythingSelector = async (chunk) => ({
  keep: chunk.units.map((_, index) => index),
  droppedNotes: [],
});

test("a source under the target passes through without a single selector call", async () => {
  let calls = 0;
  const text = makeParagraphs(20);
  const result = await condenseSourceMaterial({
    text,
    targetChars: PIPELINE_SOURCE_TEXT_TARGET_CHARS,
    selector: async (chunk) => {
      calls += 1;
      return keepEverythingSelector(chunk);
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.text, text);
  assert.equal(result.meta.condensedChars, text.length);
});

test("an oversized source is compressed under the target even when the model keeps everything", async () => {
  // A selector that ignores the ratio and keeps every unit must not be able to overshoot:
  // enforcement takes units in priority order until the budget is full, never beyond it.
  const text = makeParagraphs(6000);
  const target = 100_000;
  const result = await condenseSourceMaterial({
    text,
    targetChars: target,
    selector: keepEverythingSelector,
  });

  assert.ok(text.length > target, "fixture must actually be oversized");
  assert.ok(result.text.length <= target, `condensed to ${result.text.length}, target ${target}`);
  assert.ok(result.text.length > target * 0.5, "compression should fill most of its budget");
  assert.ok(result.meta.aiChunkCount > 0);
  assert.equal(result.meta.fallbackChunkCount, 0);
});

test("kept units come back in original order regardless of the selector's priority order", async () => {
  const text = makeParagraphs(40, "order");
  const result = await condenseSourceMaterial({
    text,
    targetChars: 1_200,
    selector: async (chunk) => ({
      // Reversed priority: the enforcement must re-sort kept units into document order.
      keep: chunk.units.map((_, index) => index).reverse(),
      droppedNotes: [],
    }),
  });

  const positions = result.text
    .split("\n\n")
    .map((unit) => Number(unit.match(/fact (\d+):/)?.[1]))
    .filter((value) => Number.isFinite(value));

  assert.ok(positions.length > 1);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("a failing selector degrades to mechanical selection instead of failing the source", async () => {
  const text = makeParagraphs(4000);
  const target = 80_000;
  const result = await condenseSourceMaterial({
    text,
    targetChars: target,
    selector: async () => {
      throw new Error("model unavailable");
    },
  });

  assert.ok(result.text.length <= target);
  assert.ok(result.text.length > 0);
  assert.equal(result.meta.aiChunkCount, 0);
  assert.ok(result.meta.fallbackChunkCount > 0);
});

test("mechanical selection keeps units spread through the chunk, not just a prefix", () => {
  const units = Array.from({ length: 100 }, (_, index) => ({
    label: null,
    pageNumber: null,
    text: sentence("spread", index),
  }));
  const charCount = units.reduce((sum, unit) => sum + unit.text.length, 0);
  const kept = selectUnitsMechanically({
    units,
    chunkIndex: 0,
    totalChunks: 1,
    charCount,
    keepBudgetChars: Math.floor(charCount / 4),
  });

  assert.ok(kept.length > 10);
  // Losing the whole tail is the failure mode this guards against.
  assert.ok(kept.some((index) => index > 80), "tail of the chunk must stay represented");
  assert.ok(kept.some((index) => index < 20), "head of the chunk must stay represented");
});

test("an exhausted time budget falls back to mechanical selection immediately", async () => {
  let calls = 0;
  const text = makeParagraphs(4000);
  const result = await condenseSourceMaterial({
    text,
    targetChars: 80_000,
    timeBudgetMs: -1,
    selector: async (chunk) => {
      calls += 1;
      return keepEverythingSelector(chunk);
    },
  });

  assert.equal(calls, 0);
  assert.ok(result.text.length <= 80_000);
  assert.ok(result.text.length > 0);
});

test("repeated page furniture is dropped once it repeats, keeping the first occurrence", () => {
  const content = (index) => ({ label: null, pageNumber: null, text: sentence("content", index) });
  const units = [];

  for (let page = 0; page < 6; page += 1) {
    units.push({ label: null, pageNumber: null, text: "Uvod v biologijo — prof. Novak" });
    // Rows that differ only by their numbers are data, not furniture, and must all survive:
    // normalising digits away here once collapsed table rows and enumerated facts.
    units.push({ label: null, pageNumber: null, text: `Leto 201${page}: rast 4.${page}%` });
    units.push(content(page));
  }

  const { units: kept, removed } = dropRepeatedBoilerplate(units);

  assert.equal(removed, 5);
  assert.equal(kept.filter((unit) => unit.text.startsWith("Uvod v biologijo")).length, 1);
  assert.equal(kept.filter((unit) => unit.text.startsWith("Leto 201")).length, 6);
  assert.equal(kept.filter((unit) => unit.text.includes("content fact")).length, 6);
});

test("structured blocks keep their labels and page numbers through compression", async () => {
  const blocks = Array.from({ length: 400 }, (_, index) => ({
    label: `Chapter ${Math.floor(index / 40) + 1}`,
    pageNumber: index + 1,
    text: sentence("blocks", index),
  }));
  const text = blocks.map((block) => block.text).join("\n\n");
  const result = await condenseSourceMaterial({
    text,
    blocks,
    targetChars: 8_000,
    selector: keepEverythingSelector,
  });

  assert.ok(Array.isArray(result.blocks));
  assert.ok(result.blocks.length > 0);
  assert.ok(result.blocks.every((block) => block.pageNumber != null && block.label));
  assert.ok(result.text.length <= 8_000);
});

test("dropped-content notes are appended, capped and trimmed", () => {
  const units = Array.from({ length: 400 }, (_, index) => ({
    label: null,
    pageNumber: null,
    text: sentence("notes", index),
  }));
  const charCount = units.reduce((sum, unit) => sum + unit.text.length, 0);
  const keepBudgetChars = Math.floor(charCount / 2);
  const chunk = { units, chunkIndex: 0, totalChunks: 1, charCount, keepBudgetChars };
  const notesBudget = Math.floor(keepBudgetChars * 0.05);
  const longNote = "x".repeat(1_000);
  const { keptIndexes, droppedNotes } = enforceChunkSelection(chunk, {
    keep: [0, 1, 2],
    droppedNotes: [longNote, " a fact ", "", ...Array.from({ length: 10 }, (_, i) => `note ${i}`)],
  });

  assert.deepEqual(keptIndexes, [0, 1, 2]);
  assert.ok(droppedNotes.length >= 2, "short valid notes made it in");
  assert.ok(droppedNotes.length <= 6, "capped at 6 per chunk");
  assert.ok(droppedNotes[0].length <= 240, "an over-long note is trimmed, not passed through");
  assert.ok(droppedNotes[0].endsWith("…"));
  assert.equal(droppedNotes[1], "a fact", "whitespace is trimmed and empties are skipped");
  const notesChars = droppedNotes.reduce((sum, note) => sum + note.length + 2, 0);
  assert.ok(notesChars <= notesBudget, "the notes reserve is a hard cap");
});

test("selector indices outside the chunk are ignored, and an empty keep falls back mechanically", () => {
  const units = Array.from({ length: 10 }, (_, index) => ({
    label: null,
    pageNumber: null,
    text: sentence("bounds", index),
  }));
  const charCount = units.reduce((sum, unit) => sum + unit.text.length, 0);
  const chunk = { units, chunkIndex: 0, totalChunks: 1, charCount, keepBudgetChars: charCount };

  const bogus = enforceChunkSelection(chunk, { keep: [99, -3, 4, 4], droppedNotes: [] });
  assert.deepEqual(bogus.keptIndexes, [4], "out-of-range and duplicate indices are discarded");

  const empty = enforceChunkSelection(chunk, { keep: [], droppedNotes: ["irrelevant"] });
  assert.ok(empty.keptIndexes.length > 0, "an empty selection must not produce an empty chunk");
  assert.equal(empty.droppedNotes.length, 0);
});

test("transcript compression keeps original timestamps and only shrinks the note input", async () => {
  const segments = Array.from({ length: 3_000 }, (_, index) => ({
    idx: index,
    startMs: index * 10_000,
    endMs: index * 10_000 + 9_000,
    speakerLabel: index % 2 === 0 ? "Speaker 1" : null,
    text: sentence("audio", index),
  }));
  const totalChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  const target = Math.floor(totalChars / 3);
  const result = await condenseTranscriptForNotes({
    segments,
    targetChars: target,
    selector: async (chunk) => ({
      keep: chunk.units.map((_, index) => index),
      droppedNotes: ["something important was cut"],
    }),
  });

  const condensedChars = result.segments.reduce((sum, segment) => sum + segment.text.length, 0);
  assert.ok(condensedChars <= target * 1.02, `condensed ${condensedChars} vs target ${target}`);

  // idx is renumbered for the reduced list, but the wall-clock timing of kept segments survives
  // so the note writer's section time ranges stay truthful.
  const timed = result.segments.filter((segment) => segment.startMs !== segment.endMs);
  assert.ok(timed.length > 0);
  for (const segment of timed) {
    assert.equal(segment.endMs - segment.startMs, 9_000);
  }
  assert.deepEqual(
    result.segments.map((segment) => segment.idx),
    result.segments.map((_, index) => index),
  );

  const noteSegments = result.segments.filter((segment) => segment.text.startsWith("- something"));
  assert.ok(noteSegments.length > 0, "dropped-content notes ride along as synthetic segments");
});

test("unit building splits an unbroken wall of text instead of returning one giant unit", () => {
  const wall = Array.from({ length: 2_000 }, (_, index) => sentence("wall", index)).join(" ");
  const units = buildCondensationUnits({ text: wall });

  assert.ok(units.length > 100);
  assert.ok(units.every((unit) => unit.text.length <= 700));
});

test("the compression stage resolves like extraction: minimal thinking, no headroom", () => {
  const config = resolveStageModelConfig({
    stage: "source_condense",
    env: {},
    fallbackModel: "gemini-2.5-flash-lite",
  });

  assert.equal(config.model, "gemini-2.5-flash-lite");
  assert.equal(config.thinkingLevel, null, "2.5 cannot think, so no level is sent");
  assert.equal(applyOutputHeadroom(2_000, config), 2_000);

  const overridden = resolveStageModelConfig({
    stage: "source_condense",
    env: { GEMINI_SOURCE_CONDENSE_MODEL: "gemini-3.5-flash-lite" },
    fallbackModel: "gemini-2.5-flash-lite",
  });

  assert.equal(overridden.model, "gemini-3.5-flash-lite");
  assert.equal(overridden.thinkingLevel, "minimal");
});

test("the model never reads more than the spend cap, however large the source", async () => {
  // ~2.6M chars of distinct content. The cap thins it mechanically (free) before any model call,
  // so compression cost plateaus instead of scaling with whatever a user pastes.
  const text = makeParagraphs(28_000, "spend");
  let aiReadChars = 0;
  const result = await condenseSourceMaterial({
    text,
    targetChars: 240_000,
    selector: async (chunk) => {
      aiReadChars += chunk.charCount;
      return { keep: chunk.units.map((_, index) => index), droppedNotes: [] };
    },
  });

  assert.ok(text.length > 2_000_000, "fixture must be far beyond the cap");
  assert.ok(aiReadChars <= 32 * 48_000, `model read ${aiReadChars} chars`);
  assert.equal(result.meta.aiInputChars, aiReadChars);
  assert.ok(result.meta.chunkCount <= 32);
  assert.ok(result.text.length <= 240_000);
  // The mechanical thinning must keep the whole source represented, not just its head.
  const matches = [...result.text.matchAll(/spend fact (\d+):/g)].map((match) => Number(match[1]));
  assert.ok(Math.max(...matches) > 26_000, "tail of the source still represented");
  assert.ok(Math.min(...matches) < 1_000, "head of the source still represented");
});

test("the ceilings that gate compression stay in their measured ratio", () => {
  // The raw ceiling exists so selection cost stays bounded; the target is what one note-generation
  // step reliably processes (note_write timed out at ~235k in staging; ~210k passed). If either
  // moves, re-measure the other instead of scaling blindly.
  assert.equal(PIPELINE_SOURCE_TEXT_TARGET_CHARS, 180_000);
  assert.equal(MAX_RAW_SOURCE_TEXT_CHARS, 4_000_000);
});

test("text with no whitespace at all is still split to the unit cap", () => {
  // CJK prose, a PDF whose extractor lost inter-word spacing, or a pasted base64 blob: both
  // split axes are whitespace-based, so before the hard-slice fallback this arrived as one
  // giant unit that either overshot a chunk budget by 50x or was dropped whole.
  const units = buildCondensationUnits({ text: "x".repeat(5_000) });

  assert.ok(units.length >= 7, `expected the blob sliced into units, got ${units.length}`);

  for (const unit of units) {
    assert.ok(unit.text.length <= 700, `unit of ${unit.text.length} chars escaped the cap`);
  }
});

test("a chunk whose every unit overflows the budget still keeps its first unit", () => {
  // The always-keep-first escape hatch used to be cancelled by the budget conjunct, so a chunk
  // of one oversized unit selected nothing — and downstream an all-empty selection reads as
  // "the source has no content" for a source the user was promised would be compressed.
  const kept = selectUnitsMechanically({
    units: [{ label: null, pageNumber: null, text: "y".repeat(5_000) }],
    charCount: 5_000,
    chunkIndex: 0,
    totalChunks: 1,
    keepBudgetChars: 1_000,
  });

  assert.deepEqual(kept, [0]);
});
