/**
 * Which questions go on this test.
 *
 * Kept free of "server-only" so the sampler is exercised directly by
 * `tests/practice-test-selection.test.mjs`: the randomness is injected, so the properties that
 * matter — a different test every time, the whole bank seen before anything repeats, every part
 * of the material represented — are assertions rather than hopes.
 *
 * The shape of the feature: the bank covers the material exhaustively, one test is a random draw
 * from it, and sitting several tests walks the learner through everything. That only works if the
 * draw is exposure-first. A uniform draw from a bank of forty re-asks a question the learner has
 * already answered while a third of the material has never been on a test at all, which is the
 * opposite of what a bank is for.
 */

import { isHighQualityStudyPrompt } from "./study-quality.ts";
import { isGradableAnswerGuide } from "./practice-test-scoring.ts";

/** How many attempts back "recently seen" reaches. */
export const RECENT_ATTEMPT_MEMORY = 3;

export type SelectableQuestion = {
  id: string;
  prompt: string;
  answer_guide: string;
  difficulty: string;
  source_unit_idx: number | null;
  concept_key: string | null;
  importance?: number | null;
};

export type Random = () => number;

/**
 * How long a test is, from how much material there is behind it. A five-question test on a
 * forty-question bank would leave most of the material untested for eight sittings; a
 * fifteen-question test on a bank of eight would be the same test every time.
 */
export function targetQuestionCount(bankSize: number) {
  if (bankSize <= 8) {
    return Math.max(1, Math.min(5, bankSize));
  }
  if (bankSize <= 15) {
    return 8;
  }
  if (bankSize <= 24) {
    return 10;
  }
  if (bankSize <= 34) {
    return 12;
  }
  return 15;
}

/**
 * A question is usable if a learner can answer it with nothing else on screen and a grader can
 * mark it. Both are generation-time gates too; this is the one that protects a bank already in
 * the database from a question that predates them.
 */
export function isUsableBankQuestion(question: SelectableQuestion) {
  return isHighQualityStudyPrompt(question.prompt) && isGradableAnswerGuide(question.answer_guide);
}

export function usableBankQuestions<TQuestion extends SelectableQuestion>(questions: TQuestion[]) {
  return questions.filter((question) => isUsableBankQuestion(question));
}

/**
 * Whether the stored bank has to be generated again before a test can be drawn from it.
 *
 * Two things this deliberately is not:
 *
 * A bank is **not** rebuilt because the learner has been through it. Question banks are meant to
 * be re-drawn from — a school's is — and the rule this replaced rebuilt a forty-question bank as
 * soon as its unused questions no longer filled one test, which put a full generation run in
 * front of roughly every third attempt for questions no better than the ones already there.
 * Exposure-first selection is what keeps a re-draw from feeling like a repeat.
 *
 * And a bank is **not** re-examined here for bad questions. Every question the current pipeline
 * stores passed the standalone and markable gates at generation time, and one that somehow did
 * not is dropped at selection instead. A second opinion at this point could only loop: it would
 * rebuild on every start and get the same bank back, forever, which is what the "one bad prompt"
 * rule this replaced actually did. Tightening those gates means bumping the pipeline version,
 * which rebuilds every stored bank once and then stops.
 */
export function shouldRebuildQuestionBank(params: {
  questions: SelectableQuestion[];
  builtByCurrentPipeline: boolean;
}) {
  return params.questions.length === 0 || !params.builtByCurrentPipeline;
}

type Usage = {
  lifetime: number;
  attemptsAgo: number;
  inPreviousAttempt: boolean;
};

/**
 * `previousAttemptQuestionIds` is oldest-first, and only the attempts sat on the current bank
 * belong in it — a question that was asked before the bank was rebuilt is a different question.
 */
export function buildQuestionUsage(previousAttemptQuestionIds: string[][]) {
  const usage = new Map<string, Usage>();
  const lastIndex = previousAttemptQuestionIds.length - 1;

  previousAttemptQuestionIds.forEach((questionIds, attemptIndex) => {
    const attemptsAgo = lastIndex - attemptIndex;

    for (const questionId of new Set(questionIds)) {
      const current = usage.get(questionId);

      usage.set(questionId, {
        lifetime: (current?.lifetime ?? 0) + 1,
        attemptsAgo: Math.min(current?.attemptsAgo ?? Number.MAX_SAFE_INTEGER, attemptsAgo),
        inPreviousAttempt: (current?.inPreviousAttempt ?? false) || attemptsAgo === 0,
      });
    }
  });

  return usage;
}

const NO_USAGE: Usage = {
  lifetime: 0,
  attemptsAgo: Number.MAX_SAFE_INTEGER,
  inPreviousAttempt: false,
};

function importanceOf(question: SelectableQuestion) {
  const value = question.importance;

  return typeof value === "number" && Number.isFinite(value) ? value : 3;
}

/**
 * The pick order, best first, recomputed on every pick because the spread terms depend on what
 * has already been chosen. The previous implementation put these terms in a comparator — where
 * they were all zero, because nothing had been selected yet when the comparator ran — and then
 * shuffled the sorted array anyway, which threw away whatever ordering had survived. The result
 * was a uniform random draw with a scoring function that did nothing.
 */
function pickScore(params: {
  question: SelectableQuestion;
  usage: Usage;
  unitCounts: Map<number, number>;
  conceptCounts: Map<string, number>;
  difficultyCounts: Map<string, number>;
  random: Random;
}) {
  const { question, usage } = params;
  const unitKey = question.source_unit_idx ?? -1;
  const unitCount = params.unitCounts.get(unitKey) ?? 0;
  const conceptCount = question.concept_key
    ? (params.conceptCounts.get(question.concept_key) ?? 0)
    : 0;
  const difficultyCount = params.difficultyCounts.get(question.difficulty) ?? 0;
  // Ordered by how much each term should be allowed to override the next. Exposure dominates
  // everything: no question is asked twice while one has never been asked.
  return (
    usage.lifetime * 1_000_000 +
    (usage.inPreviousAttempt ? 400_000 : 0) +
    (usage.attemptsAgo < RECENT_ATTEMPT_MEMORY ? (RECENT_ATTEMPT_MEMORY - usage.attemptsAgo) * 50_000 : 0) +
    // A concept already on this test is a near-duplicate question; a unit already on it is only
    // an unbalanced test.
    conceptCount * 20_000 +
    unitCount * 4_000 +
    (5 - importanceOf(question)) * 800 +
    difficultyCount * 300 +
    // Wide enough to reorder questions that differ only by a rating or a difficulty, so two
    // learners on the same bank do not sit the identical first test; too narrow to override an
    // exposure or spread decision, which are the ones that make the test a test.
    params.random() * 2_000
  );
}

export type AttemptSelection<TQuestion extends SelectableQuestion> = {
  questions: TQuestion[];
  /** How much of this test the learner saw on their previous one, 0 to 1. */
  previousOverlapRatio: number;
};

/**
 * Draws one test out of the bank.
 *
 * Returns the questions in a random order — a bank stored in source order would otherwise walk
 * every test through the material from the top, which makes the first section the one that is
 * always answered while fresh.
 */
export function selectAttemptQuestions<TQuestion extends SelectableQuestion>(params: {
  questions: TQuestion[];
  previousAttemptQuestionIds: string[][];
  requestedCount?: number;
  random?: Random;
}): AttemptSelection<TQuestion> {
  const random = params.random ?? Math.random;
  const usable = usableBankQuestions(params.questions);
  const pool = usable.length > 0 ? usable : params.questions;
  const desiredCount = Math.min(
    params.requestedCount ?? targetQuestionCount(pool.length),
    pool.length,
  );
  const usage = buildQuestionUsage(params.previousAttemptQuestionIds);
  const previousIds = new Set(
    params.previousAttemptQuestionIds[params.previousAttemptQuestionIds.length - 1] ?? [],
  );

  const remaining = [...pool];
  const selected: TQuestion[] = [];
  const unitCounts = new Map<number, number>();
  const conceptCounts = new Map<string, number>();
  const difficultyCounts = new Map<string, number>();

  while (selected.length < desiredCount && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const question = remaining[index] as TQuestion;
      const score = pickScore({
        question,
        usage: usage.get(question.id) ?? NO_USAGE,
        unitCounts,
        conceptCounts,
        difficultyCounts,
        random,
      });

      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const [picked] = remaining.splice(bestIndex, 1) as [TQuestion];
    selected.push(picked);
    const unitKey = picked.source_unit_idx ?? -1;
    unitCounts.set(unitKey, (unitCounts.get(unitKey) ?? 0) + 1);
    if (picked.concept_key) {
      conceptCounts.set(picked.concept_key, (conceptCounts.get(picked.concept_key) ?? 0) + 1);
    }
    difficultyCounts.set(picked.difficulty, (difficultyCounts.get(picked.difficulty) ?? 0) + 1);
  }

  const repeatedFromPrevious = selected.filter((question) => previousIds.has(question.id)).length;

  return {
    questions: shuffle(selected, random),
    previousOverlapRatio: selected.length === 0 ? 0 : repeatedFromPrevious / selected.length,
  };
}

export function shuffle<T>(values: T[], random: Random = Math.random) {
  const output = [...values];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const currentValue = output[index] as T;
    output[index] = output[swapIndex] as T;
    output[swapIndex] = currentValue;
  }

  return output;
}

/**
 * What share of the bank has been on a test at least once. Recorded on the attempt so a bank that
 * is never fully drawn from is visible in the data rather than only in a learner's impression.
 */
export function bankCoverageRatio(params: {
  questions: SelectableQuestion[];
  previousAttemptQuestionIds: string[][];
}) {
  const pool = usableBankQuestions(params.questions);

  if (pool.length === 0) {
    return 0;
  }

  const seen = new Set(params.previousAttemptQuestionIds.flat());

  return pool.filter((question) => seen.has(question.id)).length / pool.length;
}
