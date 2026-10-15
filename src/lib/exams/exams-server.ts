import "server-only";

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
  pickFlashcards,
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
  planExpansionTopics,
  planNoteTopics,
  schoolLine,
  writeTopicContent,
  type GeneratedTopicContent,
  type PlannedTopic,
  type TopicItemGroup,
} from "@/lib/exams/exam-topics-server";
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

async function readResults(supabase: ExamSupabase, userId: string, examIds: string[]) {
  if (examIds.length === 0) {
    return [] as ExamLessonResultRow[];
  }

  const { data, error } = await supabase
    .from("exam_lesson_results")
    .select("*")
    .eq("user_id", userId)
    .in("exam_id", examIds)
    .order("completed_at", { ascending: true })
    .limit(5000);

  if (error) {
    throw error;
  }

  return (data ?? []) as ExamLessonResultRow[];
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

function planFor(exam: ExamRow, states: ModuleState[], results: ExamLessonResultRow[], today: string) {
  const resultsToday = results.filter((row) => dayKey(row.completed_at) === today);
  const firstTry = new Map<string, string>();

  for (const row of results) {
    const key = `${row.lecture_id}:${row.lesson_kind}`;

    if (!firstTry.has(key)) {
      firstTry.set(key, dayKey(row.completed_at));
    }
  }

  const untriedDoneToday = [...firstTry.values()].filter((day) => day === today).length;

  return dailyPlan({
    examDate: exam.exam_date,
    today,
    dailyMinutes: exam.daily_minutes,
    states,
    resultsToday: resultsToday.length,
    untriedDoneToday,
  });
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
    const ordered = orderModules(
      lectureIds,
      topics.filter((topic) => topic.exam_id === exam.id),
    );
    const states = examModuleStates(ordered, examResults, exam.target_mastery / 100);
    const plan = planFor(exam, states, examResults, today);

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
export async function nearestUpcomingExam(supabase: ExamSupabase, userId: string, now = new Date()) {
  const today = dayKey(now);
  const { data, error } = await supabase
    .from("exams")
    .select("id, title, exam_date")
    .eq("user_id", userId)
    .is("archived_at", null)
    .gte("exam_date", today)
    .order("exam_date", { ascending: true })
    .limit(2);

  if (error) {
    return null;
  }

  const rows = (data ?? []) as Pick<ExamRow, "id" | "title" | "exam_date">[];
  const first = rows[0];

  if (!first) {
    return null;
  }

  return {
    id: first.id,
    title: first.title,
    examDate: first.exam_date,
    daysLeft: daysBetween(today, first.exam_date),
    hasMore: rows.length > 1,
  };
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
  const ordered = orderModules(lectureIds, topics);
  const states = examModuleStates(ordered, results, target, mockOutcome);
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
    plan: planFor(exam, states, results, today),
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
 * the exam was set up, or an exam from before topics. Returns how many notes were planned.
 */
export async function planPendingTopics(supabase: ExamSupabase, userId: string, examId: string) {
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
    return 0;
  }

  const plans = await planExamTopics(supabase, userId, {
    lectureIds: missing,
    aiExpand: false,
    schoolLevel: exam.school_level,
    schoolYear: exam.school_year,
  });
  const ready = plans.filter((plan) => plan.status === "planned" && plan.topics.length > 0);

  if (ready.length > 0) {
    const { error } = await supabase.from("exam_topics").insert(
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
    );

    if (error) {
      throw error;
    }
  }

  return ready.length;
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
  },
) {
  const topic = await readOwnedTopic(supabase, userId, input.examId, input.topicId);

  if (!topic) {
    return false;
  }

  const score = input.total > 0 ? Math.min(1, input.correct / input.total) : 1;
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
      /** Written for a topic outside the material: graded through the exam, not the note's test. */
      generated: boolean;
    };

export type LessonLoad =
  | { status: "ready"; lesson: LessonPayload }
  | { status: "generating" | "missing" | "failed"; generator: LessonGenerator };

const GENERATOR_FOR: Record<Exclude<ExamLessonKind, "summary">, LessonGenerator> = {
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

const ITEM_GROUP: Record<Exclude<ExamLessonKind, "summary">, TopicItemGroup> = {
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

/** A topic the material does not cover gets its lessons written the first time one is opened. */
async function ensureWrittenTopic(supabase: ExamSupabase, userId: string, topic: ExamTopicRow, exam: ExamRow) {
  if (topic.source === "material" || topic.generated) {
    return topic;
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
  const { error } = await supabase
    .from("exam_topics")
    .update({ summary: updated.summary, key_points: updated.key_points, generated: updated.generated } as never)
    .eq("id", topic.id)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return updated;
}

/**
 * One lesson of one topic. A topic from the material draws on the note's own flashcards, quiz and
 * practice questions sorted into it (topped up from the rest of the note when it has too few); a
 * topic outside the material uses the lessons written for it. When the note has not had that kind
 * of material generated yet, the answer says which generator to start.
 */
export async function loadLesson(
  supabase: ExamSupabase,
  userId: string,
  input: { examId: string; topicId: string; kind: ExamLessonKind },
): Promise<LessonLoad | null> {
  const [exam, found] = await Promise.all([
    readOwnedExam(supabase, userId, input.examId),
    readOwnedTopic(supabase, userId, input.examId, input.topicId),
  ]);

  if (!exam || !found) {
    return null;
  }

  /*
   * Each try of a lesson draws its own questions, so repeating a lesson until it reaches the
   * target is new practice, not the same five questions again.
   */
  const { count: attempts, error: attemptsError } = await supabase
    .from("exam_lesson_results")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("exam_id", input.examId)
    .eq("topic_id", input.topicId)
    .eq("lesson_kind", input.kind);

  if (attemptsError) {
    throw attemptsError;
  }

  const seed = `${input.examId}:${input.topicId}:${input.kind}:${attempts ?? 0}`;
  const topic = await ensureWrittenTopic(supabase, userId, found, exam);
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

  if (generated) {
    if (input.kind === "flashcards") {
      const cards = generated.flashcards.map((card, index) => ({ id: `gen-${index}`, ...card }));
      return {
        status: "ready",
        lesson: {
          kind: "flashcards",
          cards: seededShuffle(cards, seed).slice(0, LESSON_SIZE.flashcards),
          generated: true,
        },
      };
    }

    if (input.kind === "quiz" || input.kind === "true_false") {
      const questions = generated.quiz.map((question, index) => ({
        id: `gen-${index}`,
        prompt: question.prompt,
        options: question.options,
        correct_option_idx: question.correctIndex,
        explanation: question.explanation,
      }));
      const quiz = pickQuiz(questions, LESSON_SIZE.quiz, seed);

      return input.kind === "quiz"
        ? { status: "ready", lesson: { kind: "quiz", questions: quiz } }
        : {
            status: "ready",
            lesson: {
              kind: "true_false",
              statements: buildTrueFalse(questions, LESSON_SIZE.true_false, seed, new Set(quiz.map((question) => question.id))),
            },
          };
    }

    return {
      status: "ready",
      lesson: {
        kind: "written",
        questions: seededShuffle(
          generated.written.map((question, index) => ({ id: `gen-${index}`, prompt: question.prompt })),
          seed,
        ).slice(0, LESSON_SIZE.written),
        generated: true,
      },
    };
  }

  await ensureTopicItems(supabase, userId, { examId: input.examId, lectureId, group: ITEM_GROUP[input.kind] });
  const assigned = (await readOwnedTopic(supabase, userId, input.examId, input.topicId)) ?? topic;

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

    const questions = topUp(all, assigned.quiz_ids, TOPIC_POOL_MIN.quiz, seed);
    const quiz = pickQuiz(questions, LESSON_SIZE.quiz, seed);

    if (input.kind === "quiz") {
      return { status: "ready", lesson: { kind: "quiz", questions: quiz } };
    }

    return {
      status: "ready",
      lesson: {
        kind: "true_false",
        statements: buildTrueFalse(
          questions,
          LESSON_SIZE.true_false,
          seed,
          new Set(quiz.map((question) => question.id)),
        ),
      },
    };
  }

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

  return {
    status: "ready",
    lesson: {
      kind: "written",
      questions: pickWritten(topUp(all, assigned.written_ids, TOPIC_POOL_MIN.written, seed), LESSON_SIZE.written, seed).map(
        (question) => ({ id: question.id, prompt: question.prompt }),
      ),
      generated: false,
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
  const generated = topic?.generated as unknown as GeneratedTopicContent | null;
  const index = Number(input.questionId.replace(/^gen-/, ""));
  const question = generated?.written[index];

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
  const states = examModuleStates(orderModules(lectureIds, topics), results);
  // A note's mastery is the average of its topics'; the mock leans on the weakest notes.
  const noteMastery = (lectureId: string) => {
    const own = states.filter((state) => state.lectureId === lectureId);
    return own.reduce((sum, state) => sum + state.mastery, 0) / Math.max(1, own.length);
  };
  const weakestFirst = [...lectureIds].sort((left, right) => noteMastery(left) - noteMastery(right));
  const seed = `${input.examId}:mock:${now.toISOString()}`;
  const [{ data: quizData, error: quizError }, { data: writtenData, error: writtenError }] =
    await Promise.all([
      supabase
        .from("quiz_questions")
        .select("id, lecture_id, prompt, options_json, correct_option_idx, explanation")
        .in("lecture_id", lectureIds)
        .limit(2000),
      supabase
        .from("practice_test_questions")
        .select("id, lecture_id, prompt, answer_guide, importance")
        .in("lecture_id", lectureIds)
        .limit(2000),
    ]);

  if (quizError || writtenError) {
    throw quizError ?? writtenError;
  }

  const counts = mockQuestionCounts(input.durationMinutes);
  const choicePools = new Map<string, MockQuestion[]>();
  const writtenPools = new Map<string, MockQuestion[]>();

  for (const lectureId of lectureIds) {
    const quiz = quizRows(
      ((quizData ?? []) as (QuizRow & { lecture_id: string })[]).filter(
        (row) => row.lecture_id === lectureId,
      ),
    ).filter((question) => question.options.length >= 2);
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

    const written = (
      (writtenData ?? []) as {
        id: string;
        lecture_id: string;
        prompt: string;
        answer_guide: string;
        importance: number | null;
      }[]
    ).filter((row) => row.lecture_id === lectureId && row.answer_guide.trim().length > 0);
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

