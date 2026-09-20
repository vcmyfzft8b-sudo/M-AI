import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BargeInGate, judgeHeard } from "../src/lib/tutor/turn-audio.ts";

/**
 * When somebody talking over the tutor actually takes the floor.
 *
 * It used to be the first word, which is wrong twice over. A room is full of
 * single words addressed to nobody — someone agreeing across the table, a name
 * called down a corridor, a television — and each of them stopped the lesson
 * dead. And even when it really is the learner, stopping on the instant is not
 * what a person does: you carry on for a moment while the other voice
 * establishes that it means to keep going.
 *
 * The clock is passed in, so all of this is exercised without audio or waiting.
 */

/** The learner, mid-sentence, as the recognizer reports them growing. */
function speaking(gate, start, parts, stepMs = 200) {
  let decision = "hold";
  let at = start;

  for (const [index, text] of parts.entries()) {
    at = start + index * stepMs;
    decision = gate.consider(at, text, "learner");
    if (decision === "interrupt") break;
  }

  return { decision, at };
}

test("the tutor keeps talking through the first moment of an interruption", () => {
  const gate = new BargeInGate();

  // The learner has started, and is clearly still going — but it has been less
  // than the hold, so the tutor does not cut out mid-syllable.
  assert.equal(gate.consider(0, "a", "learner"), "hold");
  assert.equal(gate.consider(200, "ampak", "learner"), "hold");
  assert.equal(gate.consider(400, "ampak zakaj", "learner"), "hold");
});

test("a learner who keeps talking does take the floor", () => {
  const gate = new BargeInGate();
  const { decision, at } = speaking(gate, 0, [
    "a", "ampak", "ampak zakaj", "ampak zakaj je", "ampak zakaj je to",
  ]);

  assert.equal(decision, "interrupt");
  // Held for a moment, then handed over — not half a lesson later.
  assert.ok(at >= 600 && at <= 1000, `handed over at ${at}ms`);
});

test("one word from the room never takes the floor", () => {
  const gate = new BargeInGate();

  // Somebody agrees across the table. The recognizer reports it, then it is
  // gone — it never grows, and it is not still there a second later.
  assert.equal(gate.consider(0, "ja", "learner"), "hold");
  assert.equal(gate.consider(200, "ja", "learner"), "hold");
  assert.equal(gate.consider(400, "ja", "learner"), "hold");
  assert.equal(gate.consider(700, "ja", "learner"), "hold");
});

test("a single word said on purpose still takes the floor, given longer", () => {
  const gate = new BargeInGate();

  // "Stop" and "wait" are real interruptions and all of them are one word, so
  // a rule counting only words would refuse the most urgent thing anyone says.
  assert.equal(gate.consider(0, "počakaj", "learner"), "hold");
  assert.equal(gate.consider(600, "počakaj", "learner"), "hold");
  assert.equal(gate.consider(1300, "počakaj", "learner"), "interrupt");
});

test("the tutor's own voice off a speaker never builds towards an interruption", () => {
  const gate = new BargeInGate();

  // Echo arrives continuously for as long as the tutor talks. If it
  // accumulated, the tutor would reliably interrupt itself after the hold.
  for (let at = 0; at <= 4000; at += 200) {
    assert.equal(gate.consider(at, "mitohondrij je organel", "tutor"), "hold", `echo at ${at}ms`);
  }
});

test("echo between two of the learner's words does not reset their claim to nothing", () => {
  const gate = new BargeInGate();

  // This is the deliberate cost of the rule above: a stretch judged as echo
  // clears what was building. It is the right way round — an interruption that
  // is half echo is not one — and the learner simply keeps talking.
  gate.consider(0, "ampak", "learner");
  gate.consider(200, "mitohondrij je organel", "tutor");
  assert.equal(gate.consider(400, "ampak zakaj je to", "learner"), "hold");
  assert.equal(gate.consider(1100, "ampak zakaj je to pomembno", "learner"), "interrupt");
});

test("a word heard once does not complete an interruption minutes later", () => {
  const gate = new BargeInGate();

  gate.consider(0, "ja", "learner");
  // Nothing for a long time, then an unrelated word. That is two separate
  // sounds, not one person talking for two minutes.
  assert.equal(gate.consider(120_000, "no", "learner"), "hold");
});

test("the floor changing hands clears whatever was building", () => {
  const gate = new BargeInGate();

  gate.consider(0, "ampak", "learner");
  gate.consider(200, "ampak zakaj", "learner");
  gate.reset();

  // Back to nothing: the next partial starts its own hold.
  assert.equal(gate.consider(400, "ampak zakaj je to", "learner"), "hold");
});

test("noise is still noise, and the gate is only asked about the learner", () => {
  // The caller judges the speaker first; this pins the two halves fitting together.
  assert.equal(judgeHeard("...", "", "sl"), "noise");
  assert.equal(judgeHeard("ampak zakaj", "", "sl"), "learner");

  const gate = new BargeInGate();
  assert.equal(gate.consider(0, "...", "noise"), "hold");
});

test("the component asks the gate rather than interrupting on the first word", () => {
  const source = readFileSync(new URL("../src/components/lecture-tutor.tsx", import.meta.url), "utf8");

  assert.match(source, /bargeInRef\.current\.consider\(Date\.now\(\), text, "learner"\) === "interrupt"/);
  // And anything that is not the learner clears it, or echo would accumulate.
  assert.match(source, /if \(whoSpoke\(text\) !== "learner"\) \{\s*\n\s*\/\/[^\n]*\n\s*bargeInRef\.current\.reset\(\);/);
  // Taking the floor clears it too, so the next turn starts from nothing.
  assert.match(source, /const commitInterruption = useCallback\(\(\) => \{\s*\n\s*bargeInRef\.current\.reset\(\);/);
});
