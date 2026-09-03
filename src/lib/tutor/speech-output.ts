import {
  appendCharacterTimings,
  createEmptyCharacterTimings,
  spokenTextBefore,
  type SpeechCharacterTimings,
} from "@/lib/tutor/turn-audio";

/**
 * The tutor's voice: one Soniox speech socket, and the Web Audio graph that
 * plays what comes back.
 *
 * Raw PCM rather than MP3, which is what read-aloud uses. A file player is the
 * right shape for a note: the audio is made once, cached, and played whole. A
 * conversation is the opposite — the audio does not exist until a moment before
 * it is needed, it has to start while it is still being made, and it has to stop
 * on a syllable when the learner cuts in. Decoding MP3 frames as they arrive
 * needs Media Source Extensions, which iOS Safari does not give a page, and it
 * costs an encoder's worth of latency at the start. Signed 16-bit PCM decodes to
 * an AudioBuffer with a divide, and a scheduled buffer source can be stopped
 * mid-word by design.
 */

/** A prebuffer before the first sample plays, so a slow frame is not a gap in the voice. */
const PLAYBACK_LEAD_SECONDS = 0.12;

/** Soniox closes an idle speech socket; this is well inside its window. */
const KEEPALIVE_INTERVAL_MS = 15_000;

/**
 * How long the tutor's last words can still be in the room after its audio stops.
 *
 * The recognizer is behind the room by its own transit plus the pause it waits out
 * before calling an utterance over — about a second all told. Until that has passed,
 * text arriving from it may still be the tail of what the speaker was saying, and the
 * echo test needs the words to recognize it by.
 */
const ROOM_TAIL_MS = 1_500;

export type SpeechOutputConfig = {
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  language: string;
  /** 0.7 to 1.3; outside that Soniox refuses the stream rather than clamping. */
  speed?: number;
};

export type SpeechTurnHandle = {
  /** Feeds the next piece of text in. Safe to call as fast as the model writes. */
  push: (text: string) => void;
  /** No more text is coming; the socket finishes the audio and terminates the turn. */
  end: () => void;
  /** Resolves when the last sample of this turn has been heard. */
  finished: Promise<void>;
};

type ActiveTurn = {
  streamId: string;
  /** The socket is not told about a turn until there is a word to say — see `speak`. */
  opened: boolean;
  timings: SpeechCharacterTimings;
  text: string;
  audioStartedAt: number | null;
  scheduledUntil: number;
  ended: boolean;
  audioComplete: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
};

export class SpeechOutputError extends Error {
  constructor(
    message: string,
    /** Soniox's own code, so a busy account can be told apart from a bad request. */
    readonly code: string | null,
  ) {
    super(message);
    this.name = "SpeechOutputError";
  }
}

export class TutorSpeechOutput {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private turn: ActiveTurn | null = null;
  private turnCounter = 0;
  /** The last thing said out loud, and how long it can still be in the room. */
  private roomTail = "";
  private roomTailUntil = 0;
  private closed = false;

  /** The playback rate the socket is asked for, and the rate the graph is built at. */
  private sampleRate = 24_000;

  /**
   * The temporary key in force.
   *
   * Held apart from the rest of the config because it is the one field with an expiry
   * date on it. Soniox takes it per stream rather than per socket, so replacing it costs
   * nothing and takes effect on the very next turn — see `useKey`.
   */
  private apiKey: string;

  constructor(
    private readonly config: SpeechOutputConfig,
    private readonly handlers: {
      onError?: (error: SpeechOutputError) => void;
      onClose?: () => void;
    } = {},
  ) {
    this.apiKey = config.apiKey;
  }

  /** Adopts a freshly minted key. The next turn announces its stream with it. */
  useKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Opens the audio graph and the socket.
   *
   * Safe to call before any user gesture, which is what lets the voice previews be
   * warmed the moment the screen is opened. The context is created but not started —
   * browsers refuse that outside a gesture — so whoever handles the tap calls
   * `resumeAudio` first. Everything slow (the socket handshake) has happened by then.
   */
  async connect() {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      throw new SpeechOutputError("This browser has no Web Audio support.", null);
    }

    const context = new AudioContextClass();
    this.context = context;
    this.sampleRate = context.sampleRate;

    /*
     * A fixed junction rather than a control: every scheduled buffer connects here so
     * that one node feeds the meter and the speakers. It used to be turned down when
     * the microphone heard something voice-shaped, which is how the tutor came to
     * whisper at passing traffic; nothing moves it now.
     */
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    /*
     * Small window, heavy smoothing: this drives a shape on screen, not a
     * meter. A long FFT lags the voice enough to read as out of sync.
     */
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    gain.connect(analyser);
    analyser.connect(context.destination);

    this.gain = gain;
    this.analyser = analyser;
    this.analyserBuffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));

    await this.openSocket();
  }

  private openSocket() {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.config.url);
      socket.binaryType = "arraybuffer";

      const onOpen = () => {
        socket.removeEventListener("error", onError);
        this.socket = socket;
        this.keepaliveTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ keep_alive: true }));
          }
        }, KEEPALIVE_INTERVAL_MS);
        socket.addEventListener("message", (event) => this.handleMessage(event));
        socket.addEventListener("close", () => {
          /*
           * Only the socket currently in use gets to fail anything. `ensureOpen` replaces
           * a dead connection before every turn, and the old one's close event can land
           * after the new one is already speaking — at which point failing "the turn"
           * would kill a turn this socket has nothing to do with.
           */
          if (this.socket !== socket) {
            return;
          }

          /*
           * A turn whose audio is already complete is not harmed by this. Soniox hangs up
           * about ten seconds after the last of the audio it generated, which for a long
           * turn is while the learner is still listening to it — but every sample is
           * already buffered and scheduled here, so it plays out and settles on its own.
           * Failing it would stop a turn mid-sentence and blame the connection.
           */
          if (!this.turn?.audioComplete) {
            this.failTurn(new SpeechOutputError("The speech connection closed.", null));
          }

          if (!this.closed) {
            this.handlers.onClose?.();
          }
        });
        resolve();
      };
      const onError = () => {
        socket.removeEventListener("open", onOpen);
        reject(new SpeechOutputError("The speech connection could not be opened.", null));
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
  }

  /**
   * Reopens the socket if Soniox has hung up on it.
   *
   * `tts-rt-v2` closes a stream that has asked for no audio with `1001 Timeout` after about
   * ten seconds, and the gap between connecting and the first word is exactly that long: the
   * microphone has to be opened and a turn has to be written before there is anything to say.
   * Measured on a deployed build, the socket was dead before the first sentence arrived every
   * time. Keepalives do not save it, so the connection is treated as disposable and checked
   * immediately before it is used instead.
   */
  async ensureOpen() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    this.socket?.close();
    this.socket = null;

    await this.openSocket();
  }

  /**
   * Starts the audio clock. Must be called from inside a user gesture the first time —
   * a context created outside one stays suspended on iOS however often it is resumed.
   */
  async resumeAudio() {
    if (this.context && this.context.state !== "running") {
      await this.context.resume();
    }
  }

  /** RMS of what is playing right now, 0 to roughly 1. Drives the sphere. */
  getLevel() {
    const analyser = this.analyser;
    const buffer = this.analyserBuffer;

    if (!analyser || !buffer) {
      return 0;
    }

    analyser.getFloatTimeDomainData(buffer);

    let sum = 0;

    for (let index = 0; index < buffer.length; index += 1) {
      sum += buffer[index] * buffer[index];
    }

    return Math.sqrt(sum / buffer.length);
  }

  /** Whether the socket is still usable. A warmed connection can be closed under us. */
  get isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Whether any audio from the current turn is still to be heard. */
  get isSpeaking() {
    const context = this.context;
    const turn = this.turn;

    return Boolean(context && turn && turn.scheduledUntil > context.currentTime);
  }

  /**
   * Starts a turn. The socket multiplexes turns by id, so an interrupted one can
   * be cancelled while the next is already opening.
   */
  speak(options: { voice?: string; speed?: number } = {}): SpeechTurnHandle {
    const socket = this.socket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new SpeechOutputError("The speech connection is not open.", null);
    }

    this.stop();

    this.turnCounter += 1;
    const streamId = `turn-${this.turnCounter}`;
    let resolve: () => void = () => {};
    let reject: (error: Error) => void = () => {};
    const finished = new Promise<void>((resolveInner, rejectInner) => {
      resolve = resolveInner;
      reject = rejectInner;
    });

    this.turn = {
      streamId,
      opened: false,
      timings: createEmptyCharacterTimings(),
      text: "",
      audioStartedAt: null,
      scheduledUntil: 0,
      ended: false,
      audioComplete: false,
      resolve,
      reject,
      settled: false,
    };

    /*
     * The stream is opened by the first word, not by the intention to speak.
     *
     * Soniox starts a clock the moment a stream is announced and ends it with a
     * 408 if no text follows — and the text here comes from a model that can
     * take a couple of seconds to produce its first token, longer when it is
     * reading a whole note first. Announcing the turn up front therefore raced
     * a timeout on exactly the slow turns that most need to work. Opening on
     * the first push costs nothing: there is no audio to wait for until there
     * are words to make it from.
     */
    const openStream = () => {
      if (this.turn?.streamId !== streamId || this.turn.opened) {
        return;
      }

      this.turn.opened = true;
      socket.send(
        JSON.stringify({
          api_key: this.apiKey,
          model: this.config.model,
          language: this.config.language,
          voice: options.voice ?? this.config.voice,
          ...(options.speed ?? this.config.speed
            ? { speed: options.speed ?? this.config.speed }
            : {}),
          audio_format: "pcm_s16le",
          sample_rate: this.sampleRate,
          // Character timings are what let an interruption be recorded at the word the
          // learner actually heard rather than at the end of what was generated.
          return_timestamps: true,
          stream_id: streamId,
        }),
      );
    };

    return {
      push: (text: string) => {
        if (!text || this.turn?.streamId !== streamId || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        openStream();
        this.turn.text += text;
        socket.send(JSON.stringify({ text, text_end: false, stream_id: streamId }));
      },
      end: () => {
        if (this.turn?.streamId !== streamId || this.turn.ended) {
          return;
        }

        this.turn.ended = true;

        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }

        if (!this.turn.opened) {
          /*
           * A turn that produced no text at all. Nothing was ever announced to
           * the socket, so there is nothing to close there — but the caller is
           * waiting on `finished`, and it must not wait forever.
           */
          const turn = this.turn;
          this.turn = null;
          this.settleTurn(turn);

          return;
        }

        socket.send(JSON.stringify({ text: "", text_end: true, stream_id: streamId }));
      },
      finished,
    };
  }

  /**
   * What the tutor's own voice has put into the room, for the echo test to recognize.
   *
   * Not the text of the turn: the part of it that has already left the speaker, which
   * during a turn is usually a sentence or two behind what has been generated. Words
   * the learner has not heard yet cannot be echoing back at the microphone, and
   * counting them would only make the tutor deaf to a learner who happened to use one.
   *
   * Empty once the room has been quiet for longer than the recognizer's own lag, so
   * that during the learner's turn nothing they say is measured against the tutor at
   * all — see `isTutorEcho`, which is strict precisely because this is narrow.
   */
  spokenIntoRoom() {
    /*
     * The turn before this one counts too, while it can still be in the air. Turns
     * follow each other closely enough that the recognizer does not always hear a
     * pause between them, and an utterance that straddles the seam is echo of both.
     */
    const previous = Date.now() <= this.roomTailUntil ? this.roomTail : "";
    const turn = this.turn;
    const context = this.context;

    if (!turn || !context) {
      return previous;
    }

    const played = spokenTextBefore(turn.timings, this.playedSeconds(turn, context), turn.text);

    return `${previous} ${played}`.trim();
  }

  /** How much of this turn has been heard, in seconds of its own audio. */
  private playedSeconds(turn: ActiveTurn, context: AudioContext) {
    return turn.audioStartedAt === null
      ? 0
      : Math.max(0, Math.min(context.currentTime, turn.scheduledUntil) - turn.audioStartedAt);
  }

  /**
   * Keeps the last thing said around for as long as it can still be echoing.
   *
   * A turn that has ended is gone from `this.turn`, but its final sentence is still
   * travelling: out of the speaker, around the room, into the microphone, and through
   * a recognizer that waits out a pause before deciding the utterance is over. Without
   * this the tutor's own last words came back as the learner's first ones.
   */
  private rememberRoomTail(turn: ActiveTurn) {
    const context = this.context;
    const spoken = context
      ? spokenTextBefore(turn.timings, this.playedSeconds(turn, context), turn.text)
      : "";

    /* A turn that never reached the speaker leaves the room exactly as it found it. */
    if (!spoken) {
      return;
    }

    this.roomTail = spoken;
    this.roomTailUntil = Date.now() + ROOM_TAIL_MS;
  }

  /**
   * Stops the turn now and reports what was actually heard of it.
   *
   * Everything still queued is discarded, the socket is told to stop generating,
   * and the text is cut at the last character whose audio had already left the
   * speaker — see `spokenTextBefore` for why that is not the same as the text
   * that was generated.
   */
  stop() {
    const turn = this.turn;
    const context = this.context;

    if (!turn || !context) {
      return { spokenText: "", wasSpeaking: false };
    }

    const wasSpeaking = turn.scheduledUntil > context.currentTime;
    const spokenText = spokenTextBefore(turn.timings, this.playedSeconds(turn, context), turn.text);

    if (turn.opened && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ stream_id: turn.streamId, cancel: true }));
    }

    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already finished. Stopping a stopped source throws and means nothing.
      }
    }

    this.sources.clear();
    this.turn = null;
    this.settleTurn(turn);

    return { spokenText, wasSpeaking };
  }

  close() {
    this.closed = true;
    this.stop();

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    this.socket?.close();
    this.socket = null;
    void this.context?.close();
    this.context = null;
    this.gain = null;
    this.analyser = null;
  }

  private handleMessage(event: MessageEvent) {
    if (typeof event.data !== "string") {
      return;
    }

    let message: Record<string, unknown>;

    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof message.error_code === "string" || typeof message.error_code === "number") {
      const error = new SpeechOutputError(
        typeof message.error_message === "string"
          ? message.error_message
          : "The speech service refused the request.",
        String(message.error_code),
      );

      this.failTurn(error);
      this.handlers.onError?.(error);

      return;
    }

    const turn = this.turn;

    if (!turn || message.stream_id !== turn.streamId) {
      // A late frame from a turn the learner already interrupted. Nothing to play.
      return;
    }

    if (message.timestamps && typeof message.timestamps === "object") {
      appendCharacterTimings(turn.timings, message.timestamps as Record<string, unknown>);
    }

    if (typeof message.audio === "string") {
      this.enqueueAudio(turn, message.audio);
    }

    if (message.audio_end === true || message.terminated === true) {
      turn.audioComplete = true;
      this.scheduleTurnEnd(turn);
    }
  }

  private enqueueAudio(turn: ActiveTurn, base64: string) {
    const context = this.context;
    const gain = this.gain;

    if (!context || !gain) {
      return;
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));

    if (samples.length === 0) {
      return;
    }

    const buffer = context.createBuffer(1, samples.length, this.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index] / 32_768;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    /*
     * Strictly end to end. Each buffer starts where the last one finished, and
     * the first waits out a short lead — that lead is the whole jitter budget,
     * and without it the first slow frame of a turn is an audible gap rather
     * than a slightly later start.
     */
    const startAt = Math.max(context.currentTime + PLAYBACK_LEAD_SECONDS, turn.scheduledUntil);
    source.start(startAt);

    if (turn.audioStartedAt === null) {
      turn.audioStartedAt = startAt;
    }

    turn.scheduledUntil = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);

      if (turn.audioComplete && this.turn === turn && this.sources.size === 0) {
        this.turn = null;
        this.settleTurn(turn);
      }
    };
  }

  private scheduleTurnEnd(turn: ActiveTurn) {
    if (this.sources.size === 0 && this.turn === turn) {
      this.turn = null;
      this.settleTurn(turn);
    }
  }

  private settleTurn(turn: ActiveTurn) {
    if (turn.settled) {
      return;
    }

    turn.settled = true;
    this.rememberRoomTail(turn);
    turn.resolve();
  }

  private failTurn(error: SpeechOutputError) {
    const turn = this.turn;

    if (!turn || turn.settled) {
      return;
    }

    turn.settled = true;
    this.turn = null;
    this.rememberRoomTail(turn);
    turn.reject(error);
  }
}
