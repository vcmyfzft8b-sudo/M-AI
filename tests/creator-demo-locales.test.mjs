import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The `/creator` demo in every language the app ships in.
 *
 * Creators record the demo in their own market's language, and the app around
 * the notes already follows the reader's locale. The notes themselves used to be
 * Slovenian only, so a Serbian creator recorded a Serbian app full of Slovenian
 * study material. Each language now carries its own copy of the material
 * (`src/lib/creator-demo/locales`), and this holds every copy to the Slovenian
 * source: same notes, same number of cards and questions in the same places,
 * every figure and highlight still anchored, and the text actually in the
 * language it claims to be.
 */

const LOCALES = ["sl", "en", "hr", "bs", "sr"];
const RECORD_PACK_KEY = "mikroekonomija";

/*
 * Which language a note is written in, by words that are common in one and
 * absent from the others. Deliberately cruder than `detectSourceLanguage`,
 * whose thresholds are tuned for uploads and return nothing for a markdown
 * note; this only has to tell five known languages apart.
 */
const MARKERS = {
  sl: ["ki", "oziroma", "kjer", "lahko", "tudi", "zato", "vendar", "kot", "če", "zakaj"],
  bcs: ["što", "šta", "koji", "koja", "koje", "kada", "jer", "nakon", "kao", "ako", "zašto"],
  en: ["the", "and", "of", "that", "with", "which", "is", "are", "when", "why"],
};
const EKAVIAN = ["vreme", "pre", "posle", "primer", "deo", "beleške", "mesto", "uvek", "gde", "greška", "reč", "cena", "ceni", "cene", "celu", "veći", "više", "deli"];
const IJEKAVIAN = ["vrijeme", "prije", "poslije", "primjer", "dio", "bilješke", "mjesto", "uvijek", "gdje", "pogreška", "riječ", "cijena", "cijeni", "cijene", "cijelu", "dijeli"];
/* Each of the three is ijekavian or ekavian, but these words give away which country wrote it. */
const NOT_IN = {
  hr: ["historija", "historijsk", "hiljad", "sedmic", "hljeb", "hleb", "nedelj"],
  bs: ["povijest", "povijesn", "tisuć", "tjedan", "kruh", "nedelj"],
  sr: ["povijest", "povijesn", "tisuć", "tjedan", "kruh", "hljeb"],
};

function languageOf(text) {
  const words = text.toLowerCase().replace(/[^\p{Letter}\s]+/gu, " ").split(/\s+/).filter(Boolean);
  const count = (list) => words.filter((word) => list.includes(word)).length;
  const ranked = Object.entries(MARKERS)
    .map(([language, list]) => [language, count(list)])
    .sort((a, b) => b[1] - a[1]);
  const best = ranked[0][0];

  if (best !== "bcs") {
    return best;
  }

  if (count(EKAVIAN) > count(IJEKAVIAN)) {
    return "sr";
  }

  const lower = text.toLowerCase();
  return NOT_IN.bs.some((stem) => lower.includes(stem)) ? "hr" : "bs";
}

function assertWrittenIn(locale, text, where) {
  const detected = languageOf(text);
  const lower = text.toLowerCase();

  if (locale === "hr" || locale === "bs") {
    assert.ok(detected === "hr" || detected === "bs", `${where}: reads as "${detected}", not ${locale}`);
  } else {
    assert.equal(detected, locale, `${where}: reads as "${detected}", not ${locale}`);
  }

  for (const stem of NOT_IN[locale] ?? []) {
    assert.ok(!lower.includes(stem), `${where}: "${stem}" is not ${locale} usage`);
  }
}
const contentFor = async (locale) => {
  const exports = await import(`../src/lib/creator-demo/locales/${locale}.ts`);
  return exports[`${locale.toUpperCase()}_DEMO_CONTENT`];
};

const publicFile = (relative) =>
  fileURLToPath(new URL(`../public/creator-demo/${relative}`, import.meta.url));

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

const source = await contentFor("sl");

for (const locale of LOCALES) {
  test(`creator demo content: ${locale} exists and matches the Slovenian structure`, async () => {
    const content = await contentFor(locale);
    assert.ok(content, `locales/${locale}.ts must export ${locale.toUpperCase()}_DEMO_CONTENT`);

    assert.deepEqual(
      content.packs.map((pack) => pack.key),
      source.packs.map((pack) => pack.key),
    );
    assert.deepEqual(Object.keys(content.folderNames).sort(), Object.keys(source.folderNames).sort());

    content.packs.forEach((pack, packIndex) => {
      const sl = source.packs[packIndex];
      const where = `${locale}/${pack.key}`;

      assert.equal(pack.sourceType, sl.sourceType, where);
      assert.equal(pack.durationSeconds, sl.durationSeconds, where);
      assert.equal(pack.pageCount, sl.pageCount, where);

      for (const field of ["keyTopics", "sections", "images", "flashcards", "quiz", "practice", "transcript", "chatAnswers"]) {
        assert.equal(pack[field].length, sl[field].length, `${where}: ${field} count`);
      }

      pack.flashcards.forEach((card, index) => {
        assert.equal(card.sectionIdx, sl.flashcards[index].sectionIdx, `${where}: card ${index} section`);
        assert.equal(card.difficulty, sl.flashcards[index].difficulty, `${where}: card ${index} difficulty`);
        assert.equal(Boolean(card.hint), Boolean(sl.flashcards[index].hint), `${where}: card ${index} hint`);
      });

      pack.quiz.forEach((question, index) => {
        assert.equal(question.options.length, 4, `${where}: quiz ${index} options`);
        assert.equal(question.correctOptionIdx, sl.quiz[index].correctOptionIdx, `${where}: quiz ${index} answer`);
        assert.equal(question.difficulty, sl.quiz[index].difficulty, `${where}: quiz ${index} difficulty`);
      });

      pack.practice.forEach((question, index) => {
        assert.equal(question.difficulty, sl.practice[index].difficulty, `${where}: practice ${index}`);
      });

      pack.transcript.forEach((segment, index) => {
        assert.equal(segment.startMs, sl.transcript[index].startMs, `${where}: transcript ${index}`);
        assert.equal(segment.endMs, sl.transcript[index].endMs, `${where}: transcript ${index}`);
      });

      pack.images.forEach((image, index) => {
        assert.ok(
          pack.notesMd.includes(image.afterText),
          `${where}: figure ${index} anchor "${image.afterText}" is not in the note`,
        );
        assert.ok(existsSync(publicFile(image.file)), `${where}: missing public/creator-demo/${image.file}`);

        if (locale !== "sl") {
          assert.ok(image.file.startsWith(`${locale}/`), `${where}: figure ${index} must use the ${locale} copy`);
        }
      });

      assertWrittenIn(locale, pack.notesMd, `${where}: note`);
      assertWrittenIn(
        locale,
        [
          pack.title,
          pack.summary,
          ...pack.flashcards.flatMap((card) => [card.front, card.back]),
          ...pack.quiz.flatMap((question) => [question.prompt, ...question.options, question.explanation]),
          ...pack.practice.flatMap((question) => [question.prompt, question.answerGuide, question.expectedAnswer]),
          ...pack.chatAnswers,
        ].join(" "),
        `${where}: study material`,
      );
    });

    const record = content.packs.find((pack) => pack.key === RECORD_PACK_KEY).notesMd;

    assert.equal(content.liveFigures.length, source.liveFigures.length);
    content.liveFigures.forEach((figure, index) => {
      assert.ok(record.includes(figure.anchor), `${locale}: live figure ${index} anchor "${figure.anchor}" is not in the note`);
      assert.ok(existsSync(publicFile(figure.file)), `${locale}: missing public/creator-demo/${figure.file}`);
    });

    assert.deepEqual(
      content.liveHighlights.map((highlight) => highlight.color),
      source.liveHighlights.map((highlight) => highlight.color),
    );
    content.liveHighlights.forEach(({ phrase }) => {
      assert.equal(occurrences(record, phrase), 1, `${locale}: highlight "${phrase}" must occur exactly once`);
    });

    assert.deepEqual(
      content.podcastTurns.map((turn) => turn.speaker),
      source.podcastTurns.map((turn) => turn.speaker),
    );
  });
}

test("translated figures are translated, not copied", async () => {
  for (const locale of LOCALES.filter((entry) => entry !== "sl")) {
    const content = await contentFor(locale);
    const files = new Set([
      ...content.packs.flatMap((pack) => pack.images.map((image) => image.file)),
      ...content.liveFigures.map((figure) => figure.file),
    ]);

    for (const file of files) {
      assert.ok(file.startsWith(`${locale}/`), `${locale}: ${file} must be the ${locale} copy`);
      const original = readFileSync(publicFile(file.slice(locale.length + 1)), "utf8");
      assert.notEqual(readFileSync(publicFile(file), "utf8"), original, `${locale}: ${file} is the Slovenian figure`);
    }
  }
});
