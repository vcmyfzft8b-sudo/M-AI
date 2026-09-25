import type { TutorPhase } from "@/lib/tutor/heard-line";

/**
 * When the tutor asks Soniox for its microphone back on its own.
 *
 * A recognizer that closes mid-walkthrough (MEMOAI-WEB-3Y: four production events
 * 2026-09-14..23) used to stay closed until the learner paused and continued, or the
 * half-hourly renewal came round — up to thirty minutes of a tutor asking questions
 * it could not hear. A dropped connection is retried quickly; a full pool (the
 * organisation has ten realtime streams) slowly, because it frees up in minutes, not
 * seconds. A refusal is not retried: the same stream would be refused again.
 *
 * ±20 % jitter keeps every open tutor from knocking at once after a blip.
 */
export const LISTEN_RETRY_CONNECTION_MS = [1_000, 3_000, 9_000, 27_000] as const;
export const LISTEN_RETRY_BUSY_MS = [20_000, 40_000, 60_000, 60_000, 60_000] as const;
/** A reconnected recognizer that has lived this long has earned a fresh set of tries. */
export const LISTEN_RETRY_STABLE_MS = 60_000;

export type ListeningDropReason = "connection" | "busy" | "refused" | "denied" | "unavailable";

export function nextListeningRetryDelay(reason: ListeningDropReason, attempt: number, random = Math.random) {
  const schedule = reason === "connection" ? LISTEN_RETRY_CONNECTION_MS : reason === "busy" ? LISTEN_RETRY_BUSY_MS : null;

  if (!schedule || attempt >= schedule.length) {
    return null;
  }

  return Math.round(schedule[attempt] * (0.8 + random() * 0.4));
}

/** A retry only helps a walkthrough that is running, on a page somebody can see. */
export function listeningRetryMayRun(state: { phase: TutorPhase; visible: boolean; listening: boolean }) {
  return (
    state.visible &&
    !state.listening &&
    (state.phase === "preparing" || state.phase === "thinking" || state.phase === "speaking" || state.phase === "listening")
  );
}
