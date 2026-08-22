import assert from "node:assert/strict";
import test from "node:test";

import {
  DECK_IMPORTANCE_FLOOR,
  MAX_DECK_ITEMS,
  MIN_DECK_ITEMS,
  selectDeckWorthyItems,
} from "../src/lib/notes/study-item-mapping.ts";

const item = (importance, claim) => ({ importance, claim });

test("only must-know items reach the deck", () => {
  const items = [
    item(5, "a"),
    item(3, "b"),
    item(4, "c"),
    item(1, "d"),
    item(2, "e"),
    item(5, "f"),
  ];
  // Enough context items exist that the top-up floor never fires, so the rating alone decides.
  const selected = selectDeckWorthyItems(items, { minItems: 3 });

  assert.deepEqual(
    selected.map((entry) => entry.claim),
    ["a", "c", "f"],
  );
  assert.ok(selected.every((entry) => entry.importance >= DECK_IMPORTANCE_FLOOR));
});

test("source order survives the filter so a deck still walks the lecture", () => {
  const items = [item(5, "first"), item(2, "skipped"), item(4, "second"), item(5, "third")];

  assert.deepEqual(
    selectDeckWorthyItems(items, { minItems: 1 }).map((entry) => entry.claim),
    ["first", "second", "third"],
  );
});

test("a source with too few must-knows tops up with the next best", () => {
  const items = [item(5, "keep"), item(3, "good"), item(1, "weak"), item(3, "also good")];
  const selected = selectDeckWorthyItems(items, { minItems: 3 });

  // The 5 plus the two 3s: the lone 1 stays out, and the result is back in source order.
  assert.deepEqual(
    selected.map((entry) => entry.claim),
    ["keep", "good", "also good"],
  );
});

test("top-up never invents items that do not exist", () => {
  const items = [item(5, "only")];

  assert.deepEqual(
    selectDeckWorthyItems(items, { minItems: 10 }).map((entry) => entry.claim),
    ["only"],
  );
});

test("an oversized deck is trimmed across the whole source, not truncated to its start", () => {
  const items = Array.from({ length: 120 }, (_unused, index) => item(5, `claim-${index}`));
  const selected = selectDeckWorthyItems(items, { maxItems: 10 });

  assert.equal(selected.length, 10);
  assert.equal(selected[0].claim, "claim-0");
  // A prefix would end at claim-9; spreading has to reach the end of the source.
  assert.equal(selected.at(-1).claim, "claim-108");
  assert.equal(new Set(selected.map((entry) => entry.claim)).size, 10);
});

test("the measured shape of a real lecture lands inside the ceiling", () => {
  // The 43-slide PDF measured on 2026-08-23: 136 items rated 5:18, 4:49, 3:62, 2:7. It used to
  // produce 134 flashcards.
  const items = [
    ...Array.from({ length: 18 }, () => item(5)),
    ...Array.from({ length: 49 }, () => item(4)),
    ...Array.from({ length: 62 }, () => item(3)),
    ...Array.from({ length: 7 }, () => item(2)),
  ];
  const selected = selectDeckWorthyItems(items);

  assert.equal(selected.length, 60);
  assert.ok(selected.length <= MAX_DECK_ITEMS);
  assert.ok(selected.length >= MIN_DECK_ITEMS);
});
