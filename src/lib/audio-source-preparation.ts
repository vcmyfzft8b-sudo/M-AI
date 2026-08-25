// Client-side preparation for every audio file a user hands us, in one place so the recorder and
// the upload modal cannot disagree about what is acceptable.
//
// The order matters and used to be wrong. Duration was read first, through an <audio> element,
// and a file the browser could not decode was rejected outright — before compression ever ran.
// A one-hour WAV is exactly that file: uncompressed exports are routinely 24-bit or float PCM,
// which Safari and Chrome refuse to decode, so a 100 MB lecture recording was turned away with
// "could not read the file's duration" even though transcoding it to a ~20 MB mp3 was a step we
// already knew how to do. Compression now runs first for anything bulky, and duration is read
// from whichever version of the file is actually readable, with the WAV header itself as the
// authority when no decoder will help.

import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "@/lib/constants";
import { compressAudioForUpload } from "@/lib/file-compression-client";
import { readWavDurationSeconds } from "@/lib/wav-duration";

/** The transcoder writes mono 16 kHz mp3 at 48 kbps, so its bytes convert straight to seconds. */
const COMPRESSED_AUDIO_BYTES_PER_SECOND = 6_000;

export const AUDIO_TOO_LARGE_MESSAGE = "Zvočna datoteka je prevelika. Omejitev je 300 MB.";
export const AUDIO_TOO_LONG_MESSAGE = "Zvočna datoteka je predolga. Omejitev je 3 ure.";
export const AUDIO_UNREADABLE_MESSAGE =
  "Te zvočne datoteke ni bilo mogoče pripraviti. Poskusi z drugim formatom (na primer mp3 ali m4a).";

/**
 * Duration straight from the browser's demuxer. Resolves null instead of rejecting: a format the
 * browser cannot decode is a reason to try something else, not a reason to refuse the upload.
 */
export function readAudioDurationFromMetadata(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (duration: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      URL.revokeObjectURL(objectUrl);
      audio.remove();
      resolve(duration);
    };

    audio.preload = "metadata";
    audio.src = objectUrl;

    audio.onloadedmetadata = () => {
      // A streamed or malformed container reports Infinity here, which is not a duration.
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };

    audio.onerror = () => finish(null);
  });
}

/** Metadata first, then the WAV header, then nothing — the caller decides what to do with null. */
export async function resolveAudioDurationSeconds(file: File): Promise<number | null> {
  const fromMetadata = await readAudioDurationFromMetadata(file);

  if (fromMetadata != null) {
    return fromMetadata;
  }

  return readWavDurationSeconds(file);
}

export type PreparedAudioSource = {
  file: File;
  durationSeconds: number;
  compressed: boolean;
};

/**
 * Compresses when the file calls for it, resolves a duration the API will accept, and enforces
 * the upload limits — in that order, so a limit is only ever applied to the file we would
 * actually send. `knownDurationSeconds` comes from the in-app recorder, which timed the take
 * itself and needs no decoding.
 */
export async function prepareAudioSourceForUpload(params: {
  file: File;
  knownDurationSeconds?: number | null;
  onStageChange?: (label: string) => void;
}): Promise<PreparedAudioSource> {
  const knownDuration =
    params.knownDurationSeconds != null && params.knownDurationSeconds > 0
      ? params.knownDurationSeconds
      : null;
  const originalDuration = knownDuration ?? (await resolveAudioDurationSeconds(params.file));

  // Checked before transcoding so a five-hour recording fails in a second rather than after
  // several minutes of work we are going to throw away.
  if (originalDuration != null && originalDuration > MAX_AUDIO_SECONDS) {
    throw new Error(AUDIO_TOO_LONG_MESSAGE);
  }

  if (originalDuration == null || params.file.size > MAX_AUDIO_BYTES) {
    params.onStageChange?.("Stiskam zvok...");
  }

  // compressAudioForUpload decides for itself whether this file needs transcoding: anything over
  // the upload cap, and any uncompressed format over 25 MB. When we still have no duration, a
  // transcode is forced — the mp3 it produces is readable by every browser and by us.
  const compression = await compressAudioForUpload(params.file, {
    force: originalDuration == null,
  });

  const durationSeconds =
    originalDuration ??
    (await resolveAudioDurationSeconds(compression.file)) ??
    (compression.compressed
      ? compression.file.size / COMPRESSED_AUDIO_BYTES_PER_SECOND
      : null) ??
    null;

  if (durationSeconds == null) {
    throw new Error(AUDIO_UNREADABLE_MESSAGE);
  }

  if (durationSeconds > MAX_AUDIO_SECONDS) {
    throw new Error(AUDIO_TOO_LONG_MESSAGE);
  }

  if (compression.file.size > MAX_AUDIO_BYTES) {
    throw new Error(AUDIO_TOO_LARGE_MESSAGE);
  }

  return {
    file: compression.file,
    // The API requires a positive integer, and a clip shorter than a second is still a clip.
    durationSeconds: Math.max(Math.round(durationSeconds), 1),
    compressed: compression.compressed,
  };
}
