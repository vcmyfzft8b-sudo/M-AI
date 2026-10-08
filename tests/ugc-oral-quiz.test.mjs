import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ORAL_QUIZ_SCRIPTS, oralQuizSpoken, oralQuizWords } from "../src/lib/ugc/oral-quiz.ts";
import { LOCALES } from "../src/lib/i18n/locales.ts";

const root = (relativePath) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
const timings = JSON.parse(readFileSync(root("src/lib/ugc/oral-quiz-timings.json"), "utf8"));

/*
 * The UGC oral quiz highlights word N of a line while the recording is on
 * word N, so a line edited without re-running scripts/generate-oral-quiz-clips.mjs
 * would light up the wrong words. These fail until the recordings match the script.
 */
test("every app language has an oral quiz script", () => {
  assert.deepEqual(Object.keys(ORAL_QUIZ_SCRIPTS).sort(), [...LOCALES].sort());
});

test("every tutor line has a recording with one timing per printed word", () => {
  for (const locale of LOCALES) {
    for (const turn of ORAL_QUIZ_SCRIPTS[locale].turns) {
      if (turn.speaker !== "tutor") {
        continue;
      }

      const clip = timings.scripts[locale]?.[turn.clip];
      assert.ok(clip, `${locale} clip ${turn.clip} has no timings`);
      assert.equal(clip.words.length, oralQuizWords(turn.text).length, `${locale} clip ${turn.clip}`);
      assert.ok(
        existsSync(root(`public/ugc/oral-quiz/${locale}/${timings.voice.toLowerCase()}-${turn.clip}.mp3`)),
        `${locale} clip ${turn.clip} has no recording`,
      );
    }
  }
});

test("the voice says the same number of words the screen prints", () => {
  for (const locale of LOCALES) {
    for (const turn of ORAL_QUIZ_SCRIPTS[locale].turns) {
      assert.equal(oralQuizWords(oralQuizSpoken(locale, turn.text)).length, oralQuizWords(turn.text).length);
    }
  }
});

test("the mnemonic stays English in every language", () => {
  for (const locale of LOCALES) {
    const { title, turns } = ORAL_QUIZ_SCRIPTS[locale];

    assert.match(title, /D-I-C-K/);
    assert.match(turns.map((turn) => turn.text).join(" "), /\bDICK\b.*\bKayexalate\b/, locale);
  }
});
