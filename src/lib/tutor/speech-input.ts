import { frameLevel } from "@/lib/tutor/turn-audio";

/**
 * The tutor's ears: the microphone, and one Soniox recognizer socket kept open
 * for the whole session.
 *
 * The microphone stays open the entire time — that is what "just start talking"
 * means. There is no button to hold and no wake word; the learner speaks and the
 * tutor stops.
 *
 * Only one signal comes out of here that anything acts on: the recognizer's
 * words. There used to be a second — a local detector that watched the shape of
 * the microphone's spectrum and fired within a tenth of a second, so the voice
 * could duck before anyone knew what had been said. It was fast and it was
 * wrong: no measurement of a sound can tell you that a person is talking *to
 * you*, so the lesson went quiet for doors, cars, dogs and siblings. What is
 * left is a level for the ring around the sphere, and words for everything else.
 */

/** How often the worklet hands a frame back. 20ms is one packet's worth. */
const FRAME_MS = 20;

/** Soniox closes an idle recognizer; this is well inside its window. */
const KEEPALIVE_INTERVAL_MS = 10_000;

/**
 * Upper bound on semantic endpointing, not a fixed delay before every reply.
 * Keep thinking pauses intact: 300ms is below Soniox's documented 500–3000ms
 * range and mainly shortens ambiguous endings. Clean endings can arrive sooner
 * than this cap. Reduce request/socket waits instead of guessing from partials.
 * https://soniox.com/docs/stt/rt/endpoint-detection
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
 * packets worth sending. How loud each packet was is measured on the other side,
 * in `frameLevel`, where it can be unit-tested — the audio thread's job is to
 * lose no frames, and everything it does beyond that is a risk to it.
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
  /** The recognizer's running best guess at the current utterance. */
  onPartial?: (text: string) => void;
  /** The recognizer decided the utterance is over. Carries everything it heard. */
  onUtterance?: (text: string) => void;
  onError?: (error: SpeechInputError) => void;
};

export class SpeechInputError extends Error {
  constructor(
    message: string,
    readonly reason: "denied" | "unavailable" | "connection" | "busy",
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

  private muted = false;
  private closed = false;
  private level = 0;

  /**
   * The temporary key in force, and the rate the recognizer was told about.
   *
   * The key is the one part of the config with an expiry on it, and unlike the speech
   * socket's it is sent once when the socket opens rather than per turn — so adopting a
   * new one means opening a new socket. See `useKey`.
   */
  private apiKey: string;
  private sampleRate = 0;

  /** Words the recognizer has settled on for the utterance in progress. */
  private finalText = "";
  /** Words it is still revising. Shown live, never trusted as the whole question. */
  private draftText = "";

  constructor(
    private readonly config: SpeechInputConfig,
    private readonly handlers: SpeechInputHandlers = {},
  ) {
    this.apiKey = config.apiKey;
  }

  /**
   * Adopts a freshly minted key, on a new socket.
   *
   * Called when the session takes its next slice of time, roughly half an hour in. Only
   * the recognizer is rebuilt: the microphone and the worklet stay exactly where they
   * are, so the learner notices nothing.
   *
   * Anything half-heard is dropped rather than carried over — the new socket starts its
   * own utterance, and stitching the two halves together would put a sentence fragment
   * in front of the model as though it were a question.
   */
  async useKey(apiKey: string) {
    if (this.closed || !this.context) {
      return false;
    }

    this.apiKey = apiKey;

    const previous = this.socket;
    this.socket = null;

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    previous?.close();
    this.resetUtterance();

    /*
     * Reported rather than thrown. The old socket is already gone, so a failure here
     * leaves the tutor talking to somebody it cannot hear — which the learner has no way
     * to interpret unless they are told, and which must not take the rest of the renewal
     * down with it. The caller turns a false into the microphone going quiet on screen.
     */
    return this.startListening();
  }

  /**
   * Opens the microphone and the recognizer.
   *
   * The three constraints are not boilerplate. `echoCancellation` is what stops
   * the tutor from hearing itself through the phone's own speaker and
   * interrupting itself — it is the single most important flag in this file, and
   * `isTutorEcho` in turn-audio.ts is the backstop for the leakage it does not
   * catch. `noiseSuppression` takes the steady part of a room out before anything
   * else sees it, and `autoGainControl` keeps somebody sitting back from a laptop
   * at the same level as somebody leaning in.
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

    const blob = new Blob([RECORDER_WORKLET], { type: "application/javascript" });
    this.workletUrl = URL.createObjectURL(blob);
    await context.audioWorklet.addModule(this.workletUrl);

    this.sampleRate = context.sampleRate;
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
            api_key: this.apiKey,
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
        socket.addEventListener("message", (event) => {
          // A replaced/closed recognizer can still have queued frames. They must
          // neither answer in the new session nor close its current socket.
          if (!this.closed && this.socket === socket) {
            this.handleMessage(event);
          }
        });
        socket.addEventListener("close", () => {
          /*
           * Only the socket in use gets to report a failure. `useKey` replaces this one
           * when the session renews its credentials, and the old socket's close event
           * lands afterwards — reporting that as a dropped connection would put an error
           * on screen for a reconnection that went perfectly.
           */
          if (this.closed || this.socket !== socket) {
            return;
          }

          this.handlers.onError?.(
            new SpeechInputError("The recognizer connection closed.", "connection"),
          );
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
   * The socket stays open, so unmuting is instant and does not cost a reconnection.
   * Soniox bills a realtime stream for the time it is open rather than for the audio
   * sent, so muting is a privacy control, not a saving — which is exactly what a
   * learner means by it.
   */
  setMuted(muted: boolean) {
    this.muted = muted;

    if (muted) {
      this.level = 0;
      this.finalText = "";
      this.draftText = "";
    }

    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  /**
   * Hands the recognizer back while nobody can be interrupted.
   *
   * Soniox allows the whole organisation ten realtime transcription streams at once, and
   * a tutor session holds one from the moment it starts until it ends — so a slot given
   * up here is a slot somebody else can start a conversation with. A paused, muted or
   * finished session cannot be barged into by definition, and on a phone "paused" happens
   * every time the learner switches app, so this is most of the day.
   *
   * The microphone and the worklet stay exactly where they are: it is the Soniox
   * stream that is scarce, not the hardware, and keeping the audio graph means
   * coming back costs one handshake rather than a permission prompt. The tracks are
   * disabled all the same, so the phone stops showing a recording indicator for a session
   * that is not listening.
   */
  stopListening() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    const previous = this.socket;
    this.socket = null;
    previous?.close();

    this.level = 0;
    this.resetUtterance();

    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = false;
    }
  }

  /**
   * Takes a recognizer back.
   *
   * Returns false when there was not one to be had — every slot in the organisation is in
   * use — which is a thing the learner has to be told rather than a fault: the walkthrough
   * still works, they just cannot cut in by speaking until one frees up.
   */
  async startListening() {
    if (this.closed || !this.context || this.socket) {
      return Boolean(this.socket);
    }

    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !this.muted;
    }

    try {
      await this.openSocket(this.sampleRate);

      return true;
    } catch {
      return false;
    }
  }

  /** Whether a recognizer is actually attached right now. */
  get isListening() {
    return this.socket !== null;
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
     * Measured here rather than on the audio thread, which has one job — lose no
     * frames — and should not be given a second. The samples are already captured
     * by this point, and `send` copies the buffer rather than taking it, so
     * reading it first is free.
     */
    this.level = frameLevel(new Int16Array(frame.pcm));

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
      /*
       * 429 is the organisation's ten realtime streams all being in use, which is a queue
       * rather than a fault and has to read as one. Everything else here is a refusal of
       * this particular stream.
       *
       * The socket is dropped on our side first, so the close that follows does not
       * report a second, wronger error over the top of this one.
       */
      const busy = String(message.error_code) === "429";
      const socket = this.socket;
      this.socket = null;
      socket?.close();

      this.handlers.onError?.(
        new SpeechInputError(
          busy
            ? "Every realtime transcription stream is in use."
            : "The recognizer refused the stream.",
          busy ? "busy" : "connection",
        ),
      );

      return;
    }

    // Muting also discards words already in flight from before the tap.
    if (this.muted) {
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
