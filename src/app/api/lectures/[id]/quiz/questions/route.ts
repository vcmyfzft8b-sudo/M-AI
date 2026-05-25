import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import type { QuizQuestionRow } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const QUIZ_QUESTION_MUTATION_MAX_BYTES = 48 * 1024;

const quizQuestionPayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(3_000),
  options: z.array(z.string().trim().min(1).max(1_000)).length(4),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1).max(4_000),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:quiz-questions:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, quizQuestionPayloadSchema, {
    maxBytes: QUIZ_QUESTION_MUTATION_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "quiz");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa je kviz na voljo samo za tvoje poskusno gradivo.",
      access.code,
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { data: lastQuestion, error: lastQuestionError } = await service
    .from("quiz_questions")
    .select("idx")
    .eq("lecture_id", id)
    .order("idx", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastQuestionError) {
    return NextResponse.json({ error: lastQuestionError.message }, { status: 500 });
  }

  const lastQuestionRow = lastQuestion as Pick<QuizQuestionRow, "idx"> | null;
  const nextIdx =
    typeof lastQuestionRow?.idx === "number" ? lastQuestionRow.idx + 1 : 0;
  const { data: question, error } = await service
    .from("quiz_questions")
    .insert({
      lecture_id: id,
      idx: nextIdx,
      prompt: parsed.data.prompt,
      options_json: parsed.data.options,
      correct_option_idx: parsed.data.correctOptionIndex,
      explanation: parsed.data.explanation,
      difficulty: parsed.data.difficulty,
      source_locator: null,
    } as never)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await service
    .from("lecture_quiz_assets")
    .upsert(
      {
        lecture_id: id,
        status: "ready",
        error_message: null,
        model_metadata: { manual: true },
      } as never,
      { onConflict: "lecture_id" },
    )
    .then(() => null);

  const row = question as QuizQuestionRow;
  return NextResponse.json({
    question: {
      ...row,
      options: parsed.data.options,
    },
  });
}
