import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { FakeSocket, settle } from "./tutor-speech-harness.mjs";

function recognizer() {
  const sockets = [], partials = [], utterances = [], errors = [], keepalives = new Set();
  let nextTimer = 0;
  const source = fs.readFileSync(new URL("../src/lib/tutor/speech-input.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {}, require: () => ({}),
    setInterval: () => { nextTimer += 1; keepalives.add(nextTimer); return nextTimer; },
    clearInterval: (id) => keepalives.delete(id),
    WebSocket: new Proxy(FakeSocket, { construct(target, args) {
      const socket = new target(...args); sockets.push(socket); return socket;
    } }),
  };
  vm.runInNewContext(code, context);
  const input = new context.exports.TutorSpeechInput({ url: "wss://synthetic.invalid", apiKey: "test", model: "stt-rt-v5", languages: ["sl"] }, {
    onPartial: t => partials.push(t), onUtterance: t => utterances.push(t), onError: e => errors.push(e),
  });
  return { input, sockets, partials, utterances, errors, keepalives };
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

  assert.deepEqual(h.errors.map(e => e.reason), ["connection"]);
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
