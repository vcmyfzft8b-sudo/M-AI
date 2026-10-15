/**
 * Exam prep, everything that is arithmetic rather than I/O.
 *
 * An exam is a date and a list of notes, split into topics. Each topic is a module on the
 * learner's path, and a module is a fixed chain of six short lessons: read the summary, have the
 * voice tutor explain it and ask about it, then flashcards, a quiz, true/false and one written
 * answer. Mastery, the daily plan, the streak and which modules are unlocked are all derived here
 * from the lesson results, so the server, the screens and the tests agree on one definition of each.
 *
 * Kept free of imports so `node --test` can load it without the app's path aliases.
 */

export const EXAM_LESSON_KINDS = ["summary", "tutor", "flashcards", "quiz", "true_false", "written"] as const;
export type ExamLessonKind = (typeof EXAM_LESSON_KINDS)[number];

/** The lessons that test something. The summary is read, so it counts as done but not as mastery. */
export const PRACTICE_LESSON_KINDS = ["tutor", "flashcards", "quiz", "true_false", "written"] as const;

/*
 * How much each lesson counts towards a topic's mastery. Flashcards are graded by the learner
 * ("knew it" or not), so they count half: what the learner thinks they know should not weigh as
 * much as what a question proved.
 */
export const LESSON_WEIGHT: Record<(typeof PRACTICE_LESSON_KINDS)[number], number> = {
  tutor: 1,
  flashcards: 0.5,
  quiz: 1,
  true_false: 1,
  written: 1,
};

/*
 * Spaced review: a passed lesson keeps its score for a few days, then fades a little each day
 * until it is done again, so a topic learned weeks before the exam comes back for review before
 * it, instead of counting as known on the day. A perfect lesson against an 85 % target is due
 * again about a week later; a bare pass sooner. It never fades below 60 % of what was scored.
 *
 * Fading schedules a refresh ("Osveži"); it never un-masters a module. A lesson the learner passed
 * stays passed until a new try of it falls short. Otherwise an exam of many topics could never be
 * mastered all at once (eight topics are forty practice lessons, and a perfect one stays above a
 * 90 % mark for five and a half days), so the mock exam would never come up. The mock exam is what
 * checks that faded knowledge is still there: a mock under the target sends its weak modules back.
 */
export const REVIEW_GRACE_DAYS = 3;
export const REVIEW_FADE_PER_DAY = 0.04;
export const REVIEW_FLOOR = 0.6;

export function fadedScore(score: number, completedAt: string, now: Date | null): number {
  const value = clamp01(score);

  if (!now) {
    return value;
  }

  const days = (now.getTime() - new Date(completedAt).getTime()) / 86_400_000;

  if (!Number.isFinite(days) || days <= REVIEW_GRACE_DAYS) {
    return value;
  }

  return value * Math.max(REVIEW_FLOOR, 1 - REVIEW_FADE_PER_DAY * (days - REVIEW_GRACE_DAYS));
}

/*
 * Passing a lesson. The learner chooses the exam's target (75, 90, 100 % …) and sees it as chosen,
 * but each lesson is checked against a pass mark derived from it that a lesson can actually score:
 *
 * - No pass mark is above LESSON_PASS_CAP (95 %). At a 100 % target every lesson would otherwise
 *   have to be flawless, and one wrong flashcard, a grader's half point or a day of fading would
 *   put "ready" out of reach for good.
 * - The tutor is marked per step in whole, half and quarter points (`tutorStepPoints`) over three
 *   steps, so its scores jump 100 % → 83 % → 75 %. Its pass mark is never above what one slip
 *   leaves (one step right only after the tutor explained it: 2.5 of 3), so an 85–100 % target does
 *   not demand a flawless conversation.
 * - Scores are stored as `real`: a 9/10 quiz reads back as 0.89999998. Every comparison allows
 *   PASS_EPSILON, far below one question's worth.
 *
 * The mock exam is checked against `passThreshold(target)`, the same cap without the tutor rule.
 */
export const LESSON_PASS_CAP = 0.95;
/** The tutor lesson's steps (`TUTOR_STEPS` in exam-tutor-server.ts; keep the two in step). */
export const TUTOR_LESSON_STEPS = 3;
export const TUTOR_PASS_CAP = (TUTOR_LESSON_STEPS - 0.5) / TUTOR_LESSON_STEPS;
export const PASS_EPSILON = 1e-4;

/** The pass mark for the exam as a whole (the mock exam), 0..1, from the learner's target. */
export function passThreshold(target: number) {
  return Math.min(Number.isFinite(target) ? clamp01(target) : 1, LESSON_PASS_CAP);
}

/** The pass mark one lesson is held to, 0..1. The summary is read, so it has none. */
export function lessonPassThreshold(kind: ExamLessonKind, target: number) {
  if (kind === "summary") {
    return 0;
  }

  const mark = passThreshold(target);
  return kind === "tutor" ? Math.min(mark, TUTOR_PASS_CAP) : mark;
}

/** Whether a score (0..1) reaches a pass mark, allowing for how scores are stored. */
export function meetsPassMark(score: number, mark: number) {
  return Number.isFinite(score) && score >= mark - PASS_EPSILON;
}

/** Whether one try of a lesson passed, the rule the path and the lesson's done screen share. */
export function lessonPassed(kind: ExamLessonKind, score: number, target: number) {
  return meetsPassMark(score, lessonPassThreshold(kind, target));
}

/** Whether a mock exam (percentage 0..100) passed the exam's target. */
export function mockPassed(percentage: number, target: number) {
  return Number.isFinite(percentage) && meetsPassMark(percentage / 100, passThreshold(target));
}

/*
 * A lesson the learner keeps failing is not offered again the same day after this many tries:
 * the path moves on to other work (the next module, other repeats, refreshes) and comes back to it
 * the next day, so one hard lesson cannot hold the whole plan.
 */
export const MAX_FAILED_TRIES_PER_DAY = 2;

export type ExamGradingScale = "uni_5_10" | "school_1_5" | "percent";
export type ExamFormat = "written" | "oral" | "both";
export type ExamKind = "midterm" | "exam" | "matura";

/** Reporting days are Ljubljana days everywhere in this product. */
export const EXAM_TIME_ZONE = "Europe/Ljubljana";

/** A lesson is sized to take about this long; the daily goal is the learner's minutes over it. */
export const LESSON_MINUTES = 6;

/* The mock exam's length, set on Astra's circular timer: 10 minutes to two hours, in fives. */
export const MOCK_MINUTES: DialRange & { initial: number } = { min: 10, max: 120, step: 5, initial: 45 };

/* The most notes one exam can hold; the create route rejects more. */
export const MAX_EXAM_MODULES = 40;

/* The most topics one exam's plan may hold: up to eight per note across a full exam is plenty. */
export const MAX_EXAM_TOPICS = 200;

/*
 * The most new material one setup lets the learner start. It is the smallest burst the note
 * routes allow (8 documents or links per 10 minutes, see `rateLimitPresets`), so the setup stops
 * before the server would refuse an upload halfway through.
 */
export const MAX_SETUP_UPLOADS = 8;

/* The target mastery a learner can set, and the dial's step. The create route enforces the range. */
export const TARGET_MIN = 50;
export const TARGET_MAX = 100;
export const TARGET_STEP = 5;
/*
 * The setup's dials (the target, the mock exam's length) are gauges open at the bottom: the
 * lowest value sits at -135° and the highest at +135° from 12 o'clock.
 */
export const DIAL_SWEEP = 135;

export type DialRange = { min: number; max: number; step: number };

export const TARGET_RANGE: DialRange = { min: TARGET_MIN, max: TARGET_MAX, step: TARGET_STEP };

/** Where a value sits on a dial, in degrees clockwise from 12 o'clock. */
export function dialAngle(value: number, range: DialRange) {
  const share = (Math.min(range.max, Math.max(range.min, value)) - range.min) / (range.max - range.min);
  return -DIAL_SWEEP + share * DIAL_SWEEP * 2;
}

/**
 * The value under a finger at (dx, dy) from a dial's centre (screen axes, y down), in the dial's
 * steps. In the open gap at the bottom the dial holds whichever end the finger came from, so
 * dragging past the top never wraps round to the bottom (or the other way).
 */
export function dialValueFromPoint(dx: number, dy: number, previous: number, range: DialRange) {
  if (dx === 0 && dy === 0) {
    return previous;
  }

  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;

  if (Math.abs(angle) > DIAL_SWEEP) {
    return previous >= (range.min + range.max) / 2 ? range.max : range.min;
  }

  const raw = range.min + ((angle + DIAL_SWEEP) / (DIAL_SWEEP * 2)) * (range.max - range.min);
  const stepped = range.min + Math.round((raw - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, stepped));
}

/** Where a target sits on the target dial. */
export function targetDialAngle(target: number) {
  return dialAngle(target, TARGET_RANGE);
}

/** The target under a finger on the target dial. */
export function targetFromDialPoint(dx: number, dy: number, previous: number) {
  return dialValueFromPoint(dx, dy, previous, TARGET_RANGE);
}

export function isExamLessonKind(value: unknown): value is ExamLessonKind {
  return typeof value === "string" && (EXAM_LESSON_KINDS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------- days */

const DAY_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD` of an instant, on the clock of `timeZone`. */
export function dayKey(instant: Date | string | number, timeZone = EXAM_TIME_ZONE): string {
  let format = DAY_FORMAT_CACHE.get(timeZone);

  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    DAY_FORMAT_CACHE.set(timeZone, format);
  }

  return format.format(new Date(instant));
}

function dayToUtc(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

/** Calendar arithmetic on `YYYY-MM-DD`, done in UTC so no daylight-saving hour can skew it. */
export function addDays(day: string, amount: number): string {
  return new Date(dayToUtc(day) + amount * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayToUtc(to) - dayToUtc(from)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (new Date(dayToUtc(day)).getUTCDay() + 6) % 7;
}

export function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  return new Date(dayToUtc(value)).toISOString().slice(0, 10) === value;
}

/* ---------------------------------------------------------------- progress */

export type LessonResultLike = {
  lecture_id: string;
  /** The topic the lesson was for; null for results from before exams were split into topics. */
  topic_id?: string | null;
  lesson_kind: ExamLessonKind;
  score: number;
  completed_at: string;
};

export type ModuleState = {
  /** The module: one topic of the exam (Astra's numbered modules are topics). */
  topicId: string;
  /** The note the topic belongs to, which access, grading and the mock exam go by. */
  lectureId: string;
  /** 0-based place on the path. */
  position: number;
  /** 0..1, the weighted average of each practice lesson's latest (faded) score; untried ones count 0. */
  mastery: number;
  /** Lessons tried at least once, out of `EXAM_LESSON_KINDS.length`. */
  lessonsDone: number;
  /** Every lesson has been done once: the first pass through the module is over. */
  learned: boolean;
  /**
   * Learned, and every practice lesson's latest try reached its pass mark (`lessonPassThreshold`).
   * A passed lesson that has only faded since is due for a refresh but keeps the module mastered.
   */
  mastered: boolean;
  unlocked: boolean;
  /** Practice lessons to repeat until they reach the pass mark, weakest first. Empty until learned. */
  review: ExamLessonKind[];
  /** Of those, the ones that had passed and have only faded below it since (due for review). */
  refresh: ExamLessonKind[];
  /** The lesson this module wants next: the first untried one, else the weakest to repeat. */
  nextKind: ExamLessonKind;
  /** Whether each lesson has been done, keyed by kind. */
  done: Record<ExamLessonKind, boolean>;
  /** The latest score of each practice lesson as it stands today (faded), or null when untried. */
  latest: Record<ExamLessonKind, number | null>;
  /** Tries of each lesson on `now`'s Ljubljana day that fell short of its pass mark (0 without `now`). */
  failedToday: Record<ExamLessonKind, number>;
};

/*
 * A failed mock exam asks for proof again: in a module the mock found weak, the lessons that
 * test the same way (the quiz and the written answer) count only once they are redone after it.
 */
export const MOCK_PROOF_KINDS = ["quiz", "written"] as const satisfies readonly ExamLessonKind[];

/** A graded mock exam, as far as the path cares: when, how well, and per note how well. */
export type MockOutcome = {
  at: string;
  /** 0..100. */
  percentage: number;
  /** 0..1 per note the mock asked about. */
  byLecture: Record<string, number>;
};

/* An instant as milliseconds, so `…Z` and `…+00:00` stamps compare by time, not by spelling. */
function instantOf(value: string | null | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function latestByKind(results: LessonResultLike[]) {
  const latest = {} as Record<ExamLessonKind, { score: number; at: string; time: number } | undefined>;

  for (const result of results) {
    const current = latest[result.lesson_kind];
    const time = instantOf(result.completed_at);

    if (!current || time > current.time) {
      latest[result.lesson_kind] = { score: result.score, at: result.completed_at, time };
    }
  }

  return latest;
}

/**
 * One module's progress against the exam's target (0..1). `proveSince` is set when a failed mock
 * found this module weak; its quiz and written answer then have to be passed again after it.
 * `now` turns on spaced review: scores fade with the days since the lesson (see `fadedScore`).
 */
export function moduleProgress(
  results: LessonResultLike[],
  target = 1,
  proveSince: string | null = null,
  now: Date | null = null,
) {
  const latest = latestByKind(results);
  const done = {} as Record<ExamLessonKind, boolean>;
  const scores = {} as Record<ExamLessonKind, number | null>;
  const raw = {} as Record<ExamLessonKind, number | null>;
  const failedToday = {} as Record<ExamLessonKind, number>;
  const today = now && Number.isFinite(now.getTime()) ? dayKey(now) : null;

  for (const kind of EXAM_LESSON_KINDS) {
    const entry = latest[kind];
    done[kind] = entry !== undefined;
    raw[kind] = entry ? clamp01(entry.score) : null;
    scores[kind] = entry ? fadedScore(entry.score, entry.at, now) : null;
    failedToday[kind] = 0;
  }

  if (today) {
    for (const result of results) {
      if (
        result.lesson_kind !== "summary" &&
        Number.isFinite(instantOf(result.completed_at)) &&
        dayKey(result.completed_at) === today &&
        !lessonPassed(result.lesson_kind, clamp01(result.score), target)
      ) {
        failedToday[result.lesson_kind] += 1;
      }
    }
  }

  const mark = (kind: ExamLessonKind) => lessonPassThreshold(kind, target);
  const totalWeight = PRACTICE_LESSON_KINDS.reduce((sum, kind) => sum + LESSON_WEIGHT[kind], 0);
  const mastery =
    PRACTICE_LESSON_KINDS.reduce((sum, kind) => sum + LESSON_WEIGHT[kind] * (scores[kind] ?? 0), 0) / totalWeight;
  const lessonsDone = EXAM_LESSON_KINDS.filter((kind) => done[kind]).length;
  const learned = lessonsDone === EXAM_LESSON_KINDS.length;
  const proveAfter = proveSince === null ? null : instantOf(proveSince);
  const needsProof = (kind: ExamLessonKind) =>
    proveAfter !== null &&
    (MOCK_PROOF_KINDS as readonly ExamLessonKind[]).includes(kind) &&
    (latest[kind]?.time ?? Number.NEGATIVE_INFINITY) <= proveAfter;
  /* Under the mark by the latest try itself, or owed to a failed mock: these keep a module unmastered. */
  const failing = (kind: ExamLessonKind) => !meetsPassMark(raw[kind] ?? 0, mark(kind)) || needsProof(kind);
  /* Passed, and only faded under the mark since: due for a refresh. */
  const faded = (kind: ExamLessonKind) => !failing(kind) && !meetsPassMark(scores[kind] ?? 0, mark(kind));
  const review = learned
    ? [...PRACTICE_LESSON_KINDS]
        .filter((kind) => failing(kind) || faded(kind))
        .sort((left, right) => (scores[left] ?? 0) - (scores[right] ?? 0))
    : [];
  const refresh = review.filter(faded);
  const owed = review.filter(failing);
  const firstUntried = EXAM_LESSON_KINDS.find((kind) => !done[kind]);
  const weakest = [...PRACTICE_LESSON_KINDS].sort(
    (left, right) => (scores[left] ?? 0) - (scores[right] ?? 0),
  )[0];
  const rested = (kind: ExamLessonKind) => failedToday[kind] < MAX_FAILED_TRIES_PER_DAY;

  return {
    mastery,
    lessonsDone,
    learned,
    mastered: learned && owed.length === 0,
    review,
    refresh,
    nextKind: firstUntried ?? owed.find(rested) ?? refresh.find(rested) ?? owed[0] ?? review[0] ?? weakest,
    done,
    latest: scores,
    failedToday,
  };
}

/**
 * Every module's state, in path order. A module is one topic; it is unlocked when it is the first,
 * when the one before it has been learned, or when the learner has already started it (Astra's
 * "test out": taking a locked module's quiz opens it). `target` is the exam's goal as 0..1.
 *
 * A module marked `available: false` (its note is still being made, its topics are not planned,
 * or the learner cannot open it) does not hold the path: the module after it unlocks as if it had
 * been learned, so one unfinished note never locks the rest of the exam.
 */
export function examModuleStates(
  modulesInOrder: { topicId: string; lectureId: string; available?: boolean }[],
  results: LessonResultLike[],
  target = 1,
  mock: MockOutcome | null = null,
  now: Date | null = null,
): ModuleState[] {
  const byTopic = new Map<string, LessonResultLike[]>();

  for (const result of results) {
    if (!result.topic_id) {
      continue;
    }

    const list = byTopic.get(result.topic_id) ?? [];
    list.push(result);
    byTopic.set(result.topic_id, list);
  }

  const failedMock = mock && !mockPassed(mock.percentage, target) ? mock : null;
  const states: ModuleState[] = [];

  modulesInOrder.forEach(({ topicId, lectureId }, position) => {
    const weakInMock =
      failedMock !== null &&
      lectureId in failedMock.byLecture &&
      !meetsPassMark(failedMock.byLecture[lectureId], passThreshold(target));
    const progress = moduleProgress(byTopic.get(topicId) ?? [], target, weakInMock ? failedMock.at : null, now);
    const previous = states[position - 1];
    const previousSkipped = modulesInOrder[position - 1]?.available === false && Boolean(previous?.unlocked);
    const unlocked = position === 0 || Boolean(previous?.learned) || previousSkipped || progress.lessonsDone > 0;

    states.push({ topicId, lectureId, position, unlocked, ...progress });
  });

  return states;
}

/*
 * Where the learner is, the way Astra moves a student to the exam: learn every module once,
 * practise each until its lessons reach their pass marks, prove it with a mock exam at or above the
 * target, then stay ready. A new try that falls short, or a mock that does, sends them back; fading
 * alone only schedules refreshes (see `fadedScore`). An exam with no modules yet is still learning.
 */
export type ExamStage = "learn" | "practise" | "prove" | "ready";

export function examStage(states: Pick<ModuleState, "learned" | "mastered">[], mock: MockOutcome | null, target: number): ExamStage {
  if (states.length === 0 || states.some((state) => !state.learned)) {
    return "learn";
  }

  if (states.some((state) => !state.mastered)) {
    return "practise";
  }

  return mock && mockPassed(mock.percentage, target) ? "ready" : "prove";
}

export type ExamNextStep =
  | { type: "lesson"; topicId: string; lectureId: string; kind: ExamLessonKind; review: boolean }
  | { type: "mock" }
  | null;

/**
 * What `examNextStep` reads of a module. `refresh` and `failedToday` come with `examModuleStates`;
 * `ready` and `pending` are the screen's own (`ExamModuleView`): a module whose note is still being
 * made, or that is only a placeholder until its topics are planned, has no lessons to open yet.
 */
export type ExamNextStepModule = Pick<
  ModuleState,
  "topicId" | "lectureId" | "learned" | "mastered" | "unlocked" | "review" | "nextKind" | "done" | "latest"
> &
  Partial<Pick<ModuleState, "refresh" | "failedToday">> & { ready?: boolean; pending?: boolean };

/**
 * What the path points at.
 *
 * 1. **Learn first.** The first module on the path with an untried lesson gets it, ahead of every
 *    repeat and refresh, so a learner who struggles with one lesson, or whose early modules fade,
 *    still gets through every topic.
 * 2. **Practise.** Then lessons that fell short of their pass mark, weakest first across modules;
 *    one that has failed `MAX_FAILED_TRIES_PER_DAY` times today waits until tomorrow while other
 *    work exists.
 * 3. **Prove.** With every module mastered the mock exam is next. Faded lessons do not hold it
 *    back: the mock is the check that they are still known.
 * 4. **Refresh.** Otherwise the most faded passed lesson (practise and ready), or once ready the
 *    weakest lesson anywhere, keeps the knowledge fresh until the exam.
 *
 * Modules the learner cannot open (`canOpen`), whose note is not ready, or that are placeholders
 * are skipped, and do not keep the modules after them locked.
 */
export function examNextStep(
  states: ExamNextStepModule[],
  stage: ExamStage,
  canOpen: (lectureId: string) => boolean = () => true,
): ExamNextStep {
  if (states.length === 0) {
    return null;
  }

  const usable = (state: ExamNextStepModule) =>
    state.ready !== false && state.pending !== true && canOpen(state.lectureId);
  const reachable: boolean[] = [];

  states.forEach((state, index) => {
    const previous = states[index - 1];
    reachable.push(
      state.unlocked || (index > 0 && reachable[index - 1] && (previous.learned || !usable(previous))),
    );
  });

  const open = states.filter((state, index) => reachable[index] && usable(state));
  const lesson = (state: ExamNextStepModule, kind: ExamLessonKind, review: boolean): ExamNextStep => ({
    type: "lesson",
    topicId: state.topicId,
    lectureId: state.lectureId,
    kind,
    review,
  });

  for (const state of open) {
    const untried = EXAM_LESSON_KINDS.find((kind) => !state.done[kind]);

    if (untried) {
      return lesson(state, untried, false);
    }
  }

  type Candidate = { state: ExamNextStepModule; kind: ExamLessonKind; score: number; order: number };
  const owed: Candidate[] = [];
  const due: Candidate[] = [];
  const resting: Candidate[] = [];
  let order = 0;

  for (const state of open) {
    for (const kind of state.review) {
      const candidate = { state, kind, score: state.latest[kind] ?? 0, order: order++ };

      if ((state.failedToday?.[kind] ?? 0) >= MAX_FAILED_TRIES_PER_DAY) {
        resting.push(candidate);
      } else if (state.refresh?.includes(kind)) {
        due.push(candidate);
      } else {
        owed.push(candidate);
      }
    }
  }

  const weakest = (list: Candidate[]) =>
    [...list].sort((left, right) => left.score - right.score || left.order - right.order)[0] ?? null;
  const firstOwed = weakest(owed);

  if (firstOwed) {
    return lesson(firstOwed.state, firstOwed.kind, true);
  }

  if (stage === "prove") {
    return { type: "mock" };
  }

  const firstDue = weakest(due);

  if (firstDue) {
    return lesson(firstDue.state, firstDue.kind, true);
  }

  if (stage === "ready") {
    const everything: Candidate[] = [];

    for (const state of open) {
      for (const kind of PRACTICE_LESSON_KINDS) {
        if ((state.failedToday?.[kind] ?? 0) < MAX_FAILED_TRIES_PER_DAY) {
          everything.push({ state, kind, score: state.latest[kind] ?? 0, order: order++ });
        }
      }
    }

    const keepSharp = weakest(everything);

    if (keepSharp) {
      return lesson(keepSharp.state, keepSharp.kind, true);
    }
  }

  /* Nothing else to do today: the lesson that is resting is still better than nothing. */
  const fallback = weakest(resting);
  return fallback ? lesson(fallback.state, fallback.kind, true) : null;
}

export function examMastery(states: Pick<ModuleState, "mastery">[]): number {
  if (states.length === 0) {
    return 0;
  }

  return states.reduce((sum, state) => sum + state.mastery, 0) / states.length;
}

export function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

/*
 * Percentages for display are floored, never rounded: they sit next to the learner's target, and
 * 89.6 % shown as "90 %" beside a 90 % target that it did not pass reads as a contradiction. The
 * same PASS_EPSILON as the pass check absorbs how scores are stored (0.9 reads back as 0.89999998),
 * so a number shows as the target exactly when it passes it.
 */

/** A 0..1 share as a whole percentage for display, floored (0.896 → 89). */
export function percent(value: number) {
  return wholePercent(clamp01(value) * 100);
}

/** A 0..100 percentage (a mock exam's) as a whole number for display, floored the same way. */
export function wholePercent(percentage: number) {
  if (!Number.isFinite(percentage)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.floor(percentage + PASS_EPSILON * 100)));
}

/* ---------------------------------------------------------------- daily plan */

export type DailyPlan = {
  /** Lessons today's plan asks for. */
  goal: number;
  /** Lessons finished today, on the Ljubljana clock. */
  doneToday: number;
  /** Days left before the exam, today included; 0 once the exam day has passed. */
  daysLeft: number;
  /** Lessons still owed across the exam: untried ones, plus repeats under the target. */
  remaining: number;
};

/**
 * Today's goal: what is left spread over the days before the exam, but never less than the
 * learner's minutes buy, so a long runway still has a real day's work in it. Computed against
 * what was left at the start of today, so finishing a lesson moves "done", not the goal.
 */
export function dailyPlan(input: {
  examDate: string;
  today: string;
  dailyMinutes: number;
  states: Pick<ModuleState, "lessonsDone" | "review">[];
  resultsToday: number;
  untriedDoneToday: number;
}): DailyPlan {
  const totalLessons = input.states.length * EXAM_LESSON_KINDS.length;
  const tried = input.states.reduce((sum, state) => sum + state.lessonsDone, 0);
  const repeats = input.states.reduce((sum, state) => sum + state.review.length, 0);
  const remaining = Math.max(0, totalLessons - tried) + repeats;
  const remainingAtStartOfDay = remaining + input.untriedDoneToday;
  const untilExam = daysBetween(input.today, input.examDate);
  const daysLeft = untilExam < 0 ? 0 : Math.max(1, untilExam);
  const byTime = Math.max(1, Math.round(input.dailyMinutes / LESSON_MINUTES));
  const byPlan = daysLeft > 0 ? Math.ceil(remainingAtStartOfDay / daysLeft) : 0;
  const goal = Math.max(1, byPlan, remainingAtStartOfDay > 0 ? Math.min(byTime, remainingAtStartOfDay) : byTime);

  return { goal, doneToday: input.resultsToday, daysLeft, remaining };
}

/** Consecutive Ljubljana days with at least one lesson, ending today (or yesterday, until today counts). */
export function streakDays(activeDays: Iterable<string>, today: string): number {
  const days = new Set(activeDays);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;

  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

/** The month grid for the setup calendar, Monday first, padded to whole weeks. */
export function monthGrid(month: string): { day: string; inMonth: boolean }[] {
  const monthKey = month.slice(0, 7);
  const first = `${monthKey}-01`;
  let last = first;

  while (addDays(last, 1).slice(0, 7) === monthKey) {
    last = addDays(last, 1);
  }

  const start = addDays(first, -weekdayIndex(first));
  const end = addDays(last, 6 - weekdayIndex(last));
  const cells: { day: string; inMonth: boolean }[] = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    cells.push({ day: cursor, inMonth: cursor.slice(0, 7) === monthKey });
  }

  return cells;
}

/* ---------------------------------------------------------------- grades */

/**
 * A percentage on the exam's own scale. University: below the pass mark is 5 and the rest of the
 * range is split into five equal bands, 6 to 10. School: below the pass mark is 1, then four bands
 * for 2 to 5.
 */
export function gradeForPercentage(
  scale: ExamGradingScale,
  percentage: number,
  passPercentage: number,
): string {
  const value = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
  const pass = Number.isFinite(passPercentage) ? Math.max(1, Math.min(99, passPercentage)) : 50;

  if (scale === "percent") {
    // Floored like every percentage shown beside a target (see `wholePercent`).
    return `${wholePercent(value)} %`;
  }

  const bands = scale === "uni_5_10" ? 5 : 4;
  const failGrade = scale === "uni_5_10" ? 5 : 1;

  if (value < pass) {
    return String(failGrade);
  }

  const span = (100 - pass) / bands;
  const band = span <= 0 ? bands - 1 : Math.min(bands - 1, Math.floor((value - pass) / span));

  return String(failGrade + 1 + band);
}

/** The grade the target mastery corresponds to, for the setup dial's caption. */
export function targetGrade(scale: ExamGradingScale, target: number, passPercentage: number) {
  return gradeForPercentage(scale, target, passPercentage);
}

/* ---------------------------------------------------------------- picking material */

/** A small deterministic generator, so a lesson drawn twice the same day is the same lesson. */
export function seededRandom(seed: string): () => number {
  let hash = 1779033703 ^ seed.length;

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  let state = hash >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);

    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = seededRandom(seed);
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }

  return copy;
}

export type FlashcardLike = {
  id: string;
  progress: { confidence_bucket: "again" | "good" | "easy"; last_reviewed_at: string | null } | null;
};

const CONFIDENCE_ORDER = { again: 0, none: 1, good: 2, easy: 3 } as const;

/** Cards the learner missed first, then unseen ones, then the longest unreviewed. */
export function pickFlashcards<T extends FlashcardLike>(cards: readonly T[], count: number, seed: string): T[] {
  return seededShuffle(cards, seed)
    .map((card, order) => ({ card, order }))
    .sort((left, right) => {
      const leftRank = CONFIDENCE_ORDER[left.card.progress?.confidence_bucket ?? "none"];
      const rightRank = CONFIDENCE_ORDER[right.card.progress?.confidence_bucket ?? "none"];

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      const leftSeen = left.card.progress?.last_reviewed_at ?? "";
      const rightSeen = right.card.progress?.last_reviewed_at ?? "";

      if (leftSeen !== rightSeen) {
        return leftSeen < rightSeen ? -1 : 1;
      }

      return left.order - right.order;
    })
    .slice(0, count)
    .map((entry) => entry.card);
}

export type QuizQuestionLike = {
  id: string;
  prompt: string;
  options: string[];
  correct_option_idx: number;
  explanation: string;
};

/**
 * A quiz question with its options shuffled. `correctIndex` points into the shuffled list.
 */
export function shuffleQuestion<T extends QuizQuestionLike>(question: T, seed: string) {
  const order = seededShuffle(
    question.options.map((_, index) => index),
    `${seed}:${question.id}`,
  );

  return {
    id: question.id,
    prompt: question.prompt,
    options: order.map((index) => question.options[index]),
    correctIndex: order.indexOf(question.correct_option_idx),
    explanation: question.explanation,
  };
}

export function pickQuiz<T extends QuizQuestionLike>(questions: readonly T[], count: number, seed: string) {
  return seededShuffle(
    questions.filter((question) => question.options.length >= 2),
    `${seed}:quiz`,
  )
    .slice(0, count)
    .map((question) => shuffleQuestion(question, seed));
}

export type TrueFalseStatement = {
  id: string;
  prompt: string;
  claim: string;
  isTrue: boolean;
  correctAnswer: string;
  explanation: string;
};

/**
 * True/false statements made from quiz questions: the question with one of its options as the
 * claimed answer, the right one about half the time. Drawn from the questions the quiz lesson did
 * not use, so the two lessons do not ask the same thing twice in one sitting.
 */
export function buildTrueFalse<T extends QuizQuestionLike>(
  questions: readonly T[],
  count: number,
  seed: string,
  excludeIds: ReadonlySet<string> = new Set(),
): TrueFalseStatement[] {
  const random = seededRandom(`${seed}:tf`);
  const usable = questions.filter(
    (question) =>
      question.options.length >= 2 &&
      question.correct_option_idx >= 0 &&
      question.correct_option_idx < question.options.length,
  );
  const fresh = usable.filter((question) => !excludeIds.has(question.id));
  const pool = fresh.length >= count ? fresh : [...fresh, ...usable.filter((question) => excludeIds.has(question.id))];

  return seededShuffle(pool, `${seed}:tf-order`)
    .slice(0, count)
    .map((question) => {
      const isTrue = random() < 0.5;
      const wrong = question.options
        .map((option, index) => ({ option, index }))
        .filter((entry) => entry.index !== question.correct_option_idx);
      const claimIndex = isTrue
        ? question.correct_option_idx
        : wrong[Math.floor(random() * wrong.length)].index;

      return {
        id: question.id,
        prompt: question.prompt,
        claim: question.options[claimIndex],
        isTrue,
        correctAnswer: question.options[question.correct_option_idx],
        explanation: question.explanation,
      };
    });
}

export type WrittenQuestionLike = { id: string; importance: number | null };

/** The most important written questions first, ties broken by the day's draw. */
export function pickWritten<T extends WrittenQuestionLike>(questions: readonly T[], count: number, seed: string): T[] {
  return seededShuffle(questions, `${seed}:written`)
    .map((question, order) => ({ question, order }))
    .sort((left, right) => {
      const importance = (right.question.importance ?? 3) - (left.question.importance ?? 3);
      return importance !== 0 ? importance : left.order - right.order;
    })
    .slice(0, count)
    .map((entry) => entry.question);
}

/**
 * The pool a repeat draws from: questions the learner has not been shown yet, and only as many
 * seen ones as it takes to make up `count`, so each try of a lesson is new questions as far as the
 * topic has them. When even that falls short the caller writes fresh ones (see `needsFreshItems`).
 */
export function preferUnseen<T extends { id: string }>(pool: readonly T[], seen: ReadonlySet<string>, count: number, seed: string): T[] {
  const unseen = pool.filter((item) => !seen.has(item.id));

  if (unseen.length >= count) {
    return unseen;
  }

  return [...unseen, ...seededShuffle(pool.filter((item) => seen.has(item.id)), `${seed}:seen`).slice(0, count - unseen.length)];
}

/** Whether a repeat has run out of new questions and should have some written for it. */
export function needsFreshItems(pool: readonly { id: string }[], seen: ReadonlySet<string>, count: number): boolean {
  return seen.size > 0 && pool.filter((item) => !seen.has(item.id)).length < count;
}

/*
 * The tutor lesson's marking: a step answered right at the first ask is worth a full point, right
 * after the tutor explained what was missing half, partly right at best a quarter, wrong nothing.
 */
export type TutorVerdict = "correct" | "partial" | "wrong";

export function tutorStepPoints(attempts: readonly TutorVerdict[]): number {
  if (attempts[0] === "correct") {
    return 1;
  }

  if (attempts.slice(1).includes("correct")) {
    return 0.5;
  }

  return attempts.includes("partial") ? 0.25 : 0;
}

/* ---------------------------------------------------------------- mock exam */

/* The oral mock's length: five minutes to half an hour of talking, in fives. */
export const ORAL_MINUTES: DialRange & { initial: number } = { min: 5, max: 30, step: 5, initial: 15 };

/** An oral mock asks about one question every four minutes: an answer and a follow-up each. */
export function oralQuestionCount(durationMinutes: number) {
  return Math.min(8, Math.max(2, Math.round(durationMinutes / 4)));
}

/*
 * The mock exam fills the time it is given, as Astra's timer promises: about a minute and a half
 * for a multiple-choice question and six for a written answer (what the grader expects of one),
 * a little over half the time on written answers. 45 minutes is 14 + 4, 90 is 28 + 8.
 */
export const MOCK_QUESTION_MINUTES = { choice: 1.5, written: 6 } as const;

export function mockQuestionCounts(durationMinutes: number) {
  const written = Math.max(1, Math.round((durationMinutes * 0.55) / MOCK_QUESTION_MINUTES.written));
  const choice = Math.max(
    3,
    Math.round((durationMinutes - written * MOCK_QUESTION_MINUTES.written) / MOCK_QUESTION_MINUTES.choice),
  );

  return { choice, written };
}

/** How long a set of mock questions takes, in minutes, at the paces above. */
export function mockMinutes(counts: { choice: number; written: number }) {
  return counts.choice * MOCK_QUESTION_MINUTES.choice + counts.written * MOCK_QUESTION_MINUTES.written;
}

/**
 * Round-robin across the exam's notes, weakest module first, so a mock covers every note and
 * leans on the ones the learner knows least.
 */
export function spreadAcrossModules<T extends { lectureId: string }>(
  pools: Map<string, T[]>,
  lectureOrder: string[],
  count: number,
): T[] {
  const queues = lectureOrder.map((lectureId) => [...(pools.get(lectureId) ?? [])]);
  const picked: T[] = [];

  while (picked.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();

      if (next) {
        picked.push(next);
      }

      if (picked.length >= count) {
        break;
      }
    }
  }

  return picked;
}

export type MockAnswerResult = {
  questionId: string;
  lectureId: string;
  kind: "choice" | "written";
  score: number;
  maxScore: number;
  strengths: string;
  missingPoints: string;
};

export function summarizeMock(results: MockAnswerResult[]) {
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxScore, 0);
  const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
  const byLecture = new Map<string, { score: number; max: number }>();

  for (const result of results) {
    const entry = byLecture.get(result.lectureId) ?? { score: 0, max: 0 };
    entry.score += result.score;
    entry.max += result.maxScore;
    byLecture.set(result.lectureId, entry);
  }

  const written = results.filter((result) => result.kind === "written");
  // A question worth nothing (maxScore 0) sorts as 0, not NaN, which would scramble the order.
  const share = (result: MockAnswerResult) =>
    result.maxScore > 0 && Number.isFinite(result.score) ? result.score / result.maxScore : 0;
  const strengths = [...written]
    .sort((left, right) => share(right) - share(left))
    .map((result) => result.strengths.trim())
    .filter(Boolean)
    .slice(0, 2);
  const weakPoints = [...written]
    .sort((left, right) => share(left) - share(right))
    .map((result) => result.missingPoints.trim())
    .filter(Boolean)
    .slice(0, 2);
  const perLecture = [...byLecture.entries()].map(([lectureId, entry]) => ({
    lectureId,
    score: entry.score,
    max: entry.max,
    ratio: entry.max > 0 ? entry.score / entry.max : 0,
  }));
  const weakestLectureId =
    [...perLecture].sort((left, right) => left.ratio - right.ratio)[0]?.lectureId ?? null;

  return { totalScore, maxScore, percentage, strengths, weakPoints, perLecture, weakestLectureId };
}
