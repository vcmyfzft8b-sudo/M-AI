import assert from "node:assert/strict";
import test from "node:test";
import { deferred, sessionHarness, settle } from "./tutor-session-harness.mjs";

test("waiting for microphone permission cannot reserve or spend tutor time", async () => {
  const h = sessionHarness();
  const permission = deferred();
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => { stops += 1; } }] };
  h.state.requestMicrophone = () => permission.promise;
  const starting = h.tutor.startSession();
  await h.tick(120_000);
  await h.tutor.startSession(); // a second tap before React renders
  assert.equal(h.state.sessionCalls, 0);
  assert.equal(h.audio.length, 0);
  permission.resolve(stream);
  await starting;
  await settle();
  assert.equal(h.state.sessionCalls, 1);
  assert.equal(h.state.input.stream, stream, "reuse the allowed microphone without another prompt");
  h.tutor.end();
  assert.equal(stops, 1);
});

test("cancelling while permission is open releases a late stream without reserving time", async () => {
  const h = sessionHarness();
  const permission = deferred();
  let stops = 0;
  h.state.requestMicrophone = () => permission.promise;
  const starting = h.tutor.startSession();
  h.tutor.end();
  permission.resolve({ getTracks: () => [{ stop: () => { stops += 1; } }] });
  await starting;
  assert.equal(stops, 1);
  assert.equal(h.state.sessionCalls, 0);
  assert.equal(h.audio.length, 0);
});

test("refused microphone permission still permits the spoken walkthrough", async () => {
  const h = sessionHarness();
  let permissionRequests = 0;
  h.state.requestMicrophone = async () => { permissionRequests += 1; throw new Error("Permission denied"); };
  await h.start();
  assert.equal(permissionRequests, 1);
  assert.equal(h.state.sessionCalls, 1);
  assert.equal(h.tutor.inputRef.current, null);
  assert.equal(h.calls.some(c => c.kind === "opening"), true);
});

test("a refused session releases the microphone acquired for it", async () => {
  const h = sessionHarness();
  h.state.sessionResponse = { ok: false, status: 402, json: async () => ({ code: "tutor_trial_used" }) };
  await h.start();
  assert.equal(h.state.microphoneStops, 1);
  assert.equal(h.audio.length, 0);
});

test("cancelling during credential loading releases both the stream and the late grant", async () => {
  const h = sessionHarness();
  const payload = deferred();
  h.state.sessionResponse = { ok: true, json: () => payload.promise };
  const starting = h.tutor.startSession();
  await settle();
  assert.equal(h.state.sessionCalls, 1);
  h.tutor.end();
  assert.equal(h.state.microphoneStops, 1);
  payload.resolve({ grantId: "cancelled-session-grant", realtime: { tts: {}, stt: {} } });
  await starting;
  await settle();
  assert.deepEqual(h.state.usageReports, [{ grantId: "cancelled-session-grant", secondsUsed: 0 }]);
  assert.equal(h.state.microphoneStops, 1);
  assert.equal(h.audio.length, 0);
});
