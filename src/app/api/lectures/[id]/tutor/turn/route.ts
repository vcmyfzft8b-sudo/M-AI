import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { createChatEventStream } from "@/lib/chat-stream";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTutorGrounding, speakTutorTurn } from "@/lib/tutor-voice";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 300;

/*
 * The plan and the conversation come back from the browser rather than being
 * looked up here: they were generated for this session and nothing else holds
 * them. Every field is therefore capped, because a request body is a request
 * body — the caps below are the only thing standing between a modified client
 * and a very expensive prompt. The material itself is never taken from the
 * body; it is read from the note on the server, on every turn.
 */
const TURN_REQUEST_MAX_BYTES = 64 * 1024;

const topicSchema = z.object({
  title: z.string().min(1).max(200),
  points: z.array(z.string().min(1).max(600)).max(8),
});

const turnSchema = z.object({
  kind: z.enum(["opening", "teach", "answer", "feedback", "resume", "closing"]),
  topicIndex: z.number().int().min(0).max(31),
  /*
   * Absent for the opening turn, which is fired before the running order exists —
   * that is the whole reason the tutor starts talking in about three seconds
   * rather than ten. Every other kind carries it.
   */
  plan: z
    .object({
      /*
       * Optional, and defaulted rather than required, because a session that was already running
       * when this deployed holds a plan from before the field existed. Its turns should carry on
       * in the material's language, not fail validation halfway through a lesson.
       */
      language: z.string().trim().min(2).max(8).nullable().default(null),
      subject: z.string().min(1).max(600),
      topics: z.array(topicSchema).min(1).max(32),
    })
    .nullable()
    .default(null),
  spokenSoFar: z.string().max(8_000).default(""),
  question: z.string().max(1_000).nullable().default(null),
  history: z
    .array(
      z.object({
        role: z.enum(["tutor", "learner"]),
        content: z.string().min(1).max(2_000),
      }),
    )
    .max(24)
    .default([]),
});

/**
 * One thing the tutor says, streamed word by word.
 *
 * The stream is the point. The client opens a speech socket and forwards each
 * delta into it as it lands, so the tutor begins talking while the rest of the
 * turn is still being written — which is the difference between a conversation
 * and a lecture with a loading spinner in front of it.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  /*
   * A walkthrough is ten to twenty turns, and an inquisitive learner adds one
   * per question, so this cannot be as tight as the written chat's ceiling —
   * but it still has to stop a client stuck in a loop from billing an account
   * into the ground.
   */
  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tutor:turn",
    rules: rateLimitPresets.tutorTurn,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, turnSchema, {
    maxBytes: TURN_REQUEST_MAX_BYTES,
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

  const grounding = await loadTutorGrounding(id);

  if (!grounding) {
    return NextResponse.json({ error: await tr("api.tutorNotReady") }, { status: 409 });
  }

  const { kind, topicIndex, plan, spokenSoFar, question, history } = parsed.data;

  return createChatEventStream({
    label: "[tutor]",
    errorMessage: await tr("tutor.error.turnFailed"),
    run: (send) =>
      speakTutorTurn({
        grounding,
        plan,
        request: { kind, topicIndex, spokenSoFar, question, history },
        onDelta: send.delta,
      }),
  });
}
