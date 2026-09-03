import "server-only";

import { SonioxNodeClient } from "@soniox/node";

import { requireSonioxEnv } from "@/lib/server-env";
import { type NoteTtsVoice } from "@/lib/note-tts-settings";

/**
 * How the voice tutor reaches Soniox, and why it does it from the browser.
 *
 * Every other Soniox call in this app is made server-side: a note's audio is
 * synthesized in a function, cached, and served as a file. A conversation
 * cannot work that way. Barge-in has to be measured in tens of milliseconds —
 * the tutor stops when the learner starts, not a second later — and putting a
 * serverless function between the microphone and the recognizer adds a hop in
 * each direction on every packet. Vercel functions cannot hold a WebSocket
 * open at all, so there is no server to relay through even if the latency were
 * acceptable.
 *
 * So the browser talks to Soniox directly, and this is what makes that safe:
 * Soniox mints short-lived keys that can do exactly one thing each. A
 * `transcribe_websocket` key opens a recognizer and nothing else; a `tts_rt`
 * key opens a speech stream and nothing else. Neither can read the account, buy
 * anything, or reach any other endpoint, and both expire on their own. The real
 * key never leaves the server.
 */

/**
 * How long the keys live, in seconds.
 *
 * Not a fixed window any more: this is the learner's remaining allowance for this slice, so
 * the credentials stop working exactly when their time runs out. That is the enforcement —
 * the browser talks to Soniox directly, so a check on our side would only be a suggestion.
 * See `openTutorGrant` in tutor-usage.ts.
 */
export const TUTOR_KEY_MAX_TTL_SECONDS = 3_600;

export type TutorRealtimeCredentials = {
  stt: {
    apiKey: string;
    expiresAt: string;
    url: string;
    model: string;
  };
  tts: {
    apiKey: string;
    expiresAt: string;
    url: string;
    model: string;
    voice: NoteTtsVoice;
  };
};

let sonioxClient: SonioxNodeClient | undefined;

function getSonioxClient() {
  if (!sonioxClient) {
    sonioxClient = new SonioxNodeClient({ api_key: requireSonioxEnv().SONIOX_API_KEY });
  }

  return sonioxClient;
}

/**
 * A pair of single-purpose keys for one session.
 *
 * `clientReferenceId` is Soniox's own tracking field: it does not have to be
 * unique and it is not a secret, but having the lecture on every realtime
 * stream is what makes a bill or a stuck session attributable later.
 */
export async function createTutorRealtimeCredentials(params: {
  voice: NoteTtsVoice;
  clientReferenceId: string;
  /** The slice these keys are for. Soniox refuses anything outside 1..3600. */
  ttlSeconds: number;
}): Promise<TutorRealtimeCredentials> {
  const env = requireSonioxEnv();
  const client = getSonioxClient();
  const expiresInSeconds = Math.max(1, Math.min(Math.round(params.ttlSeconds), TUTOR_KEY_MAX_TTL_SECONDS));
  const [stt, tts] = await Promise.all([
    client.auth.createTemporaryKey({
      usage_type: "transcribe_websocket",
      expires_in_seconds: expiresInSeconds,
      client_reference_id: params.clientReferenceId,
    }),
    client.auth.createTemporaryKey({
      usage_type: "tts_rt",
      expires_in_seconds: expiresInSeconds,
      client_reference_id: params.clientReferenceId,
    }),
  ]);

  return {
    stt: {
      apiKey: stt.api_key,
      expiresAt: stt.expires_at,
      url: "wss://stt-rt.soniox.com/transcribe-websocket",
      model: env.SONIOX_STT_REALTIME_MODEL,
    },
    tts: {
      apiKey: tts.api_key,
      expiresAt: tts.expires_at,
      url: "wss://tts-rt.soniox.com/tts-websocket",
      model: env.SONIOX_TTS_MODEL,
      voice: params.voice,
    },
  };
}
