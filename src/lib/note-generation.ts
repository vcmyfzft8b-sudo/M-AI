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

type SourceProfileKind = "insufficient" | "short" | "standard" | "long";

interface StudySignalProfile {
  hasStudySignal: boolean;
  score: number;
  reasons: string[];
}

interface SourceProfile {
  kind: SourceProfileKind;
  sourceWordCount: number;
  hasStudySignal: boolean;
  signalScore: number;
  signalReasons: string[];
}

export class InsufficientSourceMaterialError extends Error {
  readonly diagnostics: SourceProfile;

  constructor(params: {
    sourceType: "audio" | "document";
    profile: SourceProfile;
  }) {
    super(getInsufficientSourceMessage(params.sourceType));
    this.name = "InsufficientSourceMaterialError";
    this.diagnostics = params.profile;
  }
}

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

function getInsufficientSourceMessage(sourceType: "audio" | "document") {
  return sourceType === "audio"
    ? "We could not create high-quality notes because the recording contains too little usable speech. Try recording more explanation or uploading fuller material."
    : "This source is too short to create useful study notes. Add more material with definitions, examples, steps, or key facts.";
}

function analyzeStudySignal(text: string): StudySignalProfile {
  const reasons: string[] = [];
  const normalized = text.normalize("NFKC");
  const lower = normalized.toLowerCase();
  const sentences = normalized
    .split(/[.!?;\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => countWords(sentence) >= 6);
  const contentWords = lower.match(/\p{L}{4,}/gu) ?? [];
  const uniqueContentWords = new Set(contentWords);
  const namedConcepts = normalized.match(/\b[A-ZČŠŽ][\p{L}\d-]{2,}\b/gu) ?? [];
  let score = 0;

  if (sentences.length >= 2) {
    score += 1;
    reasons.push("multiple_substantive_sentences");
  }

  if (
    /\b(definition|defined as|means|refers to|is called|represents|definicija|pomeni|imenuje|predstavlja|metoda|sistem|model|koncept)\b/i.test(
      normalized,
    )
  ) {
    score += 2;
    reasons.push("definition_or_named_concept");
  }

  if (
    /\b(first|second|third|step|phase|process|cause|effect|because|therefore|for example|types?|categories?|compare|difference|primer|korak|faza|proces|vzrok|posledica|ker|zato|vrste|kategorije|primerjava|razlika)\b/i.test(
      normalized,
    )
  ) {
    score += 1;
    reasons.push("relationship_or_process_language");
  }

  if (/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+|\d|%|=|:/.test(normalized)) {
    score += 1;
    reasons.push("structured_or_numeric_detail");
  }

  if (namedConcepts.length >= 2) {
    score += 1;
    reasons.push("named_terms");
  }

  if (uniqueContentWords.size >= 12) {
    score += 1;
    reasons.push("content_word_variety");
  }

  return {
    hasStudySignal: score >= 2,
    score,
    reasons,
  };
}

function buildSourceProfile(params: {
  sourceText: string;
  sourceWordCount: number;
  sourceType: "audio" | "document";
  chunkCount: number;
}): SourceProfile {
  const signal = analyzeStudySignal(params.sourceText);

  if (params.sourceWordCount < 40) {
    return {
      kind: "insufficient",
      sourceWordCount: params.sourceWordCount,
      hasStudySignal: signal.hasStudySignal,
      signalScore: signal.score,
      signalReasons: ["too_few_words", ...signal.reasons],
    };
  }

  if (params.sourceWordCount < 80 && !signal.hasStudySignal) {
    return {
      kind: "insufficient",
      sourceWordCount: params.sourceWordCount,
      hasStudySignal: false,
      signalScore: signal.score,
      signalReasons: ["low_signal_short_source", ...signal.reasons],
    };
  }

  return {
    kind:
      params.sourceWordCount <= 250
        ? "short"
        : params.sourceWordCount >= 1200 ||
            (params.sourceType === "audio" && params.chunkCount >= 3)
          ? "long"
          : "standard",
    sourceWordCount: params.sourceWordCount,
    hasStudySignal: signal.hasStudySignal,
    signalScore: signal.score,
    signalReasons: signal.reasons,
  };
}

function formatSegmentsForDirectGeneration(segments: TranscriptSegmentInput[]) {
  return segments
    .map((segment) => {
      const label = segment.speakerLabel?.trim();
      return label ? `[${label}] ${segment.text}` : segment.text;
    })
    .join("\n");
}

function buildAudioTranscriptOnlyResult(params: {
  sourceProfile: SourceProfile;
  sourceText: string;
  outputLanguage?: string | null;
  pipelineName: string;
}): NoteGenerationResult {
  const languageCode = normalizeNoteLanguage(params.outputLanguage);
  const isSlovenian = languageCode === "sl";
  const title = isSlovenian ? "Prepis posnetka" : "Recording Transcript";
  const summary = isSlovenian
    ? "V posnetku ni bilo dovolj uporabnega govora za kakovostne strukturirane zapiske, zato je prikazan očiščen prepis."
    : "The recording did not contain enough usable speech for high-quality structured notes, so a cleaned transcript is shown instead.";
  const keyTopics = isSlovenian ? ["Prepis"] : ["Transcript"];
  const messageHeading = isSlovenian ? "## Prepis namesto zapiskov" : "## Transcript instead of notes";
  const transcriptHeading = isSlovenian ? "## Prepis" : "## Transcript";
  const message = isSlovenian
    ? "V posnetku je bilo povedanega premalo, da bi Memo ustvaril zanesljive strukturirane zapiske. Spodaj je zato prikazan čist prepis povedanega, da se vseeno ohrani vsebina."
    : "Too little was said in the recording for Memo to create reliable structured notes. A clean transcript is shown below so the captured content is still preserved.";
  const structuredNotesMd = normalizeStudyListSections(
    `${messageHeading}\n\n> **${isSlovenian ? "Opomba" : "Note"}:** ${message}\n\n${transcriptHeading}\n\n${params.sourceText}`,
  );
  const noteWordCount = countWords(structuredNotesMd);
  const sourceWordCount = params.sourceProfile.sourceWordCount;

  return {
    title,
    summary,
    keyTopics,
    structuredNotesMd,
    modelMetadata: {
      chunkCount: 0,
      sourceWordCount,
      noteWordCount,
      coverageRatio:
        sourceWordCount > 0 ? Number((noteWordCount / sourceWordCount).toFixed(3)) : null,
      sourceProfile: {
        ...params.sourceProfile,
        fallback: "audio_transcript_only",
      },
      sourceType: "audio",
      pipeline: params.pipelineName,
    },
  };
}

function getFinalNoteOutputTokenBudget(params: {
  sourceType: "audio" | "document";
  sourceProfile: SourceProfile;
  sourceWordCount: number;
}) {
  if (params.sourceProfile.kind === "short") {
    return 2600;
  }

  if (params.sourceProfile.kind === "long") {
    return params.sourceType === "audio" ? 20000 : 16000;
  }

  return params.sourceType === "audio"
    ? Math.min(16000, Math.max(8000, Math.round(params.sourceWordCount * 3)))
    : Math.min(12000, Math.max(6000, Math.round(params.sourceWordCount * 3)));
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
  sourceProfile: SourceProfile;
}) {
  const labels = getStructuredPlusLabels(params.outputLanguage);
  const emojiInstruction =
    "Every markdown heading must start with one relevant emoji followed by a space, for example \"## 🧭 Heading\" or \"### 💡 Heading\". Choose emojis that match the section meaning or topic. There is no total emoji limit. You may also use emojis inside callouts or bullets when they are genuinely helpful, but do not decorate every bullet.";

  return `Use a research-based "compressed expert study notes" style: select the important ideas, organize them clearly, signal what matters, and remove repetition or low-value wording. Cover the material by concepts, not by rewriting every sentence.

Core length rule:
- Cover every important source-supported idea, but do not add filler to reach a length.
- Short sources should produce short notes. Long, dense sources may produce longer notes when needed.
- Never invent facts, examples, definitions, or relationships that are not supported by the source.
- Do not omit distinct names, dates, works, periods, categories, comparisons, examples, or teacher-emphasized points merely to keep the note short.

Use this stable Structured Plus markdown format with these exact heading labels after a relevant emoji prefix:
- Start with a heading like "## 🧭 ${labels.overview.replace(/^##\s+/, "")}" containing concise sentences that explain the whole material.
- Add a semantic blockquote callout in this form only when the source has a genuinely important takeaway: "> **${labels.keyTakeaway}:** ...".
- Add a heading like "## 🔑 ${labels.keyThings.replace(/^##\s+/, "")}" with complete bullet points for the main ideas. Use fewer bullets when the source only contains a few ideas.
- Include a concise GFM markdown table only when the source contains comparable concepts, categories, systems, components, terms, steps, or cause-effect relationships that become clearer in a table.
- Create numbered topic sections such as "## 📌 ${labels.topicExample.replace(/^##\s+/, "")}" only for distinct source-supported concepts that need explanation. Merge related chunks into one topic instead of creating a section for every chunk.
- Inside each substantial topic, use headings like "### 💡 ${labels.coreIdea.replace(/^###\s+/, "")}" and "### 📝 ${labels.detailedNotes.replace(/^###\s+/, "")}". Use emoji-prefixed versions of "${labels.keyTerms}", "${labels.example}", "${labels.compare}", "${labels.process}", or "${labels.checkYourself}" only when they add real study value.
- "${labels.coreIdea}" must be exactly 1 sentence.
- "${labels.detailedNotes}" should usually contain a short explanatory paragraph plus hyphen bullets when the material is naturally list-like. Do not force every concept into a bullet.
- Use hyphen bullet lists only when the material is naturally list-like: steps, components, causes, benefits, risks, grouped examples, questions, takeaways, or direct comparisons. This follows good study-note design by segmenting related ideas so learners can scan, compare, and self-test more easily.
- Avoid nested bullet lists unless the source contains an actual component list or process. If nested bullets are needed, keep them short.
- Use labeled bullets only when the label is semantically important, for example "- **${labels.definition}:** ...", "- **${labels.keyTakeaway}:** ...", "- **${labels.example}:** ...", "- **Razlika:** ...", "- **Korak:** ...", "- **Pazi:** ...". Do not label every ordinary bullet just for style.
- When a concept has multiple examples, use a short hyphen list under the concept. Do not write examples as several standalone paragraphs.
- Use normal paragraphs for "${labels.overview}", "${labels.coreIdea}", short explanations, and semantic callouts. Avoid long runs of paragraph after paragraph, but do not overuse bullets.
- For unordered lists, always use "- " as the Markdown bullet marker. Do not use "*" or "+" bullets.
- Use GFM markdown tables only when they make terminology, comparisons, categories, formulas, steps, or cause-effect relationships shorter and easier to understand than prose. Tables must compress information, not duplicate the surrounding bullets. Format every table with leading and trailing pipes in the header, separator, and body rows.
- Use semantic blockquote callouts in the selected language for visible highlighting where it actually helps learning. Do not turn every example into a callout. Supported forms: "> **${labels.definition}:** ...", "> **${labels.example}:** ...", "> **${labels.commonMistake}:** ...", or "> **${labels.keyTakeaway}:** ...".
- Include source-grounded examples or worked explanations only when they clarify a difficult concept and the source supports them. Most examples should be normal text under "${labels.example}", not blockquote callouts. Skip generic examples.
- Add an emoji-prefixed "${labels.checkYourself}" heading only when the source contains enough concrete facts for useful self-testing. Format it as a hyphen bullet list with short questions that are answerable from the notes.
- End with a heading like "## ✅ ${labels.finalReview.replace(/^##\s+/, "")}" formatted as a hyphen bullet list containing tight takeaways and any confusing points or common mistakes supported by the source.

Source profile: ${params.sourceProfile.kind}.
${
  params.sourceProfile.kind === "short"
    ? `Compact note rules:
- Keep the note proportional to the short source.
- Use "${labels.overview}", "${labels.keyThings}", and "${labels.finalReview}" as the default structure.
- Use 2-5 key bullets, or fewer if the source only supports fewer.
- Skip numbered topic sections, tables, callouts, and "${labels.checkYourself}" unless the source clearly supports them.
- Do not pad with background context, study advice, or generic explanations.`
    : params.sourceProfile.kind === "long"
      ? `Long source rules:
- Include as many numbered topic sections as needed to cover all distinct important concepts from the source.
- Every chunk summary should contribute its non-duplicate facts, names, dates, works, classifications, comparisons, and examples to the final notes.
- If the source names multiple authors, works, periods, terms, or categories, preserve them in organized bullets or tables instead of collapsing them into broad generalizations.
- Keep each section concise and source-grounded, but prefer adding another useful section over dropping important material.
- Prefer synthesis and deduplication over transcript rewriting.`
      : `Standard source rules:
- Use enough numbered topic sections to cover the distinct important concepts.
- Every chunk summary should contribute its non-duplicate important facts.
- Keep sections concise and do not add structure for weak or repeated material.`
}

Compression rules:
- Keep named concepts, definitions, formulas, categories, process steps, comparisons, examples that explain hard ideas, and exam-relevant caveats.
- Merge duplicate ideas across chunks. Omit repeated objectives, transition phrases, obvious restatements, filler, and examples that do not add new understanding.
- Prefer signal words and structure over extra prose: "zato", "posledica", "razlika", "korak", "primer", "pazi".
- Preserve coverage by writing concise organized study notes, not by making the note longer.

Return markdown only. Do not use HTML tags. Do not include decorative color instructions or unsupported facts. ${emojiInstruction}`;
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
  const sourceText = formatSegmentsForDirectGeneration(segments);
  const sourceProfile = buildSourceProfile({
    sourceText,
    sourceWordCount,
    sourceType,
    chunkCount: windows.length,
  });

  if (sourceProfile.kind === "insufficient") {
    if (sourceType === "audio") {
      return buildAudioTranscriptOnlyResult({
        sourceProfile,
        sourceText,
        outputLanguage: params.outputLanguage,
        pipelineName: params.pipelineName,
      });
    }

    throw new InsufficientSourceMaterialError({
      sourceType,
      profile: sourceProfile,
    });
  }

  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const languageLabel = resolveNoteLanguageLabel(params.outputLanguage);
  const chunkInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You create detailed study notes from spoken lecture transcripts. Capture every substantive point from the chunk, including definitions, mechanisms, sequences, comparisons, examples, clarifications, caveats, dates, names, works, categories, and exam-relevant details. Preserve technical terms and explain abbreviated or implied ideas when the transcript supports them. Do not compress the lecture into a short recap. Never invent facts. Bullet points must be complete study points, not fragments.`
      : `${languageInstruction} You create detailed study notes from lecture-style source material. Capture every substantive point from the chunk, including definitions, mechanisms, sequences, comparisons, caveats, examples already present in the source, dates, names, works, categories, and exam-relevant details. Never invent facts. Bullet points must be complete study points, not fragments.`;
  const structuredPlusInstructions = buildStructuredPlusInstructions({
    outputLanguage: params.outputLanguage,
    sourceProfile,
  });
  const finalInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover every important source-supported idea without unnecessary text. This is a spoken lecture transcript, so reconstruct the material into clean, structured notes and merge repeated spoken ideas. Include important definitions, steps, relationships, examples, clarifications, names, dates, works, classifications, and lecturer-added context when supported by the transcript. Do not turn the lecture into a shallow recap; do turn it into complete but summarized study notes. Explain the logic behind processes and relationships when the transcript supports it. Cover every important source-supported idea, but do not add filler to reach a length. ${structuredPlusInstructions}`
      : `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce a title, summary, key topics, and student-ready notes that cover every important source-supported idea without unnecessary text. Do not turn the material into a shallow recap; do turn it into complete but summarized study notes. Explain the logic behind processes and relationships, preserve technical terms, and include examples, names, dates, works, and classifications when supported by the source material. Cover every important source-supported idea, but do not add filler to reach a length. ${structuredPlusInstructions}`;

  const chunkOutputs =
    sourceProfile.kind === "short"
      ? []
      : await mapWithConcurrency(
          windows,
          NOTE_CHUNK_SUMMARY_CONCURRENCY,
          (window, index) =>
            generateStructuredObject({
              schema: chunkSummarySchema,
              maxOutputTokens: sourceType === "audio" ? 2800 : 1900,
              instructions: chunkInstructions,
              input: `Source chunk ${index + 1} of ${windows.length}.\nTime range: ${window.startMs}-${window.endMs} ms.\nText:\n${window.text}`,
            }),
        );

  const result = await generateStructuredObject({
    schema: noteArtifactSchema,
    maxOutputTokens: getFinalNoteOutputTokenBudget({
      sourceType,
      sourceProfile,
      sourceWordCount,
    }),
    instructions: finalInstructions,
    input: JSON.stringify(
      sourceProfile.kind === "short"
        ? {
            sourceType,
            sourceWordCount,
            sourceProfile,
            sourceTitleHint: params.sourceTitleHint ?? null,
            sourceText,
          }
        : {
            sourceType,
            sourceWordCount,
            sourceProfile,
            chunkCount: chunkOutputs.length,
            sourceTitleHint: params.sourceTitleHint ?? null,
            chunkSummaries: chunkOutputs,
          },
      null,
      2,
    ),
  });

  const normalizedStructuredNotesMd = normalizeStudyListSections(
    stripHtmlFromNotes(result.structuredNotesMd),
  );
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
      sourceProfile,
      sourceType,
      pipeline: params.pipelineName,
    },
  };
}
