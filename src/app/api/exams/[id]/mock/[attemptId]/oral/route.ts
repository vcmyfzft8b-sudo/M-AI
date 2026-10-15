import { NextResponse } from "next/server";
import { z } from "zod";

import { examinerTurn, type OralVibe } from "@/lib/exams/exam-oral-server";
import { readMockAttempt } from "@/lib/exams/exams-server";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";
import { createSanitizedStringSchema } from "@/lib/validation";

const paramsSchema = z.object({ id: z.string().uuid(), attemptId: z.string().uuid() });
const turnSchema = z.object({
  questionIndex: z.number().int().min(0).max(40),
  answer: createSanitizedStringSchema({ multiline: true, trim: true, maxLength: 8000 }),
  alreadyFollowedUp: z.boolean(),
});

/** One examiner reply in an oral mock: a follow-up question, or a line that moves on. */
export async function POST(request: Request, context: { params: Promise<{ id: string; attemptId: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:mock:oral:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:mock:oral:post",
    rules: rateLimitPresets.tutorTurn,
    userId: auth.user.id,
  });

  if (limited) {
    return limited;
  }

  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const parsed = await parseJsonRequest(request, turnSchema, { maxBytes: 16 * 1024 });

  if (!parsed.success) {
    return parsed.response;
  }

  try {
    const attempt = await readMockAttempt(auth.supabase, auth.user.id, params.data.id, params.data.attemptId);
    const questions = (attempt?.questions ?? []) as { prompt: string; answerGuide?: string }[];
    const question = questions[parsed.data.questionIndex];

    if (!attempt || attempt.mode !== "oral" || attempt.status !== "in_progress" || !question) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    const turn = await examinerTurn({
      userId: auth.user.id,
      vibe: (attempt.vibe as OralVibe | null) ?? "strict",
      question: question.prompt,
      answerGuide: question.answerGuide ?? "",
      answer: parsed.data.answer,
      alreadyFollowedUp: parsed.data.alreadyFollowedUp,
      isLast: parsed.data.questionIndex >= questions.length - 1,
    });

    return NextResponse.json(turn);
  } catch (error) {
    captureRouteError(error, { route: "api:exams:mock:oral:post", operation: "turn", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
