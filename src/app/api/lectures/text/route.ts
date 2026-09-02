import { after, NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { enqueueLectureNotesGeneration } from "@/lib/jobs";
import { prepareLectureFromTextSource } from "@/lib/manual-lectures";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { noteTtsVoiceSchema } from "@/lib/note-tts-voice-schema";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { languageHintSchema, noteTextSchema, optionalLectureIdSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

// Just under Vercel's ~4.5 MB serverless request-body limit, mirroring the document route: the
// paste itself is allowed to be huge because oversized text is compressed before the pipeline.
const CREATE_TEXT_LECTURE_MAX_BYTES = 4 * 1024 * 1024 + 256 * 1024;

const createTextLectureSchema = z.object({
  lectureId: optionalLectureIdSchema,
  text: noteTextSchema,
  // Kept optional for clients that still send it — a retry replays the
  // language a lecture was already transcribed in. Nothing asks a user for
  // one any more, and a default here would assert Slovenian over every
  // source the pipeline is now meant to detect for itself.
  languageHint: languageHintSchema.optional(),
  createInitialAudio: z.boolean().optional().default(false),
  initialAudioVoice: noteTtsVoiceSchema.optional(),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:text:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, createTextLectureSchema, {
    maxBytes: CREATE_TEXT_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  if (!entitlement.hasPaidAccess && parsed.data.lectureId !== entitlement.trialLectureId) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.process"),
      "trial_exhausted",
    );
  }

  try {
    if (parsed.data.lectureId) {
      const { data: lecture, error: lectureError } = await supabase
        .from("lectures")
        .select("id")
        .eq("id", parsed.data.lectureId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (lectureError) {
        throw new Error(lectureError.message);
      }

      if (!lecture) {
        return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
      }
    }

    const lectureId = await prepareLectureFromTextSource({
      lectureId: parsed.data.lectureId,
      userId: user.id,
      sourceType: "text",
      text: parsed.data.text,
      languageHint: parsed.data.languageHint,
      createInitialAudio: parsed.data.createInitialAudio,
      initialAudioVoice: parsed.data.initialAudioVoice,
      modelMetadata: {
        importMode: "text",
      },
    });

    after(async () => {
      try {
        await enqueueLectureNotesGeneration(lectureId);
      } catch (error) {
        await markLecturePipelineFailed({ lectureId, error });
      }
    });

    return NextResponse.json({ lectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : await tr("api.textProcessFailed"),
      },
      { status: 500 },
    );
  }
}
