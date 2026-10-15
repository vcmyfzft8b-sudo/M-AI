import { NextResponse } from "next/server";
import { z } from "zod";

import { readOwnedTopic } from "@/lib/exams/exams-server";
import { tutorTurn } from "@/lib/exams/exam-tutor-server";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getRouteUser } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";
import { createSanitizedStringSchema } from "@/lib/validation";

const paramsSchema = z.object({ id: z.string().uuid() });
const turnSchema = z.object({
  topicId: z.string().uuid(),
  question: createSanitizedStringSchema({ trim: true, minLength: 1, maxLength: 600 }),
  answerGuide: createSanitizedStringSchema({ multiline: true, trim: true, minLength: 1, maxLength: 1200 }),
  answer: createSanitizedStringSchema({ multiline: true, trim: true, maxLength: 4000 }),
  attempt: z.number().int().min(1).max(2),
  isLast: z.boolean(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/),
});

/** One reply of a topic's tutor lesson: the mark for an answer, and what the tutor says back. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "api:exams:tutor:post", request });

  if (!auth.user) {
    return auth.response;
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:exams:tutor:post",
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
    const topic = await readOwnedTopic(auth.supabase, auth.user.id, params.data.id, parsed.data.topicId);

    if (!topic) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    const turn = await tutorTurn({
      userId: auth.user.id,
      question: parsed.data.question,
      answerGuide: parsed.data.answerGuide,
      answer: parsed.data.answer,
      attempt: parsed.data.attempt,
      isLast: parsed.data.isLast,
      language: parsed.data.language,
    });

    return NextResponse.json(turn);
  } catch (error) {
    captureRouteError(error, { route: "api:exams:tutor:post", operation: "turn", request, userId: auth.user.id });
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }
}
