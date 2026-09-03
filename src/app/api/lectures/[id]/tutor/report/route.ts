import { NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

/**
 * Where a voice tutor failure the learner actually saw gets written down.
 *
 * The tutor is the one feature that does its real work in the browser: it talks to Soniox
 * directly over two WebSockets, because a serverless function cannot hold one open and
 * cannot afford the extra hop on every packet anyway. The cost of that is a blind spot —
 * an expired key, a socket Soniox hung up on, a request a phone dropped while changing
 * cell are all invisible to every server-side log, and the first anyone knew of them was
 * a screenshot. This is the other half of the trade.
 *
 * Sentry gets the exception from the browser, where the stack is. This route exists for
 * the line in the Vercel log, tagged `[tutor-client]`, which is what the error-triage run
 * scans every three hours — see `UNCAUGHT_PATTERN` in scripts/vercel-error-scan.mjs.
 * Reporting to both is deliberate: whichever of them the failure has not also broken is
 * the one that raises it.
 */

const reportSchema = z.object({
  /* Which half of the conversation failed, so the log line groups by cause. */
  stage: z.enum(["session", "renewal", "turn", "speech", "recognizer"]),
  message: z.string().min(1).max(400),
  name: z.string().max(80).optional(),
  /* Soniox's own code where there was one: 401 expired key, 429 out of streams. */
  code: z.string().max(20).optional().nullable(),
  phase: z.string().max(40).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:tutor:report",
    rules: rateLimitPresets.progress,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const params = await context.params;

  if (!routeIdParamSchema.safeParse(params).success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, reportSchema, { maxBytes: 1_024 });

  if (!parsed.success) {
    return parsed.response;
  }

  const { stage, message, name, code, phase } = parsed.data;

  /*
   * `console.error` with the marker, rather than a thrown error or a 5xx: nothing here
   * failed, and answering 500 would put this route in the scan on its own account every
   * time it did its job. The scan classifies by level and marker, so this is enough.
   */
  console.error(
    `[tutor-client] ${stage} failed: ${name ? `${name}: ` : ""}${message}` +
      ` (lecture ${params.id}, user ${user.id}` +
      `${code ? `, soniox ${code}` : ""}${phase ? `, phase ${phase}` : ""})`,
  );

  return NextResponse.json({ recorded: true });
}
