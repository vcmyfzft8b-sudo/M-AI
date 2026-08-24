import "server-only";

import type {
  LectureQuizAssetRow,
  LectureRow,
  QuizQuestionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import { TRANSCRIPT_SEGMENT_CONTENT_SELECT } from "@/lib/database-selects";
import { extractLearningPoints } from "@/lib/generation/learning-points";
import { writeQuizQuestions, QUIZ_PIPELINE_VERSION } from "@/lib/generation/quiz-questions";
import { buildSourceDocument } from "@/lib/generation/source";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: string; details?: string | null; hint?: string | null };
    const parts = [candidate.message, candidate.details, candidate.hint].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown quiz generation error.";
}

async function setQuizAssetStatus(params: {
  lectureId: string;
  status: LectureQuizAssetRow["status"];
  errorMessage?: string | null;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();

  const { error } = await supabase.from("lecture_quiz_assets").upsert(
    {
      lecture_id: params.lectureId,
      status: params.status,
      error_message: params.errorMessage ?? null,
      model_metadata: params.modelMetadata ?? {},
      generated_at: new Date().toISOString(),
    } as never,
    { onConflict: "lecture_id" },
  );

  if (error) {
    throw error;
  }
}

export async function queueLectureQuizGeneration(lectureId: string) {
  await setQuizAssetStatus({
    lectureId,
    status: "queued",
    errorMessage: null,
    modelMetadata: {},
  });
}

export async function generateLectureQuiz(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();

  await setQuizAssetStatus({
    lectureId: params.lectureId,
    status: "generating",
    modelMetadata: { stage: "generating_questions", pipeline: QUIZ_PIPELINE_VERSION },
  });

  try {
    const [{ data: lecture, error: lectureError }, { data: transcript, error: transcriptError }] =
      await Promise.all([
        supabase.from("lectures").select("*").eq("id", params.lectureId).single(),
        supabase
          .from("transcript_segments")
          .select(TRANSCRIPT_SEGMENT_CONTENT_SELECT)
          .eq("lecture_id", params.lectureId)
          .order("idx", { ascending: true }),
      ]);

    if (lectureError) {
      throw lectureError;
    }

    if (transcriptError) {
      throw transcriptError;
    }

    const lectureRow = lecture as LectureRow;
    const segments = ((transcript ?? []) as TranscriptSegmentRow[]).map((segment) => ({
      idx: segment.idx,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      speakerLabel: segment.speaker_label,
      text: segment.text,
    }));

    if (segments.length === 0) {
      throw new Error("The lecture transcript is empty.");
    }

    const sourceType = lectureRow.source_type === "audio" ? "audio" : "document";
    const source = buildSourceDocument(segments, sourceType);
    const context = { lectureId: lectureRow.id, userId: lectureRow.user_id };

    const points = await extractLearningPoints({
      source,
      notesTitle: lectureRow.title,
      languageCode: lectureRow.language_hint,
      context,
    });

    const drafts = await writeQuizQuestions({
      points,
      notesTitle: lectureRow.title,
      languageCode: lectureRow.language_hint,
      context,
    });

    if (drafts.length === 0) {
      throw new Error("Quiz generation produced no questions.");
    }

    await setQuizAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: { stage: "publishing_quiz", pipeline: QUIZ_PIPELINE_VERSION },
    });

    const { data: previousQuestions, error: previousError } = await supabase
      .from("quiz_questions")
      .select("*")
      .eq("lecture_id", params.lectureId)
      .order("idx", { ascending: true });

    if (previousError) {
      throw previousError;
    }

    await supabase.from("quiz_questions").delete().eq("lecture_id", params.lectureId);

    try {
      const { error: insertError } = await supabase.from("quiz_questions").insert(
        drafts.map((draft, index) => ({
          lecture_id: params.lectureId,
          idx: index,
          prompt: draft.prompt,
          options_json: draft.options,
          correct_option_idx: draft.correctOptionIdx,
          explanation: draft.explanation,
          difficulty: draft.difficulty,
          source_locator: draft.point.units[0]?.locatorLabel ?? null,
        })) as never,
      );

      if (insertError) {
        throw insertError;
      }

      await setQuizAssetStatus({
        lectureId: params.lectureId,
        status: "ready",
        modelMetadata: {
          stage: "ready",
          pipeline: QUIZ_PIPELINE_VERSION,
          questionCount: drafts.length,
          learningPointCount: points.length,
        },
      });

      return { questionCount: drafts.length };
    } catch (error) {
      const previousRows = (previousQuestions ?? []) as QuizQuestionRow[];

      await supabase.from("quiz_questions").delete().eq("lecture_id", params.lectureId);
      if (previousRows.length > 0) {
        await supabase
          .from("quiz_questions")
          .insert(previousRows.map((row) => ({ ...row })) as never);
      }

      throw error;
    }
  } catch (error) {
    await setQuizAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: { stage: "failed", pipeline: QUIZ_PIPELINE_VERSION },
    });

    throw error;
  }
}
