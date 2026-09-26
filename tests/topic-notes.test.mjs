import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTopicStudyTextInput,
  buildTopicStudyTextInstructions,
  shouldWriteTopicNotes,
  topicStudyTextSchema,
} from "../src/lib/notes/topic-notes.ts";

// The 2026-09 failures this exists for: a maths revision sheet, a spoken "Kaj je fotosinteza?",
// a table of contents. Each came back from extraction with no claims (or one or two) and failed.
test("material with no claims is taught as a topic instead of failing", () => {
  assert.equal(shouldWriteTopicNotes({ itemCount: 0, sourceWordCount: 3 }), true);
  assert.equal(shouldWriteTopicNotes({ itemCount: 0, sourceWordCount: 900 }), true);
});

test("a very short source with one or two claims is taught as a topic too", () => {
  assert.equal(shouldWriteTopicNotes({ itemCount: 2, sourceWordCount: 40 }), true);
});

test("ordinary material is never rerouted through topic notes", () => {
  assert.equal(shouldWriteTopicNotes({ itemCount: 3, sourceWordCount: 40 }), false);
  assert.equal(shouldWriteTopicNotes({ itemCount: 2, sourceWordCount: 500 }), false);
  assert.equal(shouldWriteTopicNotes({ itemCount: 40, sourceWordCount: 3000 }), false);
});

test("the prompt keeps the only honest refusal: material with no learnable topic", () => {
  const instructions = buildTopicStudyTextInstructions({ outputLanguage: "sl" });

  assert.match(instructions, /hasStudyTopic to false/);
  assert.match(instructions, /blank form/);
  assert.match(instructions, /exercises/i);
  // Invented specifics are the risk of teaching from a topic; the prompt must forbid guessing.
  assert.match(instructions, /not sure of rather than guess/);
  assert.match(instructions, /Never fill in a worksheet's blanks/);
});

test("a spoken request is labelled as the learner's own words", () => {
  const input = buildTopicStudyTextInput({
    sourceText: "Kaj je fotosinteza?",
    sourceType: "audio",
    titleHint: null,
  });

  assert.match(input, /transcript of their recording/);
  assert.match(input, /Kaj je fotosinteza\?/);
});

test("the wire schema carries no bounds Gemini would reject as too complex", () => {
  const parsed = topicStudyTextSchema.safeParse({
    hasStudyTopic: true,
    materialKind: "exercises",
    topicTitle: "Kvadratna funkcija",
    studyText: "",
  });

  assert.equal(parsed.success, true);
});
