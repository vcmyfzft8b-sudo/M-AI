import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import type { FlashcardRow } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const FLASHCARD_MUTATION_MAX_BYTES = 32 * 1024;

const flashcardPayloadSchema = z.object({
  front: z.string().trim().min(1).max(2_000),
  back: z.string().trim().min(1).max(4_000),
  hint: z.string().trim().max(1_000).nullable().optional(),
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
    route: "api:lectures:flashcards:post",
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

  const access = await canUseLectureFeatures(user.id, id, "study");

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa so kartice na voljo samo za tvoje poskusno gradivo.",
      access.code,
    );
  }

  const service = createSupabaseServiceRoleClient();
  const { data: lastCard, error: lastCardError } = await service
    .from("flashcards")
    .select("idx")
    .eq("lecture_id", id)
    .order("idx", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastCardError) {
    return NextResponse.json({ error: lastCardError.message }, { status: 500 });
  }

  const lastCardRow = lastCard as Pick<FlashcardRow, "idx"> | null;
  const nextIdx = typeof lastCardRow?.idx === "number" ? lastCardRow.idx + 1 : 0;
  const manualId = crypto.randomUUID();
  const { data: flashcard, error } = await service
    .from("flashcards")
    .insert({
      lecture_id: id,
      idx: nextIdx,
      front: parsed.data.front,
      back: parsed.data.back,
      hint: parsed.data.hint || null,
      difficulty: parsed.data.difficulty,
      citations_json: [],
      section_id: null,
      source_unit_idx: 0,
      card_kind: "manual",
      concept_key: `manual-${manualId}`,
      source_type: "manual",
      source_locator: null,
      coverage_rank: nextIdx,
    } as never)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await service
    .from("lecture_study_assets")
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

  return NextResponse.json({
    flashcard: {
      ...(flashcard as FlashcardRow),
      citations: [],
      progress: null,
    },
  });
}
