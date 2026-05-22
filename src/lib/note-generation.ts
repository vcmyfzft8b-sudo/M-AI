import "server-only";

import {
  noteArtifactSchema,
  noteCoverageExtractionSchema,
  noteCoverageReviewSchema,
} from "@/lib/ai/schemas";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildTranscriptWindows } from "@/lib/chunking";
import {
  buildGeneratedContentLanguageInstruction,
  normalizeNoteLanguage,
  resolveNoteLanguageLabel,
} from "@/lib/languages";
import { getServerEnv } from "@/lib/server-env";
import type { NoteGenerationResult, TranscriptSegmentInput } from "@/lib/types";

const NOTE_COVERAGE_EXTRACTION_CONCURRENCY = 2;
const DIRECT_DOCUMENT_SOURCE_MAX_CHARS = 60_000;
const DIRECT_AUDIO_SOURCE_MAX_CHARS = 42_000;

type CoverageUnit = {
  category:
    | "concept"
    | "definition"
    | "formula"
    | "example"
    | "comparison"
    | "process"
    | "warning"
    | "exercise"
    | "ocr_addition";
  heading: string;
  details: string[];
  sourceEvidence: string;
  importance: "core" | "supporting" | "context";
  needsExplanation: boolean;
};

type NoteLengthLimits = {
  sourceSize: "short" | "modest" | "long";
  targetNoteWords: number;
  maxNoteWords: number;
  maxKeyTopics: number;
  maxKeyThingBullets: number;
  maxNumberedSections: number;
  maxOverviewSentences: number;
  maxCheckQuestions: number;
  maxFinalReviewBullets: number;
  tablePolicy: string;
};

type NoteGenerationMode = "study_value" | "strict_limits";

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

  for (const line of lines) {
    const blockquote = /^>\s+(.+)$/.exec(line.trim());

    if (blockquote) {
      normalizedLines.push(line);
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

function hasLeadingEmoji(value: string) {
  return /^\s*(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(value);
}

function pickHeadingEmoji(heading: string) {
  const normalized = normalizeTitleForComparison(heading);

  if (/\b(hiter pregled|quick overview|overview|pregled)\b/u.test(normalized)) {
    return "🧭";
  }

  if (
    /\b(kljucne stvari|key things|must know|moras znati|zapomniti)\b/u.test(
      normalized,
    )
  ) {
    return "🧠";
  }

  if (/\b(glavna ideja|core idea|ideja)\b/u.test(normalized)) {
    return "💡";
  }

  if (/\b(podrobni zapiski|detailed notes|zapiski)\b/u.test(normalized)) {
    return "📝";
  }

  if (/\b(kljucni pojmi|key terms|termini|pojmi)\b/u.test(normalized)) {
    return "🔑";
  }

  if (/\b(primer|example|vaja|exercise)\b/u.test(normalized)) {
    return "📌";
  }

  if (/\b(primerjava|compare|razlika|difference)\b/u.test(normalized)) {
    return "⚖️";
  }

  if (/\b(proces|process|koraki|steps|postopek)\b/u.test(normalized)) {
    return "🔄";
  }

  if (/\b(preveri|check yourself|questions|vprasanja)\b/u.test(normalized)) {
    return "❓";
  }

  if (/\b(koncni pregled|final review|review|ponovitev)\b/u.test(normalized)) {
    return "✅";
  }

  if (
    /\b(formula|enacba|equation|statistika|indeks|index|matematika|math)\b/u.test(
      normalized,
    )
  ) {
    return "🧮";
  }

  if (/\b(pazi|napaka|warning|mistake|caveat)\b/u.test(normalized)) {
    return "⚠️";
  }

  return "📚";
}

function ensureHeadingEmojis(markdown: string) {
  const lines = markdown.split("\n");
  let inCodeFence = false;

  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      if (inCodeFence) {
        return line;
      }

      const heading = /^(#{1,6})(\s+)(.+?)\s*$/.exec(line);

      if (!heading) {
        return line;
      }

      const [, hashes, spacing, text] = heading;

      if (hasLeadingEmoji(text)) {
        return line;
      }

      return `${hashes}${spacing}${pickHeadingEmoji(text)} ${text}`;
    })
    .join("\n");
}

function cleanMathFormula(formula: string) {
  return formula.replace(/\s+/g, " ").trim();
}

function shouldRenderAsMath(formula: string) {
  return /[=\\_^{}]/.test(formula);
}

function normalizeFormulaMarkdown(markdown: string) {
  return markdown
    .replace(/\${3,}/g, "$$")
    .replace(/\$\$(?=\s*(?:[-*+]\s|#{1,6}\s|>))/g, "$$\n")
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, formula: string) => {
      const cleanedFormula = cleanMathFormula(formula);

      if (!shouldRenderAsMath(cleanedFormula)) {
        return cleanedFormula;
      }

      return `\n\n$$\n${cleanedFormula}\n$$\n\n`;
    })
    .replace(/(\bFormula\b[^$\n]{0,80}?)\s*\$\s*([^$\n]{3,420}?)\s*\$/gi, (_match, label: string, formula: string) => {
      const cleanedFormula = cleanMathFormula(formula);

      if (!shouldRenderAsMath(cleanedFormula)) {
        return `${label} ${cleanedFormula}`;
      }

      return `${label.trim()}\n\n$$\n${cleanedFormula}\n$$`;
    })
    .replace(/\$\s*([^$\n]{3,420}?)\s*\$/g, (_match, formula: string) => {
      const cleanedFormula = cleanMathFormula(formula);

      if (!shouldRenderAsMath(cleanedFormula)) {
        return cleanedFormula;
      }

      return `$$\n${cleanedFormula}\n$$`;
    })
    .replace(/\bFormula\s*:/gi, "Formula:");
}

function normalizeTitleForComparison(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitleCandidate(value?: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/^#+\s*/, "")
    .replace(/^\d+[\s.)-]+/, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 3) {
    return null;
  }

  return cleaned.length > 96 ? cleaned.slice(0, 96).replace(/[,\s;:-]+$/u, "").trim() : cleaned;
}

function isGenericNoteTitle(value?: string | null) {
  const cleaned = cleanTitleCandidate(value);

  if (!cleaned) {
    return true;
  }

  const normalized = normalizeTitleForComparison(cleaned);
  const genericTitles = new Set([
    "hiter pregled",
    "quick overview",
    "overview",
    "pregled",
    "zapiski",
    "notes",
    "lecture notes",
    "structured notes",
    "student ready notes",
    "study notes",
  ]);

  return genericTitles.has(normalized);
}

function titleCaseFirst(value: string) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function deriveTitleFromSummary(summary?: string | null) {
  const firstSentence = cleanTitleCandidate(summary?.split(/[.!?]\s/u)[0]);

  if (!firstSentence) {
    return null;
  }

  const withoutLead = firstSentence
    .replace(/^(predavanje|gradivo|zapiski|snov)\s+(obravnava|pojasnjuje|razlozi|razlaga|predstavi)\s+/iu, "")
    .replace(/^(the\s+)?(lecture|material|source|notes)\s+(covers|explains|discusses|presents)\s+/iu, "")
    .replace(/^kljucne\s+vidike\s+/iu, "")
    .replace(/^ključne\s+vidike\s+/iu, "")
    .trim();

  if (!withoutLead || isGenericNoteTitle(withoutLead)) {
    return null;
  }

  return cleanTitleCandidate(titleCaseFirst(withoutLead));
}

function deriveTitleFromTopics(keyTopics: string[], coverageUnits: CoverageUnit[]) {
  const candidates = [
    ...keyTopics,
    ...coverageUnits
      .filter((unit) => unit.importance === "core")
      .map((unit) => unit.heading),
    ...coverageUnits.map((unit) => unit.heading),
  ]
    .map(cleanTitleCandidate)
    .filter((candidate): candidate is string => Boolean(candidate) && !isGenericNoteTitle(candidate));

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  return cleanTitleCandidate(`${candidates[0]} in ${candidates[1]}`);
}

function normalizeGeneratedNoteTitle(params: {
  title?: string | null;
  sourceTitleHint?: string | null;
  summary?: string | null;
  keyTopics: string[];
  coverageUnits: CoverageUnit[];
  sourceType: "audio" | "document";
}) {
  if (!isGenericNoteTitle(params.title)) {
    return cleanTitleCandidate(params.title) ?? params.title ?? "Zapiski";
  }

  if (!isGenericNoteTitle(params.sourceTitleHint)) {
    return cleanTitleCandidate(params.sourceTitleHint) ?? params.sourceTitleHint ?? "Zapiski";
  }

  return (
    deriveTitleFromSummary(params.summary) ??
    deriveTitleFromTopics(params.keyTopics, params.coverageUnits) ??
    (params.sourceType === "audio" ? "Predavanje" : "Zapiski")
  );
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

function buildCoverageUnitKey(unit: Pick<CoverageUnit, "category" | "heading">) {
  return `${unit.category}:${unit.heading}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeImportance(
  left: CoverageUnit["importance"],
  right: CoverageUnit["importance"],
): CoverageUnit["importance"] {
  const rank: Record<CoverageUnit["importance"], number> = {
    context: 0,
    supporting: 1,
    core: 2,
  };

  return rank[right] > rank[left] ? right : left;
}

function dedupeCoverageUnits(units: CoverageUnit[]) {
  const byKey = new Map<string, CoverageUnit>();

  for (const unit of units) {
    const key = buildCoverageUnitKey(unit);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        ...unit,
        details: unit.details.slice(0, 6),
      });
      continue;
    }

    const mergedDetails = [...existing.details];

    for (const detail of unit.details) {
      const normalized = detail
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");

      if (
        !mergedDetails.some((existingDetail) =>
          existingDetail
            .toLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .includes(normalized.slice(0, 40)),
        )
      ) {
        mergedDetails.push(detail);
      }
    }

    byKey.set(key, {
      ...existing,
      details: mergedDetails.slice(0, 6),
      sourceEvidence:
        existing.sourceEvidence.length >= unit.sourceEvidence.length
          ? existing.sourceEvidence
          : unit.sourceEvidence,
      importance: mergeImportance(existing.importance, unit.importance),
      needsExplanation: existing.needsExplanation || unit.needsExplanation,
    });
  }

  return Array.from(byKey.values()).sort((left, right) => {
    const importanceRank: Record<CoverageUnit["importance"], number> = {
      core: 0,
      supporting: 1,
      context: 2,
    };

    return importanceRank[left.importance] - importanceRank[right.importance];
  });
}

function buildCoverageExtractionInstructions(params: {
  outputLanguage?: string | null;
  sourceType: "audio" | "document";
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction} Extract the distinct learning units from this source chunk so final notes can cover the material well without repetition.

Return only source-supported units. Prefer useful study material over filler:
- concepts, definitions, formulas, named methods, categories, comparisons, process steps, warnings/common mistakes, worked examples, exercises, and important OCR/handwritten additions;
- include formulas and explainable symbols as formula units;
- include exercises or worked numerical examples as exercise/example units;
- skip repeated learning objectives, page headers, duplicated slide titles, navigation text, and decorative text;
- split different ideas into separate units, but do not create duplicates for the same idea.

For every unit, include enough details for a student-friendly explanation later. Use "core" importance for exam-relevant material, "supporting" for helpful details/examples, and "context" only when needed to understand the topic.`;
}

function buildStructuredPlusInstructions(params: {
  outputLanguage?: string | null;
}) {
  const labels = getStructuredPlusLabels(params.outputLanguage);

  return `Use a student-friendly study-note style: cover the source thoroughly, explain it clearly, and remove repetition or low-value wording. These are not shallow recap notes, but they must still be summarized study notes instead of a rewritten version of the source. They should help a student understand and study the material without needing the original document open.

Title rule:
- The JSON "title" field must be a concise title for what the source is actually about.
- Never use section labels as the title. Forbidden titles include "${labels.overview.replace(/^#+\s*/, "")}", "Quick Overview", "Overview", "Pregled", "Notes", and "Zapiski".
- The first heading inside structuredNotesMd should still be "${labels.overview}", but that heading is not the artifact title.

Use this stable Structured Plus markdown format with these exact heading label words, prefixed by one logical emoji:
- Start with one logical emoji plus "${labels.overview}" containing a concise, plain-language explanation of the whole material.
- Immediately after "${labels.overview}", add a semantic blockquote callout in this form: "> **${labels.keyTakeaway}:** ...". This creates the main visual highlight.
- Add one logical emoji plus "${labels.keyThings}" with complete bullets for the main ideas a student must remember.
- After "${labels.keyThings}", include a concise GFM markdown table when it makes terminology, comparisons, categories, formulas, steps, or cause-effect relationships easier to understand than prose.
- Then create as many numbered topic sections as the source needs, such as "${labels.topicExample}". Merge duplicates and closely related chunks, but do not merge unrelated learning units just to make the note shorter.
- Inside each substantial topic, use "${labels.coreIdea}" and "${labels.detailedNotes}". Use "${labels.keyTerms}", "${labels.example}", "${labels.compare}", "${labels.process}", or "${labels.checkYourself}" only when they add real study value.
- "${labels.coreIdea}" should be a simple explanation of the main point of that topic.
- "${labels.detailedNotes}" should explain what the concept means, how it works, and why it matters. Use enough detail for understanding, but avoid filler.
- Use hyphen bullet lists when the material is naturally list-like: steps, components, causes, benefits, risks, grouped examples, questions, takeaways, or direct comparisons.
- Avoid nested bullet lists unless the source contains an actual component list or process. If nested bullets are needed, keep them short.
- Use labeled bullets only when the label is semantically important, for example "- **${labels.definition}:** ...", "- **${labels.keyTakeaway}:** ...", "- **${labels.example}:** ...", "- **Razlika:** ...", "- **Korak:** ...", "- **Pazi:** ...". Do not label every ordinary bullet just for style.
- When a concept has multiple examples, use a short hyphen list under the concept. Do not write examples as several standalone paragraphs.
- Use normal paragraphs for "${labels.overview}", "${labels.coreIdea}", short explanations, and semantic callouts. Avoid long runs of paragraph after paragraph, but do not overuse bullets.
- For unordered lists, always use "- " as the Markdown bullet marker. Do not use "*" or "+" bullets.
- Format every GFM table with leading and trailing pipes in the header, separator, and body rows.
- Use semantic blockquote callouts in the selected language only where they actually help learning. Supported forms: "> **${labels.definition}:** ...", "> **${labels.example}:** ...", "> **${labels.commonMistake}:** ...", or "> **${labels.keyTakeaway}:** ...".
- Include source-grounded examples or worked explanations when they clarify a difficult concept and the source supports them. Skip generic invented examples.
- Add "${labels.checkYourself}" near the end. Format it as a hyphen bullet list with questions that are answerable from the notes.
- End with "${labels.finalReview}" formatted as a hyphen bullet list containing tight takeaways and confusing points or common mistakes supported by the source.
- Every markdown heading in structuredNotesMd must start with exactly one logical emoji before the heading text. For example, write "## 🧭 Hiter pregled" or "## 🧭 Quick Overview", not "## Hiter pregled". Also add one logical emoji to every numbered topic heading and every "###" subsection heading. Keep the required heading label text after the emoji.

Coverage and explanation rules:
- Keep named concepts, definitions, formulas, categories, process steps, comparisons, examples that explain hard ideas, and exam-relevant caveats.
- Merge duplicate ideas across chunks. Omit repeated objectives, transition phrases, obvious restatements, filler, and examples that do not add new understanding.
- Explain concepts simply, as if helping a student understand them for the first time.
- Match depth to the source size: short sources need compact explanations; longer dense sources can use more sections, but still summarize instead of rewriting.
- For formulas, explain what each symbol means, when to use the formula, and how to interpret the result.
- Display every important formula as a standalone markdown math block using "$$" delimiters so it can render like a handwritten equation with subscripts. Use LaTeX-style notation for subscripts, superscripts, fractions, and multiplication, for example:
  $$
  V_t = \frac{Y_t}{Y_{t-1}} \cdot 100
  $$
- Put "$$" delimiters on their own lines. Never write "$$$". Never attach a bullet, heading, sentence, or explanation to the same line as "$$".
  Then explain: Y_t = value in the current period; Y_{t-1} = value in the previous period.
  For worked examples, show the symbolic formula in one math block, then the inserted numbers in another math block.
- Do not write formulas as raw text like "Formula: $ ... $" or leave visible "$" characters in normal prose. Use "$$ ... $$" blocks for formula lines, and use "$...$" only for very short inline variables if needed.
- For processes, explain the steps and why the order matters.
- For comparisons, explain the practical difference, not only definitions.
- Prefer clear explanations over overly dense wording.
- Integrate OCR-only or handwritten material into the correct topic instead of leaving it as separate OCR text.
- Do not invent facts, translations, or examples not supported by the source.

Return markdown only. Do not use HTML tags. Do not include decorative color instructions or unsupported facts. Include one logical emoji at the start of every markdown heading. Elsewhere in the notes, include relevant emojis only where they logically improve scanning, memory, or topic recognition, such as key callouts, examples, warnings, formulas, process sections, and final review. Do not use a fixed minimum or maximum count for body emojis. Use emojis as study-signposts, not decoration: choose emojis that match the meaning, avoid random or childish emoji use, and do not place an emoji on every ordinary bullet just for style.`;
}

function resolveNoteLengthLimits(
  sourceWordCount: number,
  sourceType: "audio" | "document",
): NoteLengthLimits {
  if (sourceWordCount < 450) {
    return {
      sourceSize: "short",
      targetNoteWords:
        sourceType === "audio"
          ? Math.max(420, Math.round(sourceWordCount * 1.5))
          : Math.max(320, Math.round(sourceWordCount * 1.25)),
      maxNoteWords:
        sourceType === "audio"
          ? Math.min(760, Math.max(520, Math.round(sourceWordCount * 1.8)))
          : Math.min(620, Math.max(420, Math.round(sourceWordCount * 1.55))),
      maxKeyTopics: 5,
      maxKeyThingBullets: 5,
      maxNumberedSections: 3,
      maxOverviewSentences: 2,
      maxCheckQuestions: 3,
      maxFinalReviewBullets: 4,
      tablePolicy:
        "Do not include a table unless the short source contains a real comparison, formula set, category set, or process that is clearly shorter as a table.",
    };
  }

  if (sourceWordCount < 1200) {
    return {
      sourceSize: "modest",
      targetNoteWords:
        sourceType === "audio"
          ? Math.max(650, Math.round(sourceWordCount * 0.95))
          : Math.max(560, Math.round(sourceWordCount * 0.75)),
      maxNoteWords:
        sourceType === "audio"
          ? Math.min(1250, Math.max(780, Math.round(sourceWordCount * 1.15)))
          : Math.min(1050, Math.max(680, Math.round(sourceWordCount * 0.95))),
      maxKeyTopics: 7,
      maxKeyThingBullets: 7,
      maxNumberedSections: 5,
      maxOverviewSentences: 3,
      maxCheckQuestions: 4,
      maxFinalReviewBullets: 5,
      tablePolicy:
        "Include at most one concise table, and only when it replaces a longer explanation rather than duplicating it.",
    };
  }

  return {
    sourceSize: "long",
    targetNoteWords:
      sourceType === "audio"
        ? Math.max(1300, Math.round(sourceWordCount * 0.55))
        : Math.max(1100, Math.round(sourceWordCount * 0.45)),
    maxNoteWords:
      sourceType === "audio"
        ? Math.min(5200, Math.max(1700, Math.round(sourceWordCount * 0.85)))
        : Math.min(4200, Math.max(1400, Math.round(sourceWordCount * 0.7))),
    maxKeyTopics: 12,
    maxKeyThingBullets: 10,
    maxNumberedSections: 10,
    maxOverviewSentences: 4,
    maxCheckQuestions: 6,
    maxFinalReviewBullets: 7,
    tablePolicy:
      "Use at most two concise tables, and only when they make comparisons, categories, formulas, or processes easier to study.",
  };
}

function buildStrictLengthLimitGuidance(limits: NoteLengthLimits) {
  return `Hard source-size limits for this note:
- Source size profile: ${limits.sourceSize}.
- Aim for about ${limits.targetNoteWords} words and stay under ${limits.maxNoteWords} words unless the source is only sparse keywords that need expansion.
- keyTopics must contain no more than ${limits.maxKeyTopics} items.
- "${limits.sourceSize === "short" ? "Hiter pregled / Quick Overview" : "Overview"}" must be no more than ${limits.maxOverviewSentences} sentences.
- "Key Things To Know / Ključne stvari, ki jih moraš znati" must contain no more than ${limits.maxKeyThingBullets} bullets.
- Use no more than ${limits.maxNumberedSections} numbered topic sections.
- "Check Yourself / Preveri svoje znanje" must contain no more than ${limits.maxCheckQuestions} questions.
- "Final Review / Končni pregled" must contain no more than ${limits.maxFinalReviewBullets} bullets.
- ${limits.tablePolicy}
If the source is short or modest, prioritize concise explanation over extra sections. Do not expand exercise blanks, headings, or examples into long textbook explanations unless the source gives that detail.`;
}

function buildStudyValueGuidance(limits: NoteLengthLimits) {
  return `Optimize these notes for study value per sentence, not for maximum detail.

For every sentence, bullet, table row, and example, ask:
- Does this teach a source-supported idea?
- Does it explain something the student must understand?
- Does it remove likely confusion?
- Is it needed for studying or self-testing?

If the answer is no, omit it.

Use source-size proportionality as a guardrail, not as a target to fill:
- Source size profile: ${limits.sourceSize}.
- Let the amount of notes follow the amount of real learning material in the source.
- Short or sparse sources should become compact notes.
- Long or dense sources can become longer notes, but only when the extra detail improves understanding.
- Keep keyTopics focused on the main study themes instead of listing every small detail.
- Create enough numbered sections to organize the source clearly, but do not create sections just to fill space.
- ${limits.tablePolicy}

Do not expand exercise blanks, headings, table labels, or named topics into generic textbook explanations unless the source actually explains them. Prefer dense, useful, proportional notes over long notes.`;
}

function buildPromptControlGuidance(mode: NoteGenerationMode, limits: NoteLengthLimits) {
  return mode === "strict_limits"
    ? buildStrictLengthLimitGuidance(limits)
    : buildStudyValueGuidance(limits);
}

function buildCoverageReviewInstructions(params: {
  outputLanguage?: string | null;
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction} Review whether these generated notes cover the supplied source and coverage units well enough for a student.

Mark repair as needed when:
- a core coverage unit is missing;
- formulas, symbols, exercises, comparisons, or examples are only named but not explained;
- handwritten/OCR-only additions are missing;
- notes contain unsupported claims;
- notes repeat low-value material while omitting useful material;
- notes are over-expanded compared with the supplied source, especially for short document/photo sources.

Do not request repair just because the notes are concise. Request repair only when coverage, explanation quality, faithfulness, repetition, or source-size balance is materially weak.`;
}

function buildNoteRepairInstructions(params: {
  outputLanguage?: string | null;
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction} Repair the supplied study notes using the review findings, source text, and coverage units.

Keep the same Structured Plus organization and exact localized heading labels already used in the notes. Do not rewrite everything unnecessarily.

Repair goals:
- add missing core concepts, formulas, examples, comparisons, process steps, warnings, exercises, and OCR/handwritten additions;
- expand shallow explanations so a student can understand what the concept means, how it works, and why it matters;
- for formulas, use standalone "$$ ... $$" math blocks with LaTeX-style subscripts/fractions/multiplication so they render as equations, then explain symbols, use cases, and result interpretation;
- remove or merge repeated low-value material;
- compress sections that are over-expanded compared with the source while preserving the important ideas;
- remove unsupported claims;
- keep the notes readable and organized;
- make sure every markdown heading starts with exactly one logical emoji before the heading text;
- include or preserve relevant emojis in logical body locations such as key callouts, examples, warnings, formulas, process sections, and final review. Do not use a fixed minimum or maximum count for body emojis, but do not remove useful emojis just because this is a repair pass.

Return the same JSON fields. For structuredNotesMd, return markdown only with no HTML and no unsupported facts.`;
}

function buildDeterministicCompressionInstructions(params: {
  outputLanguage?: string | null;
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction} Compress the supplied study notes because they are too long for the amount of source material.

Keep the same Structured Plus heading style, but make the notes proportional to the source. This is a compression pass, not a coverage-expansion pass.

Compression goals:
- preserve the important concepts, formulas, definitions, examples, comparisons, process steps, warnings, and OCR/handwritten additions;
- remove duplicated explanations, long overviews, generic textbook expansion, unnecessary examples, and repeated source wording;
- merge related small topics into fewer numbered sections;
- keep explanations simple, but short;
- keep formulas as standalone "$$ ... $$" math blocks with clean equation notation;
- keep the final notes under the supplied maxNoteWords limit;
- obey maxKeyTopics, maxKeyThingBullets, maxNumberedSections, maxCheckQuestions, and maxFinalReviewBullets exactly;
- include a table only when the supplied tablePolicy allows it;
- make sure every markdown heading starts with exactly one logical emoji before the heading text;
- preserve relevant emojis and keep body emojis in logical places where they help scanning or memory. Do not use a fixed minimum or maximum count for body emojis.

Return the same JSON fields. For structuredNotesMd, return markdown only with no HTML and no unsupported facts.`;
}

function buildSourceExcerptPayload(windows: Array<{ text: string }>) {
  return windows.map((window, index) => ({
    chunk: index + 1,
    excerpt: window.text.length > 1600 ? `${window.text.slice(0, 1600)}...` : window.text,
  }));
}

function resolveFinalMaxOutputTokens(sourceWordCount: number, sourceType: "audio" | "document") {
  if (sourceWordCount < 450) {
    return sourceType === "audio" ? 3600 : 2600;
  }

  if (sourceWordCount < 1200) {
    return sourceType === "audio" ? 5600 : 4200;
  }

  const base = sourceType === "audio" ? 7600 : 6200;
  const scaled = Math.round(sourceWordCount * (sourceType === "audio" ? 2.0 : 1.65));
  const cap = sourceType === "audio" ? 16_000 : 14_000;

  return Math.min(cap, Math.max(base, scaled));
}

function resolveCompressionMaxOutputTokens(limits: NoteLengthLimits) {
  return Math.max(1800, Math.min(8000, Math.round(limits.maxNoteWords * 3.2)));
}

function buildSummarizationDepthGuidance(sourceWordCount: number, sourceType: "audio" | "document") {
  if (sourceWordCount < 450) {
    return `The source is short. Produce compact notes that explain the important ideas clearly, but do not expand the notes beyond the source unless the source is only sparse keywords. Avoid turning a short photo or small excerpt into a long article.`;
  }

  if (sourceWordCount < 1200) {
    return `The source is modest in length. Produce concise study notes that are clearly shorter than the source while preserving the important concepts, definitions, examples, and formulas. Add explanations only where they improve understanding.`;
  }

  if (sourceType === "audio") {
    return `The source is a longer spoken transcript. Summarize repeated spoken material aggressively, but keep lecturer-added explanations, examples, mechanisms, definitions, and caveats that matter for studying.`;
  }

  return `The source is a longer document. Produce summarized study notes, not a rewrite. The notes should usually be meaningfully shorter than the source while still covering every distinct high-value learning unit once.`;
}

function shouldRepairNotes(review: {
  needsRepair: boolean;
  missingUnitHeadings: string[];
  shallowExplanationHeadings: string[];
  unsupportedClaims: string[];
  repeatedOrLowValueSections: string[];
  overExpandedSections: string[];
}) {
  return (
    review.needsRepair &&
    (review.missingUnitHeadings.length > 0 ||
      review.shallowExplanationHeadings.length > 1 ||
      review.unsupportedClaims.length > 0 ||
      review.repeatedOrLowValueSections.length > 1 ||
      review.overExpandedSections.length > 0)
  );
}

function isDeterministicallyOverExpanded(params: {
  noteWordCount: number;
  sourceWordCount: number;
  sourceType: "audio" | "document";
  limits: NoteLengthLimits;
  mode: NoteGenerationMode;
}) {
  if (params.sourceWordCount <= 0) {
    return false;
  }

  if (params.mode === "study_value" && params.sourceType === "audio") {
    return false;
  }

  const maxAllowedNoteWords =
    params.mode === "strict_limits"
      ? params.limits.maxNoteWords
      : Math.round(params.limits.maxNoteWords * 1.25);

  if (params.noteWordCount <= maxAllowedNoteWords) {
    return false;
  }

  if (params.sourceType === "document") {
    return true;
  }

  return params.sourceWordCount < 1200 && params.noteWordCount > maxAllowedNoteWords;
}

function getEffectiveMaxKeyTopics(mode: NoteGenerationMode, limits: NoteLengthLimits) {
  return mode === "strict_limits"
    ? limits.maxKeyTopics
    : Math.min(16, limits.maxKeyTopics + 2);
}

function clampKeyTopics(
  keyTopics: string[],
  limits: NoteLengthLimits,
  mode: NoteGenerationMode,
  sourceType: "audio" | "document",
) {
  if (mode === "study_value" && sourceType === "audio") {
    return keyTopics;
  }

  return keyTopics.slice(0, getEffectiveMaxKeyTopics(mode, limits));
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
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const languageLabel = resolveNoteLanguageLabel(params.outputLanguage);
  const sourceText = segments.map((segment) => segment.text).join("\n\n");
  const noteGenerationMode = getServerEnv().NOTE_GENERATION_MODE;
  const directSourceMaxChars =
    sourceType === "audio" ? DIRECT_AUDIO_SOURCE_MAX_CHARS : DIRECT_DOCUMENT_SOURCE_MAX_CHARS;
  const includeFullSource = sourceText.length <= directSourceMaxChars;
  const structuredPlusInstructions = buildStructuredPlusInstructions({
    outputLanguage: params.outputLanguage,
  });
  const lengthLimits = resolveNoteLengthLimits(sourceWordCount, sourceType);
  const summarizationGuidance = buildSummarizationDepthGuidance(sourceWordCount, sourceType);
  const promptControlGuidance = buildPromptControlGuidance(noteGenerationMode, lengthLimits);
  const finalInstructions =
    sourceType === "audio"
      ? `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. This is a spoken lecture transcript, so reconstruct repeated or fragmented spoken material into clean, student-ready notes. Cover the high-value material, explain the logic behind concepts, and include examples, clarifications, and caveats when supported by the transcript. ${summarizationGuidance} ${promptControlGuidance} ${structuredPlusInstructions}`
      : `${languageInstruction} You are preparing final study notes in ${languageLabel} from ${params.sourceLabel}. Produce student-ready notes that cover the high-value material, explain concepts simply, preserve source-supported examples and formulas, and avoid repeated filler. ${summarizationGuidance} ${promptControlGuidance} ${structuredPlusInstructions}`;

  const coverageOutputs = await mapWithConcurrency(
    windows,
    NOTE_COVERAGE_EXTRACTION_CONCURRENCY,
    (window, index) =>
      generateStructuredObject({
        schema: noteCoverageExtractionSchema,
        maxOutputTokens: sourceType === "audio" ? 2600 : 2300,
        instructions: buildCoverageExtractionInstructions({
          outputLanguage: params.outputLanguage,
          sourceType,
        }),
        input: `Source chunk ${index + 1} of ${windows.length}.\nTime range: ${window.startMs}-${window.endMs} ms.\nText:\n${window.text}`,
      }),
  );
  const coverageUnits = dedupeCoverageUnits(
    coverageOutputs.flatMap((output) => output.units as CoverageUnit[]),
  );

  const result = await generateStructuredObject({
    schema: noteArtifactSchema,
    maxOutputTokens: resolveFinalMaxOutputTokens(sourceWordCount, sourceType),
    instructions: finalInstructions,
    input: JSON.stringify(
      {
        sourceType,
        sourceWordCount,
        noteGenerationMode,
        summarizationGuidance,
        promptControlGuidance,
        lengthLimits,
        sourceHandling: includeFullSource
          ? "full_merged_source_text"
          : "coverage_units_with_source_excerpts",
        sourceTitleHint: params.sourceTitleHint ?? null,
        coverageUnits,
        fullMergedSourceText: includeFullSource ? sourceText : null,
        sourceExcerpts: includeFullSource ? null : buildSourceExcerptPayload(windows),
      },
      null,
      2,
    ),
  });

  let normalizedStructuredNotesMd = ensureHeadingEmojis(
    normalizeStudyListSections(
      normalizeFormulaMarkdown(stripHtmlFromNotes(result.structuredNotesMd)),
    ),
  );
  let finalResult = result;
  let repairApplied = false;
  let deterministicOverExpanded = false;
  let deterministicCompressionApplied = false;

  const review = await generateStructuredObject({
    schema: noteCoverageReviewSchema,
    maxOutputTokens: 2600,
    instructions: buildCoverageReviewInstructions({
      outputLanguage: params.outputLanguage,
    }),
    input: JSON.stringify(
      {
        sourceType,
        sourceWordCount,
        noteGenerationMode,
        summarizationGuidance,
        promptControlGuidance,
        lengthLimits,
        sourceTitleHint: params.sourceTitleHint ?? null,
        coverageUnits,
        generatedNotes: {
          title: result.title,
          summary: result.summary,
          keyTopics: result.keyTopics,
          structuredNotesMd: normalizedStructuredNotesMd,
        },
        fullMergedSourceText: includeFullSource ? sourceText : null,
        sourceExcerpts: includeFullSource ? null : buildSourceExcerptPayload(windows),
      },
      null,
      2,
    ),
  });

  if (shouldRepairNotes(review)) {
    finalResult = await generateStructuredObject({
      schema: noteArtifactSchema,
      maxOutputTokens: resolveFinalMaxOutputTokens(sourceWordCount, sourceType),
      instructions: buildNoteRepairInstructions({
        outputLanguage: params.outputLanguage,
      }),
      input: JSON.stringify(
        {
          sourceType,
          sourceWordCount,
          noteGenerationMode,
          summarizationGuidance,
          promptControlGuidance,
          lengthLimits,
          sourceTitleHint: params.sourceTitleHint ?? null,
          coverageUnits,
          review,
          currentNotes: {
            title: result.title,
            summary: result.summary,
            keyTopics: result.keyTopics,
            structuredNotesMd: normalizedStructuredNotesMd,
          },
          fullMergedSourceText: includeFullSource ? sourceText : null,
          sourceExcerpts: includeFullSource ? null : buildSourceExcerptPayload(windows),
        },
        null,
        2,
      ),
    });
    normalizedStructuredNotesMd = ensureHeadingEmojis(
      normalizeStudyListSections(
        normalizeFormulaMarkdown(stripHtmlFromNotes(finalResult.structuredNotesMd)),
      ),
    );
    repairApplied = true;
  }

  let normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);

  if (
    isDeterministicallyOverExpanded({
      noteWordCount: normalizedNoteWordCount,
      sourceWordCount,
      sourceType,
      limits: lengthLimits,
      mode: noteGenerationMode,
    })
  ) {
    deterministicOverExpanded = true;
    finalResult = await generateStructuredObject({
      schema: noteArtifactSchema,
      maxOutputTokens: resolveCompressionMaxOutputTokens(lengthLimits),
      instructions: buildDeterministicCompressionInstructions({
        outputLanguage: params.outputLanguage,
      }),
      input: JSON.stringify(
        {
          sourceType,
          sourceWordCount,
          currentNoteWordCount: normalizedNoteWordCount,
          noteGenerationMode,
          summarizationGuidance,
          promptControlGuidance,
          lengthLimits,
          sourceTitleHint: params.sourceTitleHint ?? null,
          coverageUnits,
          currentNotes: {
            title: finalResult.title,
            summary: finalResult.summary,
            keyTopics: finalResult.keyTopics,
            structuredNotesMd: normalizedStructuredNotesMd,
          },
          fullMergedSourceText: includeFullSource ? sourceText : null,
          sourceExcerpts: includeFullSource ? null : buildSourceExcerptPayload(windows),
        },
        null,
        2,
      ),
    });
    normalizedStructuredNotesMd = ensureHeadingEmojis(
      normalizeStudyListSections(
        normalizeFormulaMarkdown(stripHtmlFromNotes(finalResult.structuredNotesMd)),
      ),
    );
    normalizedNoteWordCount = countWords(normalizedStructuredNotesMd);
    deterministicCompressionApplied = true;
  }
  const keyTopics = clampKeyTopics(
    finalResult.keyTopics,
    lengthLimits,
    noteGenerationMode,
    sourceType,
  );
  const title = normalizeGeneratedNoteTitle({
    title: finalResult.title,
    sourceTitleHint: params.sourceTitleHint,
    summary: finalResult.summary,
    keyTopics,
    coverageUnits,
    sourceType,
  });

  return {
    ...finalResult,
    title,
    keyTopics,
    structuredNotesMd: normalizedStructuredNotesMd,
    modelMetadata: {
      chunkCount: windows.length,
      sourceWordCount,
      noteWordCount: normalizedNoteWordCount,
      targetNoteWordCount: lengthLimits.targetNoteWords,
      maxNoteWordCount: lengthLimits.maxNoteWords,
      coverageRatio:
        sourceWordCount > 0
          ? Number((normalizedNoteWordCount / sourceWordCount).toFixed(3))
          : null,
      noteGenerationStrategy: "coverage_explained_notes_v1",
      noteGenerationMode,
      sourceHandling: includeFullSource
        ? "full_merged_source_text"
        : "coverage_units_with_source_excerpts",
      coverageUnitCount: coverageUnits.length,
      coveredCoverageUnitCount: review.coveredUnitHeadings.length,
      missingCoverageUnitCount: review.missingUnitHeadings.length,
      shallowExplanationUnitCount: review.shallowExplanationHeadings.length,
      unsupportedClaimCount: review.unsupportedClaims.length,
      repeatedOrLowValueSectionCount: review.repeatedOrLowValueSections.length,
      overExpandedSectionCount: review.overExpandedSections.length,
      repairApplied,
      deterministicOverExpanded,
      deterministicCompressionApplied,
      finalNoteExceededMaxWords: normalizedNoteWordCount > lengthLimits.maxNoteWords,
      explanationQualityChecked: true,
      sourceType,
      pipeline: params.pipelineName,
    },
  };
}
