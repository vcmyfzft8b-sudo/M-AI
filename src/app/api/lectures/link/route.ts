import { after, NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { enqueueLectureLinkProcessing } from "@/lib/jobs";
import {
  getUnsupportedVideoLinkMessageKey,
  isUnsupportedVideoUrl,
} from "@/lib/link-source-validation";
import { ExpectedLectureInputError } from "@/lib/lecture-processing-errors";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  httpUrlSchema,
  languageHintSchema,
  optionalLectureIdSchema,
} from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const CREATE_LINK_LECTURE_MAX_BYTES = 16 * 1024;

const createLinkLectureSchema = z.object({
  lectureId: optionalLectureIdSchema,
  url: httpUrlSchema,
  // Kept optional for clients that still send it — a retry replays the
  // language a lecture was already transcribed in. Nothing asks a user for
  // one any more, and a default here would assert Slovenian over every
  // source the pipeline is now meant to detect for itself.
  languageHint: languageHintSchema.optional(),
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
      {
        error: await tr(getUnsupportedVideoLinkMessageKey()),
        code: "unsupported_video_link",
      },
      { status: 400 },
    );
  }

  if (!entitlement.hasPaidAccess && parsed.data.lectureId !== entitlement.trialLectureId) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.process"),
      "trial_exhausted",
    );
  }

  try {
    const lectureId = parsed.data.lectureId;

    if (!lectureId) {
      return NextResponse.json({ error: await tr("api.missingLectureId") }, { status: 400 });
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
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
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
          language_hint: parsed.data.languageHint ?? null,
          processing_metadata: {
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
    /*
     * The deeper check for the same rejection. It compares the thrown error's
     * `code` rather than its text: the text now exists in five languages, so
     * matching on it would stop recognising this case the moment a reader is
     * not using Slovenian.
     */
    if (
      error instanceof ExpectedLectureInputError &&
      error.code === "unsupported_video_link"
    ) {
      return NextResponse.json(
        {
          error: await tr(getUnsupportedVideoLinkMessageKey()),
          code: "unsupported_video_link",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : await tr("api.linkProcessFailed"),
      },
      { status: 500 },
    );
  }
}
