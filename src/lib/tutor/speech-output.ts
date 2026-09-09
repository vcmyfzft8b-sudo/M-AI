import {
  appendCharacterTimings,
  canCancelStream,
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
 * How long the writer may go quiet before the stream it is feeding is closed.
 *
 * Soniox kills a stream that is not fed, and measuring it live on `tts-rt-v2` turned up two
 * separate rules rather than one. A stream hears nothing for about 5.2 seconds and dies with
 * a 408 `request_timeout`; and a stream whose audio falls below roughly 0.8x of realtime dies
 * with a 408 "output audio rate below minimum" at around 11 seconds. Neither can be talked out
 * of it: `{keep_alive: true}` is scoped to the connection and does not touch the stream's clock
 * at all, and an empty `text` frame — which does reset it, without putting a word in the tutor's
 * mouth — only postpones the second rule. A model that stalls for six seconds mid-turn therefore
 * used to end the lesson, and the learner was shown a connection error for a slow OpenRouter chunk.
 *
 * The way out is that closing a stream early costs nothing. `text_end` does not truncate: a
 * stream given 216 characters and closed after 5 seconds, while synthesis was still running,
 * still produced all 215 of them and 12.8 seconds of audio. So the writer going quiet is met by
 * finishing the stream rather than by waiting to be killed, and the next word opens another one.
 * A turn is a sequence of streams, and a stall between them is silence rather than a failure.
 *
 * 3.5 seconds sits well inside the 5.2 the server allows, with room for a slow round trip, and
 * well outside the gap between two units of a turn — the language repair bounds its own wait at
 * 2.5 seconds, so a segment normally lasts the whole turn and this never fires.
 */
const WRITER_QUIET_CLOSE_MS = 3_500;

/**
 * How long the tutor's last words can still be in the room after its audio stops.
 *
 * The recognizer is behind the room by its own transit plus the pause it waits out
 * before calling an utterance over — about a second all told. Until that has passed,
 * text arriving from it may still be the tail of what the speaker was saying, and the
 * echo test needs the words to recognize it by.
 */
const ROOM_TAIL_MS = 1_200;
/** Includes recognizer/network lag without treating a whole lesson as room echo. */
const ACTIVE_ECHO_WINDOW_SECONDS = 6;
/** De-click a recognized interruption without waiting for another word or endpoint. */
const INTERRUPTION_FADE_SECONDS = 0.07;

/**
 * How much of that last turn is kept.
 *
 * Only its ending, because only its ending can still be in the air — a sentence from
 * the middle of the turn was heard and gone long ago. Keeping the whole turn would be
 * safe against echo and expensive everywhere else: the learner answers a question the
 * moment it is asked, often starting with the very word the tutor ended on, and every
 * word held here is a word of theirs that could be mistaken for it.
 */
const ROOM_TAIL_WORDS = 6;

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
  /** The turn's own name. Its segments are numbered from it — see `openSegment`. */
  id: string;
  /** The last stream announced for this turn, or null before the first word. */
  streamId: string | null;
  /** Every stream this turn has announced, because audio and errors arrive named. */
  segmentIds: Set<string>;
  /** Numbers the segments, so each one's id is unique on the connection. */
  segmentCounter: number;
  /** Whether `streamId` can still be given text. A closed one still has audio to deliver. */
  segmentOpen: boolean;
  /**
   * A closed segment that has not yet said it is finished.
   *
   * Streams on one connection run at the same time and their audio frames interleave — measured,
   * `a b a b a b`. The audio graph schedules what arrives in the order it arrives, so opening the
   * next segment before this one is done would splice the two together. Text waits in `pending`
   * until Soniox terminates the closed stream, which it does as the last of its audio is
   * delivered — while that audio is still playing, so the wait is not heard.
   */
  awaitingTermination: boolean;
  /** Text with nowhere to go yet: no segment open, or one still finishing. */
  pending: string;
  /**
   * What the open segment was given, and how much of it has come back as audio.
   *
   * Counted per segment rather than over the turn because Soniox drops the one trailing space
   * of every stream it closes, so a count kept across segments drifts a character each time —
   * and this is read as an index into the text when a starved stream has to be recovered from.
   */
  segmentPushed: string;
  segmentSynthesized: number;
  /** Held so the whole turn keeps one voice, not just its first segment. */
  voice: string | undefined;
  speed: number | undefined;
  /** Fires when the writer has gone quiet long enough to close the segment. */
  quietTimer: ReturnType<typeof setTimeout> | null;
  /** One `drain` at a time; it awaits a socket and must not interleave with itself. */
  draining: boolean;
  /**
   * Where this segment's first sample sits on the turn's own clock.
   *
   * Each stream numbers its character timestamps from its own zero, so without this the second
   * segment's timings would claim the turn's opening seconds and `spokenTextBefore` would cut
   * the record of what was heard in the wrong place — which is what the interruption record and
   * the echo test both read.
   */
  segmentOffset: number | null;
  /** The connection the id was announced on. It names nothing on any other — see `stop`. */
  socket: WebSocket;
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
  private fadingSources = new Set<AudioBufferSourceNode>();
  private turn: ActiveTurn | null = null;
  private turnCounter = 0;
  /** The last thing said out loud, and how long it can still be in the room. */
  private roomTail = "";
  private roomTailUntil = 0;
  private closed = false;
  /** Interrupted preparation and its replacement share one socket handshake. */
  private connectionPromise: Promise<void> | null = null;

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
        if (this.closed) {
          socket.close();
          resolve();
          return;
        }
        this.socket = socket;
        this.keepaliveTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ keep_alive: true }));
          }
        }, KEEPALIVE_INTERVAL_MS);
        socket.addEventListener("message", (event) => {
          if (!this.closed && this.socket === socket) {
            this.handleMessage(event);
          }
        });
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
           *
           * Neither is a turn between segments, and for the same reason. A stall long enough
           * to close a segment is long enough for Soniox to hang up on a connection with
           * nothing left to generate, so this is the ordinary end of a stall rather than a
           * fault: `drain` opens a fresh connection when the writer comes back with a word.
           */
          const turn = this.turn;

          if (turn && !turn.audioComplete && !turn.segmentOpen) {
            turn.awaitingTermination = false;

            if (turn.ended && !turn.pending) {
              turn.audioComplete = true;
              this.scheduleTurnEnd(turn);
            }
          } else if (!turn?.audioComplete) {
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
    if (this.closed) {
      throw new SpeechOutputError("The speech output is closed.", null);
    }

    if (this.connectionPromise) {
      await this.connectionPromise;
      return;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }

    this.socket?.close();
    this.socket = null;

    const connection = this.openSocket();
    this.connectionPromise = connection;
    try {
      await connection;
    } finally {
      if (this.connectionPromise === connection) {
        this.connectionPromise = null;
      }
    }
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
    const id = `turn-${this.turnCounter}`;
    let resolve: () => void = () => {};
    let reject: (error: Error) => void = () => {};
    const finished = new Promise<void>((resolveInner, rejectInner) => {
      resolve = resolveInner;
      reject = rejectInner;
    });

    const turn: ActiveTurn = {
      id,
      streamId: null,
      segmentIds: new Set(),
      segmentCounter: 0,
      segmentOpen: false,
      awaitingTermination: false,
      pending: "",
      segmentPushed: "",
      segmentSynthesized: 0,
      voice: options.voice,
      speed: options.speed,
      quietTimer: null,
      draining: false,
      segmentOffset: null,
      socket,
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

    this.turn = turn;

    return {
      push: (text: string) => {
        if (!text || this.turn !== turn) {
          return;
        }

        turn.text += text;
        turn.pending += text;
        this.armQuietTimer(turn);
        void this.drain(turn);
      },
      end: () => {
        if (this.turn !== turn || turn.ended) {
          return;
        }

        turn.ended = true;
        this.clearQuietTimer(turn);
        void this.drain(turn);
      },
      finished,
    };
  }

  /**
   * Announces the next stream of this turn.
   *
   * The first one is opened by the first word rather than by the intention to speak: Soniox
   * starts its clock the moment a stream is announced, and the text here comes from a model
   * that can take seconds to produce its first token. Every later one is opened by the first
   * word after a stall, for the same reason — an empty stream is a stream being timed.
   */
  private openSegment(turn: ActiveTurn) {
    turn.segmentCounter += 1;
    const streamId = `${turn.id}.${turn.segmentCounter}`;

    turn.streamId = streamId;
    turn.segmentIds.add(streamId);
    turn.segmentOpen = true;
    turn.opened = true;
    turn.segmentOffset = null;
    turn.segmentPushed = "";
    turn.segmentSynthesized = 0;

    turn.socket.send(
      JSON.stringify({
        api_key: this.apiKey,
        model: this.config.model,
        language: this.config.language,
        voice: turn.voice ?? this.config.voice,
        ...(turn.speed ?? this.config.speed ? { speed: turn.speed ?? this.config.speed } : {}),
        audio_format: "pcm_s16le",
        sample_rate: this.sampleRate,
        // Character timings are what let an interruption be recorded at the word the
        // learner actually heard rather than at the end of what was generated.
        return_timestamps: true,
        stream_id: streamId,
      }),
    );
  }

  /**
   * Sends whatever text is waiting, opening a stream and a connection if that is what it takes.
   *
   * Serialized against itself because it awaits the socket: two pushes arriving either side of
   * a reconnect must not both decide they are the ones to open the next segment.
   */
  private async drain(turn: ActiveTurn) {
    if (turn.draining) {
      return;
    }

    turn.draining = true;

    try {
      while (this.turn === turn && !turn.settled && turn.pending) {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          /*
           * Soniox hangs up on a connection with nothing to generate after about ten seconds,
           * which a stall longer than that reaches. The turn is not harmed by it — its audio is
           * scheduled and playing — so the connection is replaced and the turn carries on, the
           * same way `ensureOpen` replaces one between turns.
           */
          await this.ensureOpen();
        }

        const socket = this.socket;

        if (this.turn !== turn || turn.settled || socket?.readyState !== WebSocket.OPEN) {
          return;
        }

        /*
         * A stream id names something only on the connection it was announced on, and nothing
         * on that connection will report to us again. Whatever this turn was waiting for there
         * is not coming, so the next word starts a stream on the connection we actually have.
         */
        if (turn.socket !== socket) {
          turn.socket = socket;
          turn.segmentOpen = false;
          turn.awaitingTermination = false;
        }

        /* The closed segment is still delivering audio. Its `terminated` resumes this. */
        if (turn.awaitingTermination) {
          return;
        }

        if (!turn.segmentOpen) {
          this.openSegment(turn);
        }

        const text = turn.pending;
        turn.pending = "";
        turn.segmentPushed += text;
        socket.send(JSON.stringify({ text, text_end: false, stream_id: turn.streamId }));
      }

      if (this.turn === turn && !turn.settled && turn.ended && !turn.pending) {
        this.closeSegment(turn);
      }
    } catch {
      /*
       * Only `ensureOpen` throws here, and only when the connection cannot be replaced at all.
       * The turn keeps whatever audio it has and settles when that has played out; the socket's
       * own close handler is what tells the session, so nothing is swallowed.
       */
      turn.pending = "";
    } finally {
      turn.draining = false;
    }
  }

  /**
   * Finishes the open segment, which is what makes a stall survivable — see WRITER_QUIET_CLOSE_MS.
   *
   * A turn with nothing open and nothing outstanding is simply over: that is the turn whose
   * writer produced no text at all, and the caller waiting on `finished` must not wait forever.
   */
  private closeSegment(turn: ActiveTurn) {
    this.clearQuietTimer(turn);

    if (!turn.segmentOpen) {
      if (turn.ended && !turn.awaitingTermination && !turn.pending && this.turn === turn) {
        this.turn = null;
        this.settleTurn(turn);
      }

      return;
    }

    turn.segmentOpen = false;
    turn.awaitingTermination = true;

    if (turn.socket.readyState === WebSocket.OPEN) {
      turn.socket.send(JSON.stringify({ text: "", text_end: true, stream_id: turn.streamId }));
    }
  }

  /**
   * Puts back the space Soniox swallows at the end of every stream.
   *
   * A stream reports timestamps for every character it was given but the last one, when that
   * last one is the space the writer ended on. Left out, the record of what the tutor said
   * runs the two segments together — "cristae.Along those folds" — and that record is what the
   * interruption bookkeeping reads to work out where the learner cut in.
   */
  private restoreSegmentSeam(turn: ActiveTurn) {
    const missing = turn.segmentPushed.slice(turn.segmentSynthesized);

    if (!missing || missing.trim() || turn.timings.characters.length === 0) {
      return;
    }

    const lastEnd = turn.timings.endSeconds[turn.timings.endSeconds.length - 1];

    for (const character of missing) {
      turn.timings.characters.push(character);
      turn.timings.startSeconds.push(lastEnd);
      turn.timings.endSeconds.push(lastEnd);
    }

    turn.segmentSynthesized += missing.length;
  }

  /** Restarted by every word, so it only ever fires on a writer that has actually stopped. */
  private armQuietTimer(turn: ActiveTurn) {
    this.clearQuietTimer(turn);

    turn.quietTimer = setTimeout(() => {
      turn.quietTimer = null;

      if (this.turn === turn && !turn.ended && !turn.settled) {
        this.closeSegment(turn);
      }
    }, WRITER_QUIET_CLOSE_MS);
  }

  private clearQuietTimer(turn: ActiveTurn) {
    if (turn.quietTimer) {
      clearTimeout(turn.quietTimer);
      turn.quietTimer = null;
    }
  }

  /**
   * A segment has stopped generating, cleanly or otherwise.
   *
   * The turn is only over when the writer has finished too and nothing is left waiting; short of
   * that this is the signal the next segment has been waiting for, and the text held back while
   * the old one drained its audio can go.
   */
  private finishSegment(turn: ActiveTurn) {
    this.restoreSegmentSeam(turn);
    turn.segmentOpen = false;
    turn.awaitingTermination = false;
    turn.segmentOffset = null;

    if (turn.ended && !turn.pending) {
      turn.audioComplete = true;
      this.scheduleTurnEnd(turn);

      return;
    }

    void this.drain(turn);
  }

  /**
   * What the tutor's own voice has put into the room, for the echo test to recognize.
   *
   * Not the text of the turn: the part of it that has already left the speaker, which
   * during a turn is usually a sentence or two behind what has been generated. Words
   * the learner has not heard yet cannot be echoing back at the microphone, and
   * counting them would only make the tutor deaf to a learner who happened to use one.
   *
   * Only the recent six seconds can still be in the recognizer. After a turn, keep
   * only the few words it ended on for as long as those can still be in the air, then
   * nothing at all. That last state is most of the session — during the learner's turn
   * nothing they say is measured against the tutor — and it is what makes it safe for
   * `isTutorEcho` to be as strict as it is.
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

    const now = this.playedSeconds(turn, context);
    const played = spokenTextBefore(turn.timings, now, turn.text);
    // Keep the full conservative fallback when timestamps are unavailable.
    const earlier = turn.timings.characters.length && now > ACTIVE_ECHO_WINDOW_SECONDS
      ? spokenTextBefore(turn.timings, now - ACTIVE_ECHO_WINDOW_SECONDS, turn.text)
      : "";
    const recent = played.slice(earlier.length).trim();

    return `${previous} ${recent}`.trim();
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

    this.roomTail = spoken.split(/\s+/u).slice(-ROOM_TAIL_WORDS).join(" ");
    this.roomTailUntil = Date.now() + ROOM_TAIL_MS;
  }

  /**
   * Cancels the turn now and reports what was actually heard of it. A recognized
   * interruption may fade the existing audio over 70ms; Pause and End stop it hard.
   *
   * Everything still queued is discarded, the socket is told to stop generating,
   * and the text is cut at the last character whose audio had already left the
   * speaker — see `spokenTextBefore` for why that is not the same as the text
   * that was generated.
   */
  stop({ fadeOut = false }: { fadeOut?: boolean } = {}) {
    const turn = this.turn;
    const context = this.context;

    // Pause, End and replacement speech also silence any unfinished fade.
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
    const spokenText = spokenTextBefore(turn.timings, this.playedSeconds(turn, context), turn.text);
    const fade = fadeOut && wasSpeaking && context.state === "running" &&
      turn.audioStartedAt !== null && turn.audioStartedAt <= context.currentTime;
    const stopAt = context.currentTime + (fade ? INTERRUPTION_FADE_SECONDS : 0);
    if (fade) this.gain?.gain.linearRampToValueAtTime(0, stopAt);

    this.clearQuietTimer(turn);
    turn.pending = "";

    /*
     * Only a segment that is still generating can be cancelled, which between segments is none
     * of them: the last one has already terminated and its id names nothing Soniox still holds.
     * Sending it anyway is the stale cancel #342 removed, answered with a 400 that lands on
     * whichever turn is current by then.
     */
    if (
      (turn.segmentOpen || turn.awaitingTermination) &&
      canCancelStream(turn, this.socket) &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      this.socket.send(JSON.stringify({ stream_id: turn.streamId, cancel: true }));
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
      /*
       * Errors belong to a stream, so they are filtered by one like every other frame.
       *
       * Measured against `tts-rt-v2` on 2026-09-04: every error frame names its
       * `stream_id` — the 400 `invalid_stream_state` from cancelling a stream that has
       * already terminated, the 408 `request_timeout` of a stream left without text, a
       * 401 for a rejected key, a 400 for a field out of range. Each is followed by
       * `{terminated: true}` for that same stream and the connection stays open.
       *
       * An error naming a stream that is not one of the current turn's is therefore a dead
       * turn's, and failing the live turn for it ends the lesson over speech the learner has
       * already moved on from — which is what MEMOAI-WEB-3D was. Soniox sends an empty
       * `stream_id` when it could not attribute the failure to a stream at all, and that,
       * like a frame with no id, is connection-level and has to reach the learner.
       */
      const streamId = typeof message.stream_id === "string" ? message.stream_id : "";
      const turn = this.turn;

      if (streamId && !turn?.segmentIds.has(streamId)) {
        return;
      }

      /*
       * A starved segment is not a failed turn.
       *
       * Closing on a quiet writer is what normally keeps this from happening, but it cannot
       * cover a writer that dribbles: text arriving often enough to reset the 5 second clock
       * and slowly enough to fall under the audio-rate floor still gets the stream killed at
       * around eleven seconds. That is the one case left, and ending the lesson for it would
       * be the very thing this is meant to stop. The segment is treated as finished instead,
       * and whatever it had not yet turned into audio goes to the next one — the character
       * timestamps are an exact prefix of the text pushed, so the remainder is what is left
       * after them.
       */
      if (turn && streamId && String(message.error_code) === "408") {
        /*
         * Only for the segment being fed. A 408 naming one this turn has already moved past is
         * a dead stream's and has nothing to recover — replaying its text would say a sentence
         * the learner has already heard.
         */
        if (streamId === turn.streamId) {
          turn.pending = turn.segmentPushed.slice(turn.segmentSynthesized) + turn.pending;
          this.finishSegment(turn);
        }

        return;
      }

      /*
       * A segment that is no longer being fed has nothing left to fail.
       *
       * Closing a segment is what starts this: `closeSegment` sends `text_end` for a stream
       * Soniox may already have finished generating, and a stream it has torn down answers
       * `400 Stream turn-N.M not found. Send a start message first.` The same 400 comes back
       * from the `text_end` racing the `terminated` that was already on its way. Either way
       * the segment's audio is scheduled and playing, the turn has moved on to the next
       * stream or is waiting for that one's `terminated`, and the only thing left to do with
       * the frame is drop it — which is what MEMOAI-WEB-3M was, a whole lesson ended over a
       * sentence the learner was in the middle of hearing.
       *
       * The turn-level filter above cannot see this: every segment of the live turn is in
       * `segmentIds`, so a dead segment's error reads as the live turn's. Only the stream
       * still being fed can be harmed by one, which is the same rule the 408 above follows.
       */
      if (turn && streamId && !(turn.segmentOpen && streamId === turn.streamId)) {
        return;
      }

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

    if (
      !turn ||
      typeof message.stream_id !== "string" ||
      !turn.segmentIds.has(message.stream_id)
    ) {
      // A late frame from a turn the learner already interrupted. Nothing to play.
      return;
    }

    /*
     * Audio before timestamps, which is the reverse of how they read in the frame. A segment's
     * timings are only meaningful once its offset on the turn's clock is known, and that is
     * fixed by scheduling its first sample.
     */
    if (typeof message.audio === "string") {
      this.enqueueAudio(turn, message.audio);
    }

    if (message.timestamps && typeof message.timestamps === "object") {
      const before = turn.timings.characters.length;

      appendCharacterTimings(
        turn.timings,
        message.timestamps as Record<string, unknown>,
        turn.segmentOffset ?? 0,
      );

      turn.segmentSynthesized += turn.timings.characters.length - before;
    }

    /*
     * The end of a segment, not necessarily of the turn — `finishSegment` decides which.
     * `audio_end` rides on the last audio frame rather than arriving as one of its own, which
     * is why the audio above is enqueued before this is read and not after.
     *
     * Only the segment being fed may be finished by one of these. Soniox sends `audio_end` and
     * then `terminated` for the same stream, and the first of them is enough to release the
     * next segment — so by the time the second arrives it names a stream this turn has already
     * moved past. Acting on it would mark the *live* segment closed while it was still being
     * fed, and the words already sent to it would sit there until Soniox timed it out.
     */
    if (
      (message.audio_end === true || message.terminated === true) &&
      message.stream_id === turn.streamId
    ) {
      this.finishSegment(turn);
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

    /*
     * Where this segment landed on the turn's clock, fixed by its first sample and applied to
     * every timestamp it reports. A stall puts real silence between two segments, so this is
     * the scheduled position rather than the audio delivered so far: the two differ by exactly
     * the gap the learner heard.
     */
    if (turn.segmentOffset === null) {
      turn.segmentOffset = startAt - turn.audioStartedAt;
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
