import assert from "node:assert/strict";
import test from "node:test";

import { classifyImageOcrText, isLabelOnlyOcrReading } from "../src/lib/scan-ocr-text.ts";

/*
 * A learner photographed a circuit diagram on a whiteboard on 2026-10-18. Both verbatim readers
 * copied its labels and nothing else, the restatement was skipped as "thin text will not grow",
 * and the note failed as having nothing to study. The restatement describes the drawing, so a
 * reading of labels alone must still reach it. These fixtures are written from scratch.
 */

const DIAGRAM_LABELS = "L\n\nR1\n\nT2\n\n7\n8\n\nQ1\nQ2\n\n7 (31, 21)\n\nB1\nB2\n\nN";
const MAP_LEGEND = "A\nB\nC\n1 : 50 000\nN\nS\nV\nZ";

test("a diagram's labels are a thin reading, and a label-only one", () => {
  assert.deepEqual(classifyImageOcrText(DIAGRAM_LABELS), { acceptable: false, rejection: "too_short" });
  assert.equal(isLabelOnlyOcrReading(DIAGRAM_LABELS), true);
  assert.equal(isLabelOnlyOcrReading(MAP_LEGEND), true);
});

test("a thin page of real words is not label-only, so it is kept as it is", () => {
  assert.equal(isLabelOnlyOcrReading("Fotosinteza"), false);
  assert.equal(isLabelOnlyOcrReading("Izračunaj ploščino trikotnika s stranicama 3 cm in 4 cm."), false);
  assert.equal(isLabelOnlyOcrReading("Vaja 4"), false);
});

/*
 * A labelling worksheet photographed on 2026-10-21: a heading over numbered drawings. The verbatim
 * reader returned the heading and the numbers, the restatement was skipped because the heading is
 * a word, and the note failed as having nothing to study. Written from scratch, same shape.
 */
const LABELLING_SHEET = ["KUHINJSKI PRIBOR", ...Array.from({ length: 18 }, (_, index) => String(index + 1))].join("\n\n");

test("a heading over a column of numbered labels is label-only", () => {
  assert.deepEqual(classifyImageOcrText(LABELLING_SHEET), { acceptable: false, rejection: "too_short" });
  assert.equal(isLabelOnlyOcrReading(LABELLING_SHEET), true);
});

test("a short exercise with a few numbers is still real words", () => {
  assert.equal(isLabelOnlyOcrReading("Naloga 1\n2 + 3 =\n4 + 5 =\n6 + 7 ="), false);
  assert.equal(isLabelOnlyOcrReading("Seštej števila.\n12\n15\n18\n21\n24\n27\nKoliko dobiš?"), false);
});

test("an empty reading is not a label-only one", () => {
  assert.equal(isLabelOnlyOcrReading(""), false);
  assert.equal(isLabelOnlyOcrReading("   \n "), false);
});
