import assert from "node:assert/strict";
import test from "node:test";

import { appendSpokenSoFar } from "../src/lib/tutor/spoken-so-far.ts";

test("what was just said is added to what had been said", () => {
  assert.equal(appendSpokenSoFar("Prva poved.", "Druga poved."), "Prva poved. Druga poved.");
  assert.equal(appendSpokenSoFar("", "Prva poved."), "Prva poved.");
});

test("a long topic cannot grow a request the route will refuse", () => {
  // The route caps spokenSoFar at 8,000 characters and answers 400 above it, which mid-session
  // is a broken tutor rather than a worse answer.
  let accumulated = "";

  for (let turn = 0; turn < 40; turn += 1) {
    accumulated = appendSpokenSoFar(accumulated, `${`beseda `.repeat(150)}konec ${turn}.`);
  }

  assert.ok(accumulated.length <= 6_000, `grew to ${accumulated.length}`);
});

test("it is the newest end that survives, because that is what the prompt uses it for", () => {
  const old = `${"star ".repeat(2_000)}`;
  const result = appendSpokenSoFar(old, "To je najnovejša poved.");

  assert.ok(result.endsWith("To je najnovejša poved."));
  assert.ok(result.length <= 6_000);
});

test("trimming never leaves half a word at the front", () => {
  const result = appendSpokenSoFar("dolgabeseda ".repeat(1_000), "konec.");

  assert.ok(!result.startsWith("beseda"), "cut mid-word");
  assert.ok(result.split(" ")[0] === "dolgabeseda" || result.split(" ")[0] === "");
});
