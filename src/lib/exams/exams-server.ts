import "server-only";

import type {
  ExamLessonResultRow,
  ExamMockAttemptRow,
  ExamRow,
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
  type MockAnswerResult,
  type MockOutcome,
  type ModuleState,
  type TrueFalseStatement,
} from "@/lib/exams/exam-model";
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
  title: string | null;
  emoji: string | null;
  ready: boolean;
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
  const [{ data: moduleRows, error: moduleError }, results] = await Promise.all([
    supabase
      .from("exam_modules")
      .select("exam_id, lecture_id, position")
      .eq("user_id", userId)
      .in("exam_id", examIds)
      .order("position", { ascending: true }),
    readResults(supabase, userId, examIds),
  ]);

  if (moduleError) {
    throw moduleError;
  }

  const today = dayKey(now);
  const modules = (moduleRows ?? []) as { exam_id: string; lecture_id: string; position: number }[];

  return exams.map((exam) => {
    const lectureIds = modules.filter((row) => row.exam_id === exam.id).map((row) => row.lecture_id);
    const examResults = results.filter((row) => row.exam_id === exam.id);
    const states = examModuleStates(lectureIds, examResults, exam.target_mastery / 100);
    const plan = planFor(exam, states, examResults, today);

    return {
      exam,
      daysLeft: daysBetween(today, exam.exam_date),
      mastery: examMastery(states),
      moduleCount: lectureIds.length,
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
  const [{ lectureIds, lectures }, results, activeDays, mock] = await Promise.all([
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
  ]);

  const mockRow = mock.data as Pick<
    ExamMockAttemptRow,
    "id" | "percentage" | "graded_at" | "questions" | "answers"
  > | null;
  const mockOutcome = mockOutcomeFrom(mockRow);
  const target = exam.target_mastery / 100;
  const states = examModuleStates(lectureIds, results, target, mockOutcome);
  const modules = states.map((state) => {
    const lecture = lectures.get(state.lectureId);

    return {
      ...state,
      title: lecture?.title ?? null,
      emoji: lecture?.emoji ?? null,
      ready: lecture?.status === "ready",
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

  return { exam };
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
    lectureId: string;
    kind: ExamLessonKind;
    correct: number;
    total: number;
    difficulty: number | null;
  },
) {
  const score = input.total > 0 ? Math.min(1, input.correct / input.total) : 1;
  const { error } = await supabase.from("exam_lesson_results").insert({
    exam_id: input.examId,
    lecture_id: input.lectureId,
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
  | { kind: "flashcards"; cards: { id: string; front: string; back: string }[] }
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
  | { kind: "written"; questions: { id: string; prompt: string }[] };

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

export async function loadLesson(
  supabase: ExamSupabase,
  userId: string,
  input: { examId: string; lectureId: string; kind: ExamLessonKind; now?: Date },
): Promise<LessonLoad> {
  /*
   * Each try of a lesson draws its own questions, so repeating a lesson until it reaches the
   * target is new practice, not the same five questions again.
   */
  const { count: attempts, error: attemptsError } = await supabase
    .from("exam_lesson_results")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("exam_id", input.examId)
    .eq("lecture_id", input.lectureId)
    .eq("lesson_kind", input.kind);

  if (attemptsError) {
    throw attemptsError;
  }

  const seed = `${input.examId}:${input.lectureId}:${input.kind}:${attempts ?? 0}`;

  if (input.kind === "summary") {
    const { data, error } = await supabase
      .from("lecture_artifacts")
      .select("summary, key_topics, structured_notes_md")
      .eq("lecture_id", input.lectureId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const artifact = data as {
      summary: string;
      key_topics: string[];
      structured_notes_md: string;
    } | null;

    if (!artifact) {
      return { status: "missing", generator: "study" };
    }

    return {
      status: "ready",
      lesson: {
        kind: "summary",
        summary: artifact.summary,
        keyTopics: artifact.key_topics ?? [],
        notesMarkdown: artifact.structured_notes_md ?? "",
      },
    };
  }

  if (input.kind === "flashcards") {
    const { data, error } = await supabase
      .from("flashcards")
      .select("id, front, back")
      .eq("lecture_id", input.lectureId)
      .order("idx", { ascending: true })
      .limit(400);

    if (error) {
      throw error;
    }

    const cards = (data ?? []) as { id: string; front: string; back: string }[];

    if (cards.length === 0) {
      return assetState(supabase, input.lectureId, GENERATOR_FOR.flashcards);
    }

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
      },
    };
  }

  if (input.kind === "quiz" || input.kind === "true_false") {
    const { data, error } = await supabase
      .from("quiz_questions")
      .select("id, prompt, options_json, correct_option_idx, explanation")
      .eq("lecture_id", input.lectureId)
      .order("idx", { ascending: true })
      .limit(200);

    if (error) {
      throw error;
    }

    const questions = quizRows((data ?? []) as QuizRow[]);

    if (questions.length === 0) {
      return assetState(supabase, input.lectureId, GENERATOR_FOR[input.kind]);
    }

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
    .eq("lecture_id", input.lectureId)
    .limit(400);

  if (error) {
    throw error;
  }

  const written = (data ?? []) as { id: string; prompt: string; importance: number | null }[];

  if (written.length === 0) {
    return assetState(supabase, input.lectureId, GENERATOR_FOR.written);
  }

  return {
    status: "ready",
    lesson: {
      kind: "written",
      questions: pickWritten(written, LESSON_SIZE.written, seed).map((question) => ({
        id: question.id,
        prompt: question.prompt,
      })),
    },
  };
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
  input: { examId: string; durationMinutes: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const { lectureIds } = await readModules(supabase, userId, input.examId);

  if (lectureIds.length === 0) {
    return { error: "no_notes" as const };
  }

  const results = await readResults(supabase, userId, [input.examId]);
  const weakestFirst = [...examModuleStates(lectureIds, results)]
    .sort((left, right) => left.mastery - right.mastery)
    .map((state) => state.lectureId);
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

  const questions = [
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
      questions: questions.map(forLearner),
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

