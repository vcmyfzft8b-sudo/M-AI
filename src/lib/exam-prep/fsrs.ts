/**
 * FSRS-5, the memory model behind the exam journey.
 *
 * FSRS (Free Spaced Repetition Scheduler, Ye et al.; the default scheduler in
 * Anki since 23.10) describes each card with two numbers: *stability* S, the
 * number of days after which recall falls to 90%, and *difficulty* D (1–10).
 * Recall after t days is the power forgetting curve
 *
 *     R(t, S) = (1 + F · t / S) ^ C,   F = 19/81, C = −0.5,
 *
 * so R(S, S) = 0.9 by construction. Each review updates S and D from the grade
 * and from how much had already been forgotten. The weights below are FSRS-5's
 * published defaults, fitted on hundreds of millions of real Anki reviews; we
 * do not have enough history per learner to fit our own yet.
 *
 * https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
 */

export const FSRS_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
] as const;

const W = FSRS_WEIGHTS;
const DECAY = -0.5;
const FACTOR = 19 / 81;
const MIN_STABILITY = 0.1;
const MAX_STABILITY = 36_500;

/** FSRS grades. The app's cards have no "hard" button, so 2 never comes from a card. */
export type FsrsGrade = 1 | 2 | 3 | 4;

export interface MemoryState {
  /** Days until recall drops to 90%. */
  stability: number;
  /** 1 (easy) … 10 (hard). */
  difficulty: number;
  /** When it was last reviewed, epoch ms. */
  lastReviewMs: number;
  /** The learner-local day of the last review, for same-day handling. */
  lastReviewDay: string;
  reviews: number;
  lapses: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function retrievability(elapsedDays: number, stability: number) {
  if (elapsedDays <= 0) {
    return 1;
  }

  return Math.pow(1 + (FACTOR * elapsedDays) / Math.max(stability, MIN_STABILITY), DECAY);
}

/** Days until recall falls to `desiredRetention`. */
export function intervalForRetention(stability: number, desiredRetention: number) {
  return (stability / FACTOR) * (Math.pow(desiredRetention, 1 / DECAY) - 1);
}

function initialStability(grade: FsrsGrade) {
  return Math.max(W[grade - 1], MIN_STABILITY);
}

function initialDifficulty(grade: FsrsGrade) {
  return clamp(W[4] - Math.exp(W[5] * (grade - 1)) + 1, 1, 10);
}

function nextDifficulty(difficulty: number, grade: FsrsGrade) {
  const delta = -W[6] * (grade - 3);
  // FSRS-5's linear damping: the harder a card already is, the less a lapse moves it.
  const damped = difficulty + (delta * (10 - difficulty)) / 9;
  // Mean reversion toward the difficulty of a card first answered "easy".
  return clamp(W[7] * initialDifficulty(4) + (1 - W[7]) * damped, 1, 10);
}

function recallStability(difficulty: number, stability: number, recall: number, grade: FsrsGrade) {
  const hardPenalty = grade === 2 ? W[15] : 1;
  const easyBonus = grade === 4 ? W[16] : 1;
  const growth =
    Math.exp(W[8]) *
    (11 - difficulty) *
    Math.pow(stability, -W[9]) *
    (Math.exp((1 - recall) * W[10]) - 1) *
    hardPenalty *
    easyBonus;

  return clamp(stability * (1 + growth), MIN_STABILITY, MAX_STABILITY);
}

function forgetStability(difficulty: number, stability: number, recall: number) {
  const next =
    W[11] *
    Math.pow(difficulty, -W[12]) *
    (Math.pow(stability + 1, W[13]) - 1) *
    Math.exp((1 - recall) * W[14]);

  return clamp(Math.min(next, stability), MIN_STABILITY, MAX_STABILITY);
}

/**
 * FSRS-5's same-day rule. A second look at a card within the day it was
 * studied barely moves long-term memory, which is also why cramming feels
 * like it works and does not.
 */
function shortTermStability(stability: number, grade: FsrsGrade) {
  return clamp(stability * Math.exp(W[17] * (grade - 3 + W[18])), MIN_STABILITY, MAX_STABILITY);
}

/** Applies one review. `state` is null for an item never seen before. */
export function reviewMemory(
  state: MemoryState | null,
  grade: FsrsGrade,
  atMs: number,
  day: string,
): MemoryState {
  if (!state) {
    return {
      stability: initialStability(grade),
      difficulty: initialDifficulty(grade),
      lastReviewMs: atMs,
      lastReviewDay: day,
      reviews: 1,
      lapses: grade === 1 ? 1 : 0,
    };
  }

  if (state.lastReviewDay === day) {
    return {
      ...state,
      stability: shortTermStability(state.stability, grade),
      difficulty: nextDifficulty(state.difficulty, grade),
      lastReviewMs: Math.max(state.lastReviewMs, atMs),
      reviews: state.reviews + 1,
    };
  }

  const recall = retrievability((atMs - state.lastReviewMs) / 86_400_000, state.stability);

  return {
    stability:
      grade === 1
        ? forgetStability(state.difficulty, state.stability, recall)
        : recallStability(state.difficulty, state.stability, recall, grade),
    difficulty: nextDifficulty(state.difficulty, grade),
    lastReviewMs: atMs,
    lastReviewDay: day,
    reviews: state.reviews + 1,
    lapses: state.lapses + (grade === 1 ? 1 : 0),
  };
}

/**
 * The expected state after a planned review, for projecting a plan forward.
 *
 * We cannot know whether a future review will succeed, only how likely it is
 * (the card's recall on that day). So the projection averages the "remembered"
 * and "forgot" outcomes by that probability instead of assuming success, which
 * would make every plan look better than it is.
 */
export function expectedReviewMemory(state: MemoryState, atMs: number, day: string): MemoryState {
  const recall = retrievability((atMs - state.lastReviewMs) / 86_400_000, state.stability);
  const remembered = reviewMemory(state, 3, atMs, day);
  const forgot = reviewMemory(state, 1, atMs, day);

  return {
    stability: recall * remembered.stability + (1 - recall) * forgot.stability,
    difficulty: recall * remembered.difficulty + (1 - recall) * forgot.difficulty,
    lastReviewMs: atMs,
    lastReviewDay: day,
    reviews: state.reviews + 1,
    lapses: state.lapses + (1 - recall),
  };
}

export function recallAt(state: MemoryState | null, atMs: number) {
  if (!state) {
    return 0;
  }

  return retrievability((atMs - state.lastReviewMs) / 86_400_000, state.stability);
}
