import assert from "node:assert/strict";
import test from "node:test";

import {
  isNativeRecorderAvailable,
  startNativeRecording,
  stopNativeRecording,
} from "../src/lib/mobile/native-recorder.ts";

/**
 * A stand-in for the app's `memoNative` bridge, holding one finished recording.
 *
 * The real thing cannot be reached from here — it is injected by the iOS app
 * into the page — and the part worth pinning down is this side of it: that a
 * lecture of any size crosses in slices and arrives whole, and that a failed
 * transfer does not take the audio down with it.
 */
function fakeBridge(bytes, { version = 2, readLimit = Infinity, failAt = null } = {}) {
  const calls = [];

  return {
    calls,
    version,
    async request(command, payload = {}) {
      calls.push([command, payload]);

      switch (command) {
        case "recorderStart":
          return { state: "recording", elapsed: 0, interrupted: false, bannerAvailable: true };
        case "recorderStop":
          return {
            fileName: "lecture-1.m4a",
            mimeType: "audio/mp4",
            size: bytes.length,
            elapsed: 91.5,
          };
        case "recorderRead": {
          if (failAt != null && payload.offset >= failAt) {
            // The app answers a read it cannot serve with no bytes.
            return { data: "", length: 0 };
          }

          const slice = bytes.subarray(payload.offset, payload.offset + Math.min(payload.length, readLimit));
          return { data: Buffer.from(slice).toString("base64"), length: slice.length };
        }
        case "recorderDiscard":
          return { status: "discarded" };
        default:
          throw new Error(`unexpected command ${command}`);
      }
    },
  };
}

async function withBridge(bridge, run) {
  const previous = globalThis.window;
  globalThis.window = bridge ? { memoNative: bridge } : undefined;

  try {
    // Awaited, not returned: the bridge has to still be in place while the
    // transfer runs, not only while it is started.
    return await run();
  } finally {
    if (previous === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previous;
    }
  }
}

/** Recognisable bytes, so a chunk assembled out of order would show up. */
const recording = Buffer.alloc(5 * 1024 * 1024 + 777).map((_, index) => index % 251);

test("an older app build is left on the web recorder", async () => {
  // The page ships independently of the binary: build 2 is installed on phones
  // and answers "Unsupported request" to every command added here.
  await withBridge(fakeBridge(recording, { version: 1 }), () =>
    assert.equal(isNativeRecorderAvailable(), false));
  await withBridge(fakeBridge(recording), () =>
    assert.equal(isNativeRecorderAvailable(), true));
  await withBridge(null, () => assert.equal(isNativeRecorderAvailable(), false));
});

test("a recording crosses in slices and arrives byte for byte", async () => {
  const bridge = fakeBridge(recording);

  const { file, durationSeconds } = await withBridge(bridge, async () => {
    await startNativeRecording();
    return await stopNativeRecording();
  });

  assert.equal(file.size, recording.length);
  assert.equal(file.type, "audio/mp4");
  assert.equal(file.name, "lecture-1.m4a");
  assert.equal(durationSeconds, 91.5);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), recording);

  const reads = bridge.calls.filter(([command]) => command === "recorderRead");
  assert.equal(reads.length, 3, "5 MB moves in 2 MB slices, not in one message");
  assert.deepEqual(
    reads.map(([, payload]) => payload.offset),
    [0, 2 * 1024 * 1024, 4 * 1024 * 1024],
  );
  // The last slice asks only for what is left, never past the end of the file.
  assert.equal(reads.at(-1)[1].length, 777 + 1024 * 1024);
});

test("a short read does not stop the transfer, only a refused one does", async () => {
  // The app is free to answer with less than was asked for; the loop has to
  // follow the bytes it got rather than the bytes it wanted.
  const bridge = fakeBridge(recording, { readLimit: 300_000 });

  const { file } = await withBridge(bridge, () => stopNativeRecording());

  assert.equal(file.size, recording.length);
  assert.ok(bridge.calls.filter(([command]) => command === "recorderRead").length > 3);
});

test("a transfer that fails leaves the audio on the phone", async () => {
  const bridge = fakeBridge(recording, { failAt: 2 * 1024 * 1024 });

  await assert.rejects(
    withBridge(bridge, () => stopNativeRecording()),
    /could not be read/,
  );

  assert.ok(
    !bridge.calls.some(([command]) => command === "recorderDiscard"),
    "the recording is the only copy until every slice is in hand",
  );
});

test("progress is reported against the size the app declared", async () => {
  const seen = [];
  await withBridge(fakeBridge(recording), () => stopNativeRecording((fraction) => seen.push(fraction)));

  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1), 1);
  assert.ok(seen.every((fraction, index) => index === 0 || fraction > seen[index - 1]));
});

test("a duration is never zero, so the upload path never decodes the file itself", async () => {
  const bridge = fakeBridge(Buffer.from("tiny"));
  bridge.request = async (command, payload) => {
    if (command === "recorderStop") {
      return { fileName: "a.m4a", mimeType: "audio/mp4", size: 4, elapsed: 0 };
    }
    if (command === "recorderRead") {
      return { data: Buffer.from("tiny").toString("base64"), length: 4 };
    }
    return { status: "discarded" };
  };

  const { durationSeconds } = await withBridge(bridge, () => stopNativeRecording());
  assert.equal(durationSeconds, 1);
});
