import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

// Drives the real `GeminiTutorSpeechOutput` with a fake speech route and a fake audio clock: the
// order audio is played in, what a stop reports as heard, and what each kind of failure does to
// the turn. The class imports through `@/` aliases, so it is transpiled here the way
// tests/tutor-speech-harness.mjs transpiles the Soniox one.

async function loadOutput() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-gemini-speech-"));
  const compile = (name, rewrite = (code) => code) => {
    const source = fs.readFileSync(new URL(`../src/lib/tutor/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });

    fs.writeFileSync(path.join(dir, `${name}.mjs`), rewrite(outputText));
  };
  const link = (code) =>
    code
      .replaceAll("@/lib/tutor/turn-audio", "./turn-audio.mjs")
      .replaceAll("@/lib/tutor/speech-output", "./speech-output.mjs")
      .replaceAll("@/lib/tutor/speech-pieces", "./speech-pieces.mjs")
      .replaceAll("./turn-audio.ts", "./turn-audio.mjs");

  compile("turn-audio", (code) =>
    code.replace("../speech-language.ts", new URL("../src/lib/speech-language.ts", import.meta.url).href),
  );
  compile("speech-output", link);
  compile("speech-pieces", link);
  compile("gemini-speech-output", link);

  return import(pathToFileURL(path.join(dir, "gemini-speech-output.mjs")).href);
}

class FakeAudioContext {
  sampleRate = 48_000;
  currentTime = 0;
  state = "running";
  destination = {};
  sources = [];

  createGain() {
    return {
      connect() {},
      gain: { cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
    };
  }

  createAnalyser() {
    return { fftSize: 512, smoothingTimeConstant: 0, connect() {}, getFloatTimeDomainData() {} };
  }

  createBuffer(_channels, length, sampleRate) {
    const data = new Float32Array(length);

    return { duration: length / sampleRate, sampleRate, getChannelData: () => data };
  }

  createBufferSource() {
    const source = {
      buffer: null,
      onended: null,
      startAt: null,
      stopped: false,
      connect() {},
      disconnect() {},
      start(time) {
        this.startAt = time;
      },
      stop() {
        this.stopped = true;
      },
    };

    this.sources.push(source);

    return source;
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }

  /** Plays everything scheduled: the clock moves past it and each source says it ended. */
  playAll() {
    const live = this.sources.filter((source) => !source.stopped && source.startAt !== null);
    const end = Math.max(this.currentTime, ...live.map((source) => source.startAt + source.buffer.duration));

    this.currentTime = end;

    for (const source of live) {
      source.stopped = true;
      source.onended?.();
    }
  }
}

/** PCM for `seconds` of audio at 24 kHz, each sample tagged with `marker` so order is visible. */
function pcm(seconds, marker) {
  const samples = new Int16Array(Math.round(seconds * 24_000)).fill(marker);

  return new Uint8Array(samples.buffer);
}

/**
 * The speech route, faked. Each request is held until the test answers it, so the test decides
 * the order replies land in — which is the case the player most has to get right.
 */
function installRoute() {
  const requests = [];

  globalThis.fetch = (url, init = {}) => {
    if (init.method === "GET") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    return new Promise((resolve, reject) => {
      const request = {
        url,
        body: JSON.parse(init.body),
        headers: init.headers,
        signal: init.signal,
        aborted: false,
        respond(status, chunks = [], { failAfter = false } = {}) {
          if (status !== 200) {
            resolve(new Response(JSON.stringify({ error: "x" }), { status }));
            return;
          }

          const stream = new ReadableStream({
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(chunk);
              }

              if (failAfter) {
                controller.error(new TypeError("network"));
              } else {
                controller.close();
              }
            },
          });

          resolve(new Response(stream, { status: 200, headers: { "X-Speech-Sample-Rate": "24000" } }));
        },
        dropConnection() {
          reject(new TypeError("Load failed"));
        },
      };

      init.signal?.addEventListener("abort", () => {
        request.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
      requests.push(request);
    });
  };

  return requests;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

async function setup(handlers = {}) {
  const { GeminiTutorSpeechOutput } = await loadOutput();
  const contexts = [];

  globalThis.window = {
    AudioContext: class extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    },
  };

  const requests = installRoute();
  const output = new GeminiTutorSpeechOutput(
    { url: "/api/tutor/speech", apiKey: "token-1", model: "gemini-3.8-flash-tts", voice: "Grace", language: "sl" },
    handlers,
  );

  await output.connect();

  return { output, requests, context: contexts[0] };
}

const markerOf = (source) => Math.round(source.buffer.getChannelData(0)[0] * 32_768);

test("a turn is spoken in order even when the second sentence comes back first", async () => {
  const { output, requests, context } = await setup();
  const turn = output.speak();

  turn.push("Dobro, gremo naprej na fotosintezo. ");
  turn.push("Predstavljaj si list kot majhno tovarno. In");
  await settle();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.text, "Dobro, gremo naprej na fotosintezo.");
  assert.equal(requests[0].body.voice, "Grace");
  assert.equal(requests[0].body.language, "sl");
  assert.equal(requests[0].headers.Authorization, "Bearer token-1");
  assert.equal(requests[1].body.text, " Predstavljaj si list kot majhno tovarno.");

  requests[1].respond(200, [pcm(1, 200)]);
  await settle();
  assert.equal(context.sources.length, 0, "the second piece waits for the first");

  requests[0].respond(200, [pcm(0.5, 100), pcm(0.5, 101)]);
  await settle();

  const order = context.sources.map(markerOf);

  assert.deepEqual(order, [100, 101, 200]);

  for (let index = 1; index < context.sources.length; index += 1) {
    const previous = context.sources[index - 1];

    assert.ok(
      Math.abs(context.sources[index].startAt - (previous.startAt + previous.buffer.duration)) < 1e-9,
      "each buffer starts where the last one ended",
    );
  }

  turn.push(" ostalo.");
  turn.end();
  await settle();

  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.text, " In ostalo.");
  requests[2].respond(200, [pcm(0.5, 300)]);
  await settle();

  let finished = false;
  void turn.finished.then(() => {
    finished = true;
  });
  await settle();
  assert.equal(finished, false, "not finished while audio is still playing");

  context.playAll();
  await settle();
  assert.equal(finished, true);
});

test("only two pieces are in flight; the rest waits and goes out as one", async () => {
  const { output, requests } = await setup();
  const turn = output.speak();

  turn.push("Prvi stavek je tukaj. Drugi stavek je tukaj. Tret");
  await settle();
  turn.push("ji stavek. Četrti stavek. Peti");
  await settle();

  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.text, " Drugi stavek je tukaj.");

  requests[0].respond(200, [pcm(0.2, 1)]);
  await settle();

  assert.equal(requests.length, 3);
  assert.equal(requests[2].body.text, " Tretji stavek. Četrti stavek.");
  output.stop();
});

test("stopping aborts what is still being made and reports the words actually heard", async () => {
  const { output, requests, context } = await setup();
  const turn = output.speak();

  turn.push("Mitohondrij je elektrarna celice, ki naredi energijo. Druga stvar pa je, da ");
  await settle();
  requests[0].respond(200, [pcm(4, 7)]);
  await settle();

  // About half of the first sentence has been heard.
  context.currentTime = context.sources[0].startAt + 1.6;

  const { spokenText, wasSpeaking } = output.stop();

  assert.equal(wasSpeaking, true);
  assert.ok("Mitohondrij je elektrarna celice, ki naredi energijo.".startsWith(spokenText));
  assert.ok(spokenText.split(" ").length >= 2 && spokenText.split(" ").length <= 4, spokenText);
  assert.ok(context.sources.every((source) => source.stopped));

  await assert.doesNotReject(turn.finished);
});

test("a piece that dropped before any audio is asked for again", async () => {
  const { output, requests, context } = await setup();
  const turn = output.speak();

  turn.push("Dobro, poglejva ravnovesno ceno. ");
  turn.end();
  await settle();

  requests[0].dropConnection();
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.text, requests[0].body.text);

  requests[1].respond(200, [pcm(1, 5)]);
  await settle();
  context.playAll();
  await assert.doesNotReject(turn.finished);
});

test("a piece Gemini had nothing to say for is skipped, not the end of the lesson", async () => {
  const { output, requests, context } = await setup();
  const turn = output.speak();

  turn.push("Prvi stavek je tukaj. Drugi stavek je tukaj. ");
  turn.end();
  await settle();

  requests[0].respond(422);
  requests[1].respond(200, [pcm(1, 9)]);
  await settle();

  assert.deepEqual(context.sources.map(markerOf), [9]);
  context.playAll();
  await assert.doesNotReject(turn.finished);
});

test("a busy service fails the turn and says so, the way Soniox's 429 did", async () => {
  const errors = [];
  const { output, requests } = await setup({ onError: (error) => errors.push(error) });
  const turn = output.speak();

  turn.push("Dobro, poglejva ravnovesno ceno. ");
  turn.end();
  await settle();
  requests[0].respond(429);
  await settle();

  await assert.rejects(turn.finished, (error) => error.code === "429");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "429");
});

test("an expired token fails the turn instead of being retried", async () => {
  const errors = [];
  const { output, requests } = await setup({ onError: (error) => errors.push(error) });
  const turn = output.speak();

  turn.push("Dobro, poglejva ravnovesno ceno. ");
  turn.end();
  await settle();
  requests[0].respond(401);
  await settle();

  await assert.rejects(turn.finished, (error) => error.code === "401");
  assert.equal(requests.length, 1);
});

test("a renewed token is used from the next piece on", async () => {
  const { output, requests } = await setup();
  const turn = output.speak();

  turn.push("Prvi stavek je tukaj. Drugi");
  await settle();
  output.useKey("token-2");
  turn.push(" stavek. Tretji");
  await settle();

  assert.equal(requests[0].headers.Authorization, "Bearer token-1");
  assert.equal(requests[1].headers.Authorization, "Bearer token-2");
  output.stop();
});

test("a turn that never said anything finishes at once", async () => {
  const { output, requests } = await setup();
  const turn = output.speak();

  turn.push("[laughs]");
  turn.end();
  await settle();

  assert.equal(requests.length, 0);
  await assert.doesNotReject(turn.finished);
});

test("an odd byte split across two chunks is not lost or turned into noise", async () => {
  const { output, requests, context } = await setup();
  const turn = output.speak();

  turn.push("Dobro, poglejva ravnovesno ceno. ");
  turn.end();
  await settle();

  const audio = pcm(0.01, 1234);
  requests[0].respond(200, [audio.subarray(0, 3), audio.subarray(3)]);
  await settle();

  const total = context.sources.reduce((sum, source) => sum + source.buffer.getChannelData(0).length, 0);

  assert.equal(total, audio.length / 2);

  for (const source of context.sources) {
    for (const sample of source.buffer.getChannelData(0)) {
      assert.equal(Math.round(sample * 32_768), 1234);
    }
  }

  output.stop();
});
