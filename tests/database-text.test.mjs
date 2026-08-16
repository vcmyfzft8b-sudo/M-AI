import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeJsonForDatabase,
  stripUnstorableCharacters,
} from "../src/lib/database-text.ts";

// Written as escapes on purpose: these characters are invisible in an editor, and a stray
// literal one in this file would make the test pass for the wrong reason.
const NUL = String.fromCharCode(0x0000);
const LONE_HIGH_SURROGATE = String.fromCharCode(0xd800);
const LONE_LOW_SURROGATE = String.fromCharCode(0xdc00);

test("strips the U+0000 that pdf.js emits for glyphs a PDF font does not map", () => {
  // The shape of the real MEMOAI-WEB-2J payload: a page of extracted PDF text where the
  // unmapped glyphs came back as NUL. Postgres rejects the whole write with
  // "unsupported Unicode escape sequence" if even one survives.
  const extracted = `Poglavje 1${NUL}Uvod v termodinamiko${NUL}`;

  assert.equal(stripUnstorableCharacters(extracted), "Poglavje 1Uvod v termodinamiko");
  assert.ok(!JSON.stringify(stripUnstorableCharacters(extracted)).includes("\\u0000"));
});

test("strips lone surrogates, which cannot be encoded as JSON at all", () => {
  assert.equal(stripUnstorableCharacters(`a${LONE_HIGH_SURROGATE}b`), "ab");
  assert.equal(stripUnstorableCharacters(`a${LONE_LOW_SURROGATE}b`), "ab");
  assert.ok(
    JSON.stringify(stripUnstorableCharacters(`a${LONE_HIGH_SURROGATE}b`)).isWellFormed(),
  );
});

test("keeps everything a real document legitimately contains", () => {
  const source = "Črtomir je rekel: „Ž ≥ 5 °C —\ttab\nnewline\" 😀 中文 𐀀 é";

  assert.equal(stripUnstorableCharacters(source), source);
});

test("cleans strings, keys and nested values on their way into a jsonb column", () => {
  const processingMetadata = {
    manualImport: {
      sourceType: "pdf",
      titleHint: `Skripta${NUL}`,
      text: `Stran 1${NUL}Stran 2`,
      blocks: [
        { label: `Stran${NUL} 1`, pageNumber: 1, text: `Vsebina${NUL}` },
        { label: null, pageNumber: 2, text: "Vsebina" },
      ],
      modelMetadata: { [`sourceFileName${NUL}`]: `skripta${NUL}.pdf` },
    },
    processing: { stage: "queued", updatedAt: "2026-08-16T17:30:52.204Z", errorMessage: null },
  };

  const sanitized = sanitizeJsonForDatabase(processingMetadata);

  assert.deepEqual(sanitized, {
    manualImport: {
      sourceType: "pdf",
      titleHint: "Skripta",
      text: "Stran 1Stran 2",
      blocks: [
        { label: "Stran 1", pageNumber: 1, text: "Vsebina" },
        { label: null, pageNumber: 2, text: "Vsebina" },
      ],
      modelMetadata: { sourceFileName: "skripta.pdf" },
    },
    processing: { stage: "queued", updatedAt: "2026-08-16T17:30:52.204Z", errorMessage: null },
  });
  assert.ok(!JSON.stringify(sanitized).includes("\\u0000"));
});

test("leaves non-string leaves alone", () => {
  const date = new Date("2026-08-16T17:30:52.204Z");
  const sanitized = sanitizeJsonForDatabase({
    createInitialAudio: true,
    initialAudioVoice: null,
    durationSeconds: 412,
    updatedAt: date,
    missing: undefined,
  });

  assert.deepEqual(sanitized, {
    createInitialAudio: true,
    initialAudioVoice: null,
    durationSeconds: 412,
    updatedAt: date,
    missing: undefined,
  });
  assert.equal(sanitized.updatedAt, date);
});

test("is stateless across calls", () => {
  // A /g regex kept on the module scope carries lastIndex between calls if it is ever used
  // with .test() or .exec(); this asserts repeated .replace() use stays correct.
  const value = `a${NUL}b${NUL}c`;

  assert.equal(stripUnstorableCharacters(value), "abc");
  assert.equal(stripUnstorableCharacters(value), "abc");
  assert.equal(stripUnstorableCharacters(value), "abc");
});
