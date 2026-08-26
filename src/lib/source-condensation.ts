// Kept free of "server-only" and of any AI client so the whole compression contract stays
// unit-testable (tests/source-condensation.test.mjs). The model call is injected as a selector;
// everything that decides how much text survives is deterministic code in this file.

// Relative import on purpose: tests/source-condensation.test.mjs loads this file under plain
// Node (--experimental-strip-types), which does not resolve the "@/" path alias.
import { isWorkAbortedError } from "./abort-context.ts";
import type { StructuredSourceBlock } from "@/lib/text-source-processing";
import type { TranscriptSegmentInput } from "@/lib/types";

/**
 * How much source text the note pipeline reliably takes through extract → outline → write. The
 * old 240k rejection threshold was never a measured capacity: staging runs on 2026-08-24 showed
 * note_write timing out (90 s/attempt) at ~235k chars while ~210k passed, so the target sits at
 * 180k with margin. This is a compression target, not a wall — larger sources are condensed to
 * it, never rejected — and it also caps what a long audio transcript hands the note writer.
 */
export const PIPELINE_SOURCE_TEXT_TARGET_CHARS = 180_000;

/**
 * The ceiling on raw extracted text we are willing to compress at all. 4M characters covers the
 * entire 4 MB document upload cap and any pasted text that fits under Vercel's ~4.5 MB request
 * body limit, so in practice everything that clears the byte-level gates can be compressed rather
 * than rejected. Selection cost scales with input reading, not output writing, which is what
 * makes a ceiling this high affordable inside a request or step budget.
 */
export const MAX_RAW_SOURCE_TEXT_CHARS = 4_000_000;

/**
 * Selection reads a chunk and writes only unit numbers, so chunks can be much larger than the
 * extraction windows used for note generation. Bigger chunks mean fewer calls and give the model
 * enough context to tell filler from substance.
 */
const CONDENSATION_CHUNK_MAX_CHARS = 48_000;
/**
 * Hard ceiling on model spend per source: at most this much text is ever shown to the selector
 * (~32 calls). A source beyond it — several full books pasted at once — is first reduced to this
 * size mechanically, for free, before the model chooses what survives. Costs therefore plateau
 * at roughly a cent per lecture for compression no matter what a user pastes, while the
 * note-generation stages are already bounded by the pipeline target.
 */
const MAX_AI_SELECTION_INPUT_CHARS = 32 * CONDENSATION_CHUNK_MAX_CHARS;
/** Units around a paragraph in size keep selection fine-grained without ballooning the numbering. */
const CONDENSATION_UNIT_MAX_CHARS = 700;
const CONDENSATION_CONCURRENCY = 6;
/**
 * The whole point of dropped-content notes is that they are cheap; the caps keep a chunk's notes
 * from competing with the kept text for the budget. Enforced here, never in the wire schema —
 * array bounds on Gemini responseSchemas push past the complexity limit and reject the call.
 */
const MAX_DROPPED_NOTES_PER_CHUNK = 6;
const DROPPED_NOTE_MAX_CHARS = 240;
/** Share of each chunk's budget reserved for the dropped-content notes appended after it. */
const DROPPED_NOTES_BUDGET_SHARE = 0.05;
/**
 * A short line repeated this often across a document is page furniture (headers, footers, page
 * numbers, slide branding), not content. Repeated long passages are left alone: a definition a
 * lecturer restates is signal, and the dedupe downstream already handles it.
 */
const BOILERPLATE_MIN_REPEATS = 3;
const BOILERPLATE_MAX_UNIT_CHARS = 200;
/** Cost of the "\n\n" between rendered units, charged to the budget alongside the text itself. */
const UNIT_JOINER_COST = 2;
/**
 * Compression must never be the thing that kills a lecture. When the time budget runs out, the
 * remaining chunks fall back to mechanical selection instead of waiting on the model.
 *
 * Sized to leave room for its neighbours rather than to what selection might use: a document
 * import spends the same 300 s invocation on text extraction and on describing images (60 s of
 * its own), and a stage that is silently killed by the platform leaves the lecture stuck on a
 * spinner forever. Measured, this is generous — 3.2 M characters across 67 chunks condensed in
 * about 28 s, and the chunk count is capped at 32.
 */
const DEFAULT_TIME_BUDGET_MS = 90_000;

export type CondensationUnit = {
  label: string | null;
  pageNumber: number | null;
  text: string;
};

export type CondensationChunk = {
  /** Units of this chunk; selector indices are local to this array. */
  units: CondensationUnit[];
  chunkIndex: number;
  totalChunks: number;
  charCount: number;
  keepBudgetChars: number;
};

export type ChunkSelection = {
  /** Unit indices ordered most → least important. */
  keep: number[];
  /** Short standalone facts from units that were not kept. */
  droppedNotes: string[];
};

export type ChunkSelector = (chunk: CondensationChunk) => Promise<ChunkSelection>;

export type CondensationMeta = {
  method: "selection";
  originalChars: number;
  /** How much text the model actually read; smaller than originalChars once the spend cap bites. */
  aiInputChars: number;
  condensedChars: number;
  unitCount: number;
  keptUnitCount: number;
  chunkCount: number;
  aiChunkCount: number;
  fallbackChunkCount: number;
  boilerplateUnitsRemoved: number;
};

export type CondensationResult = {
  text: string;
  blocks: StructuredSourceBlock[] | null;
  meta: CondensationMeta;
};

function splitLongUnitText(text: string, maxChars: number): string[] {
  const normalized = text.trim();

  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const parts = sentences.length > 1 ? sentences : normalized.split(/\s+/).filter(Boolean);
  const joiner = " ";
  const chunks: string[] = [];
  let active = "";

  for (const part of parts) {
    // Both split axes are whitespace-based, so text with no ASCII whitespace at all — CJK prose,
    // a PDF page whose extractor lost inter-word spacing, a pasted base64 blob — arrives as one
    // giant part. Hard-slice it: an arbitrary cut point still beats a unit the size limit was
    // supposed to forbid, which downstream either overshoots a chunk budget by 50x or is dropped
    // whole.
    if (part.length > maxChars) {
      if (active) {
        chunks.push(active);
        active = "";
      }

      for (let start = 0; start < part.length; start += maxChars) {
        const slice = part.slice(start, start + maxChars);

        if (slice.length === maxChars) {
          chunks.push(slice);
        } else {
          active = slice;
        }
      }

      continue;
    }

    const next = active ? `${active}${joiner}${part}` : part;

    if (next.length > maxChars && active) {
      chunks.push(active);
      active = part;
      continue;
    }

    active = next;
  }

  if (active) {
    chunks.push(active);
  }

  return chunks;
}

export function buildCondensationUnits(params: {
  text: string;
  blocks?: StructuredSourceBlock[] | null;
}): CondensationUnit[] {
  if (params.blocks?.length) {
    return params.blocks.flatMap((block) =>
      splitLongUnitText(block.text, CONDENSATION_UNIT_MAX_CHARS).map((chunk) => ({
        label: block.label?.trim() || null,
        pageNumber: block.pageNumber ?? null,
        text: chunk,
      })),
    );
  }

  return params.text
    .split(/\n{2,}|\f+/)
    .flatMap((paragraph) => splitLongUnitText(paragraph, CONDENSATION_UNIT_MAX_CHARS))
    .map((chunk) => ({ label: null, pageNumber: null, text: chunk }));
}

// Exact repeats only (modulo case and whitespace): normalising digits away would also collapse
// table rows and enumerated facts that differ only by their numbers, which is content, not
// furniture. A per-page counter footer therefore survives — the price of never eating data.
function normalizeForRepeatDetection(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Drops repeats of short lines that occur over and over — the per-page furniture PDF and slide
 * exports leave behind. The first occurrence always survives, so a document whose header carries
 * real information still states it once.
 */
export function dropRepeatedBoilerplate(units: CondensationUnit[]): {
  units: CondensationUnit[];
  removed: number;
} {
  const counts = new Map<string, number>();

  for (const unit of units) {
    if (unit.text.length > BOILERPLATE_MAX_UNIT_CHARS) {
      continue;
    }

    const key = normalizeForRepeatDetection(unit.text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const kept: CondensationUnit[] = [];
  let removed = 0;

  for (const unit of units) {
    if (unit.text.length > BOILERPLATE_MAX_UNIT_CHARS) {
      kept.push(unit);
      continue;
    }

    const key = normalizeForRepeatDetection(unit.text);

    if ((counts.get(key) ?? 0) >= BOILERPLATE_MIN_REPEATS && seen.has(key)) {
      removed += 1;
      continue;
    }

    seen.add(key);
    kept.push(unit);
  }

  return { units: kept, removed };
}

function chunkUnits(units: CondensationUnit[], targetChars: number): CondensationChunk[] {
  const totalChars = units.reduce((sum, unit) => sum + unit.text.length, 0);
  const chunks: Array<{ units: CondensationUnit[]; charCount: number }> = [];
  let active: { units: CondensationUnit[]; charCount: number } = { units: [], charCount: 0 };

  for (const unit of units) {
    if (active.units.length > 0 && active.charCount + unit.text.length > CONDENSATION_CHUNK_MAX_CHARS) {
      chunks.push(active);
      active = { units: [], charCount: 0 };
    }

    active.units.push(unit);
    active.charCount += unit.text.length;
  }

  if (active.units.length > 0) {
    chunks.push(active);
  }

  return chunks.map((chunk, index) => ({
    units: chunk.units,
    chunkIndex: index,
    totalChunks: chunks.length,
    charCount: chunk.charCount,
    // Proportional allocation: every chunk keeps the same share of itself, so the compressed
    // source preserves the original's shape instead of front-loading the budget.
    keepBudgetChars: Math.max(1_000, Math.floor((targetChars * chunk.charCount) / Math.max(totalChars, 1))),
  }));
}

/**
 * Model-free selection used whenever the model cannot answer (failure, nonsense output, or an
 * exhausted time budget): keeps units spread evenly through the chunk so every part of the source
 * stays represented, instead of keeping a prefix and losing the whole tail.
 */
export function selectUnitsMechanically(chunk: CondensationChunk): number[] {
  const ratio = Math.min(1, chunk.keepBudgetChars / Math.max(chunk.charCount, 1));
  const kept: number[] = [];
  let keptChars = 0;
  let scannedChars = 0;

  for (let index = 0; index < chunk.units.length; index += 1) {
    // The two-character paragraph joiner is part of what the budget pays for; without it a
    // thousand kept units quietly overshoot the target by two thousand characters.
    const cost = chunk.units[index].text.length + UNIT_JOINER_COST;
    scannedChars += cost;

    if (
      (index === 0 || keptChars + cost <= ratio * scannedChars) &&
      keptChars + cost <= chunk.keepBudgetChars
    ) {
      kept.push(index);
      keptChars += cost;
    }
  }

  // The escape hatch above only defeats the ratio test, so a chunk whose every unit overflows
  // the budget (one giant unsplittable unit) would select nothing — and downstream that reads as
  // "the source has no content". A truncated first unit always beats an empty chunk.
  if (kept.length === 0 && chunk.units.length > 0) {
    return [0];
  }

  return kept;
}

/**
 * Turns whatever the selector returned into a kept set that fits the chunk budget. Indices are
 * taken in the selector's priority order until the budget is full, then rendered in original
 * order — so an over-eager selection degrades to "the most important part fits" rather than
 * overshooting the target.
 */
export function enforceChunkSelection(
  chunk: CondensationChunk,
  selection: ChunkSelection,
): { keptIndexes: number[]; droppedNotes: string[] } {
  const seen = new Set<number>();
  const prioritized: number[] = [];

  for (const value of selection.keep) {
    const index = Math.trunc(value);

    if (index >= 0 && index < chunk.units.length && !seen.has(index)) {
      seen.add(index);
      prioritized.push(index);
    }
  }

  if (prioritized.length === 0) {
    return { keptIndexes: selectUnitsMechanically(chunk), droppedNotes: [] };
  }

  const notesBudget = Math.floor(chunk.keepBudgetChars * DROPPED_NOTES_BUDGET_SHARE);
  const unitBudget = chunk.keepBudgetChars - notesBudget;
  const kept: number[] = [];
  let keptChars = 0;

  for (const index of prioritized) {
    const cost = chunk.units[index].text.length + UNIT_JOINER_COST;

    if (kept.length > 0 && keptChars + cost > unitBudget) {
      continue;
    }

    kept.push(index);
    keptChars += cost;
  }

  const keptSet = new Set(kept);
  const anythingDropped = kept.length < chunk.units.length;
  const droppedNotes: string[] = [];

  if (anythingDropped) {
    let notesChars = 0;

    for (const raw of selection.droppedNotes) {
      const trimmed = raw.trim();

      if (!trimmed || droppedNotes.length >= MAX_DROPPED_NOTES_PER_CHUNK) {
        continue;
      }

      const note =
        trimmed.length > DROPPED_NOTE_MAX_CHARS
          ? `${trimmed.slice(0, DROPPED_NOTE_MAX_CHARS - 1)}…`
          : trimmed;

      // The notes reserve is a hard cap, not a hint: on a small chunk budget six full-length
      // notes would otherwise spend more characters than the kept text they stand in for.
      if (notesChars + note.length + UNIT_JOINER_COST > notesBudget) {
        continue;
      }

      droppedNotes.push(note);
      notesChars += note.length + UNIT_JOINER_COST;
    }
  }

  return {
    keptIndexes: chunk.units.map((_, index) => index).filter((index) => keptSet.has(index)),
    droppedNotes,
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  handler: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  });

  await Promise.all(workers);

  return results;
}

/**
 * The free half of the spend cap: an absurdly large source is thinned to the AI-selection ceiling
 * by the same evenly-spread mechanical rule the fallbacks use, so the model never reads more than
 * the ceiling and every part of the source still has a representative in what it reads.
 */
function capUnitsForAiSelection(units: CondensationUnit[]): CondensationUnit[] {
  const totalChars = units.reduce((sum, unit) => sum + unit.text.length, 0);

  if (totalChars <= MAX_AI_SELECTION_INPUT_CHARS) {
    return units;
  }

  const keptIndexes = selectUnitsMechanically({
    units,
    chunkIndex: 0,
    totalChunks: 1,
    charCount: totalChars,
    keepBudgetChars: MAX_AI_SELECTION_INPUT_CHARS,
  });

  return keptIndexes.map((index) => units[index]);
}

type SelectedChunk = {
  chunk: CondensationChunk;
  keptIndexes: number[];
  droppedNotes: string[];
  usedAi: boolean;
};

async function selectChunk(
  chunk: CondensationChunk,
  selector: ChunkSelector,
  deadlineAt: number,
): Promise<SelectedChunk> {
  if (chunk.charCount <= chunk.keepBudgetChars) {
    return {
      chunk,
      keptIndexes: chunk.units.map((_, index) => index),
      droppedNotes: [],
      usedAi: false,
    };
  }

  if (Date.now() < deadlineAt) {
    try {
      const selection = await selector(chunk);
      const enforced = enforceChunkSelection(chunk, selection);

      return { chunk, ...enforced, usedAi: true };
    } catch (error) {
      // A budget abort is the invocation being cancelled, not a selector failure to degrade
      // around — swallowing it would let the dying run finish condensation mechanically and
      // wander on into note generation as a zombie.
      if (isWorkAbortedError(error)) {
        throw error;
      }

      // The selector's own retries are exhausted by the time we see the failure; compression
      // degrades to mechanical selection rather than failing the lecture.
    }
  }

  return { chunk, keptIndexes: selectUnitsMechanically(chunk), droppedNotes: [], usedAi: false };
}

function renderCondensedUnits(selected: SelectedChunk[]): CondensationUnit[] {
  const units: CondensationUnit[] = [];

  for (const { chunk, keptIndexes, droppedNotes } of selected) {
    for (const index of keptIndexes) {
      units.push(chunk.units[index]);
    }

    if (droppedNotes.length > 0) {
      units.push({
        label: null,
        pageNumber: null,
        text: droppedNotes.map((note) => `- ${note}`).join("\n"),
      });
    }
  }

  return units;
}

/**
 * Compresses extracted source text down to `targetChars` by keeping the most instructive units
 * verbatim and replacing the rest with at most a few short notes per chunk. Returns the condensed
 * text plus, when the input carried structured blocks, condensed blocks with their page numbers
 * and labels intact.
 */
export async function condenseSourceMaterial(params: {
  text: string;
  blocks?: StructuredSourceBlock[] | null;
  targetChars: number;
  selector: ChunkSelector;
  timeBudgetMs?: number;
  concurrency?: number;
}): Promise<CondensationResult> {
  const hadBlocks = Boolean(params.blocks?.length);
  const rawUnits = buildCondensationUnits({ text: params.text, blocks: params.blocks });
  const { units: dedupedUnits, removed } = dropRepeatedBoilerplate(rawUnits);
  const originalChars = params.text.length;
  const deadlineAt = Date.now() + (params.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  const units = capUnitsForAiSelection(dedupedUnits);
  const totalUnitChars = units.reduce((sum, unit) => sum + unit.text.length, 0);
  // The "\n\n" joiners are charged in the fits-already test exactly as at every other budget
  // site: without them a source a hair under target renders a hair over it, and the caller's
  // slice then cuts mid-word and discards all block structure over a few hundred characters.
  const renderedChars = totalUnitChars + units.length * UNIT_JOINER_COST;
  const chunks = chunkUnits(units, params.targetChars);

  const selected =
    renderedChars <= params.targetChars
      ? chunks.map((chunk) => ({
          chunk,
          keptIndexes: chunk.units.map((_, index) => index),
          droppedNotes: [],
          usedAi: false,
        }))
      : await mapWithConcurrency(
          chunks,
          params.concurrency ?? CONDENSATION_CONCURRENCY,
          (chunk) => selectChunk(chunk, params.selector, deadlineAt),
        );

  const condensedUnits = renderCondensedUnits(selected);
  const text = condensedUnits.map((unit) => unit.text).join("\n\n");
  const blocks = hadBlocks
    ? condensedUnits.map((unit) => ({
        label: unit.label,
        pageNumber: unit.pageNumber,
        text: unit.text,
      }))
    : null;

  return {
    text,
    blocks,
    meta: {
      method: "selection",
      originalChars,
      aiInputChars: totalUnitChars,
      condensedChars: text.length,
      unitCount: units.length,
      keptUnitCount: condensedUnits.length,
      chunkCount: chunks.length,
      aiChunkCount: selected.filter((entry) => entry.usedAi).length,
      fallbackChunkCount: selected.filter(
        (entry) => !entry.usedAi && entry.chunk.charCount > entry.chunk.keepBudgetChars,
      ).length,
      boilerplateUnitsRemoved: removed,
    },
  };
}

export type TranscriptCondensationResult = {
  segments: TranscriptSegmentInput[];
  meta: CondensationMeta;
};

/**
 * The transcript variant used for audio: real transcripts never pass through the text-source
 * funnel, so an unusually dense recording can exceed what note generation handles in one step.
 * Only the note-generation input shrinks — the stored transcript, embeddings, chat and study
 * features keep the full text.
 */
export async function condenseTranscriptForNotes(params: {
  segments: TranscriptSegmentInput[];
  targetChars: number;
  selector: ChunkSelector;
  timeBudgetMs?: number;
  concurrency?: number;
}): Promise<TranscriptCondensationResult> {
  const totalChars = params.segments.reduce((sum, segment) => sum + segment.text.length, 0);
  const deadlineAt = Date.now() + (params.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  // Segments map 1:1 onto units so kept indices translate straight back to segments, keeping
  // their original timestamps for the section timing the note writer reports.
  const units: CondensationUnit[] = params.segments.map((segment) => ({
    label: segment.speakerLabel,
    pageNumber: null,
    text: segment.text,
  }));
  const chunks = chunkUnits(units, params.targetChars);

  // Chunk indices are global here because chunkUnits never splits a unit, so each chunk's units
  // are a contiguous slice of the segment list.
  let offset = 0;
  const chunkOffsets = chunks.map((chunk) => {
    const start = offset;
    offset += chunk.units.length;
    return start;
  });

  const selected = await mapWithConcurrency(
    chunks,
    params.concurrency ?? CONDENSATION_CONCURRENCY,
    (chunk) => selectChunk(chunk, params.selector, deadlineAt),
  );

  const segments: TranscriptSegmentInput[] = [];

  selected.forEach((entry, chunkIndex) => {
    const base = chunkOffsets[chunkIndex];
    let lastKept: TranscriptSegmentInput | null = null;

    for (const index of entry.keptIndexes) {
      const segment = params.segments[base + index];
      segments.push({ ...segment, idx: segments.length });
      lastKept = segment;
    }

    if (entry.droppedNotes.length > 0 && lastKept) {
      segments.push({
        idx: segments.length,
        startMs: lastKept.endMs,
        endMs: lastKept.endMs,
        speakerLabel: null,
        text: entry.droppedNotes.map((note) => `- ${note}`).join("\n"),
      });
    }
  });

  const condensedChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);

  return {
    segments,
    meta: {
      method: "selection",
      originalChars: totalChars,
      aiInputChars: totalChars,
      condensedChars,
      unitCount: units.length,
      keptUnitCount: segments.length,
      chunkCount: chunks.length,
      aiChunkCount: selected.filter((entry) => entry.usedAi).length,
      fallbackChunkCount: selected.filter(
        (entry) => !entry.usedAi && entry.chunk.charCount > entry.chunk.keepBudgetChars,
      ).length,
      boilerplateUnitsRemoved: 0,
    },
  };
}
