/**
 * Exam prep, everything that is arithmetic rather than I/O.
 *
 * An exam is a date and a list of notes, split into topics. It works the way Astra AI's exam prep
 * does (studied in its app on 2026-10-16): the path is one lesson after another, each lesson moves
 * its topic's mastery a step towards the score it got (`masteryAfterLesson`), readiness is the
 * average over the topics, and the path suggests the next lesson's topic and format
 * (`examNextStep`, `suggestedKind`) while the learner may swap the format for any other. Mastery,
 * the daily plan, the forecast, the streak and which topics are open are all derived here from the
 * lesson results, so the server, the screens and the tests agree on one definition of each.
 *
 * Kept free of imports so `node --test` can load it without the app's path aliases.
 */

export const EXAM_LESSON_KINDS = ["summary", "tutor", "flashcards", "quiz", "true_false", "written"] as const;
export type ExamLessonKind = (typeof EXAM_LESSON_KINDS)[number];

/**
 * The lessons that test something, also called the practice formats, in the order the path suggests
 * them. The summary is read, so it counts as done but not as mastery.
 */
export const PRACTICE_LESSON_KINDS = ["tutor", "flashcards", "quiz", "true_false", "written"] as const;
export type PracticeLessonKind = (typeof PRACTICE_LESSON_KINDS)[number];

export function isPracticeKind(kind: ExamLessonKind): kind is PracticeLessonKind {
  return (PRACTICE_LESSON_KINDS as readonly ExamLessonKind[]).includes(kind);
}

/*
 * Spaced review: a topic keeps its mastery for a few days after its last lesson, then fades a little
 * each day until it has another, so a topic learned weeks before the exam comes back for a
 * "Ponovitev" before it instead of counting as known on the day. It never fades below 60 % of what
 * was earned, and one lesson brings it back (fading runs from the last lesson, not the first).
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

/*
 * The knowledge a topic is held to, 0..1. A 100 % goal means 100 %: knowledge can reach it (a run of
 * fully right tests, `masteryAfterPractice`), so it is not capped the way a single lesson's or the
 * mock exam's pass mark is.
 */
export function masteryGoal(target: number) {
  return Number.isFinite(target) && clamp01(target) >= 1 ? 1 : passThreshold(target);
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
 * A lesson format the learner keeps failing is not offered again the same day after this many
 * tries: the module goes on in its other formats (`suggestedKind`) and the format comes back the
 * next day. The module itself is never skipped; the next one opens only on target.
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
 * The most material one setup takes, enough for a whole exam: 10 documents or recordings, and 50
 * photos (read in sets of `MAX_SCAN_IMAGE_COUNT`, each set one piece of material). Documents and
 * photos go to different upload routes, each allowed 12 a user per 10 minutes
 * (`rateLimitPresets.expensiveCreate`), so a full setup fits inside the limits that stop abuse.
 */
export const MAX_SETUP_UPLOADS = 10;
export const MAX_SETUP_PHOTOS = 50;

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
  /** The questions the lesson showed, and of those the ones the learner got wrong (knowledge gaps). */
  item_ids?: readonly string[] | null;
  missed_ids?: readonly string[] | null;
  /** What the lesson tested (questions, cards, marks); 0 when it tested nothing, which moves no mastery. */
  total?: number | null;
};

/*
 * Topic mastery, the way Astra AI moves it: every lesson moves the topic a step (`MASTERY_RATE`)
 * towards what the lesson showed the learner knows (an exponential average). Measured on Astra's
 * app on 2026-10-16, a topic went 0 → 5 → 15 → 23 % after lessons of 40, 100 and 71 %: a step of
 * 0.12. Ours is 0.2: simulated learners with a known, growing knowledge (tests/exam-plan.test.mjs)
 * showed that at 0.12 the average lags so far behind what they know that half of those who knew the
 * material at the goal were never told they were ready before the exam; at 0.2 that is rare, and
 * the mock exam still stops anyone who is not. So mastery is accuracy, earned over many lessons:
 * about eight good lessons take a topic from 0 to 75 %, and a learner who knows 70 % never reaches
 * a 75 % goal. A lesson that tests nothing (the summary) moves nothing; flashcards, which the
 * learner grades, move half as far.
 */
export const MASTERY_RATE = 0.2;

/*
 * The lesson (`summary`) is Astra's lesson: the reading, then a few flashcards, a quiz and a written
 * answer, scored together. Read on its own (no part could be built) it tested nothing and is saved
 * with nothing to score (`total` 0), which moves nothing.
 */
export const MASTERY_WEIGHT: Record<ExamLessonKind, number> = {
  summary: 1,
  tutor: 1,
  flashcards: 0.5,
  quiz: 1,
  true_false: 1,
  written: 1,
};

/*
 * What a score says about knowledge once lucky guesses are taken out: a true/false statement is
 * right half the time by chance and a four-option question a quarter of the time, so 80 % on
 * true/false is 60 % known. Without this a learner who knows little would reach the goal on
 * guessable lessons alone and fail the real exam.
 */
export const GUESS_RATE: Record<ExamLessonKind, number> = {
  // A lesson's score mixes four-option questions with flashcards and a written answer.
  summary: 0.1,
  tutor: 0,
  flashcards: 0,
  quiz: 0.25,
  true_false: 0.5,
  written: 0,
};

export function knownShare(kind: ExamLessonKind, score: number) {
  const guess = GUESS_RATE[kind];
  return clamp01((clamp01(score) - guess) / (1 - guess));
}

/** A topic's mastery (0..1) once a lesson of `kind` scoring `score` is added to it. */
export function masteryAfterLesson(mastery: number, kind: ExamLessonKind, score: number) {
  const current = clamp01(mastery);
  return clamp01(current + MASTERY_RATE * MASTERY_WEIGHT[kind] * (knownShare(kind, score) - current));
}

/*
 * 100 % is reachable. The average only ever closes 20 % of the gap, so perfect answers alone would
 * creep towards 100 % without arriving (shown as 99 %). A topic already at `FULL_FROM` whose last
 * `FULL_RUN` tests (quiz, written answer, tutor) were all fully right is taken to 100 %: the learner
 * plainly knows it. Self-graded flashcards neither count towards the run nor break it.
 */
export const FULL_RUN = 3;
export const FULL_FROM = 0.9;
const FULL_RUN_KINDS: readonly ExamLessonKind[] = ["quiz", "written", "tutor"];

/** One practice added to a topic: its mastery and the run of fully right tests it now stands on. */
export function masteryAfterPractice(mastery: number, perfectRun: number, kind: ExamLessonKind, score: number) {
  let run = perfectRun;

  if (FULL_RUN_KINDS.includes(kind)) {
    run = meetsPassMark(clamp01(score), 1) ? run + 1 : 0;
  }

  const next = masteryAfterLesson(mastery, kind, score);
  return { mastery: run >= FULL_RUN && next >= FULL_FROM ? 1 : next, perfectRun: run };
}

/**
 * The lessons a topic still needs to reach the target from `mastery`, for a learner who gets about
 * `ASSUMED_ACCURACY` right (more when the target needs more): the plan's and the forecast's unit.
 */
export const ASSUMED_ACCURACY = 0.9;

export function lessonsToTarget(mastery: number, target: number) {
  const goal = masteryGoal(target);
  const current = clamp01(mastery);

  if (meetsPassMark(current, goal)) {
    return 0;
  }

  // 100 %: fully right tests up to `FULL_FROM`, the last `FULL_RUN` of them in a row.
  if (goal >= 1) {
    const toFull = Math.ceil(Math.log((1 - FULL_FROM) / (1 - current)) / Math.log(1 - MASTERY_RATE) - 1e-9);
    return Math.max(FULL_RUN, toFull);
  }

  const accuracy = Math.max(ASSUMED_ACCURACY, Math.min(1, goal + 0.1));
  const lessons = Math.log((accuracy - goal) / (accuracy - current)) / Math.log(1 - MASTERY_RATE);
  return Math.max(1, Math.ceil(lessons - 1e-9));
}

/*
 * A module opens the next one only on target. There is no "enough lessons" way through: a learner
 * scoring 0 % in a module stays in it, and the path keeps adding its lessons (`lessonsToTarget`
 * from where its knowledge is now) until it reaches the exam's goal. The owner's rule (2026-10-17).
 */

/*
 * The format the path suggests next for a topic (Astra's "Next up" rotates by itself: intro, smart
 * text, quiz, exercise, …). First every format once, in this order, then round the practice ones.
 * The learner may swap it for any other on the path; the suggestion is only the default. Each
 * format gets one turn in the first pass: the n-th lesson offers the first untried format from the
 * n-th place on, so a format swapped away on its turn (the voice tutor without a microphone) is not
 * offered again and again; it comes back in the rotation.
 */
export const FIRST_PASS_ORDER: readonly ExamLessonKind[] = ["summary", "tutor", "quiz", "written", "true_false", "flashcards"];
export const PRACTICE_ROTATION: readonly PracticeLessonKind[] = ["quiz", "written", "true_false", "tutor", "flashcards"];

export function suggestedKind(input: {
  done: Record<ExamLessonKind, boolean>;
  /** Lessons done in the topic, any kind. */
  lessons: number;
  failedToday: Record<ExamLessonKind, number>;
  gapKind: PracticeLessonKind | null;
  /**
   * Whether the voice tutor can be suggested: false once the account's talking time is spent
   * (`canStartTutorLesson`), and the path then picks another exercise.
   */
  tutor?: boolean;
}): ExamLessonKind {
  const allowed = (kind: ExamLessonKind) => input.tutor !== false || kind !== "tutor";
  const rested = (kind: ExamLessonKind) =>
    allowed(kind) && (input.failedToday[kind] ?? 0) < MAX_FAILED_TRIES_PER_DAY;

  if (input.gapKind && rested(input.gapKind)) {
    return input.gapKind;
  }

  const untried = FIRST_PASS_ORDER.slice(Math.min(input.lessons, FIRST_PASS_ORDER.length)).find(
    (kind) => !input.done[kind] && allowed(kind),
  );

  if (untried) {
    return untried;
  }

  for (let step = 0; step < PRACTICE_ROTATION.length; step += 1) {
    const kind = PRACTICE_ROTATION[(input.lessons + step) % PRACTICE_ROTATION.length];

    if (rested(kind)) {
      return kind;
    }
  }

  const fallback = PRACTICE_ROTATION.filter(allowed);
  return fallback[input.lessons % fallback.length];
}

/* The check's format: a quiz, or a written answer once the quiz has failed twice today. */
function checkKind(failedToday: Record<ExamLessonKind, number>, tutor?: boolean): ExamLessonKind {
  if ((failedToday.quiz ?? 0) < MAX_FAILED_TRIES_PER_DAY) {
    return "quiz";
  }

  if ((failedToday.written ?? 0) < MAX_FAILED_TRIES_PER_DAY || tutor === false) {
    return "written";
  }

  return "tutor";
}

export type ModuleState = {
  /** The module: one topic of the exam. */
  topicId: string;
  /** The note the topic belongs to, which access, grading and the mock exam go by. */
  lectureId: string;
  /** 0-based place on the path. */
  position: number;
  /** 0..1, the topic's mastery today: the exponential average of its lessons, faded since the last one. */
  mastery: number;
  /** The same before fading. */
  rawMastery: number;
  /** Tests fully right in a row (`FULL_RUN` of them at `FULL_FROM` takes the topic to 100 %). */
  perfectRun: number;
  /** Lessons done in the topic, any kind; and of those the ones that test something. */
  lessons: number;
  practiceLessons: number;
  /** When the topic last had a lesson. */
  lastAt: string | null;
  /** The topic has reached the target at some point (fading and later dips aside): the next one is open. */
  learned: boolean;
  /** At the goal, but no check passed at it lately: the topic's next lesson is its check. */
  checkDue: boolean;
  /** Mastery today reaches the target, and no failed mock asks for proof. */
  mastered: boolean;
  unlocked: boolean;
  /** A failed mock exam found this topic weak and it has had no practice lesson since. */
  proofOwed: boolean;
  /** Was on target, has only faded under it since: a "Ponovitev" is due. */
  refreshDue: boolean;
  /** The format the path suggests next (`suggestedKind`). */
  nextKind: ExamLessonKind;
  /** Whether each format has been done in the topic. */
  done: Record<ExamLessonKind, boolean>;
  /** The latest score of each format, or null when untried. */
  latest: Record<ExamLessonKind, number | null>;
  /** Tries of each format on `now`'s Ljubljana day that fell short of its pass mark (0 without `now`). */
  failedToday: Record<ExamLessonKind, number>;
  /** Tries of each format on `now`'s Ljubljana day, passed or not (0 without `now`). */
  triedToday: Record<ExamLessonKind, number>;
  /** Questions of this topic the learner got wrong and has not answered right since (`openGaps`). */
  gaps: number;
  /** Of those, the ones still holding the path (missed fewer than `GAP_MAX_MISSES` times). */
  pressingGaps: number;
  /** The format that asks the gaps again (`gapLessonKind`), or null without pressing gaps. */
  gapKind: PracticeLessonKind | null;
};

/* ---------------------------------------------------------------- knowledge gaps */

/*
 * Astra's knowledge gaps, per question: a question the learner got wrong stays open until a later
 * lesson asks it again and they get it right. Quiz and true/false share questions (a statement is a
 * quiz question with one claimed answer), so a gap opened in one is asked "another way" in the
 * other. Flashcards are graded by the learner and come back by the note's own spaced repetition, and
 * the tutor and summary show no questions, so only these lessons open and close gaps.
 */
export const GAP_LESSON_KINDS: readonly ExamLessonKind[] = ["quiz", "true_false", "written", "summary"];

/*
 * A gap missed this many times keeps coming back in its topic's lessons but stops holding the path:
 * one question the learner cannot get must not keep the mock exam away for good.
 */
export const GAP_MAX_MISSES = 3;

/** How many of a lesson's questions may be gaps asked again; the rest are new. */
export const GAP_SHARE_OF_LESSON = 0.6;

export type OpenGap = {
  id: string;
  /** The lesson it was last missed in (a lesson's own quiz and written answer count as `summary`). */
  kind: ExamLessonKind;
  /** Times missed since it was last answered right. */
  misses: number;
};

/** The topic's open gaps, oldest miss first, replaying its results in the order they were saved. */
export function openGaps(results: readonly LessonResultLike[]): OpenGap[] {
  const open = new Map<string, OpenGap>();
  const ordered = results
    .filter((result) => (GAP_LESSON_KINDS as readonly string[]).includes(result.lesson_kind))
    .map((result, order) => ({ result, order, time: instantOf(result.completed_at) }))
    .sort((left, right) => left.time - right.time || left.order - right.order);

  for (const { result } of ordered) {
    const missed = new Set(result.missed_ids ?? []);

    for (const id of new Set([...(result.item_ids ?? []), ...missed])) {
      if (missed.has(id)) {
        const previous = open.get(id);
        open.delete(id);
        open.set(id, { id, kind: result.lesson_kind, misses: (previous?.misses ?? 0) + 1 });
      } else {
        open.delete(id);
      }
    }
  }

  return [...open.values()];
}

/** Whether a gap still holds the path (see `GAP_MAX_MISSES`). */
export function isPressingGap(gap: OpenGap) {
  return gap.misses < GAP_MAX_MISSES;
}

/** The questions a lesson of `kind` asks again: the topic's open gaps it can show. */
export function gapsForLesson(gaps: readonly OpenGap[], kind: ExamLessonKind): OpenGap[] {
  if (kind === "written") {
    return gaps.filter((gap) => gap.kind === "written");
  }

  return kind === "quiz" || kind === "true_false" ? gaps.filter((gap) => gap.kind !== "written") : [];
}

/**
 * The format to close a topic's pressing gaps with. A written answer is asked again in writing; a
 * multiple-choice one comes back the other way round (missed in the quiz, asked as true/false, and
 * the reverse) when the learner has done that format, else the same way.
 */
export function gapLessonKind(
  gaps: readonly OpenGap[],
  done: Record<ExamLessonKind, boolean>,
): PracticeLessonKind | null {
  const pressing = gaps.filter(isPressingGap);

  if (pressing.length === 0) {
    return null;
  }

  const written = pressing.filter((gap) => gap.kind === "written").length;

  if (written * 2 > pressing.length) {
    return "written";
  }

  const latest = pressing.filter((gap) => gap.kind !== "written").at(-1);

  if (!latest) {
    return "written";
  }

  if (latest.kind !== "quiz" && latest.kind !== "true_false") {
    return "quiz";
  }

  const other: PracticeLessonKind = latest.kind === "quiz" ? "true_false" : "quiz";
  return done[other] ? other : latest.kind;
}

/**
 * A lesson's questions with the topic's gaps asked first: up to `GAP_SHARE_OF_LESSON` of `count`
 * are open gaps (the oldest misses first), and the rest are drawn as `preferUnseen` draws them.
 */
export function withGapsFirst<T extends { id: string }>(
  pool: readonly T[],
  gaps: readonly OpenGap[],
  seen: ReadonlySet<string>,
  count: number,
  seed: string,
): { items: T[]; repeated: string[] } {
  const byId = new Map(pool.map((item) => [item.id, item]));
  const cap = Math.max(1, Math.floor(count * GAP_SHARE_OF_LESSON));
  const repeats = gaps
    .map((gap) => byId.get(gap.id))
    .filter((item): item is T => item !== undefined)
    .slice(0, cap);

  if (repeats.length === 0) {
    return { items: [], repeated: [] };
  }

  const repeated = new Set(repeats.map((item) => item.id));
  const rest = pool.filter((item) => !repeated.has(item.id));
  const fill = seededShuffle(preferUnseen(rest, seen, count - repeats.length, seed), `${seed}:fill`).slice(
    0,
    count - repeats.length,
  );

  return { items: [...repeats, ...fill], repeated: [...repeated] };
}

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

/*
 * The check ("Preverjanje"). Ready means every topic has lately passed a test at the goal by its own
 * score, guessing taken out: an estimate carried there by a lucky run, or one learned weeks ago and
 * since forgotten, is caught here before the learner is told they are ready. Self-graded flashcards
 * and half-guessed true/false prove nothing. A module still opens the next once its estimate
 * reaches the goal: simulated learners (docs/exam-prep.md) reached the goal more often that way
 * than when each module had to pass a check first, since checks spent the days later modules
 * needed, while this final round kept their readiness as honest.
 */
export const CHECK_KINDS: readonly ExamLessonKind[] = ["quiz", "written", "tutor"];
/* The check is a quiz of this many questions (a practice quiz has 5), so luck carries less of it. */
export const CHECK_QUIZ_SIZE = 10;
/*
 * A quiz counts as a check only with at least this many questions: a 5-question practice quiz is
 * too much luck to prove a topic. 8 is the least a topic's quiz pool is kept at, so a topic whose
 * check could not be filled to 10 can still be checked.
 */
export const CHECK_QUIZ_MIN = 8;

/* A check's pass mark: the goal, by the test's own score with guessing out; the tutor's at most what one slip leaves. */
export function checkScorePasses(kind: ExamLessonKind, score: number, goal: number) {
  const mark = kind === "tutor" ? Math.min(goal, TUTOR_PASS_CAP) : goal;
  return meetsPassMark(knownShare(kind, score), mark);
}

function passesCheck(result: LessonResultLike, goal: number) {
  return checkScorePasses(result.lesson_kind, result.score, goal);
}

function countsAsCheck(result: LessonResultLike) {
  return CHECK_KINDS.includes(result.lesson_kind) && (result.lesson_kind !== "quiz" || (result.total ?? 0) >= CHECK_QUIZ_MIN);
}

/**
 * A topic's mastery from its results, replayed oldest first: the exponential average, unfaded. Also
 * the highest it has stood (`peak`) and, with `goal`, when a check last passed at it.
 */
export function topicMastery(results: readonly LessonResultLike[], goal = Number.POSITIVE_INFINITY) {
  let mastery = 0;
  let perfectRun = 0;
  let peak = 0;
  /* When a check last passed at the goal: readiness wants every topic's to be recent. */
  let lastPassAt: string | null = null;
  let lastAt: string | null = null;
  let lastTime = Number.NEGATIVE_INFINITY;

  const ordered = results
    .map((result, order) => ({ result, order, time: instantOf(result.completed_at) }))
    .sort((left, right) => left.time - right.time || left.order - right.order);

  for (const { result, time } of ordered) {
    if (result.total === 0) {
      continue;
    }


    if (countsAsCheck(result) && passesCheck(result, goal)) {
      lastPassAt = result.completed_at;
    }

    ({ mastery, perfectRun } = masteryAfterPractice(mastery, perfectRun, result.lesson_kind, result.score));
    peak = Math.max(peak, mastery);

    if (time >= lastTime) {
      lastTime = time;
      lastAt = result.completed_at;
    }
  }

  return { mastery, peak, perfectRun, lastPassAt, lastAt };
}

/**
 * One module's progress against the exam's target (0..1). `proveSince` is set when a failed mock
 * found this module weak; a practice lesson after it is then owed. `now` turns on spaced review:
 * mastery fades with the days since the topic's last lesson (`fadedScore`), so a topic learned
 * early comes back as a "Ponovitev" before the exam, and one lesson brings it back.
 */
export function moduleProgress(
  results: LessonResultLike[],
  target = 1,
  proveSince: string | null = null,
  now: Date | null = null,
  options: { tutor?: boolean } = {},
) {
  const latest = latestByKind(results);
  const done = {} as Record<ExamLessonKind, boolean>;
  const scores = {} as Record<ExamLessonKind, number | null>;
  const failedToday = {} as Record<ExamLessonKind, number>;
  /* Checks failed today by format: two in one format and the check moves to the next (`checkKind`). */
  const checksFailedToday = {} as Record<ExamLessonKind, number>;
  const triedToday = {} as Record<ExamLessonKind, number>;
  const today = now && Number.isFinite(now.getTime()) ? dayKey(now) : null;

  for (const kind of EXAM_LESSON_KINDS) {
    const entry = latest[kind];
    done[kind] = entry !== undefined;
    scores[kind] = entry ? clamp01(entry.score) : null;
    failedToday[kind] = 0;
    checksFailedToday[kind] = 0;
    triedToday[kind] = 0;
  }

  if (today) {
    for (const result of results) {
      if (!Number.isFinite(instantOf(result.completed_at)) || dayKey(result.completed_at) !== today) {
        continue;
      }

      triedToday[result.lesson_kind] += 1;

      if (result.lesson_kind !== "summary" && !lessonPassed(result.lesson_kind, clamp01(result.score), target)) {
        failedToday[result.lesson_kind] += 1;
      }

      if (countsAsCheck(result) && !passesCheck(result, masteryGoal(target))) {
        checksFailedToday[result.lesson_kind] += 1;
      }
    }
  }

  const goal = masteryGoal(target);
  const { mastery: rawMastery, peak, perfectRun, lastPassAt, lastAt } = topicMastery(results, goal);
  /*
   * Ready means every topic re-checked lately, not once weeks ago: a check passed within the days
   * mastery keeps before it starts to fade. Without a clock (no `now`) there is nothing to age.
   */
  const checkedLately =
    now === null ||
    (lastPassAt !== null && (now.getTime() - instantOf(lastPassAt)) / 86_400_000 <= REVIEW_GRACE_DAYS);
  const mastery = lastAt ? fadedScore(rawMastery, lastAt, now) : rawMastery;
  const tested = (result: LessonResultLike) =>
    isPracticeKind(result.lesson_kind) || (result.lesson_kind === "summary" && (result.total ?? 0) > 0);
  const practiceLessons = results.filter(tested).length;
  const proveAfter = proveSince === null ? null : instantOf(proveSince);
  const proofOwed =
    proveAfter !== null &&
    !results.some((result) => tested(result) && instantOf(result.completed_at) > proveAfter);
  const gaps = openGaps(results);
  const gapKind = practiceLessons > 0 ? gapLessonKind(gaps, done) : null;
  const onTarget = meetsPassMark(mastery, goal);
  const learned = meetsPassMark(peak, goal);
  const checkDue = learned && meetsPassMark(rawMastery, goal) && !checkedLately;

  return {
    mastery,
    rawMastery,
    perfectRun,
    lessons: results.length,
    practiceLessons,
    lastAt,
    /* Reached the goal once: the next module stays open even if a later lesson dips under it. */
    learned,
    mastered: onTarget && !proofOwed && checkedLately,
    proofOwed,
    /* At the goal by its practices, the check not yet passed: the check is what comes next. */
    checkDue,
    refreshDue: !onTarget && meetsPassMark(rawMastery, goal),
    nextKind: checkDue
      ? checkKind(checksFailedToday, options.tutor)
      : suggestedKind({ done, lessons: results.length, failedToday, gapKind, tutor: options.tutor }),
    done,
    latest: scores,
    failedToday,
    triedToday,
    gaps: gaps.length,
    pressingGaps: gaps.filter(isPressingGap).length,
    gapKind,
  };
}

/**
 * Every module's state, in path order. A module is one topic. The first is open; each next one
 * opens once the one before it is learned (has reached the target). Having studied a module
 * already does not open it: a module before it still under the goal keeps it shut. `target` is the exam's goal as 0..1.
 *
 * A module marked `available: false` (its note is still being made, its topics are not planned,
 * or the learner cannot open it) does not hold the path: the module after it opens as if it had
 * been learned, so one unfinished note never locks the rest of the exam.
 */
export function examModuleStates(
  modulesInOrder: { topicId: string; lectureId: string; available?: boolean }[],
  results: LessonResultLike[],
  target = 1,
  mock: MockOutcome | null = null,
  now: Date | null = null,
  options: { tutor?: boolean } = {},
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
    const progress = moduleProgress(byTopic.get(topicId) ?? [], target, weakInMock ? failedMock.at : null, now, options);
    const previous = states[position - 1];
    const previousSkipped = modulesInOrder[position - 1]?.available === false && Boolean(previous?.unlocked);
    const unlocked = position === 0 || Boolean(previous?.learned) || previousSkipped;

    states.push({ topicId, lectureId, position, unlocked, ...progress });
  });

  return states;
}

/*
 * Where the learner is: learning (some topic not yet far enough along to open the next), practising
 * (every topic opened, some under the target), proving it with a mock exam at or above the target,
 * then ready. A new lesson under the mark, fading, or a failed mock sends them back to practise.
 * An exam with no modules yet is still learning.
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
  | {
      type: "lesson";
      topicId: string;
      lectureId: string;
      kind: ExamLessonKind;
      review: boolean;
      /** The module check: passing it at the goal opens the next module. */
      check: boolean;
    }
  | { type: "mock" }
  | null;

/**
 * What `examNextStep` reads of a module. `ready` and `pending` are the screen's own
 * (`ExamModuleView`): a module whose note is still being made, or that is only a placeholder until
 * its topics are planned, has no lessons to open yet.
 */
export type ExamNextStepModule = Pick<
  ModuleState,
  "topicId" | "lectureId" | "learned" | "mastered" | "unlocked" | "nextKind" | "mastery" | "lessons"
> &
  Partial<Pick<ModuleState, "failedToday" | "triedToday" | "pressingGaps" | "gapKind" | "checkDue" | "lastAt">> & {
    ready?: boolean;
    pending?: boolean;
  };

/* A module that can be studied now: its note made, its topics planned, and the learner allowed it. */
function usableModule(
  state: Pick<ExamNextStepModule, "ready" | "pending" | "lectureId">,
  canOpen: (lectureId: string) => boolean,
) {
  return state.ready !== false && state.pending !== true && canOpen(state.lectureId);
}

/**
 * Which modules the path has reached, in order: opened by the one before reaching the goal, or by
 * the one before being out of the learner's reach (a note still being made, or one the account
 * cannot open), which does not hold the rest shut. The path, its "Next up" and the lesson page all
 * go by this, so none of them sends the learner somewhere another refuses.
 */
export function reachableModules(
  states: Pick<ExamNextStepModule, "unlocked" | "learned" | "ready" | "pending" | "lectureId">[],
  canOpen: (lectureId: string) => boolean = () => true,
) {
  const reachable: boolean[] = [];

  states.forEach((state, index) => {
    const previous = states[index - 1];
    reachable.push(
      state.unlocked ||
        (index > 0 && reachable[index - 1] && (previous.learned || !usableModule(previous, canOpen))),
    );
  });

  return reachable;
}

/**
 * The path's "Next up", Astra's way: one lesson at a time, its format chosen by `suggestedKind`.
 *
 * 1. **Learn.** The first open topic that has not reached the target yet. Only reaching it opens
 *    the next topic, so the path stays on a topic, adding lessons, until it gets there.
 * 2. **Close gaps.** A topic's knowledge gaps, the topic with the most first.
 * 3. **Practise.** The open topic furthest under the target (a faded one included, as a refresh).
 * 4. **Exam day.** On the exam's eve and the day itself (`finalDay`), a flashcard refresher for each
 *    topic not refreshed yet that day.
 * 5. **Prove.** With every topic on target, the mock exam.
 * 6. **Keep sharp.** Once ready, the weakest topic's next lesson.
 *
 * A topic whose suggested lesson failed `MAX_FAILED_TRIES_PER_DAY` times today rests until
 * tomorrow while other work exists. Modules the learner cannot open (`canOpen`), whose note is not
 * ready, or that are placeholders are skipped, and do not keep the modules after them locked.
 */
export function examNextStep(
  states: ExamNextStepModule[],
  stage: ExamStage,
  canOpen: (lectureId: string) => boolean = () => true,
  options: { finalDay?: boolean } = {},
): ExamNextStep {
  if (states.length === 0) {
    return null;
  }

  const usable = (state: ExamNextStepModule) => usableModule(state, canOpen);
  const reachable = reachableModules(states, canOpen);
  const open = states.filter((state, index) => reachable[index] && usable(state));
  const lesson = (state: ExamNextStepModule, kind: ExamLessonKind): ExamNextStep => ({
    type: "lesson",
    topicId: state.topicId,
    lectureId: state.lectureId,
    kind,
    review: state.lessons > 0,
    check: Boolean(state.checkDue) && CHECK_KINDS.includes(kind),
  });
  const rested = (state: ExamNextStepModule, kind: ExamLessonKind) =>
    (state.failedToday?.[kind] ?? 0) < MAX_FAILED_TRIES_PER_DAY;
  /* The weakest topic; between equals (several at 100 %), the one practised longest ago, so reviews rotate. */
  const practisedAt = (state: ExamNextStepModule) => (state.lastAt ? instantOf(state.lastAt) : Number.NEGATIVE_INFINITY);
  const weakest = (list: ExamNextStepModule[]) =>
    [...list].sort((left, right) => left.mastery - right.mastery || practisedAt(left) - practisedAt(right))[0] ?? null;

  const learning = open.find((state) => !state.learned && rested(state, state.nextKind));

  if (learning) {
    return lesson(learning, learning.nextKind);
  }

  const gapped = open
    .filter((state) => (state.pressingGaps ?? 0) > 0 && state.gapKind && rested(state, state.gapKind))
    .sort((left, right) => (right.pressingGaps ?? 0) - (left.pressingGaps ?? 0))[0];

  if (gapped?.gapKind) {
    return lesson(gapped, gapped.gapKind);
  }

  const practising = weakest(open.filter((state) => !state.mastered && rested(state, state.nextKind)));

  if (practising) {
    return lesson(practising, practising.nextKind);
  }

  if (options.finalDay && stage !== "learn") {
    const unrefreshed = weakest(open.filter((state) => (state.triedToday?.flashcards ?? 0) === 0));

    if (unrefreshed) {
      return lesson(unrefreshed, "flashcards");
    }
  }

  if (stage === "prove") {
    return { type: "mock" };
  }

  if (stage === "ready") {
    const keepSharp = weakest(open.filter((state) => rested(state, state.nextKind)));

    if (keepSharp) {
      return lesson(keepSharp, keepSharp.nextKind);
    }
  }

  /* Nothing else to do today: a resting topic is still better than nothing. */
  const fallback = weakest(open);
  return fallback ? lesson(fallback, fallback.nextKind) : null;
}

/** Readiness: the average mastery over every topic of the exam, started or not (as Astra counts it). */
export function examMastery(states: Pick<ModuleState, "mastery">[]): number {
  if (states.length === 0) {
    return 0;
  }

  return states.reduce((sum, state) => sum + state.mastery, 0) / states.length;
}

/** Topics whose mastery today reaches the target. */
export function topicsOnTarget(states: Pick<ModuleState, "mastery">[], target: number) {
  return states.filter((state) => meetsPassMark(state.mastery, masteryGoal(target))).length;
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
  /** Lessons still needed to bring every topic to the target (`lessonsToTarget`), plus gaps and proofs. */
  remaining: number;
};

/** The lessons the exam still needs: every topic to its target, a lesson per topic's gaps, and owed proofs. */
/**
 * The practices a topic still owes: one when all it needs is its check (a faded topic among them:
 * passing the check brings it back), else what its unfaded knowledge needs to reach the goal.
 */
export function practicesOwed(
  state: Pick<ModuleState, "mastery"> & Partial<Pick<ModuleState, "rawMastery" | "checkDue">>,
  target: number,
) {
  return state.checkDue ? 1 : lessonsToTarget(state.rawMastery ?? state.mastery, target);
}

export function lessonsRemaining(
  states: (Pick<ModuleState, "mastery"> &
    Partial<Pick<ModuleState, "rawMastery" | "checkDue" | "pressingGaps" | "proofOwed">>)[],
  target: number,
) {
  return states.reduce(
    (sum, state) =>
      sum +
      Math.max(practicesOwed(state, target), state.proofOwed ? 1 : 0) +
      ((state.pressingGaps ?? 0) > 0 ? 1 : 0),
    0,
  );
}

/**
 * Today's goal: what is left spread over the days before the exam, but never less than the
 * learner's minutes buy, so a long runway still has a real day's work in it. Computed against
 * what was left at the start of today, so finishing a lesson moves "done", not the goal.
 */
export function dailyPlan(input: {
  examDate: string;
  today: string;
  dailyMinutes: number;
  target: number;
  states: (Pick<ModuleState, "mastery"> & Partial<Pick<ModuleState, "pressingGaps" | "proofOwed">>)[];
  resultsToday: number;
}): DailyPlan {
  const remaining = lessonsRemaining(input.states, input.target);
  const untilExam = daysBetween(input.today, input.examDate);
  const daysLeft = untilExam < 0 ? 0 : Math.max(1, untilExam);
  const byTime = Math.max(1, Math.round(input.dailyMinutes / LESSON_MINUTES));
  const byPlan = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0;
  const goal = Math.max(1, byPlan, remaining > 0 ? Math.min(byTime, remaining) : byTime);

  return { goal, doneToday: input.resultsToday, daysLeft, remaining };
}

/* ---------------------------------------------------------------- forecast */

/** Lessons it takes before the pace is worth a forecast (Astra shows one after the first two). */
export const FORECAST_MIN_LESSONS = 2;
/**
 * The days the pace is measured over, always the whole window as Astra does ("last 14 days"): one
 * busy first day is not a pace, and a forecast that flatters says nothing.
 */
export const FORECAST_WINDOW_DAYS = 14;

export type ExamForecast = {
  /** 0..1: where readiness lands on the exam day at the pace of the last days. */
  atExam: number;
  /** Whether that reaches the target. */
  onTrack: boolean;
  /** 0..1: readiness each lesson has added so far ("each lesson adds about +1.9 %"). */
  perLesson: number;
  /** Lessons still needed at that rate ("about 37 more lessons"), and a day until the exam. */
  lessonsNeeded: number;
  perDay: number;
};

/**
 * Astra's forecast: "each lesson adds about +1.9 %. To reach your goal you need about 37 more
 * lessons, about 4 a day. At this pace you'll be at about 8 % on exam day". The gain per lesson is
 * readiness over the lessons done; the pace is the lessons of the last 14 days spread over all 14.
 * Null until there is a pace (`FORECAST_MIN_LESSONS`), and once the exam day has passed.
 */
export function examForecast(input: {
  /** Readiness, 0..1 (`examMastery`). */
  mastery: number;
  target: number;
  /** Ljubljana days of every lesson that tests something, one entry per lesson. */
  lessonDays: readonly string[];
  today: string;
  examDate: string;
}): ExamForecast | null {
  const lessons = input.lessonDays.length;
  const untilExam = daysBetween(input.today, input.examDate);

  if (lessons < FORECAST_MIN_LESSONS || untilExam < 0) {
    return null;
  }

  const windowStart = addDays(input.today, -(FORECAST_WINDOW_DAYS - 1));
  const recent = input.lessonDays.filter((day) => day >= windowStart && day <= input.today).length;
  const pace = recent / FORECAST_WINDOW_DAYS;
  const perLesson = clamp01(input.mastery) / lessons;
  const atExam = clamp01(input.mastery + perLesson * pace * untilExam);
  const missing = Math.max(0, masteryGoal(input.target) - clamp01(input.mastery));
  const lessonsNeeded = missing <= PASS_EPSILON ? 0 : perLesson > 0 ? Math.ceil(missing / perLesson) : 0;

  return {
    atExam,
    onTrack: meetsPassMark(atExam, masteryGoal(input.target)),
    perLesson,
    lessonsNeeded,
    perDay: lessonsNeeded > 0 ? Math.ceil(lessonsNeeded / Math.max(1, untilExam)) : 0,
  };
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
