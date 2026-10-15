import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseLectureFeatures, createBillingRequiredResponse } from "@/lib/billing";
import { topicSummaryAudio } from "@/lib/exams/exam-speech-server";
import { readOwnedTopic } from "@/lib/exams/exams-server";
import { captureRouteError } from "@/lib/monitoring";
import { normalizeNoteTtsVoice } from "@/lib/note-tts-settings";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 120;

const paramsSchema = z.object({ id: z.string().uuid(), topicId: z.string().uuid() });

/** A signed link to the topic summary, spoken (written once per voice, then reused). */
export async function POST(request: Request, context: { params: Promise<{ id: string; topicId: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:topic-speech:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:topic-speech:post",
    rules: rateLimitPresets.expensiveMutate,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const voice = normalizeNoteTtsVoice(new URL(request.url).searchParams.get("voice"));

  try {
    const topic = await readOwnedTopic(auth.supabase, auth.user.id, params.data.id, params.data.topicId);

    if (!topic) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    const access = await canUseLectureFeatures(auth.user.id, topic.lecture_id, "study");

    if (!access.allowed) {
      return createBillingRequiredResponse(await tr("api.trialOnly.study"), access.code);
    }

    const { data: lecture } = await auth.supabase
      .from("lectures")
      .select("language_hint")
      .eq("id", topic.lecture_id)
      .maybeSingle();
    const url = await topicSummaryAudio({
      userId: auth.user.id,
      lectureId: topic.lecture_id,
      topic,
      languageHint: (lecture as { language_hint: string | null } | null)?.language_hint ?? null,
      voice,
    });

    if (!url) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    return NextResponse.json({ url });
  } catch (error) {
    captureRouteError(error, { route: "api:exams:topic-speech:post", operation: "speak", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
