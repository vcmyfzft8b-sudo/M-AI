import "server-only";

import { SonioxNodeClient } from "@soniox/node";

import { NOTE_LANGUAGE_OPTIONS } from "@/lib/languages";
import { requireSonioxEnv } from "@/lib/server-env";
import type { TranscriptResult } from "@/lib/types";
import {
  InvalidAudioFileError,
  NoClearSpeechDetectedError,
  type TranscriptionAttemptDiagnostics,
  type TranscriptionProvider,
} from "@/lib/transcription/types";

const SONIOX_WAIT_TIMEOUT_MS = 240_000;
const SONIOX_WAIT_INTERVAL_MS = 2_000;

let sonioxClient: SonioxNodeClient | undefined;

function getSonioxClient() {
  if (!sonioxClient) {
    const env = requireSonioxEnv();
    sonioxClient = new SonioxNodeClient({
      api_key: env.SONIOX_API_KEY,
    });
  }

  return sonioxClient;
}

/**
 * The hints for a lecture whose language somebody already knows — a retry of a
 * lecture we have transcribed before, say.
 *
 * `null` when nobody knows, which is now the normal case: nothing asks the user
 * to pick a language any more, so the honest thing is to let Soniox identify it
 * rather than assert a default and transcribe Slovenian audio as English.
 * `normalizeNoteLanguage` cannot say that — it answers "en" for anything it
 * does not recognise — so the check is against the codes themselves.
 */
const TRANSCRIPTION_LANGUAGE_HINTS = new Set(["en", "sl", "de", "hr", "it"]);

function resolveLanguageHints(languageHint: string | null) {
  const normalized = languageHint?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  // Only the codes this transcriber has been run against. `NOTE_LANGUAGE_OPTIONS` also carries
  // the ones added for note furniture (bs, sr), and an untested hint is worse than none: an
  // unknown code leaves the field empty, which is the provider's own auto-detect.
  const known = TRANSCRIPTION_LANGUAGE_HINTS.has(normalized);

  return known ? [normalized] : null;
}

function fallbackSegments(text: string, durationSeconds: number): TranscriptResult["segments"] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const slice = Math.max(1, Math.floor((durationSeconds * 1000) / Math.max(parts.length, 1)));

  return parts.map((part, index) => ({
    idx: index,
    startMs: index * slice,
    endMs: (index + 1) * slice,
    speakerLabel: null,
    text: part,
  }));
}

function toDurationSeconds(durationSeconds?: number | null, text = "") {
  const safeDuration = Math.round(durationSeconds ?? 0);
  return safeDuration > 0 ? safeDuration : Math.max(1, Math.ceil(text.split(/\s+/).length / 2.5));
}

function getFileMimeType(file: File) {
  return file.type || "application/octet-stream";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

function isInvalidAudioFileErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("invalid audio file") ||
    normalized.includes("error determining audio duration") ||
    normalized.includes("unsupported format") ||
    normalized.includes("corrupted")
  );
}

type SonioxTranscribeOptions = {
  languageHintsStrict: boolean;
};

export class SonioxTranscriptionProvider implements TranscriptionProvider {
  private async transcribeWithOptions(input: {
    file: File;
    languageHint: string | null;
    durationSeconds?: number | null;
    bytes: Buffer;
    options: SonioxTranscribeOptions;
  }): Promise<{
    diagnostics: TranscriptionAttemptDiagnostics;
    result: TranscriptResult | null;
  }> {
    const env = requireSonioxEnv();
    const client = getSonioxClient();
    const languageHints = resolveLanguageHints(input.languageHint);
    const transcription = await client.stt
      .transcribe({
        model: env.SONIOX_MODEL,
        file: input.bytes,
        filename: input.file.name || "lecture-audio",
        ...(languageHints ? { language_hints: languageHints } : {}),
        language_hints_strict: Boolean(languageHints) && input.options.languageHintsStrict,
        enable_speaker_diarization: true,
        enable_language_identification: !languageHints || !input.options.languageHintsStrict,
        wait: true,
        wait_options: {
          interval_ms: SONIOX_WAIT_INTERVAL_MS,
          timeout_ms: SONIOX_WAIT_TIMEOUT_MS,
        },
        cleanup: ["file", "transcription"],
      })
      .catch((error: unknown) => {
        if (isInvalidAudioFileErrorMessage(getErrorMessage(error))) {
          throw new InvalidAudioFileError();
        }

        throw error;
      });

    if (transcription.status !== "completed") {
      if (isInvalidAudioFileErrorMessage(transcription.error_message ?? "")) {
        throw new InvalidAudioFileError();
      }

      throw new Error(
        transcription.error_message || `Soniox transcription failed with status ${transcription.status}.`,
      );
    }

    const transcript = transcription.transcript ?? (await transcription.getTranscript());
    const transcriptText = transcript?.text.trim() ?? "";
    const diagnostics: TranscriptionAttemptDiagnostics = {
      audioDurationMs: transcription.audio_duration_ms ?? null,
      languageHints: languageHints ?? [],
      languageHintsStrict: input.options.languageHintsStrict,
      status: transcription.status,
      transcriptLength: transcriptText.length,
    };

    if (!transcript || transcriptText.length === 0) {
      return {
        diagnostics,
        result: null,
      };
    }

    const segments = transcript
      .segments({ group_by: ["speaker", "language"] })
      .map((segment, index) => ({
        idx: index,
        startMs: segment.start_ms,
        endMs: Math.max(segment.end_ms, segment.start_ms),
        speakerLabel: segment.speaker ?? null,
        text: segment.text.trim(),
      }))
      .filter((segment) => segment.text.length > 0);

    const durationSeconds = toDurationSeconds(
      transcription.audio_duration_ms != null
        ? transcription.audio_duration_ms / 1000
        : input.durationSeconds,
      transcriptText,
    );

    return {
      diagnostics,
      result: {
        text: transcriptText,
        durationSeconds,
        segments:
          segments.length > 0
            ? segments
            : fallbackSegments(transcriptText, durationSeconds),
      },
    };
  }

  async transcribe(input: {
    file: File;
    languageHint: string | null;
    durationSeconds?: number | null;
  }) {
    const env = requireSonioxEnv();
    const bytes = Buffer.from(await input.file.arrayBuffer());
    const attempts: TranscriptionAttemptDiagnostics[] = [];

    const strictAttempt = await this.transcribeWithOptions({
      ...input,
      bytes,
      options: {
        languageHintsStrict: true,
      },
    });
    attempts.push(strictAttempt.diagnostics);

    if (strictAttempt.result) {
      return strictAttempt.result;
    }

    const relaxedAttempt = await this.transcribeWithOptions({
      ...input,
      bytes,
      options: {
        languageHintsStrict: false,
      },
    });
    attempts.push(relaxedAttempt.diagnostics);

    if (relaxedAttempt.result) {
      return relaxedAttempt.result;
    }

    throw new NoClearSpeechDetectedError({
      provider: "soniox",
      model: env.SONIOX_MODEL,
      file: {
        mimeType: getFileMimeType(input.file),
        sizeBytes: bytes.byteLength,
      },
      attempts,
    });
  }
}
