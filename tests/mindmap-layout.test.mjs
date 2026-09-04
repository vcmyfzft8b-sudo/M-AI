import assert from "node:assert/strict";
import test from "node:test";

import {
  countMindmapNodes,
  flattenMindmap,
  mindmapBranchIndexOf,
  mindmapDepth,
  mindmapPathTo,
  parseMindmapDoc,
  tidyMindmapText,
  MINDMAP_MAX_NODES,
} from "../src/lib/mindmap-doc.ts";
import {
  approximateMindmapMeasure,
  fitMindmapView,
  layoutMindmap,
  mindmapBranchColor,
  mindmapDepthStyle,
  suggestMindmapFold,
  MINDMAP_BRANCH_COLORS,
  MINDMAP_REFERENCE_FRAMES,
} from "../src/lib/mindmap-layout.ts";

/*
 * The layout is the part of the mindmap nobody can see going wrong: an overlap of six pixels
 * looks like a design choice until a reader tries to read the label underneath. It is pure and
 * measurement is injected, so it can be asserted on directly rather than screenshotted.
 */

/** A predictable measurement — every character the same width — so the numbers below are stable. */
const measure = (text, depth) => text.length * (mindmapDepthStyle(depth).fontSize * 0.55);

function node(label, children = []) {
  return { label, detail: "", children };
}

function buildDoc(branches) {
  const doc = parseMindmapDoc({ title: "Rast", language: "sl", branches });

  assert.ok(doc, "fixture did not parse");

  return doc;
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

test("no two nodes ever overlap, however lopsided the tree", () => {
  const doc = buildDoc([
    node("Ena", [node("Ena A", [node("x"), node("y"), node("z")]), node("Ena B")]),
    node("Dve"),
    node("Tri", [
      node("Tri A", [node("Zelo dolga oznaka ki se mora preliti v več vrstic in se skrajšati")]),
      node("Tri B", [node("p"), node("q")]),
      node("Tri C"),
    ]),
    node("Štiri", [node("Štiri A")]),
    node("Pet", [node("Pet A"), node("Pet B"), node("Pet C"), node("Pet D")]),
  ]);

  const { nodes } = layoutMindmap({ doc, measure });

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      assert.equal(
        rectsOverlap(nodes[i], nodes[j]),
        false,
        `"${nodes[i].label}" overlaps "${nodes[j].label}"`,
      );
    }
  }
});

test("branches are split down both sides of the title, balanced by height not by count", () => {
  /*
   * The first branch carries a whole subtree and the rest are single leaves. Splitting by count
   * would put three leaves opposite one tall tree; splitting by height is what keeps the map from
   * hanging off one side, which is the failure the single-column competition never solved.
   */
  const doc = buildDoc([
    node("Velika", [node("a"), node("b"), node("c"), node("d"), node("e"), node("f")]),
    node("Ena"),
    node("Dve"),
    node("Tri"),
  ]);

  const { nodes } = layoutMindmap({ doc, measure });
  const branches = nodes.filter((entry) => entry.depth === 1);

  assert.equal(branches.filter((entry) => entry.side === "right").length, 1);
  assert.equal(branches.filter((entry) => entry.side === "left").length, 3);
});

test("a left-side subtree grows away from the title, not across it", () => {
  const doc = buildDoc([node("Prva"), node("Druga", [node("Otrok", [node("Vnuk")])])]);
  const { nodes } = layoutMindmap({ doc, measure });
  const root = nodes.find((entry) => entry.depth === 0);
  const left = nodes.filter((entry) => entry.side === "left" && entry.depth > 0);

  assert.ok(left.length >= 3, "expected a left-hand subtree");

  for (const entry of left) {
    assert.ok(
      entry.x + entry.width <= root.x,
      `"${entry.label}" runs under the title instead of away from it`,
    );
  }

  /* Deeper means further out, on both sides. */
  const byDepth = new Map(left.map((entry) => [entry.depth, entry]));
  assert.ok(byDepth.get(3).x < byDepth.get(2).x);
  assert.ok(byDepth.get(2).x < byDepth.get(1).x);
});

test("a parent sits between its own children, never beside them", () => {
  const doc = buildDoc([node("Tema", [node("a"), node("b"), node("c")])]);
  const { nodes } = layoutMindmap({ doc, measure });
  const parent = nodes.find((entry) => entry.label === "Tema");
  const children = nodes.filter((entry) => entry.parentId === parent.id);
  const centres = children.map((child) => child.y + child.height / 2);

  const parentCentre = parent.y + parent.height / 2;

  assert.ok(parentCentre >= Math.min(...centres) - 0.5);
  assert.ok(parentCentre <= Math.max(...centres) + 0.5);
});

test("folding a branch removes its subtree and shrinks the map", () => {
  const doc = buildDoc([
    node("Tema", [node("a", [node("a1"), node("a2")]), node("b")]),
    node("Druga"),
  ]);

  const open = layoutMindmap({ doc, measure });
  const folded = layoutMindmap({
    doc,
    measure,
    collapsedIds: new Set([doc.branches[0].id]),
  });

  assert.equal(open.nodes.length, 7);
  assert.equal(folded.nodes.length, 3);
  assert.ok(folded.bounds.height < open.bounds.height);
  assert.equal(folded.nodes.find((entry) => entry.label === "Tema").collapsed, true);
  /* The count on the badge comes from the tree, not from what is drawn. */
  assert.equal(folded.nodes.find((entry) => entry.label === "Tema").childCount, 2);
});

test("a long label wraps, then is cut rather than allowed to grow the node", () => {
  const long = Array.from({ length: 40 }, (_, index) => `beseda${index}`).join(" ");
  const doc = buildDoc([node(long)]);
  const { nodes } = layoutMindmap({ doc, measure });
  const branch = nodes.find((entry) => entry.depth === 1);
  const style = mindmapDepthStyle(1);

  assert.ok(branch.lines.length > 1, "expected the label to wrap");
  assert.ok(branch.lines.length <= style.maxLines);
  assert.ok(branch.lines.at(-1).endsWith("…"), "a cut label must say it was cut");
  assert.ok(branch.width <= style.maxTextWidth + style.paddingX * 2 + 1);
});

test("every node and link carries the colour of the branch it belongs to", () => {
  const doc = buildDoc([
    node("Ena", [node("a", [node("a1")])]),
    node("Dve", [node("b")]),
  ]);
  const { nodes, links } = layoutMindmap({ doc, measure });

  for (const entry of nodes.filter((candidate) => candidate.depth > 0)) {
    assert.equal(entry.branchIndex, mindmapBranchIndexOf(entry.id));
  }

  assert.equal(mindmapBranchColor(0), MINDMAP_BRANCH_COLORS[0]);
  /* More branches than colours cycles rather than running off the end of the palette. */
  assert.equal(mindmapBranchColor(MINDMAP_BRANCH_COLORS.length), MINDMAP_BRANCH_COLORS[0]);
  assert.equal(links.length, nodes.length - 1, "every node but the title hangs off exactly one link");
});

test("bounds cover every node that was drawn", () => {
  const doc = buildDoc([node("Ena", [node("a")]), node("Dve"), node("Tri", [node("b")])]);
  const { nodes, bounds } = layoutMindmap({ doc, measure });

  for (const entry of nodes) {
    assert.ok(entry.x >= bounds.x - 0.01, `${entry.label} sits left of the bounds`);
    assert.ok(entry.y >= bounds.y - 0.01, `${entry.label} sits above the bounds`);
    assert.ok(entry.x + entry.width <= bounds.x + bounds.width + 0.01);
    assert.ok(entry.y + entry.height <= bounds.y + bounds.height + 0.01);
  }
});

test("the approximate measurement is never narrower than a proportional font would be", () => {
  /*
   * It is what lays the map out before a font has loaded and what the tests above run on, so it
   * has to err wide: a node measured too narrow clips its own text, which is visible, where a
   * node measured too wide only carries a little extra padding, which is not.
   */
  for (const sample of ["Endogena rast", "TN", "iiiii", "MMMMM"]) {
    assert.ok(approximateMindmapMeasure(sample, 1) > 0);
  }

  assert.ok(approximateMindmapMeasure("MMMMM", 1) > approximateMindmapMeasure("iiiii", 1));
  assert.ok(approximateMindmapMeasure("abc", 0) > approximateMindmapMeasure("abc", 3));
});

/* --- the document model ------------------------------------------------- */

test("parsing keeps what is usable and drops what is not", () => {
  const doc = parseMindmapDoc({
    title: "  Rast   in   razvoj ",
    language: "SL",
    branches: [
      { label: "Prva", detail: "Ena poved.", children: [{ label: "Otrok" }, { label: "   " }] },
      { label: "" },
      { label: "Druga", children: "ni polje" },
      null,
    ],
  });

  assert.equal(doc.title, "Rast in razvoj");
  assert.equal(doc.language, "sl");
  assert.equal(doc.branches.length, 2, "a branch with no label is not a branch");
  assert.equal(doc.branches[0].children.length, 1);
  assert.equal(doc.branches[0].detail, "Ena poved.");
  assert.equal(doc.branches[1].children.length, 0);
});

test("a map with nothing drawable parses as no map at all", () => {
  assert.equal(parseMindmapDoc(null), null);
  assert.equal(parseMindmapDoc({}), null);
  assert.equal(parseMindmapDoc({ branches: [] }), null);
  assert.equal(parseMindmapDoc({ branches: [{ label: "" }] }), null);
});

test("ids are positional, so a fold survives the map being re-parsed", () => {
  const payload = {
    title: "T",
    branches: [{ label: "A", children: [{ label: "B", children: [{ label: "C" }] }] }],
  };

  const first = parseMindmapDoc(payload);
  const second = parseMindmapDoc(payload);

  assert.deepEqual(
    flattenMindmap(first).map((entry) => entry.id),
    flattenMindmap(second).map((entry) => entry.id),
  );
  assert.deepEqual(flattenMindmap(first).map((entry) => entry.id), ["n1", "n1.1", "n1.1.1"]);
  assert.deepEqual(mindmapPathTo(first, "n1.1.1"), ["n1", "n1.1", "n1.1.1"]);
  assert.deepEqual(mindmapPathTo(first, "nope"), []);
});

test("branch eleven is not branch one", () => {
  /* Prefix-matching the id would put every node of branch 11 into branch 1's colour. */
  assert.equal(mindmapBranchIndexOf("n1.2.3"), 0);
  assert.equal(mindmapBranchIndexOf("n11.2"), 10);
  assert.equal(mindmapBranchIndexOf("__root__"), 0);
});

test("depth is capped, so a model that nests forever cannot", () => {
  const deep = { label: "L4" };
  const doc = parseMindmapDoc({
    title: "T",
    branches: [{ label: "L1", children: [{ label: "L2", children: [{ label: "L3", children: [deep] }] }] }],
  });

  assert.equal(mindmapDepth(doc), 3);
  assert.equal(countMindmapNodes(doc), 3);
});

test("a runaway map is cut at the node ceiling instead of drawn", () => {
  const branches = Array.from({ length: 40 }, (_, branch) => ({
    label: `B${branch}`,
    children: Array.from({ length: 12 }, (_, child) => ({ label: `C${branch}.${child}` })),
  }));

  const doc = parseMindmapDoc({ title: "T", branches });

  assert.ok(countMindmapNodes(doc) <= MINDMAP_MAX_NODES);
  assert.ok(countMindmapNodes(doc) > MINDMAP_MAX_NODES - 20, "the cut should not be brutal");
});

test("text is tidied and clamped on a word boundary", () => {
  assert.equal(tidyMindmapText("  a \n b  ", 40), "a b");
  assert.equal(tidyMindmapText(42, 40), "");
  assert.equal(tidyMindmapText("kratko", 40), "kratko");

  const clamped = tidyMindmapText("ena dve tri štiri pet šest sedem osem", 20);
  assert.ok(clamped.length <= 20);
  assert.ok(clamped.endsWith("…"));
  assert.equal(clamped.includes("  "), false);
});

/* --- what the map opens on --------------------------------------------- */

/** A map the shape a generated one actually is: short labels, even branches. */
function generatedShape({ branches, children, leaves }) {
  return buildDoc(
    Array.from({ length: branches }, (_, branchIndex) =>
      node(`Tema ${branchIndex + 1}`, [
        ...Array.from({ length: children }, (_, childIndex) =>
          node(`Ideja ${childIndex + 1}`, [
            ...Array.from({ length: leaves }, (_, leafIndex) => node(`Dejstvo ${leafIndex + 1}`)),
          ]),
        ),
      ]),
    ),
  );
}

/** The zoom the panel's own frame would land on, which is what the heuristic is judging. */
function openingZoom(doc, collapsedIds) {
  const { bounds } = layoutMindmap({ doc, collapsedIds, measure: approximateMindmapMeasure });

  return fitMindmapView(bounds, MINDMAP_REFERENCE_FRAMES.desktop).k;
}

test("a map that fits readably opens with nothing folded", () => {
  const doc = generatedShape({ branches: 6, children: 3, leaves: 0 });

  assert.equal(suggestMindmapFold(doc).size, 0);
  assert.ok(openingZoom(doc, new Set()) >= 0.72);
});

test("a map that would open unreadably folds its leaves rather than shrinking", () => {
  /*
   * The whole point of the opening fold, and the thing that separates this from the map it was
   * asked to beat: 137 nodes fitted whole comes out at 24%, where a label is three pixels tall.
   * Folding the leaves away shows the same shape at a size a reader can actually read.
   */
  const doc = generatedShape({ branches: 8, children: 4, leaves: 3 });
  const fold = suggestMindmapFold(doc);

  assert.ok(openingZoom(doc, new Set()) < 0.3, "the fixture must be one that cannot fit readably");
  assert.ok(fold.size > 0);
  assert.ok(openingZoom(doc, fold) >= 0.5);

  /* Leaves, not topics: every top-level branch is still open. */
  for (const branch of doc.branches) {
    assert.equal(fold.has(branch.id), false, "a branch must not be folded while leaves would do");
  }

  const shown = layoutMindmap({ doc, collapsedIds: fold, measure: approximateMindmapMeasure });
  assert.ok(shown.nodes.length > doc.branches.length + 1, "the ideas stay on screen");
});

test("a map too big for even that opens as its topics", () => {
  const doc = generatedShape({ branches: 10, children: 5, leaves: 4 });
  const fold = suggestMindmapFold(doc);

  assert.deepEqual(
    [...fold].sort(),
    doc.branches.map((branch) => branch.id).sort(),
  );
  assert.ok(openingZoom(doc, fold) >= 0.72);
});

test("nothing is folded that the reader cannot unfold", () => {
  /* Every folded id must be a real node with children, or its badge is a button to nowhere. */
  const doc = generatedShape({ branches: 8, children: 4, leaves: 3 });
  const byId = new Map(flattenMindmap(doc).map((entry) => [entry.id, entry]));

  for (const id of suggestMindmapFold(doc)) {
    assert.ok(byId.has(id), `${id} is not in the map`);
    assert.ok(byId.get(id).children.length > 0, `${id} has nothing to unfold`);
  }
});

test("fitting frames the map inside its padding, both axes", () => {
  const doc = generatedShape({ branches: 5, children: 2, leaves: 0 });
  const { bounds } = layoutMindmap({ doc, measure: approximateMindmapMeasure });
  const frame = { width: 900, height: 700 };
  const view = fitMindmapView(bounds, frame);

  const left = bounds.x * view.k + view.x;
  const right = (bounds.x + bounds.width) * view.k + view.x;
  const top = bounds.y * view.k + view.y;
  const bottom = (bounds.y + bounds.height) * view.k + view.y;

  assert.ok(left >= -0.01 && right <= frame.width + 0.01, "the map runs off the sides");
  assert.ok(top >= -0.01 && bottom <= frame.height + 0.01, "the map runs off the top or bottom");
  /* Centred, not merely inside. */
  assert.ok(Math.abs(left - (frame.width - right)) < 0.01);
  assert.ok(Math.abs(top - (frame.height - bottom)) < 0.01);
});

test("a frame with no size yet does not produce a nonsense view", () => {
  const doc = generatedShape({ branches: 3, children: 2, leaves: 0 });
  const { bounds } = layoutMindmap({ doc, measure: approximateMindmapMeasure });

  assert.deepEqual(fitMindmapView(bounds, { width: 0, height: 0 }), { x: 0, y: 0, k: 1 });
});

test("a phone folds harder than a laptop, because its frame is less than half the width", () => {
  const doc = generatedShape({ branches: 6, children: 3, leaves: 2 });
  const onDesktop = suggestMindmapFold(doc, { frame: MINDMAP_REFERENCE_FRAMES.desktop });
  const onPhone = suggestMindmapFold(doc, { frame: MINDMAP_REFERENCE_FRAMES.phone });

  const shown = (collapsedIds) =>
    layoutMindmap({ doc, collapsedIds, measure: approximateMindmapMeasure });

  /*
   * Counted in nodes drawn, not in ids folded. Folding every branch is one id per branch and
   * hides the most; folding every idea is many more ids and hides less — so the set sizes say
   * the opposite of what they look like they say.
   */
  assert.ok(
    shown(onPhone).nodes.length <= shown(onDesktop).nodes.length,
    "a phone must never open a map more expanded than a laptop would",
  );

  const shownOnPhone = shown(onPhone);

  assert.ok(
    fitMindmapView(shownOnPhone.bounds, MINDMAP_REFERENCE_FRAMES.phone).k >= 0.5,
    "what a phone opens on has to be legible on a phone",
  );
});

test("the PNG export stays inside the canvas ceiling a phone actually enforces", () => {
  /*
   * Safari refuses a canvas over ~16.7M pixels by leaving it blank rather than by throwing, and
   * `toBlob` then returns a valid, fully transparent PNG — the export appears to work and saves
   * nothing. Clamping the longest side alone let a tall map through: 1300x5000 came out as
   * 2130x8192, inside the 8192 side limit and well over the area one.
   */
  const MAX_PIXELS = 16_000_000;
  const MAX_EDGE = 8_192;
  const MARGIN = 48;

  const exportScale = (boundsWidth, boundsHeight) => {
    const width = Math.ceil(boundsWidth + MARGIN * 2);
    const height = Math.ceil(boundsHeight + MARGIN * 2);

    return Math.min(
      2,
      MAX_EDGE / Math.max(width, height),
      Math.sqrt(MAX_PIXELS / (width * height)),
    );
  };

  for (const [boundsWidth, boundsHeight] of [
    [1300, 5000],
    [1300, 3000],
    [2600, 900],
    [4000, 12000],
    [400, 300],
  ]) {
    const scale = exportScale(boundsWidth, boundsHeight);
    const width = Math.ceil((boundsWidth + MARGIN * 2) * scale);
    const height = Math.ceil((boundsHeight + MARGIN * 2) * scale);

    assert.ok(width * height <= MAX_PIXELS * 1.01, `${boundsWidth}x${boundsHeight} busts the area`);
    assert.ok(Math.max(width, height) <= MAX_EDGE + 1, `${boundsWidth}x${boundsHeight} busts a side`);
    assert.ok(scale > 0, "a map must always export at some scale");
  }

  /* A map small enough to export at full retina still does. */
  assert.equal(exportScale(400, 300), 2);
});
