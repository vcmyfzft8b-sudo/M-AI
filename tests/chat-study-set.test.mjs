import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chatAnswerSchema } from "../src/lib/ai/schemas.ts";
import { buildTutorHistory, buildTutorInstructions } from "../src/lib/ai/tutor-prompt.ts";
import {
  withAttachedSet,
  countChatStudyItems,
  describeChatStudyAttachment,
  parseChatStudyAttachment,
  resolveChatStudyCount,
} from "../src/lib/chat-study-set.ts";

/*
 * A learner asks the chat for flashcards, a quiz, a test or a mind map and gets the real thing
 * under the reply. The parser is the one gate every set passes through — what the model wrote,
 * what comes back out of `chat_messages.attachment_json`, what the browser draws — so these
 * pin what it lets through and what it refuses.
 */

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

test("a flashcard set keeps its cards and drops the ones with a blank side", () => {
  const parsed = parseChatStudyAttachment({
    version: 1,
    kind: "flashcards",
    title: "  Osmoza  ",
    cards: [
      { front: "Kaj je osmoza?", back: "Prehod vode skozi polprepustno membrano." },
      { front: "", back: "Brez vprašanja" },
      { front: "Brez odgovora", back: "   " },
    ],
  });

  assert.equal(parsed.kind, "flashcards");
  assert.equal(parsed.title, "Osmoza");
  assert.equal(parsed.cards.length, 1);
  assert.equal(countChatStudyItems(parsed), 1);
});

test("a quiz question nobody could be marked on is dropped whole", () => {
  const good = { prompt: "2 + 2?", options: ["3", "4", "5", "6"], correctIndex: 1, explanation: "Seštevek." };
  const parsed = parseChatStudyAttachment({
    version: 1,
    kind: "quiz",
    title: "Računanje",
    questions: [
      good,
      { ...good, correctIndex: 4 },
      { ...good, correctIndex: -1 },
      { ...good, options: ["4", "4", "5", "6"] },
      { ...good, options: ["3", "", "5", "6"] },
      { ...good, prompt: "" },
    ],
  });

  assert.equal(parsed.questions.length, 1);
  assert.deepEqual(parsed.questions[0].options, ["3", "4", "5", "6"]);
  assert.equal(parsed.questions[0].correctIndex, 1);
});

test("a set whose every item failed is kept as a failure of its kind, not dropped", () => {
  // The reply above it already says "here are your cards"; a missing set would read as a bug.
  assert.deepEqual(parseChatStudyAttachment({ version: 1, kind: "test", questions: [] }), {
    version: 1,
    kind: "test",
    failed: true,
  });
  assert.deepEqual(parseChatStudyAttachment({ version: 1, kind: "quiz", failed: true }), {
    version: 1,
    kind: "quiz",
    failed: true,
  });
});

test("anything that is not a set is not an attachment", () => {
  assert.equal(parseChatStudyAttachment(null), null);
  assert.equal(parseChatStudyAttachment([]), null);
  assert.equal(parseChatStudyAttachment({ kind: "essay" }), null);
});

test("a mind map is parsed by the note's own mind map parser", () => {
  const parsed = parseChatStudyAttachment({
    version: 1,
    kind: "mindmap",
    title: "Celica",
    doc: {
      title: "Celica",
      language: "",
      branches: [
        { label: "Organeli", detail: "", children: [{ label: "Mitohondrij", detail: "Energija", children: [] }] },
        { label: "Membrana", detail: "Meja celice", children: [] },
      ],
    },
  });

  assert.equal(parsed.kind, "mindmap");
  assert.equal(parsed.doc.branches.length, 2);
  // Positional ids, exactly as the note's map has them, so the canvas can fold and select.
  assert.equal(parsed.doc.branches[0].children[0].id, "n1.1");
  assert.equal(countChatStudyItems(parsed), 2);
});

test("the number of items is what they asked for, inside sensible bounds", () => {
  assert.equal(resolveChatStudyCount("flashcards", null), 8);
  assert.equal(resolveChatStudyCount("flashcards", 12), 12);
  assert.equal(resolveChatStudyCount("flashcards", 500), 20);
  assert.equal(resolveChatStudyCount("quiz", 1), 3);
  assert.equal(resolveChatStudyCount("test", 0), 5);
  assert.equal(resolveChatStudyCount("mindmap", 7), 0);
});

test("the tutor remembers the set it made, beside the turn rather than inside it", () => {
  const attachment = {
    version: 1,
    kind: "quiz",
    title: "Računanje",
    questions: [{ prompt: "2 + 2?", options: ["3", "4"], correctIndex: 1, explanation: null }],
  };

  const described = describeChatStudyAttachment(parseChatStudyAttachment(attachment));
  assert.match(described, /^quiz "Računanje"/);
  assert.match(described, /correct: B/);
  assert.doesNotMatch(described, /[—–]/);

  const turn = { role: "assistant", content: "Tukaj je kviz." };
  // The text stays exactly what was said: written into it, the model copied the note into
  // later replies ("[kartice: …]" at the end of an answer).
  assert.deepEqual(withAttachedSet(turn, attachment), { ...turn, attachedSet: described });
  assert.deepEqual(withAttachedSet(turn, null), turn);
  // A failure is not something the learner can see under the reply.
  assert.deepEqual(withAttachedSet(turn, { version: 1, kind: "quiz", failed: true }), turn);
});

test("a long deck is trimmed before it travels as history", () => {
  const cards = Array.from({ length: 20 }, (_, index) => ({ front: `Vprašanje ${index} `.repeat(12), back: "Odgovor ".repeat(50) }));
  const turn = withAttachedSet({ role: "assistant", content: "x" }, { version: 1, kind: "flashcards", title: "T", cards });

  assert.ok(turn.attachedSet.length <= 2400);
});

test("the history keeps the set apart from the text, and the tutor is told not to write it", () => {
  const history = buildTutorHistory([
    { role: "user", content: "Naredi kviz" },
    { role: "assistant", content: "Tukaj je kviz.", attachedSet: "quiz \"OSI\"\n1. ..." },
  ]);

  assert.deepEqual(history[0], { role: "user", content: "Naredi kviz" });
  assert.equal(history[1].content, "Tukaj je kviz.");
  assert.match(history[1].attachedSet, /^quiz "OSI"/);

  for (const surface of ["lecture", "library"]) {
    assert.match(buildTutorInstructions(surface), /never write it, quote it, or add a note like it/);
  }

  assert.match(readSource("src/app/api/library-chat/route.ts"), /attachedSet: z\.string\(\)/);
});

test("the note chat's answer schema carries the study request, nullable", () => {
  const base = { answer: "Ja.", citations: [] };

  assert.equal(chatAnswerSchema.safeParse({ ...base, studyRequest: null }).success, true);
  assert.equal(
    chatAnswerSchema.safeParse({
      ...base,
      studyRequest: { kind: "flashcards", count: 10, focus: "osmoza" },
    }).success,
    true,
  );
  assert.equal(
    chatAnswerSchema.safeParse({
      ...base,
      studyRequest: { kind: "essay", count: null, focus: "x" },
    }).success,
    false,
  );
});

test("both chats are told how to hand over a set instead of typing it out", () => {
  for (const surface of ["lecture", "library"]) {
    const instructions = buildTutorInstructions(surface);

    assert.match(instructions, /## Making study material/);
    assert.match(instructions, /fill `studyRequest`/);
    assert.match(instructions, /never write its cards, questions, answers or topics into the reply/);
  }
});

test("both chats generate the set and both routes stream that it is coming", () => {
  const pipeline = readSource("src/lib/pipeline.ts");
  const library = readSource("src/lib/library-chat.ts");

  assert.match(pipeline, /generateChatStudySet\(/);
  assert.match(library, /generateChatStudySet\(/);
  assert.match(library, /studyRequest: chatStudyRequestSchema/);

  for (const route of ["src/app/api/lectures/[id]/chat/stream/route.ts", "src/app/api/library-chat/route.ts"]) {
    assert.match(readSource(route), /onStudy: send\.study/, route);
  }
});

test("the note chat stores the set and reads history without naming the new column", () => {
  const pipeline = readSource("src/lib/pipeline.ts");

  assert.match(pipeline, /attachment_json: attachment/);
  // A column list naming attachment_json would fail outright between deploy and migration.
  assert.doesNotMatch(pipeline, /\.select\("role, content, attachment_json"\)/);
  assert.match(
    readSource("supabase/migrations/0061_chat_message_attachments.sql"),
    /add column if not exists attachment_json jsonb/,
  );
});
