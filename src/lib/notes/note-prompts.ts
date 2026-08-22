import { z } from "zod";

import {
  buildGeneratedContentLanguageInstruction,
  normalizeNoteLanguage,
  resolveNoteLanguageLabel,
} from "../languages.ts";

// Kept free of "server-only" so the note prompt contract stays testable and measurable
// (scripts/note-eval.mjs) outside the Next.js runtime. Everything here must stay pure:
// no I/O, no env, no "@/" aliases.

export const MATH_FORMATTING_INSTRUCTIONS = `Formula formatting rules:
- Use valid Markdown math for every formula and variable expression.
- Put full equations on one display-math line like $$I_{t/0} = \\frac{Y_t}{Y_0} \\cdot 100$$.
- Use inline math \\(Y_t\\) only for short variables inside a sentence.
- Use LaTeX subscripts, fractions, exponents, roots, functions, Greek letters, inequalities, arrows, sums, and integrals: \\(Y_t\\), \\(Y_{t-1}\\), \\(I_{t/0}\\), \\frac{a}{b}, x^2, \\sqrt{x}, \\sin(x), \\alpha, \\le, \\to, \\sum, and \\int.
- For multi-line derivations, use one display math block with an aligned environment inside: $$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$.
- Never write raw dollar-sign inline math, broken subscripts like $Yt$ or $I{t/0}$, or plain text formulas like Yt / Y0 100.`;

export function getStructuredPlusLabels(outputLanguage?: string | null) {
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

/* -------------------------------------------------------------------------- */
/* Content-driven note pipeline                                               */
/* -------------------------------------------------------------------------- */

/**
 * Note length is an output of this pipeline, never an input. A source is reduced to the
 * discrete things a learner has to walk away knowing; the note is then exactly long enough
 * to teach that list. A dense source yields many items and a long note, a padded source
 * yields few items and a short note, and no word target is ever sent to the model.
 */

/**
 * Extraction reads far more closely than synthesis does, so its windows are much smaller than the
 * 2200/3200-word windows the legacy pipeline summarised. A large window makes the model skim and
 * silently drop claims, which the outline step can never recover.
 */
export const KNOWLEDGE_EXTRACTION_WINDOW_WORDS = 900;

export const KNOWLEDGE_ITEM_KINDS = [
  "definition",
  "formula",
  "mechanism",
  "comparison",
  "causal",
  "procedure",
  "fact",
  "caveat",
] as const;

export const knowledgeItemSchema = z.object({
  claim: z.string().min(12),
  kind: z.enum(KNOWLEDGE_ITEM_KINDS),
  // 5 = a learner cannot pass without this. 1 = true but disposable.
  importance: z.number().int().min(1).max(5),
  terms: z.array(z.string().min(2)).max(4),
});

export const knowledgeExtractionSchema = z.object({
  sectionTitle: z.string().min(3),
  // Deliberately allows an empty array: a chunk that is administrative chatter, a learning-goal
  // list or a figure caption must be able to contribute nothing. The previous schema required
  // five bullets, two supporting details and three terms from every chunk, which manufactured
  // filler before any selection could happen.
  items: z.array(knowledgeItemSchema),
});

export const noteOutlineSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  keyTopics: z.array(z.string().min(2)).min(3),
  topics: z
    .array(
      z.object({
        title: z.string().min(3),
        itemIds: z.array(z.number().int().nonnegative()).min(1),
      }),
    )
    .min(1),
  droppedItemIds: z.array(z.number().int().nonnegative()),
});

export const noteWriteSchema = z.object({
  structuredNotesMd: z.string().min(200),
});

export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;
export type IndexedKnowledgeItem = KnowledgeItem & { id: number; sectionTitle: string };

function normalizeClaimKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function claimTokens(value: string) {
  return new Set(normalizeClaimKey(value).split(" ").filter((token) => token.length > 3));
}

function tokenOverlap(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.min(left.size, right.size);
}

const DUPLICATE_CLAIM_OVERLAP = 0.8;

/**
 * Collapses the same idea repeated across chunks, keeping the highest-importance wording.
 * A lecturer restating the crux three times should raise its importance, not produce three items.
 */
export function dedupeKnowledgeItems(items: IndexedKnowledgeItem[]) {
  const kept: Array<IndexedKnowledgeItem & { tokens: Set<string> }> = [];

  for (const item of items) {
    const tokens = claimTokens(item.claim);
    const duplicate = kept.find(
      (existing) =>
        existing.kind === item.kind && tokenOverlap(existing.tokens, tokens) >= DUPLICATE_CLAIM_OVERLAP,
    );

    if (duplicate) {
      // A repeated claim is evidence the source treats it as important.
      duplicate.importance = Math.min(5, Math.max(duplicate.importance, item.importance) + 1);
      continue;
    }

    kept.push({ ...item, tokens });
  }

  return kept.map((item) => ({
    id: item.id,
    claim: item.claim,
    kind: item.kind,
    importance: item.importance,
    terms: item.terms,
    sectionTitle: item.sectionTitle,
  }));
}

export function buildKnowledgeExtractionInstructions(params: {
  outputLanguage?: string | null;
  sourceType: "audio" | "document";
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const sourceNoun = params.sourceType === "audio" ? "spoken lecture transcript" : "course material";

  return `${languageInstruction}

Extract every distinct testable claim in this chunk of ${sourceNoun}. One item per claim, written so it stands on its own without the chunk in front of you.

Be exhaustive about substance. A later step decides what the finished note keeps, and it can only choose from what you return — a claim you leave out is lost for good. Split a sentence carrying two facts into two items. Two spellings of the same fact are fine; duplicates are merged later.

Be ruthless about non-substance. Return an empty items array for a chunk that is only administrative announcements, deadlines, chapter goals, "what you will learn" lists, figure and slide captions, chapter summaries, pointers to exercises, or transitions. Never turn those into items to avoid returning nothing.

Rate importance honestly, because that rating is what the later step triages on: 5 = a learner fails without it, 3 = worth knowing, 1 = true but disposable.

Never invent a claim the chunk does not support.

${MATH_FORMATTING_INSTRUCTIONS}`;
}

export function buildNoteOutlineInstructions(params: { outputLanguage?: string | null }) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction}

You are given every knowledge item extracted from one source, each with an id. Decide what the finished study note covers and how it is organised.

Group the items that belong to the same concept into topics, ordered the way they should be learned rather than the order they appeared. Merge thin topics into their neighbours.

Drop an item into droppedItemIds when it is redundant with a stronger item, too trivial to spend a learner's attention on, or cannot be understood outside the original source. Keep every item a learner would be tested on.

Let the material decide the shape. A source with few real ideas gets few topics. A dense source gets many. Do not aim for any particular number of topics.

Every retained id must appear in exactly one topic, and every id must be either retained or dropped.

Also return a title, a summary of 2-3 sentences covering the whole source, and the key topics.`;
}

export function buildNoteWritingInstructions(params: { outputLanguage?: string | null }) {
  const labels = getStructuredPlusLabels(params.outputLanguage);
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction}

Write study notes that teach the supplied outline. You also have the full source text: use it for wording, precision, formulas and worked examples, but let the outline decide what is covered.

Teach every retained item once, in its assigned topic, in enough words to actually make it understood — a definition may take a line, a mechanism may take a paragraph. Add nothing that is not in the outline. Do not restate an item in a second place for emphasis.

Length has no target. It is whatever teaching this outline honestly takes.

Format (use these exact headings):
- "${labels.overview}" — 2-3 sentences on the whole source, then one callout "> **${labels.keyTakeaway}:** ...".
- "${labels.keyThings}" — the highest-importance items as bullets.
- One GFM table when at least three items are genuinely comparable, with leading and trailing pipes. Never more than two tables, and never a table that repeats nearby bullets.
- One "## N. Topic name" section per outline topic, in outline order.
- Inside a topic use "${labels.coreIdea}" (exactly one sentence) and "${labels.detailedNotes}". Add "${labels.keyTerms}", "${labels.example}", "${labels.compare}" or "${labels.process}" only when that topic has such content.
- "${labels.checkYourself}" once near the end — 3-5 questions answerable from these notes.
- "${labels.finalReview}" — the takeaways and the mistakes worth warning about.

Style: markdown only, no HTML. Bullets start with "- ". Prose for explanation, bullets for genuine lists. At most 3 blockquote callouts in total, of the form "> **${labels.definition}:** ...", "> **${labels.commonMistake}:** ..." or "> **${labels.keyTakeaway}:** ...". Between 2 and 5 emojis in major headings, never on bullets.

${MATH_FORMATTING_INSTRUCTIONS}`;
}

export function formatOutlineForWriting(params: {
  outline: z.infer<typeof noteOutlineSchema>;
  items: IndexedKnowledgeItem[];
}) {
  const itemById = new Map(params.items.map((item) => [item.id, item]));

  return params.outline.topics.map((topic, index) => ({
    position: index + 1,
    title: topic.title,
    items: topic.itemIds
      .map((id) => itemById.get(id))
      .filter((item): item is IndexedKnowledgeItem => Boolean(item))
      .map((item) => ({ claim: item.claim, kind: item.kind, importance: item.importance })),
  }));
}

export function resolveNoteLanguageContext(outputLanguage?: string | null) {
  return {
    languageCode: normalizeNoteLanguage(outputLanguage),
    languageLabel: resolveNoteLanguageLabel(outputLanguage),
  };
}

/* -------------------------------------------------------------------------- */
/* Legacy note pipeline (kept so the eval harness can measure the baseline)    */
/* -------------------------------------------------------------------------- */

export const legacyChunkSummarySchema = z.object({
  heading: z.string().min(3),
  summary: z.string().min(60),
  bulletPoints: z.array(z.string().min(12)).min(5),
  supportingDetails: z.array(z.string().min(12)).min(2),
  examples: z.array(z.string().min(12)),
  terminology: z.array(z.string().min(2)).min(3),
});

export function buildLegacyNoteTargets(sourceWordCount: number, chunkCount: number) {
  const targetNoteWordCount = Math.max(700, Math.min(3200, Math.round(sourceWordCount * 0.42)));

  return {
    targetNoteWordCount,
    minNoteWordCount: Math.max(700, Math.round(targetNoteWordCount * 0.88)),
    maxNoteWordCount: Math.max(900, Math.min(2400, Math.round(targetNoteWordCount * 1.18))),
    minSectionCount: Math.max(4, Math.min(12, chunkCount)),
    recommendedTopicCount: Math.max(4, Math.min(9, Math.ceil(chunkCount / 1.8))),
  };
}

export function buildLegacyAudioNoteTargets(sourceWordCount: number, chunkCount: number) {
  const targetNoteWordCount = Math.max(1200, Math.min(5200, Math.round(sourceWordCount * 0.58)));

  return {
    targetNoteWordCount,
    minNoteWordCount: Math.max(1100, Math.round(targetNoteWordCount * 0.86)),
    maxNoteWordCount: Math.max(1500, Math.min(5600, Math.round(targetNoteWordCount * 1.18))),
    minSectionCount: Math.max(6, Math.min(18, Math.ceil(chunkCount * 1.15))),
    recommendedTopicCount: Math.max(6, Math.min(14, Math.ceil(chunkCount / 1.5))),
  };
}

export function buildLegacyStructuredPlusInstructions(params: {
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
- Preserve mathematical notation as formulas when the source supports it. ${MATH_FORMATTING_INSTRUCTIONS}

Use this stable Structured Plus markdown format with these exact heading labels:
- Start with "${labels.overview}" containing 2-3 concise sentences that explain the whole material.
- Immediately after "${labels.overview}", add exactly one semantic blockquote callout in this form: "> **${labels.keyTakeaway}:** ...".
- Add "${labels.keyThings}" with 5-8 complete bullet points for the main ideas.
- After "${labels.keyThings}", include exactly one concise GFM markdown table when the source contains at least three comparable concepts, categories, systems, components, terms, steps, or cause-effect relationships.
- Then create about ${params.recommendedTopicCount} numbered topic sections such as "${labels.topicExample}". Never create more than ${params.recommendedTopicCount + 1} numbered topic sections.
- Inside each substantial topic, use "${labels.coreIdea}" and "${labels.detailedNotes}". Use "${labels.keyTerms}", "${labels.example}", "${labels.compare}", "${labels.process}", or "${labels.checkYourself}" only when they add real study value.
- "${labels.coreIdea}" must be exactly 1 sentence.
- "${labels.detailedNotes}" should usually contain 1 short explanatory paragraph plus 2-3 hyphen bullets.
- For unordered lists, always use "- " as the Markdown bullet marker.
- Use semantic blockquote callouts where it actually helps learning: exactly 2 in a normal note and at most 3 in a complex note.
- Add "${labels.checkYourself}" only once near the end. Format it as a hyphen bullet list with 3-5 short questions.
- End with "${labels.finalReview}" formatted as a hyphen bullet list containing 4-7 tight takeaways.

Return markdown only. Do not use HTML tags. Use 2-5 logical emojis total in major section headings.`;
}
