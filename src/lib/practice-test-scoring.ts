/**
 * How a practice-test answer turns into a mark.
 *
 * Kept free of "server-only" so the whole grade — the rubric arithmetic, the surrender
 * detection, the attempt totals — is exercised by `tests/practice-test-grading.test.mjs`
 * without a model, a request or a database.
 *
 * The model marks; it does not grade. It is asked one thing per marking point ("is this point
 * present in the answer?") and the score is computed here from those marks. A model asked for a
 * number straight out returns a different number for the same answer on different days, and
 * nothing about that number can be explained back to the learner. A rubric can: the score is a
 * function of which points the answer covered, and the breakdown says which ones those were.
 */

/** Every question is marked out of five, the way a written question on a school test is. */
export const PRACTICE_QUESTION_MAX_SCORE = 5;

/** What one marking point is worth toward the question's ratio. */
const MARK_CREDIT = {
  met: 1,
  partial: 0.5,
  missed: 0,
} as const;

export type PointMark = keyof typeof MARK_CREDIT;

export type RubricPointMark = {
  pointIndex: number;
  mark: PointMark;
};

/**
 * A student answer longer than this is truncated before it is marked. The submit route already
 * caps a single answer at 12000 characters; six thousand is well past any honest answer to a
 * five-point question and keeps a pasted wall of text from dominating the grading spend.
 */
export const GRADED_ANSWER_MAX_CHARS = 6000;

/** No more marking points than a five-point question can meaningfully carry. */
export const MAX_MARKING_POINTS = 6;

const BULLET_PREFIX = /^\s*(?:[-–—•*·]|\(?\d{1,2}[.)])\s+/;

/**
 * The answer guide as the generator writes it: one marking point per line, each line a bullet.
 * Older banks — and the legacy concept planner — stored prose instead, so a guide that carries no
 * bullets is split on sentence boundaries and, failing that, marked as a single point. A guide
 * that cannot be split into at least one concrete point is not gradable, which is what
 * `isGradableAnswerGuide` below is for.
 */
export function parseMarkingPoints(answerGuide: string): string[] {
  const lines = answerGuide
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bulleted = lines
    .filter((line) => BULLET_PREFIX.test(line))
    .map((line) => line.replace(BULLET_PREFIX, "").trim())
    .filter((line) => line.length > 0);

  if (bulleted.length > 0) {
    return dedupePoints(bulleted);
  }

  if (lines.length > 1) {
    return dedupePoints(lines);
  }

  const prose = lines[0] ?? "";

  if (prose.length === 0) {
    return [];
  }

  // A prose guide from the legacy planner: semicolons separate marking points far more reliably
  // than full stops do, and a guide that uses neither is one point.
  const segments = prose
    .split(/;\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 3);

  return dedupePoints(segments.length > 1 ? segments : [prose]);
}

function dedupePoints(points: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const point of points) {
    const key = point.toLowerCase().replace(/\s+/g, " ").trim();

    if (key.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(point.replace(/\s+/g, " ").trim());

    if (output.length >= MAX_MARKING_POINTS) {
      break;
    }
  }

  return output;
}

/**
 * A question can only be put on a test if its answer guide can be marked against. "Understands
 * the concept" is not a marking point and neither is an empty guide; both produce a grade nobody
 * can defend.
 */
export function isGradableAnswerGuide(answerGuide: string) {
  const points = parseMarkingPoints(answerGuide);

  return points.length > 0 && points.some((point) => point.length >= 3);
}

/**
 * Ways a learner says "I don't know" in the five languages Memo ships in, plus the punctuation
 * they type instead. Matched only against the whole answer: "ne vem, zakaj se topi" is an
 * attempt, "ne vem" is not, and the difference is whether anything else was written.
 */
const SURRENDER_ANSWERS = new Set([
  "?",
  "??",
  "???",
  "-",
  "--",
  "/",
  "x",
  "xx",
  "idk",
  "i dont know",
  "i do not know",
  "dont know",
  "no idea",
  "nothing",
  "none",
  "ne vem",
  "neznam",
  "ne znam",
  "nemam pojma",
  "nemam ideje",
  "nimam pojma",
  "nemam pojima",
  "ne znam odgovor",
  "ne vem odgovora",
  "ni odgovora",
  "brez odgovora",
  "preskoci",
  "pass",
  "skip",
]);

function foldForComparison(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9?/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nothing was written. */
export function isBlankAnswer(typedAnswer: string) {
  return typedAnswer.trim().length === 0;
}

/**
 * Written, but not an answer. Marking these with a model costs a call to arrive at the zero the
 * string already announces, and — worse — a model asked to mark "?" against four points
 * occasionally finds one of them in it.
 */
export function isSurrenderAnswer(typedAnswer: string) {
  const trimmed = typedAnswer.trim();

  if (trimmed.length === 0) {
    return true;
  }

  // Long text is an attempt whatever it says; only a short whole-answer match counts.
  if (trimmed.length > 24) {
    return false;
  }

  return SURRENDER_ANSWERS.has(foldForComparison(trimmed));
}

export function truncateAnswerForGrading(typedAnswer: string) {
  const trimmed = typedAnswer.trim();

  return trimmed.length <= GRADED_ANSWER_MAX_CHARS
    ? trimmed
    : `${trimmed.slice(0, GRADED_ANSWER_MAX_CHARS).trim()}…`;
}

/**
 * The marks the model returned, lined up against the points that were actually asked about.
 * A model that skips a point, repeats one, or invents a seventh cannot silently shift the rest
 * of the scheme: marks land by index, a point nobody marked counts as missed, and anything
 * outside the scheme is dropped.
 */
export function reconcilePointMarks(params: {
  pointCount: number;
  marks: RubricPointMark[];
}): PointMark[] {
  const reconciled = new Array<PointMark>(params.pointCount).fill("missed");
  const claimed = new Set<number>();

  for (const mark of params.marks) {
    if (
      !Number.isInteger(mark.pointIndex) ||
      mark.pointIndex < 0 ||
      mark.pointIndex >= params.pointCount ||
      claimed.has(mark.pointIndex)
    ) {
      continue;
    }

    claimed.add(mark.pointIndex);
    reconciled[mark.pointIndex] = mark.mark;
  }

  return reconciled;
}

export type RubricGrade = {
  score: number;
  earnedPoints: number;
  totalPoints: number;
  ratio: number;
};

/**
 * The ratio-to-mark bands.
 *
 * Deliberately not `round(ratio * 5)`: rounding hands out a 5 for 90% of the scheme, and a five
 * out of five has to mean the answer was complete or the mark stops meaning anything. It also
 * rounds a half-covered answer up to 3/5 — a comfortable pass for half the material. The bands
 * below are the ones a teacher marking out of five actually uses.
 */
const SCORE_BANDS: Array<{ minRatio: number; score: number }> = [
  { minRatio: 1, score: 5 },
  { minRatio: 0.8, score: 4 },
  { minRatio: 0.6, score: 3 },
  { minRatio: 0.4, score: 2 },
  { minRatio: 0.0001, score: 1 },
];

/**
 * The mark, from the marks. `criticalError` is an answer that asserts something the marking
 * scheme contradicts — a learner who names the wrong mechanism and then describes it correctly
 * has not earned four out of five, however many points the description happened to touch.
 */
export function scoreFromRubric(params: {
  marks: PointMark[];
  criticalError?: boolean;
  offTopic?: boolean;
}): RubricGrade {
  const totalPoints = params.marks.length;

  if (totalPoints === 0) {
    return { score: 0, earnedPoints: 0, totalPoints: 0, ratio: 0 };
  }

  const earnedPoints = params.marks.reduce((total, mark) => total + MARK_CREDIT[mark], 0);
  const ratio = earnedPoints / totalPoints;

  if (params.offTopic) {
    return { score: 0, earnedPoints, totalPoints, ratio };
  }

  const band = SCORE_BANDS.find((candidate) => ratio >= candidate.minRatio);
  let score = band?.score ?? 0;

  if (params.criticalError) {
    // A contradiction costs a mark and puts full or near-full marks out of reach, but it does not
    // erase the points the answer did earn.
    score = Math.max(0, Math.min(score - 1, 3));
  }

  return {
    score: clampQuestionScore(score),
    earnedPoints,
    totalPoints,
    ratio,
  };
}

export function clampQuestionScore(score: number) {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(PRACTICE_QUESTION_MAX_SCORE, Math.round(score)));
}

export type AttemptScoreSummary = {
  totalScore: number;
  maxScore: number;
  percentage: number;
  gradedCount: number;
  ungradedCount: number;
};

/**
 * The attempt total. An answer the grader could not mark is left out of both sides of the
 * fraction rather than counted as a zero: a model outage is not the learner's mistake, and
 * scoring it as one would quietly hand them a wrong percentage they cannot appeal.
 */
export function summariseAttemptScores(scores: Array<number | null>): AttemptScoreSummary {
  const graded = scores.filter((score): score is number => typeof score === "number");
  const totalScore = graded.reduce((total, score) => total + score, 0);
  const maxScore = graded.length * PRACTICE_QUESTION_MAX_SCORE;

  return {
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0,
    gradedCount: graded.length,
    ungradedCount: scores.length - graded.length,
  };
}
