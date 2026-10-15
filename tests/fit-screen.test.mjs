import assert from "node:assert/strict";
import test from "node:test";

import { fitToScreen } from "../src/components/use-fit-screen.ts";

/** A scroller whose content shrinks by `step` pixels per compact level. */
function scroller({ content, height, step }) {
  const element = { dataset: {}, clientHeight: height };
  Object.defineProperty(element, "scrollHeight", {
    get: () => content - step * Number(element.dataset.fit ?? 0),
  });
  return element;
}

test("a screen that fits stays at full size", () => {
  const el = scroller({ content: 700, height: 800, step: 50 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "0");
});

test("a screen steps down only as far as it needs to fit", () => {
  const el = scroller({ content: 900, height: 800, step: 40 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "3", "900 - 3 x 40 = 780 fits; two levels would not");
});

test("past the last level it stays at the most compact and scrolls rather than clip", () => {
  const el = scroller({ content: 2000, height: 800, step: 40 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "4");
});

test("not one pixel of scroll is accepted", () => {
  const el = scroller({ content: 801, height: 800, step: 1 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "1");
});
