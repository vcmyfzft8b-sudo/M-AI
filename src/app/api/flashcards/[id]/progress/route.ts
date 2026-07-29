import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "@/lib/api-auth";
import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import type { FlashcardProgressRow } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const FLASHCARD_PROGRESS_MAX_BYTES = 4 * 1024;

const progressSchema = z.object({
  confidenceBucket: z.enum(["again", "good", "easy"]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = createSupabaseServiceRoleClient();
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
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
    return NextResponse.json({ error: "Neveljaven ID kartice." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const { data: flashcard, error: flashcardError } = await supabase
    .from("flashcards")
    .select("id, lecture_id")
    .eq("id", id)
    .maybeSingle();

  if (flashcardError) {
    return NextResponse.json({ error: flashcardError.message }, { status: 500 });
  }

  const flashcardRow = flashcard as { id: string; lecture_id: string } | null;

  // The lookup above runs with the service role, so ownership has to be
  // checked explicitly instead of relying on the caller's RLS context.
  const ownedLecture = flashcardRow
    ? await ensureUserOwnsLecture({ lectureId: flashcardRow.lecture_id, user })
    : null;

  if (!flashcardRow || !ownedLecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, flashcardRow.lecture_id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa so kartice na voljo samo za tvoje poskusno gradivo.",
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
    return NextResponse.json({ error: existingError.message }, { status: 500 });
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
    return NextResponse.json({ error: progressError.message }, { status: 500 });
  }

  return NextResponse.json({ progress });
}
