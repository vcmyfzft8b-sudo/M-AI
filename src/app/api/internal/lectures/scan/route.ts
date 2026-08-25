import { after, NextResponse } from "next/server";
import { z } from "zod";

import {
  getInvocationBudgetMs,
  runWithinInvocationBudget,
} from "@/lib/invocation-budget";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { enqueueLectureNotesGeneration } from "@/lib/jobs";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { processStoredScanLecture } from "@/lib/scan-processing";
import { getServerEnv } from "@/lib/server-env";

const requestSchema = z.object({
  lectureId: z.string().uuid(),
});

export const maxDuration = 300;
const INTERNAL_JOB_MAX_BYTES = 8 * 1024;
// Ends up verbatim in the lecture's error_message, so keep it about what the user can do. Which
// scan ran out of time is in the Sentry event markLecturePipelineFailed sends.
const SCAN_BUDGET_MESSAGE = "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.";

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

export async function POST(request: Request) {
  const invocationStartedAt = Date.now();
  const env = getServerEnv();
  const limited = await enforceRateLimit({
    request,
    route: "api:internal:lectures:scan:post",
    rules: rateLimitPresets.internal,
  });

  if (limited) {
    return limited;
  }

  const requestSecret = getSecretFromRequest(request);

  if (!env.INTERNAL_JOB_SECRET || requestSecret !== env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const parsed = await parseJsonRequest(request, requestSchema, {
    maxBytes: INTERNAL_JOB_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  // Answer before the work starts, the way /api/internal/lectures/document does. Awaiting the scan
  // here held the caller's own invocation open for the whole run: enqueueInternalLectureJob awaits
  // this response, so a scan that took the full five minutes killed the route that asked for it
  // too. The caller only reads response.ok to learn the job started, never the body.
  after(async () => {
    try {
      // The scan cannot be cancelled, so it keeps running after the budget rejects. That is fine:
      // the failure is recorded first, and a run that still lands in the remaining seconds
      // overwrites the row with its own state.
      const result = await runWithinInvocationBudget({
        run: () =>
          processStoredScanLecture({
            lectureId: parsed.data.lectureId,
          }),
        budgetMs: getInvocationBudgetMs({
          maxDurationSeconds: maxDuration,
          elapsedMs: Date.now() - invocationStartedAt,
        }),
        deadlineMessage: SCAN_BUDGET_MESSAGE,
      });

      if (result.needsNotesGeneration) {
        await enqueueLectureNotesGeneration(parsed.data.lectureId);
      }
    } catch (error) {
      await markLecturePipelineFailed({
        lectureId: parsed.data.lectureId,
        error,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
