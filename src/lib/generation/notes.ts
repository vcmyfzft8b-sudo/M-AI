import "server-only";

import { z } from "zod";

import { generateObject, type GenerationCallContext } from "@/lib/generation/llm";
import { buildLanguageDirective, resolveCalloutLabels } from "@/lib/generation/language";
import {
  buildSourceDocument,
  renderUnitsForModel,
  type GenerationSegment,
  type SourceDocument,
  type SourceUnit,
} from "@/lib/generation/source";
import { clamp, countWords, mapWithConcurrency, normalizeInline } from "@/lib/generation/util";

export const NOTES_PIPELINE_VERSION = "notes-v3-content-map";

const SMALL_SOURCE_WORDS = 420;
const MAX_SECTION_BATCH_SOURCE_WORDS = 3600;
const MAX_SECTIONS_PER_BATCH = 3;
const WRITE_CONCURRENCY = 4;

export type GeneratedNotes = {
  title: string;
  summary: string;
  keyTopics: string[];
  structuredNotesMd: string;
  modelMetadata: Record<string, unknown>;
};

// Free-text fields carry no max length: Gemini's structured-output serving rejects schemas
// whose length bounds multiply into "too many states". Sizes are clamped in code instead.
const noteMapSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  keyTopics: z.array(z.string().min(2)).min(3),
  sourceKind: z.enum([
    "lecture",
    "slides",
    "textbook",
    "article",
    "problem_set",
    "notes",
    "mixed",
  ]),
  sections: z
    .array(
      z.object({
        title: z.string().min(3),
        unitIds: z.array(z.number().int().min(0)).min(0),
        brief: z.string().min(10),
      }),
    )
    .min(1),
});

const noteWriteSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(3),
        markdown: z.string().min(40),
      }),
    )
    .min(1),
});

const smallSourceNotesSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(30),
  keyTopics: z.array(z.string().min(2)).min(2),
  markdown: z.string().min(60),
});

type PlannedSection = {
  title: string;
  brief: string;
  units: SourceUnit[];
  isRecap: boolean;
};

function describeSectionCountHint(totalWords: number) {
  if (totalWords < 900) {
    return "Plan 2–4 content sections";
  }
  if (totalWords < 2600) {
    return "Plan 3–6 content sections";
  }
  if (totalWords < 6500) {
    return "Plan 5–9 content sections";
  }
  return "Plan 7–12 content sections";
}

function buildFormatRules(languageCode?: string | null) {
  const labels = resolveCalloutLabels(languageCode);

  return `FORMAT RULES — the renderer supports exactly this, nothing else:
- Start each section with a short orientation paragraph (no heading): what the section covers and how it connects to what came before.
- Use "###" sub-headings to split a section that covers more than one distinct idea. Never use "#" or "##" inside a section body.
- Callouts are single blockquote paragraphs starting with an exact label:
  "> ${labels.definition}: …" — every formal definition in the source gets one, stated precisely.
  "> ${labels.example}: …" — worked examples; for calculations show the steps, continuing the blockquote with lines that start with "> ".
  "> ${labels.commonMistake}: …" — only for real confusions: something the source itself corrects or warns about, or a classic error tied directly to this content. Never force one.
  "> ${labels.keyTakeaway}: …" — at most one per section: the single most exam-relevant point of that section.
- Lists: "-" bullets for enumerations; "1." numbered lists for ordered steps and procedures.
- Tables: Markdown pipe tables with a header row, whenever two or more items are compared across two or more attributes.
- Math: display formulas on their own line wrapped in $$ … $$; inline math wrapped in \\( … \\). Define every symbol right after the formula where it first appears. LaTeX only inside those delimiters. Write currency as "5 USD" or "5 €", never with a bare $.
- Plain text otherwise: no bold or italic markers, no links, no images, no code fences, no horizontal rules.
- Length follows content: dense source material deserves thorough notes; thin content stays short. Never pad.`;
}

const TEACHING_RULES = `TEACHING RULES:
- Teach, don't summarise: for each idea explain what it is, how it works, and why it matters, in plain direct sentences a student can follow on first read.
- Complete coverage: every definition, formula, numbered fact, date, name, distinction, and example in the assigned source units must appear in the notes. Nothing examinable may be lost.
- Stay faithful: never invent facts that are not in the source. You may add at most a connecting sentence of standard background where the source assumes it.
- Repair the medium: if the source wording is garbled (transcription errors, broken sentences), write the clearly intended meaning instead of the garble.
- Write about the subject, never about the recording — no "the lecturer then says". When the source explicitly flags something as exam-relevant, surface that inside a key-takeaway callout.`;

function buildMapInstructions(params: {
  languageCode?: string | null;
  sourceTitleHint?: string;
  totalWords: number;
  isAudio: boolean;
}) {
  const labels = resolveCalloutLabels(params.languageCode);

  return `You are the course architect for a study app. Read the full source material (${
    params.isAudio ? "a transcribed recording" : "an uploaded document"
  }, split into units tagged [U0], [U1], …) and design the blueprint for study notes that could replace attending the class.

${buildLanguageDirective(params.languageCode)}

Return:
- title: a specific, content-bearing title in the output language — name the actual subject, never generic like "Lecture notes".${
    params.sourceTitleHint
      ? ` The uploader suggested the title "${params.sourceTitleHint}"; keep it if it accurately names this content, otherwise improve it.`
      : ""
  }
- summary: 2–4 sentences in the output language that orient a student: what this material covers and why it matters. No marketing tone.
- keyTopics: 4–10 short topic labels in the output language.
- sourceKind: what the material actually is.
- sections: the section plan, ordered for LEARNING — usually foundations → mechanisms → applications. Fix the source's detours, repetitions, and tangents; group related content even when the source scatters it.
  - title: specific and informative, output language.
  - unitIds: every unit whose teachable content belongs to the section. Every unit that contains teachable content must be assigned to at least one section (a unit may serve at most two sections). Only administrative chatter, greetings, and housekeeping may be left out.
  - brief: 1–3 sentences for the section author: what must be taught, which definitions, formulas, and examples from those units belong here, and anything the source emphasises as exam-relevant.
${describeSectionCountHint(params.totalWords)}, then add ONE final recap section titled in the spirit of "${labels.keyTakeaway}" (output language) with an empty unitIds list; its brief must list the 4–7 most exam-critical insights of the whole material.`;
}

function buildWriteInstructions(params: {
  title: string;
  summary: string;
  languageCode?: string | null;
  outline: string[];
}) {
  return `You write the world's best study notes. A student who missed class must be able to learn everything from these notes alone — faster and more clearly than from the raw source.

Material: "${params.title}" — ${params.summary}
Full section outline of the notes (for orientation; write ONLY the sections assigned below, without repeating other sections' content):
${params.outline.map((title, index) => `${index + 1}. ${title}`).join("\n")}

${buildLanguageDirective(params.languageCode)}

${TEACHING_RULES}

For a recap section (its brief says so and it has no source units): write 4–7 "-" bullets, each one sentence naming an insight and why it matters; no callouts, no sub-headings.

Return one entry per assigned section, in the given order: the section title (you may polish the wording) and the section body as markdown following the format rules. Do not include the "##" section heading itself in the body — it is added automatically.`;
}

function buildSectionBatchInput(sections: PlannedSection[]) {
  return sections
    .map((section, index) => {
      const sourceText =
        section.units.length > 0
          ? renderUnitsForModel(section.units)
          : "(no source units — this is the recap section)";

      return `SECTION ${index + 1}: ${section.title}
Brief: ${section.brief}
Source units:
${sourceText}`;
    })
    .join("\n\n=====\n\n");
}

/**
 * Post-generation cleanup that keeps the model's markdown inside the renderer's dialect without
 * rewriting content: strips code fences, demotes stray H1/H2 headings inside section bodies,
 * and collapses excess blank lines.
 */
export function sanitizeSectionMarkdown(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .map((line) => {
      if (/^#{1,2}\s/.test(line.trim())) {
        return line.replace(/^(\s*)#{1,2}\s/, "$1### ");
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function planSections(map: z.infer<typeof noteMapSchema>, source: SourceDocument) {
  const unitById = new Map(source.units.map((unit) => [unit.unitId, unit]));
  const assignedUnitIds = new Set<number>();
  const planned: PlannedSection[] = [];
  const plannedSections = map.sections.slice(0, 14);

  for (const [index, section] of plannedSections.entries()) {
    const units = [...new Set(section.unitIds)]
      .map((unitId) => unitById.get(unitId))
      .filter((unit): unit is SourceUnit => Boolean(unit))
      .sort((left, right) => left.unitId - right.unitId);

    for (const unit of units) {
      assignedUnitIds.add(unit.unitId);
    }

    const isRecap = index === plannedSections.length - 1 && units.length === 0;

    if (units.length === 0 && !isRecap) {
      continue;
    }

    planned.push({ title: section.title, brief: section.brief, units, isRecap });
  }

  // A planner that dropped real content silently would produce polished notes with holes, which
  // is worse than ugly notes. Sweep unassigned units into the section whose units they neighbour.
  const contentSections = planned.filter((section) => !section.isRecap);

  if (contentSections.length > 0) {
    for (const unit of source.units) {
      if (assignedUnitIds.has(unit.unitId) || unit.wordCount < 25) {
        continue;
      }

      let target = contentSections[contentSections.length - 1];
      for (const section of contentSections) {
        const lastUnit = section.units[section.units.length - 1];
        if (lastUnit && lastUnit.unitId >= unit.unitId) {
          target = section;
          break;
        }
      }

      target.units.push(unit);
      target.units.sort((left, right) => left.unitId - right.unitId);
      assignedUnitIds.add(unit.unitId);
    }
  }

  return planned;
}

function batchSections(sections: PlannedSection[]) {
  const batches: PlannedSection[][] = [];
  let current: PlannedSection[] = [];
  let currentWords = 0;

  for (const section of sections) {
    const sectionWords = section.units.reduce((total, unit) => total + unit.wordCount, 0);

    if (
      current.length > 0 &&
      (current.length >= MAX_SECTIONS_PER_BATCH ||
        currentWords + sectionWords > MAX_SECTION_BATCH_SOURCE_WORDS)
    ) {
      batches.push(current);
      current = [];
      currentWords = 0;
    }

    current.push(section);
    currentWords += sectionWords;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

async function generateSmallSourceNotes(params: {
  source: SourceDocument;
  languageCode?: string | null;
  sourceTitleHint?: string;
  context?: GenerationCallContext;
}): Promise<GeneratedNotes> {
  const result = await generateObject({
    stage: "note_write",
    schema: smallSourceNotesSchema,
    maxOutputTokens: 12_000,
    instructions: `You write the world's best study notes. Turn this short source material into compact study notes a student can learn from without the original.

${buildLanguageDirective(params.languageCode)}

${TEACHING_RULES}

${buildFormatRules(params.languageCode)}

Structure: an orientation paragraph, then "##" sections as the content requires (a short source may need only one or two). Do not add a recap section to material this short.

Also return: a specific content-bearing title${
      params.sourceTitleHint
        ? ` (the uploader suggested "${params.sourceTitleHint}"; keep it if accurate)`
        : ""
    }, a 2–3 sentence summary, and 2–8 key topic labels — all in the output language. Do not repeat the title as a heading inside the markdown.`,
    input: renderUnitsForModel(params.source.units),
    context: params.context,
  });

  return {
    title: normalizeInline(result.title, 160),
    summary: result.summary.trim(),
    keyTopics: result.keyTopics
      .map((topic) => normalizeInline(topic, 80))
      .filter(Boolean)
      .slice(0, 8),
    structuredNotesMd: sanitizeSectionMarkdown(result.markdown),
    modelMetadata: {
      pipeline: NOTES_PIPELINE_VERSION,
      mode: "single_pass",
      sourceWordCount: params.source.totalWords,
    },
  };
}

export async function generateNotesFromSource(params: {
  segments: GenerationSegment[];
  sourceType: "audio" | "document";
  outputLanguage?: string | null;
  sourceTitleHint?: string;
  context?: GenerationCallContext;
}): Promise<GeneratedNotes> {
  const source = buildSourceDocument(params.segments, params.sourceType);

  if (source.units.length === 0 || source.totalWords === 0) {
    throw new Error("The source material contains no readable text.");
  }

  if (source.totalWords < SMALL_SOURCE_WORDS) {
    return generateSmallSourceNotes({
      source,
      languageCode: params.outputLanguage,
      sourceTitleHint: params.sourceTitleHint,
      context: params.context,
    });
  }

  const map = await generateObject({
    stage: "note_map",
    schema: noteMapSchema,
    maxOutputTokens: 8_000,
    instructions: buildMapInstructions({
      languageCode: params.outputLanguage,
      sourceTitleHint: params.sourceTitleHint,
      totalWords: source.totalWords,
      isAudio: source.isAudio,
    }),
    input: renderUnitsForModel(source.units),
    context: params.context,
  });

  const planned = planSections(map, source);

  if (planned.length === 0) {
    throw new Error("The note plan came back empty.");
  }

  const outline = planned.map((section) => section.title);
  const batches = batchSections(planned);

  const writtenBatches = await mapWithConcurrency(batches, WRITE_CONCURRENCY, async (batch) => {
    const result = await generateObject({
      stage: "note_write",
      schema: noteWriteSchema,
      maxOutputTokens: clamp(batch.length * 6_000, 8_000, 18_000),
      instructions: `${buildWriteInstructions({
        title: map.title,
        summary: map.summary,
        languageCode: params.outputLanguage,
        outline,
      })}

${buildFormatRules(params.outputLanguage)}`,
      input: buildSectionBatchInput(batch),
      context: params.context,
    });

    // The model may merge or drop entries; align by position and fall back to the plan's title.
    return batch.map((section, index) => {
      const written = result.sections[index] ?? result.sections[result.sections.length - 1];

      return {
        title: (written?.title ?? section.title).trim() || section.title,
        markdown: sanitizeSectionMarkdown(written?.markdown ?? ""),
      };
    });
  });

  const sections = writtenBatches.flat().filter((section) => section.markdown.length > 0);

  if (sections.length === 0) {
    throw new Error("Note writing produced no sections.");
  }

  const structuredNotesMd = [
    map.summary.trim(),
    ...sections.map((section) => `## ${section.title}\n\n${section.markdown}`),
  ]
    .join("\n\n")
    .trim();

  return {
    title: normalizeInline(map.title, 160),
    summary: map.summary.trim(),
    keyTopics: map.keyTopics
      .map((topic) => normalizeInline(topic, 80))
      .filter(Boolean)
      .slice(0, 10),
    structuredNotesMd,
    modelMetadata: {
      pipeline: NOTES_PIPELINE_VERSION,
      mode: "content_map",
      sourceKind: map.sourceKind,
      sectionCount: sections.length,
      sourceWordCount: source.totalWords,
      noteWordCount: countWords(structuredNotesMd),
    },
  };
}
