import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { FakeSocket, settle } from "./tutor-speech-harness.mjs";

function recognizer({ stall = false } = {}) {
  const sockets = [], partials = [], utterances = [], errors = [], keepalives = new Set(), timeouts = new Map();
  let nextTimer = 0;
  const source = fs.readFileSync(new URL("../src/lib/tutor/speech-input.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {}, require: () => ({}),
    setInterval: () => { nextTimer += 1; keepalives.add(nextTimer); return nextTimer; },
    clearInterval: (id) => keepalives.delete(id),
    setTimeout: (fn, ms) => { nextTimer += 1; timeouts.set(nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout: (id) => timeouts.delete(id),
    WebSocket: new Proxy(FakeSocket, { construct(target, args) {
      const socket = new target(...args);
      // A handshake that never completes: the fake only opens a socket still CONNECTING.
      if (stall) socket.readyState = -1;
      sockets.push(socket); return socket;
    } }),
  };
  vm.runInNewContext(code, context);
  const input = new context.exports.TutorSpeechInput({ url: "wss://synthetic.invalid", apiKey: "test", model: "stt-rt-v5", languages: ["sl"] }, {
    onPartial: t => partials.push(t), onUtterance: t => utterances.push(t), onError: e => errors.push(e),
  });
  // As though `start()` had built the audio graph: what startListening needs to proceed.
  input.context = { close: async () => {} }; input.sampleRate = 24000;
  const fireTimeouts = () => { for (const [id, t] of [...timeouts]) { timeouts.delete(id); t.fn(); } };
  return { input, sockets, partials, utterances, errors, keepalives, timeouts, fireTimeouts };
}
const words = { tokens: [{ text: "Zakaj kalcij?", is_final: true }, { text: "<end>", is_final: true }] };

test("current recognizer uses the patient endpoint cap and delivers the question once", async () => {
  const h = recognizer(); await h.input.openSocket(24000);
  assert.equal(h.sockets[0].sent[0].max_endpoint_delay_ms, 900);
  h.sockets[0].receive(words);
  assert.deepEqual(h.utterances, ["Zakaj kalcij?"]);
});

for (const stop of ["stopListening", "close"]) {
  test(`${stop} ignores queued recognizer words and errors`, async () => {
    const h = recognizer(); await h.input.openSocket(24000);
    h.input[stop]();
    h.sockets[0].receive(words);
    h.sockets[0].receive({ error_code: 401 });
    await settle();
    assert.deepEqual(h.utterances, []);
    assert.deepEqual(h.partials, []);
    assert.deepEqual(h.errors, []);
  });
}

test("a replaced recognizer cannot interrupt or disconnect its replacement", async () => {
  const h = recognizer(); await h.input.openSocket(24000); await h.input.openSocket(24000);
  h.sockets[0].receive(words);
  h.sockets[0].receive({ error_code: 401 });
  assert.deepEqual(h.utterances, []);
  assert.deepEqual(h.errors, []);
  assert.equal(h.sockets[1].readyState, FakeSocket.OPEN);
  h.sockets[1].receive(words);
  assert.deepEqual(h.utterances, ["Zakaj kalcij?"]);
});

test("a recognizer that drops on its own is let go of, so one can be asked for again", async () => {
  const h = recognizer();
  await h.input.openSocket(24000);
  assert.equal(h.input.isListening, true);

  // Soniox' end goes away. Nothing on our side asked for this.
  h.sockets[0].close();
  await settle();

  assert.deepEqual(h.errors.map(e => e.reason), ["connection"]);
  // The session reads this to decide whether to reach for a replacement. Left true, the
  // learner's microphone stayed dead for the rest of the walkthrough.
  assert.equal(h.input.isListening, false);
  assert.equal(h.keepalives.size, 0, "the keepalive went on ticking at a dead socket");

  await h.input.openSocket(24000);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].receive(words);
  assert.deepEqual(h.utterances, ["Zakaj kalcij?"]);
});

test("a sentence cut off by the drop is not glued to the replacement's first words", async () => {
  const h = recognizer();
  await h.input.openSocket(24000);
  // The learner is mid-question when the link dies, so no `<end>` ever arrives for it.
  h.sockets[0].receive({ tokens: [{ text: "Zakaj je kalcij ", is_final: true }] });
  h.sockets[0].close();
  await settle();

  await h.input.openSocket(24000);
  h.sockets[1].receive({ tokens: [{ text: "pomemben?", is_final: true }, { text: "<end>", is_final: true }] });

  // Left behind, the fragment is asked as though the learner had said the whole thing just
  // now — the same stitching `useKey` drops a half-utterance to avoid.
  assert.deepEqual(h.utterances, ["pomemben?"]);
  assert.deepEqual(h.partials, ["Zakaj je kalcij", "pomemben?"]);
});

test("a refused recognizer is let go of too, and reports once", async () => {
  const h = recognizer();
  await h.input.openSocket(24000);
  h.sockets[0].receive({ error_code: 401 });
  await settle();

  // "refused", not "connection": the session retries a dropped connection but never a
  // refusal, which would only be refused again.
  assert.deepEqual(h.errors.map(e => e.reason), ["refused"]);
  assert.equal(h.input.isListening, false);
  assert.equal(h.keepalives.size, 0);
});

test("muting ignores in-flight words, and unmuting starts with a clean utterance", async () => {
  const h = recognizer(); await h.input.openSocket(24000);
  h.sockets[0].receive({ tokens: [{ text: "Old fragment", is_final: true }] });
  h.input.setMuted(true);
  h.sockets[0].receive(words);
  assert.deepEqual(h.utterances, []);
  h.input.setMuted(false);
  h.sockets[0].receive(words);
  assert.deepEqual(h.utterances, ["Zakaj kalcij?"]);
});

test("a full pool reads as busy", async () => {
  const h = recognizer();
  await h.input.openSocket(24000);
  h.sockets[0].receive({ error_code: 429 });
  await settle();
  assert.deepEqual(h.errors.map(e => e.reason), ["busy"]);
});

test("two callers inside one handshake share one socket", async () => {
  // A resume and a renewal, or a reconnect timer, landing together used to open two: the
  // second overwrote the first, whose keepalive then held a slot for the life of the page.
  const h = recognizer();
  const [a, b] = await Promise.all([h.input.startListening(), h.input.startListening()]);
  assert.deepEqual([a, b], [true, true]);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.keepalives.size, 1);
});

for (const stop of ["stopListening", "close"]) {
  test(`${stop} during a handshake leaves no socket behind`, async () => {
    const h = recognizer();
    const listening = h.input.startListening();
    h.input[stop]();
    assert.equal(await listening, false);
    await settle();
    assert.equal(h.input.isListening, false);
    assert.equal(h.sockets[0].readyState, FakeSocket.CLOSED, "the late socket was adopted");
    assert.equal(h.keepalives.size, 0);
  });
}

test("a renewal during a handshake gets its own socket, and the stale one is closed", async () => {
  const h = recognizer();
  const first = h.input.startListening();
  const renewed = h.input.useKey("fresh");
  assert.equal(await renewed, true);
  await first;
  await settle();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[0].readyState, FakeSocket.CLOSED);
  assert.equal(h.sockets[1].readyState, FakeSocket.OPEN);
  assert.equal(h.sockets[1].sent[0].api_key, "fresh");
  assert.equal(h.keepalives.size, 1);
});

test("a handshake that never completes gives up instead of hanging", async () => {
  const h = recognizer({ stall: true });
  const listening = h.input.startListening();
  await settle();
  assert.equal([...h.timeouts.values()][0]?.ms, 8000);
  h.fireTimeouts();
  assert.equal(await listening, false);
  assert.equal(h.input.isListening, false);
});
