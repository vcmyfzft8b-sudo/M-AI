import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTtsPiecesFromCharacterTimestamps,
  getCharacterTimestampsEndMs,
} from "../src/lib/note-tts-alignment.ts";

// One frame per audio packet, each carrying the characters spoken in it — the shape the Soniox
// TTS WebSocket sends when return_timestamps is on.
function frame(text, startSeconds, stepSeconds) {
  const characters = [...text];

  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => startSeconds + i * stepSeconds),
    character_end_times_seconds: characters.map((_, i) => startSeconds + (i + 1) * stepSeconds),
  };
}

test("groups characters into whitespace-delimited pieces with exact timings", () => {
  const pieces = buildTtsPiecesFromCharacterTimestamps([frame("Foto sinteza", 0, 0.1)]);

  assert.deepEqual(pieces, [
    { text: "Foto", start_ms: 0, end_ms: 400 },
    { text: "sinteza", start_ms: 500, end_ms: 1200 },
  ]);
});

test("a word split across two frames stays one piece", () => {
  const pieces = buildTtsPiecesFromCharacterTimestamps([
    frame("pretvar", 0, 0.1),
    frame("jajo CO2.", 0.7, 0.1),
  ]);

  assert.equal(pieces[0].text, "pretvarjajo");
  assert.equal(pieces[0].start_ms, 0);
  assert.equal(pieces[0].end_ms, 1100);
  assert.equal(pieces[1].text, "CO2.");
});

test("punctuation stays attached and newlines break pieces like spaces", () => {
  const pieces = buildTtsPiecesFromCharacterTimestamps([frame("a,\nb", 0, 0.1)]);

  assert.deepEqual(
    pieces.map((piece) => piece.text),
    ["a,", "b"],
  );
});

test("end time is the latest character end across frames", () => {
  assert.equal(getCharacterTimestampsEndMs([frame("ab", 0, 0.1), frame("c", 3, 0.25)]), 3250);
  assert.equal(getCharacterTimestampsEndMs([]), 0);
});

test("tolerates a frame whose arrays disagree in length", () => {
  const pieces = buildTtsPiecesFromCharacterTimestamps([
    { characters: ["a", "b", "c"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] },
  ]);

  assert.deepEqual(pieces, [{ text: "ab", start_ms: 0, end_ms: 200 }]);
});
