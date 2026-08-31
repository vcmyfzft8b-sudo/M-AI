import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import type { FlashcardProgressRow } from "@/lib/database.types";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const FLASHCARD_PROGRESS_MAX_BYTES = 4 * 1024;

const progressSchema = z.object({
  confidenceBucket: z.enum(["again", "good", "easy"]),
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
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:flashcards:progress:post",
    rules: rateLimitPresets.progress,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, progressSchema, {
    maxBytes: FLASHCARD_PROGRESS_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidFlashcardId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const { data: flashcard, error: flashcardError } = await supabase
    .from("flashcards")
    .select("id, lecture_id")
    .eq("id", id)
    .maybeSingle();

  if (flashcardError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const flashcardRow = flashcard as { id: string; lecture_id: string } | null;

  if (!flashcardRow) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, flashcardRow.lecture_id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.cards"),
      access.code,
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("flashcard_progress")
    .select("*")
    .eq("user_id", user.id)
    .eq("flashcard_id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const existingProgress = (existing ?? null) as FlashcardProgressRow | null;
  const nextReviewCount = (existingProgress?.review_count ?? 0) + 1;
  const lastReviewedAt = new Date().toISOString();

  const { data: progress, error: progressError } = await supabase
    .from("flashcard_progress")
    .upsert(
      {
        user_id: user.id,
        flashcard_id: id,
        confidence_bucket: parsed.data.confidenceBucket,
        review_count: nextReviewCount,
        last_reviewed_at: lastReviewedAt,
      } as never,
      {
        onConflict: "user_id,flashcard_id",
      },
    )
    .select("*")
    .single();

  if (progressError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  return NextResponse.json({ progress });
}
