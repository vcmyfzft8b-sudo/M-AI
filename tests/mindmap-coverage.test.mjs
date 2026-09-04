import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNoteSkeleton,
  mergeWindowedBranches,
  MINDMAP_MAX_CHILDREN_PER_TOPIC,
} from "../src/lib/mindmap-merge.ts";
import { planSourceWriteWindows } from "../src/lib/notes/note-prompts.ts";
import {
  parseMindmapDoc,
  countMindmapNodes,
  MINDMAP_LABEL_MAX_WORDS,
  MINDMAP_MAX_NODES,
} from "../src/lib/mindmap-doc.ts";

/*
 * Whether the map covers the material is decided here, not on screen. A note too long for one
 * call is read in windows and merged, and the two ways that goes wrong — a window's topics not
 * lining up with the plan's, and the note's outline being lost on the way into the plan — both
 * look like "the map is a bit thin" rather than like a bug.
 */

function longNote({ sections, wordsPerSection }) {
  const filler = Array.from({ length: wordsPerSection }, (_, index) => `beseda${index}`).join(" ");

  return Array.from(
    { length: sections },
    (_, index) =>
      `## ${index + 1}. Tema ${index + 1}\n\nUvodna poved teme ${index + 1}.\n\n- ${filler}\n`,
  ).join("\n");
}

test("the skeleton keeps every heading of a note far too long to read whole", () => {
  const notes = longNote({ sections: 40, wordsPerSection: 900 });
  const skeleton = buildNoteSkeleton(notes);

  for (let index = 1; index <= 40; index += 1) {
    assert.ok(
      skeleton.includes(`Tema ${index}`),
      `heading ${index} did not survive into the skeleton`,
    );
    assert.ok(skeleton.includes(`Uvodna poved teme ${index}.`), `lead ${index} was dropped`);
  }

  /* And it is small enough to plan from: the point of a skeleton is that its size is the outline's. */
  assert.ok(notes.length > 200_000, "fixture is not the long note this is about");
  assert.ok(skeleton.length < notes.length / 40);
});

test("the skeleton keeps prose and drops the furniture", () => {
  const skeleton = buildNoteSkeleton(
    [
      "## Ravnovesje",
      "",
      "> **Ključno:** to je citat.",
      "",
      "| Drzava | BDP |",
      "| --- | --- |",
      "",
      "Ravnovesje je cena, pri kateri se ponudba in povpraševanje ujameta.",
      "",
      "Druga poved, ki je ne potrebujemo.",
      "",
      "### Primer",
      "",
      "- alineja",
      "",
      "Vstopnica stane 60 EUR.",
    ].join("\n"),
  );

  assert.match(skeleton, /## Ravnovesje/);
  assert.match(skeleton, /Ravnovesje je cena/);
  assert.match(skeleton, /### Primer/);
  /* One lead per heading, not the whole section. */
  assert.doesNotMatch(skeleton, /Druga poved/);
  assert.doesNotMatch(skeleton, /Drzava/);
  assert.doesNotMatch(skeleton, /Ključno/);
  /* A bullet is not the lead, so the sentence after it still counts as one. */
  assert.match(skeleton, /Vstopnica stane 60 EUR\./);
});

test("a long note is windowed rather than cut, so its last page still reaches the map", () => {
  const notes = longNote({ sections: 30, wordsPerSection: 900 });
  const windows = planSourceWriteWindows(notes, 7_000);

  assert.ok(windows.length > 1, "the fixture must be long enough to window");
  assert.ok(
    windows.join("\n\n").includes("Tema 30"),
    "the last section must survive the windowing",
  );
  /* Nothing overlaps: a paragraph belongs to exactly one window. */
  assert.equal(
    windows.reduce((total, window) => total + window.split("beseda0").length - 1, 0),
    30,
  );
});

const TOPICS = [
  { label: "Povpraševanje", brief: "Kupci." },
  { label: "Ponudba", brief: "Prodajalci." },
  { label: "Ravnovesje", brief: "Kje se ujameta." },
];

function child(label, children = []) {
  return { label, detail: "", children };
}

test("every window's answers land in the one agreed topic list", () => {
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      { branches: [{ topic: "Povpraševanje", children: [child("Zakon povpraševanja")] }] },
      {
        branches: [
          { topic: "Ponudba", children: [child("Zakon ponudbe")] },
          { topic: "Povpraševanje", children: [child("Substituti")] },
        ],
      },
      { branches: [{ topic: "Ravnovesje", children: [child("Presežek ponudbe")] }] },
    ],
  });

  /* Ordered by the plan, not by which window answered first. */
  assert.deepEqual(
    branches.map((branch) => branch.label),
    ["Povpraševanje", "Ponudba", "Ravnovesje"],
  );
  assert.deepEqual(
    branches[0].children.map((entry) => entry.label),
    ["Zakon povpraševanja", "Substituti"],
  );
  assert.equal(branches[0].detail, "Kupci.");
});

test("a topic reworded by one window is still that topic, not a new one", () => {
  /*
   * The failure this prevents is the whole reason the topics are planned first: a window that
   * writes "povprasevanje" instead of "Povpraševanje" would otherwise have its contribution
   * silently dropped, and the map would be thin in a way nothing reports.
   */
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      { branches: [{ topic: "povprasevanje", children: [child("Zakon povpraševanja")] }] },
      { branches: [{ topic: "  PONUDBA  ", children: [child("Zakon ponudbe")] }] },
    ],
  });

  assert.equal(branches.length, 2);
  assert.equal(branches[0].children.length, 1);
  assert.equal(branches[1].children.length, 1);
});

test("the same idea seen by two windows is written once", () => {
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      { branches: [{ topic: "Ponudba", children: [child("Zakon ponudbe")] }] },
      { branches: [{ topic: "Ponudba", children: [child("zakon  ponudbe"), child("Davki")] }] },
    ],
  });

  assert.deepEqual(
    branches[0].children.map((entry) => entry.label),
    ["Zakon ponudbe", "Davki"],
  );
});

test("a topic nothing was found for is left out rather than drawn empty", () => {
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [{ branches: [{ topic: "Ponudba", children: [child("Zakon ponudbe")] }] }],
  });

  assert.deepEqual(
    branches.map((branch) => branch.label),
    ["Ponudba"],
  );
});

test("a window that never came back costs its share, not the map", () => {
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      null,
      { branches: [{ topic: "Ravnovesje", children: [child("Presežek ponudbe")] }] },
      null,
    ],
  });

  assert.equal(branches.length, 1);
  assert.equal(branches[0].children.length, 1);
});

test("a topic every window wanted to fill is capped rather than allowed to run", () => {
  const many = Array.from({ length: 30 }, (_, index) => child(`Ideja ${index}`));
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [{ branches: [{ topic: "Ponudba", children: many }] }],
  });

  assert.equal(branches[0].children.length, MINDMAP_MAX_CHILDREN_PER_TOPIC);
});

test("a merged map parses into a document the canvas can draw", () => {
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      {
        branches: [
          {
            topic: "Ponudba",
            children: [child("Zakon ponudbe", [{ label: "Cena gor, količina gor", detail: "" }])],
          },
        ],
      },
    ],
  });

  const doc = parseMindmapDoc({ title: "Mikroekonomija", language: "sl", branches });

  assert.ok(doc);
  assert.equal(doc.branches[0].label, "Ponudba");
  assert.equal(doc.branches[0].children[0].children[0].label, "Cena gor, količina gor");
  assert.equal(countMindmapNodes(doc), 3);
});

test("a label that came back as a sentence keeps its words, in the detail", () => {
  const doc = parseMindmapDoc({
    title: "T",
    branches: [
      {
        label:
          "Ravnovesje je cena pri kateri je povpraševana količina enaka ponujeni količini na trgu",
        detail: "",
        children: [],
      },
    ],
  });

  const branch = doc.branches[0];

  assert.ok(
    branch.label.split(" ").length <= MINDMAP_LABEL_MAX_WORDS,
    "an over-long label must be cut back to a handle",
  );
  /* Cut, not lost: the words that did not fit are still reachable. */
  assert.ok(branch.detail?.includes("ponujeni količini"));
});

test("a short label is left exactly as it was written", () => {
  const doc = parseMindmapDoc({
    title: "T",
    branches: [{ label: "Zakon ponudbe", detail: "Ob višji ceni ponudijo več.", children: [] }],
  });

  assert.equal(doc.branches[0].label, "Zakon ponudbe");
  assert.equal(doc.branches[0].detail, "Ob višji ceni ponudijo več.");
});

test("the node ceiling leaves room for a note read whole", () => {
  /*
   * Windowing exists so a long note reaches the map entire; a ceiling that then threw the last
   * of it away would have spent every one of those calls for nothing.
   */
  assert.ok(MINDMAP_MAX_NODES >= 12 * MINDMAP_MAX_CHILDREN_PER_TOPIC * 3);
});
