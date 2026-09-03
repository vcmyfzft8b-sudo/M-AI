import { SpeechBandAnalyser, VoiceActivityDetector } from "@/lib/tutor/turn-audio";

/**
 * The tutor's ears: the microphone, a local voice detector, and one Soniox
 * recognizer socket kept open for the whole session.
 *
 * The microphone stays open the entire time — that is what "just start talking"
 * means. There is no button to hold and no wake word; the learner speaks and the
 * tutor stops. Two separate signals come out of here and they are used for
 * different things:
 *
 *   - the *voice* detector, which fires locally within about a tenth of a second
 *     and is what makes the tutor go quiet the instant somebody opens their
 *     mouth — it looks at where in the spectrum a sound sits, not just at how
 *     loud it is, so a passing car and a turned page do not silence anything, and
 *   - the *recognizer*, which is a network round trip behind but knows what was
 *     actually said, and therefore decides whether that was a question or a
 *     cough.
 *
 * Splitting them is the difference between a voice agent that feels alive and
 * one that talks over people for half a second every time.
 */

/** How often the worklet hands a frame back. 20ms is one packet's worth. */
const FRAME_MS = 20;

/** Soniox closes an idle recognizer; this is well inside its window. */
const KEEPALIVE_INTERVAL_MS = 10_000;

/**
 * How long after the last word the recognizer waits before calling the turn over.
 *
 * Soniox allows 500ms to 3000ms. A short value makes the tutor quick to answer
 * and quick to cut somebody off mid-thought; a long one is the reverse. Nine
 * hundred milliseconds is about the length of the pause people leave inside a
 * sentence when they are thinking, which is the pause that must NOT end a turn.
 */
const ENDPOINT_DELAY_MS = 900;

/*
 * The microphone processor.
 *
 * It runs on the audio thread as a worklet rather than on the main thread as a
 * ScriptProcessorNode, which matters more here than it usually does: the main
 * thread is also painting the sphere at sixty frames a second, and a dropped
 * microphone frame is a hole in the middle of somebody's question. Delivered as
 * a blob rather than a file in /public so the whole feature stays one import
 * away from working, with nothing to forget to deploy.
 *
 * All it does is batch the 128-sample blocks the audio thread runs at into
 * packets worth sending. What each packet *sounds* like is measured on the other
 * side, in SpeechBandAnalyser, where it can be unit-tested — the audio thread's
 * job is to lose no frames, and everything it does beyond that is a risk to it.
 */
const RECORDER_WORKLET = `
class TutorRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = options.processorOptions.frameSize;
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];

    if (!channel) {
      return true;
    }

    for (let index = 0; index < channel.length; index += 1) {
      this.buffer[this.filled] = channel[index];
      this.filled += 1;

      if (this.filled === this.frameSize) {
        const pcm = new Int16Array(this.frameSize);

        for (let sample = 0; sample < this.frameSize; sample += 1) {
          const value = Math.max(-1, Math.min(1, this.buffer[sample]));
          pcm[sample] = value < 0 ? value * 0x8000 : value * 0x7fff;
        }

        this.port.postMessage({ pcm: pcm.buffer }, [pcm.buffer]);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('tutor-recorder', TutorRecorder);
`;

export type SpeechInputConfig = {
  url: string;
  apiKey: string;
  model: string;
  /**
   * Languages to hint the recognizer with, best first — the app's language, then the
   * note's when it differs. Never strict: a learner may ask in a third language, and a
   * strict hint would transcribe that as nonsense rather than as a question.
   */
  languages: string[];
};

export type SpeechInputHandlers = {
  /** The local detector heard a voice. Fires within ~100ms, before anyone knows what it said. */
  onVoiceStart?: () => void;
  /** The local detector heard the room go quiet again. */
  onVoiceEnd?: () => void;
  /** The recognizer's running best guess at the current utterance. */
  onPartial?: (text: string) => void;
  /** The recognizer decided the utterance is over. Carries everything it heard. */
  onUtterance?: (text: string) => void;
  onError?: (error: SpeechInputError) => void;
};

export class SpeechInputError extends Error {
  constructor(
    message: string,
    readonly reason: "denied" | "unavailable" | "connection",
  ) {
    super(message);
    this.name = "SpeechInputError";
  }
}

export class TutorSpeechInput {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private socket: WebSocket | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private workletUrl: string | null = null;
  private readonly detector = new VoiceActivityDetector();
  /** Built in `start`, once the hardware has said what rate it runs at. */
  private analyser: SpeechBandAnalyser | null = null;

  private muted = false;
  private closed = false;
  private level = 0;

  /** Words the recognizer has settled on for the utterance in progress. */
  private finalText = "";
  /** Words it is still revising. Shown live, never trusted as the whole question. */
  private draftText = "";

  constructor(
    private readonly config: SpeechInputConfig,
    private readonly handlers: SpeechInputHandlers = {},
  ) {}

  /**
   * Opens the microphone and the recognizer.
   *
   * The three constraints are not boilerplate. `echoCancellation` is what stops
   * the tutor from hearing itself through the phone's own speaker and
   * interrupting itself — it is the single most important flag in this file, and
   * `isEchoOfTutor` in turn-audio.ts is the backstop for the leakage it does not
   * catch. `noiseSuppression` takes the steady part of a room out before anything
   * else sees it, and `autoGainControl` keeps somebody sitting back from a laptop
   * at the same level as somebody leaning in — the detector's own band test is
   * what handles the transients those two leave behind.
   */
  async start() {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) {
      throw new SpeechInputError("This browser cannot open a microphone.", "unavailable");
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");

      throw new SpeechInputError(
        denied ? "Microphone access was refused." : "The microphone could not be opened.",
        denied ? "denied" : "unavailable",
      );
    }

    /*
     * The context runs at whatever rate the hardware gives, and the recognizer is
     * told that rate. Forcing 16kHz here would be one resample on the critical
     * path for no gain — Soniox takes raw PCM at any rate, and a resampler in
     * front of a recognizer is a place for artefacts, not a saving.
     */
    const context = new AudioContextClass();
    await context.resume();
    this.context = context;
    this.analyser = new SpeechBandAnalyser(context.sampleRate);

    const blob = new Blob([RECORDER_WORKLET], { type: "application/javascript" });
    this.workletUrl = URL.createObjectURL(blob);
    await context.audioWorklet.addModule(this.workletUrl);

    await this.openSocket(context.sampleRate);

    const frameSize = Math.round((context.sampleRate * FRAME_MS) / 1000);
    const node = new AudioWorkletNode(context, "tutor-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { frameSize },
    });

    node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer }>) => {
      this.handleFrame(event.data);
    };

    this.source = context.createMediaStreamSource(this.stream);
    this.source.connect(node);
    this.node = node;
  }

  private openSocket(sampleRate: number) {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.config.url);
      socket.binaryType = "arraybuffer";

      const onOpen = () => {
        socket.removeEventListener("error", onError);
        socket.send(
          JSON.stringify({
            api_key: this.config.apiKey,
            model: this.config.model,
            audio_format: "pcm_s16le",
            sample_rate: sampleRate,
            num_channels: 1,
            language_hints: this.config.languages,
            enable_endpoint_detection: true,
            max_endpoint_delay_ms: ENDPOINT_DELAY_MS,
          }),
        );
        this.socket = socket;
        this.keepaliveTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "keepalive" }));
          }
        }, KEEPALIVE_INTERVAL_MS);
        socket.addEventListener("message", (event) => this.handleMessage(event));
        socket.addEventListener("close", () => {
          if (!this.closed) {
            this.handlers.onError?.(
              new SpeechInputError("The recognizer connection closed.", "connection"),
            );
          }
        });
        resolve();
      };
      const onError = () => {
        socket.removeEventListener("open", onOpen);
        reject(new SpeechInputError("The recognizer could not be reached.", "connection"));
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
  }

  /** The microphone's current level, for the ring around the sphere. */
  getLevel() {
    return this.level;
  }

  get isMuted() {
    return this.muted;
  }

  /**
   * Stops sending audio without closing anything.
   *
   * The socket stays open and the detector is reset, so unmuting is instant and
   * does not cost a reconnection. Soniox bills a realtime stream for the time it
   * is open rather than for the audio sent, so muting is a privacy control, not
   * a saving — which is exactly what a learner means by it.
   */
  setMuted(muted: boolean) {
    this.muted = muted;

    if (muted) {
      this.detector.reset();
      this.analyser?.reset();
      this.level = 0;
      this.finalText = "";
      this.draftText = "";
    }

    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  /** Drops whatever is half-heard, so a new turn does not inherit the last one's tail. */
  resetUtterance() {
    this.finalText = "";
    this.draftText = "";
  }

  close() {
    this.closed = true;

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }

    this.source?.disconnect();
    this.source = null;

    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }

    this.stream = null;
    this.socket?.close();
    this.socket = null;
    void this.context?.close();
    this.context = null;

    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
  }

  private handleFrame(frame: { pcm: ArrayBuffer }) {
    if (this.muted) {
      return;
    }

    /*
     * Measured here rather than on the audio thread. The samples are already
     * captured by this point, so nothing can be dropped by taking a moment over
     * them, and it costs a few microseconds a frame — while keeping the decision
     * of what a sound *was* in a plain module with tests around it.
     *
     * `send` copies the buffer rather than taking it, so reading it first is free.
     */
    const levels = this.analyser?.measure(new Int16Array(frame.pcm));

    if (levels) {
      this.level = levels.level;

      const transition = this.detector.push(levels);

      if (transition === "start") {
        this.handlers.onVoiceStart?.();
      } else if (transition === "end") {
        this.handlers.onVoiceEnd?.();
      }
    }

    /*
     * Sent whatever the local half made of it. The recognizer is the half that
     * cannot be skipped: a session with no analyser would lose the instant duck,
     * but a session with no audio going out loses the ability to be interrupted
     * at all.
     */
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(frame.pcm);
    }
  }

  private handleMessage(event: MessageEvent) {
    if (typeof event.data !== "string") {
      return;
    }

    let message: { tokens?: Array<{ text?: unknown; is_final?: unknown }>; error_code?: unknown };

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.error_code !== undefined) {
      this.handlers.onError?.(
        new SpeechInputError("The recognizer refused the stream.", "connection"),
      );

      return;
    }

    let endpointed = false;
    let draft = "";

    for (const token of message.tokens ?? []) {
      const text = typeof token.text === "string" ? token.text : "";

      /*
       * `<end>` is how Soniox says the speaker has stopped, and `<fin>` how it
       * says a finalize request has been honoured. Neither is a word, and both
       * would be read out as one if they reached the transcript.
       */
      if (text === "<end>") {
        endpointed = true;
        continue;
      }

      if (text === "<fin>") {
        continue;
      }

      if (token.is_final === true) {
        this.finalText += text;
      } else {
        draft += text;
      }
    }

    this.draftText = draft;

    const heard = `${this.finalText}${draft}`.trim();

    if (heard) {
      this.handlers.onPartial?.(heard);
    }

    if (endpointed) {
      const utterance = `${this.finalText}${this.draftText}`.trim();
      this.finalText = "";
      this.draftText = "";

      if (utterance) {
        this.handlers.onUtterance?.(utterance);
      }
    }
  }
}
