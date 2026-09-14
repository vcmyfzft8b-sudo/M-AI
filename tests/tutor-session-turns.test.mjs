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

test("a request that outlasts the warm connection's idle timeout replaces it rather than failing", async () => {
  const h = sessionHarness(), request = deferred();
  h.state.request = () => request.promise;
  void h.tutor.runTurn("opening", { index: 0 });
  await settle();
  assert.equal(h.calls.filter(c => c.kind === "socket").length, 1);

  // Soniox hangs up on an output stream that has asked for no audio after about ten
  // seconds, and an opening is written from the whole note. It is gone before the reply.
  h.state.socketOpen = false;
  request.resolve(response()); await settle();

  assert.equal(h.errors.length, 0, "a hung-up warm connection is not a failed walkthrough");
  assert.equal(h.calls.filter(c => c.kind === "socket").length, 2, "the dead connection was replaced");
  assert.equal(h.audio.length, 1);
  assert.equal(h.tutor.phaseRef.current, "speaking");
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
  const stops = h.state.output.stops.length;
  for (const text of ["", "hmmmm", "uh", "...", "mitohondrij je elektrarna"]) {
    h.state.input.handlers.onPartial(text);
    h.state.input.handlers.onUtterance(text);
  }
  await settle();
  assert.equal(h.calls.length, count);
  assert.equal(h.state.output.stops.length, stops, "noise and echo cannot fade the voice");
  assert.equal(h.tutor.phaseRef.current, "speaking");
});

test("the first recognized learner partial starts the short interruption fade before endpointing", async () => {
  const h = sessionHarness(); await h.start();
  h.state.input.handlers.onPartial("Wait");
  assert.equal(h.state.output.stops.at(-1)?.fadeOut, true);
  assert.equal(h.tutor.phaseRef.current, "listening");
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 0);
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

test("a stable question prepares silently and only its confirmed endpoint can speak", async () => {
  const h = sessionHarness(); await h.start();
  const before = h.audio.length;
  h.state.input.handlers.onPartial("Why does calcium trigger release");
  await h.tick(300);
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 1);
  assert.equal(h.audio.length, before);
  assert.equal(h.tutor.phaseRef.current, "listening");
  h.state.input.handlers.onUtterance("Why does calcium trigger release?");
  await settle();
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 1, "reuse the prepared request");
  assert.equal(h.audio.length, before + 1);
});

test("a changed final question discards preparation and answers the complete wording", async () => {
  const h = sessionHarness(); await h.start();
  h.state.input.handlers.onPartial("Why does calcium trigger release"); await h.tick(300);
  const prepared = h.calls.find(c => c.kind === "answer");
  h.state.input.handlers.onUtterance("Why does calcium not trigger release here?"); await settle();
  assert.equal(prepared.signal.aborted, true);
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 2);
  assert.equal(h.calls.at(-2).question, "Why does calcium not trigger release here?");
});

for (const stop of ["pause", "end"]) {
  test(`${stop} discards a prepared reply without playing it`, async () => {
    const h = sessionHarness(); await h.start(); const before = h.audio.length;
    h.state.input.handlers.onPartial("Why does calcium trigger release"); await h.tick(300);
    const prepared = h.calls.find(c => c.kind === "answer");
    h.tutor[stop](); await h.tick(1000);
    assert.equal(prepared.signal.aborted, true);
    assert.equal(h.audio.length, before);
  });
}

test("rapid revisions debounce preparation and long speech spends at most two rehearsals", async () => {
  const h = sessionHarness(); await h.start();
  for (const text of ["Why does calcium trigger", "Why does calcium trigger release", "Why does calcium trigger release here"]) {
    h.state.input.handlers.onPartial(text); await h.tick(100);
  }
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 0);
  await h.tick(200);
  for (const text of ["Why does calcium trigger release here in cells", "Why does calcium trigger release here in cells but not there"]) {
    h.state.input.handlers.onPartial(text); await h.tick(300);
  }
  assert.equal(h.calls.filter(c => c.kind === "answer").length, 2);
  assert.equal(h.tutor.phaseRef.current, "listening");
});

test("subtitles show only the latest learner sentence while history keeps the whole utterance", async () => {
  const h = sessionHarness(); await h.start();
  h.state.input.handlers.onPartial("I understand the channels. Why does calcium trigger release?");
  assert.equal(h.state.updates.filter(v => v?.text).at(-1).text, "Why does calcium trigger release?");
  h.state.input.handlers.onUtterance("I understand the channels. Why does calcium trigger release?");
  await settle();
  assert.equal(h.calls.find(c => c.kind === "answer").question, "I understand the channels. Why does calcium trigger release?");
  assert.equal(h.state.updates.at(-2), null, "speaking clears the caption");
});

/*
 * A learner whose access ends mid-walkthrough hits the paywall, not a red box.
 *
 * `tutor/turn` answers 402 when `canUseLectureFeatures` refuses — the same refusal the
 * session route has always answered with — but `runTurn` checked only `response.ok`, so
 * the billing sentence was thrown as an Error, reported as a defect, and left the session
 * paused behind it.
 */
test("a turn refused for billing shows the paywall instead of failing the walkthrough", async () => {
  const h = sessionHarness();
  h.tutor.phaseRef.current = "speaking";
  h.state.request = () => ({
    ok: false,
    status: 402,
    headers: { get: () => "application/json" },
    json: async () => ({ error: "Tutor is trial-only.", code: "trial_exhausted", usage: { remaining: 0 } }),
  });
  void h.tutor.runTurn("resume");
  await settle();

  assert.equal(h.errors.length, 0, "a paywall is not a reported failure");
  assert.equal(h.tutor.phaseRef.current, "idle", "the session ends rather than pausing on an error");
  assert.ok(h.state.updates.includes("trial_exhausted"), "the refusal's code blocks the tutor");
  assert.equal(h.state.updates.includes("Tutor is trial-only."), false, "the billing sentence is not shown as an error");
});
