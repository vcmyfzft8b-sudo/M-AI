import { NextResponse } from "next/server";
import { z } from "zod";

import {
  claimTrialLecture,
  createBillingRequiredResponse,
  getUserEntitlementState,
} from "@/lib/billing";
import {
  EMPTY_DRAFT_REUSE_WINDOW_MS,
  REUSABLE_DRAFT_COLUMNS,
  isReusableEmptyDraft,
  type ReusableDraftCandidate,
} from "@/lib/empty-draft-reuse";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { languageHintSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const CREATE_MANUAL_LECTURE_MAX_BYTES = 8 * 1024;

const createManualLectureSchema = z.object({
  sourceType: z.enum(["text", "pdf", "link"]),
  // Kept optional for clients that still send it — a retry replays the
  // language a lecture was already transcribed in. Nothing asks a user for
  // one any more, and a default here would assert Slovenian over every
  // source the pipeline is now meant to detect for itself.
  languageHint: languageHintSchema.optional(),
});

/**
 * The learner's most recent untouched draft of this kind, if they have one.
 *
 * Reads a handful of their newest `uploading` rows rather than asking the database to express
 * "empty metadata" — that shape lives in `isReusableEmptyDraft`, where it can be tested, and a
 * learner never has enough drafts open at once for the difference to matter.
 */
async function findReusableEmptyDraft(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  sourceType: string;
  accessTier: string;
}) {
  const now = Date.now();
  const { data, error } = await params.supabase
    .from("lectures")
    .select(REUSABLE_DRAFT_COLUMNS)
    .eq("user_id", params.userId)
    .eq("status", "uploading")
    .gte("created_at", new Date(now - EMPTY_DRAFT_REUSE_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !data) {
    // Reuse is an optimisation. A learner who cannot have it should still get a note.
    return null;
  }

  const reusable = (data as unknown as ReusableDraftCandidate[]).find((candidate) =>
    isReusableEmptyDraft(candidate, {
      sourceType: params.sourceType,
      accessTier: params.accessTier,
      now,
    }),
  );

  return reusable?.id ?? null;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  if (!entitlement.canCreateNotes) {
    /*
     * "Still being made" is not "you have run out". Since the free note is only spent once a
     * note succeeds, a learner whose first one is mid-run has not spent anything — they simply
     * cannot start a second beside it, because both could finish. Sending them to the paywall
     * for that would be a lie, so this answers with a plain 409 the modal shows as text.
     */
    if (entitlement.trialLectureInProgress) {
      return NextResponse.json(
        { error: await tr("api.trialLectureInProgress") },
        { status: 409 },
      );
    }

    return createBillingRequiredResponse(
      await tr("api.trialExhausted"),
      "trial_exhausted",
    );
  }

  if (!entitlement.hasPaidAccess && entitlement.trialLectureId && entitlement.canResumeTrialLecture) {
    return NextResponse.json({
      lectureId: entitlement.trialLectureId,
    });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:manual:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, createManualLectureSchema, {
    maxBytes: CREATE_MANUAL_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  /*
   * A learner who is trying again gets the draft they already have, rather than a second one.
   *
   * This row is created before there is anything to put in it, so every attempt that dies
   * between here and the source upload leaves an empty one behind — and the learner's next move
   * is almost always to press the button again. Without this they collect one dead note per
   * attempt: on 2026-09-05 one account made three drafts inside 39 seconds and kept two of them
   * as untitled failures. Adopting the empty draft makes the retry idempotent, and it holds even
   * for the attempts we cannot clean up client-side, where the tab is simply gone.
   *
   * Only a genuinely untouched row qualifies — no title, no source metadata, no storage path.
   * Anything else is a draft with work in it, and handing two attempts the same id would make
   * the second overwrite the first.
   */
  const accessTier = entitlement.hasPaidAccess ? "paid" : "trial";
  const reusableDraft = await findReusableEmptyDraft({
    supabase,
    userId: user.id,
    sourceType: parsed.data.sourceType,
    accessTier,
  });

  if (reusableDraft) {
    return NextResponse.json({ lectureId: reusableDraft });
  }

  const { data: lecture, error } = await supabase
    .from("lectures")
    .insert(
      {
        user_id: user.id,
        source_type: parsed.data.sourceType,
        access_tier: accessTier,
        status: "uploading",
        language_hint: parsed.data.languageHint ?? null,
      } as never,
    )
    .select("id")
    .single();

  if (error || !lecture) {
    return NextResponse.json(
      { error: error?.message ?? await tr("api.noteCreateFailed") },
      { status: 500 },
    );
  }

  if (!entitlement.hasPaidAccess) {
    const createdLectureId = (lecture as { id: string }).id;
    const trialClaim = await claimTrialLecture(user.id, createdLectureId);

    if (!trialClaim.allowed) {
      await supabase
        .from("lectures")
        .delete()
        .eq("id", createdLectureId)
        .eq("user_id", user.id);

      return createBillingRequiredResponse(
        await tr("api.trialAlreadyUsed"),
        "trial_exhausted",
      );
    }

    if (trialClaim.mode === "paid") {
      await supabase
        .from("lectures")
        .update({ access_tier: "paid" } as never)
        .eq("id", createdLectureId)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    lectureId: (lecture as { id: string }).id,
  });
}
