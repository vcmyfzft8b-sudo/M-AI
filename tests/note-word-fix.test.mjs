import assert from "node:assert/strict";
import test from "node:test";

import {
  countNoteWord,
  matchNoteWordCase,
  normalizeNoteWordFixInput,
  remapNoteAnnotations,
  replaceNoteWord,
  replaceNoteWordInJson,
  validateNoteWordFix,
} from "../src/lib/note-word-fix.ts";
import { parseNoteTtsDocument } from "../src/lib/note-tts-text.ts";

/*
 * "Fix a word" (October 2026 feedback): a learner corrects a name the reader got wrong, everywhere
 * in one note. These pin what counts as the word, how its case survives, and where highlights
 * land when the number of words changes.
 */

test("only whole words match, in any case, Slovene letters included", () => {
  const text = "Steljnice so preproste. Med steljnice štejemo alge; steljnicema ne.";
  const result = replaceNoteWord(text, "steljnice", "steljčnice");

  assert.equal(result.count, 2);
  assert.equal(result.text, "Steljčnice so preproste. Med steljčnice štejemo alge; steljnicema ne.");
});

test("a letter with a caron is part of the word, not a boundary", () => {
  // "č" after "Krk" must not make "Krk" a separate word.
  assert.equal(countNoteWord("Krkač je reka, Krk je otok.", "Krk"), 1);
  assert.equal(countNoteWord("Ključ do uspeha", "Klju"), 0);
});

test("the case the note used survives the fix", () => {
  assert.equal(matchNoteWordCase("STELJNICE", "steljčnice"), "STELJČNICE");
  assert.equal(matchNoteWordCase("Steljnice", "steljčnice"), "Steljčnice");
  assert.equal(matchNoteWordCase("steljnice", "steljčnice"), "steljčnice");
  // The learner's own capital wins: a case-only fix must be possible.
  assert.equal(replaceNoteWord("podjetje krka", "krka", "Krka").text, "podjetje Krka");
});

test("a phrase matches across any whitespace and can change its length", () => {
  const result = replaceNoteWord("Rojen v Novo\nmesto, živel v Novo mesto.", "Novo mesto", "Ljubljana");

  assert.equal(result.count, 2);
  assert.equal(result.text, "Rojen v Ljubljana, živel v Ljubljana.");
});

test("link addresses are left alone, link text is fixed", () => {
  const result = replaceNoteWord("[Krk](https://sl.wikipedia.org/wiki/Krk) je otok", "Krk", "Krka");

  assert.equal(result.text, "[Krka](https://sl.wikipedia.org/wiki/Krk) je otok");
  assert.equal(result.count, 1);
});

test("regex characters in the word are taken literally", () => {
  assert.equal(replaceNoteWord("C++ in C#", "C++", "Java").text, "Java in C#");
  assert.equal(countNoteWord("a.b in axb", "a.b"), 1);
});

test("inputs are normalised and validated", () => {
  assert.equal(normalizeNoteWordFixInput("  čebela   matica "), "čebela matica");
  assert.equal(validateNoteWordFix("Krk", "Krk"), "unchanged");
  assert.equal(validateNoteWordFix("krka", "Krka"), null);
  assert.equal(validateNoteWordFix("", "Krka"), "empty");
  assert.equal(validateNoteWordFix("...", "Krka"), "empty");
  assert.equal(validateNoteWordFix("Krk", "a\nb"), "multiline");
  assert.equal(validateNoteWordFix("Krk", "x".repeat(81)), "too_long");
});

test("strings inside JSON are fixed, ids and keys are not", () => {
  const map = { title: "Krk", branches: [{ id: "Krk-1", label: "Otok Krk", detail: "Krk leži", children: [] }] };
  const { value, count } = replaceNoteWordInJson(map, "Krk", "Cres");

  assert.equal(count, 3);
  assert.deepEqual(value, {
    title: "Cres",
    branches: [{ id: "Krk-1", label: "Otok Cres", detail: "Cres leži", children: [] }],
  });
  assert.equal(replaceNoteWordInJson(map, "Rab", "Pag").value, map);
});

function words(markdown) {
  return parseNoteTtsDocument(markdown).words.map((word) => word.text);
}

function annotation(id, startWordIndex, endWordIndex) {
  return { id, kind: "highlight", startWordIndex, endWordIndex, colorId: "yellow", createdAt: "2026-10-04T00:00:00.000Z" };
}

test("a one-for-one fix keeps every highlight where it was", () => {
  const before = "## Rastline\n\nSteljnice so preproste. Brstnice so kompleksne.";
  const after = replaceNoteWord(before, "Steljnice", "Steljčnice").text;
  const marks = [annotation("a", 1, 3), annotation("b", 4, 6)];

  assert.deepEqual(remapNoteAnnotations(marks, words(before), words(after)), marks);
});

test("a fix that adds words moves the highlights after it", () => {
  const before = "Rojen v Novo mesto. Živel je v Kopru. Umrl je v Kranju.";
  const after = replaceNoteWord(before, "Novo mesto", "Novo mesto ob Krki").text;
  const oldWords = words(before);
  const newWords = words(after);
  // "Živel je v Kopru" is words 4..7 before and 6..9 after.
  const remapped = remapNoteAnnotations([annotation("later", 4, 7)], oldWords, newWords);

  assert.deepEqual(newWords.slice(remapped[0].startWordIndex, remapped[0].endWordIndex + 1), ["Živel", "je", "v", "Kopru"]);
});

test("a highlight on the fixed words covers their replacement", () => {
  const before = "Rojen v Novo mesto leta 1950.";
  const after = replaceNoteWord(before, "Novo mesto", "Ljubljana").text;
  const newWords = words(after);
  const [remapped] = remapNoteAnnotations([annotation("place", 2, 3)], words(before), newWords);

  assert.deepEqual(newWords.slice(remapped.startWordIndex, remapped.endWordIndex + 1), ["Ljubljana"]);
});

test("a fix that removes words pulls later highlights back", () => {
  const before = "Matija Majar Ziljski je napisal program. Zedinjena Slovenija je bila zahteva.";
  const after = replaceNoteWord(before, "Matija Majar Ziljski", "Majar").text;
  const newWords = words(after);
  const oldWords = words(before);
  const start = oldWords.indexOf("Zedinjena");
  const [remapped] = remapNoteAnnotations([annotation("later", start, start + 1)], oldWords, newWords);

  assert.deepEqual(newWords.slice(remapped.startWordIndex, remapped.endWordIndex + 1), ["Zedinjena", "Slovenija"]);
});

test("highlights on a long note are realigned without a full rebuild", () => {
  const paragraph = "Celica je osnovna enota življenja in Krebsov cikel poteka v mitohondriju. ";
  const before = paragraph.repeat(400);
  const after = replaceNoteWord(before, "Krebsov cikel", "cikel citronske kisline").text;
  const oldWords = words(before);
  const newWords = words(after);
  const last = oldWords.length - 1;
  const [remapped] = remapNoteAnnotations([annotation("end", last, last)], oldWords, newWords);

  assert.equal(remapped.startWordIndex, newWords.length - 1);
  assert.equal(newWords[remapped.startWordIndex], "mitohondriju");
});
