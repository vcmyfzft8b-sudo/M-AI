import assert from "node:assert/strict";
import test from "node:test";

import { interleaveByTopic } from "../src/lib/notes/study-item-mapping.ts";

const card = (sourceUnitIdx, id) => ({ sourceUnitIdx, id });

test("consecutive cards come from different topics", () => {
  const cards = [
    card(0, "a1"),
    card(0, "a2"),
    card(0, "a3"),
    card(1, "b1"),
    card(1, "b2"),
    card(2, "c1"),
  ];
  const order = interleaveByTopic(cards).map((entry) => entry.id);

  assert.deepEqual(order, ["a1", "b1", "c1", "a2", "b2", "a3"]);
});

test("order inside a topic is preserved, so a sequence stays a sequence", () => {
  const cards = [card(0, "step1"), card(0, "step2"), card(0, "step3"), card(1, "other")];
  const order = interleaveByTopic(cards).map((entry) => entry.id);

  assert.deepEqual(
    order.filter((id) => id.startsWith("step")),
    ["step1", "step2", "step3"],
  );
});

test("every card survives the deal, once", () => {
  const cards = Array.from({ length: 60 }, (_unused, index) => card(index % 7, `card-${index}`));
  const order = interleaveByTopic(cards);

  assert.equal(order.length, 60);
  assert.equal(new Set(order.map((entry) => entry.id)).size, 60);
});

test("a single-topic deck is left exactly as it was", () => {
  const cards = [card(3, "x"), card(3, "y"), card(3, "z")];

  assert.deepEqual(
    interleaveByTopic(cards).map((entry) => entry.id),
    ["x", "y", "z"],
  );
});

test("an empty deck stays empty rather than spinning", () => {
  assert.deepEqual(interleaveByTopic([]), []);
});
