import { NextResponse } from "next/server";
import { z } from "zod";

import { canSendTrialChatMessage, createBillingRequiredResponse } from "@/lib/billing";
import { answerLectureChat } from "@/lib/pipeline";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { chatQuestionSchema, routeIdParamSchema } from "@/lib/validation";

const chatSchema = z.object({
  question: chatQuestionSchema,
});

export const maxDuration = 300;
const CHAT_REQUEST_MAX_BYTES = 8 * 1024;

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
    route: "api:lectures:chat:post",
    rules: rateLimitPresets.expensiveChat,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, chatSchema, {
    maxBytes: CHAT_REQUEST_MAX_BYTES,
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

  const chatAccess = await canSendTrialChatMessage(user.id, id);

  if (!chatAccess.allowed) {
    return createBillingRequiredResponse(
      chatAccess.code === "trial_chat_limit_reached"
        ? "Porabil si vseh 5 brezplačnih sporočil za ta klepet."
        : "Brez plačljivega paketa lahko klepetaš samo o svojem poskusnem gradivu.",
      chatAccess.code,
    );
  }

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: "Klepet je na voljo, ko je obdelava zapiska končana." },
      { status: 409 },
    );
  }

  /*
   * The answer is streamed so the learner watches it being written rather than
   * waiting at a blank panel. Each token arrives as an SSE `delta` frame; the
   * `done` frame carries the persisted message, which the client swaps in for
   * the text it has been painting — that message is the one with an id and
   * citations, and it is what a reload will show.
   *
   * A stream that cannot start falls back inside answerLectureChat, so the
   * learner still gets an answer; it simply arrives all at once.
   */
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await answerLectureChat({
          lectureId: id,
          userId: user.id,
          question: parsed.data.question,
          onDelta: (text) => send("delta", { text }),
        });

        send("done", result);
      } catch (error) {
        console.error("[chat] stream failed", error);
        send("error", {
          error: error instanceof Error ? error.message : "Odgovora ni bilo mogoče ustvariti.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Vercel buffers a proxied response without this, which would defeat the
      // entire point of streaming it.
      "X-Accel-Buffering": "no",
    },
  });
}
