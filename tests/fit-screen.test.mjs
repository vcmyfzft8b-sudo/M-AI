import assert from "node:assert/strict";
import test from "node:test";

import { fitScreenScript, fitToScreen } from "../src/components/use-fit-screen.ts";

/**
 * A scroller whose content shrinks by `step` pixels per compact level, and in
 * proportion to the last-resort squeeze.
 */
function scroller({ content, height, step }) {
  const vars = new Map();
  const element = {
    dataset: {},
    clientHeight: height,
    style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k) },
  };
  Object.defineProperty(element, "scrollHeight", {
    get: () => Math.ceil((content - step * Number(element.dataset.fit ?? 0)) * Number(vars.get("--fit-squeeze") ?? 1)),
  });
  element.squeeze = () => vars.get("--fit-squeeze");
  return element;
}

test("a screen that fits stays at full size", () => {
  const el = scroller({ content: 700, height: 800, step: 50 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "0");
  assert.equal(el.squeeze(), undefined);
});

test("a screen steps down only as far as it needs to fit", () => {
  const el = scroller({ content: 900, height: 800, step: 40 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "3", "900 - 3 x 40 = 780 fits; two levels would not");
  assert.equal(el.squeeze(), undefined, "no squeeze when a level is enough");
});

test("past the last level everything shrinks together until it fits: never a scroll", () => {
  const el = scroller({ content: 1200, height: 800, step: 40 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "4");
  assert.ok(el.scrollHeight <= el.clientHeight, `${el.scrollHeight} fits in ${el.clientHeight}`);
  assert.ok(Number(el.squeeze()) > 0.7, "by just enough");
});

test("not one pixel of scroll is accepted", () => {
  const el = scroller({ content: 801, height: 800, step: 1 });
  fitToScreen(el, 4);
  assert.equal(el.dataset.fit, "1");
});

test("a fresh page is fitted by the very same steps", () => {
  const script = fitScreenScript(4);
  assert.match(script, /--fit-squeeze/);
  assert.match(script, /previousElementSibling, 4\)$/);
});
