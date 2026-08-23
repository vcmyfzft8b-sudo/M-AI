import { z } from "zod";

import { normalizeMarkdownMath } from "../math-markdown.ts";

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
 * silently drop claims, which no later step can recover.
 *
 * The size is measured, not guessed. On a dense source (39 testable facts in 913 words) extraction
 * recall was 59% at 900-word windows and 100% at 400. Raising the thinking level instead makes it
 * worse — a thinking model summarises the window where a fast one enumerates it.
 */
export const KNOWLEDGE_EXTRACTION_WINDOW_WORDS = 400;

/**
 * Extraction is read twice at different granularities and the results are merged. One pass is not
 * stable: the same dense source yielded 29 items on one run and 49 on another, and everything
 * downstream is capped by whatever that single pass happened to catch. Two passes cut differently,
 * so a claim that straddles a boundary in one pass sits inside a window in the other, and
 * dedupeKnowledgeItems collapses the overlap. Extraction is the cheapest stage in the pipeline and
 * the one every other stage depends on, which makes it the right place to spend twice.
 */
export const KNOWLEDGE_EXTRACTION_PASS_WINDOWS = [400, 260];

/**
 * Splits text into pieces no longer than maxChars, breaking at sentence ends where possible and
 * at whitespace otherwise. Transcription can hand back a single segment covering a whole
 * recording (a 17-minute lecture arrived as one 12.8k-char segment), and a window that inherits
 * such a segment whole makes "extract every claim" impossible to fit any output budget — the
 * extraction call then burns its whole retry ladder on ever-larger truncations.
 */
export function splitTextForExtraction(text: string, maxChars: number): string[] {
  const normalized = text.trim();

  if (normalized.length <= maxChars) {
    return normalized.length > 0 ? [normalized] : [];
  }

  const pieces: string[] = [];
  let rest = normalized;

  while (rest.length > maxChars) {
    const slice = rest.slice(0, maxChars);
    const sentenceEnd = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf("\n"),
    );
    const whitespace = slice.lastIndexOf(" ");
    const cut =
      sentenceEnd >= Math.floor(maxChars * 0.5)
        ? sentenceEnd + 1
        : whitespace >= Math.floor(maxChars * 0.5)
          ? whitespace
          : maxChars;

    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length > 0) {
    pieces.push(rest);
  }

  return pieces;
}

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

// Tokens are stemmed to their first six characters: Slovenian inflection otherwise makes
// "kalcij" and "kalcija" different tokens, and the same claim worded across two extraction
// passes escapes the merge — which is how duplicate flashcards reached real decks.
function claimTokens(value: string) {
  return new Set(
    normalizeClaimKey(value)
      .split(" ")
      .filter((token) => token.length > 3)
      .map((token) => token.slice(0, 6)),
  );
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
 * Collapses the same idea into one item, keeping the highest-importance wording.
 *
 * `boostRepeats` decides what a duplicate means. Within a single extraction pass a repeat is
 * evidence the source keeps coming back to the claim, which is a reason to rank it higher. Across
 * passes it means nothing — every item is expected to appear in both readings of the source — and
 * boosting there flattens the scale: it pushed 70% of items to importance 5 and left nothing for
 * a later stage to triage on.
 */
export function dedupeKnowledgeItems<TItem extends IndexedKnowledgeItem>(
  items: TItem[],
  options: { boostRepeats?: boolean } = {},
): TItem[] {
  const boostRepeats = options.boostRepeats ?? false;
  const kept: Array<{ item: TItem; tokens: Set<string> }> = [];

  for (const item of items) {
    const tokens = claimTokens(item.claim);
    const duplicate = kept.find(
      (existing) =>
        existing.item.kind === item.kind &&
        tokenOverlap(existing.tokens, tokens) >= DUPLICATE_CLAIM_OVERLAP,
    );

    if (duplicate) {
      duplicate.item.importance = Math.min(
        5,
        Math.max(duplicate.item.importance, item.importance) + (boostRepeats ? 1 : 0),
      );
      continue;
    }

    // The item is kept whole (spread, not rebuilt field-by-field) so callers that carry extra
    // fields — unit attribution, for one — do not lose them in the merge.
    kept.push({ item: { ...item }, tokens });
  }

  return kept.map((entry) => entry.item);
}

export const duplicateVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      duplicateOf: z.number().int().nullable(),
    }),
  ),
});

export const DUPLICATE_JUDGE_INSTRUCTIONS =
  "For each knowledge item, decide whether it states the SAME single fact as another item in the list — same subject, same relationship, same value, merely worded, spelled or angled differently. If so, duplicateOf is that item's index; otherwise null. Two different facts about the same subject are NOT duplicates: 'X uses base-period quantities' and 'X overstates inflation' are different facts about X. Judge each item independently and be precise.";

/**
 * Collapses items using duplicate links from a judge model. Token overlap cannot see that
 * "eksitatorni postsinaptični potencial" and "ekscitacijski postsynaptični potencial" are one
 * concept, and lowering its threshold would merge EPSP with IPSP; a judge finds exactly the
 * cross-spelling, cross-angle pairs (measured 100% stable on a real lecture's items). Links are
 * treated as undirected and unioned, and each surviving item keeps its group's peak importance.
 * The safety valve returns the input untouched if the judge would collapse more than 60% of it —
 * a judge that eager is wrong, not thorough.
 */
export function collapseDuplicateItems<TItem extends IndexedKnowledgeItem>(
  items: TItem[],
  links: Array<{ index: number; duplicateOf: number | null }>,
): TItem[] {
  const parent = items.map((_item, index) => index);

  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }

    return index;
  };

  for (const link of links) {
    if (
      link.duplicateOf == null ||
      link.index === link.duplicateOf ||
      link.index < 0 ||
      link.index >= items.length ||
      link.duplicateOf < 0 ||
      link.duplicateOf >= items.length
    ) {
      continue;
    }

    parent[find(link.index)] = find(link.duplicateOf);
  }

  const byRoot = new Map<number, TItem[]>();

  for (let index = 0; index < items.length; index += 1) {
    const root = find(index);
    byRoot.set(root, [...(byRoot.get(root) ?? []), items[index]]);
  }

  const collapsed = [...byRoot.values()].map((group) => {
    const keeper = group.reduce((best, item) => (item.importance > best.importance ? item : best));

    return {
      ...keeper,
      importance: Math.max(...group.map((item) => item.importance)),
    };
  });

  if (collapsed.length < items.length * 0.4) {
    return items;
  }

  return collapsed.sort((left, right) => left.id - right.id);
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

A chunk may span several unrelated topics — scanned pages and slide photos often do. Extract every topic's claims, not just the first one's; sectionTitle then names the topics together. Never treat a topic change as the end of the chunk.

Be ruthless about non-substance. Return an empty items array for a chunk that is only administrative announcements, deadlines, chapter goals, "what you will learn" lists, figure and slide captions, chapter summaries, pointers to exercises, or transitions. Never turn those into items to avoid returning nothing.

Rate importance honestly, because that rating is what the later step triages on: 5 = a learner fails without it, 3 = worth knowing, 1 = true but disposable.

Every claim names its subject explicitly. A chunk that says "he later taught history" yields "Gogolj je pozneje predaval zgodovino" when the chunk identifies him — and no claim at all when it does not. A claim about an unnamed someone can never become a usable study question.

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

/**
 * Derives the writer's word budget from the source. A study note that runs longer than the lecture
 * it condenses has stopped being a note: measured 2026-08-23, an unbudgeted writer produced 123%
 * of source on gemini-3.5-flash-lite, 199% on gpt-5-nano and 213% on gemini-3.7-flash, so the
 * absence of a budget — not the model — is what sets the length.
 *
 * The floor keeps a short, dense source teachable; the ceiling is the source itself, which no
 * summary has any business exceeding.
 */
export function resolveNoteWordBudget(params: { sourceWordCount: number; retainedItemCount: number }) {
  const fromSource = Math.round(params.sourceWordCount * 0.7);
  const fromItems = params.retainedItemCount * 22;

  return {
    target: Math.max(250, Math.min(fromSource, Math.max(fromItems, Math.round(fromSource * 0.6)))),
    ceiling: Math.max(320, params.sourceWordCount),
  };
}

export function buildNoteWritingInstructions(params: {
  outputLanguage?: string | null;
  /** Omit to keep the unbudgeted behaviour the measured pipeline shipped with. */
  wordBudget?: { target: number; ceiling: number };
  /**
   * States the goal as coverage of what matters rather than as a word count. Chain-of-Density
   * gets its compression from a fixed length; this asks whether naming the objective gets the
   * same density without ever mentioning length, which is the friendlier instruction if it works.
   */
  coverageObjective?: boolean;
  /**
   * Applies what the learning-science literature actually says about study material, which is not
   * the same as what the summarisation literature says. Dunlosky et al. (2013) rate summarising as
   * *low* utility and practice testing as *high*: a note that is only read is one of the weakest
   * things a learner can do with their time. So the note is built to be tested against — retrieval
   * cues sit inside every topic instead of in one block at the end — and explanations carry the
   * "why" that elaborative interrogation and self-explanation (both moderate utility, both above
   * summarising) depend on. Mayer's coherence principle supplies the other half: learning improves
   * when extraneous material is excluded, not merely when good material is added.
   */
  pedagogy?: boolean;
}) {
  const labels = getStructuredPlusLabels(params.outputLanguage);
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  /**
   * Chain-of-Density's finding, applied to a single pass: when a summary has to fit a fixed
   * length, the model buys room by fusing and compressing rather than by dropping content — which
   * is the opposite of what it does when told only "teach everything".
   */
  const coverageRule = `Your goal is coverage, not volume: every important thing in the source is in the note, and nothing that is not important is. Judge each sentence by what a learner would lose if it were deleted — if the answer is nothing, it does not belong.

Say it once, in the fewest words that still teach it. Fuse related points into one sentence rather than giving each its own. Cut every phrase that carries no information ("it is important to note that", "as we can see", "in this section we will"). Never pad a topic to make it look substantial, and never restate in the review what a topic already taught. A note that a learner can read in one sitting and still recall everything important beats a longer one that covers the same ground.`;

  const pedagogyRule = `Build the note to be tested against, not just read. Re-reading a summary is one of the weakest ways to study; recalling it is one of the strongest, so every topic must give the learner something to recall against.

In each topic, end with one "${labels.checkYourself}" style question a learner should be able to answer from that topic alone — put it inline, where the material is, not saved up for the end.

Explain why, not only what. When the source gives a reason, a cause, or a consequence, state it: a learner remembers "X because Y" far better than "X". When two things are easily confused, say what separates them.

When the source works through a procedure, a calculation or a formula, show one worked instance with its real numbers rather than describing the method in the abstract.`;

  const lengthRule = params.coverageObjective
    ? coverageRule
    : params.wordBudget
    ? `Length: aim for about ${params.wordBudget.target} words and never exceed ${params.wordBudget.ceiling}. The note must be shorter than the source — a note as long as the lecture has saved the learner nothing.

If everything will not fit, you may not drop a retained item. Make room the other way: fuse two sentences into one, replace a clause with the term it defines, cut every phrase that carries no information ("it is important to note that", "as we can see"), and let a table or a bullet carry what a paragraph was carrying. Density is the goal — every sentence should teach something the previous one did not.`
    : "Length has no target. It is whatever teaching this outline honestly takes.";

  return `${languageInstruction}

Write study notes that teach the supplied outline. You also have the full source text: use it for wording, precision, formulas and worked examples, but let the outline decide what is covered.

Teach every retained item once, in its assigned topic, in enough words to actually make it understood — a definition may take a line, a mechanism may take a paragraph. Add nothing that is not in the outline.

Say each thing once. A learner should never meet the same sentence twice in different clothes. The overview, the bullets, the tables, the callouts and the review each do a different job: the overview orients, the bullets name, the topics explain, the table compares, the review consolidates in the learner's own testable words. If a callout would restate the overview, or a table would restate the bullets above it, drop it — a shorter note that never repeats itself beats a longer one that does.

${lengthRule}
${params.pedagogy ? `
${pedagogyRule}
` : ""}
Write for someone revising the night before an exam: name the thing, say what it is, say why it matters or what it is confused with. Prefer the concrete number, formula, or exact wording from the source over a paraphrase of it.

Format (use these exact headings):
- "${labels.overview}" — 2-3 sentences on the whole source, then one callout "> **${labels.keyTakeaway}:** ...".
- "${labels.keyThings}" — the highest-importance items as bullets.
- One GFM table when at least three items are genuinely comparable, with leading and trailing pipes. Never more than two tables, and never a table that repeats nearby bullets.
- One "## N. Topic name" section per outline topic, in outline order.
- Inside a topic use "${labels.coreIdea}" (exactly one sentence) and "${labels.detailedNotes}". Add "${labels.keyTerms}", "${labels.example}", "${labels.compare}" or "${labels.process}" only when that topic has such content.
- "${labels.checkYourself}" once near the end — 3-5 questions answerable from these notes, and worth asking: the things a learner most often gets wrong, not the easiest facts to look up.${params.pedagogy ? " These are in addition to the per-topic questions, and must not repeat them." : ""}
- "${labels.finalReview}" — the takeaways and the mistakes worth warning about, phrased so they are useful on their own without rereading the note.

"${labels.overview}", "${labels.keyThings}", "${labels.checkYourself}" and "${labels.finalReview}" are always present. Everything else appears only when that topic has the content for it.

"${labels.keyTerms}" is for terms whose definition is not already given in that topic's prose. Never repeat a definition there that the paragraph above just gave.

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

/* -------------------------------------------------------------------------- */
/* Post-processing applied to every generated note                            */
/* -------------------------------------------------------------------------- */

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

/**
 * The exact normalisation the pipeline applies before a note is stored, so anything that renders
 * a note outside the pipeline (the eval harness, a preview page) shows what a learner would see
 * rather than the raw model output.
 */
export function normalizeGeneratedNoteMarkdown(value: string) {
  return normalizeMarkdownMath(normalizeStudyListSections(stripHtmlFromNotes(value)));
}
