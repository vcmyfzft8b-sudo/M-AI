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

test("each diagram of a multi-topic handout claims its own section", () => {
  // The end-to-end case, with the strings a staging run actually produced. Placement looking
  // right is not enough on its own: images that score nothing are spread evenly through the note,
  // which on a document whose topics happen to run in the same order as the note looks identical
  // to relevance working. These margins are what tell the two apart.
  const images = {
    mitoza: {
      description:
        "Ta slika prikazuje faze mitoze, ki se imenujejo profaza, metafaza, anafaza in telofaza.",
      contextText:
        "Mitoza je delitev, pri kateri iz ene celice nastaneta dve gensko enaki celici. Poteka v štirih fazah: profaza, metafaza, anafaza in telofaza.",
    },
    srce: {
      description: "Diagram prikazuje pretok krvi skozi prekate srca.",
      contextText:
        "Srce ima štiri prekate: dva atrija in dva ventrikla. Zaklopke preprečujejo vračanje krvi nazaj.",
    },
    // Left in English on purpose: the model does not always honour the language instruction, and
    // the Slovene contextText beside it has to carry the match on its own.
    encimi: {
      description: "diagram shows substrate binding to an enzyme, forming an enzyme-substrate complex.",
      contextText:
        "Encimi so beljakovinski katalizatorji. Delujejo tako, da znižajo aktivacijsko energijo reakcije. Substrat se veže na aktivno mesto encima.",
    },
  };

  const noteBlocks = {
    mitoza:
      "Mitoza je celična delitev, pri kateri iz ene materinske celice nastaneta dve gensko enaki hčerinski celici z ohranjenim številom kromosomov.",
    srce: "Zaklopke uravnavajo vračanje krvi nazaj v prejšnji prekat. Sinusni vozel se nahaja v desnem atriju in uravnava ritem srčnega utripa.",
    encimi:
      "Encimi so beljakovinski katalizatorji, ki pospešujejo biokemijske reakcije tako, da znižujejo njihovo aktivacijsko energijo.",
    uvod: "Gradivo obravnava tri temeljne biološke stebre: delitev celic, mehaniko črpanja krvi skozi srce ter delovanje pospeševalcev biokemijskih reakcij.",
  };

  for (const [topic, image] of Object.entries(images)) {
    const ranked = Object.entries(noteBlocks)
      .map(([name, text]) => [name, scoreBlockForImage({ blockText: text, image })])
      .sort((left, right) => right[1] - left[1]);

    assert.equal(ranked[0][0], topic, `${topic} image landed on ${ranked[0][0]}`);
    // Comfortably over the placement threshold, so it is placed on evidence rather than spread.
    assert.ok(ranked[0][1] > 2, `${topic} scored only ${ranked[0][1].toFixed(2)}`);
    // A note's overview paragraph names every topic, so it is expected to score moderately for
    // all of them; what matters is that the section actually about the image wins clearly.
    assert.ok(
      ranked[0][1] > ranked[1][1] * 1.5,
      `${topic}: ${ranked[0][1].toFixed(2)} is not a clear win over ${ranked[1][0]} ${ranked[1][1].toFixed(2)}`,
    );
  }
});
