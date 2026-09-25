import assert from "node:assert/strict";
import test from "node:test";
import { deferred, PLAN, response, sessionHarness, settle } from "./tutor-session-harness.mjs";

test("a tutor session 429 waits for Retry-After without reporting a defect or calling again", async () => {
  const h = sessionHarness();
  h.state.sessionResponse = {
    ok: false,
    status: 429,
    headers: { get: () => "120" },
    json: async () => ({ error: "Too many requests.", retryAfterSeconds: 120 }),
  };

  await h.tutor.startSession();
  assert.equal(h.errors.length, 0);
  assert.ok(h.state.updates.some((value) => typeof value === "string" && value.includes("tutor.error.rateLimited")));
  assert.equal(h.state.sessionCalls, 1);

  await h.tutor.startSession();
  assert.equal(h.state.sessionCalls, 1, "a second tap during the server's wait must stay local");

  await h.tick(120_000);
  h.state.sessionResponse = null;
  await h.tutor.startSession();
  assert.equal(h.state.sessionCalls, 2, "Start is available when the server's wait expires");
});

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
  h.state.input.handlers.onPartial("Wait");
  await h.tick(700);
  h.state.input.handlers.onPartial("Wait, explain");
  await settle();
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

test("a learner talking over the tutor takes the floor, but not on the first instant", async () => {
  const h = sessionHarness(); await h.start();
  const stops = h.state.output.stops.length;

  // One word is where a person starts and where a room full of stray voices
  // also starts, so the tutor carries on for a moment rather than cutting out
  // mid-syllable.
  h.state.input.handlers.onPartial("Wait");
  await settle();
  assert.equal(h.state.output.stops.length, stops, "stopped on the first word");
  assert.equal(h.tutor.phaseRef.current, "speaking");

  // They keep going, so it really is an interruption.
  await h.tick(300);
  h.state.input.handlers.onPartial("Wait but why");
  await h.tick(400);
  h.state.input.handlers.onPartial("Wait but why does that");
  await settle();

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
  // Under the four-word threshold, so this one takes the floor without also
  // preparing a reply the test would then count twice.
  h.state.input.handlers.onPartial("Why does");
  await h.tick(700);
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

/*
 * A dropped recognizer is not silent: the screen says so.
 *
 * The microphone is the whole promise of a walkthrough — cut in whenever you like — and
 * when Soniox' end of it goes away nothing reopens it on its own. `canListen` was left
 * true all the same, so the hint that says "I cannot hear you" never appeared and the
 * learner went on talking to a tutor that had stopped listening several minutes earlier.
 */
const recognizerError = (reason) => Object.assign(new Error("The recognizer connection closed."), { reason });

test("a recognizer that drops mid-session stops the screen promising it can hear, then comes back", async () => {
  const h = sessionHarness();
  await h.start();

  const before = h.state.updates.length;
  h.state.input.isListening = false;
  h.state.input.handlers.onError(recognizerError("connection"));
  const said = h.state.updates.slice(before);

  assert.ok(said.includes(false), "the learner is still told they can cut in by speaking");
  assert.ok(!said.includes("tutor.error.connection"), "no red box while it is being asked for back");

  // MEMOAI-WEB-3Y: nothing used to reopen it until a pause or the half-hourly renewal.
  await h.tick(1_100);
  assert.equal(h.state.listenStarts, 1, "the recognizer is asked for back on its own");
  assert.ok(h.state.updates.slice(before).includes(true), "the microphone is back");
  assert.ok(!h.state.updates.slice(before).includes("tutor.error.connection"));
});

test("a recognizer that will not come back is said so once the tries run out", async () => {
  const h = sessionHarness();
  await h.start();
  h.state.listenResults = [false, false, false, false];
  const before = h.state.updates.length;
  h.state.input.isListening = false;
  h.state.input.handlers.onError(recognizerError("connection"));

  await h.tick(1_000 + 3_000 + 9_000);
  assert.equal(h.state.listenStarts, 3);
  assert.ok(!h.state.updates.slice(before).includes("tutor.error.connection"), "still trying");
  await h.tick(27_000);
  assert.equal(h.state.listenStarts, 4, "four tries, then it stops");
  assert.ok(h.state.updates.slice(before).includes("tutor.error.connection"), "the drop is shown");
  await h.tick(120_000);
  assert.equal(h.state.listenStarts, 4, "no storm after the cap");
});

test("a refused recognizer is not asked for again", async () => {
  const h = sessionHarness();
  await h.start();
  const before = h.state.updates.length;
  h.state.input.isListening = false;
  h.state.input.handlers.onError(recognizerError("refused"));
  assert.ok(h.state.updates.slice(before).includes("tutor.error.connection"));
  await h.tick(60_000);
  assert.equal(h.state.listenStarts, 0);
});

test("a full pool is asked again slowly, and a pause stops the asking", async () => {
  const h = sessionHarness();
  await h.start();
  h.state.input.isListening = false;
  h.state.input.handlers.onError(recognizerError("busy"));
  await h.tick(10_000);
  assert.equal(h.state.listenStarts, 0, "a full pool is not knocked on every second");
  h.tutor.pause();
  await h.tick(60_000);
  assert.equal(h.state.listenStarts, 0, "a paused session does not take a slot");
});
