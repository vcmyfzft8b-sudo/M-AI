import assert from "node:assert/strict";
import test from "node:test";

/*
 * The one rule this meter has to keep.
 *
 * `createMediaElementSource` takes an element's audio away from the speakers and hands it to
 * the graph, permanently. So sourcing an element into a context that is not running does not
 * cost the sphere motion, it costs the podcast: the transport runs, the clock advances and
 * nothing is heard. The first play of an episode reaches the meter from an effect rather than
 * from the tap that opened it, so a browser that wants a gesture before it will wake an audio
 * context — iOS Safari — is the ordinary case here, not the exotic one.
 */

function fakeAudio() {
  return { paused: false, tag: "audio" };
}

function fakeContext({ state = "running", resume } = {}) {
  const context = {
    state,
    destination: { name: "destination" },
    sourced: [],
    connections: [],
    createMediaElementSource(element) {
      context.sourced.push(element);
      return { connect: (node) => context.connections.push(node) };
    },
    createAnalyser: () => ({
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect: (node) => context.connections.push(node),
      getFloatTimeDomainData: (buffer) => buffer.fill(0.5),
    }),
    resume:
      resume ??
      (() => {
        context.state = "running";
        return Promise.resolve();
      }),
    close: () => Promise.resolve(),
  };

  return context;
}

const { PodcastLevelMeter } = await import("../src/lib/podcast-level.ts");

/*
 * `window` is read when the context is opened, not when the meter is built, so it stays
 * installed for the life of the test rather than only for the constructor.
 */
function meterWith(context, { platform = "desktop" } = {}) {
  globalThis.window = { AudioContext: function () { return context; } };
  installNavigator(platform);

  return new PodcastLevelMeter();
}

/*
 * Node ships a read-only `navigator`, so the platform is faked by shadowing the property for
 * the duration of a test rather than by assigning to it.
 */
function installNavigator(platform) {
  const values = {
    desktop: { userAgent: "Mozilla/5.0 (Macintosh) Chrome", platform: "MacIntel", maxTouchPoints: 0 },
    // Safari 16.4 and up: the graph can declare itself playback, so the switch is not a problem.
    "ios-modern": { userAgent: "Mozilla/5.0 (iPhone) Safari", platform: "iPhone", maxTouchPoints: 5, audioSession: { type: "auto" } },
    // A WebKit without the opt-out: the ring switch would mute the podcast, so nothing is taken.
    "ios-old": { userAgent: "Mozilla/5.0 (iPhone) Safari", platform: "iPhone", maxTouchPoints: 5 },
    "ipados-old": { userAgent: "Mozilla/5.0 (Macintosh) Safari", platform: "MacIntel", maxTouchPoints: 5 },
  }[platform];

  Object.defineProperty(globalThis, "navigator", { value: values, configurable: true, writable: true });
}

test("a context that will not wake is never given the audio", async () => {
  const context = fakeContext({
    state: "suspended",
    // What iOS Safari does when there is no transient user activation to spend.
    resume: () => Promise.reject(new Error("not allowed")),
  });
  const meter = meterWith(context);
  const element = fakeAudio();

  meter.start([element]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(context.sourced, [], "the element must keep its own output");
  assert.equal(meter.getLevel(element), 0);
});

test("a context that wakes late still gets the audio, and only then", async () => {
  let allow;
  const context = fakeContext({
    state: "suspended",
    resume: () =>
      new Promise((resolve) => {
        allow = () => {
          context.state = "running";
          resolve();
        };
      }),
  });
  const meter = meterWith(context);
  const element = fakeAudio();

  meter.start([element]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(context.sourced, [], "nothing is taken while the context sleeps");

  allow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(context.sourced, [element]);
});

test("a running context meters both elements and still feeds the speakers", async () => {
  const context = fakeContext();
  const meter = meterWith(context);
  const [a, b] = [fakeAudio(), fakeAudio()];

  meter.start([a, b, null]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(context.sourced, [a, b]);
  assert.equal(
    context.connections.filter((node) => node === context.destination).length,
    2,
    "every element reaches the destination, or the podcast is silent",
  );
  // 0.5 everywhere, so the RMS is 0.5. A paused element reads nothing.
  assert.equal(meter.getLevel(a), 0.5);
  b.paused = true;
  assert.equal(meter.getLevel(b), 0);
});

test("an iPhone that cannot ask for the playback session keeps its own audio", async () => {
  // Losing the sphere motion is cheap. Losing the podcast for everyone who keeps their ringer
  // off is not, and a WebAudio graph is what the ring/silent switch mutes.
  for (const platform of ["ios-old", "ipados-old"]) {
    const context = fakeContext();
    const meter = meterWith(context, { platform });
    const element = fakeAudio();

    meter.start([element]);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(context.sourced, [], `${platform} must not be rerouted`);
  }
});

test("an iPhone that can ask for it is metered, and asks", async () => {
  const context = fakeContext();
  const meter = meterWith(context, { platform: "ios-modern" });
  const element = fakeAudio();

  meter.start([element]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(navigator.audioSession.type, "playback");
  assert.deepEqual(context.sourced, [element]);
});

test("offering the same element twice does not source it twice", async () => {
  const context = fakeContext();
  const meter = meterWith(context);
  const element = fakeAudio();

  meter.start([element]);
  meter.start([element]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(context.sourced, [element]);
});

test("an element the graph refuses is left playing on its own, and not retried", async () => {
  const context = fakeContext();
  const element = fakeAudio();
  context.createMediaElementSource = () => {
    context.sourced.push(element);
    throw new Error("already sourced");
  };

  const meter = meterWith(context);

  meter.start([element]);
  meter.start([element]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.sourced.length, 1, "a refusal is not repeated on every play");
  assert.equal(meter.getLevel(element), 0);
});
