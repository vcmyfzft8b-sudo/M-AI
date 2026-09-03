import * as Sentry from "@sentry/nextjs";

/**
 * Tells us when the voice tutor failed in front of somebody.
 *
 * Everything the tutor does that can break happens in the browser — two WebSockets
 * straight to Soniox, because a serverless function can hold neither — so none of it
 * shows up in a server log on its own. Until this existed, a learner whose session died
 * saw a red box and we saw nothing at all, which is how a key that expires half an hour
 * into every long conversation went unnoticed.
 *
 * Both halves are reported on purpose, and neither is redundant. Sentry is captured from
 * here, where the stack is, and reaches a different host than ours — so it still arrives
 * when our own API is the thing that is down. The report route is what puts a
 * `[tutor-client]` line in the Vercel log, which is what the error-triage run scans; it
 * still arrives when it is Sentry that is blocked, which ad blockers routinely do.
 */

export type TutorFailureStage = "session" | "renewal" | "turn" | "speech" | "recognizer";

/**
 * One report per distinct failure per page load.
 *
 * A dropped socket does not fail once. It fails on every turn that follows, and a
 * conversation that has lost its connection can produce one of these a second — which
 * would bury the first and only interesting occurrence under a thousand copies, and spend
 * the Sentry quota doing it.
 */
const reported = new Set<string>();

/** Even distinct failures stop being informative after a handful in one sitting. */
const MAX_REPORTS_PER_SESSION = 8;

export function resetTutorFailureReports() {
  reported.clear();
}

export function reportTutorFailure(
  error: unknown,
  context: {
    lectureId: string;
    stage: TutorFailureStage;
    /** Soniox's own code where it gave one. */
    code?: string | null;
    /** What the walkthrough was doing, which is usually the whole diagnosis. */
    phase?: string;
  },
) {
  const asError = error instanceof Error ? error : new Error(String(error));
  const fingerprint = `${context.stage}:${asError.name}:${asError.message}`;

  if (reported.has(fingerprint) || reported.size >= MAX_REPORTS_PER_SESSION) {
    return;
  }

  reported.add(fingerprint);

  try {
    Sentry.withScope((scope) => {
      scope.setTag("feature", "tutor");
      scope.setTag("tutorStage", context.stage);

      if (context.code) {
        scope.setTag("sonioxCode", context.code);
      }

      if (context.phase) {
        scope.setTag("tutorPhase", context.phase);
      }

      scope.setContext("tutor", {
        lectureId: context.lectureId,
        stage: context.stage,
        code: context.code ?? null,
        phase: context.phase ?? null,
      });
      /*
       * Grouped by stage and message rather than by stack. The same failure arrives
       * through several call sites — a turn, a renewal, a socket that closed under
       * one of them — and Sentry's default grouping would file those as three bugs.
       */
      scope.setFingerprint(["tutor", context.stage, asError.name, asError.message]);
      Sentry.captureException(asError);
    });
  } catch {
    // Sentry is best-effort. A failure to report must never break the walkthrough.
  }

  try {
    void fetch(`/api/lectures/${context.lectureId}/tutor/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* So it still goes out when this is the last thing the page does. */
      keepalive: true,
      body: JSON.stringify({
        stage: context.stage,
        message: asError.message.slice(0, 400),
        name: asError.name.slice(0, 80),
        code: context.code ?? null,
        phase: context.phase,
      }),
    }).catch(() => {
      // The network is the usual reason we are here at all.
    });
  } catch {
    // Same.
  }
}
