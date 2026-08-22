import "server-only";

import { chunkSummarySchema, noteArtifactSchema } from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildTranscriptWindows } from "@/lib/chunking";
import {
  buildGeneratedContentLanguageInstruction,
  normalizeNoteLanguage,
  resolveNoteLanguageLabel,
} from "@/lib/languages";
import {
  countWords,
  normalizeGeneratedNoteMarkdown,
} from "@/lib/notes/note-prompts";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";

const NOTE_CHUNK_SUMMARY_CONCURRENCY = 2;
const MATH_FORMATTING_INSTRUCTIONS = `Formula formatting rules:
- Use valid Markdown math for every formula and variable expression.
- Put full equations on one display-math line like $$I_{t/0} = \\frac{Y_t}{Y_0} \\cdot 100$$.
- Use inline math \\(Y_t\\) only for short variables inside a sentence.
- Use LaTeX subscripts, fractions, exponents, roots, functions, Greek letters, inequalities, arrows, sums, and integrals: \\(Y_t\\), \\(Y_{t-1}\\), \\(I_{t/0}\\), \\frac{a}{b}, x^2, \\sqrt{x}, \\sin(x), \\alpha, \\le, \\to, \\sum, and \\int.
- For multi-line derivations, use one display math block with an aligned environment inside: $$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$.
- Never write raw dollar-sign inline math, broken subscripts like $Yt$ or $I{t/0}$, or plain text formulas like Yt / Y0 100.`;

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
  recommendedTopicCount: number;
}) {
  const labels = getStructuredPlusLabels(params.outputLanguage);

  return `Use a selective expert study-notes style: read the source section by section, decide what the learner actually needs to know, and turn that into clear summarized notes with explanations. Cover the material by concepts and learning value, not by rewriting every sentence.

Selection rules:
- For each source section or chunk, identify the important learning points: central concepts, definitions, rules, formulas, processes, comparisons, causes and effects, exceptions, caveats, and source examples that make a concept easier to understand.
- Omit filler, repeated explanations, transitions, obvious restatements, low-value details, and examples that do not add new understanding.
- Merge duplicate ideas across chunks. If a later section repeats an idea that is already explained, only add genuinely new nuance.
- If a source section is mostly low-value, skip or merge it after preserving any useful concept it contains.
- Summarize meaningfully. Do not copy every fact, sentence, bullet, or tiny detail from the source.
- Do not use a fixed word-count target. The note should be as long as needed to explain the important material well and no longer. Dense material can produce longer notes; simple material should stay short.
- Prefer clear explanations plus a few useful bullets over long prose. Include examples only when they support understanding and are grounded in the source.
- If the source includes embedded document visual context, use it only when it is useful for studying the same concept. Fold the visual's actual concept into the relevant topic instead of writing a generic caption or separate image section.
- Preserve mathematical notation as formulas when the source supports it. ${MATH_FORMATTING_INSTRUCTIONS}

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

Return markdown only. Do not use HTML tags. Do not include decorative color instructions or unsupported facts. Use 2-5 logical emojis total in major section headings or the top callout to improve scanning, for example one emoji before a few numbered topic headings. Do not use emojis on every bullet or make the notes feel childish.`;
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
      ? `${languageInstruction} You create source cards from spoken lecture transcript chunks. Identify the study-worthy material in this chunk: definitions, mechanisms, sequences, comparisons, formulas, examples, clarifications, caveats, and exam-relevant details. Preserve technical terms and explain abbreviated or implied ideas when the transcript supports them. Skip filler, repeated phrases, low-value asides, and examples that add no new understanding. Never invent facts. Bullet points must be complete study points, not fragments. ${MATH_FORMATTING_INSTRUCTIONS}`
      : `${languageInstruction} You create source cards from lecture-style source material. Identify the study-worthy material in this chunk: definitions, mechanisms, sequences, comparisons, formulas, caveats, examples already present in the source, and exam-relevant details. Skip filler, repeated wording, low-value details, and examples that add no new understanding. Never invent facts. Bullet points must be complete study points, not fragments. ${MATH_FORMATTING_INSTRUCTIONS}`;
  const structuredPlusInstructions = buildStructuredPlusInstructions({
    outputLanguage: params.outputLanguage,
    recommendedTopicCount: targets.recommendedTopicCount,
  });
  const finalInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover the important material in the source without unnecessary text. This is a spoken lecture transcript, so reconstruct the material into clean, structured notes and merge repeated spoken ideas. Work section by section through the lecture: decide what the learner needs to know, explain it clearly, and skip filler or repetition. Include important definitions, steps, relationships, formulas, examples, clarifications, and lecturer-added context when supported by the transcript. Do not turn the lecture into a shallow recap and do not rewrite every detail; turn it into concise study notes that preserve the important ideas. Explain the logic behind processes and relationships, preserve technical terms, and include examples only when they help understanding and are supported by the source material. Every chunk summary should contribute only its non-duplicate substantive content to the final notes. Build about ${targets.recommendedTopicCount} substantial sections when the material supports it. ${structuredPlusInstructions}`
      : `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover the important material in the source without unnecessary text. Work section by section through the material: decide what the learner needs to know, explain it clearly, and skip filler or repetition. Do not turn the material into a shallow recap and do not rewrite every detail; turn it into concise study notes that preserve the important concepts, formulas, relationships, processes, visual references, and examples. Explain the logic behind processes and relationships, preserve technical terms, and include examples only when they help understanding and are supported by the source material. Every chunk summary should contribute only its non-duplicate substantive content to the final notes. Build about ${targets.recommendedTopicCount} substantial sections when the material supports it. ${structuredPlusInstructions}`;

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

  const normalizedStructuredNotesMd = normalizeGeneratedNoteMarkdown(result.structuredNotesMd);

  const normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);

  return {
    ...result,
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
