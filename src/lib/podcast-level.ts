/*
 * The live level of the podcast's own audio, so the spheres move while a host is talking.
 *
 * The tutor's sphere has always ridden `--orb-level`: its synthesizer plays through a WebAudio
 * graph, so an analyser was already in the path and the level was there for the taking. The
 * podcast is not built that way — it plays finished files through two `<audio>` elements, and
 * a media element publishes no level at all. Its spheres therefore sat perfectly still through
 * a conversation, which reads as artwork rather than as the thing that is speaking.
 *
 * So the elements are routed through a graph of our own. Two things about
 * `createMediaElementSource` shape everything here:
 *
 *   - it may be called once per element, ever. A second call throws, and the element is left
 *     connected to the first graph. Hence the cache, keyed by the element itself.
 *   - it *reroutes* the element. Once an element has a source node, its audio no longer reaches
 *     the speakers on its own — it comes out only where the graph is connected. A meter that
 *     forgets to connect through to the destination is a meter that silences the podcast, which
 *     is why `connect(context.destination)` is not optional and why every failure below leaves
 *     the element alone rather than half-wired.
 *
 * Everything is best-effort. A browser that refuses an AudioContext, an element the graph
 * cannot read, a context the autoplay policy keeps suspended: each of those costs the motion
 * and nothing else. The audio still plays, because the audio is the element's own.
 *
 * ## Never source into a context that is not running
 *
 * The rule the rest of this file is built around, and the reason `attach` refuses more often
 * than it looks like it should. A suspended context processes nothing — so an element sourced
 * into one is not a sphere that fails to move, it is a podcast that plays silently while the
 * transport runs and the clock advances. And a context is suspended more often than the happy
 * path suggests: the first play of an episode comes from an effect rather than from the tap
 * that opened it, so there is no transient user activation in scope, and iOS Safari refuses
 * `resume()` without one. Hence: resume first, wire second, and wire nothing until the context
 * says it is running. An element that is never wired keeps its own output and plays normally.
 *
 * ## The silent switch
 *
 * The one place rerouting is not free, and the second thing that can only ever cost the motion
 * here. iOS decides whether the ring/silent switch mutes a sound from the audio *session
 * category*, and a WebAudio graph defaults to the ambient one — so an element that played
 * through a silenced phone perfectly well before goes quiet the moment its audio arrives via a
 * graph. `navigator.audioSession` is the opt-out, and this is a podcast: "playback" is exactly
 * what it is. It has been in Safari since 16.4, which is the floor the site already builds to.
 *
 * Where it is missing the platform decides whether that matters. On a desktop browser there is
 * no hardware switch to be caught by and nothing to opt out of, so the meter runs. On an iPhone
 * there is, so the meter does not run at all: a still sphere is a smaller loss than a podcast
 * that plays in silence for everyone who keeps their ringer off, and that is not a trade to
 * make on the strength of a version number.
 */

/** Small window, heavy smoothing — this drives a shape, not a meter. The tutor's numbers. */
const FFT_SIZE = 512;
const SMOOTHING = 0.72;

/**
 * Declares this a podcast rather than a UI sound, so the ring/silent switch leaves it alone.
 * Answers whether the graph is safe to use at all — see "The silent switch" above.
 */
function canPlayThroughGraph() {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;

  if (session) {
    try {
      session.type = "playback";
      return true;
    } catch {
      /* Present but not settable: treat it as absent and let the platform decide below. */
    }
  }

  /* iPadOS reports itself as a Mac, and a touch count is what gives it away. */
  const isApplePhoneOrTablet =
    /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  return !isApplePhoneOrTablet;
}

type Wired = {
  analyser: AnalyserNode;
  /* Explicitly over an `ArrayBuffer`: `getFloatTimeDomainData` will not take a shared one. */
  buffer: Float32Array<ArrayBuffer>;
};

export class PodcastLevelMeter {
  private context: AudioContext | null = null;
  private readonly wired = new Map<HTMLAudioElement, Wired>();
  /** Elements the graph could not take. Never retried; see the catch in `attach`. */
  private readonly refused = new Set<HTMLAudioElement>();
  private failed = false;

  /**
   * Meters these elements, if and when the browser lets us.
   *
   * Call it on every play rather than once: an element already wired is skipped, and a call
   * made while the context is asleep does nothing but ask it to wake — which is what makes a
   * later play, with a real tap behind it, the retry.
   */
  start(elements: ReadonlyArray<HTMLAudioElement | null>) {
    const context = this.open();

    if (!context) {
      return;
    }

    if (context.state === "running") {
      this.wire(context, elements);
      return;
    }

    /*
     * Asleep. Ask it to wake and wire only if it does — never before, and never in the
     * rejection path. A resume refused for want of a gesture leaves every element exactly as
     * it was, which is playing through its own output.
     */
    void context
      .resume()
      .then(() => {
        if (context.state === "running") {
          this.wire(context, elements);
        }
      })
      .catch(() => {});
  }

  private open() {
    if (this.failed) {
      return null;
    }

    if (this.context) {
      return this.context;
    }

    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!Context) {
        this.failed = true;
        return null;
      }

      if (!canPlayThroughGraph()) {
        this.failed = true;
        return null;
      }

      this.context = new Context();

      return this.context;
    } catch {
      /* No context, no meter, and nothing element-specific about it: stop trying. */
      this.failed = true;
      return null;
    }
  }

  private wire(context: AudioContext, elements: ReadonlyArray<HTMLAudioElement | null>) {
    for (const element of elements) {
      if (!element || this.wired.has(element) || this.refused.has(element)) {
        continue;
      }

      try {
        /*
         * Past this line the element is committed: a sourced element no longer reaches the
         * speakers by itself, and there is no way to give it back. So the source is held and
         * every later step is guarded — a failure after this point must still leave the audio
         * connected to something, and it is better to lose the meter than the podcast.
         */
        const source = context.createMediaElementSource(element);

        try {
          const analyser = context.createAnalyser();
          analyser.fftSize = FFT_SIZE;
          analyser.smoothingTimeConstant = SMOOTHING;

          source.connect(analyser);
          analyser.connect(context.destination);

          this.wired.set(element, {
            analyser,
            buffer: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
          });
        } catch (error) {
          source.connect(context.destination);
          throw error;
        }
      } catch {
        /*
         * Left alone and never tried again — it either kept its own output or was wired
         * straight through above, and retrying on every play would only repeat what just
         * failed.
         */
        this.refused.add(element);
      }
    }
  }

  /** The RMS of what this element is playing right now, 0 when it is not wired or not playing. */
  getLevel(element: HTMLAudioElement | null) {
    if (!element) {
      return 0;
    }

    const wired = this.wired.get(element);

    if (!wired || element.paused) {
      return 0;
    }

    wired.analyser.getFloatTimeDomainData(wired.buffer);

    let sum = 0;

    for (let index = 0; index < wired.buffer.length; index += 1) {
      sum += wired.buffer[index] * wired.buffer[index];
    }

    return Math.sqrt(sum / wired.buffer.length);
  }

  /** Drops the graph. The elements keep their source nodes — those cannot be undone. */
  close() {
    this.wired.clear();
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => {});
  }
}
