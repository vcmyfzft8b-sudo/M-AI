/*
 * The fakes that let `TutorSpeechOutput` be driven as itself.
 *
 * Not a `.test.mjs`, so the suite's glob does not try to run it. It exists because the class
 * cannot be imported directly — `node --experimental-strip-types` refuses the parameter
 * properties in its constructor — so it is transpiled here and given fake browser globals.
 * Both the error-frame transcripts and the stall tests drive the same real class through it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const moduleCache = new Map();

/**
 * Compiles and loads the real module.
 *
 * `quietCloseMs` shortens the wait before a quiet writer's stream is closed. Three and a half
 * seconds is the right number against Soniox and a poor one in a test, and it is the only
 * value here worth bending: the behaviour under test is what happens at the deadline, not how
 * long the deadline is.
 */
export async function loadSpeechOutput({ quietCloseMs } = {}) {
  const key = `speech-output:${quietCloseMs ?? "default"}`;
  const cached = moduleCache.get(key);

  if (cached) {
    return cached;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-speech-"));
  const compile = (name, rewrite = (code) => code) => {
    const source = fs.readFileSync(new URL(`../src/lib/tutor/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });

    fs.writeFileSync(path.join(dir, `${name}.mjs`), rewrite(outputText));
  };

  compile("turn-audio");
  compile("speech-output", (code) => {
    const linked = code.replaceAll("@/lib/tutor/turn-audio", "./turn-audio.mjs");

    if (quietCloseMs === undefined) {
      return linked;
    }

    const shortened = linked.replace(
      /const WRITER_QUIET_CLOSE_MS = [\d_]+;/,
      `const WRITER_QUIET_CLOSE_MS = ${quietCloseMs};`,
    );

    if (shortened === linked) {
      throw new Error("WRITER_QUIET_CLOSE_MS is no longer where the harness expects it");
    }

    return shortened;
  });

  const loaded = await import(pathToFileURL(path.join(dir, "speech-output.mjs")).href);
  moduleCache.set(key, loaded);

  return loaded;
}

export class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent = [];

  #listeners = new Map();

  constructor() {
    queueMicrotask(() => {
      if (this.readyState !== FakeSocket.CONNECTING) {
        return;
      }

      this.readyState = FakeSocket.OPEN;
      this.#dispatch("open", {});
    });
  }

  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) {
      return;
    }

    this.readyState = FakeSocket.CLOSED;
    // Real close events land a turn of the loop later, which is the whole reason
    // `openSocket`'s close handler has to check that it is still the live socket.
    queueMicrotask(() => this.#dispatch("close", {}));
  }

  /** Delivers one server frame, exactly as Soniox writes it. */
  receive(frame) {
    this.#dispatch("message", { data: JSON.stringify(frame) });
  }

  /** Every stream this socket was asked to open, in order. */
  get announced() {
    return this.sent.filter((frame) => frame.api_key).map((frame) => frame.stream_id);
  }

  /** The stream a turn is currently being fed on, which the client names, not the test. */
  get liveStreamId() {
    return this.announced.at(-1);
  }

  #dispatch(type, event) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

/** Every graph built, newest last, so a test can move the audio clock the turn is read against. */
export const audioContexts = [];

export class FakeAudioContext {
  sampleRate = 24_000;
  currentTime = 0;
  state = "running";
  destination = {};

  constructor() {
    audioContexts.push(this);
  }

  createGain() {
    const events = [];
    return { connect() {}, gain: {
      events,
      cancelScheduledValues(time) { events.push(["cancel", time]); },
      setValueAtTime(value, time) { events.push(["set", value, time]); },
      linearRampToValueAtTime(value, time) { events.push(["ramp", value, time]); },
    } };
  }

  createAnalyser() {
    return {
      fftSize: 512,
      smoothingTimeConstant: 0,
      connect() {},
      getFloatTimeDomainData() {},
    };
  }

  createBuffer(_channels, length, sampleRate) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }

  createBufferSource() {
    return { buffer: null, onended: null, stops: [], connect() {}, disconnect() {}, start() {},
      stop(time) { this.stops.push(time); } };
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

/** One base64 PCM frame — two samples, enough to make the graph build a source. */
export const AUDIO_FRAME = Buffer.from(new Int16Array([1200, -1200]).buffer).toString("base64");

/** A frame of a given length, for the tests that care where a segment lands on the clock. */
export const audioFrameOf = (seconds) =>
  Buffer.from(new Int16Array(Math.round(seconds * 24_000)).buffer).toString("base64");

/** Lets every queued microtask and the sockets' open events run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Waits out a real delay, for the one behaviour that is defined by a timer. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function installGlobals() {
  const sockets = [];

  globalThis.WebSocket = new Proxy(FakeSocket, {
    construct(target, args) {
      const socket = new target(...args);
      sockets.push(socket);

      return socket;
    },
  });
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

  const setIntervalOriginal = globalThis.setInterval;

  // The speech socket's keepalive would otherwise hold the test process open forever.
  globalThis.setInterval = (handler, delay) => {
    const timer = setIntervalOriginal(handler, delay);
    timer.unref?.();

    return timer;
  };

  return sockets;
}
