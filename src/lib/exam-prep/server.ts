import "server-only";

import { PREVIEW_AUTH_BYPASS_USER_ID } from "@/lib/auth";
import { loadEveryRow } from "@/lib/admin/paged-rows";
import { getUserEntitlementState } from "@/lib/billing";
import type {
  ExamPlanRow,
  FlashcardConfidenceBucket,
  StudyEventItemKind,
} from "@/lib/database.types";
import {
  buildMaterialNote,
  legacyProgressEvents,
  settingsFromRow,
  sortSummaries,
  summarizeJourney,
} from "@/lib/exam-prep/build";
import { buildExamJourney } from "@/lib/exam-prep/journey";
import type {
  ExamEvidence,
  ExamMaterialNote,
  ExamPlanPayload,
  ExamPlanSummary,
  StudyEvent,
} from "@/lib/exam-prep/model";
import type { CreateExamPlanInput, UpdateExamPlanInput } from "@/lib/exam-prep/schema";
import { getTranslations } from "@/lib/i18n/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/*
 * Every read and write here goes through the service-role client with the
 * learner's id written into the query, after the route has verified who the
 * learner is — the same pattern as `listLecturesForUser`. The tables also carry
 * owner-only RLS, so a mistake here would fail closed for a user client.
 */

type ServiceClient = ReturnType<typeof createSupabaseServiceRoleClient>;

export function isExamPrepUnavailableForUser(userId: string) {
  // The preview bypass account is fabricated: it has no auth.users row for a
  // plan to belong to. The /creator demo shows the feature without an account.
  return userId === PREVIEW_AUTH_BYPASS_USER_ID;
}

/** Ids go into the request URL, so a long list is asked for in slices. */
const ID_CHUNK = 150;

async function loadInChunks<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>) {
  const rows: T[] = [];

  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    rows.push(...(await load(ids.slice(index, index + ID_CHUNK))));
  }

  return rows;
}

async function loadPlanRow(service: ServiceClient, userId: string, planId: string) {
  const { data, error } = await service
    .from("exam_plans")
    .select("*")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ExamPlanRow | null;
}

async function loadPlanLectureIds(service: ServiceClient, planIds: string[]) {
  const map = new Map<string, string[]>();

  if (planIds.length === 0) {
    return map;
  }

  const { data, error } = await service
    .from("exam_plan_lectures")
    .select("plan_id, lecture_id, created_at")
    .in("plan_id", planIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as Array<{ plan_id: string; lecture_id: string }>) {
    const list = map.get(row.plan_id) ?? [];
    list.push(row.lecture_id);
    map.set(row.plan_id, list);
  }

  return map;
}

/** The notes behind a plan, in the order they were added, as the journey reads them. */
async function loadMaterial(
  service: ServiceClient,
  userId: string,
  lectureIds: string[],
  untitled: string,
): Promise<{ notes: ExamMaterialNote[]; cardLecture: Map<string, string> }> {
  if (lectureIds.length === 0) {
    return { notes: [], cardLecture: new Map() };
  }

  const [lectures, artifacts, sections, flashcards, quiz, practice] = await Promise.all([
    service
      .from("lectures")
      .select("id, title, source_type, status")
      .eq("user_id", userId)
      .in("id", lectureIds),
    service
      .from("lecture_artifacts")
      .select("lecture_id, structured_notes_md")
      .in("lecture_id", lectureIds),
    loadEveryRow<{ id: string; lecture_id: string; idx: number; title: string }>((from, to) =>
      service
        .from("lecture_study_sections")
        .select("id, lecture_id, idx, title")
        .in("lecture_id", lectureIds)
        .order("lecture_id")
        .order("idx")
        .order("id")
        .range(from, to),
    ),
    loadEveryRow<{ id: string; lecture_id: string; idx: number; section_id: string | null }>(
      (from, to) =>
        service
          .from("flashcards")
          .select("id, lecture_id, idx, section_id")
          .in("lecture_id", lectureIds)
          .order("lecture_id")
          .order("idx")
          .order("id")
          .range(from, to),
    ),
    loadEveryRow<{ id: string; lecture_id: string }>((from, to) =>
      service
        .from("quiz_questions")
        .select("id, lecture_id")
        .in("lecture_id", lectureIds)
        .order("lecture_id")
        .order("idx")
        .order("id")
        .range(from, to),
    ),
    loadEveryRow<{ id: string; lecture_id: string }>((from, to) =>
      service
        .from("practice_test_questions")
        .select("id, lecture_id")
        .in("lecture_id", lectureIds)
        .order("lecture_id")
        .order("idx")
        .order("id")
        .range(from, to),
    ),
  ]);

  if (lectures.error) {
    throw new Error(lectures.error.message);
  }

  if (artifacts.error) {
    throw new Error(artifacts.error.message);
  }

  const lectureRows = (lectures.data ?? []) as Array<{
    id: string;
    title: string | null;
    source_type: string | null;
    status: string;
  }>;
  const notesByLecture = new Map(
    ((artifacts.data ?? []) as Array<{ lecture_id: string; structured_notes_md: string | null }>).map(
      (row) => [row.lecture_id, row.structured_notes_md],
    ),
  );
  const cardLecture = new Map(flashcards.map((card) => [card.id, card.lecture_id]));
  const byId = new Map(lectureRows.map((row) => [row.id, row]));

  const notes = lectureIds
    .map((lectureId) => byId.get(lectureId))
    .filter((lecture): lecture is NonNullable<typeof lecture> => Boolean(lecture))
    .map((lecture) =>
      buildMaterialNote({
        lecture,
        sections: sections.filter((section) => section.lecture_id === lecture.id),
        flashcards: flashcards.filter((card) => card.lecture_id === lecture.id),
        quizQuestionIds: quiz.filter((row) => row.lecture_id === lecture.id).map((row) => row.id),
        practiceQuestionIds: practice
          .filter((row) => row.lecture_id === lecture.id)
          .map((row) => row.id),
        notesMarkdown: notesByLecture.get(lecture.id) ?? null,
        untitled,
      }),
    );

  return { notes, cardLecture };
}

async function loadEvidence(
  service: ServiceClient,
  userId: string,
  planId: string,
  lectureIds: string[],
  cardLecture: Map<string, string>,
): Promise<ExamEvidence> {
  if (lectureIds.length === 0) {
    return { events: [], practiceAnswers: [], checks: [] };
  }

  const cardIds = [...cardLecture.keys()];
  const [events, attempts, checks, progress] = await Promise.all([
    loadEveryRow<{
      lecture_id: string;
      item_kind: StudyEventItemKind;
      item_id: string;
      outcome: number;
      created_at: string;
      id: number;
    }>((from, to) =>
      service
        .from("study_events")
        .select("id, lecture_id, item_kind, item_id, outcome, created_at")
        .eq("user_id", userId)
        .in("lecture_id", lectureIds)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    loadEveryRow<{ id: string; lecture_id: string; graded_at: string | null; created_at: string }>(
      (from, to) =>
        service
          .from("practice_test_attempts")
          .select("id, lecture_id, graded_at, created_at")
          .eq("user_id", userId)
          .eq("status", "graded")
          .in("lecture_id", lectureIds)
          .order("created_at")
          .order("id")
          .range(from, to),
    ),
    service
      .from("exam_plan_task_checks")
      .select("day, task_key")
      .eq("plan_id", planId)
      .eq("user_id", userId),
    loadInChunks(cardIds, (chunk) =>
      loadEveryRow<{
        flashcard_id: string;
        confidence_bucket: FlashcardConfidenceBucket;
        review_count: number;
        last_reviewed_at: string | null;
      }>((from, to) =>
        service
          .from("flashcard_progress")
          .select("flashcard_id, confidence_bucket, review_count, last_reviewed_at")
          .eq("user_id", userId)
          .in("flashcard_id", chunk)
          .order("flashcard_id")
          .range(from, to),
      ),
    ),
  ]);

  if (checks.error) {
    throw new Error(checks.error.message);
  }

  const attemptIds = attempts.map((attempt) => attempt.id);
  const answers = await loadInChunks(attemptIds, (chunk) =>
    loadEveryRow<{
      attempt_id: string;
      practice_test_question_id: string | null;
      score: number | null;
      idx: number;
    }>((from, to) =>
      service
        .from("practice_test_attempt_answers")
        .select("attempt_id, practice_test_question_id, score, idx")
        .in("attempt_id", chunk)
        .order("attempt_id")
        .order("idx")
        .range(from, to),
    ),
  );
  const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));

  const studyEvents: StudyEvent[] = events.map((event) => ({
    lectureId: event.lecture_id,
    kind: event.item_kind,
    itemId: event.item_id,
    outcome: Math.min(4, Math.max(1, event.outcome)) as StudyEvent["outcome"],
    atMs: Date.parse(event.created_at),
  }));

  return {
    events: [...legacyProgressEvents(progress, cardLecture, studyEvents), ...studyEvents],
    practiceAnswers: answers
      .filter((answer) => answer.score != null)
      .map((answer) => {
        const attempt = attemptById.get(answer.attempt_id);
        return {
          lectureId: attempt?.lecture_id ?? "",
          attemptId: answer.attempt_id,
          questionId: answer.practice_test_question_id,
          score: Number(answer.score) / 5,
          atMs: Date.parse(attempt?.graded_at ?? attempt?.created_at ?? ""),
        };
      })
      .filter((answer) => answer.lectureId && Number.isFinite(answer.atMs)),
    checks: ((checks.data ?? []) as Array<{ day: string; task_key: string }>).map((check) => ({
      day: check.day.slice(0, 10),
      taskKey: check.task_key,
    })),
  };
}

async function buildPayload(
  service: ServiceClient,
  userId: string,
  row: ExamPlanRow,
  lectureIds: string[],
  nowMs: number,
): Promise<ExamPlanPayload> {
  const { locale, t } = await getTranslations();
  const settings = settingsFromRow(row);
  const { notes, cardLecture } = await loadMaterial(service, userId, lectureIds, t("note.untitled"));
  const evidence = await loadEvidence(service, userId, row.id, lectureIds, cardLecture);
  const journey = buildExamJourney({ settings, notes, evidence, nowMs, locale });

  return {
    plan: { ...settings, lectureIds: notes.map((note) => note.lectureId) },
    journey,
  };
}

export async function getExamPlanPayload(userId: string, planId: string) {
  const service = createSupabaseServiceRoleClient();
  const row = await loadPlanRow(service, userId, planId);

  if (!row) {
    return null;
  }

  const lectureIds = (await loadPlanLectureIds(service, [row.id])).get(row.id) ?? [];
  return buildPayload(service, userId, row, lectureIds, Date.now());
}

/** Just the rows, for screens that only need titles and dates. */
export async function listExamPlanRows(userId: string) {
  if (isExamPrepUnavailableForUser(userId)) {
    return [];
  }

  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service
    .from("exam_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("exam_date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ExamPlanRow[];
}

export async function listExamPlanSummaries(userId: string): Promise<ExamPlanSummary[]> {
  const rows = await listExamPlanRows(userId);

  if (rows.length === 0) {
    return [];
  }

  const service = createSupabaseServiceRoleClient();
  const lectureIds = await loadPlanLectureIds(
    service,
    rows.map((row) => row.id),
  );
  const nowMs = Date.now();
  const payloads = await Promise.all(
    rows.map((row) => buildPayload(service, userId, row, lectureIds.get(row.id) ?? [], nowMs)),
  );

  return sortSummaries(payloads.map((payload) => summarizeJourney(payload.plan, payload.journey)));
}

export type LectureAccessCheck =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "billing" };

/** Every note must be the learner's own, and open to them on their plan. */
export async function checkExamLectures(
  userId: string,
  lectureIds: string[],
): Promise<LectureAccessCheck> {
  const unique = [...new Set(lectureIds)];
  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service
    .from("lectures")
    .select("id")
    .eq("user_id", userId)
    .in("id", unique);

  if (error) {
    throw new Error(error.message);
  }

  if ((data ?? []).length !== unique.length) {
    return { ok: false, reason: "not_found" };
  }

  const entitlement = await getUserEntitlementState(userId);

  if (
    !entitlement.hasPaidAccess &&
    unique.some((lectureId) => lectureId !== entitlement.trialLectureId)
  ) {
    return { ok: false, reason: "billing" };
  }

  return { ok: true };
}

export async function createExamPlan(userId: string, input: CreateExamPlanInput) {
  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service
    .from("exam_plans")
    .insert({
      user_id: userId,
      title: input.title,
      exam_date: input.examDate,
      exam_type: input.examType,
      grade_scale: input.gradeScale,
      target_grade: input.targetGrade,
      target_percent: input.targetPercent,
      daily_minutes: input.dailyMinutes,
      rest_days: input.restDays,
      time_zone: input.timeZone,
    } as never)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Exam plan was not created.");
  }

  const planId = (data as { id: string }).id;
  await replacePlanLectures(service, userId, planId, input.lectureIds);
  return planId;
}

async function replacePlanLectures(
  service: ServiceClient,
  userId: string,
  planId: string,
  lectureIds: string[],
) {
  const unique = [...new Set(lectureIds)];
  const { error: deleteError } = await service
    .from("exam_plan_lectures")
    .delete()
    .eq("plan_id", planId)
    .eq("user_id", userId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (unique.length === 0) {
    return;
  }

  // Inserted one after another so created_at keeps the learner's order.
  const base = Date.now();
  const { error } = await service.from("exam_plan_lectures").insert(
    unique.map((lectureId, index) => ({
      plan_id: planId,
      lecture_id: lectureId,
      user_id: userId,
      created_at: new Date(base + index).toISOString(),
    })) as never,
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateExamPlan(userId: string, planId: string, input: UpdateExamPlanInput) {
  const service = createSupabaseServiceRoleClient();
  const row = await loadPlanRow(service, userId, planId);

  if (!row) {
    return false;
  }

  const patch: Record<string, unknown> = {};
  const fields: Array<[keyof UpdateExamPlanInput, string]> = [
    ["title", "title"],
    ["examDate", "exam_date"],
    ["examType", "exam_type"],
    ["gradeScale", "grade_scale"],
    ["targetGrade", "target_grade"],
    ["targetPercent", "target_percent"],
    ["dailyMinutes", "daily_minutes"],
    ["restDays", "rest_days"],
    ["resultPercent", "result_percent"],
    ["resultGrade", "result_grade"],
  ];

  for (const [key, column] of fields) {
    if (input[key] !== undefined) {
      patch[column] = input[key];
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await service
      .from("exam_plans")
      .update(patch as never)
      .eq("id", planId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (input.lectureIds) {
    await replacePlanLectures(service, userId, planId, input.lectureIds);
  }

  return true;
}

export async function deleteExamPlan(userId: string, planId: string) {
  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service
    .from("exam_plans")
    .delete()
    .eq("id", planId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).length > 0;
}

export async function setExamTaskCheck(
  userId: string,
  planId: string,
  check: { day: string; taskKey: string; done: boolean },
) {
  const service = createSupabaseServiceRoleClient();
  const row = await loadPlanRow(service, userId, planId);

  if (!row) {
    return false;
  }

  if (check.done) {
    const { error } = await service.from("exam_plan_task_checks").upsert(
      {
        plan_id: planId,
        user_id: userId,
        day: check.day,
        task_key: check.taskKey,
      } as never,
      { onConflict: "plan_id,day,task_key", ignoreDuplicates: true },
    );

    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await service
      .from("exam_plan_task_checks")
      .delete()
      .eq("plan_id", planId)
      .eq("user_id", userId)
      .eq("day", check.day)
      .eq("task_key", check.taskKey);

    if (error) {
      throw new Error(error.message);
    }
  }

  return true;
}

/**
 * Appends to the review log. Never fatal: losing one event costs the forecast
 * a data point, while failing the request would cost the learner their answer.
 */
export async function recordStudyEvent(event: {
  userId: string;
  lectureId: string;
  kind: StudyEventItemKind;
  itemId: string;
  outcome: number;
}) {
  if (isExamPrepUnavailableForUser(event.userId)) {
    return;
  }

  try {
    const service = createSupabaseServiceRoleClient();
    await service.from("study_events").insert({
      user_id: event.userId,
      lecture_id: event.lectureId,
      item_kind: event.kind,
      item_id: event.itemId,
      outcome: event.outcome,
    } as never);
  } catch {
    // See above.
  }
}
