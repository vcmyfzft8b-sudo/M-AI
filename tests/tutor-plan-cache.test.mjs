import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { selectUsableTutorPlan } from "../src/lib/tutor/plan-cache.ts";

const NOTES = "## Model OSI\n\nModel OSI razdeli komunikacijo na sedem plasti.";
const hash = (content) => createHash("sha256").update(content).digest("hex");

const PLAN = {
  subject: "Računalniška omrežja in model OSI.",
  topics: [
    { title: "Kaj je omrežje", points: ["Omrežje je skupina povezanih naprav."] },
    { title: "Sedem plasti", points: ["Model OSI ima sedem plasti, vsaka s svojo nalogo."] },
    { title: "Naslavljanje", points: ["Naslov MAC je lokalni, naslov IP pa omrežni."] },
  ],
};

const usable = (overrides = {}) =>
  selectUsableTutorPlan({ plan: PLAN, notesHash: hash(NOTES), notes: NOTES, ...overrides });

test("a plan made from the note that is still there is taught from", () => {
  assert.deepEqual(usable(), PLAN);
});

test("a plan is thrown away once the note it was made from is edited", () => {
  // Nothing invalidates this explicitly — every path that rewrites a note changes the hash — so
  // this is the guard that stops a learner being walked through topics they no longer have.
  const edited = usable({ notes: `${NOTES}\n\nNova tema, ki je prej ni bilo.` });

  assert.equal(edited, null);
});

test("a lecture with no warmed plan simply has none", () => {
  assert.equal(usable({ plan: null }), null);
  assert.equal(usable({ notesHash: null }), null);
  assert.equal(usable({ plan: null, notesHash: null }), null);
});

test("a stored plan that no longer fits the schema is a miss, not a malformed prompt", () => {
  // The schema can change beneath a row that was written under an older one.
  assert.equal(usable({ plan: { subject: "Brez tem." } }), null);
  assert.equal(usable({ plan: { ...PLAN, topics: [] } }), null);
  // A running order of one topic is not a short walkthrough, it is a broken one.
  assert.equal(usable({ plan: { ...PLAN, topics: PLAN.topics.slice(0, 1) } }), null);
  assert.equal(usable({ plan: "not a plan at all" }), null);
});

test("an empty note cannot validate a plan made from a real one", () => {
  assert.equal(usable({ notes: "" }), null);
});
