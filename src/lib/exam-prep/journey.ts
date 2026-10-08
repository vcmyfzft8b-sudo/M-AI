/**
 * The exam journey: what to study each day from now until the exam.
 *
 * Nothing here is stored. The journey is recomputed from the learner's real
 * study history every time it is opened, which is what makes a missed day
 * harmless: the work it held is re-planned into the days that are left, by how
 * much it matters for the exam, instead of piling up as a backlog to feel bad
 * about. The method and its sources are in docs/exam-prep.md. In short:
 *
 * - Phases, anchored to the day the plan was made: learn → practise → mock
 *   exams → a light final day. Retrieval practice runs through all of them
 *   (Roediger & Karpicke 2006; Dunlosky et al. 2013).
 * - Reviews are scheduled by FSRS (./fsrs.ts) at a retention target that rises
 *   as the exam nears, and no gap may exceed ~30% of the days that are left
 *   (Cepeda et al. 2008), so everything is reviewed shortly before the exam.
 * - The daily budget is the learner's own. Reviews go first because
 *   forgetting is time-critical, then fixed practice (quiz, mock), then new
 *   material. When not everything fits, the plan says so rather than
 *   pretending.
 */
import {
  addDays,
  dayKeyAt,
  diffDays,
  examMorningMs,
  isRestDay,
  middayMs,
  type DayKey,
} from "./dates.ts";
import {
  expectedReviewMemory,
  recallAt,
  reviewMemory,
  type FsrsGrade,
  type MemoryState,
} from "./fsrs.ts";
import { buildReadiness } from "./forecast.ts";
import type {
  ExamEvidence,
  ExamJourney,
  ExamMaterialNote,
  ExamPlanSettings,
  JourneyActivity,
  JourneyDay,
  JourneyPhase,
  JourneyTask,
  JourneyTaskKind,
  JourneyTaskTab,
} from "./model.ts";

/** Minutes per unit of work. Rough, but in the right order of magnitude. */
export const STUDY_MINUTES = {
  reviewCard: 0.25,
  newCard: 0.5,
  quizQuestion: 0.5,
  readWordsPerMinute: 160,
  quizSize: 10,
  mockQuestion: 2.5,
  mockMax: 30,
  explain: 15,
  windDown: 5,
};

/** Share of a studied unit's items seen at least once before it counts as learned. */
const LEARNED_SHARE = 0.6;

export type MemoryMap = Map<string, MemoryState>;

interface LearnUnit {
  key: string;
  lectureId: string;
  noteTitle: string;
  noteEmoji: string | null;
  sectionTitle: string | null;
  itemKeys: string[];
  minutes: number;
  tab: JourneyTaskTab;
  manual: boolean;
}

export function memoryKey(kind: "flashcard" | "quiz", id: string) {
  return `${kind === "flashcard" ? "f" : "q"}:${id}`;
}

/** The items whose memory stands for a note: its cards, or its questions when it has none. */
export function memoryItemsForNote(note: ExamMaterialNote) {
  const cards = note.sections.flatMap((section) => section.cardIds);

  if (cards.length > 0) {
    return cards.map((id) => memoryKey("flashcard", id));
  }

  return note.quizQuestionIds.map((id) => memoryKey("quiz", id));
}

/** Replays the review log into one memory state per item. */
export function replayMemory(
  events: ExamEvidence["events"],
  timeZone: string,
  options: { beforeMs?: number } = {},
): MemoryMap {
  const memory: MemoryMap = new Map();
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);

  for (const event of sorted) {
    if (options.beforeMs != null && event.atMs >= options.beforeMs) {
      break;
    }

    const key = memoryKey(event.kind, event.itemId);
    const grade = Math.min(4, Math.max(1, Math.round(event.outcome))) as FsrsGrade;
    memory.set(
      key,
      reviewMemory(memory.get(key) ?? null, grade, event.atMs, dayKeyAt(event.atMs, timeZone)),
    );
  }

  return memory;
}

function readingMinutes(words: number) {
  return words / STUDY_MINUTES.readWordsPerMinute;
}

function roundMinutes(value: number) {
  return Math.max(1, Math.round(value));
}

/** Learn units in study order: notes interleaved, sections in note order. */
export function buildLearnUnits(notes: ExamMaterialNote[]): LearnUnit[] {
  const perNote = notes.map((note) => {
    const units: LearnUnit[] = [];
    const sections = note.sections.filter((section) => section.cardIds.length > 0);

    if (sections.length > 0) {
      for (const section of sections) {
        units.push({
          key: `${note.lectureId}:${section.id}`,
          lectureId: note.lectureId,
          noteTitle: note.title,
          noteEmoji: note.emoji,
          sectionTitle: section.title,
          itemKeys: section.cardIds.map((id) => memoryKey("flashcard", id)),
          minutes:
            readingMinutes(section.words) + section.cardIds.length * STUDY_MINUTES.newCard,
          tab: "flashcards",
          manual: false,
        });
      }
    } else if (note.quizQuestionIds.length > 0) {
      units.push({
        key: `${note.lectureId}:quiz`,
        lectureId: note.lectureId,
        noteTitle: note.title,
        noteEmoji: note.emoji,
        sectionTitle: null,
        itemKeys: note.quizQuestionIds.map((id) => memoryKey("quiz", id)),
        minutes:
          readingMinutes(note.words) + note.quizQuestionIds.length * STUDY_MINUTES.quizQuestion,
        tab: "quiz",
        manual: false,
      });
    } else {
      // Nothing to check yet (still generating, or no cards). Reading is the
      // whole task, and only the learner can say it is done.
      units.push({
        key: `${note.lectureId}:read`,
        lectureId: note.lectureId,
        noteTitle: note.title,
        noteEmoji: note.emoji,
        sectionTitle: null,
        itemKeys: [],
        minutes: Math.max(5, readingMinutes(note.words)),
        tab: "notes",
        manual: true,
      });
    }

    return units;
  });

  // Interleave notes so a multi-note exam does not spend its first week on
  // one note alone and its last on another.
  const ordered: LearnUnit[] = [];
  const longest = Math.max(0, ...perNote.map((units) => units.length));

  for (let index = 0; index < longest; index += 1) {
    for (const units of perNote) {
      if (units[index]) {
        ordered.push(units[index]);
      }
    }
  }

  return ordered;
}

function isUnitLearned(unit: LearnUnit, memory: MemoryMap, manualDone: Set<string>) {
  if (unit.manual) {
    return manualDone.has(`learn:${unit.key}`);
  }

  if (unit.itemKeys.length === 0) {
    return true;
  }

  const seen = unit.itemKeys.filter((key) => memory.has(key)).length;
  return seen >= Math.ceil(unit.itemKeys.length * LEARNED_SHARE);
}

/** The days the learner studies between the anchor and the exam (exclusive). */
function studyDaysBetween(anchor: DayKey, examDate: DayKey, restDays: number) {
  const days: DayKey[] = [];

  for (let day = anchor; diffDays(day, examDate) > 0; day = addDays(day, 1)) {
    if (!isRestDay(day, restDays)) {
      days.push(day);
    }
  }

  return days;
}

/**
 * Which phase each study day is in. Anchored to the day the plan was made so a
 * phase does not stretch as days pass; what is studied inside it adapts.
 */
export function buildPhaseCalendar(anchor: DayKey, examDate: DayKey, restDays: number) {
  let days = studyDaysBetween(anchor, examDate, restDays);

  // Every day marked as rest would leave no plan at all; a plan that ignores
  // the rest days is the more useful answer.
  if (days.length === 0) {
    days = studyDaysBetween(anchor, examDate, 0);
  }

  const calendar = new Map<DayKey, JourneyPhase>();
  const total = days.length;

  if (total === 0) {
    return { calendar, studyDays: days };
  }

  const hasFinal = total >= 2;
  const span = hasFinal ? total - 1 : total;
  let learn: number;
  let mock: number;

  if (span >= 14) {
    learn = Math.round(span * 0.5);
    mock = Math.max(1, Math.round(span * 0.15));
  } else if (span >= 6) {
    learn = Math.round(span * 0.4);
    mock = Math.max(1, Math.round(span * 0.2));
  } else if (span >= 3) {
    learn = Math.max(1, Math.round(span * 0.4));
    mock = 1;
  } else {
    // A day or two: no phases, just the highest-yield retrieval.
    learn = 0;
    mock = 0;
  }

  const practice = Math.max(0, span - learn - mock);

  days.forEach((day, index) => {
    let phase: JourneyPhase;

    if (hasFinal && index === total - 1) {
      phase = "final";
    } else if (index < learn) {
      phase = "learn";
    } else if (index < learn + practice) {
      phase = "practice";
    } else {
      phase = "mock";
    }

    calendar.set(day, phase);
  });

  return { calendar, studyDays: days };
}

function countPhaseDaysFrom(
  calendar: Map<DayKey, JourneyPhase>,
  from: DayKey,
  phase: JourneyPhase,
) {
  let count = 0;

  for (const [day, value] of calendar) {
    if (value === phase && diffDays(from, day) >= 0) {
      count += 1;
    }
  }

  return count;
}

function desiredRetention(daysLeft: number) {
  if (daysLeft > 21) {
    return 0.9;
  }

  return daysLeft > 14 ? 0.925 : 0.95;
}

function makeTask(
  partial: Omit<JourneyTask, "progress" | "done" | "minutes"> & { minutes: number },
): JourneyTask {
  return { ...partial, minutes: roundMinutes(partial.minutes), progress: 0, done: false };
}

interface DayPlan {
  tasks: JourneyTask[];
  /** Items reviewed and units learned, kept for completion checks and the projection. */
  reviewItems: Map<string, string[]>;
  learnedUnits: LearnUnit[];
}

interface SimulationInput {
  settings: ExamPlanSettings;
  notes: ExamMaterialNote[];
  units: LearnUnit[];
  calendar: Map<DayKey, JourneyPhase>;
  studyDays: DayKey[];
  dailyMinutes: number;
}

interface SimulationCursor {
  memory: MemoryMap;
  learned: Set<string>;
  practiceDayIndex: number;
  learnDayIndex: number;
  quizRotation: number;
  mockRotation: number;
}

function cloneMemory(memory: MemoryMap): MemoryMap {
  return new Map(memory);
}

function notesById(notes: ExamMaterialNote[]) {
  return new Map(notes.map((note) => [note.lectureId, note]));
}

/** Plans one study day and returns its tasks. Does not apply them. */
function planDay(
  input: SimulationInput,
  cursor: SimulationCursor,
  day: DayKey,
  phase: JourneyPhase,
): DayPlan {
  const { settings, notes, units } = input;
  const examMs = examMorningMs(settings.examDate);
  const dayMs = middayMs(day);
  const daysLeft = diffDays(day, settings.examDate);
  const retention = desiredRetention(daysLeft);
  const maxGap = Math.max(1, Math.round(daysLeft * 0.3));
  const budget = input.dailyMinutes * (phase === "final" ? 0.5 : 1);
  const tasks: JourneyTask[] = [];
  const byId = notesById(notes);
  let remaining = budget;

  const unlearned = units.filter((unit) => !cursor.learned.has(unit.key));
  const learnedNoteIds = new Set(
    units.filter((unit) => cursor.learned.has(unit.key)).map((unit) => unit.lectureId),
  );

  // --- Fixed practice -------------------------------------------------------
  const quizNotes = notes.filter((note) => note.quizQuestionIds.length > 0);
  const preferredQuizNotes = quizNotes.filter((note) => learnedNoteIds.has(note.lectureId));
  const quizPool = preferredQuizNotes.length > 0 ? preferredQuizNotes : quizNotes;

  const addQuiz = () => {
    if (quizPool.length === 0) {
      return;
    }

    const note = quizPool[cursor.quizRotation % quizPool.length];
    cursor.quizRotation += 1;
    const count = Math.min(STUDY_MINUTES.quizSize, note.quizQuestionIds.length);
    const minutes = count * STUDY_MINUTES.quizQuestion;
    tasks.push(
      makeTask({
        key: `quiz:${note.lectureId}`,
        kind: "quiz",
        lectureId: note.lectureId,
        noteTitle: note.title,
        noteEmoji: note.emoji,
        sectionTitle: null,
        count,
        minutes,
        tab: "quiz",
        manual: false,
      }),
    );
    remaining -= minutes;
  };

  const addMock = () => {
    const mcExam = settings.examType === "multiple_choice";
    const pool = mcExam
      ? quizNotes
      : notes.filter((note) => note.practiceQuestionIds.length > 0);

    if (pool.length === 0) {
      return;
    }

    const note = pool[cursor.mockRotation % pool.length];
    cursor.mockRotation += 1;
    const count = mcExam
      ? note.quizQuestionIds.length
      : Math.min(10, note.practiceQuestionIds.length);
    const minutes = Math.min(
      STUDY_MINUTES.mockMax,
      count * (mcExam ? STUDY_MINUTES.quizQuestion * 1.5 : STUDY_MINUTES.mockQuestion),
    );
    tasks.push(
      makeTask({
        key: `mock:${note.lectureId}`,
        kind: "mock",
        lectureId: note.lectureId,
        noteTitle: note.title,
        noteEmoji: note.emoji,
        sectionTitle: null,
        count,
        minutes,
        tab: mcExam ? "quiz" : "test",
        manual: false,
      }),
    );
    remaining -= minutes;
  };

  const addExplain = () => {
    const pool = notes.filter((note) => learnedNoteIds.has(note.lectureId));
    const note = pool.length > 0 ? pool[cursor.practiceDayIndex % pool.length] : notes[0];

    if (!note) {
      return;
    }

    tasks.push(
      makeTask({
        key: `explain:${note.lectureId}`,
        kind: "explain",
        lectureId: note.lectureId,
        noteTitle: note.title,
        noteEmoji: note.emoji,
        sectionTitle: null,
        count: 0,
        minutes: STUDY_MINUTES.explain,
        tab: "tutor",
        manual: true,
      }),
    );
    remaining -= STUDY_MINUTES.explain;
  };

  if (phase === "final") {
    tasks.push(
      makeTask({
        key: "wind_down",
        kind: "wind_down",
        lectureId: null,
        noteTitle: null,
        noteEmoji: null,
        sectionTitle: null,
        count: 0,
        minutes: STUDY_MINUTES.windDown,
        tab: null,
        manual: true,
      }),
    );
    remaining -= STUDY_MINUTES.windDown;
  } else if (phase === "mock") {
    addMock();
  } else if (phase === "practice") {
    addQuiz();

    if (settings.examType === "oral" && cursor.practiceDayIndex % 2 === 1) {
      addExplain();
    } else if (
      (settings.examType === "written" || settings.examType === "problem_solving") &&
      cursor.practiceDayIndex % 4 === 3
    ) {
      // A practice test midway, in the exam's own format, before the mocks.
      addMock();
    }

    cursor.practiceDayIndex += 1;
  } else if (phase === "learn") {
    if (learnedNoteIds.size > 0 && cursor.learnDayIndex % 2 === 1) {
      addQuiz();
    }

    cursor.learnDayIndex += 1;
  }

  // --- Reviews --------------------------------------------------------------
  const due: Array<{ key: string; examRecall: number; lectureId: string }> = [];
  const itemOwner = new Map<string, string>();

  for (const note of notes) {
    for (const key of memoryItemsForNote(note)) {
      itemOwner.set(key, note.lectureId);
    }
  }

  for (const [key, state] of cursor.memory) {
    const lectureId = itemOwner.get(key);

    if (!lectureId || state.lastReviewDay === day) {
      continue;
    }

    const gap = diffDays(state.lastReviewDay, day);

    if (gap < 1) {
      continue;
    }

    if (recallAt(state, dayMs) < retention || gap >= maxGap) {
      due.push({ key, examRecall: recallAt(state, examMs), lectureId });
    }
  }

  // The most at risk of being forgotten by exam morning first.
  due.sort((a, b) => a.examRecall - b.examRecall);

  const reviewShare =
    unlearned.length === 0 || phase === "final"
      ? 1
      : phase === "learn"
        ? 0.45
        : phase === "practice"
          ? 0.7
          : 0.6;
  // A backlog is never squeezed into one day: what does not fit stays due and
  // is spread over the next days, most-at-risk first.
  const reviewCap = Math.max(0, remaining) * reviewShare;
  const reviewCount = Math.min(due.length, Math.floor(reviewCap / STUDY_MINUTES.reviewCard));
  const reviewItems = new Map<string, string[]>();

  for (const item of due.slice(0, reviewCount)) {
    const list = reviewItems.get(item.lectureId) ?? [];
    list.push(item.key);
    reviewItems.set(item.lectureId, list);
  }

  for (const [lectureId, keys] of reviewItems) {
    const note = byId.get(lectureId);
    const usesCards = keys[0]?.startsWith("f:") ?? true;
    const minutes = keys.length * STUDY_MINUTES.reviewCard;
    tasks.push(
      makeTask({
        key: `review:${lectureId}`,
        kind: "review",
        lectureId,
        noteTitle: note?.title ?? null,
        noteEmoji: note?.emoji ?? null,
        sectionTitle: null,
        count: keys.length,
        minutes,
        tab: usesCards ? "flashcards" : "quiz",
        manual: false,
      }),
    );
    remaining -= minutes;
  }

  // --- New material ---------------------------------------------------------
  const learnedUnits: LearnUnit[] = [];

  if (phase !== "final") {
    // Spread new material over the learning days that are left rather than
    // front-loading it: topics learned days apart get spaced reviews in
    // between, and a day that over-delivers leaves the next one empty.
    const learnDaysLeft = countPhaseDaysFrom(input.calendar, day, "learn");
    const quota =
      phase === "learn" && learnDaysLeft > 0
        ? Math.ceil(unlearned.length / learnDaysLeft)
        : unlearned.length;

    for (const unit of unlearned) {
      if (learnedUnits.length >= quota) {
        break;
      }

      const forced = learnedUnits.length === 0 && (phase === "learn" || phase === "practice");

      if (unit.minutes <= remaining || forced) {
        learnedUnits.push(unit);
        remaining -= unit.minutes;
      } else {
        break;
      }
    }
  }

  // Time left over on a practice day goes to more retrieval, on another note.
  if (phase === "practice" || (phase === "learn" && unlearned.length === learnedUnits.length)) {
    const quizzed = new Set(tasks.filter((task) => task.kind === "quiz").map((t) => t.lectureId));

    for (const note of quizPool) {
      const minutes =
        Math.min(STUDY_MINUTES.quizSize, note.quizQuestionIds.length) * STUDY_MINUTES.quizQuestion;

      if (quizzed.has(note.lectureId) || minutes > remaining) {
        continue;
      }

      tasks.push(
        makeTask({
          key: `quiz:${note.lectureId}`,
          kind: "quiz",
          lectureId: note.lectureId,
          noteTitle: note.title,
          noteEmoji: note.emoji,
          sectionTitle: null,
          count: Math.min(STUDY_MINUTES.quizSize, note.quizQuestionIds.length),
          minutes,
          tab: "quiz",
          manual: false,
        }),
      );
      quizzed.add(note.lectureId);
      remaining -= minutes;
    }
  }

  // A study day is never empty: with nothing due, retrieval is the best use of it.
  if (tasks.length === 0 && learnedUnits.length === 0) {
    addQuiz();
  }

  // New material goes before the quiz it feeds, after the reviews.
  const learnTasks = learnedUnits.map((unit) =>
    makeTask({
      key: `learn:${unit.key}`,
      kind: "learn",
      lectureId: unit.lectureId,
      noteTitle: unit.noteTitle,
      noteEmoji: unit.noteEmoji,
      sectionTitle: unit.sectionTitle,
      count: unit.itemKeys.length,
      minutes: unit.minutes,
      tab: unit.tab,
      manual: unit.manual,
    }),
  );

  return {
    tasks: orderTasks([...tasks, ...learnTasks]),
    reviewItems,
    learnedUnits,
  };
}

const TASK_ORDER: Record<JourneyTaskKind, number> = {
  review: 0,
  learn: 1,
  quiz: 2,
  explain: 3,
  mock: 4,
  wind_down: 5,
};

function orderTasks(tasks: JourneyTask[]) {
  return [...tasks].sort((a, b) => TASK_ORDER[a.kind] - TASK_ORDER[b.kind]);
}

/** Applies a day's plan to the projected memory, as if it were done. */
function applyDay(cursor: SimulationCursor, plan: DayPlan, day: DayKey, skip?: Set<string>) {
  const dayMs = middayMs(day);

  for (const keys of plan.reviewItems.values()) {
    for (const key of keys) {
      if (skip?.has(key)) {
        continue;
      }

      const state = cursor.memory.get(key);

      if (state) {
        cursor.memory.set(key, expectedReviewMemory(state, dayMs, day));
      }
    }
  }

  for (const unit of plan.learnedUnits) {
    cursor.learned.add(unit.key);

    for (const key of unit.itemKeys) {
      if (!cursor.memory.has(key)) {
        cursor.memory.set(key, reviewMemory(null, 3, dayMs, day));
      }
    }
  }
}

function emptyActivity(): JourneyActivity {
  return { cards: 0, questions: 0, tests: 0 };
}

function activityByDay(evidence: ExamEvidence, timeZone: string) {
  const days = new Map<DayKey, { cards: Set<string>; questions: Set<string>; tests: Set<string> }>();
  const entry = (day: DayKey) => {
    let value = days.get(day);

    if (!value) {
      value = { cards: new Set(), questions: new Set(), tests: new Set() };
      days.set(day, value);
    }

    return value;
  };

  for (const event of evidence.events) {
    const value = entry(dayKeyAt(event.atMs, timeZone));
    (event.kind === "flashcard" ? value.cards : value.questions).add(event.itemId);
  }

  for (const answer of evidence.practiceAnswers) {
    entry(dayKeyAt(answer.atMs, timeZone)).tests.add(answer.attemptId);
  }

  const result = new Map<DayKey, JourneyActivity>();

  for (const [day, value] of days) {
    result.set(day, {
      cards: value.cards.size,
      questions: value.questions.size,
      tests: value.tests.size,
    });
  }

  return result;
}

function hasActivity(activity: JourneyActivity | null | undefined) {
  return Boolean(activity && activity.cards + activity.questions + activity.tests > 0);
}

/** Fills in today's progress from what was actually studied today. */
function markTodayProgress(
  plan: DayPlan,
  units: LearnUnit[],
  evidence: ExamEvidence,
  notes: ExamMaterialNote[],
  today: DayKey,
  timeZone: string,
  checks: Set<string>,
) {
  const todayItems = new Set<string>();
  const quizToday = new Map<string, Set<string>>();
  const testsToday = new Set<string>();

  for (const event of evidence.events) {
    if (dayKeyAt(event.atMs, timeZone) !== today) {
      continue;
    }

    todayItems.add(memoryKey(event.kind, event.itemId));

    if (event.kind === "quiz") {
      const set = quizToday.get(event.lectureId) ?? new Set<string>();
      set.add(event.itemId);
      quizToday.set(event.lectureId, set);
    }
  }

  for (const answer of evidence.practiceAnswers) {
    if (dayKeyAt(answer.atMs, timeZone) === today) {
      testsToday.add(answer.lectureId);
    }
  }

  const unitsByKey = new Map(units.map((unit) => [`learn:${unit.key}`, unit]));
  const noteById = notesById(notes);

  for (const task of plan.tasks) {
    let progress = 0;

    if (task.manual) {
      progress = checks.has(task.key) ? 1 : 0;
    } else if (task.kind === "review" && task.lectureId) {
      const keys = plan.reviewItems.get(task.lectureId) ?? [];
      const done = keys.filter((key) => todayItems.has(key)).length;
      progress = keys.length === 0 ? 1 : done / keys.length;
    } else if (task.kind === "learn") {
      const unit = unitsByKey.get(task.key);
      const keys = unit?.itemKeys ?? [];
      const seen = keys.filter((key) => todayItems.has(key)).length;
      progress = keys.length === 0 ? 1 : Math.min(1, seen / Math.ceil(keys.length * LEARNED_SHARE));
    } else if (task.kind === "quiz" && task.lectureId) {
      const answered = quizToday.get(task.lectureId)?.size ?? 0;
      progress = task.count === 0 ? 1 : Math.min(1, answered / task.count);
    } else if (task.kind === "mock" && task.lectureId) {
      const mcExam = task.tab === "quiz";

      if (mcExam) {
        const answered = quizToday.get(task.lectureId)?.size ?? 0;
        const total = noteById.get(task.lectureId)?.quizQuestionIds.length ?? task.count;
        progress = total === 0 ? 1 : Math.min(1, answered / Math.ceil(total * 0.8));
      } else {
        progress = testsToday.has(task.lectureId) ? 1 : 0;
      }
    }

    // A review list grows stale as the day goes on; most of it is enough.
    const threshold = task.kind === "review" ? 0.9 : 1;
    task.progress = Math.max(0, Math.min(1, progress));
    task.done = task.progress >= threshold;
  }
}

export interface BuildJourneyInput {
  settings: ExamPlanSettings;
  notes: ExamMaterialNote[];
  evidence: ExamEvidence;
  nowMs: number;
  locale?: string;
}

interface SimulationResult {
  days: JourneyDay[];
  todayPlan: DayPlan | null;
  finalCursor: SimulationCursor;
  unscheduled: number;
}

function simulate(
  input: SimulationInput,
  startMemory: MemoryMap,
  startLearned: Set<string>,
  from: DayKey,
  options: {
    today: DayKey;
    nowMemory?: MemoryMap;
    nowLearned?: Set<string>;
    todayItems?: Set<string>;
  },
): SimulationResult {
  const { settings, calendar } = input;
  const cursor: SimulationCursor = {
    memory: cloneMemory(startMemory),
    learned: new Set(startLearned),
    practiceDayIndex: 0,
    learnDayIndex: 0,
    quizRotation: 0,
    mockRotation: 0,
  };

  // Rotations continue from where the plan would have been, so a quiz on note A
  // yesterday makes note B today's quiz rather than A again.
  for (const [day, phase] of calendar) {
    if (diffDays(day, from) <= 0) {
      break;
    }

    if (phase === "practice") {
      cursor.practiceDayIndex += 1;
      cursor.quizRotation += 1;
    } else if (phase === "learn") {
      cursor.learnDayIndex += 1;
    } else if (phase === "mock") {
      cursor.mockRotation += 1;
    }
  }

  const days: JourneyDay[] = [];
  let todayPlan: DayPlan | null = null;

  for (let day = from; diffDays(day, settings.examDate) > 0; day = addDays(day, 1)) {
    // The calendar holds exactly the study days; anything else is a rest day.
    const phase = calendar.get(day);

    if (!phase) {
      days.push({
        day,
        kind: "rest",
        phase: null,
        isToday: day === options.today,
        isPast: false,
        tasks: [],
        minutes: 0,
        activity: null,
      });
      continue;
    }

    // Phases are anchored to the calendar, but what a day is for follows the
    // learner: once everything has been learned, a learning day is practice.
    const effectivePhase: JourneyPhase =
      phase === "learn" && input.units.every((unit) => cursor.learned.has(unit.key))
        ? "practice"
        : phase;
    const plan = planDay(input, cursor, day, effectivePhase);

    if (day === options.today) {
      todayPlan = plan;

      // From tomorrow on, start from what is really known now, plus whatever of
      // today's plan is still to do, assumed done.
      if (options.nowMemory) {
        cursor.memory = cloneMemory(options.nowMemory);
        cursor.learned = new Set(options.nowLearned ?? cursor.learned);
      }

      applyDay(cursor, plan, day, options.todayItems);
    } else {
      applyDay(cursor, plan, day);
    }

    days.push({
      day,
      kind: "study",
      phase: effectivePhase,
      isToday: day === options.today,
      isPast: false,
      tasks: plan.tasks,
      minutes: plan.tasks.reduce((sum, task) => sum + task.minutes, 0),
      activity: null,
    });
  }

  const unscheduled = input.units.filter((unit) => !cursor.learned.has(unit.key)).length;
  return { days, todayPlan, finalCursor: cursor, unscheduled };
}

/** The whole journey: past activity, today's plan, the days ahead and the forecast. */
export function buildExamJourney(input: BuildJourneyInput): ExamJourney {
  const { settings, evidence, nowMs } = input;
  const notes = input.notes;
  const timeZone = settings.timeZone;
  const today = dayKeyAt(nowMs, timeZone);
  const examDate = settings.examDate;
  const daysLeft = diffDays(today, examDate);
  const units = buildLearnUnits(notes);
  const checks = new Set(
    evidence.checks.filter((check) => check.day === today).map((check) => check.taskKey),
  );
  const manualLearned = new Set(
    evidence.checks
      .filter((check) => check.taskKey.startsWith("learn:"))
      .map((check) => check.taskKey),
  );

  const anchor = diffDays(settings.startDay, examDate) > 0 ? settings.startDay : today;
  const phaseAnchor = diffDays(anchor, today) >= 0 ? anchor : today;
  const { calendar, studyDays } = buildPhaseCalendar(phaseAnchor, examDate, settings.restDays);

  // Memory at the start of today (to plan today) and now (for everything else).
  const startOfTodayMs = (() => {
    // The first event that falls on today bounds "before today" in the plan's zone.
    let bound = nowMs;

    for (const event of evidence.events) {
      if (event.atMs < bound && dayKeyAt(event.atMs, timeZone) === today) {
        bound = event.atMs;
      }
    }

    return bound;
  })();
  const memoryStartOfDay = replayMemory(evidence.events, timeZone, { beforeMs: startOfTodayMs });
  const memoryNow = replayMemory(evidence.events, timeZone);
  const learnedStartOfDay = new Set(
    units.filter((unit) => isUnitLearned(unit, memoryStartOfDay, manualLearned)).map((u) => u.key),
  );
  const learnedNow = new Set(
    units.filter((unit) => isUnitLearned(unit, memoryNow, manualLearned)).map((u) => u.key),
  );
  const todayItems = new Set(
    evidence.events
      .filter((event) => dayKeyAt(event.atMs, timeZone) === today)
      .map((event) => memoryKey(event.kind, event.itemId)),
  );

  const simulationInput: SimulationInput = {
    settings,
    notes,
    units,
    calendar,
    studyDays,
    dailyMinutes: settings.dailyMinutes,
  };

  const upcoming = daysLeft > 0;
  const simulation = upcoming
    ? simulate(simulationInput, memoryStartOfDay, learnedStartOfDay, today, {
        today,
        nowMemory: memoryNow,
        nowLearned: learnedNow,
        todayItems,
      })
    : {
        days: [] as JourneyDay[],
        todayPlan: null,
        finalCursor: {
          memory: memoryNow,
          learned: learnedNow,
          practiceDayIndex: 0,
          learnDayIndex: 0,
          quizRotation: 0,
          mockRotation: 0,
        },
        unscheduled: units.filter((unit) => !learnedNow.has(unit.key)).length,
      };

  if (simulation.todayPlan) {
    markTodayProgress(simulation.todayPlan, units, evidence, notes, today, timeZone, checks);
  }

  // --- Past days ------------------------------------------------------------
  const activity = activityByDay(evidence, timeZone);
  const past: JourneyDay[] = [];
  const firstDay = diffDays(settings.startDay, today) > 0 ? settings.startDay : today;

  for (let day = firstDay; diffDays(day, today) > 0 && diffDays(day, examDate) > 0; day = addDays(day, 1)) {
    const dayActivity = activity.get(day) ?? emptyActivity();
    past.push({
      day,
      kind: isRestDay(day, settings.restDays) && !hasActivity(dayActivity) ? "rest" : "study",
      phase: null,
      isToday: false,
      isPast: true,
      tasks: [],
      minutes: 0,
      activity: dayActivity,
    });
  }

  const futureDays = simulation.days.map((day) =>
    day.isToday ? { ...day, activity: activity.get(today) ?? emptyActivity() } : day,
  );

  const examDay: JourneyDay = {
    day: examDate,
    kind: "exam",
    phase: null,
    isToday: examDate === today,
    isPast: diffDays(examDate, today) > 0,
    tasks: [],
    minutes: 0,
    activity: null,
  };

  const days = [...past, ...futureDays, examDay];
  const todayPlan = futureDays.find((day) => day.isToday) ?? null;

  // --- Feasibility ----------------------------------------------------------
  let recommendedMinutes = settings.dailyMinutes;

  if (upcoming && simulation.unscheduled > 0) {
    let low = settings.dailyMinutes;
    let high = 240;
    const fitsAt = (minutes: number) =>
      simulate(
        { ...simulationInput, dailyMinutes: minutes },
        memoryStartOfDay,
        learnedStartOfDay,
        today,
        { today, nowMemory: memoryNow, nowLearned: learnedNow, todayItems },
      ).unscheduled === 0;

    if (fitsAt(high)) {
      while (high - low > 5) {
        const mid = Math.round((low + high) / 2 / 5) * 5;

        if (mid <= low || mid >= high) {
          break;
        }

        if (fitsAt(mid)) {
          high = mid;
        } else {
          low = mid;
        }
      }

      recommendedMinutes = high;
    } else {
      recommendedMinutes = 240;
    }
  }

  // --- Phase summary --------------------------------------------------------
  const phaseEnds: Partial<Record<JourneyPhase, DayKey>> = {};

  for (const [day, phase] of calendar) {
    phaseEnds[phase] = day;
  }

  const currentPhase =
    todayPlan?.phase ??
    futureDays.find((day) => day.kind === "study")?.phase ??
    null;

  // --- This week ------------------------------------------------------------
  let studied = 0;
  let planned = 0;

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);

    if (diffDays(firstDay, day) < 0 || diffDays(day, examDate) <= 0) {
      continue;
    }

    if (hasActivity(activity.get(day))) {
      studied += 1;
    }

    if (!isRestDay(day, settings.restDays)) {
      planned += 1;
    }
  }

  const readiness = buildReadiness({
    settings,
    notes,
    evidence,
    nowMs,
    memoryNow,
    memoryAtExam: simulation.finalCursor.memory,
    locale: input.locale,
  });

  return {
    status: daysLeft > 0 ? "upcoming" : daysLeft === 0 ? "exam_day" : "finished",
    today,
    daysLeft,
    studyDaysLeft: futureDays.filter((day) => day.kind === "study").length,
    phase: currentPhase,
    phaseEnds,
    days,
    todayPlan,
    readiness,
    feasibility: {
      fits: simulation.unscheduled === 0,
      unscheduledSections: simulation.unscheduled,
      totalSections: units.length,
      recommendedMinutes: Math.max(settings.dailyMinutes, recommendedMinutes),
    },
    week: { studied, planned },
    materialPending: notes.filter((note) => !note.ready).length,
  };
}
