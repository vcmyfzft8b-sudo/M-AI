import { nextSpeechPiece, hasSpeakableText, spreadPieceTimings } from "@/lib/tutor/speech-pieces";
import {
  SpeechOutputError,
  type SpeechOutputConfig,
  type SpeechTurnHandle,
} from "@/lib/tutor/speech-output";
import { createEmptyCharacterTimings, spokenTextBefore } from "@/lib/tutor/turn-audio";

/**
 * The tutor's voice on Gemini: the same audio graph and the same contract as `TutorSpeechOutput`,
 * with the Soniox socket replaced by one request per piece of speech.
 *
 * Gemini's speech model takes a whole request and answers with a stream of audio, so a turn is
 * said as a run of pieces — the first sentence as soon as it is written, then whatever whole
 * sentences have arrived while that one was being made (see speech-pieces.ts). Two are in flight
 * at most: the one playing and the next, which is enough because Gemini makes speech three to four
 * times faster than it is spoken. Audio is scheduled strictly in piece order; a piece that is
 * ready early waits in memory until the one before it has been scheduled to its end.
 *
 * What the old engine gave for free and this one has to rebuild is the record of what was heard.
 * Soniox reported when each character was said; Gemini reports nothing, so each piece's characters
 * are spread over the audio it produced (`spreadPieceTimings`). That is accurate to about a word,
 * which is what the interruption record and the echo test need — both cut at word boundaries.
 *
 * Kept beside the Soniox class rather than replacing it: `TTS_PROVIDER=soniox` on the server
 * puts the old voice back, and the session payload says which one to build.
 */

const PLAYBACK_LEAD_SECONDS = 0.12;

/** The one playing and the one after it. More would only spend money on speech nobody may hear. */
const MAX_PIECES_IN_FLIGHT = 2;

/**
 * How long the writer may pause mid-sentence before what it has written is said anyway.
 *
 * Pieces wait for whole sentences because a cut in the middle of one is a cut in its melody. A
 * writer that stalls mid-sentence for longer than this is a silence the learner is already hearing,
 * and saying the half-sentence is the lesser seam.
 */
const WRITER_QUIET_FLUSH_MS = 2_500;

/** Tries per piece: a dropped request is retried as long as none of its audio has played. */
const PIECE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

/** The route answers in under two seconds; waiting longer than this is waiting on nothing. */
const FIRST_BYTE_TIMEOUT_MS = 12_000;
/*
 * Once audio is flowing it arrives several times faster than it plays, so a gap this long is a
 * stalled stream. Without it the piece would wait for the function's 60-second limit, in silence.
 */
const STREAM_IDLE_TIMEOUT_MS = 8_000;

/* The same values, for the same reasons, as speech-output.ts. */
const ROOM_TAIL_MS = 1_200;
const ACTIVE_ECHO_WINDOW_SECONDS = 6;
const INTERRUPTION_FADE_SECONDS = 0.07;
const ROOM_TAIL_WORDS = 6;

const DEFAULT_SAMPLE_RATE = 24_000;

type Piece = {
  text: string;
  controller: AbortController;
  /** Audio that arrived before the piece ahead of it finished; scheduled when it does. */
  waiting: Float32Array[];
  /** Seconds of this piece's audio scheduled so far. */
  scheduledSeconds: number;
  /** Where its first sample sits on the turn's clock, once it has one. */
  offsetSeconds: number | null;
  /** The request has ended, with all of its audio or with all it is ever going to get. */
  complete: boolean;
  sampleRate: number;
};

type ActiveTurn = {
  id: number;
  text: string;
  /** Written but not yet cut into a piece. */
  buffer: string;
  pieces: Piece[];
  /** The first piece whose audio is not yet all scheduled. Only it may schedule audio. */
  playIndex: number;
  inFlight: number;
  /** Set by a quiet writer or by `end`: the rest of the buffer goes without waiting for a stop. */
  flushing: boolean;
  quietTimer: ReturnType<typeof setTimeout> | null;
  voice: string;
  audioStartedAt: number | null;
  scheduledUntil: number;
  ended: boolean;
  audioComplete: boolean;
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

function audioContextClass() {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

const isAbort = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiTutorSpeechOutput {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private fadingSources = new Set<AudioBufferSourceNode>();
  private turn: ActiveTurn | null = null;
  private turnCounter = 0;
  private roomTail = "";
  private roomTailUntil = 0;
  private closed = false;
  private token: string;
  private readonly config: SpeechOutputConfig;
  private readonly handlers: {
    onError?: (error: SpeechOutputError) => void;
    onClose?: () => void;
  };

  constructor(
    config: SpeechOutputConfig,
    handlers: {
      onError?: (error: SpeechOutputError) => void;
      onClose?: () => void;
    } = {},
  ) {
    this.config = config;
    this.handlers = handlers;
    this.token = config.apiKey;
  }

  /** Adopts the token minted for the next slice. The next piece is requested with it. */
  useKey(apiKey: string) {
    this.token = apiKey;
  }

  /**
   * Builds the audio graph, and wakes the speech route so the first sentence does not pay for a
   * cold function. There is no connection to hold open: every piece is its own request.
   */
  async connect() {
    const AudioContextClass = audioContextClass();

    if (!AudioContextClass) {
      throw new SpeechOutputError("This browser has no Web Audio support.", null);
    }

    const context = new AudioContextClass();
    this.context = context;

    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    gain.connect(analyser);
    analyser.connect(context.destination);

    this.gain = gain;
    this.analyser = analyser;
    this.analyserBuffer = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));

    void fetch(this.config.url, { method: "GET", cache: "no-store" }).catch(() => {});
  }

  /** Nothing to reopen. Kept so the session drives both engines the same way. */
  async ensureOpen() {
    if (this.closed) {
      throw new SpeechOutputError("The speech output is closed.", null);
    }
  }

  async resumeAudio() {
    if (this.context && this.context.state !== "running") {
      await this.context.resume();
    }
  }

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

  get isOpen() {
    return !this.closed && this.context !== null;
  }

  get isSpeaking() {
    const context = this.context;
    const turn = this.turn;

    return Boolean(context && turn && turn.scheduledUntil > context.currentTime);
  }

  speak(options: { voice?: string; speed?: number } = {}): SpeechTurnHandle {
    if (this.closed || !this.context) {
      throw new SpeechOutputError("The speech output is not open.", null);
    }

    this.stop();

    this.turnCounter += 1;
    let resolve: () => void = () => {};
    let reject: (error: Error) => void = () => {};
    const finished = new Promise<void>((resolveInner, rejectInner) => {
      resolve = resolveInner;
      reject = rejectInner;
    });

    /* Claimed at once, for the reason speech-output.ts gives: Sentry would file it unhandled. */
    void finished.catch(() => {});

    const turn: ActiveTurn = {
      id: this.turnCounter,
      text: "",
      buffer: "",
      pieces: [],
      playIndex: 0,
      inFlight: 0,
      flushing: false,
      quietTimer: null,
      voice: options.voice ?? this.config.voice,
      audioStartedAt: null,
      scheduledUntil: 0,
      ended: false,
      audioComplete: false,
      settled: false,
      resolve,
      reject,
    };

    this.turn = turn;

    return {
      push: (text: string) => {
        if (!text || this.turn !== turn || turn.ended) {
          return;
        }

        turn.text += text;
        turn.buffer += text;
        turn.flushing = false;
        this.armQuietTimer(turn);
        this.dispatch(turn);
      },
      end: () => {
        if (this.turn !== turn || turn.ended) {
          return;
        }

        turn.ended = true;
        turn.flushing = true;
        this.clearQuietTimer(turn);
        this.dispatch(turn);
        this.maybeComplete(turn);
      },
      finished,
    };
  }

  /** Sends as many pieces as the buffer and the in-flight limit allow. */
  private dispatch(turn: ActiveTurn) {
    while (this.turn === turn && !turn.settled && turn.inFlight < MAX_PIECES_IN_FLIGHT) {
      const cut = nextSpeechPiece(turn.buffer, {
        first: turn.pieces.length === 0,
        flush: turn.flushing,
      });

      if (!cut) {
        break;
      }

      turn.buffer = cut.rest;
      this.startPiece(turn, cut.piece);
    }

    /* A finished writer's last stray tag or full stop has nothing to say; it is let go. */
    if (turn.ended && !hasSpeakableText(turn.buffer)) {
      turn.buffer = "";
    }
  }

  private startPiece(turn: ActiveTurn, text: string) {
    const piece: Piece = {
      text,
      controller: new AbortController(),
      waiting: [],
      scheduledSeconds: 0,
      offsetSeconds: null,
      complete: false,
      sampleRate: DEFAULT_SAMPLE_RATE,
    };

    turn.pieces.push(piece);
    turn.inFlight += 1;
    void this.fetchPiece(turn, piece);
  }

  private async fetchPiece(turn: ActiveTurn, piece: Piece) {
    let fatal: SpeechOutputError | null = null;
    let reportable = false;

    try {
      for (let attempt = 1; attempt <= PIECE_ATTEMPTS; attempt += 1) {
        const outcome = await this.requestPiece(turn, piece);

        if (outcome === "done" || outcome === "aborted") {
          return;
        }

        /* A dropped connection or a fault on our side is worth another go; a refusal is not. */
        const retryable = outcome.code === null || Number(outcome.code) >= 500;

        if (!retryable || attempt === PIECE_ATTEMPTS) {
          fatal = outcome;
          /* The server answered: a refusal worth telling the learner about by name. */
          reportable = outcome.code !== null;

          return;
        }

        await delay(RETRY_DELAY_MS * attempt);

        if (this.turn !== turn || turn.settled) {
          return;
        }
      }
    } finally {
      if (this.turn === turn && !turn.settled) {
        turn.inFlight -= 1;
        piece.complete = true;

        if (fatal) {
          this.failTurn(fatal);

          if (reportable) {
            this.handlers.onError?.(fatal);
          }
        } else {
          this.advance(turn);
          this.dispatch(turn);
          this.maybeComplete(turn);
        }
      }
    }
  }

  /**
   * One request for one piece. An error is a request that failed before any of its audio arrived;
   * once a piece has been heard it is never asked for again, since that would say its opening
   * twice — its remainder is given up instead, and the turn carries on with the next one.
   */
  private async requestPiece(
    turn: ActiveTurn,
    piece: Piece,
  ): Promise<"done" | "aborted" | SpeechOutputError> {
    const timeout = setTimeout(() => piece.controller.abort(), FIRST_BYTE_TIMEOUT_MS);
    let timedOut = false;
    const onTimeout = () => {
      timedOut = true;
    };

    piece.controller.signal.addEventListener("abort", onTimeout, { once: true });

    try {
      let response: Response;

      try {
        response = await fetch(this.config.url, {
          method: "POST",
          signal: piece.controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ text: piece.text, voice: turn.voice, language: this.config.language }),
        });
      } catch (error) {
        if (this.turn !== turn || (isAbort(error) && !timedOut)) {
          return "aborted";
        }

        /* A fresh controller: the timed-out one is spent, and the retry needs one that is not. */
        piece.controller = new AbortController();

        return new SpeechOutputError("The speech connection closed.", null);
      }

      clearTimeout(timeout);
      piece.controller.signal.removeEventListener("abort", onTimeout);

      if (response.status === 422) {
        /* Nothing could be said for this piece. Skipping it beats ending the lesson over it. */
        return "done";
      }

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        return new SpeechOutputError(
          payload?.error ?? "The speech service refused the request.",
          String(response.status),
        );
      }

      piece.sampleRate = Number(response.headers.get("X-Speech-Sample-Rate")) || DEFAULT_SAMPLE_RATE;

      const reader = response.body.getReader();
      let carry: number | null = null;
      let idle: ReturnType<typeof setTimeout> | null = null;
      const armIdle = () => {
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => {
          timedOut = true;
          void reader.cancel().catch(() => {});
        }, STREAM_IDLE_TIMEOUT_MS);
      };

      try {
        while (true) {
          armIdle();
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          if (this.turn !== turn || turn.settled) {
            return "aborted";
          }

          let bytes = value;

          if (carry !== null) {
            const joined = new Uint8Array(bytes.length + 1);
            joined[0] = carry;
            joined.set(bytes, 1);
            bytes = joined;
            carry = null;
          }

          if (bytes.length % 2 === 1) {
            carry = bytes[bytes.length - 1];
            bytes = bytes.subarray(0, bytes.length - 1);
          }

          if (bytes.length > 0) {
            this.receive(turn, piece, bytes);
          }
        }
      } catch (error) {
        if (this.turn !== turn || (isAbort(error) && !timedOut)) {
          return "aborted";
        }

        if (piece.scheduledSeconds === 0 && piece.waiting.length === 0) {
          piece.controller = new AbortController();

          return new SpeechOutputError("The speech connection closed.", null);
        }
      } finally {
        if (idle) clearTimeout(idle);
      }

      /*
       * A stalled stream is cancelled rather than errored, so it ends here as if it had finished.
       * One that never played a sample is worth asking for again, exactly like a dropped one.
       */
      if (timedOut && this.turn === turn && piece.scheduledSeconds === 0 && piece.waiting.length === 0) {
        piece.controller = new AbortController();

        return new SpeechOutputError("The speech stream stalled.", null);
      }

      return "done";
    } finally {
      clearTimeout(timeout);
      piece.controller.signal.removeEventListener("abort", onTimeout);
    }
  }

  private receive(turn: ActiveTurn, piece: Piece, bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = new Float32Array(bytes.byteLength / 2);

    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    }

    if (turn.pieces[turn.playIndex] === piece) {
      this.schedule(turn, piece, samples);
    } else {
      piece.waiting.push(samples);
    }
  }

  /** Moves the play head past every finished piece, scheduling what the next one has waiting. */
  private advance(turn: ActiveTurn) {
    while (turn.playIndex < turn.pieces.length) {
      const head = turn.pieces[turn.playIndex];

      for (const samples of head.waiting) {
        this.schedule(turn, head, samples);
      }

      head.waiting = [];

      if (!head.complete) {
        return;
      }

      turn.playIndex += 1;
    }
  }

  private schedule(turn: ActiveTurn, piece: Piece, samples: Float32Array) {
    const context = this.context;
    const gain = this.gain;

    if (!context || !gain || samples.length === 0) {
      return;
    }

    const buffer = context.createBuffer(1, samples.length, piece.sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const startAt = Math.max(context.currentTime + PLAYBACK_LEAD_SECONDS, turn.scheduledUntil);
    source.start(startAt);

    if (turn.audioStartedAt === null) {
      turn.audioStartedAt = startAt;
    }

    if (piece.offsetSeconds === null) {
      piece.offsetSeconds = startAt - turn.audioStartedAt;
    }

    piece.scheduledSeconds += buffer.duration;
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

  /** The turn is over once the writer is, nothing is left to send, and every piece has landed. */
  private maybeComplete(turn: ActiveTurn) {
    if (
      this.turn !== turn ||
      turn.settled ||
      !turn.ended ||
      turn.buffer ||
      turn.inFlight > 0 ||
      turn.playIndex < turn.pieces.length
    ) {
      return;
    }

    turn.audioComplete = true;

    if (this.sources.size === 0) {
      this.turn = null;
      this.settleTurn(turn);
    }
  }

  private armQuietTimer(turn: ActiveTurn) {
    this.clearQuietTimer(turn);

    turn.quietTimer = setTimeout(() => {
      turn.quietTimer = null;

      if (this.turn === turn && !turn.ended && !turn.settled && turn.buffer) {
        turn.flushing = true;
        this.dispatch(turn);
      }
    }, WRITER_QUIET_FLUSH_MS);
  }

  private clearQuietTimer(turn: ActiveTurn) {
    if (turn.quietTimer) {
      clearTimeout(turn.quietTimer);
      turn.quietTimer = null;
    }
  }

  /** The turn's characters on its own clock, from the pieces that have started to play. */
  private timingsOf(turn: ActiveTurn) {
    const timings = createEmptyCharacterTimings();

    for (const piece of turn.pieces) {
      if (piece.offsetSeconds === null) {
        continue;
      }

      spreadPieceTimings(timings, {
        text: piece.text,
        offsetSeconds: piece.offsetSeconds,
        durationSeconds: piece.scheduledSeconds,
        complete: piece.complete && piece.waiting.length === 0,
      });
    }

    return timings;
  }

  /** See `TutorSpeechOutput.spokenIntoRoom`: what has left the speaker and can still echo. */
  spokenIntoRoom() {
    const previous = Date.now() <= this.roomTailUntil ? this.roomTail : "";
    const turn = this.turn;
    const context = this.context;

    if (!turn || !context) {
      return previous;
    }

    const timings = this.timingsOf(turn);
    const now = this.playedSeconds(turn, context);
    const played = spokenTextBefore(timings, now, turn.text);
    const earlier = timings.characters.length && now > ACTIVE_ECHO_WINDOW_SECONDS
      ? spokenTextBefore(timings, now - ACTIVE_ECHO_WINDOW_SECONDS, turn.text)
      : "";
    const recent = played.slice(earlier.length).trim();

    return `${previous} ${recent}`.trim();
  }

  private playedSeconds(turn: ActiveTurn, context: AudioContext) {
    return turn.audioStartedAt === null
      ? 0
      : Math.max(0, Math.min(context.currentTime, turn.scheduledUntil) - turn.audioStartedAt);
  }

  private rememberRoomTail(turn: ActiveTurn) {
    const context = this.context;
    const spoken = context
      ? spokenTextBefore(this.timingsOf(turn), this.playedSeconds(turn, context), turn.text)
      : "";

    if (!spoken) {
      return;
    }

    this.roomTail = spoken.split(/\s+/u).slice(-ROOM_TAIL_WORDS).join(" ");
    this.roomTailUntil = Date.now() + ROOM_TAIL_MS;
  }

  /** See `TutorSpeechOutput.stop`. In-flight requests are aborted rather than cancelled by id. */
  stop({ fadeOut = false }: { fadeOut?: boolean } = {}) {
    const turn = this.turn;
    const context = this.context;

    for (const source of this.fadingSources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    this.fadingSources.clear();
    if (context && this.gain) {
      this.gain.gain.cancelScheduledValues(context.currentTime);
      this.gain.gain.setValueAtTime(1, context.currentTime);
    }

    if (!turn || !context) {
      return { spokenText: "", wasSpeaking: false };
    }

    const wasSpeaking = turn.scheduledUntil > context.currentTime;
    const spokenText = spokenTextBefore(this.timingsOf(turn), this.playedSeconds(turn, context), turn.text);
    const fade = fadeOut && wasSpeaking && context.state === "running" &&
      turn.audioStartedAt !== null && turn.audioStartedAt <= context.currentTime;
    const stopAt = context.currentTime + (fade ? INTERRUPTION_FADE_SECONDS : 0);
    if (fade) this.gain?.gain.linearRampToValueAtTime(0, stopAt);

    this.clearQuietTimer(turn);
    turn.buffer = "";

    for (const piece of turn.pieces) {
      if (!piece.complete) {
        piece.controller.abort();
      }
    }

    for (const source of this.sources) {
      try {
        if (fade) {
          this.fadingSources.add(source);
          source.onended = () => {
            this.fadingSources.delete(source);
            source.disconnect();
          };
          source.stop(stopAt);
        } else {
          source.onended = null;
          source.stop();
          source.disconnect();
        }
      } catch {
        // Already finished.
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
    void this.context?.close();
    this.context = null;
    this.gain = null;
    this.analyser = null;
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

    for (const piece of turn.pieces) {
      if (!piece.complete) {
        piece.controller.abort();
      }
    }

    this.clearQuietTimer(turn);
    turn.settled = true;
    this.turn = null;
    this.rememberRoomTail(turn);
    turn.reject(error);
  }
}
