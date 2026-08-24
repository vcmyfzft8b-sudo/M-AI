import "server-only";

import type { Citation } from "@/lib/database.types";
import { countWords } from "@/lib/generation/util";

export type GenerationSegment = {
  idx: number;
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  text: string;
};

/**
 * A source unit is a contiguous run of transcript segments sized for anchoring: big enough that
 * the model can reason about it, small enough that "this fact lives in unit 12" is a usable
 * citation. Units are the shared coordinate system across notes, flashcards, quizzes, and tests.
 */
export type SourceUnit = {
  unitId: number;
  segStartIdx: number;
  segEndIdx: number;
  startMs: number;
  endMs: number;
  text: string;
  wordCount: number;
  locatorLabel: string;
};

export type SourceDocument = {
  units: SourceUnit[];
  totalWords: number;
  isAudio: boolean;
  segments: GenerationSegment[];
};

const TARGET_UNIT_WORDS = 180;
const MAX_UNIT_WORDS = 320;

function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

export function buildSourceDocument(
  segments: GenerationSegment[],
  sourceType: "audio" | "document",
): SourceDocument {
  const isAudio = sourceType === "audio";
  const units: SourceUnit[] = [];
  let current: GenerationSegment[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    const unitId = units.length;
    const first = current[0];
    const last = current[current.length - 1];
    const text = current
      .map((segment) => segment.text.trim())
      .filter((value) => value.length > 0)
      .join("\n");

    units.push({
      unitId,
      segStartIdx: first.idx,
      segEndIdx: last.idx,
      startMs: first.startMs,
      endMs: last.endMs,
      text,
      wordCount: countWords(text),
      locatorLabel: isAudio
        ? `${formatTimestamp(first.startMs)}–${formatTimestamp(last.endMs)}`
        : `§${unitId + 1}`,
    });
    current = [];
    currentWords = 0;
  };

  for (const segment of segments) {
    const segmentWords = countWords(segment.text);

    if (currentWords > 0 && currentWords + segmentWords > MAX_UNIT_WORDS) {
      flush();
    }

    current.push(segment);
    currentWords += segmentWords;

    if (currentWords >= TARGET_UNIT_WORDS) {
      flush();
    }
  }

  flush();

  return {
    units,
    totalWords: units.reduce((total, unit) => total + unit.wordCount, 0),
    isAudio,
    segments,
  };
}

/** Renders units as model input, each prefixed with a stable `[U<n>]` tag the model cites back. */
export function renderUnitsForModel(units: SourceUnit[]) {
  return units.map((unit) => `[U${unit.unitId}] ${unit.text}`).join("\n\n");
}

/**
 * Groups units into windows of at most `maxWords`, for pipelines that fan out one model call
 * per window. Windows never split a unit.
 */
export function buildUnitWindows(units: SourceUnit[], maxWords: number) {
  const windows: SourceUnit[][] = [];
  let current: SourceUnit[] = [];
  let currentWords = 0;

  for (const unit of units) {
    if (current.length > 0 && currentWords + unit.wordCount > maxWords) {
      windows.push(current);
      current = [];
      currentWords = 0;
    }

    current.push(unit);
    currentWords += unit.wordCount;
  }

  if (current.length > 0) {
    windows.push(current);
  }

  return windows;
}

const CITATION_QUOTE_MAX_LENGTH = 160;

/** Builds a UI citation for a unit from its first non-empty segment. */
export function buildUnitCitation(
  unit: SourceUnit,
  segmentsByIdx: Map<number, GenerationSegment>,
): Citation | null {
  for (let idx = unit.segStartIdx; idx <= unit.segEndIdx; idx += 1) {
    const segment = segmentsByIdx.get(idx);
    const text = segment?.text.trim();

    if (segment && text) {
      return {
        idx: segment.idx,
        startMs: segment.startMs,
        endMs: segment.endMs,
        quote:
          text.length <= CITATION_QUOTE_MAX_LENGTH
            ? text
            : `${text.slice(0, CITATION_QUOTE_MAX_LENGTH - 1).trimEnd()}…`,
      };
    }
  }

  return null;
}

export function buildSegmentsByIdx(segments: GenerationSegment[]) {
  return new Map(segments.map((segment) => [segment.idx, segment]));
}
