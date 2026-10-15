import "server-only";

import { loadEveryRow } from "@/lib/admin/paged-rows";
import type {
  ExamLessonResultRow,
  ExamMockAttemptRow,
  ExamRow,
  ExamTopicRow,
  StudyAssetStatus,
} from "@/lib/database.types";
import {
  buildTrueFalse,
  dailyPlan,
  dayKey,
  daysBetween,
  examMastery,
  examModuleStates,
  examStage,
  gradeForPercentage,
  mockQuestionCounts,
  needsFreshItems,
  pickFlashcards,
  preferUnseen,
  pickQuiz,
  pickWritten,
  seededShuffle,
  shuffleQuestion,
  spreadAcrossModules,
  streakDays,
  summarizeMock,
  type DailyPlan,
  type ExamLessonKind,
  type ExamStage,
  oralQuestionCount,
  type MockAnswerResult,
  type MockOutcome,
  type ModuleState,
  type TrueFalseStatement,
} from "@/lib/exams/exam-model";
import {
  ensureTopicItems,
  ExamModelCallRefused,
  planExpansionTopics,
  planNoteTopics,
  schoolLine,
  writeFreshQuestions,
  writeTopicContent,
  writeMockQuestions,
  type FreshTopicQuestions,
  type GeneratedTopicContent,
  type PlannedTopic,
  type TopicItemGroup,
} from "@/lib/exams/exam-topics-server";
import { planTutorLesson, type TutorStep } from "@/lib/exams/exam-tutor-server";

export { ExamModelCallRefused };
import { markAnswerWithRetry } from "@/lib/practice-test";
import {
  isBlankAnswer,
  isSurrenderAnswer,
  PRACTICE_QUESTION_MAX_SCORE,
} from "@/lib/practice-test-scoring";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export type ExamSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ModuleLecture = {
  id: string;
  title: string | null;
  emoji: string | null;
  status: string;
};

export type ExamModuleView = ModuleState & {
  /** The topic's title. */
  title: string | null;
  noteTitle: string | null;
  emoji: string | null;
  /** The topic can be studied: its note is ready and its topics have been planned. */
  ready: boolean;
  /** A note whose topics are still to be planned (it was still being made at setup). */
  pending: boolean;
  /** The note itself is ready (a pending note's topics can be planned now). */
  noteReady: boolean;
  source: ExamTopicRow["source"];
};

export type ExamMockSummary = {
  id: string;
  percentage: number;
  grade: string;
  gradedAt: string;
};

export type ExamDetail = {
  exam: ExamRow;
  today: string;
  daysLeft: number;
  mastery: number;
  modules: ExamModuleView[];
  /** Learn, practise, prove with the mock exam, then ready: see `examStage`. */
  stage: ExamStage;
  plan: DailyPlan;
  streak: number;
  latestMock: ExamMockSummary | null;
};

export type ExamListItem = {
  exam: ExamRow;
  daysLeft: number;
  mastery: number;
  moduleCount: number;
  doneToday: number;
  goal: number;
};

const LESSON_SIZE = {
  flashcards: 8,
  quiz: 5,
  true_false: 5,
  written: 1,
} as const;

/* ---------------------------------------------------------------- reading */

/*
 * Every result, oldest first. PostgREST stops a select at 1000 rows without saying so, and mastery
 * goes by each lesson's latest score, so a single capped read would keep the oldest results and
 * drop exactly the ones that count.
 */
async function readResults(supabase: ExamSupabase, userId: string, examIds: string[]) {
  if (examIds.length === 0) {
    return [] as ExamLessonResultRow[];
  }

  return loadEveryRow<ExamLessonResultRow>((from, to) =>
    supabase
      .from("exam_lesson_results")
      .select("*")
      .eq("user_id", userId)
      .in("exam_id", examIds)
      .order("completed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

async function readActiveDays(supabase: ExamSupabase, userId: string) {
  const { data, error } = await supabase
    .from("exam_lesson_results")
    .select("completed_at")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(1000);

  if (error) {
    throw error;
  }

  return new Set(
    ((data ?? []) as { completed_at: string }[]).map((row) => dayKey(row.completed_at)),
  );
}

/**
 * Today's goal, set by the work that was left when the day began: the modules as they stood on
 * the results from before today (and the mock, if it was graded before today). Finishing a lesson,
 * a first try or a repeat, then moves "done" and never the goal. Once the exam day has passed
 * there is no goal.
 */
function planFor(
  exam: ExamRow,
  modules: { topicId: string; lectureId: string }[],
  states: ModuleState[],
  results: ExamLessonResultRow[],
  mockOutcome: MockOutcome | null,
  now: Date,
): DailyPlan {
  const today = dayKey(now);
  const before = results.filter((row) => dayKey(row.completed_at) < today);
  const mockBefore = mockOutcome && dayKey(mockOutcome.at) < today ? mockOutcome : null;
  const target = exam.target_mastery / 100;
  const atStartOfDay = examModuleStates(modules, before, target, mockBefore, now);
  const plan = dailyPlan({
    examDate: exam.exam_date,
    today,
    dailyMinutes: exam.daily_minutes,
    states: atStartOfDay,
    resultsToday: results.length - before.length,
    untriedDoneToday: 0,
  });
  const remaining = dailyPlan({
    examDate: exam.exam_date,
    today,
    dailyMinutes: exam.daily_minutes,
    states,
    resultsToday: 0,
    untriedDoneToday: 0,
  }).remaining;

  return {
    ...plan,
    goal: daysBetween(today, exam.exam_date) < 0 ? 0 : plan.goal,
    remaining,
  };
}

export async function listExamsForUser(
  supabase: ExamSupabase,
  userId: string,
  now = new Date(),
): Promise<ExamListItem[]> {
  const { data, error } = await supabase
    .from("exams")
    .select("*")
    .eq("user_id", userId)
    .order("exam_date", { ascending: true });

  if (error) {
    throw error;
  }

  const exams = (data ?? []) as ExamRow[];

  if (exams.length === 0) {
    return [];
  }

  const examIds = exams.map((exam) => exam.id);
  const [{ data: moduleRows, error: moduleError }, results, topics] = await Promise.all([
    supabase
      .from("exam_modules")
      .select("exam_id, lecture_id, position")
      .eq("user_id", userId)
      .in("exam_id", examIds)
      .order("position", { ascending: true }),
    readResults(supabase, userId, examIds),
    readTopicLines(supabase, userId, examIds),
  ]);

  if (moduleError) {
    throw moduleError;
  }

  const today = dayKey(now);
  const modules = (moduleRows ?? []) as { exam_id: string; lecture_id: string; position: number }[];

  return exams.map((exam) => {
    const lectureIds = modules.filter((row) => row.exam_id === exam.id).map((row) => row.lecture_id);
    const examResults = results.filter((row) => row.exam_id === exam.id);
    // Without the notes' status here, only a placeholder (topics not planned yet) is known unready.
    const ordered = orderModules(
      lectureIds,
      topics.filter((topic) => topic.exam_id === exam.id),
    ).map((module) => ({ ...module, available: module.topic !== null }));
    const states = examModuleStates(ordered, examResults, exam.target_mastery / 100, null, now);
    const plan = planFor(exam, ordered, states, examResults, null, now);

    return {
      exam,
      daysLeft: daysBetween(today, exam.exam_date),
      mastery: examMastery(states),
      moduleCount: ordered.length,
      doneToday: plan.doneToday,
      goal: plan.goal,
    };
  });
}

/** The nearest exam that has not been sat yet, for the home card. */
/**
 * What a library row needs. Every prep the learner has: the ones still ahead of their exam
 * first, nearest first, then the past ones (archived, or whose day has gone), latest first.
 */
export type LibraryExamPrep = {
  id: string;
  title: string;
  daysLeft: number;
  mastery: number;
  past: boolean;
  grade: string | null;
};

export async function listLibraryExamPreps(
  supabase: ExamSupabase,
  userId: string,
  now = new Date(),
): Promise<LibraryExamPrep[]> {
  const items = await listExamsForUser(supabase, userId, now);
  const preps = items.map((item) => ({
    id: item.exam.id,
    title: item.exam.title,
    daysLeft: item.daysLeft,
    mastery: item.mastery,
    past: Boolean(item.exam.archived_at) || item.daysLeft < 0,
    grade: item.exam.actual_grade,
  }));

  return [...preps.filter((prep) => !prep.past), ...preps.filter((prep) => prep.past).reverse()];
}

type TopicLine = Pick<ExamTopicRow, "id" | "exam_id" | "lecture_id" | "position" | "title" | "source">;

const PENDING_PREFIX = "pending:";

/**
 * The modules of an exam in path order: notes in the order the learner put them, each note's
 * topics in the order they were planned. A note without topics yet stands in as one placeholder
 * module until its topics are planned.
 */
function orderModules(
  noteOrder: string[],
  topics: TopicLine[],
): { topicId: string; lectureId: string; topic: TopicLine | null }[] {
  return noteOrder.flatMap((lectureId): { topicId: string; lectureId: string; topic: TopicLine | null }[] => {
    const own = topics
      .filter((topic) => topic.lecture_id === lectureId)
      .sort((left, right) => left.position - right.position);

    return own.length > 0
      ? own.map((topic) => ({ topicId: topic.id, lectureId, topic }))
      : [{ topicId: `${PENDING_PREFIX}${lectureId}`, lectureId, topic: null }];
  });
}

async function readTopicLines(supabase: ExamSupabase, userId: string, examIds: string[]) {
  if (examIds.length === 0) {
    return [] as TopicLine[];
  }

  const { data, error } = await supabase
    .from("exam_topics")
    .select("id, exam_id, lecture_id, position, title, source")
    .eq("user_id", userId)
    .in("exam_id", examIds)
    .order("position", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as TopicLine[];
}

export async function readOwnedExam(supabase: ExamSupabase, userId: string, examId: string) {
  const { data, error } = await supabase
    .from("exams")
    .select("*")
    .eq("id", examId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ExamRow | null;
}

async function readModules(supabase: ExamSupabase, userId: string, examId: string) {
  const { data, error } = await supabase
    .from("exam_modules")
    .select("lecture_id, position")
    .eq("exam_id", examId)
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as { lecture_id: string; position: number }[];
  const lectureIds = rows.map((row) => row.lecture_id);

  if (lectureIds.length === 0) {
    return { lectureIds, lectures: new Map<string, ModuleLecture>() };
  }

  const { data: lectureRows, error: lectureError } = await supabase
    .from("lectures")
    .select("id, title, emoji, status")
    .in("id", lectureIds)
    .eq("user_id", userId);

  if (lectureError) {
    throw lectureError;
  }

  const lectures = new Map(
    ((lectureRows ?? []) as ModuleLecture[]).map((lecture) => [lecture.id, lecture]),
  );

  // A note deleted from the library leaves the exam with it.
  return { lectureIds: lectureIds.filter((id) => lectures.has(id)), lectures };
}

/** A graded mock exam's score per note, from the questions it snapshotted and how they were marked. */
function mockOutcomeFrom(
  row: Pick<ExamMockAttemptRow, "percentage" | "graded_at" | "questions" | "answers"> | null,
): MockOutcome | null {
  if (!row || row.percentage === null || !row.graded_at) {
    return null;
  }

  const answers = new Map(((row.answers ?? []) as MockGradedAnswer[]).map((answer) => [answer.questionId, answer]));
  const totals = new Map<string, { score: number; max: number }>();

  for (const question of (row.questions ?? []) as MockQuestion[]) {
    const answer = answers.get(question.id);
    const max = answer?.maxScore ?? (question.kind === "choice" ? 1 : PRACTICE_QUESTION_MAX_SCORE);
    const entry = totals.get(question.lectureId) ?? { score: 0, max: 0 };
    entry.score += answer?.marked ? answer.score : 0;
    entry.max += max;
    totals.set(question.lectureId, entry);
  }

  return {
    at: row.graded_at,
    percentage: row.percentage,
    byLecture: Object.fromEntries(
      [...totals.entries()].map(([lectureId, entry]) => [lectureId, entry.max > 0 ? entry.score / entry.max : 0]),
    ),
  };
}

export async function getExamDetail(
  supabase: ExamSupabase,
  userId: string,
  examId: string,
  now = new Date(),
): Promise<ExamDetail | null> {
  const exam = await readOwnedExam(supabase, userId, examId);

  if (!exam) {
    return null;
  }

  const today = dayKey(now);
  const [{ lectureIds, lectures }, results, activeDays, mock, topics] = await Promise.all([
    readModules(supabase, userId, examId),
    readResults(supabase, userId, [examId]),
    readActiveDays(supabase, userId),
    supabase
      .from("exam_mock_attempts")
      .select("id, percentage, graded_at, questions, answers")
      .eq("exam_id", examId)
      .eq("user_id", userId)
      .eq("status", "graded")
      .order("graded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    readTopicLines(supabase, userId, [examId]),
  ]);

  const mockRow = mock.data as Pick<
    ExamMockAttemptRow,
    "id" | "percentage" | "graded_at" | "questions" | "answers"
  > | null;
  const mockOutcome = mockOutcomeFrom(mockRow);
  const target = exam.target_mastery / 100;
  // A note still being made, or one whose topics are not planned yet, is skipped by the path and
  // does not hold back the modules after it.
  const ordered = orderModules(lectureIds, topics).map((module) => ({
    ...module,
    available: lectures.get(module.lectureId)?.status === "ready" && module.topic !== null,
  }));
  const states = examModuleStates(ordered, results, target, mockOutcome, now);
  const modules = states.map((state, index) => {
    const lecture = lectures.get(state.lectureId);
    const topic = ordered[index].topic;

    return {
      ...state,
      title: topic?.title ?? lecture?.title ?? null,
      noteTitle: lecture?.title ?? null,
      emoji: lecture?.emoji ?? null,
      ready: lecture?.status === "ready" && topic !== null,
      pending: topic === null,
      noteReady: lecture?.status === "ready",
      source: topic?.source ?? "material",
    };
  });
  return {
    exam,
    today,
    daysLeft: daysBetween(today, exam.exam_date),
    mastery: examMastery(states),
    modules,
    stage: examStage(states, mockOutcome, target),
    plan: planFor(exam, ordered, states, results, mockOutcome, now),
    streak: streakDays(activeDays, today),
    latestMock:
      mockRow && mockRow.percentage !== null && mockRow.graded_at
        ? {
            id: mockRow.id,
            percentage: mockRow.percentage,
            grade: gradeForPercentage(exam.grading_scale, mockRow.percentage, exam.pass_percentage),
            gradedAt: mockRow.graded_at,
          }
        : null,
  };
}

/* ---------------------------------------------------------------- writing */

export type ExamInput = {
  title: string;
  examDate: string;
  targetMastery: number;
  dailyMinutes: number;
  examFormat: ExamRow["exam_format"];
  examKind: ExamRow["exam_kind"];
  gradingScale: ExamRow["grading_scale"];
  passPercentage: number;
  lectureIds: string[];
  schoolLevel?: string | null;
  schoolYear?: string | null;
  aiExpand?: boolean;
  /** The plan the learner reviewed: topics per note, as kept, renamed or added on the review. */
  topics?: (PlannedTopic & { lectureId: string; source: ExamTopicRow["source"] })[];
};

/**
 * Only the learner's own notes can become modules. A note still being made from material added
 * during setup is kept (its module opens once it is ready); a note that failed is dropped.
 */
async function ownedUsableLectureIds(supabase: ExamSupabase, userId: string, lectureIds: string[]) {
  const unique = [...new Set(lectureIds)];

  if (unique.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("lectures")
    .select("id, status")
    .in("id", unique)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  const usable = new Set(
    ((data ?? []) as { id: string; status: string }[])
      .filter((row) => row.status !== "failed")
      .map((row) => row.id),
  );

  return unique.filter((id) => usable.has(id));
}

export async function createExam(supabase: ExamSupabase, userId: string, input: ExamInput) {
  const lectureIds = await ownedUsableLectureIds(supabase, userId, input.lectureIds);

  if (lectureIds.length === 0) {
    return { error: "no_notes" as const };
  }

  const { data, error } = await supabase
    .from("exams")
    .insert({
      user_id: userId,
      title: input.title,
      exam_date: input.examDate,
      target_mastery: input.targetMastery,
      daily_minutes: input.dailyMinutes,
      exam_format: input.examFormat,
      exam_kind: input.examKind,
      grading_scale: input.gradingScale,
      pass_percentage: input.passPercentage,
      school_level: input.schoolLevel ?? null,
      school_year: input.schoolYear ?? null,
      ai_expand: input.aiExpand ?? false,
    } as never)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const exam = data as ExamRow;
  const { error: moduleError } = await supabase.from("exam_modules").insert(
    lectureIds.map((lectureId, position) => ({
      exam_id: exam.id,
      lecture_id: lectureId,
      user_id: userId,
      position,
    })) as never,
  );

  if (moduleError) {
    await supabase.from("exams").delete().eq("id", exam.id).eq("user_id", userId);
    throw moduleError;
  }

  /*
   * The topics the learner kept on the review. A note with none (still being made at setup) gets
   * its topics planned when it is ready; see `planPendingTopics`.
   */
  const kept = new Set(lectureIds);
  const topics = (input.topics ?? []).filter((topic) => kept.has(topic.lectureId));

  if (topics.length > 0) {
    const positions = new Map<string, number>();
    const { error: topicError } = await supabase.from("exam_topics").insert(
      topics.map((topic) => {
        const position = positions.get(topic.lectureId) ?? 0;
        positions.set(topic.lectureId, position + 1);

        return {
          exam_id: exam.id,
          lecture_id: topic.lectureId,
          user_id: userId,
          position,
          title: topic.title,
          source: topic.source,
          summary: topic.summary,
          key_points: topic.keyPoints,
        };
      }) as never,
    );

    if (topicError) {
      await supabase.from("exams").delete().eq("id", exam.id).eq("user_id", userId);
      throw topicError;
    }
  }

  return { exam };
}

/* ---------------------------------------------------------------- topics */

type PlanningLecture = {
  id: string;
  title: string | null;
  status: string;
};

type PlanningArtifact = {
  lecture_id: string;
  summary: string;
  key_topics: string[] | null;
  structured_notes_md: string | null;
};

export type NotePlan = {
  lectureId: string;
  title: string | null;
  /** "pending": the note is still being made; its topics are planned once it is ready. */
  status: "planned" | "pending";
  topics: (PlannedTopic & { source: ExamTopicRow["source"] })[];
};

async function readPlanningNotes(supabase: ExamSupabase, userId: string, lectureIds: string[]) {
  const [{ data: lectureRows, error: lectureError }, { data: artifactRows, error: artifactError }] =
    await Promise.all([
      supabase.from("lectures").select("id, title, status").in("id", lectureIds).eq("user_id", userId),
      supabase
        .from("lecture_artifacts")
        .select("lecture_id, summary, key_topics, structured_notes_md")
        .in("lecture_id", lectureIds),
    ]);

  if (lectureError) {
    throw lectureError;
  }

  if (artifactError) {
    throw artifactError;
  }

  const lectures = new Map(((lectureRows ?? []) as PlanningLecture[]).map((row) => [row.id, row]));
  const artifacts = new Map(((artifactRows ?? []) as PlanningArtifact[]).map((row) => [row.lecture_id, row]));

  return { lectures, artifacts };
}

/** Runs `work` over `items` with at most `limit` in flight, keeping the order of the results. */
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await work(items[index]);
      }
    }),
  );

  return out;
}

/**
 * The setup's "Creating your study path": each note split into topics, plus (only when the learner
 * allowed it) up to two topics the material leaves out. Nothing is stored; the learner reviews the
 * plan first and `createExam` stores what they keep.
 */
export async function planExamTopics(
  supabase: ExamSupabase,
  userId: string,
  input: { lectureIds: string[]; aiExpand: boolean; schoolLevel: string | null; schoolYear: string | null },
): Promise<NotePlan[]> {
  const lectureIds = await ownedUsableLectureIds(supabase, userId, input.lectureIds);
  const { lectures, artifacts } = await readPlanningNotes(supabase, userId, lectureIds);
  const school = schoolLine(input.schoolLevel, input.schoolYear);

  const plans = await inBatches(lectureIds, 4, async (lectureId): Promise<NotePlan> => {
    const lecture = lectures.get(lectureId);
    const artifact = artifacts.get(lectureId);

    if (!lecture || lecture.status !== "ready" || !artifact) {
      return { lectureId, title: lecture?.title ?? null, status: "pending", topics: [] };
    }

    const topics = await planNoteTopics({
      lectureId,
      userId,
      title: lecture.title,
      summary: artifact.summary ?? "",
      keyTopics: artifact.key_topics ?? [],
      notesMarkdown: artifact.structured_notes_md ?? "",
      school,
    });

    return {
      lectureId,
      title: lecture.title,
      status: "planned",
      topics: topics.map((topic) => ({ ...topic, source: "material" as const })),
    };
  });

  if (input.aiExpand) {
    const planned = plans.filter((plan) => plan.status === "planned");
    const extra = await planExpansionTopics({
      userId,
      school,
      notes: planned.map((plan) => ({
        title: plan.title ?? "",
        summary: artifacts.get(plan.lectureId)?.summary ?? "",
        topicTitles: plan.topics.map((topic) => topic.title),
      })),
    });

    for (const topic of extra) {
      const { noteIndex, ...rest } = topic;
      planned[noteIndex]?.topics.push({ ...rest, source: "ai" });
    }
  }

  return plans;
}

/**
 * Plans the topics of an exam's notes that have none yet: a note that was still being made when
 * the exam was set up, or an exam from before topics. Only notes the learner can study are planned
 * (`canStudy`, the notes' own access); `refused` says every note waiting was one they cannot.
 *
 * The exam screen asks for this while a note shows as "preparing", so two requests can plan the
 * same note at once. Each checks again just before it stores its topics, and once stored keeps
 * only the first plan stored for the note (`keepFirstPlan`), so a note never ends up with two.
 */
export async function planPendingTopics(
  supabase: ExamSupabase,
  userId: string,
  examId: string,
  canStudy: (lectureId: string) => Promise<boolean>,
): Promise<{ planned: number; refused: boolean } | null> {
  const exam = await readOwnedExam(supabase, userId, examId);

  if (!exam) {
    return null;
  }

  const [{ lectureIds }, topics] = await Promise.all([
    readModules(supabase, userId, examId),
    readTopicLines(supabase, userId, [examId]),
  ]);
  const withTopics = new Set(topics.map((topic) => topic.lecture_id));
  const missing = lectureIds.filter((lectureId) => !withTopics.has(lectureId));

  if (missing.length === 0) {
    return { planned: 0, refused: false };
  }

  const studiable: string[] = [];

  for (const lectureId of missing) {
    if (await canStudy(lectureId)) {
      studiable.push(lectureId);
    }
  }

  if (studiable.length === 0) {
    return { planned: 0, refused: true };
  }

  const plans = await planExamTopics(supabase, userId, {
    lectureIds: studiable,
    aiExpand: false,
    schoolLevel: exam.school_level,
    schoolYear: exam.school_year,
  });
  // Another request may have planned some of these notes while this one was calling the model.
  const plannedMeanwhile = new Set(
    (await readTopicLines(supabase, userId, [examId])).map((topic) => topic.lecture_id),
  );
  const ready = plans.filter(
    (plan) => plan.status === "planned" && plan.topics.length > 0 && !plannedMeanwhile.has(plan.lectureId),
  );

  if (ready.length === 0) {
    return { planned: 0, refused: false };
  }

  const { data, error } = await supabase
    .from("exam_topics")
    .insert(
      ready.flatMap((plan) =>
        plan.topics.map((topic, position) => ({
          exam_id: examId,
          lecture_id: plan.lectureId,
          user_id: userId,
          position,
          title: topic.title,
          source: topic.source,
          summary: topic.summary,
          key_points: topic.keyPoints,
        })),
      ) as never,
    )
    .select("id");

  if (error) {
    throw error;
  }

  const ours = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));

  for (const plan of ready) {
    await keepFirstPlan(supabase, userId, examId, plan.lectureId, ours);
  }

  return { planned: ready.length, refused: false };
}

/*
 * When two requests stored a plan for the same note, the one stored first stays and the other is
 * deleted, whichever request notices. Each looks only after its own insert, so the one that looks
 * last always sees both plans; both agree on which was first (`created_at`, then the lowest id).
 */
async function keepFirstPlan(
  supabase: ExamSupabase,
  userId: string,
  examId: string,
  lectureId: string,
  ours: Set<string>,
) {
  const { data, error } = await supabase
    .from("exam_topics")
    .select("id, created_at")
    .eq("exam_id", examId)
    .eq("lecture_id", lectureId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  type Stored = { id: string; created_at: string };
  const rows = (data ?? []) as Stored[];
  const batchOf = (row: Stored) => (ours.has(row.id) ? "ours" : row.created_at);
  const batches = new Map<string, Stored[]>();

  for (const row of rows) {
    batches.set(batchOf(row), [...(batches.get(batchOf(row)) ?? []), row]);
  }

  if (batches.size < 2) {
    return;
  }

  const isBefore = (left: Stored, right: Stored) => {
    const gap = Date.parse(left.created_at) - Date.parse(right.created_at);
    return gap < 0 || (gap === 0 && left.id < right.id);
  };
  const first = (batch: Stored[]) => batch.reduce((min, row) => (isBefore(row, min) ? row : min));
  const keep = [...batches.values()].reduce((winner, batch) => (isBefore(first(batch), first(winner)) ? batch : winner));
  const kept = new Set(keep.map((row) => row.id));
  const drop = rows.filter((row) => !kept.has(row.id)).map((row) => row.id);
  const { error: deleteError } = await supabase
    .from("exam_topics")
    .delete()
    .in("id", drop)
    .eq("user_id", userId);

  if (deleteError) {
    throw deleteError;
  }
}

export async function readOwnedTopic(supabase: ExamSupabase, userId: string, examId: string, topicId: string) {
  const { data, error } = await supabase
    .from("exam_topics")
    .select("*")
    .eq("id", topicId)
    .eq("exam_id", examId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ExamTopicRow | null;
}

export type ExamPatch = {
  actualGrade?: string | null;
  archived?: boolean;
  examDate?: string;
  title?: string;
};

export async function updateExam(
  supabase: ExamSupabase,
  userId: string,
  examId: string,
  patch: ExamPatch,
) {
  const update: Record<string, unknown> = {};

  if (patch.actualGrade !== undefined) {
    update.actual_grade = patch.actualGrade;
  }

  if (patch.archived !== undefined) {
    update.archived_at = patch.archived ? new Date().toISOString() : null;
  }

  if (patch.examDate !== undefined) {
    update.exam_date = patch.examDate;
  }

  if (patch.title !== undefined) {
    update.title = patch.title;
  }

  const { data, error } = await supabase
    .from("exams")
    .update(update as never)
    .eq("id", examId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ExamRow | null;
}

export async function deleteExam(supabase: ExamSupabase, userId: string, examId: string) {
  const { error, count } = await supabase
    .from("exams")
    .delete({ count: "exact" })
    .eq("id", examId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

export async function examHasModule(
  supabase: ExamSupabase,
  userId: string,
  examId: string,
  lectureId: string,
) {
  const { data, error } = await supabase
    .from("exam_modules")
    .select("lecture_id")
    .eq("exam_id", examId)
    .eq("lecture_id", lectureId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function recordLessonResult(
  supabase: ExamSupabase,
  userId: string,
  input: {
    examId: string;
    topicId: string;
    kind: ExamLessonKind;
    correct: number;
    total: number;
    difficulty: number | null;
    itemIds?: string[];
  },
) {
  const topic = await readOwnedTopic(supabase, userId, input.examId, input.topicId);

  if (!topic) {
    return false;
  }

  // A lesson with nothing to score (one skipped because it would not load) is done, but at 0.
  const score = input.total > 0 ? Math.min(1, input.correct / input.total) : 0;
  const { error } = await supabase.from("exam_lesson_results").insert({
    exam_id: input.examId,
    lecture_id: topic.lecture_id,
    topic_id: topic.id,
    user_id: userId,
    lesson_kind: input.kind,
    correct: input.correct,
    total: input.total,
    score,
    difficulty: input.difficulty,
    item_ids: [...new Set(input.itemIds ?? [])].slice(0, 40),
  } as never);

  if (error) {
    throw error;
  }

  return true;
}

/* ---------------------------------------------------------------- lessons */

/** Which existing study surface has to be generated before a lesson can be built. */
export type LessonGenerator = "study" | "quiz" | "practice_test";

export type LessonPayload =
  | {
      kind: "summary";
      summary: string;
      keyTopics: string[];
      notesMarkdown: string;
    }
  | {
      kind: "flashcards";
      cards: { id: string; front: string; back: string }[];
      /** Written for a topic outside the material: no spaced-repetition progress to record. */
      generated: boolean;
    }
  | {
      kind: "quiz";
      questions: {
        id: string;
        prompt: string;
        options: string[];
        correctIndex: number;
        explanation: string;
      }[];
    }
  | { kind: "true_false"; statements: TrueFalseStatement[] }
  | {
      kind: "written";
      questions: { id: string; prompt: string }[];
      /** Written by the AI (for the topic, or fresh for a repeat): graded through the exam, not the note's test. */
      generated: boolean;
    }
  | {
      kind: "tutor";
      /** The note whose tutor session the lesson speaks through (talking time is counted there). */
      lectureId: string;
      topicTitle: string;
      steps: TutorStep[];
    };

export type LessonLoad =
  | { status: "ready"; lesson: LessonPayload }
  | { status: "generating" | "missing" | "failed"; generator: LessonGenerator };

const GENERATOR_FOR: Record<Exclude<ExamLessonKind, "summary" | "tutor">, LessonGenerator> = {
  flashcards: "study",
  quiz: "quiz",
  true_false: "quiz",
  written: "practice_test",
};

const ASSET_TABLE: Record<LessonGenerator, string> = {
  study: "lecture_study_assets",
  quiz: "lecture_quiz_assets",
  practice_test: "lecture_practice_test_assets",
};

async function assetState(
  supabase: ExamSupabase,
  lectureId: string,
  generator: LessonGenerator,
): Promise<LessonLoad> {
  const { data } = await supabase
    .from(ASSET_TABLE[generator] as "lecture_quiz_assets")
    .select("status")
    .eq("lecture_id", lectureId)
    .maybeSingle();
  const status = (data as { status: StudyAssetStatus } | null)?.status;

  if (status === "queued" || status === "generating") {
    return { status: "generating", generator };
  }

  if (status === "failed") {
    return { status: "failed", generator };
  }

  return { status: "missing", generator };
}

type QuizRow = {
  id: string;
  prompt: string;
  options_json: unknown;
  correct_option_idx: number;
  explanation: string;
};

function quizRows(rows: QuizRow[]) {
  return rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    options: Array.isArray(row.options_json) ? (row.options_json as unknown[]).map(String) : [],
    correct_option_idx: row.correct_option_idx,
    explanation: row.explanation,
  }));
}

const ITEM_GROUP: Record<Exclude<ExamLessonKind, "summary" | "tutor">, TopicItemGroup> = {
  flashcards: "flashcards",
  quiz: "quiz",
  true_false: "quiz",
  written: "written",
};

/* A topic's own items, topped up from the rest of its note when it has too few for a lesson. */
const TOPIC_POOL_MIN = { flashcards: 5, quiz: 8, written: 1 } as const;

function topUp<T extends { id: string }>(all: T[], ownIds: string[], minimum: number, seed: string) {
  const own = new Set(ownIds);
  const pool = all.filter((item) => own.has(item.id));

  if (pool.length >= minimum) {
    return pool;
  }

  return [...pool, ...seededShuffle(all.filter((item) => !own.has(item.id)), `${seed}:top-up`).slice(0, minimum - pool.length)];
}

function keyPointsOf(topic: ExamTopicRow) {
  return Array.isArray(topic.key_points) ? (topic.key_points as unknown[]).map(String) : [];
}

/**
 * A topic the material does not cover gets its lessons written the first time one is opened. Two
 * lessons opened at once can both write them; only the first stored is kept (the update applies
 * only while nothing is stored), and the other request uses that one.
 */
async function ensureWrittenTopic(
  supabase: ExamSupabase,
  userId: string,
  topic: ExamTopicRow,
  exam: ExamRow,
  mayCallModel: () => Promise<boolean>,
) {
  if (topic.source === "material" || topic.generated) {
    return topic;
  }

  if (!(await mayCallModel())) {
    throw new ExamModelCallRefused();
  }

  const [{ data: lecture }, { data: artifact }] = await Promise.all([
    supabase.from("lectures").select("title").eq("id", topic.lecture_id).maybeSingle(),
    supabase.from("lecture_artifacts").select("structured_notes_md").eq("lecture_id", topic.lecture_id).maybeSingle(),
  ]);
  const written = await writeTopicContent({
    userId,
    lectureId: topic.lecture_id,
    topicTitle: topic.title,
    summary: topic.summary,
    keyPoints: keyPointsOf(topic),
    noteTitle: (lecture as { title: string | null } | null)?.title ?? null,
    notesMarkdown: (artifact as { structured_notes_md: string | null } | null)?.structured_notes_md ?? "",
    school: schoolLine(exam.school_level, exam.school_year),
  });
  const updated = {
    ...topic,
    summary: written.summary,
    key_points: written.keyPoints,
    generated: written.content as unknown as ExamTopicRow["generated"],
  };
  const { data, error } = await supabase
    .from("exam_topics")
    .update({ summary: updated.summary, key_points: updated.key_points, generated: updated.generated } as never)
    .eq("id", topic.id)
    .eq("user_id", userId)
    .is("generated", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return updated;
  }

  return (await readOwnedTopic(supabase, userId, topic.exam_id, topic.id)) ?? updated;
}

/*
 * Questions the AI wrote, for a topic outside the material (`gen`) or fresh for a repeat (`x`),
 * carry ids that say where to find them again: `gen:<topic>:q3`, `x:<topic>:w12`. The lessons, the
 * written-answer grader and the mock exam all use these, so a question practised in a lesson is
 * recognised as practised when the mock is drawn.
 *
 * The number is the question's place for `gen` (written once, never changed). Fresh questions are
 * appended and the oldest dropped at a cap, so a place would hand a seen question's id to a new one;
 * each is stored with its own serial (`n`, from the topic's `extra.next`) instead. Fresh questions
 * stored before serials have none and keep their place as their number, as they always had.
 */
type ContentKind = "q" | "w" | "f";

function contentId(origin: "gen" | "x", topicId: string, kind: ContentKind, index: number) {
  return `${origin}:${topicId}:${kind}${index}`;
}

const CONTENT_ID = /^(gen|x):([0-9a-f-]{36}):([qwf])(\d{1,6})$/;

function parseContentId(id: string) {
  const match = CONTENT_ID.exec(id);
  return match ? { origin: match[1] as "gen" | "x", topicId: match[2], kind: match[3] as ContentKind, index: Number(match[4]) } : null;
}

/** A topic's fresh questions as stored in `exam_topics.extra`. */
type StoredFresh = {
  quiz?: (FreshTopicQuestions["quiz"][number] & { n?: number })[];
  written?: (FreshTopicQuestions["written"][number] & { n?: number })[];
  /** The serial the next fresh question gets; absent on rows stored before serials. */
  next?: number;
};

/** A stored question's number in its id: its serial, or its place when it was stored without one. */
function serialOf(question: { n?: number }, index: number) {
  return typeof question.n === "number" ? question.n : index;
}

type PoolQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct_option_idx: number;
  explanation: string;
};

function contentQuiz(origin: "gen" | "x", topicId: string, quiz: StoredFresh["quiz"] | undefined): PoolQuestion[] {
  return (quiz ?? []).map((question, index) => ({
    id: contentId(origin, topicId, "q", serialOf(question, index)),
    prompt: question.prompt,
    options: question.options,
    correct_option_idx: question.correctIndex,
    explanation: question.explanation,
  }));
}

function contentWritten(origin: "gen" | "x", topicId: string, written: StoredFresh["written"] | undefined) {
  return (written ?? []).map((question, index) => ({
    id: contentId(origin, topicId, "w", serialOf(question, index)),
    prompt: question.prompt,
    importance: null as number | null,
  }));
}

/* The lessons that share a pool: a quiz question seen in true/false counts as seen for the quiz. */
const SEEN_GROUP: Record<ExamLessonKind, ExamLessonKind[]> = {
  summary: ["summary"],
  tutor: ["tutor"],
  flashcards: ["flashcards"],
  quiz: ["quiz", "true_false"],
  true_false: ["quiz", "true_false"],
  written: ["written"],
};

/* How many fresh questions a topic gets when it runs out, and how many it keeps in all. */
const FRESH_BATCH = { quiz: 8, written: 2 } as const;
const FRESH_KEEP = { quiz: 64, written: 16 } as const;

async function readNotesMarkdown(supabase: ExamSupabase, lectureId: string) {
  const { data } = await supabase.from("lecture_artifacts").select("structured_notes_md").eq("lecture_id", lectureId).maybeSingle();
  return (data as { structured_notes_md: string | null } | null)?.structured_notes_md ?? "";
}

/**
 * Writes fresh questions for a topic whose pool the learner has seen through, keeps them on the
 * topic and returns the topic's fresh questions so far. A failure leaves the pool as it was: the
 * repeat then reuses seen questions, which beats no lesson.
 *
 * The write only lands if nobody else topped the topic up since it was read (`extra.next` is
 * unchanged); otherwise the other request's questions are the ones kept and returned, so a lesson
 * never shows questions that were not stored under the ids it hands out.
 */
async function topUpFresh(
  supabase: ExamSupabase,
  userId: string,
  exam: ExamRow,
  topic: ExamTopicRow,
  kind: "quiz" | "written",
  avoid: string[],
  mayCallModel: () => Promise<boolean>,
): Promise<StoredFresh> {
  const current = (topic.extra as unknown as StoredFresh | null) ?? { quiz: [], written: [] };

  try {
    if (!(await mayCallModel())) {
      return current;
    }

    const fresh = await writeFreshQuestions({
      userId,
      lectureId: topic.lecture_id,
      topicTitle: topic.title,
      summary: topic.summary,
      keyPoints: keyPointsOf(topic),
      notesMarkdown: await readNotesMarkdown(supabase, topic.lecture_id),
      school: schoolLine(exam.school_level, exam.school_year),
      quiz: kind === "quiz" ? FRESH_BATCH.quiz : 0,
      written: kind === "written" ? FRESH_BATCH.written : 0,
      avoid,
    });
    // Questions stored before serials keep their place as their number; new ones count on from there.
    const kept = {
      quiz: (current.quiz ?? []).map((question, index) => ({ ...question, n: serialOf(question, index) })),
      written: (current.written ?? []).map((question, index) => ({ ...question, n: serialOf(question, index) })),
    };
    let serial =
      current.next ?? Math.max(0, ...[...kept.quiz, ...kept.written].map((question) => question.n + 1));
    const next: StoredFresh = {
      quiz: [...kept.quiz, ...fresh.quiz.map((question) => ({ ...question, n: serial++ }))].slice(-FRESH_KEEP.quiz),
      written: [...kept.written, ...fresh.written.map((question) => ({ ...question, n: serial++ }))].slice(
        -FRESH_KEEP.written,
      ),
      next: serial,
    };
    const update = supabase
      .from("exam_topics")
      .update({ extra: next } as never)
      .eq("id", topic.id)
      .eq("user_id", userId);
    const { data, error } = await (current.next === undefined
      ? update.is("extra->>next" as never, null)
      : update.eq("extra->>next" as never, String(current.next) as never)
    )
      .select("id")
      .maybeSingle();

    if (error) {
      return current;
    }

    if (data) {
      return next;
    }

    const stored = await readOwnedTopic(supabase, userId, topic.exam_id, topic.id);
    return (stored?.extra as unknown as StoredFresh | null) ?? current;
  } catch {
    return current;
  }
}

/**
 * One lesson of one topic. A topic from the material draws on the note's own flashcards, quiz and
 * practice questions sorted into it (topped up from the rest of the note when it has too few); a
 * topic outside the material uses the lessons written for it. When the note has not had that kind
 * of material generated yet, the answer says which generator to start.
 *
 * Each try draws questions the learner has not been shown in this topic yet; once the topic has
 * none left, fresh ones are written for it, so a repeat is new practice rather than the same
 * questions recognised. The tutor lesson is planned anew each time from the topic and its note.
 */
export async function loadLesson(
  supabase: ExamSupabase,
  userId: string,
  input: {
    examId: string;
    topicId: string;
    kind: ExamLessonKind;
    /**
     * Asked before each model call the lesson needs (its rate limit). When it says no, a lesson
     * that cannot be built without the call throws `ExamModelCallRefused`; a repeat that only
     * wanted fresh questions reuses seen ones instead.
     */
    mayCallModel?: () => Promise<boolean>;
  },
): Promise<LessonLoad | null> {
  const mayCallModel = input.mayCallModel ?? (async () => true);
  const [exam, found] = await Promise.all([
    readOwnedExam(supabase, userId, input.examId),
    readOwnedTopic(supabase, userId, input.examId, input.topicId),
  ]);

  if (!exam || !found) {
    return null;
  }

  const { data: priorRows, error: priorError } = await supabase
    .from("exam_lesson_results")
    .select("lesson_kind, item_ids")
    .eq("user_id", userId)
    .eq("exam_id", input.examId)
    .eq("topic_id", input.topicId)
    .in("lesson_kind", SEEN_GROUP[input.kind]);

  if (priorError) {
    throw priorError;
  }

  const prior = (priorRows ?? []) as Pick<ExamLessonResultRow, "lesson_kind" | "item_ids">[];
  const attempts = prior.filter((row) => row.lesson_kind === input.kind).length;
  const seen = new Set(prior.flatMap((row) => row.item_ids ?? []));
  const seed = `${input.examId}:${input.topicId}:${input.kind}:${attempts}`;
  const topic = await ensureWrittenTopic(supabase, userId, found, exam, mayCallModel);
  const generated = topic.source === "material" ? null : (topic.generated as unknown as GeneratedTopicContent | null);
  const lectureId = topic.lecture_id;

  if (input.kind === "summary") {
    const keyPoints = keyPointsOf(topic);
    let summary = topic.summary;

    if (!summary) {
      const { data } = await supabase.from("lecture_artifacts").select("summary").eq("lecture_id", lectureId).maybeSingle();
      summary = (data as { summary: string } | null)?.summary ?? "";
    }

    return {
      status: "ready",
      lesson: {
        kind: "summary",
        summary,
        keyTopics: keyPoints,
        notesMarkdown: [summary, ...keyPoints.map((point) => `- ${point}`)].filter(Boolean).join("\n\n"),
      },
    };
  }

  if (input.kind === "tutor") {
    if (!(await mayCallModel())) {
      throw new ExamModelCallRefused();
    }

    const steps = await planTutorLesson({
      userId,
      lectureId,
      topicTitle: topic.title,
      summary: topic.summary,
      keyPoints: keyPointsOf(topic),
      notesMarkdown: await readNotesMarkdown(supabase, lectureId),
      school: schoolLine(exam.school_level, exam.school_year),
      avoid: [],
    }).catch(() => []);

    return steps.length > 0
      ? { status: "ready", lesson: { kind: "tutor", lectureId, topicTitle: topic.title, steps } }
      : { status: "failed", generator: "study" };
  }

  if (input.kind === "flashcards" && generated) {
    const cards = generated.flashcards.map((card, index) => ({ id: contentId("gen", topic.id, "f", index), ...card }));

    return {
      status: "ready",
      lesson: {
        kind: "flashcards",
        cards: seededShuffle(preferUnseen(cards, seen, LESSON_SIZE.flashcards, seed), seed).slice(0, LESSON_SIZE.flashcards),
        generated: true,
      },
    };
  }

  if (!generated) {
    await ensureTopicItems(supabase, userId, {
      examId: input.examId,
      lectureId,
      group: ITEM_GROUP[input.kind],
      mayCallModel,
    });
  }

  const assigned = generated ? topic : ((await readOwnedTopic(supabase, userId, input.examId, input.topicId)) ?? topic);
  const extra = (assigned.extra as unknown as StoredFresh | null) ?? null;

  if (input.kind === "flashcards") {
    const { data, error } = await supabase
      .from("flashcards")
      .select("id, front, back")
      .eq("lecture_id", lectureId)
      .order("idx", { ascending: true })
      .limit(400);

    if (error) {
      throw error;
    }

    const all = (data ?? []) as { id: string; front: string; back: string }[];

    if (all.length === 0) {
      return assetState(supabase, lectureId, GENERATOR_FOR.flashcards);
    }

    // Flashcards are memorised, so they come back by the note's own spaced repetition, not by novelty.
    const cards = topUp(all, assigned.flashcard_ids, TOPIC_POOL_MIN.flashcards, seed);
    const { data: progressRows } = await supabase
      .from("flashcard_progress")
      .select("flashcard_id, confidence_bucket, last_reviewed_at")
      .eq("user_id", userId)
      .in(
        "flashcard_id",
        cards.map((card) => card.id),
      );
    const progress = new Map(
      ((progressRows ?? []) as {
        flashcard_id: string;
        confidence_bucket: "again" | "good" | "easy";
        last_reviewed_at: string | null;
      }[]).map((row) => [row.flashcard_id, row]),
    );
    const picked = pickFlashcards(
      cards.map((card) => ({ ...card, progress: progress.get(card.id) ?? null })),
      LESSON_SIZE.flashcards,
      seed,
    );

    return {
      status: "ready",
      lesson: {
        kind: "flashcards",
        cards: picked.map((card) => ({ id: card.id, front: card.front, back: card.back })),
        generated: false,
      },
    };
  }

  if (input.kind === "quiz" || input.kind === "true_false") {
    let base: PoolQuestion[];

    if (generated) {
      base = contentQuiz("gen", topic.id, generated.quiz);
    } else {
      const { data, error } = await supabase
        .from("quiz_questions")
        .select("id, prompt, options_json, correct_option_idx, explanation")
        .eq("lecture_id", lectureId)
        .order("idx", { ascending: true })
        .limit(200);

      if (error) {
        throw error;
      }

      const all = quizRows((data ?? []) as QuizRow[]);

      if (all.length === 0) {
        return assetState(supabase, lectureId, GENERATOR_FOR[input.kind]);
      }

      base = topUp(all, assigned.quiz_ids, TOPIC_POOL_MIN.quiz, seed);
    }

    const size = LESSON_SIZE[input.kind];
    let pool = [...base, ...contentQuiz("x", topic.id, extra?.quiz)];

    if (needsFreshItems(pool, seen, size)) {
      const fresh = await topUpFresh(
        supabase,
        userId,
        exam,
        assigned,
        "quiz",
        pool.map((question) => question.prompt),
        mayCallModel,
      );
      pool = [...base, ...contentQuiz("x", topic.id, fresh.quiz)];
    }

    const questions = preferUnseen(pool, seen, size, seed);

    return input.kind === "quiz"
      ? { status: "ready", lesson: { kind: "quiz", questions: pickQuiz(questions, size, seed) } }
      : { status: "ready", lesson: { kind: "true_false", statements: buildTrueFalse(questions, size, seed) } };
  }

  let base: { id: string; prompt: string; importance: number | null }[];

  if (generated) {
    base = contentWritten("gen", topic.id, generated.written);
  } else {
    const { data, error } = await supabase
      .from("practice_test_questions")
      .select("id, prompt, importance")
      .eq("lecture_id", lectureId)
      .limit(400);

    if (error) {
      throw error;
    }

    const all = (data ?? []) as { id: string; prompt: string; importance: number | null }[];

    if (all.length === 0) {
      return assetState(supabase, lectureId, GENERATOR_FOR.written);
    }

    base = topUp(all, assigned.written_ids, TOPIC_POOL_MIN.written, seed);
  }

  let pool = [...base, ...contentWritten("x", topic.id, extra?.written)];

  if (needsFreshItems(pool, seen, LESSON_SIZE.written)) {
    const fresh = await topUpFresh(
      supabase,
      userId,
      exam,
      assigned,
      "written",
      pool.map((question) => question.prompt),
      mayCallModel,
    );
    pool = [...base, ...contentWritten("x", topic.id, fresh.written)];
  }

  const [question] = pickWritten(preferUnseen(pool, seen, LESSON_SIZE.written, seed), LESSON_SIZE.written, seed);

  return {
    status: "ready",
    lesson: {
      kind: "written",
      questions: question ? [{ id: question.id, prompt: question.prompt }] : [],
      generated: Boolean(question && parseContentId(question.id)),
    },
  };
}

/** Marks an answer to a written question of a topic outside the material, like the note's test does. */
export async function gradeTopicWritten(
  supabase: ExamSupabase,
  userId: string,
  input: { examId: string; topicId: string; questionId: string; typedAnswer: string; declaredUnknown: boolean },
) {
  const topic = await readOwnedTopic(supabase, userId, input.examId, input.topicId);
  const ref = parseContentId(input.questionId);
  const content =
    ref && topic && ref.topicId === topic.id && ref.kind === "w"
      ? ((ref.origin === "gen" ? topic.generated : topic.extra) as unknown as StoredFresh | null)
      : null;
  const question = ref ? content?.written?.find((entry, index) => serialOf(entry, index) === ref.index) : undefined;

  if (!question) {
    return null;
  }

  const text = input.typedAnswer.trim();
  const base = { maxScore: PRACTICE_QUESTION_MAX_SCORE, expectedAnswer: question.answerGuide, strengths: "", missingPoints: "" };

  if (input.declaredUnknown || isBlankAnswer(text) || isSurrenderAnswer(text)) {
    return { ...base, marked: true, score: 0 };
  }

  const marked = await markAnswerWithRetry({ prompt: question.prompt, answerGuide: question.answerGuide, typedAnswer: text });

  return marked
    ? {
        ...base,
        marked: true,
        score: marked.score,
        expectedAnswer: marked.expectedAnswer,
        strengths: marked.strengths,
        missingPoints: marked.missingPoints,
      }
    : { ...base, marked: false };
}

/* ---------------------------------------------------------------- mock exam */

type MockQuestion =
  | {
      id: string;
      lectureId: string;
      kind: "choice";
      prompt: string;
      options: string[];
      correctIndex: number;
      explanation: string;
    }
  | {
      id: string;
      lectureId: string;
      kind: "written";
      prompt: string;
      answerGuide: string;
    };

/** What the learner sees while sitting the mock: no answers, no marking scheme. */
export type MockQuestionForLearner =
  | { id: string; kind: "choice"; prompt: string; options: string[] }
  | { id: string; kind: "written"; prompt: string };

export type MockAnswerInput = {
  questionId: string;
  selected?: number | null;
  text?: string;
  unknown?: boolean;
};

export type MockGradedAnswer = MockAnswerInput & {
  score: number;
  maxScore: number;
  marked: boolean;
  strengths: string;
  missingPoints: string;
  expectedAnswer: string;
};

function forLearner(question: MockQuestion): MockQuestionForLearner {
  return question.kind === "choice"
    ? { id: question.id, kind: "choice", prompt: question.prompt, options: question.options }
    : { id: question.id, kind: "written", prompt: question.prompt };
}

export async function startMockExam(
  supabase: ExamSupabase,
  userId: string,
  input: {
    examId: string;
    durationMinutes: number;
    mode?: "written" | "oral";
    voice?: string | null;
    vibe?: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const mode = input.mode ?? "written";
  const { lectureIds } = await readModules(supabase, userId, input.examId);

  if (lectureIds.length === 0) {
    return { error: "no_notes" as const };
  }

  const [results, topics] = await Promise.all([
    readResults(supabase, userId, [input.examId]),
    readTopicLines(supabase, userId, [input.examId]),
  ]);
  const states = examModuleStates(orderModules(lectureIds, topics), results, 1, null, now);
  // A note's mastery is the average of its topics'; the mock leans on the weakest notes.
  const noteMastery = (lectureId: string) => {
    const own = states.filter((state) => state.lectureId === lectureId);
    return own.reduce((sum, state) => sum + state.mastery, 0) / Math.max(1, own.length);
  };
  const weakestFirst = [...lectureIds].sort((left, right) => noteMastery(left) - noteMastery(right));
  const seed = `${input.examId}:mock:${now.toISOString()}`;
  // Every question of every note: a single select would stop at PostgREST's 1000 rows.
  const [quizData, writtenData] = await Promise.all([
    loadEveryRow<QuizRow & { lecture_id: string }>((from, to) =>
      supabase
        .from("quiz_questions")
        .select("id, lecture_id, prompt, options_json, correct_option_idx, explanation")
        .in("lecture_id", lectureIds)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    loadEveryRow<{ id: string; lecture_id: string; prompt: string; answer_guide: string; importance: number | null }>(
      (from, to) =>
        supabase
          .from("practice_test_questions")
          .select("id, lecture_id, prompt, answer_guide, importance")
          .in("lecture_id", lectureIds)
          .order("id", { ascending: true })
          .range(from, to),
    ),
  ]);

  const counts = mockQuestionCounts(input.durationMinutes);
  const choicePools = new Map<string, MockQuestion[]>();
  const writtenPools = new Map<string, MockQuestion[]>();

  for (const lectureId of lectureIds) {
    const quiz = quizRows(quizData.filter((row) => row.lecture_id === lectureId)).filter(
      (question) => question.options.length >= 2,
    );
    choicePools.set(
      lectureId,
      seededShuffle(quiz, `${seed}:${lectureId}:choice`).map((question) => {
        const shuffled = shuffleQuestion(question, seed);

        return {
          id: shuffled.id,
          lectureId,
          kind: "choice" as const,
          prompt: shuffled.prompt,
          options: shuffled.options,
          correctIndex: shuffled.correctIndex,
          explanation: shuffled.explanation,
        };
      }),
    );

    const written = writtenData.filter((row) => row.lecture_id === lectureId && row.answer_guide.trim().length > 0);
    writtenPools.set(
      lectureId,
      pickWritten(written, written.length, `${seed}:${lectureId}`).map((row) => ({
        id: row.id,
        lectureId,
        kind: "written" as const,
        prompt: row.prompt,
        answerGuide: row.answer_guide,
      })),
    );
  }

  /*
   * The notes' own banks first, then the questions written for topics outside the material, then,
   * only if the time the learner set is still not filled, questions written for this mock from
   * the notes, so a 45-minute mock really is 45 minutes of questions.
   */
  const { data: topicRows, error: topicError } = await supabase
    .from("exam_topics")
    .select("id, lecture_id, generated, extra")
    .eq("exam_id", input.examId)
    .eq("user_id", userId);

  if (topicError) {
    throw topicError;
  }

  for (const topic of (topicRows ?? []) as Pick<ExamTopicRow, "id" | "lecture_id" | "generated" | "extra">[]) {
    for (const origin of ["gen", "x"] as const) {
      const content = (origin === "gen" ? topic.generated : topic.extra) as unknown as StoredFresh | null;

      if (!content) {
        continue;
      }

      choicePools.get(topic.lecture_id)?.push(
        ...contentQuiz(origin, topic.id, content.quiz).map((question) => {
          const shuffled = shuffleQuestion(question, seed);

          return {
            id: shuffled.id,
            lectureId: topic.lecture_id,
            kind: "choice" as const,
            prompt: shuffled.prompt,
            options: shuffled.options,
            correctIndex: shuffled.correctIndex,
            explanation: shuffled.explanation,
          };
        }),
      );
      writtenPools.get(topic.lecture_id)?.push(
        ...(content.written ?? []).map((question, index) => ({
          id: contentId(origin, topic.id, "w", serialOf(question, index)),
          lectureId: topic.lecture_id,
          kind: "written" as const,
          prompt: question.prompt,
          answerGuide: question.answerGuide,
        })),
      );
    }
  }

  /*
   * A mock tests what the learner can do with questions they have not practised: whatever they
   * were shown in a lesson is held back, and the time is filled with unseen questions, written for
   * this mock where the banks run short. The practised ones come back only if that writing fails.
   */
  const practised = new Set(results.flatMap((row) => row.item_ids ?? []));
  const heldBack = new Map<Map<string, MockQuestion[]>, Map<string, MockQuestion[]>>();

  for (const pools of [choicePools, writtenPools]) {
    const held = new Map<string, MockQuestion[]>();

    for (const [lectureId, pool] of pools) {
      held.set(lectureId, pool.filter((question) => practised.has(question.id)));
      pools.set(lectureId, pool.filter((question) => !practised.has(question.id)));
    }

    heldBack.set(pools, held);
  }

  const poolSize = (pools: Map<string, MockQuestion[]>) =>
    [...pools.values()].reduce((sum, pool) => sum + pool.length, 0);
  const missingChoice = mode === "oral" ? 0 : Math.max(0, counts.choice - poolSize(choicePools));
  const missingWritten =
    mode === "oral"
      ? Math.max(0, oralQuestionCount(input.durationMinutes) - poolSize(writtenPools) - poolSize(choicePools))
      : Math.max(0, counts.written - poolSize(writtenPools));

  if (missingChoice + missingWritten > 0) {
    const [exam, { data: noteRows }, { data: artifactRows }] = await Promise.all([
      readOwnedExam(supabase, userId, input.examId),
      supabase.from("lectures").select("id, title").in("id", lectureIds),
      supabase.from("lecture_artifacts").select("lecture_id, structured_notes_md").in("lecture_id", lectureIds),
    ]);
    const titles = new Map(((noteRows ?? []) as { id: string; title: string | null }[]).map((row) => [row.id, row.title]));
    const notes = new Map(
      ((artifactRows ?? []) as { lecture_id: string; structured_notes_md: string | null }[]).map((row) => [
        row.lecture_id,
        row.structured_notes_md ?? "",
      ]),
    );
    const sources = lectureIds.filter((lectureId) => (notes.get(lectureId) ?? "").trim().length > 0);
    const extra = await writeMockQuestions({
      userId,
      notes: sources.map((lectureId) => ({ title: titles.get(lectureId) ?? "", notesMarkdown: notes.get(lectureId) ?? "" })),
      choice: missingChoice,
      written: missingWritten,
      avoid: [...choicePools.values(), ...writtenPools.values()].flat().map((question) => question.prompt),
      school: schoolLine(exam?.school_level ?? null, exam?.school_year ?? null),
    });

    extra.forEach((question, index) => {
      const lectureId = sources[question.noteIndex];

      if (question.kind === "choice") {
        choicePools.get(lectureId)?.push({
          id: `gen:mock:${now.getTime()}:${index}`,
          lectureId,
          kind: "choice",
          prompt: question.prompt,
          options: question.options,
          correctIndex: question.correctIndex,
          explanation: question.explanation,
        });
      } else {
        writtenPools.get(lectureId)?.push({
          id: `gen:mock:${now.getTime()}:${index}`,
          lectureId,
          kind: "written",
          prompt: question.prompt,
          answerGuide: question.answerGuide,
        });
      }
    });
  }

  for (const [pools, held] of heldBack) {
    for (const [lectureId, questions] of held) {
      pools.get(lectureId)?.push(...questions);
    }
  }

  /*
   * An oral mock is all open questions, as an examiner asks them: the notes' written questions
   * first, then quiz questions asked openly, marked against their right answer and explanation.
   */
  const oralPools = new Map<string, MockQuestion[]>(
    lectureIds.map((lectureId) => [
      lectureId,
      [
        ...(writtenPools.get(lectureId) ?? []),
        ...(choicePools.get(lectureId) ?? []).flatMap((question): MockQuestion[] =>
          question.kind === "choice"
            ? [
                {
                  id: question.id,
                  lectureId,
                  kind: "written",
                  prompt: question.prompt,
                  answerGuide: [`- ${question.options[question.correctIndex]}`, question.explanation ? `- ${question.explanation}` : ""]
                    .filter(Boolean)
                    .join("\n"),
                },
              ]
            : [],
        ),
      ],
    ]),
  );
  const questions =
    mode === "oral"
      ? spreadAcrossModules(oralPools, weakestFirst, oralQuestionCount(input.durationMinutes))
      : [
          ...spreadAcrossModules(choicePools, weakestFirst, counts.choice),
          ...spreadAcrossModules(writtenPools, weakestFirst, counts.written),
        ];

  if (questions.length === 0) {
    return { error: "no_questions" as const };
  }

  const { data, error } = await supabase
    .from("exam_mock_attempts")
    .insert({
      exam_id: input.examId,
      user_id: userId,
      duration_minutes: input.durationMinutes,
      mode,
      voice: mode === "oral" ? (input.voice ?? null) : null,
      vibe: mode === "oral" ? (input.vibe ?? "strict") : null,
      questions,
    } as never)
    .select("id, started_at")
    .single();

  if (error) {
    throw error;
  }

  const attempt = data as { id: string; started_at: string };

  return {
    attempt: {
      id: attempt.id,
      startedAt: attempt.started_at,
      durationMinutes: input.durationMinutes,
      mode,
      questions: questions.map(forLearner),
      /* The oral examiner speaks through one of the exam's notes' tutor sessions. */
      lectureId: weakestFirst[0],
    },
  };
}

/*
 * How long after its clock runs out a mock still takes examiner turns and a hand-in: the oral
 * examiner's clock starts when the learner is ready, not when the attempt was made, and a hand-in
 * can be retried after a failed grading. Past this the attempt is closed for good.
 */
const MOCK_GRACE_MINUTES = 30;

export function mockAttemptExpired(
  attempt: Pick<ExamMockAttemptRow, "started_at" | "duration_minutes">,
  now = new Date(),
) {
  return now.getTime() > Date.parse(attempt.started_at) + (attempt.duration_minutes + MOCK_GRACE_MINUTES) * 60_000;
}

/** Closes an attempt that ran out of time without being handed in, so it stops counting as open. */
export async function expireMockAttempt(supabase: ExamSupabase, userId: string, attemptId: string) {
  const { error } = await supabase
    .from("exam_mock_attempts")
    .update({ status: "failed" } as never)
    .eq("id", attemptId)
    .eq("user_id", userId)
    .eq("status", "in_progress");

  if (error) {
    throw error;
  }
}

export async function readMockAttempt(
  supabase: ExamSupabase,
  userId: string,
  examId: string,
  attemptId: string,
) {
  const { data, error } = await supabase
    .from("exam_mock_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("exam_id", examId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ExamMockAttemptRow | null;
}

export type MockReviewItem = {
  question: MockQuestionForLearner & { lectureId: string };
  answer: MockGradedAnswer;
  correctIndex: number | null;
  explanation: string;
};

export type MockResult = {
  attemptId: string;
  percentage: number;
  totalScore: number;
  maxScore: number;
  grade: string;
  passed: boolean;
  minutesUsed: number;
  mode: ExamMockAttemptRow["mode"];
  durationMinutes: number;
  strengths: string[];
  weakPoints: string[];
  weakestLectureId: string | null;
  items: MockReviewItem[];
};

export function mockResultFromAttempt(exam: ExamRow, attempt: ExamMockAttemptRow): MockResult | null {
  if (attempt.status !== "graded" || attempt.percentage === null) {
    return null;
  }

  const questions = (attempt.questions ?? []) as MockQuestion[];
  const answers = (attempt.answers ?? []) as MockGradedAnswer[];
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const items = questions.map((question) => {
    const answer =
      byQuestion.get(question.id) ??
      ({
        questionId: question.id,
        score: 0,
        maxScore: question.kind === "choice" ? 1 : PRACTICE_QUESTION_MAX_SCORE,
        marked: true,
        strengths: "",
        missingPoints: "",
        expectedAnswer: "",
      } satisfies MockGradedAnswer);

    return {
      question: { ...forLearner(question), lectureId: question.lectureId },
      answer,
      correctIndex: question.kind === "choice" ? question.correctIndex : null,
      explanation: question.kind === "choice" ? question.explanation : answer.expectedAnswer,
    };
  });
  const summary = summarizeMock(
    items
      .filter((item) => item.answer.marked)
      .map((item) => ({
        questionId: item.question.id,
        lectureId: item.question.lectureId,
        kind: item.question.kind,
        score: item.answer.score,
        maxScore: item.answer.maxScore,
        strengths: item.answer.strengths,
        missingPoints: item.answer.missingPoints,
      })),
  );
  const minutesUsed = attempt.submitted_at
    ? Math.max(
        1,
        Math.round(
          (new Date(attempt.submitted_at).getTime() - new Date(attempt.started_at).getTime()) / 60_000,
        ),
      )
    : attempt.duration_minutes;

  return {
    attemptId: attempt.id,
    percentage: attempt.percentage,
    totalScore: attempt.total_score ?? summary.totalScore,
    maxScore: attempt.max_score ?? summary.maxScore,
    grade: gradeForPercentage(exam.grading_scale, attempt.percentage, exam.pass_percentage),
    passed: attempt.percentage >= exam.pass_percentage,
    minutesUsed: Math.min(minutesUsed, attempt.duration_minutes),
    mode: attempt.mode,
    durationMinutes: attempt.duration_minutes,
    strengths: summary.strengths,
    weakPoints: summary.weakPoints,
    weakestLectureId: summary.weakestLectureId,
    items,
  };
}

async function gradeWritten(question: Extract<MockQuestion, { kind: "written" }>, answer: MockAnswerInput) {
  const text = (answer.text ?? "").trim();
  const base = {
    ...answer,
    maxScore: PRACTICE_QUESTION_MAX_SCORE,
    strengths: "",
    missingPoints: "",
    expectedAnswer: question.answerGuide,
  };

  if (answer.unknown || isBlankAnswer(text) || isSurrenderAnswer(text)) {
    return { ...base, score: 0, marked: true };
  }

  const marked = await markAnswerWithRetry({
    prompt: question.prompt,
    answerGuide: question.answerGuide,
    typedAnswer: text,
  });

  if (!marked) {
    // Unmarkable answers are left out of the total rather than scored zero.
    return { ...base, score: 0, maxScore: 0, marked: false };
  }

  return {
    ...base,
    score: marked.score,
    marked: true,
    strengths: marked.strengths,
    missingPoints: marked.missingPoints,
    expectedAnswer: marked.expectedAnswer,
  };
}

export async function submitMockExam(
  supabase: ExamSupabase,
  userId: string,
  input: { exam: ExamRow; attempt: ExamMockAttemptRow; answers: MockAnswerInput[] },
) {
  const questions = (input.attempt.questions ?? []) as MockQuestion[];
  const byQuestion = new Map(input.answers.map((answer) => [answer.questionId, answer]));
  const submittedAt = new Date().toISOString();

  const graded: MockGradedAnswer[] = await Promise.all(
    questions.map(async (question) => {
      const answer = byQuestion.get(question.id) ?? { questionId: question.id };

      if (question.kind === "choice") {
        const right = !answer.unknown && answer.selected === question.correctIndex;

        return {
          ...answer,
          questionId: question.id,
          score: right ? 1 : 0,
          maxScore: 1,
          marked: true,
          strengths: "",
          missingPoints: "",
          expectedAnswer: question.options[question.correctIndex] ?? "",
        };
      }

      return gradeWritten(question, { ...answer, questionId: question.id });
    }),
  );

  const scored: MockAnswerResult[] = graded
    .filter((answer) => answer.marked)
    .map((answer) => {
      const question = questions.find((entry) => entry.id === answer.questionId)!;

      return {
        questionId: answer.questionId,
        lectureId: question.lectureId,
        kind: question.kind,
        score: answer.score,
        maxScore: answer.maxScore,
        strengths: answer.strengths,
        missingPoints: answer.missingPoints,
      };
    });
  const summary = summarizeMock(scored);
  const { data, error } = await supabase
    .from("exam_mock_attempts")
    .update({
      status: "graded",
      answers: graded,
      total_score: summary.totalScore,
      max_score: summary.maxScore,
      percentage: Math.round(summary.percentage * 10) / 10,
      review: { strengths: summary.strengths, weakPoints: summary.weakPoints },
      time_spent_seconds: Math.max(
        0,
        Math.round((Date.parse(submittedAt) - Date.parse(input.attempt.started_at)) / 1000),
      ),
      submitted_at: submittedAt,
      graded_at: new Date().toISOString(),
    } as never)
    .eq("id", input.attempt.id)
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  const saved = data as ExamMockAttemptRow | null;

  return saved ? mockResultFromAttempt(input.exam, saved) : null;
}

