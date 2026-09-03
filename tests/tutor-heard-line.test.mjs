import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptsHeardLine,
  clearsHeardLine,
  showsHeardLine,
} from "../src/lib/tutor/heard-line.ts";

/*
 * The line under the sphere, driven by the same three rules the component drives it with:
 * a recognizer revision only lands while the rule accepts one, arriving at a phase can
 * empty the line, and what is drawn is whatever is left when the rule shows it.
 */
function createLine() {
  let heard = null;
  let phase = "idle";

  return {
    /** A revision from the recognizer, partial or settled. */
    hears(text) {
      if (acceptsHeardLine(phase)) {
        heard = text;
      }
    },
    enter(next) {
      phase = next;

      if (clearsHeardLine(next)) {
        heard = null;
      }
    },
    /** What the learner can actually read. */
    onScreen() {
      return heard && showsHeardLine(phase) ? heard : null;
    },
  };
}

test("the learner's words are on screen while they are the ones talking", () => {
  const line = createLine();

  line.enter("listening");
  line.hears("kaj je");
  assert.equal(line.onScreen(), "kaj je");

  line.hears("kaj je mitohondrij");
  assert.equal(line.onScreen(), "kaj je mitohondrij");
});

test("the line survives the pause while the answer is written", () => {
  const line = createLine();

  line.enter("listening");
  line.hears("kaj je mitohondrij");
  line.enter("thinking");

  assert.equal(line.onScreen(), "kaj je mitohondrij");
});

test("the tutor speaking takes the line down", () => {
  const line = createLine();

  line.enter("listening");
  line.hears("kaj je mitohondrij");
  line.enter("thinking");
  line.enter("speaking");

  assert.equal(line.onScreen(), null);
});

test("the line does not come back when the floor does", () => {
  const line = createLine();

  line.enter("listening");
  line.hears("kaj je mitohondrij");
  line.enter("thinking");
  line.enter("speaking");
  // The turn ends and the tutor waits. Nothing was said in the meantime, so there is
  // nothing to show — the old question must not reappear under a new silence.
  line.enter("listening");

  assert.equal(line.onScreen(), null);
});

test("the tutor's own voice coming back through the microphone never reaches the line", () => {
  const line = createLine();

  line.enter("speaking");
  // Echo, and anything else the room makes while the tutor holds the floor.
  line.hears("mitohondrij je elektrarna celice");

  assert.equal(line.onScreen(), null);

  // And it is still not there when the tutor stops and hands the floor over.
  line.enter("listening");
  assert.equal(line.onScreen(), null);
});

test("cutting in takes the floor first, so the interruption is what shows", () => {
  const line = createLine();

  line.enter("speaking");
  line.hears("počakaj");
  assert.equal(line.onScreen(), null);

  // What the component does on a substantial interruption: hand the floor over, then show.
  line.enter("listening");
  line.hears("počakaj");

  assert.equal(line.onScreen(), "počakaj");
});

test("nothing is drawn outside a turn of theirs", () => {
  for (const phase of ["idle", "preparing", "speaking", "paused", "finished"]) {
    assert.equal(showsHeardLine(phase), false, phase);
  }

  for (const phase of ["listening", "thinking"]) {
    assert.equal(showsHeardLine(phase), true, phase);
  }
});
