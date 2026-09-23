import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { savePodcastProgress } from "../src/lib/podcast-progress.ts";

test("a slow earlier save cannot overwrite a newer seek", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  let storedPosition;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.positionMs === 0) await delayed;
    storedPosition = body.positionMs;
    return { ok: true, json: async () => ({ saved: true }) };
  };
  try {
    const base = { lectureId: "note", episodeId: "episode", durationMs: 100_000 };
    const earlier = savePodcastProgress({ ...base, positionMs: 0 });
    const latest = savePodcastProgress({ ...base, positionMs: 20_439 });
    await setImmediate();
    release();
    await Promise.all([earlier, latest]);
    assert.equal(storedPosition, 20_439);
    assert.deepEqual(JSON.parse(storage.get("memo-podcast-progress") ?? "{}"), {});
  } finally {
    release();
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("an earlier acknowledgement cannot discard a newer failed save", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const storage = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  let latestStarted;
  const started = new Promise((resolve) => { latestStarted = resolve; });
  globalThis.fetch = async (_url, options) => {
    const { positionMs } = JSON.parse(options.body);
    if (positionMs === 30_000) {
      latestStarted();
      await delayed;
      throw new Error("offline");
    }
    return { ok: true, json: async () => ({ saved: true }) };
  };
  try {
    const base = { lectureId: "note", episodeId: "episode", durationMs: 100_000 };
    const earlier = savePodcastProgress({ ...base, positionMs: 10_000 });
    const latest = savePodcastProgress({ ...base, positionMs: 30_000 });
    await earlier;
    await started;
    assert.equal(JSON.parse(storage.get("memo-podcast-progress")).episode.positionMs, 30_000);
    release();
    await latest;
    assert.equal(JSON.parse(storage.get("memo-podcast-progress")).episode.positionMs, 30_000);
  } finally {
    release();
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});
