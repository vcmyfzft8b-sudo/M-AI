/**
 * How close the learner is to their target grade, said honestly.
 *
 * Learners overrate their readiness, most of all after cramming (Kornell &
 * Bjork 2008; Serra & DeMarree 2016), and the cost of that is stopping too
 * early. So the forecast never uses self-rating. It is built from:
 *
 * 1. Accuracy on questions answered the *first* time. A question seen before
 *    is weighted 0.3 and from the third look on 0, because accuracy on
 *    repeated questions mostly measures having seen them. Older answers decay
 *    with a 14-day half-life. Each note gets a Beta posterior (prior 2/2).
 *    Answers in the exam's own format count for more (Adesope et al. 2017):
 *    written practice tests for a written exam, the quiz for a multiple-choice
 *    one; recognising the right option is easier than recalling it.
 * 2. Coverage: the share of the note studied at all. Unstudied material is
 *    worth the guessing rate (a quarter on a four-option test, ~0 written).
 * 3. Memory: FSRS recall (./fsrs.ts) on exam morning, which decays today's
 *    accuracy by the forgetting still to come, or lifts it if the plan's
 *    reviews are done.
 * 4. Transfer: app questions are not the examiner's. A discount τ ≈ 0.9.
 *
 * The range is a Monte Carlo over the posterior, τ, and the luck of which
 * questions the exam happens to ask. Below a minimum of evidence there is no
 * forecast at all, only coverage and memory. None of the constants are fitted
 * yet; the plan asks for the real result after the exam so they can be.
 */
import { examMorningMs } from "./dates.ts";
import { recallAt, type MemoryState } from "./fsrs.ts";
import { clampPercent, gradeForPercent } from "./grade-scales.ts";
import type {
  ExamEvidence,
  ExamMaterialNote,
  ExamPlanSettings,
  ExamReadiness,
  ExamTypeId,
  ForecastRange,
  NoteReadiness,
} from "./model.ts";

/** Weighted first-attempt answers needed before any forecast is shown. */
export const FORECAST_EVIDENCE_NEEDED = 10;

const REPEAT_WEIGHTS = [1, 0.3, 0];
const RECENCY_HALF_LIFE_DAYS = 14;
const TRANSFER_MEAN = 0.9;
const TRANSFER_SD = 0.05;
const DRAWS = 1500;
/**
 * Recalling a flashcard is not answering an exam question: cards are atomic
 * facts, exams ask to use them. Without any exam-style answers, memory is
 * taken at three quarters of its face value, and the range is kept wide.
 */
const MEMORY_ONLY_CREDIT = 0.75;

/** What a correct guess is worth on this kind of exam. */
const GUESS_RATE: Record<ExamTypeId, number> = {
  multiple_choice: 0.25,
  mixed: 0.1,
  written: 0.03,
  problem_solving: 0.02,
  oral: 0.05,
};

/** Roughly how many questions the exam samples; fewer questions, more luck. */
const EXAM_QUESTIONS: Record<ExamTypeId, number> = {
  multiple_choice: 40,
  mixed: 30,
  written: 20,
  problem_solving: 15,
  oral: 6,
};

/** How much a quiz (multiple-choice) answer and a written practice answer say about this exam. */
const FORMAT_WEIGHT: Record<ExamTypeId, { quiz: number; quizCredit: number; practice: number }> = {
  multiple_choice: { quiz: 1, quizCredit: 1, practice: 0.8 },
  mixed: { quiz: 0.8, quizCredit: 0.9, practice: 1.1 },
  written: { quiz: 0.6, quizCredit: 0.8, practice: 1.3 },
  problem_solving: { quiz: 0.6, quizCredit: 0.8, practice: 1.3 },
  oral: { quiz: 0.5, quizCredit: 0.8, practice: 1.2 },
};

export function guessRate(examType: ExamTypeId) {
  return GUESS_RATE[examType];
}

// ---------------------------------------------------------------------------
// A small seeded PRNG, so the same evidence always draws the same range.
// ---------------------------------------------------------------------------

function hashSeed(text: string) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia–Tsang. */
function gamma(shape: number, random: () => number): number {
  if (shape < 1) {
    return gamma(shape + 1, random) * Math.pow(Math.max(random(), 1e-12), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x: number;
    let v: number;

    do {
      x = normal(random);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = random();

    if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

function beta(a: number, b: number, random: () => number) {
  const x = gamma(a, random);
  const y = gamma(b, random);
  return x / (x + y);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

// ---------------------------------------------------------------------------
// Evidence per note
// ---------------------------------------------------------------------------

interface NoteAccuracy {
  alpha: number;
  beta: number;
  /** Weighted answers, before the format weight. */
  answers: number;
  /** Question ids answered at least once, for coverage. */
  answered: Set<string>;
}

export function firstAttemptAccuracy(
  evidence: ExamEvidence,
  examType: ExamTypeId,
  nowMs: number,
): Map<string, NoteAccuracy> {
  const result = new Map<string, NoteAccuracy>();
  const format = FORMAT_WEIGHT[examType];
  const entry = (lectureId: string) => {
    let value = result.get(lectureId);

    if (!value) {
      value = { alpha: 2, beta: 2, answers: 0, answered: new Set() };
      result.set(lectureId, value);
    }

    return value;
  };
  const recency = (atMs: number) =>
    Math.pow(0.5, Math.max(0, nowMs - atMs) / 86_400_000 / RECENCY_HALF_LIFE_DAYS);

  const exposures = new Map<string, number>();
  const quizEvents = evidence.events
    .filter((event) => event.kind === "quiz")
    .sort((a, b) => a.atMs - b.atMs);

  for (const event of quizEvents) {
    const seen = exposures.get(event.itemId) ?? 0;
    exposures.set(event.itemId, seen + 1);
    const weight = REPEAT_WEIGHTS[Math.min(seen, REPEAT_WEIGHTS.length - 1)] * recency(event.atMs);
    const value = entry(event.lectureId);
    value.answered.add(event.itemId);

    if (weight <= 0) {
      continue;
    }

    const credit = event.outcome >= 3 ? format.quizCredit : 0;
    value.alpha += weight * format.quiz * credit;
    value.beta += weight * format.quiz * (1 - credit);
    value.answers += weight;
  }

  const practiceExposures = new Map<string, number>();
  const practice = [...evidence.practiceAnswers].sort((a, b) => a.atMs - b.atMs);

  for (const answer of practice) {
    const key = answer.questionId ?? `${answer.attemptId}:${answer.atMs}`;
    const seen = practiceExposures.get(key) ?? 0;
    practiceExposures.set(key, seen + 1);
    const weight = REPEAT_WEIGHTS[Math.min(seen, REPEAT_WEIGHTS.length - 1)] * recency(answer.atMs);
    const value = entry(answer.lectureId);

    if (answer.questionId) {
      value.answered.add(answer.questionId);
    }

    if (weight <= 0) {
      continue;
    }

    const score = clamp01(answer.score);
    value.alpha += weight * format.practice * score;
    value.beta += weight * format.practice * (1 - score);
    value.answers += weight;
  }

  return result;
}

function memoryItems(note: ExamMaterialNote) {
  const cards = note.sections.flatMap((section) => section.cardIds).map((id) => `f:${id}`);
  return cards.length > 0 ? cards : note.quizQuestionIds.map((id) => `q:${id}`);
}

function meanRecall(keys: string[], memory: Map<string, MemoryState>, atMs: number) {
  const studied = keys.filter((key) => memory.has(key));

  if (studied.length === 0) {
    return { mean: 0, studied: 0 };
  }

  const total = studied.reduce((sum, key) => sum + recallAt(memory.get(key) ?? null, atMs), 0);
  return { mean: total / studied.length, studied: studied.length };
}

interface NoteModel {
  note: ExamMaterialNote;
  weight: number;
  coverageNow: number;
  coverageAtExam: number;
  memoryNow: number;
  memoryAtExam: number;
  memoryIfStopped: number;
  studiedNow: number;
  studiedAtExam: number;
  accuracy: NoteAccuracy | null;
}

function buildNoteModels(input: {
  notes: ExamMaterialNote[];
  memoryNow: Map<string, MemoryState>;
  memoryAtExam: Map<string, MemoryState>;
  accuracy: Map<string, NoteAccuracy>;
  nowMs: number;
  examMs: number;
}): NoteModel[] {
  return input.notes.map((note) => {
    const keys = memoryItems(note);
    const total = keys.length;
    const now = meanRecall(keys, input.memoryNow, input.nowMs);
    const stopped = meanRecall(keys, input.memoryNow, input.examMs);
    const planned = meanRecall(keys, input.memoryAtExam, input.examMs);
    const accuracy = input.accuracy.get(note.lectureId) ?? null;
    const questions = note.quizQuestionIds.length + note.practiceQuestionIds.length;
    const answeredShare =
      accuracy && questions > 0 ? Math.min(1, accuracy.answered.size / questions) : 0;
    const coverageNow = Math.max(total > 0 ? now.studied / total : 0, answeredShare);
    const coverageAtExam = Math.max(total > 0 ? planned.studied / total : 0, coverageNow);

    return {
      note,
      weight: Math.max(1, total + questions),
      coverageNow,
      coverageAtExam,
      memoryNow: now.mean,
      memoryAtExam: planned.mean,
      memoryIfStopped: stopped.mean,
      studiedNow: now.studied,
      studiedAtExam: planned.studied,
      accuracy: accuracy && accuracy.answers > 0 ? accuracy : null,
    };
  });
}

type Horizon = "today" | "exam";

/** One note's chance of a right answer, given a draw of its knowledge and τ. */
function noteScore(
  model: NoteModel,
  horizon: Horizon,
  transfer: number,
  guess: number,
  random: (() => number) | null,
) {
  const coverage = horizon === "today" ? model.coverageNow : model.coverageAtExam;
  const memory = horizon === "today" ? model.memoryNow : model.memoryAtExam;
  const studied = horizon === "today" ? model.studiedNow : model.studiedAtExam;
  let knowledge: number;

  if (model.accuracy) {
    const { alpha, beta: b } = model.accuracy;
    const accuracy = random ? beta(alpha, b, random) : alpha / (alpha + b);
    // Today's accuracy, carried to exam morning by the forgetting (or the
    // reviews) between now and then.
    const ratio =
      horizon === "today" || model.memoryNow < 0.05
        ? 1
        : Math.min(1.35, model.memoryAtExam / model.memoryNow);
    knowledge = Math.min(0.98, accuracy * ratio);
  } else if (studied > 0) {
    // Recall without any exam-style answers is weak evidence: wide on purpose.
    const strength = 2 + Math.min(20, studied / 3);
    const credited = memory * MEMORY_ONLY_CREDIT;
    knowledge = random
      ? beta(credited * strength + 0.5, (1 - credited) * strength + 0.5, random)
      : credited;
  } else {
    knowledge = 0;
  }

  const known = clamp01(coverage * transfer * knowledge);
  return known + (1 - known) * guess;
}

function forecastRange(
  models: NoteModel[],
  horizon: Horizon,
  settings: ExamPlanSettings,
  seed: string,
  locale: string | undefined,
): ForecastRange {
  const guess = GUESS_RATE[settings.examType];
  const questions = EXAM_QUESTIONS[settings.examType];
  const totalWeight = models.reduce((sum, model) => sum + model.weight, 0) || 1;
  const random = mulberry32(hashSeed(seed));
  const draws: number[] = [];
  let hits = 0;

  for (let draw = 0; draw < DRAWS; draw += 1) {
    const transfer = Math.min(1, Math.max(0.75, TRANSFER_MEAN + TRANSFER_SD * normal(random)));
    let expected = 0;

    for (const model of models) {
      expected += (model.weight / totalWeight) * noteScore(model, horizon, transfer, guess, random);
    }

    // The luck of which questions come up.
    const noise = normal(random) * Math.sqrt((expected * (1 - expected)) / questions);
    const score = clamp01(expected + noise) * 100;
    draws.push(score);

    if (score >= settings.targetPercent) {
      hits += 1;
    }
  }

  draws.sort((a, b) => a - b);
  const low = clampPercent(percentile(draws, 0.1));
  const mid = clampPercent(percentile(draws, 0.5));
  const high = clampPercent(percentile(draws, 0.9));
  const target = { label: settings.targetGrade, percent: settings.targetPercent };
  const grade = (value: number) =>
    gradeForPercent(settings.gradeScale, value, { locale, target });

  return {
    low: Math.round(low),
    mid: Math.round(mid),
    high: Math.round(high),
    chanceOfTarget: hits / DRAWS,
    gradeLow: grade(low),
    gradeMid: grade(mid),
    gradeHigh: grade(high),
  };
}

export function buildReadiness(input: {
  settings: ExamPlanSettings;
  notes: ExamMaterialNote[];
  evidence: ExamEvidence;
  nowMs: number;
  memoryNow: Map<string, MemoryState>;
  memoryAtExam: Map<string, MemoryState>;
  locale?: string;
}): ExamReadiness {
  const { settings, notes, nowMs } = input;
  const examMs = Math.max(nowMs, examMorningMs(settings.examDate));
  const accuracy = firstAttemptAccuracy(input.evidence, settings.examType, nowMs);
  const models = buildNoteModels({
    notes,
    memoryNow: input.memoryNow,
    memoryAtExam: input.memoryAtExam,
    accuracy,
    nowMs,
    examMs,
  });
  const totalWeight = models.reduce((sum, model) => sum + model.weight, 0) || 1;
  const weighted = (pick: (model: NoteModel) => number) =>
    models.reduce((sum, model) => sum + (model.weight / totalWeight) * pick(model), 0);
  const evidence = models.reduce((sum, model) => sum + (model.accuracy?.answers ?? 0), 0);
  const withAccuracy = models.filter((model) => model.accuracy);
  const accuracyWeight = withAccuracy.reduce((sum, model) => sum + model.weight, 0);
  const pooledAccuracy =
    accuracyWeight > 0
      ? withAccuracy.reduce((sum, model) => {
          const { alpha, beta: b } = model.accuracy as NoteAccuracy;
          return sum + (model.weight / accuracyWeight) * (alpha / (alpha + b));
        }, 0)
      : null;
  // Memory is shown over the whole exam, unstudied material counted as zero,
  // so it can only be high when coverage is too.
  const memoryOverAll = (pick: (model: NoteModel) => number, coverage: (model: NoteModel) => number) =>
    weighted((model) => pick(model) * coverage(model));
  const seed = `${settings.id}:${Math.floor(nowMs / 86_400_000)}`;

  const noteReadiness: NoteReadiness[] = models.map((model) => ({
    lectureId: model.note.lectureId,
    title: model.note.title,
    emoji: model.note.emoji,
    coverage: model.coverageNow,
    memoryNow: model.memoryNow,
    memoryAtExam: model.memoryAtExam,
    accuracy: model.accuracy
      ? model.accuracy.alpha / (model.accuracy.alpha + model.accuracy.beta)
      : null,
    answers: Math.round((model.accuracy?.answers ?? 0) * 10) / 10,
  }));

  return {
    unlocked: evidence >= FORECAST_EVIDENCE_NEEDED,
    evidence: Math.round(evidence * 10) / 10,
    evidenceNeeded: FORECAST_EVIDENCE_NEEDED,
    coverage: weighted((model) => model.coverageNow),
    memoryNow: memoryOverAll((model) => model.memoryNow, (model) => model.coverageNow),
    memoryAtExamOnPlan: memoryOverAll(
      (model) => model.memoryAtExam,
      (model) => model.coverageAtExam,
    ),
    memoryAtExamIfStopped: memoryOverAll(
      (model) => model.memoryIfStopped,
      (model) => model.coverageNow,
    ),
    accuracy: pooledAccuracy,
    today: forecastRange(models, "today", settings, `${seed}:today`, input.locale),
    onPlan: forecastRange(models, "exam", settings, `${seed}:exam`, input.locale),
    notes: noteReadiness,
  };
}
