import assert from "node:assert/strict";
import test from "node:test";

import { scoreBlockForImage } from "../src/lib/note-image-relevance.ts";

const mitosisImage = {
  description: "Diagram prikazuje štiri faze mitoze: profaza, metafaza, anafaza in telofaza.",
  contextText:
    "Mitoza je delitev, pri kateri iz ene celice nastaneta dve gensko enaki hčerinski celici. Poteka v štirih fazah.",
};

const mitosisBlock =
  "Mitoza poteka v štirih fazah. V profazi se kromosomi skrčijo, v metafazi se postavijo v ekvatorialno ravnino, v anafazi se kromatidi ločijo, v telofazi pa nastaneta dve jedri.";

// The section that used to win everything: longest in the note, and about something else.
const longEnzymeBlock =
  "Encimi so beljakovinski katalizatorji, ki pospešujejo kemijske reakcije v celicah tako, da znižajo aktivacijsko energijo. Substrat se veže na aktivno mesto encima, pri čemer nastane kompleks encim-substrat, ki se nato razgradi na produkte. Encim se med reakcijo ne porabi in ostane nespremenjen, zato lahko katalizira mnogo zaporednih reakcij. Hitrost encimske reakcije je odvisna od temperature, pH vrednosti, koncentracije substrata in prisotnosti zaviralcev. Pri previsoki temperaturi encim denaturira in izgubi svojo tridimenzionalno obliko, s tem pa tudi delovanje. Celice uravnavajo delovanje encimov z aktivatorji in inhibitorji, kar omogoča natančno usklajevanje presnovnih poti v organizmu.";

test("an image goes to the paragraph it is about, not to the longest one", () => {
  // The regression this guards: a raw hit sum made the longest section win every image in the
  // document, so a three-page handout put its heart and mitosis diagrams under enzymes.
  const onTopic = scoreBlockForImage({ blockText: mitosisBlock, image: mitosisImage });
  const offTopic = scoreBlockForImage({ blockText: longEnzymeBlock, image: mitosisImage });

  assert.ok(onTopic > offTopic, `on-topic ${onTopic} should beat off-topic ${offTopic}`);
});

test("length alone cannot win: padding a paragraph lowers its claim on an image", () => {
  const focused = scoreBlockForImage({ blockText: mitosisBlock, image: mitosisImage });
  const padded = scoreBlockForImage({
    blockText: `${mitosisBlock} ${longEnzymeBlock}`,
    image: mitosisImage,
  });

  assert.ok(padded < focused, `padded ${padded} should not beat focused ${focused}`);
});

test("a paragraph with nothing in common scores near zero", () => {
  const unrelated = scoreBlockForImage({
    blockText: "Stopnja brezposelnosti se je v drugem četrtletju znižala za pol odstotne točke.",
    image: mitosisImage,
  });

  assert.ok(unrelated < 0.9, `unrelated block scored ${unrelated}`);
});

test("inflected forms still match, because Slovene rarely repeats a word unchanged", () => {
  // "celici" in the image text vs "celica"/"celico" in the note: whole-word equality would miss
  // every one of these, which is why substring hits are kept at a lower weight.
  const score = scoreBlockForImage({
    blockText: "Vsaka celica vsebuje kromosome, ki se pred delitvijo podvojijo.",
    image: { description: "Diagram celice s kromosomi", contextText: "Celice in kromosomi." },
  });

  assert.ok(score > 0, "inflected forms should still register");
});

test("an image with no text to match on claims nothing", () => {
  assert.equal(scoreBlockForImage({ blockText: mitosisBlock, image: {} }), 0);
  assert.equal(
    scoreBlockForImage({ blockText: mitosisBlock, image: { description: "", contextText: null } }),
    0,
  );
});
