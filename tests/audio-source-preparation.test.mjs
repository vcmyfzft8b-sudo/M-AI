import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/audio-source-preparation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function preparation(mode, { wavDuration = null } = {}) {
  const timers = new Map();
  const calls = { revoked: [], media: [], compression: [] };
  let sequence = 0;
  const context = {
    exports: {},
    require(name) {
      if (name === "@/lib/constants") return { MAX_AUDIO_BYTES: 100_000_000, MAX_AUDIO_SECONDS: 10_800 };
      if (name === "@/lib/wav-duration") return { readWavDurationSeconds: async () => wavDuration };
      if (name === "@/lib/file-compression-client") return {
        CompressionError: class extends Error {},
        compressAudioForUpload: async (file, options) => {
          calls.compression.push(options);
          return { file, compressed: false };
        },
      };
      throw Error(name);
    },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    URL: {
      createObjectURL: () => "blob:synthetic-audio",
      revokeObjectURL: url => calls.revoked.push(url),
    },
    document: {
      createElement(tag) {
        assert.equal(tag, "audio");
        const audio = {
          duration: 92.135,
          source: null,
          loadCount: 0,
          removed: false,
          set src(value) {
            this.source = value;
            if (mode === "immediate") this.onloadedmetadata?.();
          },
          load() {
            this.loadCount++;
            if (!this.source) return;
            if (mode === "explicit-load") this.onloadedmetadata?.();
            if (mode === "error") this.onerror?.();
          },
          removeAttribute(name) { assert.equal(name, "src"); this.source = null; },
          remove() { this.removed = true; },
        };
        calls.media.push(audio);
        return audio;
      },
    },
  };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, calls, timers, expire: () => { for (const fn of [...timers.values()]) fn(); } };
}
const file = new File(["synthetic"], "lecture.m4a", { type: "audio/mp4" });

for (const mode of ["explicit-load", "immediate"]) {
  test(`audio metadata resolves when the browser requires ${mode}`, async () => {
    const { api, calls, timers } = preparation(mode);
    assert.equal(await api.readAudioDurationFromMetadata(file), 92.135);
    assert.deepEqual(calls.revoked, ["blob:synthetic-audio"]);
    assert.equal(calls.media[0].removed, true);
    assert.equal(calls.media[0].source, null);
    assert.equal(timers.size, 0);
  });
}

test("a media element that never emits an event releases the URL and reaches the WAV fallback", async () => {
  const { api, calls, timers, expire } = preparation("silent", { wavDuration: 120 });
  const pending = api.prepareAudioSourceForUpload({ file });
  assert.equal(timers.size, 1);
  expire();
  const result = await pending;
  assert.equal(result.durationSeconds, 120);
  assert.equal(calls.compression.length, 1);
  assert.equal(calls.compression[0].force, false);
  assert.equal(timers.size, 0);
  assert.equal(calls.media[0].removed, true);
  assert.deepEqual(calls.revoked, ["blob:synthetic-audio"]);
});

test("unreadable media reaches a localized preparation stage and a useful failure", async () => {
  const { api, calls, timers } = preparation("error");
  const stages = [];
  await assert.rejects(api.prepareAudioSourceForUpload({ file, onStageChange: key => stages.push(key) }), /audio.unreadable/);
  assert.equal(calls.compression[0].force, true);
  assert.deepEqual(stages, ["audio.upload.normalising"]);
  assert.equal(timers.size, 0);
});

test("native recording duration bypasses browser metadata without bypassing duration limits", async () => {
  const { api, calls } = preparation("silent");
  assert.equal((await api.prepareAudioSourceForUpload({ file, knownDurationSeconds: 92.1 })).durationSeconds, 92);
  assert.equal(calls.media.length, 0);
  await assert.rejects(api.prepareAudioSourceForUpload({ file, knownDurationSeconds: 10_801 }), /audio.tooLong/);
  assert.equal(calls.compression.length, 1);
});
