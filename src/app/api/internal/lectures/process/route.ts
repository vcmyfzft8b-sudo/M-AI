import { after, NextResponse } from "next/server";
import { z } from "zod";

import {
  getInvocationBudgetMs,
  runWithinInvocationBudget,
} from "@/lib/invocation-budget";
import type { LectureProcessingStage } from "@/lib/jobs";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
  transcribeLectureContent,
} from "@/lib/pipeline";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { getServerEnv } from "@/lib/server-env";
import { tr } from "@/lib/i18n/server";

const requestSchema = z.object({
  lectureId: z.string().uuid(),
  stage: z.enum(["transcribe", "generate_notes"]),
});

export const maxDuration = 300;
const INTERNAL_JOB_MAX_BYTES = 8 * 1024;
// Ends up verbatim in the lecture's error_message, so keep it about what the user can do. Which
// stage ran out of time is in the Sentry event markLecturePipelineFailed sends.
const STAGE_BUDGET_MESSAGE = "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.";

function getSecretFromRequest(request: Request) {
  const headerSecret = request.headers.get("x-internal-job-secret");

  if (headerSecret && headerSecret.length > 0) {
    return headerSecret;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

async function runLectureStage(params: {
  lectureId: string;
  stage: LectureProcessingStage;
}) {
  if (params.stage === "transcribe") {
    await transcribeLectureContent({
      lectureId: params.lectureId,
    });

    await generateLectureNotesFromStoredTranscript({
      lectureId: params.lectureId,
    });

    return;
  }

  await generateLectureNotesFromStoredTranscript({
    lectureId: params.lectureId,
  });
}

export async function POST(request: Request) {
  const invocationStartedAt = Date.now();
  const env = getServerEnv();
  const limited = await enforceRateLimit({
    request,
    route: "api:internal:lectures:process:post",
    rules: rateLimitPresets.internal,
  });

  if (limited) {
    return limited;
  }

  const requestSecret = getSecretFromRequest(request);

  if (!env.INTERNAL_JOB_SECRET || requestSecret !== env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const parsed = await parseJsonRequest(request, requestSchema, {
    maxBytes: INTERNAL_JOB_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  after(async () => {
    try {
      // The stage cannot be cancelled, so it keeps running after the budget rejects. That is fine:
      // the failure is recorded first, and a stage that still lands in the remaining seconds
      // overwrites the row with its own state.
      await runWithinInvocationBudget({
        run: () => runLectureStage(parsed.data),
        budgetMs: getInvocationBudgetMs({
          maxDurationSeconds: maxDuration,
          elapsedMs: Date.now() - invocationStartedAt,
        }),
        deadlineMessage: STAGE_BUDGET_MESSAGE,
      });
    } catch (error) {
      await markLecturePipelineFailed({
        lectureId: parsed.data.lectureId,
        error,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
