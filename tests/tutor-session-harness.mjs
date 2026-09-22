import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as turnAudio from "../src/lib/tutor/turn-audio.ts";
import * as heardLine from "../src/lib/tutor/heard-line.ts";
import * as spokenSoFar from "../src/lib/tutor/spoken-so-far.ts";

export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export const PLAN = { subject: "Cells", topics: [{ title: "Mitochondria", points: ["Make energy"] }] };

// Execute the real session component's callbacks with controlled network/audio/timers.
// Only its final render is replaced, to expose controls and refs without a DOM/React renderer.
// No turn-taking logic is copied into the harness.
export function sessionHarness({ source } = {}) {
  source ??= fs.readFileSync(new URL("../src/components/lecture-tutor.tsx", import.meta.url), "utf8");
  const render = source.indexOf('  const isRunning = phase !== "idle";');
  if (render < 0) throw new Error("Cannot find the tutor's render boundary");
  source = source.slice(0, render) + `
    return { runTurn, startSession, pause, end, onTurnFinished, commitInterruption,
      outputRef, inputRef, planRef, planPromiseRef, phaseRef, historyRef,
      awaitingExplanationRef, renewCredentialsRef, runTurnRef };
  }`;
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let now = 0, timerId = 0;
  const timers = new Map();
  const calls = [], audio = [], errors = [];
  const pendingPlan = deferred();
  // `socketOpen` is Soniox's end of the speech connection: warmed by `ensureOpen`, and
  // hung up on by a wait long enough to reach its idle timeout.
  const state = {
    updates: [], request: async () => response(), input: null, output: null,
    socketOpen: true, open: async () => { state.socketOpen = true; },
    sessionCalls: 0,
    sessionResponse: null,
  };
  const window = {
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    localStorage: { getItem: () => null },
  };
  class SpeechOutputError extends Error {}
  class Input {
    constructor(_config, handlers) { state.input = this; this.handlers = handlers; }
    async start() {} resetUtterance() {} close() {} stopListening() {}
  }
  class Output {
    room = "";
    stops = [];
    constructor() { state.output = this; }
    async connect() {} async resumeAudio() {} close() { this.stop(); }
    ensureOpen() { calls.push({ kind: "socket", at: now }); return state.open(); }
    get isOpen() { return state.socketOpen; }
    spokenIntoRoom() { return this.room; }
    stop(options) { this.stops.push(options); this.live?.done.resolve(); this.live = null; return null; }
    speak() {
      if (!state.socketOpen) throw new SpeechOutputError("The speech connection is not open.");
      const entry = { at: now, text: "", done: deferred() };
      audio.push(entry); this.live = entry;
      return { push: (text) => { entry.text += text; }, end() {}, finished: entry.done.promise };
    }
  }
  const preparation = { exports: {}, AbortController, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/lib/tutor/prepared-reply.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, preparation);
  const stubs = {
    react: { useRef: (current) => ({ current }), useState: (initial) => [initial, (value) => state.updates.push(value)], useCallback: (fn) => fn, useEffect() {} },
    "@/components/i18n-provider": { useT: () => (key) => key },
    "@/lib/mobile/client": { useNativeIOS: () => false, isNativeIOS: () => false, nativeRequest: async () => { throw new Error("No native calls in the harness"); } },
    "@/components/use-sheet": { useSheet: () => ({}) },
    "@/lib/tutor/turn-audio": turnAudio,
    "@/lib/tutor/heard-line": heardLine,
    "@/lib/tutor/prepared-reply": preparation.exports,
    "@/lib/tutor/spoken-so-far": spokenSoFar,
    "@/lib/tutor/speech-input": { TutorSpeechInput: Input, SpeechInputError: class extends Error {} },
    "@/lib/tutor/speech-output": { TutorSpeechOutput: Output, SpeechOutputError },
    "@/lib/tutor/report": { reportTutorFailure: (error) => errors.push(error), resetTutorFailureReports() {} },
    // No credentials expiry, so no renewal alarm: these tests are about turn-taking, and a
    // session that reached for its next slice mid-test would be answering a different question.
    "@/lib/tutor/slice": { credentialsExpireAt: () => null, nextSliceDueAt: () => null },
    "@/lib/chat-stream-client": { readChatStream: async (response, delta) => {
      for (const text of response.deltas ?? ["An answer. "]) delta(text);
      return response.result ?? { speech: "An answer.", handBack: true, awaitingExplanation: false };
    } },
  };
  /*
   * One clock, not two.
   *
   * The harness has always driven `setTimeout` from `now`, but left `Date.now`
   * reading the wall clock — so any code that schedules with one and measures
   * with the other was being tested against two clocks that disagreed by
   * however long the test took. The barge-in gate measures how long somebody
   * has been talking, which is exactly that shape, so it made the disagreement
   * impossible to ignore.
   */
  const HarnessDate = function (...args) { return new Date(...args); };
  HarnessDate.now = () => now;
  HarnessDate.prototype = Date.prototype;

  const context = {
    exports: {}, require: (name) => stubs[name] ?? {}, window,
    Date: HarnessDate,
    AbortController, DOMException, TypeError, console,
    document: { visibilityState: "visible" },
    fetch: async (url, options) => {
      if (url.endsWith("/plan")) return pendingPlan.promise;
      if (url.endsWith("/session")) {
        state.sessionCalls += 1;
        return state.sessionResponse ?? { ok: true, json: async () => ({
          language: "en", grantId: null, grantedSeconds: 1800, usage: {},
          realtime: { tts: {}, stt: {} },
        }) };
      }
      if (url.endsWith("/usage")) return { ok: true };
      const call = { ...JSON.parse(options.body), signal: options.signal, at: now };
      calls.push(call);
      return state.request(call);
    },
  };
  vm.runInNewContext(code, context);
  const tutor = context.exports.LectureTutor({ lectureId: "synthetic-lecture", isReady: true, language: "en", headSlot: null });
  tutor.outputRef.current = new Output();
  tutor.planRef.current = PLAN;
  return {
    tutor, state, calls, audio, errors, pendingPlan, timers,
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    async start() { await tutor.startSession(); await settle(); },
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
      }
      now = end; await settle();
    },
  };
}
export function response(overrides = {}) {
  return { ok: true, headers: { get: () => "text/event-stream" }, ...overrides };
}
