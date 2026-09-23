import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the component's actual event handlers with React's render-snapshot
// semantics: a state setter schedules a new render, but cannot change the
// variables captured by a timeout from the previous render.
const source = readFileSync(new URL("../src/components/lecture-workspace.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["handleQuizSelection", "moveQuizQuestion", "finishQuizRound"].includes(node.name?.text)) {
    handlers.set(node.name.text, node.getText(tree));
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(handlers.size, 3);
const javascript = ts.transpileModule([...handlers.values()].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function render({ queue = ["first", "last"], index = queue.length - 1, selections = { first: 1 }, round = 1 } = {}) {
  const questions = new Map(queue.map(id => [id, { id, correct_option_idx: 1 }]));
  const state = { selections, index, summary: null };
  const pending = [];
  const currentId = queue[index];
  const context = vm.createContext({
    quizQueue: queue, quizQuestionsById: questions, quizRound: round, quizRoundCount: queue.length,
    quizSelections: selections, activeQuizQuestionIndex: index, currentQuizQuestionId: currentId,
    activeQuizQuestion: questions.get(currentId), activeQuizSelection: selections[currentId] ?? null,
    QUIZ_CORRECT_PAUSE_MS: 500, quizAdvanceTimerRef: { current: null },
    setQuizSelections: next => { state.selections = typeof next === "function" ? next(state.selections) : next; },
    setActiveQuizQuestionIndex: next => { state.index = typeof next === "function" ? next(state.index) : next; },
    setQuizRoundSummary: next => { state.summary = next; },
    window: { clearTimeout() {}, setTimeout(fn) { pending.push(fn); return pending.length; } },
  });
  vm.runInContext(javascript, context);
  return { state, pending, choose: answer => context.handleQuizSelection(answer), advance: () => context.moveQuizQuestion(1) };
}

test("the delayed final correct answer counts in the completed round", () => {
  const ui = render();
  ui.choose(1);
  assert.equal(ui.state.summary, null, "Keep the answer reveal before advancing");
  assert.equal(ui.pending.length, 1);
  ui.pending.shift()();
  assert.equal(ui.state.summary.correct, 2);
  assert.equal(ui.state.summary.missed, 0);
  assert.equal(ui.state.summary.missedQuestionIds.length, 0);
});

test("correcting the only missed question completes the retry round", () => {
  const ui = render({ queue: ["last"], selections: {}, round: 2 });
  ui.choose(1);
  ui.pending.shift()();
  assert.equal(ui.state.summary.cycle, 2);
  assert.equal(ui.state.summary.correct, 1);
  assert.equal(ui.state.summary.missed, 0, "Do not send a correct answer into an endless retry loop");
});

test("an incorrect final answer waits for acknowledgement and remains missed", () => {
  const ui = render();
  ui.choose(0);
  assert.equal(ui.pending.length, 0);
  assert.equal(ui.state.summary, null);
  const afterRender = render({ selections: ui.state.selections });
  afterRender.advance();
  assert.equal(afterRender.state.summary.correct, 1);
  assert.equal(afterRender.state.summary.missed, 1);
  assert.equal(afterRender.state.summary.missedQuestionIds[0], "last");
});

test("a correct answer before the last question advances without ending the round", () => {
  const ui = render({ index: 0, selections: {} });
  ui.choose(1);
  ui.pending.shift()();
  assert.equal(ui.state.index, 1);
  assert.equal(ui.state.summary, null);
});
