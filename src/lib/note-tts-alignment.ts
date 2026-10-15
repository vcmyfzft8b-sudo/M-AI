// Character-level timestamps from the Soniox TTS WebSocket, turned into the word-sized pieces the
// alignment below matches against, and the alignment itself: which note word was said when. Kept
// free of "@/" imports so the unit tests and the clip scripts can load it.

import type { NoteTtsWord } from "./note-tts-text.ts";

export type TtsAlignmentWord = {
  wordIndex: number;
  startMs: number;
  endMs: number;
};

export type TtsCharacterTimestamps = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type TtsAlignmentPiece = {
  text: string;
  start_ms: number;
  end_ms: number;
};

// The server sends one timestamps object per audio frame, each covering the characters spoken in
// that frame. Concatenated, they are the model's spoken text, one entry per character. Grouping
// runs of non-whitespace gives the alignment the same shape a transcript token has, with timings
// that are exact instead of transcribed.
export function buildTtsPiecesFromCharacterTimestamps(
  frames: TtsCharacterTimestamps[],
): TtsAlignmentPiece[] {
  const pieces: TtsAlignmentPiece[] = [];
  let current: TtsAlignmentPiece | null = null;

  for (const frame of frames) {
    const count = Math.min(
      frame.characters.length,
      frame.character_start_times_seconds.length,
      frame.character_end_times_seconds.length,
    );

    for (let index = 0; index < count; index += 1) {
      const character = frame.characters[index];
      const startMs = Math.round(frame.character_start_times_seconds[index] * 1000);
      const endMs = Math.round(frame.character_end_times_seconds[index] * 1000);

      if (/^\s*$/u.test(character)) {
        current = null;
        continue;
      }

      if (current) {
        current.text += character;
        current.end_ms = Math.max(current.end_ms, endMs);
        continue;
      }

      current = { text: character, start_ms: startMs, end_ms: Math.max(startMs, endMs) };
      pieces.push(current);
    }
  }

  return pieces;
}

export function getCharacterTimestampsEndMs(frames: TtsCharacterTimestamps[]) {
  let endMs = 0;

  for (const frame of frames) {
    for (const end of frame.character_end_times_seconds) {
      endMs = Math.max(endMs, Math.round(end * 1000));
    }
  }

  return endMs;
}

function normalizeAlignmentText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A transcript token, or a piece built from character timestamps; audio events are skipped. */
export type TtsAlignmentToken = TtsAlignmentPiece & { is_audio_event?: boolean | null };

function collectTranscriptPieces(tokens: TtsAlignmentToken[]) {
  return tokens
    .map((token, index) => ({
      index,
      text: normalizeAlignmentText(token.text),
      startMs: token.start_ms,
      endMs: token.end_ms,
    }))
    .filter((token) => token.text.length > 0 && !tokens[token.index]?.is_audio_event);
}

function interpolateMissingTimings(params: {
  timings: Array<TtsAlignmentWord | null>;
  wordStartIndex: number;
  durationMs: number;
}) {
  const timings = [...params.timings];
  const durationMs = Math.max(params.durationMs, timings.length * 250, 1);

  for (let index = 0; index < timings.length; index += 1) {
    if (timings[index]) {
      continue;
    }

    const previousIndex = (() => {
      for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
        if (timings[candidate]) {
          return candidate;
        }
      }

      return -1;
    })();
    const nextIndex = (() => {
      for (let candidate = index + 1; candidate < timings.length; candidate += 1) {
        if (timings[candidate]) {
          return candidate;
        }
      }

      return timings.length;
    })();
    const previousEnd = previousIndex >= 0 ? timings[previousIndex]?.endMs ?? 0 : 0;
    const nextStart =
      nextIndex < timings.length ? timings[nextIndex]?.startMs ?? durationMs : durationMs;
    const missingCount = nextIndex - previousIndex - 1;
    const sliceMs = Math.max(80, (nextStart - previousEnd) / Math.max(missingCount, 1));
    const offset = index - previousIndex - 1;
    const startMs = Math.max(0, Math.round(previousEnd + sliceMs * offset));
    const endMs = Math.min(durationMs, Math.max(startMs + 80, Math.round(startMs + sliceMs)));

    timings[index] = {
      wordIndex: params.wordStartIndex + index,
      startMs,
      endMs,
    };
  }

  return timings.filter((timing): timing is TtsAlignmentWord => Boolean(timing));
}

export function alignTtsTokensToWords(params: {
  words: NoteTtsWord[];
  tokens: TtsAlignmentToken[];
  wordStartIndex: number;
  durationMs: number;
}) {
  const transcriptPieces = collectTranscriptPieces(params.tokens);
  const timings: Array<TtsAlignmentWord | null> = Array.from({ length: params.words.length }, () => null);
  let tokenIndex = 0;

  for (const [wordOffset, word] of params.words.entries()) {
    const target = normalizeAlignmentText(word.text);

    if (!target) {
      continue;
    }

    let bestMatch:
      | {
          startPieceIndex: number;
          endPieceIndex: number;
        }
      | null = null;

    for (
      let candidateStart = tokenIndex;
      candidateStart < Math.min(transcriptPieces.length, tokenIndex + 8);
      candidateStart += 1
    ) {
      let accumulated = "";

      for (
        let candidateEnd = candidateStart;
        candidateEnd < Math.min(transcriptPieces.length, candidateStart + 8);
        candidateEnd += 1
      ) {
        accumulated += transcriptPieces[candidateEnd].text;

        if (accumulated === target || accumulated.includes(target) || target.includes(accumulated)) {
          bestMatch = {
            startPieceIndex: candidateStart,
            endPieceIndex: candidateEnd,
          };

          if (accumulated === target) {
            break;
          }
        }

        if (accumulated.length > target.length + 8) {
          break;
        }
      }

      if (bestMatch) {
        break;
      }
    }

    if (!bestMatch) {
      continue;
    }

    const startPiece = transcriptPieces[bestMatch.startPieceIndex];
    const endPiece = transcriptPieces[bestMatch.endPieceIndex];
    timings[wordOffset] = {
      wordIndex: word.index,
      startMs: Math.max(0, Math.round(startPiece.startMs)),
      endMs: Math.max(startPiece.startMs + 80, Math.round(endPiece.endMs)),
    };
    tokenIndex = bestMatch.endPieceIndex + 1;
  }

  return interpolateMissingTimings({
    timings,
    wordStartIndex: params.wordStartIndex,
    durationMs: params.durationMs,
  });
}
