// Kept free of "server-only" so the redundancy gate stays unit-testable
// (tests/study-dedupe.test.mjs) outside the Next.js runtime.

/**
 * Every study item must earn its slot: two cards that test the same fact in different words are
 * one card and one piece of noise. Near-duplicates get through the item-level merge whenever the
 * model words the same claim differently across extraction passes, so the generated drafts get a
 * second, content-level pass that compares what the learner actually sees — fronts, backs,
 * prompts — across concept boundaries.
 *
 * Tokens are compared by their first six characters: Slovenian inflection ("kalcij" / "kalcija" /
 * "kalcijem") otherwise makes the same word count as three different ones, which is exactly how
 * the duplicate cards observed in real decks slipped past an equality-based comparison.
 */
const TOKEN_STEM_LENGTH = 6;
const MIN_TOKEN_LENGTH = 3;

export function contentTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= MIN_TOKEN_LENGTH)
      .map((token) => token.slice(0, TOKEN_STEM_LENGTH)),
  );
}

export function tokenSetOverlap(left: Set<string>, right: Set<string>) {
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

const CARD_FRONT_DUPLICATE_OVERLAP = 0.85;
const CARD_BACK_DUPLICATE_OVERLAP = 0.85;
const PROMPT_DUPLICATE_OVERLAP = 0.85;

/**
 * Collapses cards whose front AND back both say the same thing, regardless of which concept they
 * were generated for. Requiring both sides prevents merging cards that share a topic-typical
 * question shape ("Kaj je X?") but test different facts.
 */
export function dedupeCardDraftsByContent<TCard extends { front: string; back: string }>(
  cards: TCard[],
): TCard[] {
  const kept: Array<{ card: TCard; front: Set<string>; back: Set<string> }> = [];

  for (const card of cards) {
    const front = contentTokens(card.front);
    const back = contentTokens(card.back);
    const duplicate = kept.some(
      (existing) =>
        tokenSetOverlap(existing.front, front) >= CARD_FRONT_DUPLICATE_OVERLAP &&
        tokenSetOverlap(existing.back, back) >= CARD_BACK_DUPLICATE_OVERLAP,
    );

    if (!duplicate) {
      kept.push({ card, front, back });
    }
  }

  return kept.map((entry) => entry.card);
}

/**
 * Collapses quiz questions that ask the same thing and reward the same answer. The prompt alone
 * is not enough — two distinct facts can share a stem shape — so the correct option must match
 * too before a question is dropped.
 */
export function dedupeQuizDraftsByContent<
  TQuestion extends { prompt: string; options: string[]; correctOptionIndex: number },
>(questions: TQuestion[]): TQuestion[] {
  const kept: Array<{ question: TQuestion; prompt: Set<string>; answer: Set<string> }> = [];

  for (const question of questions) {
    const prompt = contentTokens(question.prompt);
    const answer = contentTokens(question.options[question.correctOptionIndex] ?? "");
    const duplicate = kept.some(
      (existing) =>
        tokenSetOverlap(existing.prompt, prompt) >= PROMPT_DUPLICATE_OVERLAP &&
        tokenSetOverlap(existing.answer, answer) >= CARD_BACK_DUPLICATE_OVERLAP,
    );

    if (!duplicate) {
      kept.push({ question, prompt, answer });
    }
  }

  return kept.map((entry) => entry.question);
}

/** Collapses open questions whose prompts converge on the same task. */
export function dedupePracticeDraftsByContent<TQuestion extends { prompt: string }>(
  questions: TQuestion[],
): TQuestion[] {
  const kept: Array<{ question: TQuestion; prompt: Set<string> }> = [];

  for (const question of questions) {
    const prompt = contentTokens(question.prompt);
    const duplicate = kept.some(
      (existing) => tokenSetOverlap(existing.prompt, prompt) >= PROMPT_DUPLICATE_OVERLAP,
    );

    if (!duplicate) {
      kept.push({ question, prompt });
    }
  }

  return kept.map((entry) => entry.question);
}
