import { resolveSpeechLanguage } from "@/lib/speech-language";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { noteTtsVoiceSchema } from "@/lib/note-tts-voice-schema";
import { DEFAULT_NOTE_TTS_VOICE } from "@/lib/note-tts-settings";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { getRouteUser } from "@/lib/supabase/server";
import { createTutorRealtimeCredentials } from "@/lib/tutor-realtime";
import { getTutorAllowance, openTutorGrant, toClientUsage } from "@/lib/tutor-usage";
import { loadTutorGrounding } from "@/lib/tutor-voice";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 300;

const sessionSchema = z.object({
  voice: noteTtsVoiceSchema.optional(),
});

const SESSION_REQUEST_MAX_BYTES = 1024;

/**
 * The credentials half of starting a session: the two short-lived keys the
 * browser opens its sockets with, plus the language everything will be spoken in.
 *
 * Deliberately does NOT carry the running order, though it used to. Measured in
 * the app, the plan was 6864ms of a 7737ms startup — so bundling them meant the
 * learner waited on the slowest thing before the microphone was even open. The
 * plan now has its own route and is fetched alongside the opening turn, which
 * needs no plan; see `planTutorLesson` and the opening rules in
 * tutor-voice-prompt.ts. This route answers in a few hundred milliseconds.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "POST /api/lectures/[id]/tutor/session", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tutor:session",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, sessionSchema, {
    maxBytes: SESSION_REQUEST_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({ lectureId: id, user });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canUseLectureFeatures(user.id, id, "chat");

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.trialOnly.tutor"), access.code);
  }

  if (lecture.status !== "ready") {
    return NextResponse.json({ error: await tr("api.tutorNotReady") }, { status: 409 });
  }

  const grounding = await loadTutorGrounding(id);

  if (!grounding || grounding.notes.trim().length === 0) {
    return NextResponse.json({ error: await tr("api.tutorNotReady") }, { status: 409 });
  }

  /*
   * The slice of talking time this session is allowed, reserved before any key is minted.
   * Null means there is none left — which is a paywall rather than an error, so it answers
   * 402 with what the client needs to show the right one.
   */
  const grant = await openTutorGrant({ userId: user.id, lectureId: id, feature: "tutor" });

  if (!grant) {
    const allowance = await getTutorAllowance(user.id, "tutor");

    return NextResponse.json(
      {
        error: await tr(
          allowance.hasPaidAccess ? "api.tutorCreditsNeeded" : "api.tutorTrialUsed",
        ),
        code: allowance.hasPaidAccess ? "tutor_credits_needed" : "tutor_trial_used",
        usage: toClientUsage(allowance),
      },
      { status: 402 },
    );
  }

  try {
    const realtime = await createTutorRealtimeCredentials({
      voice: parsed.data.voice ?? DEFAULT_NOTE_TTS_VOICE,
      clientReferenceId: `tutor:${id}`,
      ttlSeconds: grant.keyTtlSeconds,
    });

    return NextResponse.json({
      lectureId: id,
      noteTitle: grounding.title,
      /* Unsupported source languages use English speech; written notes keep their language. */
      language: resolveSpeechLanguage(grounding.language),
      grantId: grant.grantId,
      grantedSeconds: grant.grantedSeconds,
      usage: toClientUsage(grant.allowance),
      realtime,
    });
  } catch (error) {
    console.error("[tutor] session start failed", error);

    return NextResponse.json({ error: await tr("api.tutorStartFailed") }, { status: 502 });
  }
}
