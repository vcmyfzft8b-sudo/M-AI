import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { GeminiUsageContext } from "@/lib/ai/usage-logging";
import type { ChunkSelector, CondensationChunk } from "@/lib/source-condensation";

// Bounds live in prose and post-processing, never in the schema: array bounds on a Gemini
// responseSchema push it past the complexity limit and the call is rejected outright.
const chunkSelectionSchema = z.object({
  keep: z.array(z.number().int()),
  droppedNotes: z.array(z.string()),
});

/**
 * The selection call reads a lot and writes almost nothing — unit numbers and a handful of short
 * facts — which is what makes compressing megabytes of source affordable inside one request or
 * step budget. The output stays small no matter how large the chunk is, so the budget is flat.
 */
const SELECTION_MAX_OUTPUT_TOKENS = 2_000;

function formatUnitHeading(chunk: CondensationChunk, index: number) {
  const unit = chunk.units[index];
  const label = [
    unit.pageNumber != null ? `p.${unit.pageNumber}` : null,
    unit.label?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `[${index}]${label ? ` (${label})` : ""}`;
}

export function createAiChunkSelector(usageContext?: GeminiUsageContext): ChunkSelector {
  return async (chunk) => {
    const keepPercent = Math.max(
      1,
      Math.min(99, Math.round((100 * chunk.keepBudgetChars) / Math.max(chunk.charCount, 1))),
    );
    const numberedUnits = chunk.units
      .map((unit, index) => `${formatUnitHeading(chunk, index)} ${unit.text}`)
      .join("\n\n");

    const result = await generateStructuredObject({
      schema: chunkSelectionSchema,
      instructions: [
        "You compress oversized study source material so a note-generation pipeline can process it.",
        "The input is one part of the source, split into numbered units. Decide which units to KEEP.",
        "Keep what a student needs to learn the material: definitions, formulas, laws, mechanisms, worked examples, concrete data, and the key arguments.",
        "Drop boilerplate, navigation, legal and licensing text, advertisements, credits, greetings, filler talk, and near-repetition.",
        `Return \`keep\` as unit numbers ordered from most to least important. Aim to keep about ${keepPercent}% of the text (roughly ${chunk.keepBudgetChars} characters) — the most instructive ${keepPercent}%.`,
        "Then, in `droppedNotes`, give at most 6 short standalone facts (max 200 characters each, written in the same language as the source) capturing anything genuinely important from units you did NOT keep. Return an empty array if nothing important was dropped.",
      ].join(" "),
      input: `Part ${chunk.chunkIndex + 1} of ${chunk.totalChunks}.\n\n${numberedUnits}`,
      maxOutputTokens: SELECTION_MAX_OUTPUT_TOKENS,
      stage: "source_condense",
      // Selection has a free mechanical fallback, so walking the full retry ladder here would
      // buy nothing but latency inside the intake route's own deadline.
      maxAttempts: 2,
      usageContext,
    });

    return result;
  };
}
