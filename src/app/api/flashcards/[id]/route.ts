import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import type { FlashcardRow } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const FLASHCARD_MUTATION_MAX_BYTES = 32 * 1024;

const flashcardPayloadSchema = z.object({
  front: z.string().trim().min(1).max(2_000),
  back: z.string().trim().min(1).max(4_000),
  hint: z.string().trim().max(1_000).nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

async function getOwnedFlashcard(params: {
  flashcardId: string;
  user: User;
}) {
  const service = createSupabaseServiceRoleClient();
  const { data: flashcard, error } = await service
    .from("flashcards")
    .select("*")
    .eq("id", params.flashcardId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = flashcard as FlashcardRow | null;

  if (!row) {
    return null;
  }

  const lecture = await ensureUserOwnsLecture({
    lectureId: row.lecture_id,
    user: params.user,
  });

  return lecture ? row : null;
}

export async function PATCH(
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
    route: "api:flashcards:patch",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, flashcardPayloadSchema, {
    maxBytes: FLASHCARD_MUTATION_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidFlashcardId") }, { status: 400 });
  }

  const existing = await getOwnedFlashcard({
    flashcardId: parsedParams.data.id,
    user,
  });

  if (!existing) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, existing.lecture_id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.cards"),
      access.code,
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { data: flashcard, error } = await service
    .from("flashcards")
    .update({
      front: parsed.data.front,
      back: parsed.data.back,
      hint: parsed.data.hint || null,
      difficulty: parsed.data.difficulty,
    } as never)
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    flashcard: {
      ...(flashcard as FlashcardRow),
      citations: Array.isArray((flashcard as FlashcardRow).citations_json)
        ? ((flashcard as FlashcardRow).citations_json as unknown[])
        : [],
      progress: null,
    },
  });
}

export async function DELETE(
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
    route: "api:flashcards:delete",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidFlashcardId") }, { status: 400 });
  }

  const existing = await getOwnedFlashcard({
    flashcardId: parsedParams.data.id,
    user,
  });

  if (!existing) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, existing.lecture_id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.cards"),
      access.code,
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { error } = await service.from("flashcards").delete().eq("id", existing.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deletedFlashcardId: existing.id });
}
