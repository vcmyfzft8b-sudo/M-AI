import assert from "node:assert/strict";
import test from "node:test";

import { JsonStringFieldScanner } from "../src/lib/ai/stream-json.ts";

/** Feeds a whole document one character at a time — the worst case a stream can produce. */
function pushOneByOne(scanner, text) {
  let out = "";
  for (const char of text) {
    out += scanner.push(char);
  }
  return out;
}

test("reads the field's value out of a complete document", () => {
  const scanner = new JsonStringFieldScanner("answer");
  const emitted = scanner.push('{"answer":"Trg je v ravnovesju.","citations":[]}');

  assert.equal(emitted, "Trg je v ravnovesju.");
  assert.equal(scanner.text, "Trg je v ravnovesju.");
  assert.equal(scanner.isComplete, true);
});

test("emits only the newly revealed text on each chunk", () => {
  const scanner = new JsonStringFieldScanner("answer");

  assert.equal(scanner.push('{"answer":"Cena '), "Cena ");
  assert.equal(scanner.push("pade"), "pade");
  assert.equal(scanner.push('."}'), ".");
  assert.equal(scanner.text, "Cena pade.");
  assert.equal(scanner.isComplete, true);
});

test("survives the key being split across chunks", () => {
  const scanner = new JsonStringFieldScanner("answer");

  scanner.push('{"ans');
  scanner.push('wer"');
  scanner.push(" : ");
  const emitted = scanner.push('"Da."}');

  assert.equal(emitted, "Da.");
  assert.equal(scanner.text, "Da.");
});

test("decodes escapes, including ones split mid-sequence", () => {
  const scanner = new JsonStringFieldScanner("answer");

  pushOneByOne(scanner, '{"answer":"Prva\\nDruga \\"v narekovajih\\" in \\\\ ter \\u010d.');
  assert.equal(scanner.text, 'Prva\nDruga "v narekovajih" in \\ ter č.');

  // A trailing backslash must not be emitted until its payload arrives.
  scanner.push("\\");
  assert.equal(scanner.text, 'Prva\nDruga "v narekovajih" in \\ ter č.');
  assert.equal(scanner.push("t"), "\t");
});

test("an escaped quote does not end the value", () => {
  const scanner = new JsonStringFieldScanner("answer");
  scanner.push('{"answer":"Rekel je \\"ne\\" in odšel.","citations":[]}');

  assert.equal(scanner.text, 'Rekel je "ne" in odšel.');
  assert.equal(scanner.isComplete, true);
});

test("stops at the closing quote and ignores the rest of the document", () => {
  const scanner = new JsonStringFieldScanner("answer");
  scanner.push('{"answer":"Kratko.","citations":[{"idx":1,"quote":"ne to"}]}');

  assert.equal(scanner.text, "Kratko.");
  assert.equal(scanner.push('{"answer":"drugo"}'), "");
  assert.equal(scanner.text, "Kratko.");
});

test("skips a preamble longer than the lookbehind window", () => {
  const scanner = new JsonStringFieldScanner("answer");
  const preamble = `{"padding":"${"x".repeat(500)}",`;

  assert.equal(pushOneByOne(scanner, preamble), "");
  assert.equal(scanner.push('"answer":"Najdeno."}'), "Najdeno.");
});

test("is not fooled by the field name appearing inside an earlier value", () => {
  const scanner = new JsonStringFieldScanner("answer");
  // The decoy is escaped inside another string, so the real key is the match.
  scanner.push('{"note":"glej \\"answer\\": spodaj","answer":"Pravi."}');

  assert.equal(scanner.text, "Pravi.");
});

test("an empty value completes without emitting anything", () => {
  const scanner = new JsonStringFieldScanner("answer");

  assert.equal(scanner.push('{"answer":""}'), "");
  assert.equal(scanner.text, "");
  assert.equal(scanner.isComplete, true);
});
