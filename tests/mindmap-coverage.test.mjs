import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeWindowedBranches,
} from "../src/lib/mindmap-merge.ts";
import { planSourceWriteWindows } from "../src/lib/notes/note-prompts.ts";
import { describeMindmapFailure } from "../src/lib/mindmap-failure.ts";
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

test("later ideas survive when a topic has more than ten children", () => {
  const many = Array.from({ length: 30 }, (_, index) => child(`Ideja ${index}`));
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [{ branches: [{ topic: "Ponudba", children: many }] }],
  });

  assert.equal(branches[0].children.length, 30);
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
  assert.ok(MINDMAP_MAX_NODES >= 12 * 10 * 3);
});

test("a topic the plan named twice is one branch, not two identical ones", () => {
  /*
   * Nothing in the schema stops a plan repeating a topic, and keyed on the raw label both copies
   * shared one children array — so the map drew the topic twice with the same subtree under each.
   */
  const branches = mergeWindowedBranches({
    topics: [
      { label: "Ravnovesje", brief: "Kje se ujameta." },
      { label: "ravnovesje ", brief: "Isto, drugače zapisano." },
      { label: "Ponudba", brief: "Prodajalci." },
    ],
    windows: [
      {
        branches: [
          { topic: "Ravnovesje", children: [child("Presežek ponudbe")] },
          { topic: "Ponudba", children: [child("Zakon ponudbe")] },
        ],
      },
    ],
  });

  assert.deepEqual(
    branches.map((branch) => branch.label),
    ["Ravnovesje", "Ponudba"],
  );
  /* And the surviving copy keeps the first brief, not the duplicate's. */
  assert.equal(branches[0].detail, "Kje se ujameta.");
});

test("a topic with no name at all is dropped rather than made the catch-all", () => {
  const branches = mergeWindowedBranches({
    topics: [{ label: "   ", brief: "" }, { label: "Ponudba", brief: "Prodajalci." }],
    windows: [
      {
        branches: [
          { topic: "", children: [child("Nikamor")] },
          { topic: "Ponudba", children: [child("Zakon ponudbe")] },
        ],
      },
    ],
  });

  assert.deepEqual(
    branches.map((branch) => branch.label),
    ["Ponudba"],
  );
  assert.deepEqual(
    branches[0].children.map((entry) => entry.label),
    ["Zakon ponudbe"],
  );
});

test("a database failure says what went wrong instead of \"unknown\"", () => {
  /*
   * Postgrest returns a plain object rather than an `Error`, so an `instanceof Error` check misses
   * every database failure. Production showed a learner "Unknown mindmap generation error." when
   * the table was missing — the screen had the answer and threw it away.
   */
  assert.equal(
    describeMindmapFailure({
      code: "42P01",
      message: 'relation "public.lecture_mindmap_assets" does not exist',
      details: null,
    }),
    'relation "public.lecture_mindmap_assets" does not exist (42P01)',
  );

  assert.equal(describeMindmapFailure(new Error("the gateway timed out")), "the gateway timed out");
  assert.equal(describeMindmapFailure({ message: "  spaced  " }), "spaced");
  /* Only when there is genuinely nothing to say. */
  assert.equal(describeMindmapFailure(null), "Unknown mindmap generation error.");
  assert.equal(describeMindmapFailure({}), "Unknown mindmap generation error.");
});

test("an idea that only restates a topic is dropped, not drawn twice", () => {
  /*
   * A real map came back with "Informacija" and "Znanje" as their own limbs *and* as leaves under
   * a third topic's overview. That says nothing a reader cannot see by looking at the middle of
   * the map, and costs two nodes to say it.
   */
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      {
        branches: [
          {
            topic: "Ravnovesje",
            children: [
              child("Pregled pojmov", [
                { label: "Ponudba", detail: "" },
                { label: "povprasevanje", detail: "" },
                { label: "Presežek ponudbe", detail: "" },
              ]),
              child("Povpraševanje"),
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    branches[0].children.map((entry) => entry.label),
    ["Pregled pojmov"],
    "an idea named after a topic is that topic, written twice",
  );
  assert.deepEqual(
    branches[0].children[0].children.map((entry) => entry.label),
    ["Presežek ponudbe"],
    "and so is a fact named after one",
  );
});

test("a fact that echoes its own idea, or another fact, is dropped", () => {
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      {
        branches: [
          {
            topic: "Ponudba",
            children: [
              child("Zakon ponudbe", [
                { label: "zakon  ponudbe", detail: "" },
                { label: "Ob višji ceni ponudijo več", detail: "" },
                { label: "OB VIŠJI CENI PONUDIJO VEČ", detail: "" },
              ]),
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    branches[0].children[0].children.map((entry) => entry.label),
    ["Ob višji ceni ponudijo več"],
  );
});

test("pruning an idea's echoes leaves the idea itself alone", () => {
  const branches = mergeWindowedBranches({
    topics: TOPICS,
    windows: [
      {
        branches: [
          {
            topic: "Ponudba",
            children: [child("Zakon ponudbe", [{ label: "Cena gor, količina gor", detail: "x" }])],
          },
        ],
      },
    ],
  });

  const idea = branches[0].children[0];

  assert.equal(idea.label, "Zakon ponudbe");
  assert.deepEqual(
    idea.children.map((entry) => entry.label),
    ["Cena gor, količina gor"],
  );
  assert.equal(idea.children[0].detail, "x", "a kept fact keeps everything it came with");
});
