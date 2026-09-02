// Character-level timestamps from the Soniox TTS WebSocket, turned into the word-sized pieces the
// alignment in note-tts.ts matches against. Kept free of "@/" imports so the unit tests can load it.

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
