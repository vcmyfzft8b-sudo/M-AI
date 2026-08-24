import "server-only";

import { z } from "zod";

import { buildLanguageDirective } from "@/lib/generation/language";
import { generateObject, type GenerationCallContext } from "@/lib/generation/llm";
import {
  buildUnitWindows,
  renderUnitsForModel,
  type SourceDocument,
  type SourceUnit,
} from "@/lib/generation/source";
import { mapWithConcurrency, normalizeInline } from "@/lib/generation/util";

/**
 * A learning point is one thing the learner must be able to recall, explain, or apply — the
 * shared currency of the study pipelines. Flashcards, quiz questions, and practice-test
 * questions are all different renderings of the same extracted points, which keeps the three
 * products consistent with each other and complete against the source.
 */
export type LearningPoint = {
  index: number;
  statement: string;
  kind: "definition" | "fact" | "concept" | "process" | "relationship" | "application" | "formula";
  importance: "core" | "supporting" | "detail";
  conceptKey: string;
  topic: string;
  units: SourceUnit[];
};

const EXTRACTION_WINDOW_WORDS = 2800;
const EXTRACTION_CONCURRENCY = 4;
const MAX_LEARNING_POINTS = 140;

// Free-text fields carry no max length and `kind` is an open string: Gemini's structured-output
// serving rejects schemas whose length bounds multiply into too many states, and an off-list
// kind is not worth a retry. Caps and the kind vocabulary are enforced in code below instead.
const extractedPointSchema = z.object({
  statement: z.string().min(12),
  kind: z.string().min(2),
  importance: z.enum(["core", "supporting", "detail"]),
  conceptKey: z.string().min(2),
  topic: z.string().min(2),
  unitIds: z.array(z.number().int().min(0)).min(1),
});

const extractionSchema = z.object({
  points: z.array(extractedPointSchema).min(0),
});

const LEARNING_POINT_KINDS = [
  "definition",
  "fact",
  "concept",
  "process",
  "relationship",
  "application",
  "formula",
] as const;

function normalizePointKind(value: string): LearningPoint["kind"] {
  const normalized = value.trim().toLowerCase();
  return (
    LEARNING_POINT_KINDS.find((kind) => kind === normalized || normalized.startsWith(kind)) ??
    "fact"
  );
}

const mergeSchema = z.object({
  duplicates: z
    .array(
      z.object({
        pointIndex: z.number().int().min(0),
        duplicateOfIndex: z.number().int().min(0),
      }),
    )
    .max(80),
});

function buildExtractionInstructions(params: {
  languageCode?: string | null;
  notesTitle: string | null;
}) {
  return `You are building the master list of what a student must LEARN from this material${
    params.notesTitle ? ` ("${params.notesTitle}")` : ""
  }. Read the source units (tagged [U12], [U13], …) and extract learning points.

${buildLanguageDirective(params.languageCode)}

A learning point is ONE thing the learner must be able to recall, explain, or apply. For each:
- statement: a complete, self-contained sentence of the knowledge itself, understandable without the source open. State the fact — "Osmoza je prehajanje topila skozi polprepustno membrano iz redkejše v gostejšo raztopino." — never a pointer like "the definition of osmosis".
- kind: definition | fact | concept | process | relationship | application | formula. For formulas, include the formula in the statement in plain text (e.g. "F = m·a, kjer je F sila...").
- importance:
  - core — the exam would be failed without it: central definitions, main mechanisms, key formulas, the distinctions the material exists to teach.
  - supporting — needed for full marks: secondary properties, conditions, named examples, magnitudes.
  - detail — enriching but marginal: asides, historical notes, incidental numbers.
- conceptKey: short lowercase-hyphenated slug naming the concept (in the source's own terms), shared by points about the same concept.
- topic: short topic label grouping related points, in the output language.
- unitIds: the unit(s) that state this point.

Rules:
- Extract EVERYTHING examinable from the given units — completeness beats brevity. Skip greetings, administration, and pure repetition.
- One point per fact: split compound facts, but keep a definition and its essential qualifier together.
- Never invent: every point must be stated in the units, not merely inferable.
- Statements must stand alone: no "as mentioned above", no bare pronouns referring outside the statement.`;
}

async function mergeDuplicatePoints(
  points: LearningPoint[],
  params: { languageCode?: string | null; context?: GenerationCallContext },
) {
  if (points.length < 2) {
    return points;
  }

  const listing = points
    .map((point) => `${point.index}. [${point.conceptKey}] ${point.statement}`)
    .join("\n");

  const result = await generateObject({
    stage: "study_merge",
    schema: mergeSchema,
    maxOutputTokens: 4_000,
    instructions: `You are deduplicating a list of learning points extracted from overlapping passes over the same material. Two points are duplicates ONLY when a learner who mastered one would automatically be able to answer the other — same fact, possibly different wording or language. Points about the same concept that test DIFFERENT facts (its definition vs. its formula vs. its consequences) are NOT duplicates. When unsure, keep both.

Return each duplicate as { pointIndex, duplicateOfIndex } where duplicateOfIndex is the point to keep (prefer the more complete statement). Return an empty list if there are none.`,
    input: listing,
    context: params.context,
  });

  const dropped = new Set<number>();
  const byIndex = new Map(points.map((point) => [point.index, point]));
  const importanceRank = { core: 0, supporting: 1, detail: 2 } as const;

  for (const duplicate of result.duplicates) {
    const from = byIndex.get(duplicate.pointIndex);
    const keep = byIndex.get(duplicate.duplicateOfIndex);

    if (!from || !keep || from.index === keep.index || dropped.has(keep.index)) {
      continue;
    }

    dropped.add(from.index);

    // The surviving point absorbs the duplicate's anchors and the stronger importance.
    const mergedUnits = new Map(keep.units.map((unit) => [unit.unitId, unit]));
    for (const unit of from.units) {
      mergedUnits.set(unit.unitId, unit);
    }
    keep.units = [...mergedUnits.values()].sort((left, right) => left.unitId - right.unitId);
    if (importanceRank[from.importance] < importanceRank[keep.importance]) {
      keep.importance = from.importance;
    }
  }

  return points.filter((point) => !dropped.has(point.index));
}

export async function extractLearningPoints(params: {
  source: SourceDocument;
  notesTitle: string | null;
  languageCode?: string | null;
  context?: GenerationCallContext;
}): Promise<LearningPoint[]> {
  const windows = buildUnitWindows(params.source.units, EXTRACTION_WINDOW_WORDS);
  const unitById = new Map(params.source.units.map((unit) => [unit.unitId, unit]));

  const extracted = await mapWithConcurrency(windows, EXTRACTION_CONCURRENCY, (window) =>
    generateObject({
      stage: "study_extract",
      schema: extractionSchema,
      maxOutputTokens: 14_000,
      instructions: buildExtractionInstructions({
        languageCode: params.languageCode,
        notesTitle: params.notesTitle,
      }),
      input: renderUnitsForModel(window),
      context: params.context,
    }),
  );

  let points: LearningPoint[] = [];

  for (const batch of extracted) {
    for (const raw of batch.points) {
      const units = [...new Set(raw.unitIds)]
        .map((unitId) => unitById.get(unitId))
        .filter((unit): unit is SourceUnit => Boolean(unit))
        .sort((left, right) => left.unitId - right.unitId);

      if (units.length === 0) {
        continue;
      }

      points.push({
        index: points.length,
        statement: normalizeInline(raw.statement, 420),
        kind: normalizePointKind(raw.kind),
        importance: raw.importance,
        conceptKey: normalizeInline(raw.conceptKey.toLowerCase(), 80),
        topic: normalizeInline(raw.topic, 120),
        units,
      });
    }
  }

  if (points.length === 0) {
    throw new Error("No learning points could be extracted from the source.");
  }

  if (windows.length > 1) {
    points = await mergeDuplicatePoints(points, {
      languageCode: params.languageCode,
      context: params.context,
    });
  }

  if (points.length > MAX_LEARNING_POINTS) {
    const importanceRank = { core: 0, supporting: 1, detail: 2 } as const;
    points = [...points]
      .sort(
        (left, right) =>
          importanceRank[left.importance] - importanceRank[right.importance] ||
          left.index - right.index,
      )
      .slice(0, MAX_LEARNING_POINTS)
      .sort((left, right) => left.index - right.index);
  }

  // Re-number after merging/capping so downstream prompts can reference points by index.
  return points.map((point, index) => ({ ...point, index }));
}

const planSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(3),
        pointIndexes: z.array(z.number().int().min(0)).min(1),
      }),
    )
    .min(1),
});

export type StudySectionPlan = {
  title: string;
  points: LearningPoint[];
};

/**
 * Groups learning points into a small number of study sections ordered for learning. Used by
 * the flashcard deck (sections are a visible navigation structure there).
 */
export async function planStudySections(params: {
  points: LearningPoint[];
  notesTitle: string | null;
  languageCode?: string | null;
  context?: GenerationCallContext;
}): Promise<StudySectionPlan[]> {
  if (params.points.length <= 8) {
    return [
      {
        title: params.notesTitle?.trim() || "Study set",
        points: params.points,
      },
    ];
  }

  const listing = params.points
    .map((point) => `${point.index}. (${point.topic}) ${point.statement}`)
    .join("\n");

  const result = await generateObject({
    stage: "study_plan",
    schema: planSchema,
    maxOutputTokens: 4_000,
    instructions: `Group these learning points${
      params.notesTitle ? ` from "${params.notesTitle}"` : ""
    } into study sections a learner works through in order.

${buildLanguageDirective(params.languageCode)}

- 2–8 sections, ordered for learning (foundations before applications).
- Section titles: short and specific, in the output language.
- Every point index appears in exactly one section; related points stay together.`,
    input: listing,
    context: params.context,
  });

  const byIndex = new Map(params.points.map((point) => [point.index, point]));
  const assigned = new Set<number>();
  const sections: StudySectionPlan[] = [];

  for (const section of result.sections.slice(0, 10)) {
    const points = section.pointIndexes
      .map((index) => byIndex.get(index))
      .filter((point): point is LearningPoint => Boolean(point) && !assigned.has(point!.index));

    for (const point of points) {
      assigned.add(point.index);
    }

    if (points.length > 0) {
      sections.push({ title: normalizeInline(section.title, 140), points });
    }
  }

  // Points the planner missed still deserve cards — append them to the closest section.
  const leftovers = params.points.filter((point) => !assigned.has(point.index));

  if (leftovers.length > 0) {
    if (sections.length === 0) {
      sections.push({
        title: params.notesTitle?.trim() || "Study set",
        points: leftovers,
      });
    } else {
      for (const point of leftovers) {
        const target =
          sections.find((section) =>
            section.points.some((candidate) => candidate.topic === point.topic),
          ) ?? sections[sections.length - 1];
        target.points.push(point);
      }
    }
  }

  return sections;
}
