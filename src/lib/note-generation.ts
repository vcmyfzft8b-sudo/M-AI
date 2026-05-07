import "server-only";

import { chunkSummarySchema, noteArtifactSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildTranscriptWindows } from "@/lib/chunking";
import {
  buildGeneratedContentLanguageInstruction,
  normalizeNoteLanguage,
  resolveNoteLanguageLabel,
} from "@/lib/languages";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";

const NOTE_CHUNK_SUMMARY_CONCURRENCY = 2;

export function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtmlFromNotes(value: string) {
  const normalized = value.trim();

  if (!/<\/?(h[1-6]|p|ul|ol|li|strong|em|blockquote|br)\b/i.test(normalized)) {
    return normalized;
  }

  return decodeHtmlEntities(
    normalized
      .replace(/\r\n/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/h1>/gi, "\n\n")
      .replace(/<h1[^>]*>/gi, "# ")
      .replace(/<\/h2>/gi, "\n\n")
      .replace(/<h2[^>]*>/gi, "## ")
      .replace(/<\/h3>/gi, "\n\n")
      .replace(/<h3[^>]*>/gi, "### ")
      .replace(/<\/h4>/gi, "\n\n")
      .replace(/<h4[^>]*>/gi, "#### ")
      .replace(/<\/h5>/gi, "\n\n")
      .replace(/<h5[^>]*>/gi, "##### ")
      .replace(/<\/h6>/gi, "\n\n")
      .replace(/<h6[^>]*>/gi, "###### ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
      .replace(/<\/strong>/gi, "**")
      .replace(/<strong[^>]*>/gi, "**")
      .replace(/<\/em>/gi, "*")
      .replace(/<em[^>]*>/gi, "*")
      .replace(/<\/blockquote>/gi, "\n")
      .replace(/<blockquote[^>]*>/gi, "> ")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function normalizeStudyListSections(markdown: string) {
  const listSectionHeadings = new Set([
    "Preveri svoje znanje",
    "Končni pregled",
    "Check Yourself",
    "Final Review",
  ]);
  const lines = markdown.split("\n");
  const normalizedLines: string[] = [];
  let inListSection = false;
  let keptCalloutCount = 0;

  for (const line of lines) {
    const blockquote = /^>\s+(.+)$/.exec(line.trim());

    if (blockquote) {
      const content = blockquote[1];
      const normalizedContent = content
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
      const isExample = /^\*\*(primer|example):\*\*/.test(normalizedContent);
      const shouldKeepCallout = keptCalloutCount < 3 && (!isExample || keptCalloutCount === 0);

      if (shouldKeepCallout) {
        keptCalloutCount += 1;
        normalizedLines.push(line);
      } else {
        normalizedLines.push(content);
      }

      continue;
    }

    const unorderedListItem = /^(\s*)[*+]\s+(.+)$/.exec(line);

    if (unorderedListItem) {
      normalizedLines.push(`${unorderedListItem[1]}- ${unorderedListItem[2]}`);
      continue;
    }

    const fixedLine = line
      .replace(/^(#{2,3}\s+)Podrobni zapisk\s*$/i, "$1Podrobni zapiski")
      .replace(/^(#{2,3}\s+)Detailed Note\s*$/i, "$1Detailed Notes");
    const heading = /^#{2,3}\s+(.+)$/.exec(fixedLine.trim());

    if (heading) {
      const headingText = heading[1]
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
        .trim();
      inListSection = listSectionHeadings.has(headingText);
      normalizedLines.push(fixedLine);
      continue;
    }

    if (
      inListSection &&
      line.trim().length > 0 &&
      !/^(\s*[-*+]\s+|\s*\d+[.)]\s+|>\s+|\|)/.test(line)
    ) {
      normalizedLines.push(`- ${line.trim()}`);
      continue;
    }

    normalizedLines.push(fixedLine);
  }

  return normalizedLines.join("\n");
}

function buildNoteTargets(sourceWordCount: number, chunkCount: number) {
  const targetNoteWordCount = Math.max(700, Math.min(3200, Math.round(sourceWordCount * 0.42)));

  return {
    targetNoteWordCount,
    minNoteWordCount: Math.max(700, Math.round(targetNoteWordCount * 0.88)),
    maxNoteWordCount: Math.max(900, Math.min(2400, Math.round(targetNoteWordCount * 1.18))),
    minSectionCount: Math.max(4, Math.min(12, chunkCount)),
    recommendedTopicCount: Math.max(4, Math.min(9, Math.ceil(chunkCount / 1.8))),
  };
}

function buildAudioNoteTargets(sourceWordCount: number, chunkCount: number) {
  const targetNoteWordCount = Math.max(1200, Math.min(5200, Math.round(sourceWordCount * 0.58)));

  return {
    targetNoteWordCount,
    minNoteWordCount: Math.max(1100, Math.round(targetNoteWordCount * 0.86)),
    maxNoteWordCount: Math.max(1500, Math.min(5600, Math.round(targetNoteWordCount * 1.18))),
    minSectionCount: Math.max(6, Math.min(18, Math.ceil(chunkCount * 1.15))),
    recommendedTopicCount: Math.max(6, Math.min(14, Math.ceil(chunkCount / 1.5))),
  };
}

function getStructuredPlusLabels(outputLanguage?: string | null) {
  const languageCode = normalizeNoteLanguage(outputLanguage);

  if (languageCode === "sl") {
    return {
      overview: "## Hiter pregled",
      keyThings: "## Ključne stvari, ki jih moraš znati",
      topicExample: "## 1. Ime teme",
      coreIdea: "### Glavna ideja",
      detailedNotes: "### Podrobni zapiski",
      keyTerms: "### Ključni pojmi",
      example: "### Primer",
      compare: "### Primerjava",
      process: "### Proces",
      checkYourself: "### Preveri svoje znanje",
      finalReview: "## Končni pregled",
      definition: "Definicija",
      commonMistake: "Pogosta napaka",
      keyTakeaway: "Ključno",
    };
  }

  return {
    overview: "## Quick Overview",
    keyThings: "## Key Things To Know",
    topicExample: "## 1. Topic name",
    coreIdea: "### Core Idea",
    detailedNotes: "### Detailed Notes",
    keyTerms: "### Key Terms",
    example: "### Example",
    compare: "### Compare",
    process: "### Process",
    checkYourself: "### Check Yourself",
    finalReview: "## Final Review",
    definition: "Definition",
    commonMistake: "Common mistake",
    keyTakeaway: "Key takeaway",
  };
}

function buildStructuredPlusInstructions(params: {
  outputLanguage?: string | null;
  targetNoteWordCount: number;
  minNoteWordCount: number;
  maxNoteWordCount: number;
  recommendedTopicCount: number;
}) {
  const labels = getStructuredPlusLabels(params.outputLanguage);

  return `Use a research-based "compressed expert study notes" style: select the important ideas, organize them clearly, signal what matters, and remove repetition or low-value wording. Cover the material by concepts, not by rewriting every sentence.

Use this stable Structured Plus markdown format with these exact heading labels:
- Start with "${labels.overview}" containing 2-3 concise sentences that explain the whole material.
- Immediately after "${labels.overview}", add exactly one semantic blockquote callout in this form: "> **${labels.keyTakeaway}:** ...". This creates the main visual highlight.
- Add "${labels.keyThings}" with 5-8 complete bullet points for the main ideas.
- After "${labels.keyThings}", include exactly one concise GFM markdown table when the source contains at least three comparable concepts, categories, systems, components, terms, steps, or cause-effect relationships. Most lecture/course materials have at least one logical table, so include the table unless the source truly has no comparable set.
- Then create about ${params.recommendedTopicCount} numbered topic sections such as "${labels.topicExample}". Merge related chunks into one topic instead of creating a section for every chunk. Never create more than ${params.recommendedTopicCount + 1} numbered topic sections.
- Inside each substantial topic, use "${labels.coreIdea}" and "${labels.detailedNotes}". Use "${labels.keyTerms}", "${labels.example}", "${labels.compare}", "${labels.process}", or "${labels.checkYourself}" only when they add real study value.
- "${labels.coreIdea}" must be exactly 1 sentence.
- "${labels.detailedNotes}" should usually contain 1 short explanatory paragraph plus 2-3 hyphen bullets. Use 4 bullets only when the section contains a true component list or process. Do not force every concept into a bullet.
- Use hyphen bullet lists only when the material is naturally list-like: steps, components, causes, benefits, risks, grouped examples, questions, takeaways, or direct comparisons. This follows good study-note design by segmenting related ideas so learners can scan, compare, and self-test more easily.
- Avoid nested bullet lists unless the source contains an actual component list or process. If nested bullets are needed, keep them short and do not use more than one nested list in a topic.
- Use labeled bullets only when the label is semantically important, for example "- **${labels.definition}:** ...", "- **${labels.keyTakeaway}:** ...", "- **${labels.example}:** ...", "- **Razlika:** ...", "- **Korak:** ...", "- **Pazi:** ...". Do not label every ordinary bullet just for style.
- When a concept has multiple examples, use a short hyphen list under the concept. Do not write examples as several standalone paragraphs.
- Use normal paragraphs for "${labels.overview}", "${labels.coreIdea}", short explanations, and semantic callouts. Avoid long runs of paragraph after paragraph, but do not overuse bullets.
- For unordered lists, always use "- " as the Markdown bullet marker. Do not use "*" or "+" bullets.
- Use GFM markdown tables only when they make terminology, comparisons, categories, formulas, steps, or cause-effect relationships shorter and easier to understand than prose. Use exactly 1 table total for normal course notes when there is any logical comparison/classification/process; never use more than 2. Tables must compress information, not duplicate the surrounding bullets. Format every table with leading and trailing pipes in the header, separator, and body rows.
- Use semantic blockquote callouts in the selected language for visible highlighting where it actually helps learning: include exactly 2 callouts in a normal note and at most 3 in a complex note. One must be the top "${labels.keyTakeaway}" callout; the second should be a genuinely important "${labels.definition}", "${labels.commonMistake}", or "${labels.keyTakeaway}" later in the notes. Do not turn every example into a callout. Supported forms: "> **${labels.definition}:** ...", "> **${labels.example}:** ...", "> **${labels.commonMistake}:** ...", or "> **${labels.keyTakeaway}:** ...".
- Include source-grounded examples or worked explanations only when they clarify a difficult concept and the source supports them. Most examples should be normal text under "${labels.example}", not blockquote callouts. Skip generic examples.
- Add "${labels.checkYourself}" only once near the end unless the source is long and complex. Format it as a hyphen bullet list with 3-5 short questions that are answerable from the notes.
- End with "${labels.finalReview}" formatted as a hyphen bullet list containing 4-7 tight takeaways and any confusing points or common mistakes supported by the source.

Compression rules:
- Keep named concepts, definitions, formulas, categories, process steps, comparisons, examples that explain hard ideas, and exam-relevant caveats.
- Merge duplicate ideas across chunks. Omit repeated objectives, transition phrases, obvious restatements, filler, and examples that do not add new understanding.
- Prefer signal words and structure over extra prose: "zato", "posledica", "razlika", "korak", "primer", "pazi".
- Preserve coverage by writing concise organized study notes, not by making the note longer.

Return markdown only. Do not use HTML tags. Do not include decorative color instructions or unsupported facts. Use 2-5 logical emojis total in major section headings or the top callout to improve scanning, for example one emoji before a few numbered topic headings. Do not use emojis on every bullet or make the notes feel childish. Aim for about ${params.targetNoteWordCount} words, with a normal range of ${params.minNoteWordCount}-${params.maxNoteWordCount} words. Do not compress below ${params.minNoteWordCount} words unless the source itself is very short or sparse.`;
}

function buildNoteCompressionInstructions(params: {
  outputLanguage?: string | null;
  targetNoteWordCount: number;
  minNoteWordCount: number;
  maxNoteWordCount: number;
  recommendedTopicCount: number;
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const languageLabel = resolveNoteLanguageLabel(params.outputLanguage);
  const labels = getStructuredPlusLabels(params.outputLanguage);

  return `${languageInstruction} Rewrite the supplied notes in ${languageLabel} into concise, research-based study notes while preserving all high-value source concepts.

Keep the exact Structured Plus organization and exact localized heading labels:
- Start with "${labels.overview}".
- Then include one top callout in this form: "> **${labels.keyTakeaway}:** ...".
- Then include "${labels.keyThings}".
- Then include about ${params.recommendedTopicCount} numbered topic sections.
- Never exceed ${params.recommendedTopicCount + 1} numbered topic sections.
- Each numbered topic must include "${labels.coreIdea}" and "${labels.detailedNotes}".
- End with "${labels.checkYourself}" and "${labels.finalReview}".

Compress carefully:
- Aim for about ${params.targetNoteWordCount} words and keep the normal range ${params.minNoteWordCount}-${params.maxNoteWordCount} words.
- Do not compress below ${params.minNoteWordCount} words unless the source is sparse.
- Keep about ${params.recommendedTopicCount} numbered topic sections by merging related sections.
- Keep definitions, named concepts, formulas, categories, process steps, comparisons, and exam-relevant caveats.
- Remove repetition, filler sentences, transition phrases, duplicate explanations, and generic examples.
- Use hyphen bullets for scanability, but keep bullets complete and meaningful. Use "- " for every unordered bullet, never "*" or "+".
- Convert questions, takeaways, steps, causes, benefits, risks, and grouped examples into hyphen bullet lists. Keep normal explanatory paragraphs when the idea is better understood as a short explanation.
- In topic sections, prefer 1 short paragraph plus 2-3 bullets. Use more bullets only for real component lists, process steps, or comparisons.
- Use labeled bullets only for semantic importance labels such as "${labels.definition}", "${labels.keyTakeaway}", "${labels.example}", "Razlika", "Korak", or "Pazi". Do not label every ordinary bullet.
- Keep exactly 1 table when the notes contain a real comparison, classification, component set, process, terminology cluster, or cause-effect set; otherwise keep no table. Never keep more than 2 tables total. For business/IT/course notes, assume a table is needed if the source mentions multiple systems, process types, modules, roles, or categories.
- Keep exactly 2 semantic callouts total in a normal note and at most 3 in a complex note. Use them for important definitions, common mistakes, or key takeaways. Do not add callouts for filler and do not make every example a callout.
- Keep 2-5 logical emojis total in major section headings or the top callout; do not use emojis in every bullet.
- Include one short Check Yourself section near the end, not after every topic. It must be a hyphen bullet list.
- Final Review must be a hyphen bullet list, not paragraph text.

Return the same JSON fields. For structuredNotesMd, return markdown only with no HTML and no unsupported facts.`;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

export async function generateNotesFromTranscript(
  segments: TranscriptSegmentInput[],
  params: {
    sourceLabel: string;
    pipelineName: string;
    sourceType?: "audio" | "document";
    outputLanguage?: string | null;
    sourceTitleHint?: string | null;
  },
): Promise<NoteGenerationResult> {
  const sourceType = params.sourceType ?? "audio";
  const windows = buildTranscriptWindows(segments, sourceType === "audio" ? 2200 : 3200);
  const sourceWordCount = segments.reduce((total, segment) => total + countWords(segment.text), 0);
  const targets =
    sourceType === "audio"
      ? buildAudioNoteTargets(sourceWordCount, windows.length)
      : buildNoteTargets(sourceWordCount, windows.length);
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const languageLabel = resolveNoteLanguageLabel(params.outputLanguage);
  const chunkInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You create detailed study notes from spoken lecture transcripts. Capture all substantive material from the chunk, including definitions, mechanisms, sequences, comparisons, examples, clarifications, caveats, and exam-relevant details. Preserve technical terms and explain abbreviated or implied ideas when the transcript supports them. Do not compress the lecture into a short recap. Never invent facts. Bullet points must be complete study points, not fragments.`
      : `${languageInstruction} You create detailed study notes from lecture-style source material. Capture all substantive material from the chunk, including definitions, mechanisms, sequences, comparisons, caveats, examples already present in the source, and exam-relevant details. Never invent facts. Bullet points must be complete study points, not fragments.`;
  const structuredPlusInstructions = buildStructuredPlusInstructions({
    outputLanguage: params.outputLanguage,
    targetNoteWordCount: targets.targetNoteWordCount,
    minNoteWordCount: targets.minNoteWordCount,
    maxNoteWordCount: targets.maxNoteWordCount,
    recommendedTopicCount: targets.recommendedTopicCount,
  });
  const finalInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover the high-value material in the source without unnecessary text. This is a spoken lecture transcript, so reconstruct the material into clean, structured notes and merge repeated spoken ideas. Include important definitions, steps, relationships, examples, clarifications, and lecturer-added context when supported by the transcript. Do not turn the lecture into a shallow recap; do turn it into concise study notes. Explain the logic behind processes and relationships, preserve technical terms, and include examples only when supported by the source material. Every chunk summary should contribute only its non-duplicate substantive content to the final notes. Aim for about ${targets.targetNoteWordCount} words when the source supports it. Build about ${targets.recommendedTopicCount} substantial sections when the material supports it. ${structuredPlusInstructions}`
      : `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover the high-value material in the source without unnecessary text. Do not turn the material into a shallow recap; do turn it into concise study notes. Explain the logic behind processes and relationships, preserve technical terms, and include examples only when supported by the source material. Every chunk summary should contribute only its non-duplicate substantive content to the final notes. Aim for about ${targets.targetNoteWordCount} words when the source supports it. Build about ${targets.recommendedTopicCount} substantial sections when the material supports it. ${structuredPlusInstructions}`;

  const chunkOutputs = await mapWithConcurrency(
    windows,
    NOTE_CHUNK_SUMMARY_CONCURRENCY,
    (window, index) =>
      generateStructuredObject({
        schema: chunkSummarySchema,
        maxOutputTokens: sourceType === "audio" ? 1900 : 1400,
        instructions: chunkInstructions,
        input: `Source chunk ${index + 1} of ${windows.length}.\nTime range: ${window.startMs}-${window.endMs} ms.\nText:\n${window.text}`,
      }),
  );

  const result = await generateStructuredObject({
    schema: noteArtifactSchema,
    maxOutputTokens:
      sourceType === "audio"
        ? Math.min(12000, Math.max(7000, Math.round(targets.maxNoteWordCount * 2.4)))
        : Math.min(7000, Math.max(5200, Math.round(targets.maxNoteWordCount * 2.8))),
    instructions: finalInstructions,
    input: JSON.stringify(
      {
        sourceType,
        sourceWordCount,
        chunkCount: chunkOutputs.length,
        targets,
        sourceTitleHint: params.sourceTitleHint ?? null,
        chunkSummaries: chunkOutputs,
      },
      null,
      2,
    ),
  });

  let normalizedStructuredNotesMd = normalizeStudyListSections(
    stripHtmlFromNotes(result.structuredNotesMd),
  );
  let finalResult = result;

  if (countWords(normalizedStructuredNotesMd) > Math.round(targets.maxNoteWordCount * 1.08)) {
    finalResult = await generateStructuredObject({
      schema: noteArtifactSchema,
      maxOutputTokens:
        sourceType === "audio"
          ? Math.min(11000, Math.max(6500, Math.round(targets.maxNoteWordCount * 2.2)))
          : Math.min(6500, Math.max(4800, Math.round(targets.maxNoteWordCount * 2.5))),
      instructions: buildNoteCompressionInstructions({
        outputLanguage: params.outputLanguage,
        targetNoteWordCount: targets.targetNoteWordCount,
        minNoteWordCount: targets.minNoteWordCount,
        maxNoteWordCount: targets.maxNoteWordCount,
        recommendedTopicCount: targets.recommendedTopicCount,
      }),
      input: JSON.stringify(
        {
          sourceType,
          sourceWordCount,
          targets,
          sourceTitleHint: params.sourceTitleHint ?? null,
          overlongNotes: {
            title: result.title,
            summary: result.summary,
            keyTopics: result.keyTopics,
            structuredNotesMd: normalizedStructuredNotesMd,
            wordCount: countWords(normalizedStructuredNotesMd),
          },
        },
        null,
        2,
      ),
    });
    normalizedStructuredNotesMd = normalizeStudyListSections(
      stripHtmlFromNotes(finalResult.structuredNotesMd),
    );
  }

  const normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);

  return {
    ...finalResult,
    structuredNotesMd: normalizedStructuredNotesMd,
    modelMetadata: {
      chunkCount: chunkOutputs.length,
      sourceWordCount,
      noteWordCount: normalizedNoteWordCount,
      coverageRatio:
        sourceWordCount > 0
          ? Number((normalizedNoteWordCount / sourceWordCount).toFixed(3))
          : null,
      targetNoteWordCount: targets.targetNoteWordCount,
      recommendedTopicCount: targets.recommendedTopicCount,
      sourceType,
      pipeline: params.pipelineName,
    },
  };
}
