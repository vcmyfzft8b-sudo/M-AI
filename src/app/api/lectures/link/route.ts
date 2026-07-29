import { after, NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "@/lib/api-auth";
import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { enqueueLectureLinkProcessing } from "@/lib/jobs";
import {
  isUnsupportedVideoUrl,
  UNSUPPORTED_VIDEO_LINK_MESSAGE,
} from "@/lib/link-source-validation";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { NOTE_TTS_VOICES } from "@/lib/note-tts-settings";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  httpUrlSchema,
  languageHintSchema,
  optionalLectureIdSchema,
} from "@/lib/validation";

const CREATE_LINK_LECTURE_MAX_BYTES = 16 * 1024;

const createLinkLectureSchema = z.object({
  lectureId: optionalLectureIdSchema,
  url: httpUrlSchema,
  languageHint: languageHintSchema.default("sl"),
  createInitialAudio: z.boolean().optional().default(false),
  initialAudioVoice: z.enum(NOTE_TTS_VOICES).optional(),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = createSupabaseServiceRoleClient();
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:link:post",
    rules: rateLimitPresets.linkImport,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, createLinkLectureSchema, {
    maxBytes: CREATE_LINK_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  if (isUnsupportedVideoUrl(parsed.data.url)) {
    return NextResponse.json(
      { error: UNSUPPORTED_VIDEO_LINK_MESSAGE, code: "unsupported_video_link" },
      { status: 400 },
    );
  }

  if (!entitlement.hasPaidAccess && parsed.data.lectureId !== entitlement.trialLectureId) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa lahko obdelaš samo svoje brezplačno poskusno gradivo.",
      "trial_exhausted",
    );
  }

  try {
    const lectureId = parsed.data.lectureId;

    if (!lectureId) {
      return NextResponse.json({ error: "Manjka ID zapiska." }, { status: 400 });
    }

    const { data: lecture, error: lectureError } = await supabase
      .from("lectures")
      .select("id")
      .eq("id", lectureId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (lectureError) {
      throw new Error(lectureError.message);
    }

    if (!lecture) {
      return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
    }

    const titleHint = new URL(parsed.data.url).hostname;
    const { error: updateError } = await supabase
      .from("lectures")
      .update(
        {
          source_type: "link",
          status: "queued",
          error_message: null,
          title: titleHint,
          language_hint: parsed.data.languageHint,
          processing_metadata: {
            createInitialAudio: parsed.data.createInitialAudio,
            initialAudioVoice: parsed.data.initialAudioVoice ?? null,
            pendingLinkUrl: parsed.data.url,
            processing: {
              stage: "reading_link",
              updatedAt: new Date().toISOString(),
              errorMessage: null,
            },
          },
        } as never,
      )
      .eq("id", lectureId)
      .eq("user_id", user.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    after(async () => {
      try {
        await enqueueLectureLinkProcessing(lectureId);
      } catch (error) {
        await markLecturePipelineFailed({ lectureId, error });
      }
    });

    return NextResponse.json({ lectureId });
  } catch (error) {
    if (error instanceof Error && error.message === UNSUPPORTED_VIDEO_LINK_MESSAGE) {
      return NextResponse.json(
        { error: UNSUPPORTED_VIDEO_LINK_MESSAGE, code: "unsupported_video_link" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Povezave ni bilo mogoče obdelati.",
      },
      { status: 500 },
    );
  }
}
