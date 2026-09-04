import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

/*
 * The speech socket's error frames, driven through the real class.
 *
 * Every frame Soniox sends names the stream it belongs to, and `handleMessage` drops
 * the ones that name a turn other than the one being spoken — otherwise a dead turn's
 * error fails whichever turn happens to be live, and `onError` pauses the lesson
 * (MEMOAI-WEB-3D). The frames below are transcripts: each was captured from
 * `wss://tts-rt.soniox.com/tts-websocket` on `tts-rt-v2`, 2026-09-04.
 *
 * `TutorSpeechOutput` cannot be imported directly — `node --experimental-strip-types`
 * refuses the parameter properties in its constructor — so it is transpiled here and
 * driven against fake browser globals.
 */

const moduleCache = new Map();

async function loadSpeechOutput() {
  const cached = moduleCache.get("speech-output");

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
  compile("speech-output", (code) => code.replaceAll("@/lib/tutor/turn-audio", "./turn-audio.mjs"));

  const loaded = await import(pathToFileURL(path.join(dir, "speech-output.mjs")).href);
  moduleCache.set("speech-output", loaded);

  return loaded;
}

class FakeSocket {
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

  #dispatch(type, event) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeAudioContext {
  sampleRate = 24_000;
  currentTime = 0;
  state = "running";
  destination = {};

  createGain() {
    return { connect() {} };
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
    return { buffer: null, onended: null, connect() {}, start() {}, stop() {} };
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

/** One base64 PCM frame — two samples, enough to make the graph build a source. */
const AUDIO_FRAME = Buffer.from(new Int16Array([1200, -1200]).buffer).toString("base64");

/** Lets every queued microtask and the sockets' open events run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function installGlobals() {
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

/** A connected output with one turn already being spoken, and the errors it reported. */
async function speaking() {
  const { TutorSpeechOutput } = await loadSpeechOutput();
  const sockets = installGlobals();
  const errors = [];
  const output = new TutorSpeechOutput(
    {
      url: "wss://tts-rt.soniox.com/tts-websocket",
      apiKey: "key",
      model: "tts-rt-v2",
      voice: "sloane",
      language: "en",
    },
    { onError: (error) => errors.push(error) },
  );

  await output.connect();

  const turn = output.speak();
  turn.push("Photosynthesis is ");

  return { output, sockets, errors, turn, socket: sockets[0] };
}

/*
 * Captured live. The turn is over, its stream is gone from Soniox's side, and the
 * cancel that named it comes back as an error against a session that has moved on.
 */
const staleStreamError = (streamId) => ({
  stream_id: streamId,
  error_code: 400,
  error_message: `Stream ${streamId} not found. Send a start message first.`,
  error_type: "invalid_stream_state",
  more_info: "https://soniox.com/docs/api-reference/errors#invalid-stream-state",
  request_id: "100b4862-a51f-4f27-b663-a6e751c7b30c",
});

test("an error naming a turn that has been replaced is not the live turn's", async () => {
  const { output, errors, socket } = await speaking();

  const interrupted = output.speak();
  interrupted.push("Actually, ");

  socket.receive(staleStreamError("turn-1"));
  await settle();

  assert.deepEqual(errors, []);
  // The turn that is actually being spoken is untouched: its audio still plays.
  socket.receive({ stream_id: "turn-2", audio: AUDIO_FRAME });
  assert.equal(output.isSpeaking, true);

  output.close();
});

test("an error naming a turn that ended long ago is ignored", async () => {
  const { output, errors, socket, turn } = await speaking();

  output.stop();
  await turn.finished;

  socket.receive(staleStreamError("turn-1"));
  await settle();

  assert.deepEqual(errors, []);

  output.close();
});

test("an error arriving on a replaced socket cannot fail the turn on the new one", async () => {
  const { output, errors, sockets, socket, turn } = await speaking();

  // Soniox finished the audio and then hung up, which is what `ensureOpen` exists for.
  socket.receive({ stream_id: "turn-1", audio_end: true });
  await turn.finished;
  socket.close();
  await settle();

  await output.ensureOpen();

  const next = output.speak();
  next.push("Next, ");

  assert.notEqual(sockets[1], socket);
  socket.receive(staleStreamError("turn-1"));
  await settle();

  assert.deepEqual(errors, []);

  output.close();
});

test("an error naming the turn being spoken still fails it", async () => {
  const { output, errors, socket, turn } = await speaking();

  // A stream that was announced and then starved of text; captured live on tts-rt-v2.
  socket.receive({
    stream_id: "turn-1",
    error_code: 408,
    error_message: "Request timeout",
    error_type: "request_timeout",
    more_info: "https://soniox.com/docs/api-reference/errors#request-timeout",
    request_id: "b68a1c89-a834-4da0-9c57-e8034ac2956f",
  });

  await assert.rejects(turn.finished, (error) => {
    assert.equal(error.name, "SpeechOutputError");
    assert.equal(error.code, "408");
    assert.equal(error.message, "Request timeout");

    return true;
  });

  assert.equal(errors.length, 1);

  output.close();
});

test("an error Soniox could not attribute to a stream still reaches the learner", async () => {
  const { output, errors, socket, turn } = await speaking();

  // Soniox sends an empty id when the failure belongs to no stream it could identify.
  socket.receive({
    stream_id: "",
    error_code: 400,
    error_message: "Missing stream_id",
    error_type: "invalid_request",
    more_info: "https://soniox.com/docs/api-reference/errors#invalid-request",
    request_id: "1fda0b92-e0b2-46aa-bfab-64dda5543071",
  });

  await assert.rejects(turn.finished);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "Missing stream_id");

  output.close();
});

test("an error frame with no stream id at all still reaches the learner", async () => {
  const { output, errors, socket, turn } = await speaking();

  socket.receive({ error_code: 401, error_message: "Incorrect API key provided." });

  await assert.rejects(turn.finished);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "401");

  output.close();
});
