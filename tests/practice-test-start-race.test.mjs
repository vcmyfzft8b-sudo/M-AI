import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual UI handler with controlled network timing. The iOS
// click-through reproduced a second POST after the first response but before
// the detail refresh; submitting then exposed the extra unfinished attempt.
const source = readFileSync(new URL("../src/components/lecture-workspace.tsx", import.meta.url), "utf8");
const handler = source.match(/async function handlePracticeTestStart\(\) \{[\s\S]*?(?=\n  function handlePracticeAnswerChange)/)?.[0];
assert.ok(handler, "The workspace start handler must be exercised");
const executable = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides = {}) {
  const state = { starting: false, posts: 0, error: null };
  const context = {
    practiceTestStartLock: { current: false },
    blockedOffline: () => false,
    detail: { lecture: { id: "synthetic-lecture" } },
    t: (key) => key,
    router: {},
    fetch: async () => { state.posts += 1; return {}; },
    parseApiResponse: async () => ({ id: "new-attempt", questions: [{ id: "question" }] }),
    refreshLectureDetail: async () => {},
    redirectToBillingIfNeeded: () => false,
    getRequestErrorMessage: (error) => error.message,
    setStudyError: (value) => { state.error = value; },
    setIsStartingPracticeTest: (value) => { state.starting = value; },
    ...Object.fromEntries([
      "setIsAwaitingPracticeTestGeneration", "setCurrentPracticeAttemptId",
      "setPracticeAttemptQuestionIds", "setPracticeTextAnswers",
      "setPracticeUnknownQuestionIds", "setLatestViewedPracticeAttemptId",
      "setPracticeSubmittedAt",
    ].map((name) => [name, () => {}])),
    ...overrides,
  };
  return { state, context, start: vm.runInNewContext(`${executable}\nhandlePracticeTestStart`, context) };
}

test("another tap cannot start an attempt while its detail is still loading", async () => {
  const entered = deferred();
  const refreshed = deferred();
  const { state, start } = setup({ refreshLectureDetail: () => { entered.resolve(); return refreshed.promise; } });
  const first = start();
  await entered.promise;
  assert.equal(state.starting, true, "The button must stay disabled after the POST");
  await start();
  assert.equal(state.posts, 1, "Only one attempt may be created during the refresh");
  refreshed.resolve();
  await first;
  assert.equal(state.starting, false);
});

test("two activations in one render produce only one POST", async () => {
  const posted = deferred();
  let calls = 0;
  const { start } = setup({ fetch: () => { calls += 1; return posted.promise; } });
  const first = start();
  await start();
  assert.equal(calls, 1);
  posted.resolve({});
  await first;
});

test("a failed start releases the lock so the user can retry", async () => {
  let calls = 0;
  const { state, context, start } = setup({ fetch: async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary connection failure");
    return {};
  } });
  await start();
  assert.equal(state.error, "temporary connection failure");
  assert.equal(state.starting, false);
  assert.equal(context.practiceTestStartLock.current, false);
  await start();
  assert.equal(calls, 2);
  assert.equal(state.error, null);
});
