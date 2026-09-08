import assert from "node:assert/strict";
import test from "node:test";
import { deferred, PLAN, response, sessionHarness, settle } from "./tutor-session-harness.mjs";

for (const kind of ["answer", "feedback"]) {
  test(`${kind} starts while the lesson plan is still pending`, async () => {
    const h = sessionHarness();
    h.tutor.planRef.current = null;
    h.tutor.planPromiseRef.current = deferred().promise;
    void h.tutor.runTurn(kind, { question: "What does that mean?" });
    await settle();
    assert.equal(h.calls.find(c => c.kind === kind)?.plan, null);
    assert.equal(h.audio.length, 1);
  });
}

test("socket preparation overlaps the request without speaking before it arrives", async () => {
  const h = sessionHarness(), request = deferred(), socket = deferred();
  h.state.request = () => request.promise;
  h.state.open = () => socket.promise;
  void h.tutor.runTurn("answer");
  await settle();
  assert.deepEqual(h.calls.map(c => c.kind), ["answer", "socket"]);
  assert.equal(h.audio.length, 0);
  socket.resolve(); await settle();
  assert.equal(h.audio.length, 0);
  request.resolve(response()); await settle();
  assert.equal(h.audio.length, 1);
});

for (const stop of ["pause", "commitInterruption", "end"]) {
  for (const pending of ["plan", "request", "socket", "renewal"]) {
    test(`${stop} invalidates a turn waiting for ${pending}`, async () => {
      const h = sessionHarness(), gate = deferred();
      if (pending === "plan") { h.tutor.planRef.current = null; h.tutor.planPromiseRef.current = gate.promise; }
      if (pending === "request") h.state.request = () => gate.promise;
      if (pending === "socket") h.state.open = () => gate.promise;
      if (pending === "renewal") h.tutor.renewCredentialsRef.current = () => gate.promise;
      const turn = h.tutor.runTurn(pending === "plan" ? "teach" : "answer");
      await settle();
      h.tutor[stop]();
      gate.resolve(pending === "plan" ? PLAN : pending === "request" ? response() : true);
      await turn;
      assert.equal(h.audio.length, 0);
      assert.equal(h.errors.length, 0);
      if (pending === "plan") assert.equal(h.calls.length, 0);
    });
  }
}

test("speech preparation failure cancels the outstanding model request", async () => {
  const h = sessionHarness();
  h.state.request = () => deferred().promise;
  h.state.open = async () => { throw new Error("socket unavailable"); };
  await h.tutor.runTurn("answer");
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.tutor.phaseRef.current, "paused");
  assert.equal(h.audio.length, 0);
});

test("a newer turn wins even when the old plan resolves afterwards", async () => {
  const h = sessionHarness(), plan = deferred();
  h.tutor.planRef.current = null; h.tutor.planPromiseRef.current = plan.promise;
  const old = h.tutor.runTurn("teach");
  void h.tutor.runTurn("answer", { question: "Wait, why?" });
  await settle(); plan.resolve(PLAN); await old;
  assert.deepEqual(h.calls.filter(c => c.kind !== "socket").map(c => c.kind), ["answer"]);
  assert.equal(h.audio.length, 1);
});

test("a real partial cancels a loading answer; only its endpoint requests a new one", async () => {
  const h = sessionHarness();
  const request = deferred(); h.state.request = () => request.promise;
  await h.start();
  const opening = h.calls.find(c => c.kind === "opening");
  h.state.input.handlers.onPartial("Wait, explain");
  assert.equal(opening.signal.aborted, true);
  assert.equal(h.tutor.phaseRef.current, "listening");
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 0);
  h.state.input.handlers.onUtterance("Wait, explain that more simply.");
  await settle();
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 1);
  request.resolve(response()); await settle();
  assert.equal(h.audio.length, 1);
});

test("noise and speaker echo neither interrupt nor ask for an answer", async () => {
  const h = sessionHarness(); await h.start();
  h.state.output.room = "Mitohondrij je elektrarna celice";
  const count = h.calls.length;
  for (const text of ["", "hmmmm", "uh", "...", "mitohondrij je elektrarna"]) {
    h.state.input.handlers.onPartial(text);
    h.state.input.handlers.onUtterance(text);
  }
  await settle();
  assert.equal(h.calls.length, count);
  assert.equal(h.tutor.phaseRef.current, "speaking");
});

test("explain-back stays silent while the learner is still finding words", async () => {
  const h = sessionHarness(); await h.start();
  h.tutor.onTurnFinished("teach", 0, false, true);
  const count = h.calls.length;
  await h.tick(15_000);
  h.state.input.handlers.onPartial("Mitochondria make");
  await h.tick(15_000);
  h.state.input.handlers.onPartial("Mitochondria make energy for");
  await h.tick(15_000);
  assert.equal(h.calls.length, count);
  assert.equal(h.tutor.phaseRef.current, "listening");
  h.state.input.handlers.onUtterance("Mitochondria make energy for the cell.");
  await settle();
  assert.equal(h.calls.filter(c => c.kind === "feedback").length, 1);
});

test("a hand-back timer cannot resume over a follow-up question", async () => {
  const h = sessionHarness(); await h.start();
  h.tutor.onTurnFinished("answer", 0, true, false);
  const count = h.calls.length;
  await h.tick(850);
  h.state.input.handlers.onPartial("What about");
  await h.tick(1_500);
  assert.equal(h.calls.length, count);
  assert.equal(h.tutor.phaseRef.current, "listening");
  await h.tick(6_000);
  // Abandoned speech still recovers, but only after seven seconds of no words.
  assert.equal(h.tutor.phaseRef.current, "thinking");
});

test("800ms request and 300ms reconnect cost 800ms, not 1100ms", async () => {
  const h = sessionHarness();
  h.state.request = async () => { await h.sleep(800); return response(); };
  h.state.open = () => h.sleep(300);
  void h.tutor.runTurn("answer");
  await settle(); await h.tick(800);
  assert.equal(h.audio[0]?.at, 800);
});

test("pause during retry backoff never dispatches another request", async () => {
  const h = sessionHarness();
  h.state.request = async () => { throw new TypeError("Failed to fetch"); };
  const turn = h.tutor.runTurn("answer");
  await settle(); h.tutor.pause(); await h.tick(500); await turn;
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 1);
  assert.equal(h.audio.length, 0);
  assert.equal(h.errors.length, 0);
});

test("a silent explain-back still advances after its original 16-second window", async () => {
  const h = sessionHarness(); await h.start(); h.tutor.planRef.current = PLAN;
  h.tutor.onTurnFinished("teach", 0, false, true);
  await h.tick(15_999);
  assert.equal(h.calls.filter(c => c.kind === "closing").length, 0);
  await h.tick(1);
  assert.equal(h.calls.filter(c => c.kind === "closing").length, 1);
});
