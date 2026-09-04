/**
 * Plays one pre-rendered tutor clip, and says how loud it is.
 *
 * The voice a learner auditions and the voice the marketing page demonstrates are
 * both fixed lines, rendered once by `scripts/generate-tutor-voice-clips.mjs` and
 * shipped as files. Neither needs a session, a socket or a model, so neither gets
 * one: this is an `<audio>` tag with two things added.
 *
 * The first is that only one of these can be heard at a time, across every player
 * on the page. Auditioning voices is a rapid business — tap, tap, tap — and the
 * failure it invites is two of them talking over each other.
 *
 * The second is the level. The sphere breathes on whatever is being said, and an
 * `<audio>` element does not report that, so where the browser allows it the clip
 * is routed through an analyser on its way to the speakers. That routing is the
 * one thing here that can go wrong quietly: a `MediaElementAudioSourceNode` takes
 * the element's output away permanently, and a context that never starts would
 * leave a clip that plays in silence. So it is only built once the context is
 * confirmed running, inside the gesture that started playback, and any failure
 * along the way leaves the element playing on its own — silent sphere, audible
 * voice, which is the right way round to fail.
 */

/** The player currently allowed to make noise, and the two ways it changes hands. */
let holder: TutorClipPlayer | null = null;

function claimFloor(next: TutorClipPlayer) {
  if (holder && holder !== next) {
    holder.stop();
  }

  holder = next;
}

function releaseFloor(player: TutorClipPlayer) {
  if (holder === player) {
    holder = null;
  }
}

type PlayOptions = {
  /** Keep going round rather than ending — for a bed that has to outlast its clip. */
  loop?: boolean;
  muted?: boolean;
};

export class TutorClipPlayer {
  private element: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  /** Set once the routing has been tried, so a failure is not retried every clip. */
  private analyserSettled = false;

  /** Called when a clip reaches its end on its own. */
  onEnded: (() => void) | null = null;

  private ensureElement() {
    if (this.element) {
      return this.element;
    }

    const element = new Audio();
    element.preload = "auto";
    element.addEventListener("ended", () => this.onEnded?.());
    this.element = element;

    return element;
  }

  private ensureAnalyser(element: HTMLAudioElement) {
    if (this.analyserSettled) {
      return;
    }

    this.analyserSettled = true;

    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!Context) {
        return;
      }

      const context = new Context();

      /*
       * Resuming is fire-and-forget, but the check below is not: taking the
       * element's output into a context that is still suspended is exactly the
       * silent failure this is guarding against.
       */
      void context.resume();

      if (context.state !== "running") {
        void context.close();
        return;
      }

      const source = context.createMediaElementSource(element);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(context.destination);

      this.context = context;
      this.analyser = analyser;
      this.samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch {
      /* No analyser, and no harm: the element is still wired to the speakers. */
      this.context = null;
      this.analyser = null;
    }
  }

  /**
   * Starts a clip. Rejects when the browser refuses — an autoplay policy, a file
   * that is not there — which callers treat as "run the demo silently".
   */
  async play(src: string, { loop = false, muted = false }: PlayOptions = {}) {
    claimFloor(this);

    const element = this.ensureElement();

    if (!element.src.endsWith(src)) {
      element.src = src;
    }

    element.loop = loop;
    element.muted = muted;
    element.currentTime = 0;

    await element.play();
    this.ensureAnalyser(element);
  }

  /** Holds position — the tutor ducking for a learner who cut in. */
  pause() {
    this.element?.pause();
  }

  /** Carries on from where it ducked. */
  async resume() {
    const element = this.element;

    if (!element || !element.src) {
      return;
    }

    claimFloor(this);
    await element.play();
  }

  stop() {
    const element = this.element;

    if (element) {
      element.pause();
      element.currentTime = 0;
    }

    releaseFloor(this);
  }

  set muted(muted: boolean) {
    if (this.element) {
      this.element.muted = muted;
    }
  }

  get playing() {
    const element = this.element;
    return Boolean(element && !element.paused && !element.ended);
  }

  /**
   * How loud it is right now, 0 to 1 — the same shape the live tutor's own output
   * reports, so the sphere reads it the same way. Zero when there is no analyser,
   * which the sphere treats as "animate on your own".
   */
  getLevel() {
    const analyser = this.analyser;
    const samples = this.samples;

    if (!analyser || !samples || !this.playing) {
      return 0;
    }

    analyser.getByteTimeDomainData(samples);

    let sum = 0;

    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sum += centred * centred;
    }

    return Math.sqrt(sum / samples.length);
  }

  /** Whether a level is worth reading at all. */
  get hasLevel() {
    return this.analyser !== null;
  }

  destroy() {
    this.stop();
    this.onEnded = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.element = null;
  }
}
