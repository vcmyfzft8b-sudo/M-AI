"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { useT } from "@/components/i18n-provider";
import { readChatStream } from "@/lib/chat-stream-client";
import { pillNeighbourhoodScrollTarget } from "@/lib/tab-scroll";
import {
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_VOICES,
  NOTE_TTS_VOICE_STORAGE_KEY,
  normalizeNoteTtsVoice,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";
import {
  isEchoOfTutor,
  isSubstantialInterruption,
  LevelEnvelope,
  SpeechTextBuffer,
  stripAudioTags,
} from "@/lib/tutor/turn-audio";
import {
  SpeechInputError,
  TutorSpeechInput,
} from "@/lib/tutor/speech-input";
import { reportTutorFailure, resetTutorFailureReports } from "@/lib/tutor/report";
import { SpeechOutputError, TutorSpeechOutput } from "@/lib/tutor/speech-output";
import { voiceHue } from "@/lib/tutor/voice-colors";
import { voiceSampleText } from "@/lib/tutor/voice-sample";
import {
  DEFAULT_TUTOR_SPEED,
  normalizeTutorSpeed,
  TUTOR_SPEEDS,
  TUTOR_SPEED_STORAGE_KEY,
  type TutorSpeed,
} from "@/lib/tutor/voice-speed";

/**
 * The spoken walkthrough.
 *
 * A tutor talking a learner through their own lecture, out loud, that can be
 * interrupted mid-sentence the way a person can. The shape of the thing is a
 * loop of turns — the tutor takes one topic at a time — with two ways out of
 * every turn: it finishes, or the learner cuts in.
 *
 * Cutting in is the part everything else is arranged around, so it is worth
 * saying plainly how it works. The microphone is open the whole session and is
 * watched locally, so the voice ducks within about a tenth of a second of
 * somebody speaking — before anyone knows what they said. What the detector
 * looks for is a sound shaped like a voice rather than merely a loud one, which
 * is what keeps a passing car, a turned page or a dog next door from quietly
 * stopping the lesson. The recognizer's words arrive a moment later and decide
 * what that was: an echo of the tutor's own voice off a phone speaker, a cough,
 * or a real question. Only the last of those actually takes the floor, and when
 * it does, what the tutor had already *said* is recorded — not what it had
 * generated, which by then is usually a sentence or two further on.
 *
 * The two ways a duck ends without an interruption matter as much as the duck
 * itself. If the recognizer finds no words in whatever it was, the voice comes
 * straight back up the moment the room goes quiet again, rather than sitting out
 * the full grace period — a second of silence after a cough is exactly the thing
 * that makes the tutor feel broken.
 */

/**
 * Whether a failure came from the wire rather than from us.
 *
 * A browser words a request that never landed in its own way and its own language —
 * Safari says "Load failed", Chrome "Failed to fetch" — and putting that in front of a
 * Slovenian student tells them nothing except that something broke, in English. A socket
 * Soniox hung up on is the same kind of thing. Only a message our own server wrote is
 * worth showing as it stands; everything here becomes the one about the connection,
 * which is both true and something Continue can act on.
 */
function isTransportFailure(caught: unknown) {
  return (
    caught instanceof TypeError ||
    caught instanceof DOMException ||
    caught instanceof SpeechOutputError ||
    caught instanceof SpeechInputError
  );
}

/**
 * How long a ducked voice waits for the recognizer to justify the interruption.
 *
 * Only ever waited out in full while a sound is still going: once the room is
 * quiet again and nothing was recognized in it, the voice comes back without
 * waiting for this.
 */
const INTERRUPTION_GRACE_MS = 1_400;

/**
 * How long before the Soniox keys expire the session quietly takes its next slice.
 *
 * The keys are minted for the slice of talking time the server reserved — half an hour —
 * and they are the whole enforcement, so they really do stop working. Renewing on a
 * margin rather than on the expiry itself keeps the swap out of the middle of a turn and
 * leaves room for the round trip that fetches it. Without this the conversation ran into
 * a wall at the half hour: Soniox answers an expired key with a 401, which reached the
 * learner as "the connection to the voice service dropped" and paused the walkthrough.
 */
const CREDENTIAL_RENEWAL_MARGIN_MS = 120_000;

/** A beat before a dropped turn request is asked for again. */
const TURN_RETRY_DELAY_MS = 500;

/** After the tutor asks a check question, how long it waits before carrying on regardless. */
const FOLLOW_UP_SILENCE_MS = 7_000;

/** A short beat after handing back, so the learner can still jump in before it resumes. */
const HAND_BACK_GRACE_MS = 900;

/**
 * How long the tutor waits after asking the learner to explain something back.
 *
 * Much longer than the wait after an ordinary check question, because this one is real
 * work: they have to find their own words for something they heard a minute ago, and the
 * pause while they do is the method working, not a stall. Cutting in after seven seconds
 * would teach them that the question was rhetorical.
 */
const EXPLAIN_BACK_SILENCE_MS = 16_000;

type TutorPhase =
  | "idle"
  | "preparing"
  | "thinking"
  | "speaking"
  | "listening"
  | "paused"
  | "finished";

type TutorTopic = { title: string; points: string[] };
type TutorPlan = { subject: string; topics: TutorTopic[] };

type TutorUsage = {
  remainingSeconds: number;
  limitSeconds: number;
  usedSeconds: number;
  creditSeconds: number;
  hasPaidAccess: boolean;
  hasUnlimitedUsage: boolean;
};

/** Why the session was refused: no trial left, or no time left today. */
type TutorBlock = "tutor_trial_used" | "tutor_credits_needed";

type TutorSessionResponse = {
  language: string;
  grantId: string | null;
  grantedSeconds: number;
  usage: TutorUsage;
  realtime: {
    stt: { apiKey: string; url: string; model: string; expiresAt: string };
    tts: { apiKey: string; url: string; model: string; voice: NoteTtsVoice; expiresAt: string };
  };
};

type TurnKind = "opening" | "teach" | "answer" | "feedback" | "resume" | "closing";

function readStoredVoice(): NoteTtsVoice {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_VOICE;
  }

  try {
    return normalizeNoteTtsVoice(window.localStorage.getItem(NOTE_TTS_VOICE_STORAGE_KEY));
  } catch {
    // Private browsing refuses storage outright. The default voice is a fine answer.
    return DEFAULT_NOTE_TTS_VOICE;
  }
}

/**
 * A usage bar whose number stays readable wherever the fill happens to end.
 *
 * The label sits across the whole bar, so at 40% it straddles two very different
 * backgrounds — a bright fill on one side, the bare track on the other — and any single
 * colour is wrong on one of them. So it is drawn twice: once in the theme's own text
 * colour, and once in near-black clipped to exactly the filled width and laid over the
 * top. The seam falls on the fill's own edge, so it reads as one number that changes
 * colour where the bar does.
 *
 * The clipped copy is always dark because the fill is bright in both themes. The copy
 * underneath is `var(--text)`, and that is what makes this work in light mode: there the
 * track is pale and wants dark text, and the token already says so.
 */
function UsageBar({
  percent,
  label,
  ariaLabel,
  className,
}: {
  percent: number;
  label: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      className={`note-read-usage-bar memo-tutor-bar ${className ?? ""}`.trim()}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={label}
    >
      <span className="note-read-usage-fill" style={{ width: `${percent}%` }} />
      <span className="memo-tutor-bar-label on-track" aria-hidden="true">
        {label}
      </span>
      <span
        className="memo-tutor-bar-label on-fill"
        aria-hidden="true"
        style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
      >
        {label}
      </span>
    </div>
  );
}

export function LectureTutor({
  lectureId,
  isReady,
  dockSlot,
}: {
  lectureId: string;
  isReady: boolean;
  /** The note screen's floating dock, which the usage pill is portalled into. */
  dockSlot: HTMLElement | null;
}) {
  const t = useT();

  const [phase, setPhase] = useState<TutorPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  /** False when the microphone was refused or is absent: the walkthrough runs, barge-in does not. */
  const [canListen, setCanListen] = useState(true);
  /**
   * The one line under the sphere.
   *
   * Not a chat log — the tutor's own words are already in the room, and printing
   * them competes with listening to them. All this has to do is prove the
   * microphone heard the learner, so it holds exactly one thing: what they are
   * saying, or the last thing they said.
   */
  const [heard, setHeard] = useState<{ text: string; settled: boolean } | null>(null);
  const [voice, setVoice] = useState<NoteTtsVoice>(DEFAULT_NOTE_TTS_VOICE);
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  const [usage, setUsage] = useState<TutorUsage | null>(null);
  const [blocked, setBlocked] = useState<TutorBlock | null>(null);
  const [buyingCredits, setBuyingCredits] = useState(false);
  const [isUsageOpen, setUsageOpen] = useState(false);
  const [speed, setSpeed] = useState<TutorSpeed>(DEFAULT_TUTOR_SPEED);
  const speedRef = useRef<TutorSpeed>(DEFAULT_TUTOR_SPEED);
  /*
   * The slice this session is spending, and how much of it has gone. Counted in the browser
   * because the audio is made there; the server reserved the whole slice up front, so this
   * only ever hands time back.
   */
  const grantIdRef = useRef<string | null>(null);
  const spentSecondsRef = useRef(0);
  const spendTimerRef = useRef<number | null>(null);
  /**
   * The sphere is driven by writing a custom property straight to its node, not by
   * React state. At sixty frames a second a `setState` per frame re-renders this
   * whole component sixty times a second — for one number that only CSS reads.
   * Dropping out of React here is both smoother and very much cheaper.
   */
  const orbRef = useRef<HTMLDivElement | null>(null);
  const envelopeRef = useRef(new LevelEnvelope());

  const outputRef = useRef<TutorSpeechOutput | null>(null);
  const inputRef = useRef<TutorSpeechInput | null>(null);
  const planRef = useRef<TutorPlan | null>(null);
  /**
   * The running order, in flight.
   *
   * The greeting does not need it and the plan is by far the slowest part of
   * starting (6864ms of a 7737ms startup, measured in the app), so the two are
   * fired together and the tutor starts talking while this is still being
   * written. Anything that needs the plan awaits this instead of assuming it.
   */
  const planPromiseRef = useRef<Promise<TutorPlan | null> | null>(null);
  const topicIndexRef = useRef(0);
  const phaseRef = useRef<TutorPhase>("idle");
  const historyRef = useRef<Array<{ role: "tutor" | "learner"; content: string }>>([]);
  /** What the tutor has said about the current topic, so a resume never repeats it. */
  const spokenSoFarRef = useRef("");
  const turnAbortRef = useRef<AbortController | null>(null);
  const interruptionTimerRef = useRef<number | null>(null);
  /** Whether the recognizer has found any words since the voice last ducked. */
  const heardWhileDuckedRef = useRef(false);
  /** When the keys in the browser's hands stop working, as milliseconds. */
  const credentialsExpireAtRef = useRef<number | null>(null);
  const renewalTimerRef = useRef<number | null>(null);
  /* Declared here and filled in below, so a turn can pause the session it is running in. */
  const pauseRef = useRef<() => void>(() => {});
  /** The renewal in progress, so three callers cannot reserve three slices. */
  const renewalInFlightRef = useRef<Promise<boolean> | null>(null);
  const followUpTimerRef = useRef<number | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const previewRef = useRef<TutorSpeechOutput | null>(null);
  /* Only the newest tap owns the preview; an earlier one that is still connecting bows out. */
  const previewTokenRef = useRef(0);
  const previewCredentialsRef = useRef<TutorSessionResponse | null>(null);
  /** Guards every async continuation: a session that has been ended must not speak again. */
  const runIdRef = useRef(0);
  /** Set while the tutor has asked the learner to say an idea back in their own words. */
  const awaitingExplanationRef = useRef(false);
  /*
   * Which turn currently holds the floor.
   *
   * `turn.finished` resolves both ways — when the tutor reaches the end of what it was
   * saying, and when something stops it early. Without a token to tell those apart, an
   * interruption looked exactly like a finished turn: the walkthrough advanced to the next
   * topic and started teaching it over the learner who had just asked a question. Pausing
   * and skipping had the same shape. Anything that takes the floor clears this, and a turn
   * that wakes up no longer holding it simply stops.
   */
  const floorTokenRef = useRef(0);

  const setPhaseNow = useCallback((next: TutorPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  /** Shows what the learner said. The tutor's own turns are heard, not read. */
  const showHeard = useCallback((text: string, settled: boolean) => {
    const trimmed = text.trim();

    setHeard(trimmed ? { text: trimmed, settled } : null);
  }, []);

  /**
   * Ends an audition.
   *
   * A previewed voice is a whole second speech socket with its own audio context, and
   * nothing else in the screen knows about it — so anything that takes over the room has
   * to say so here. The token goes up as well as the socket coming down, because the tap
   * that started this may still be in flight: without it, a preview whose connection
   * lands a moment later would start talking over whatever came next.
   */
  const stopPreview = useCallback(() => {
    previewTokenRef.current += 1;
    previewRef.current?.close();
    previewRef.current = null;
    setPreviewVoice(null);
  }, []);

  const teardown = useCallback(() => {
    runIdRef.current += 1;
    floorTokenRef.current += 1;
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    clearTimer(interruptionTimerRef);
    clearTimer(followUpTimerRef);
    clearTimer(renewalTimerRef);
    credentialsExpireAtRef.current = null;

    if (levelFrameRef.current !== null) {
      window.cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }

    envelopeRef.current.reset();
    orbRef.current?.style.setProperty("--tutor-level", "0");

    planPromiseRef.current = null;
    stopPreview();
    previewCredentialsRef.current = null;
    outputRef.current?.close();
    outputRef.current = null;
    inputRef.current?.close();
    inputRef.current = null;
    setHeard(null);
  }, [stopPreview]);

  const heardRef = useRef<HTMLParagraphElement | null>(null);

  /*
   * Keeps the transcript's two-line window on the words just spoken.
   *
   * The line is a fixed height and the text runs past it, so left alone it shows the
   * opening of a long sentence and nothing after — which reads as the recognizer having
   * given up. Scrolling to the bottom on every revision is what makes it a live caption
   * rather than a stuck one.
   */
  useEffect(() => {
    const element = heardRef.current;

    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [heard]);

  const voiceRowRef = useRef<HTMLDivElement | null>(null);
  const usageMenuRef = useRef<HTMLDetailsElement | null>(null);

  /*
   * The same sheet read-aloud's quota uses — a popover on desktop, a dragged sheet on the
   * phone — because it answers the same question in the same place, and a second kind of
   * meter for a second metered feature is just a thing to learn twice.
   */
  const closeUsageMenu = useCallback(() => {
    setUsageOpen(false);

    if (usageMenuRef.current) {
      usageMenuRef.current.open = false;
    }
  }, []);
  const usageSheet = useSheet(closeUsageMenu);

  useEffect(() => {
    setVoice(readStoredVoice());

    try {
      const stored = normalizeTutorSpeed(window.localStorage.getItem(TUTOR_SPEED_STORAGE_KEY));
      setSpeed(stored);
      speedRef.current = stored;
    } catch {
      // Private browsing refuses storage; the default speed is a fine answer.
    }
  }, []);

  function chooseSpeed(next: TutorSpeed) {
    setSpeed(next);
    speedRef.current = next;

    try {
      window.localStorage.setItem(TUTOR_SPEED_STORAGE_KEY, String(next));
    } catch {
      // As above.
    }
  }

  /** What is left, read before anything is granted, so the meter is right on arrival. */
  const refreshUsage = useCallback(async () => {
    try {
      const response = await fetch(`/api/lectures/${lectureId}/tutor/usage`);
      const payload = (await response.json().catch(() => null)) as { usage?: TutorUsage } | null;

      if (payload?.usage) {
        setUsage(payload.usage);
      }
    } catch {
      // The meter is a courtesy; a session that starts will report the truth anyway.
    }
  }, [lectureId]);

  useEffect(() => {
    if (isReady) {
      void refreshUsage();
    }
  }, [isReady, refreshUsage]);

  /**
   * Hands back whatever of the slice was not used.
   *
   * `keepalive` so it still goes out when the tab is closing, which is the case that matters:
   * an unreported slice is charged in full by the server's sweep, so this is the learner's
   * refund and it has to survive the page going away.
   */
  const settleGrant = useCallback(() => {
    const grantId = grantIdRef.current;

    if (!grantId) {
      return;
    }

    const secondsUsed = spentSecondsRef.current;
    grantIdRef.current = null;
    spentSecondsRef.current = 0;

    void fetch(`/api/lectures/${lectureId}/tutor/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId, secondsUsed }),
      keepalive: true,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { usage?: TutorUsage } | null;

        if (payload?.usage) {
          setUsage(payload.usage);
        }
      })
      .catch(() => {
        void refreshUsage();
      });
  }, [lectureId, refreshUsage]);

  /**
   * Takes the session's next slice of talking time before the current one's keys expire.
   *
   * The browser talks to Soniox directly, so the temporary keys are not a convenience —
   * they are the enforcement, and they are minted for exactly the slice the server
   * reserved. A conversation that outlasts its slice therefore has to reserve the next
   * one, and until this existed none did: half an hour in, Soniox began answering every
   * new turn with a 401, which the learner saw as "the connection to the voice service
   * dropped" with the walkthrough paused. Nothing was wrong with the connection.
   *
   * Returns whether the walkthrough should carry on. A slice that cannot be reserved
   * because their time is genuinely spent is a paywall, not a fault, and ends the
   * session where it stands rather than reporting an error.
   */
  const reserveNextSlice = useCallback(async () => {
    const runId = runIdRef.current;

    try {
      const response = await fetch(`/api/lectures/${lectureId}/tutor/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (TutorSessionResponse & { error?: string; code?: TutorBlock })
        | null;

      if (runId !== runIdRef.current) {
        return false;
      }

      if (response.status === 402) {
        if (payload?.usage) {
          setUsage(payload.usage);
        }

        setBlocked(payload?.code ?? "tutor_credits_needed");
        settleGrant();
        teardown();
        planRef.current = null;
        setPhaseNow("idle");

        return false;
      }

      if (!response.ok || !payload?.realtime) {
        throw new Error(payload?.error ?? t("tutor.error.startFailed"));
      }

      /* The slice being left behind is reported before the next one is adopted. */
      settleGrant();
      grantIdRef.current = payload.grantId;
      spentSecondsRef.current = 0;
      setUsage(payload.usage);
      adoptCredentialsRef.current(payload);

      outputRef.current?.useKey(payload.realtime.tts.apiKey);
      await inputRef.current?.useKey(payload.realtime.stt.apiKey);

      return true;
    } catch (caught) {
      /*
       * A renewal that fails is not the end of the session. The margin is two minutes of
       * still-valid credentials, turns come round far more often than that, and the next
       * one tries again — so carrying on is right, and giving up here would end a working
       * conversation over one failed request. It is still worth knowing about: a renewal
       * that keeps failing ends the session a couple of minutes later with a 401, and
       * that is the failure nobody could see before.
       */
      reportTutorFailure(caught, { lectureId, stage: "renewal", phase: phaseRef.current });

      return true;
    }
  }, [lectureId, setPhaseNow, settleGrant, t, teardown, voice]);

  const renewCredentials = useCallback(async () => {
    const expiresAt = credentialsExpireAtRef.current;

    if (expiresAt === null || Date.now() < expiresAt - CREDENTIAL_RENEWAL_MARGIN_MS) {
      return true;
    }

    /*
     * One renewal at a time, whoever asked.
     *
     * Three things call this — the alarm, the start of every turn, and taking the
     * microphone back after a pause — and pressing Continue sets the last two off
     * together. Each reserves a slice of talking time on the server, so two at once would
     * reserve two and charge the learner for both. The second caller waits on the first
     * one's answer instead of asking again.
     */
    const inFlight = renewalInFlightRef.current;

    if (inFlight) {
      return inFlight;
    }

    const attempt = reserveNextSlice();
    renewalInFlightRef.current = attempt;

    try {
      return await attempt;
    } finally {
      renewalInFlightRef.current = null;
    }
  }, [reserveNextSlice]);

  const renewCredentialsRef = useRef(renewCredentials);
  renewCredentialsRef.current = renewCredentials;

  /**
   * Notes when the keys in hand expire and sets the alarm to replace them.
   *
   * The alarm matters on its own: a learner who sits quietly past the half hour takes no
   * turns, and a renewal that only ever happened before a turn would never come round.
   * The check before each turn stays as well, because a phone throttles the timers of a
   * backgrounded tab and the alarm can be late.
   */
  /**
   * Asks for a recognizer back after a pause, an unmute, or a spell in the background.
   *
   * Two things have to be true before it can work and both can have changed while the
   * session was not listening: the keys may be near their expiry, and every realtime
   * stream in the organisation may be taken. Neither stops the walkthrough — losing the
   * microphone costs the ability to cut in by speaking and nothing else — so this reports
   * what happened and leaves the tutor talking.
   */
  const restoreListening = useCallback(async () => {
    const input = inputRef.current;

    if (!input || input.isListening) {
      return;
    }

    /* A stale key would simply be refused, so it is worth spending the round trip first. */
    if (!(await renewCredentialsRef.current())) {
      return;
    }

    const listening = await input.startListening();

    setCanListen(listening && !input.isMuted);

    if (!listening) {
      setError(t("tutor.error.listeningBusy"));
    }
  }, [t]);

  const adoptCredentials = useCallback((session: TutorSessionResponse) => {
    const expiresAt = Date.parse(session.realtime.tts.expiresAt);

    clearTimer(renewalTimerRef);
    credentialsExpireAtRef.current = Number.isNaN(expiresAt) ? null : expiresAt;

    if (credentialsExpireAtRef.current === null) {
      return;
    }

    const delay = Math.max(
      0,
      credentialsExpireAtRef.current - CREDENTIAL_RENEWAL_MARGIN_MS - Date.now(),
    );

    renewalTimerRef.current = window.setTimeout(() => {
      void renewCredentialsRef.current();
    }, delay);
  }, []);

  const adoptCredentialsRef = useRef(adoptCredentials);
  adoptCredentialsRef.current = adoptCredentials;

  /*
   * The row overflows, and the saved voice is regularly past its right edge — which
   * looks exactly like nothing being selected at all.
   *
   * Moved with the same arithmetic the note's pill row uses (`tabScrollTarget`), not with
   * `scrollIntoView`: that scrolls every scrollable ancestor as well, so asking a chip to
   * centre itself also dragged the note screen behind it. This moves one element, leaves
   * the row alone when the chip is already comfortably visible, and keeps a gutter so the
   * next voice along still peeks in — which is what says the row keeps going.
   */
  useEffect(() => {
    const row = voiceRowRef.current;
    const chip = row?.querySelector<HTMLElement>(".memo-tutor-voice.active");

    if (!row || !chip) {
      return;
    }

    const previous = chip.previousElementSibling;
    const next = chip.nextElementSibling;
    const target = pillNeighbourhoodScrollTarget({
      /*
       * Named explicitly, never spread: scrollLeft, clientWidth and scrollWidth are
       * getters on the prototype, so `{ ...row }` silently yields none of them and the
       * arithmetic quietly becomes NaN.
       */
      row: {
        scrollLeft: row.scrollLeft,
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        left: row.getBoundingClientRect().left,
      },
      pill: chip.getBoundingClientRect(),
      previous: previous instanceof HTMLElement ? previous.getBoundingClientRect() : null,
      next: next instanceof HTMLElement ? next.getBoundingClientRect() : null,
    });

    if (target === null) {
      return;
    }

    row.scrollTo({
      left: target,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [voice]);

  useEffect(() => teardown, [teardown]);

  /*
   * One second of the slice per second the tutor is live. Paused, finished and idle do not
   * count — the learner is not being talked to, and charging for a paused session is the
   * kind of thing people notice once and never forgive.
   */
  useEffect(() => {
    const running =
      phase === "preparing" ||
      phase === "thinking" ||
      phase === "speaking" ||
      phase === "listening";

    if (!running) {
      return;
    }

    spendTimerRef.current = window.setInterval(() => {
      /*
       * Weighted by the speed, not by the clock. A minute at 1.15x plays fifteen per cent
       * more material and costs fifteen per cent more to synthesize, so charging it as a
       * flat minute would make the fast setting a discount on the thing being metered.
       */
      spentSecondsRef.current += speedRef.current;
    }, 1000);

    return () => {
      if (spendTimerRef.current !== null) {
        window.clearInterval(spendTimerRef.current);
        spendTimerRef.current = null;
      }
    };
  }, [phase]);

  /* The tab going away is the likeliest end of a session, and the one that must still pay. */
  useEffect(() => {
    const report = () => settleGrant();

    window.addEventListener("pagehide", report);

    return () => {
      window.removeEventListener("pagehide", report);
      report();
    };
  }, [settleGrant]);

  /*
   * One animation frame loop for the life of the component, reading whichever voice is
   * currently making sound — the walkthrough's, or a voice being previewed. Started here
   * rather than inside the session so the sphere reacts while somebody is picking a voice.
   */
  useEffect(() => {
    const pump = () => {
      const speaking = outputRef.current?.getLevel() ?? previewRef.current?.getLevel() ?? 0;
      const listening = inputRef.current?.getLevel() ?? 0;
      const raw = Math.max(speaking, phaseRef.current === "listening" ? listening * 1.6 : 0);

      orbRef.current?.style.setProperty("--tutor-level", envelopeRef.current.push(raw).toFixed(4));
      levelFrameRef.current = window.requestAnimationFrame(pump);
    };

    levelFrameRef.current = window.requestAnimationFrame(pump);

    return () => {
      if (levelFrameRef.current !== null) {
        window.cancelAnimationFrame(levelFrameRef.current);
        levelFrameRef.current = null;
      }
    };
  }, []);

  /*
   * A walkthrough that keeps talking after the learner has walked away is worse
   * than one that stops early, and a phone locking its screen is the ordinary
   * way a session ends. Leaving the tab pauses; coming back does not resume on
   * its own, because being talked at the moment a tab regains focus is startling.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && phaseRef.current !== "idle") {
        pause();
      }
    };

    document.addEventListener("visibilitychange", onHidden);

    return () => document.removeEventListener("visibilitychange", onHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pause is stable for the session's life
  }, []);

  /**
   * One turn: ask the server for what to say, and speak it as it is written.
   *
   * The two halves run at once on purpose. Waiting for the whole turn before
   * opening the voice would put a model's worth of latency in front of every
   * sentence; forwarding each delta into the speech socket as it lands means the
   * tutor starts talking about a second after the learner stops.
   */
  const runTurn = useCallback(
    async (kind: TurnKind, options: { question?: string; index?: number } = {}) => {
      const output = outputRef.current;
      const runId = runIdRef.current;

      if (!output) {
        return;
      }

      /*
       * Only the opening can run without the running order. Every other kind waits
       * for it here — by which point the greeting has been playing for the better
       * part of a minute and it has long since arrived, so this normally resolves
       * instantly.
       */
      const currentPlan =
        kind === "opening" ? null : (planRef.current ?? (await planPromiseRef.current) ?? null);

      if (kind !== "opening" && !currentPlan) {
        setError(t("tutor.error.startFailed"));
        setPhaseNow("paused");

        return;
      }

      if (runId !== runIdRef.current) {
        return;
      }

      const index = options.index ?? topicIndexRef.current;
      const controller = new AbortController();
      floorTokenRef.current += 1;
      const floorToken = floorTokenRef.current;
      turnAbortRef.current = controller;
      setPhaseNow("thinking");
      inputRef.current?.resetUtterance();

      let turn: ReturnType<TutorSpeechOutput["speak"]> | null = null;
      const buffer = new SpeechTextBuffer();

      try {
        /*
         * One retry, and only for the request itself.
         *
         * A phone that changes cell, comes out of a pocket or wakes from a locked screen
         * drops exactly one request, and a walkthrough should not end for that — the
         * learner gets a red box and has to press Continue for something that had already
         * fixed itself. Retried only here, before a word has been spoken: asking again
         * once the voice has started would say the same sentence twice.
         */
        let response: Response | null = null;

        for (let attempt = 0; response === null; attempt += 1) {
          try {
            response = await fetch(`/api/lectures/${lectureId}/tutor/turn`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                kind,
                topicIndex: index,
                plan: currentPlan,
                spokenSoFar: kind === "teach" || kind === "resume" ? spokenSoFarRef.current : "",
                question: options.question ?? null,
                history: historyRef.current.slice(-12),
              }),
            });
          } catch (caught) {
            if (attempt >= 1 || controller.signal.aborted) {
              throw caught;
            }

            await new Promise((settle) => {
              window.setTimeout(settle, TURN_RETRY_DELAY_MS);
            });
          }
        }

        if (!response.ok || !response.headers.get("Content-Type")?.includes("text/event-stream")) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;

          throw new Error(payload?.error ?? t("tutor.error.turnFailed"));
        }

        /*
         * The keys are minted for a slice of time and this conversation may have outlived
         * it. Renewing is a no-op until the expiry is close, and it happens between turns
         * where a new recognizer socket costs a handshake nobody hears.
         */
        if (!(await renewCredentialsRef.current())) {
          return;
        }

        /*
         * Checked here rather than at connect time: Soniox closes an idle stream, and the
         * turn that has just been written is the first thing with anything to say.
         */
        await output.ensureOpen();

        turn = output.speak({ speed: speedRef.current });
        setPhaseNow("speaking");

        let spokeAnything = false;
        const result = await readChatStream<{
          speech: string;
          handBack: boolean;
          awaitingExplanation: boolean;
        }>(
          response,
          (text) => {
            const ready = buffer.push(text);

            if (ready) {
              spokeAnything = true;
              turn?.push(ready);
            }
          },
          t,
        );

        if (runId !== runIdRef.current || floorToken !== floorTokenRef.current) {
          return;
        }

        const tail = buffer.flush();

        if (tail) {
          spokeAnything = true;
          turn.push(tail);
        }

        /*
         * A turn that never streamed still has to be said.
         *
         * `speakTutorTurn` falls back to a plain, unstreamed call whenever the streaming
         * attempt fails, and that answer arrives whole in the closing event rather than as
         * deltas. Without this the sphere sat there in silence while the walkthrough
         * advanced through every topic — which is exactly what a deployed build did.
         */
        if (!spokeAnything && result?.speech) {
          turn.push(result.speech);
        }

        turn.end();

        const spoken = stripAudioTags(result?.speech ?? "");

        if (kind === "teach" || kind === "resume" || kind === "opening") {
          /*
           * The opening counts towards the first topic. It was generated without the
           * running order and taught whatever the material said came first, so the
           * teach turn that follows must continue from it rather than start over —
           * which is exactly what `spokenSoFar` is for.
           */
          spokenSoFarRef.current = `${spokenSoFarRef.current} ${spoken}`.trim();
        }

        historyRef.current.push({ role: "tutor", content: spoken });

        await turn.finished;

        /*
         * The turn is over — but only a turn that still holds the floor gets to decide what
         * happens next. If the learner cut in, or the session was paused, skipped or ended
         * while this was speaking, that already chose the next move.
         */
        if (runId !== runIdRef.current || floorToken !== floorTokenRef.current) {
          return;
        }

        onTurnFinished(kind, index, result?.handBack ?? true, result?.awaitingExplanation ?? false);
      } catch (caught) {
        if (
          controller.signal.aborted ||
          runId !== runIdRef.current ||
          floorToken !== floorTokenRef.current
        ) {
          // The learner interrupted, or ended the session. Neither is a failure.
          return;
        }

        turn?.end();

        /*
         * A backgrounded page loses its sockets and its in-flight requests, and iOS does
         * that every time the screen locks. The learner did not see a failure — they saw
         * their phone lock — so this is the pause it already is, rather than a red box
         * waiting for them when they come back. It was the commonest way to be shown
         * "Load failed" over a screen that already said Paused.
         */
        if (document.visibilityState === "hidden") {
          pauseRef.current();

          return;
        }

        reportTutorFailure(caught, { lectureId, stage: "turn", phase: kind });
        setError(
          isTransportFailure(caught)
            ? t("tutor.error.connection")
            : caught instanceof Error
              ? caught.message
              : t("tutor.error.turnFailed"),
        );
        setPhaseNow("paused");
      } finally {
        if (turnAbortRef.current === controller) {
          turnAbortRef.current = null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onTurnFinished is defined below and stable
    [lectureId, setPhaseNow, t],
  );

  const runTurnRef = useRef(runTurn);
  runTurnRef.current = runTurn;

  /**
   * What happens when the tutor finishes speaking of its own accord.
   *
   * A teaching turn moves on to the next topic. An answer either hands the floor
   * back — the learner only said "got it" — or waits, because the tutor just
   * asked whether that landed and talking over the reply would make the question
   * a pretence. Either way the wait has a floor under it: silence resumes the
   * walkthrough rather than leaving a sphere pulsing at nobody.
   */
  function onTurnFinished(
    kind: TurnKind,
    index: number,
    handBack: boolean,
    awaitingExplanation: boolean,
  ) {
    if (kind === "closing") {
      setPhaseNow("finished");
      /* The walkthrough is over; hand the rest of the slice back straight away. */
      settleGrant();
      /* And the recognizer with it — there is nothing left to interrupt. */
      inputRef.current?.stopListening();

      return;
    }

    /*
     * The pivot of the method: the tutor has asked them to say the idea back, so it stops
     * and waits. Silence is not refusal — finding your own words takes a moment — so the
     * timeout is long, and running out of it moves the walkthrough on rather than pressing.
     */
    if (awaitingExplanation && kind !== "answer") {
      awaitingExplanationRef.current = true;
      setPhaseNow("listening");
      clearTimer(followUpTimerRef);
      followUpTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current !== "listening") {
          return;
        }

        awaitingExplanationRef.current = false;
        advanceToNextTopic(index);
      }, EXPLAIN_BACK_SILENCE_MS);

      return;
    }

    if (kind === "answer" || kind === "feedback") {
      setPhaseNow("listening");
      clearTimer(followUpTimerRef);

      const wasExplainBack = kind === "feedback";
      awaitingExplanationRef.current = false;

      followUpTimerRef.current = window.setTimeout(
        () => {
          if (phaseRef.current !== "listening") {
            return;
          }

          /*
           * After they have explained something back, the topic is done — carrying on
           * with it would be teaching them what they have just proved they know. An
           * ordinary question resumes the topic it interrupted.
           */
          if (wasExplainBack && handBack) {
            advanceToNextTopic(topicIndexRef.current);

            return;
          }

          void runTurnRef.current("resume");
        },
        handBack ? HAND_BACK_GRACE_MS : FOLLOW_UP_SILENCE_MS,
      );

      return;
    }

    /*
     * The opening opened the first topic rather than finishing it — it was written
     * without the running order — so it hands over to a teach turn on the same
     * topic, which continues from what it already said. Everything else moves on.
     */
    if (kind === "opening") {
      void runTurnRef.current("teach", { index: 0 });

      return;
    }

    advanceToNextTopic(index);
  }

  function advanceToNextTopic(index: number) {
    const nextIndex = index + 1;
    const total = planRef.current?.topics.length ?? 0;

    spokenSoFarRef.current = "";
    awaitingExplanationRef.current = false;
    topicIndexRef.current = nextIndex;

    if (nextIndex >= total) {
      void runTurnRef.current("closing", { index: Math.max(0, total - 1) });

      return;
    }

    void runTurnRef.current("teach", { index: nextIndex });
  }

  /**
   * The learner has taken the floor. Stop, and record only what they heard.
   */
  const commitInterruption = useCallback(() => {
    floorTokenRef.current += 1;
    clearTimer(interruptionTimerRef);
    clearTimer(followUpTimerRef);
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;

    const stopped = outputRef.current?.stop();

    if (stopped?.spokenText) {
      /*
       * The record of what the tutor said is rewritten to what was actually
       * heard. Anything generated past the interruption never reached the room,
       * so treating it as covered would silently skip material.
       */
      const lastTurn = historyRef.current[historyRef.current.length - 1];

      if (lastTurn?.role === "tutor") {
        lastTurn.content = stopped.spokenText;
      }
    }

    outputRef.current?.unduck();
    setPhaseNow("listening");

    /*
     * Handing the floor over is not the same as being asked a question, and sometimes
     * nothing follows: a cough clears the energy detector, the recognizer finds no words
     * in it, and the session would otherwise sit in silence forever waiting for a
     * question that was never coming. Picking the topic back up is the right recovery —
     * the learner can always cut in again.
     */
    clearTimer(followUpTimerRef);
    followUpTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current === "listening") {
        void runTurnRef.current("resume");
      }
    }, FOLLOW_UP_SILENCE_MS);
  }, [setPhaseNow]);

  const startSession = useCallback(async () => {
    /*
     * First, before the network is touched: a voice being auditioned stops the moment
     * Start is pressed. Starting takes a second or two, and a sample still playing
     * underneath the loading state sounds like the tutor has already begun — in the
     * wrong voice, saying something that has nothing to do with the note.
     */
    stopPreview();

    /* A new session gets a clean slate: last session's failures are not this one's. */
    resetTutorFailureReports();
    setError(null);
    setCanListen(true);
    setHeard(null);
    historyRef.current = [];
    spokenSoFarRef.current = "";
    awaitingExplanationRef.current = false;
    topicIndexRef.current = 0;
    setPhaseNow("preparing");

    runIdRef.current += 1;
    const runId = runIdRef.current;
    planRef.current = null;

    /*
     * The running order is fetched here and never awaited here. It is the slowest
     * part of starting by a wide margin, and nothing before the first word needs
     * it: the greeting is written from the note, and the first turn that does need
     * a plan waits on this promise long after it has resolved. A failure is
     * swallowed to null rather than thrown, because it must not reject into an
     * unhandled rejection while the tutor is happily talking; the turn that awaits
     * it reports the failure then.
     */
    planPromiseRef.current = fetch(`/api/lectures/${lectureId}/tutor/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { plan?: TutorPlan; error?: string }
          | null;

        if (!response.ok || !payload?.plan) {
          throw new Error(payload?.error ?? t("tutor.error.startFailed"));
        }

        if (runId === runIdRef.current) {
          planRef.current = payload.plan;
        }

        return payload.plan;
      })
      .catch((caught: unknown) => {
        console.error("[tutor] the running order could not be written", caught);

        return null;
      });

    let session: TutorSessionResponse;

    try {
      const response = await fetch(`/api/lectures/${lectureId}/tutor/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (TutorSessionResponse & { error?: string })
        | null;

      if (response.status === 402) {
        /*
         * Not an error: they are out of time. Which wall they hit decides what is offered —
         * a plan if they have never had one, an hour if today's allowance is simply spent.
         */
        const refusal = payload as unknown as { code?: TutorBlock; usage?: TutorUsage } | null;

        if (refusal?.usage) {
          setUsage(refusal.usage);
        }

        setBlocked(refusal?.code ?? "tutor_credits_needed");
        setPhaseNow("idle");

        return;
      }

      if (!response.ok || !payload?.realtime) {
        throw new Error(payload?.error ?? t("tutor.error.startFailed"));
      }

      session = payload;
      grantIdRef.current = payload.grantId;
      spentSecondsRef.current = 0;
      setBlocked(null);
      setUsage(payload.usage);
      adoptCredentialsRef.current(payload);
    } catch (caught) {
      if (runId !== runIdRef.current) {
        return;
      }

      reportTutorFailure(caught, { lectureId, stage: "session" });
      setError(
        isTransportFailure(caught)
          ? t("tutor.error.connection")
          : caught instanceof Error
            ? caught.message
            : t("tutor.error.startFailed"),
      );
      setPhaseNow("idle");

      return;
    }

    if (runId !== runIdRef.current) {
      return;
    }

    const output = new TutorSpeechOutput(
      {
        url: session.realtime.tts.url,
        apiKey: session.realtime.tts.apiKey,
        model: session.realtime.tts.model,
        voice: session.realtime.tts.voice,
        language: session.language,
      },
      {
        onError: (speechError: SpeechOutputError) => {
          reportTutorFailure(speechError, {
            lectureId,
            stage: "speech",
            code: speechError.code,
            phase: phaseRef.current,
          });
          setError(
            /*
             * Soniox caps how many voices an account can have going at once, and
             * the fourth listener gets a 429 rather than a wait. That is a
             * "come back in a minute", not a fault of theirs.
             */
            speechError.code === "429" || /concurren/i.test(speechError.message)
              ? t("tutor.error.busy")
              : t("tutor.error.connection"),
          );
          setPhaseNow("paused");
        },
      },
    );

    const input = new TutorSpeechInput(
      {
        url: session.realtime.stt.url,
        apiKey: session.realtime.stt.apiKey,
        model: session.realtime.stt.model,
        /* The note's language leads; the learner may still ask in another one. */
        languages: [session.language],
      },
      {
        onVoiceStart: () => {
          if (phaseRef.current !== "speaking") {
            return;
          }

          /*
           * The first half of barge-in: quiet, immediately, on nothing but the
           * shape of the sound. The recognizer has until the grace period is out
           * to say this was a person; if it does not, the voice comes back up
           * and the learner never knows it happened.
           */
          heardWhileDuckedRef.current = false;
          outputRef.current?.duck();
          clearTimer(interruptionTimerRef);
          interruptionTimerRef.current = window.setTimeout(() => {
            if (phaseRef.current === "speaking") {
              outputRef.current?.unduck();
            }
          }, INTERRUPTION_GRACE_MS);
        },
        onVoiceEnd: () => {
          /*
           * Whatever that was, it is over and the recognizer found no words in
           * it — so it was not a person, and there is nothing left to wait for.
           * Coming back up here rather than at the end of the grace period is
           * the difference between the tutor pausing for a beat and the tutor
           * appearing to stop every time somebody shifts in their chair.
           */
          if (phaseRef.current !== "speaking" || heardWhileDuckedRef.current) {
            return;
          }

          clearTimer(interruptionTimerRef);
          outputRef.current?.unduck();
        },
        onPartial: (text) => {
          showHeard(text, false);

          if (phaseRef.current !== "speaking") {
            return;
          }

          const lastTurn = historyRef.current[historyRef.current.length - 1];
          const tutorTail = lastTurn?.role === "tutor" ? lastTurn.content : spokenSoFarRef.current;

          if (isEchoOfTutor(text, tutorTail)) {
            /*
             * The tutor's own voice, back through the room. Carry on talking,
             * and come back up now: waiting out the grace period would mean the
             * tutor whispering at its own reflection for over a second.
             */
            clearTimer(interruptionTimerRef);
            outputRef.current?.unduck();

            return;
          }

          // Somebody is saying words. The voice stays down until they are judged.
          heardWhileDuckedRef.current = true;

          if (isSubstantialInterruption(text)) {
            commitInterruption();
          }
        },
        onUtterance: (text) => {

          if (phaseRef.current === "paused" || phaseRef.current === "finished") {
            return;
          }

          const lastTurn = historyRef.current[historyRef.current.length - 1];
          const tutorTail = lastTurn?.role === "tutor" ? lastTurn.content : "";

          if (isEchoOfTutor(text, tutorTail) || !isSubstantialInterruption(text)) {
            return;
          }

          /*
           * "Thinking" counts as the tutor holding the floor. Without this, speaking during
           * the gap before a turn starts left its request running into a stream nobody was
           * listening to, and paid for a turn that was never heard.
           */
          if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
            commitInterruption();
          }

          clearTimer(followUpTimerRef);
          historyRef.current.push({ role: "learner", content: text });
          showHeard(text, true);

          /*
           * If the tutor had asked them to explain the idea back, this is that attempt —
           * it needs marking, not answering. Anything else is a question.
           */
          const kind = awaitingExplanationRef.current ? "feedback" : "answer";
          awaitingExplanationRef.current = false;
          void runTurnRef.current(kind, { question: text });
        },
        onError: (inputError: SpeechInputError) => {
          reportTutorFailure(inputError, {
            lectureId,
            stage: "recognizer",
            code: inputError.reason,
            phase: phaseRef.current,
          });

          if (inputError.reason === "busy") {
            /*
             * Every realtime stream in the organisation is taken. The walkthrough still
             * works — this costs only the ability to cut in by speaking — so it is said
             * as a wait rather than as a breakage, and nothing is paused.
             */
            setCanListen(false);
            setError(t("tutor.error.listeningBusy"));
          } else if (inputError.reason === "connection") {
            setError(t("tutor.error.connection"));
          }
        },
      },
    );

    try {
      await output.connect();
      await output.resumeAudio();
    } catch (caught) {
      output.close();
      input.close();

      /*
       * The slice goes straight back. It was reserved before the keys were minted, so a
       * session that never got a voice at all would otherwise cost the learner half an
       * hour of their allowance for nothing — and the likeliest reason to be here is that
       * every speech stream in the organisation was taken, which is not their doing.
       */
      settleGrant();

      if (runId !== runIdRef.current) {
        return;
      }

      reportTutorFailure(caught, { lectureId, stage: "session", phase: "connect" });
      setError(
        caught instanceof SpeechOutputError &&
          (caught.code === "429" || /concurren/i.test(caught.message))
          ? t("tutor.error.busy")
          : t("tutor.error.connection"),
      );
      setPhaseNow("idle");

      return;
    }

    /*
     * The microphone is what makes this a conversation, but it is not what makes it useful.
     * Somebody who declines the permission — or is on a device with no input at all — still
     * gets the whole walkthrough, explained, with the controls to pause and move through it;
     * they just cannot cut in by speaking. Refusing to start at all would be throwing away
     * the nine tenths of the feature that still work.
     */
    let listening = true;

    try {
      await input.start();
    } catch (caught) {
      listening = false;
      input.close();

      setError(
        caught instanceof SpeechInputError && caught.reason === "denied"
          ? t("tutor.error.micDenied")
          : t("tutor.error.micUnavailable"),
      );
    }

    if (runId !== runIdRef.current) {
      output.close();
      input.close();

      return;
    }

    outputRef.current = output;
    inputRef.current = listening ? input : null;
    setCanListen(listening);
    setMuted(!listening);

    void runTurnRef.current("opening", { index: 0 });
  }, [commitInterruption, lectureId, setPhaseNow, settleGrant, showHeard, stopPreview, t, voice]);

  function pause() {
    floorTokenRef.current += 1;
    clearTimer(interruptionTimerRef);
    clearTimer(followUpTimerRef);
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    outputRef.current?.stop();
    /*
     * The recognizer goes back to the pool. A paused session cannot be interrupted, so
     * holding one of the organisation's ten realtime streams through it is taking a slot
     * somebody else could be talking on — and on a phone this runs every time the learner
     * switches app or locks the screen, which is most of the pauses there are.
     *
     * It also removes a whole class of phantom error. iOS suspends a backgrounded page
     * and kills its sockets, and a recognizer that died that way came back as "the
     * connection to the voice service dropped" over a screen that said Paused. Closing it
     * on purpose leaves nothing to be surprised by.
     */
    inputRef.current?.stopListening();
    setPhaseNow("paused");
  }

  pauseRef.current = pause;

  function resume() {
    if (!planRef.current) {
      return;
    }

    setError(null);
    void restoreListening();
    void runTurnRef.current(spokenSoFarRef.current ? "resume" : "teach");
  }

  function end() {
    settleGrant();
    teardown();
    planRef.current = null;
    setPhaseNow("idle");
  }

  /**
   * Plays a sentence in one voice so the learner can hear it before committing to
   * twenty minutes of it.
   *
   * The credentials are fetched once and kept: a `tts_rt` key is not tied to a voice,
   * so one key previews all of them, and one socket stays open across taps. Picking a
   * voice is a browsing activity — people try four or five — and a round trip per tap
   * would make it feel broken.
   */
  /**
   * Credentials and an open speech socket, ready before anybody asks for them.
   *
   * Resolves to null rather than throwing when it is called speculatively — a warm-up
   * that fails must not surface an error on a screen where nothing has happened yet.
   * The tap path calls the same function and reports failures itself.
   */
  const openPreviewChannel = useCallback(
    async (forVoice: NoteTtsVoice, quiet: boolean) => {
      /*
       * Whose audition this is, read before anything is awaited. Credentials and a cold
       * socket together take about a second and a half, and anything that takes the room
       * over in the meantime — another voice tapped, or Start pressed — moves the token
       * on. Without this the socket that lands afterwards is stored anyway, and a preview
       * nobody can hear holds one of the three streams the account gets for the rest of
       * the session.
       */
      const token = previewTokenRef.current;

      try {
        if (!previewCredentialsRef.current) {
          const response = await fetch(`/api/lectures/${lectureId}/tutor/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ voice: forVoice }),
          });
          const payload = (await response.json().catch(() => null)) as
            | (TutorSessionResponse & { error?: string })
            | null;

          if (!response.ok || !payload?.realtime) {
            throw new Error(payload?.error ?? t("tutor.error.startFailed"));
          }

          previewCredentialsRef.current = payload;
        }

        /*
         * A warmed socket has usually been sitting idle since the screen opened, and an
         * idle socket can be closed from the other end. Reopening on demand is the whole
         * repair: the previous symptom was a voice tap that answered "the connection to
         * the voice service dropped" for a connection nobody had noticed dying.
         */
        if (previewRef.current && !previewRef.current.isOpen) {
          previewRef.current.close();
          previewRef.current = null;
        }

        if (!previewRef.current) {
          const credentials = previewCredentialsRef.current;
          const output = new TutorSpeechOutput(
            {
              url: credentials.realtime.tts.url,
              apiKey: credentials.realtime.tts.apiKey,
              model: credentials.realtime.tts.model,
              voice: forVoice,
              language: credentials.language,
            },
            {
              /* Dropped while idle: forget it, and the next tap opens a fresh one. */
              onClose: () => {
                /*
                 * Soniox closes an idle stream, so this fires whenever somebody stops
                 * auditioning voices for a moment. Closing *this* one rather than whatever
                 * the ref happens to hold: dropping the reference is not enough, since the
                 * audio context behind it would leak and browsers only allow a handful —
                 * but closing the ref blindly would tear down a newer preview instead.
                 */
                output.close();

                if (previewRef.current === output) {
                  previewRef.current = null;
                }
              },
            },
          );

          await output.connect();

          if (token !== previewTokenRef.current) {
            output.close();

            return null;
          }

          previewRef.current = output;
        }

        return previewRef.current;
      } catch (caught) {
        if (!quiet) {
          throw caught;
        }

        return null;
      }
    },
    [lectureId, t],
  );

  /*
   * Warm the preview channel as soon as the screen is opened.
   *
   * A first tap used to pay for the credentials, the socket handshake and the synthesis
   * all at once — around a second and a half before anything was heard, which reads as a
   * button that did not work. Doing the first two up front leaves the tap costing only
   * the voice, about half a second. It is one short-lived key and one idle socket.
   */
  useEffect(() => {
    if (!isReady) {
      return;
    }

    void openPreviewChannel(readStoredVoice(), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- warmed once, for the life of the screen
  }, [isReady]);

  async function previewVoiceSample(next: NoteTtsVoice) {
    setVoice(next);

    /*
     * Two voices must never talk over each other. Stopping the socket handles the one
     * that is already playing; the token handles the subtler case — a tap whose
     * credentials or connection are still in flight, which would otherwise start
     * speaking after the voice tapped later had already begun.
     */
    previewTokenRef.current += 1;
    const token = previewTokenRef.current;
    previewRef.current?.stop();

    try {
      window.localStorage.setItem(NOTE_TTS_VOICE_STORAGE_KEY, next);
    } catch {
      // Private browsing refuses storage. The choice still holds for this session.
    }

    if (isRunning) {
      return;
    }

    setError(null);
    setPreviewVoice(next);

    try {
      const output = await openPreviewChannel(next, false);

      if (!output || token !== previewTokenRef.current) {
        return;
      }

      /* The tap is the gesture that is allowed to start the audio clock. */
      await output.resumeAudio();

      if (token !== previewTokenRef.current) {
        return;
      }

      const turn = output.speak({ voice: next, speed: speedRef.current });
      /* In the note's language — a voice previewed in the wrong one tells you nothing. */
      turn.push(voiceSampleText(previewCredentialsRef.current?.language ?? "en"));
      turn.end();
      await turn.finished;
    } catch (caught) {
      if (token === previewTokenRef.current) {
        /*
         * Soniox caps how many voices the account can have going at once, and the one
         * over the line gets a 429 rather than a wait. "Try again in a moment" is the
         * truth there; "the connection dropped" is not, and it reads like a fault.
         */
        const busy =
          caught instanceof SpeechOutputError &&
          (caught.code === "429" || /concurren/i.test(caught.message));

        setError(t(busy ? "tutor.error.busy" : "tutor.error.connection"));
      }
    } finally {
      if (token === previewTokenRef.current) {
        setPreviewVoice(null);
      }
    }
  }

  /** Opens Stripe for an hour of tutor time. The seconds are credited by the webhook. */
  async function buyCredits() {
    setBuyingCredits(true);

    try {
      const response = await fetch("/api/billing/tutor-credits", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? t("tutor.error.creditsFailed"));
      }

      window.location.href = payload.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tutor.error.creditsFailed"));
      setBuyingCredits(false);
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    inputRef.current?.setMuted(next);

    /*
     * Muted means "do not listen to me", so the stream goes back to the pool the same way
     * it does on a pause. Unmuting asks for one again, which is a handshake rather than a
     * permission prompt, because the microphone itself never went anywhere.
     */
    if (next) {
      inputRef.current?.stopListening();
    } else {
      void restoreListening();
    }
  }

  const isRunning = phase !== "idle";
  /*
   * Starting is its own state, not a running walkthrough with a different caption.
   * Nothing is playing yet, so the transport, the topic and the invitation to
   * interrupt all describe something that does not exist — and a sphere that looks
   * exactly as it does when the tutor is talking reads as a tutor who has stopped.
   */
  const isPreparing = phase === "preparing";
  /* Idle has no status of its own — the start screen's own line says what this is. */
  const statusKey =
    phase === "preparing"
      ? "tutor.state.preparing"
      : phase === "thinking"
        ? "tutor.state.thinking"
        : phase === "speaking"
          ? "tutor.state.speaking"
          : phase === "listening"
            ? "tutor.state.listening"
            : phase === "paused"
              ? "tutor.state.paused"
              : phase === "finished"
                ? "tutor.state.finished"
                : null;

  if (!isReady) {
    return <p className="ios-info lecture-empty-message">{t("api.tutorNotReady")}</p>;
  }

  /*
   * The bar shows what is *left* rather than what is gone, because that is the question
   * somebody glancing at it is asking. Read-aloud's classes, so the two meters are the
   * same object in two places rather than two things that look nearly alike.
   */
  /*
   * The daily bar measures the *daily* allowance, which is not what `remainingSeconds`
   * counts — that includes topped-up time, so a day nearly spent with an hour in the bank
   * showed a full bar. Credits have their own bar precisely because they are not this.
   */
  const dailyRemainingSeconds = usage ? Math.max(usage.limitSeconds - usage.usedSeconds, 0) : 0;
  const remainingPercent = usage
    ? usage.hasUnlimitedUsage
      ? 100
      : usage.limitSeconds > 0
        ? Math.min(100, Math.max(0, Math.round((dailyRemainingSeconds / usage.limitSeconds) * 100)))
        : 0
    : 100;
  /* Red only when nothing is left anywhere — a spent day with credits in hand is fine. */
  const isOutOfTime = Boolean(usage && !usage.hasUnlimitedUsage && usage.remainingSeconds <= 0);
  /*
   * A share, never a number of minutes.
   *
   * How long somebody has left is a fact about the plan, and putting it on the bar invites
   * the arithmetic — is half an hour a lot? is a minute mean? — instead of the glance it is
   * there for. Read-aloud shows a percentage for the same reason, and this is the same meter.
   */
  const barLabel = !usage ? "" : usage.hasUnlimitedUsage ? "∞" : `${remainingPercent}%`;
  /*
   * Bought time, measured against the hours it was bought in. `remaining` alone has no
   * scale — 20 minutes could be a lot or nothing — so the denominator is the whole hours
   * being held, which is exactly what was paid for.
   */
  const creditHours = usage ? Math.max(1, Math.ceil(usage.creditSeconds / 3600)) : 1;
  const creditPercent = usage
    ? Math.min(100, Math.max(0, Math.round((usage.creditSeconds / (creditHours * 3600)) * 100)))
    : 0;
  const creditLabel = usage ? `${Math.floor(usage.creditSeconds / 60)} min` : "";

  const triggerLabel = !usage
    ? ""
    : usage.hasUnlimitedUsage
      ? t("tutor.usage.unlimited")
      : `${remainingPercent}%`;

  const usageContent = usage ? (
    <>
      {/* `data-drag-handle` is what lets a drag start here: useSheet ignores pointers that
          land on a button unless the button is the grabber. */}
      <button
        type="button"
        data-drag-handle="true"
        className="mobile-sheet-drag-handle note-read-usage-drag-handle"
        aria-label={t("folders.dragToClose")}
      />
      <div className="memo-tutor-usage-heading">{t("tutor.usage.title")}</div>
      <UsageBar percent={remainingPercent} label={barLabel} ariaLabel={t("tutor.usage.title")} />
      <div className="note-read-usage-reset">
        {usage.hasUnlimitedUsage
          ? t("tutor.usage.unlimited")
          : usage.hasPaidAccess
            ? t("tutor.usage.resetsAt")
            : t("tutor.usage.freeHint")}
      </div>

      {/*
        * Topped-up time gets its own bar, stacked straight under the daily one so the two
        * read as a pair. They are different things — the daily allowance refills at midnight
        * whatever you do, and this only ever goes down — so folding them into one bar would
        * give it two unrelated reasons to move. Different colour for the same reason, and
        * scaled to the whole hours held, because an hour is what a purchase is.
        */}
      {usage.creditSeconds > 0 ? (
        <>
          <div className="memo-tutor-usage-subheading">{t("tutor.usage.creditsTitle")}</div>
          <UsageBar
            percent={creditPercent}
            label={creditLabel}
            ariaLabel={t("tutor.usage.creditsTitle")}
            className="memo-tutor-credit-bar"
          />
          <div className="note-read-usage-reset">{t("tutor.usage.creditsNote")}</div>
        </>
      ) : null}

      <div className="note-read-settings-divider" />
      <div className="note-read-setting-group">
        <span className="note-read-setting-label">{t("tutor.speed")}</span>
        <div className="note-read-rate-options" role="group" aria-label={t("tutor.speed")}>
          {TUTOR_SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              className={`note-read-rate-option ${speed === option ? "active" : ""}`.trim()}
              onClick={() => chooseSpeed(option)}
            >
              {option}x
            </button>
          ))}
        </div>
      </div>


      {/*
        * The offer lives in the same sheet as the number that explains why it is being
        * made. Shown once there is nothing left, whether they came here by running out
        * mid-session or by opening the meter to see how much was gone.
        */}
      {isOutOfTime || blocked ? (
        <>
          <div className="note-read-settings-divider" />
          <div className="memo-tutor-offer">
            <h2>
              {t(
                usage.hasPaidAccess
                  ? "tutor.paywall.creditsTitle"
                  : "tutor.paywall.trialTitle",
              )}
            </h2>
            <p>
              {t(
                usage.hasPaidAccess ? "tutor.paywall.creditsBody" : "tutor.paywall.trialBody",
              )}
            </p>
            {usage.hasPaidAccess ? (
              <button
                type="button"
                className="memo-tutor-start"
                disabled={buyingCredits}
                onClick={() => void buyCredits()}
              >
                {buyingCredits ? t("tutor.paywall.creditsPending") : t("tutor.paywall.creditsCta")}
              </button>
            ) : (
              <a className="memo-tutor-start" href="/app/settings">
                {t("tutor.paywall.trialCta")}
              </a>
            )}
          </div>
        </>
      ) : null}
    </>
  ) : null;

  /*
   * The pill that opens it, portalled into the note screen's dock — the same floating bar
   * the listen pill uses on the note itself. Keeping it there rather than in the column
   * means it does not move as the screen changes between idle, preparing and speaking, and
   * it is reachable with a thumb while the tutor is talking.
   */
  /*
   * The pill is part of the screen rather than something that arrives with the numbers, so it
   * is drawn the moment the tutor is opened and fills in when the allowance lands. Waiting for
   * the fetch made it pop into the dock a second late, which reads as a layout bug.
   */
  const usagePlaceholder = dockSlot ? (
    <span className="memo-tutor-usage-menu">
      <span className="memo-tutor-usage-trigger is-loading" aria-hidden="true">
        <Msym name="schedule" size="1.05rem" fill={false} weight={500} />
        <span className="memo-tutor-usage-pending" />
      </span>
    </span>
  ) : null;

  const usageMeter =
    usage && dockSlot ? (
      <>
        <details
          ref={usageMenuRef}
          className={`memo-tutor-usage-menu ${isOutOfTime ? "limit" : ""}`.trim()}
          onToggle={(event) => setUsageOpen(event.currentTarget.open)}
        >
          <summary className="memo-tutor-usage-trigger">
            <Msym name="schedule" size="1.05rem" fill={false} weight={500} />
            <span>{triggerLabel}</span>
          </summary>
          <div className="note-read-usage-popover note-read-usage-inline-popover">
            {usageContent}
          </div>
        </details>

        {isUsageOpen ? (
          <MemoPortal>
            <button
              type="button"
              className={sheetClass("note-read-usage-mobile-backdrop", usageSheet.closing)}
              onClick={() => usageSheet.dismiss()}
              aria-label={t("common.close")}
            />
            <div
              className={sheetClass(
                "note-read-usage-popover note-read-usage-mobile-sheet",
                usageSheet.closing,
              )}
              role="dialog"
              aria-modal="true"
              aria-label={t("tutor.usage.title")}
              {...usageSheet.dragProps}
            >
              {usageContent}
            </div>
          </MemoPortal>
        ) : null}
      </>
    ) : null;

  return (
    <>
      {dockSlot ? createPortal(usageMeter ?? usagePlaceholder, dockSlot) : null}
      <div
        className={`memo-tutor phase-${phase}`}
      style={{ "--tutor-hue": voiceHue(previewVoice ?? voice) } as CSSProperties}
    >
      {/*
        * The sphere. Its scale and glow ride the live audio level, so it breathes
        * with whichever voice is in the room rather than animating on a timer —
        * a loop that runs while nothing is being said is the thing that makes a
        * voice UI look fake.
        */}
      <div className="memo-tutor-orb" ref={orbRef} aria-hidden="true">
        <span className="memo-tutor-orb-glow" />
        <span className="memo-tutor-orb-body" />
        <span className="memo-tutor-orb-ring" />
        <span className="memo-tutor-orb-ring second" />
      </div>

      {statusKey ? (
        <p className="memo-tutor-status" role="status">
          {t(statusKey)}
        </p>
      ) : null}

      {isPreparing ? <p className="memo-tutor-hint">{t("tutor.state.preparingHint")}</p> : null}

      {error ? <p className="memo-inline-error memo-tutor-error">{error}</p> : null}

      {/* One line, and only while there is something to show. */}
      {heard && isRunning ? (
        <p ref={heardRef} className={`memo-tutor-heard ${heard.settled ? "" : "draft"}`.trim()}>
          {heard.text}
        </p>
      ) : null}

      {!isRunning ? (
        <>
          {/* Pick a voice, hear it, then start. Tapping one plays it. */}
          <div
            className="memo-tutor-voices"
            ref={voiceRowRef}
            role="radiogroup"
            aria-label={t("tutor.voice.label")}
          >
            {NOTE_TTS_VOICES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={voice === option}
                className={`memo-tutor-voice ${voice === option ? "active" : ""} ${
                  previewVoice === option ? "playing" : ""
                }`.trim()}
                onClick={() => void previewVoiceSample(option)}
              >
                <Msym
                  name={previewVoice === option ? "graphic_eq" : "play_arrow"}
                  size="1rem"
                  fill={false}
                  weight={500}
                />
                <span>{option}</span>
              </button>
            ))}
          </div>

          <button type="button" className="memo-tutor-start" onClick={() => void startSession()}>
            <Msym name="graphic_eq" size="1.2rem" fill={false} weight={500} />
            <span>{t("tutor.start")}</span>
          </button>
        </>
      ) : isPreparing ? (
        /* One way out and nothing else: there is nothing yet to pause, skip or mute. */
        <div className="memo-tutor-controls">
          <button type="button" className="memo-tutor-control" onClick={end}>
            <Msym name="close" size="1.3rem" fill={false} weight={500} />
            <span>{t("common.cancel")}</span>
          </button>
        </div>
      ) : (
        <>
          {canListen && muted ? <p className="memo-tutor-hint">{t("tutor.hint.muted")}</p> : null}

          <div className="memo-tutor-controls">
            <button
              type="button"
              className={`memo-tutor-control ${muted ? "off" : ""}`.trim()}
              onClick={toggleMute}
              aria-pressed={muted}
              disabled={!canListen}
              aria-label={t(muted ? "tutor.unmute" : "tutor.mute")}
            >
              <Msym name={muted ? "mic_off" : "mic"} size="1.3rem" fill={false} weight={500} />
            </button>

            {phase === "paused" || phase === "finished" ? (
              <button
                type="button"
                className="memo-tutor-control primary"
                onClick={phase === "finished" ? () => void startSession() : resume}
              >
                <Msym
                  name={phase === "finished" ? "restart_alt" : "play_arrow"}
                  size="1.35rem"
                  fill={false}
                  weight={500}
                />
                <span>{t(phase === "finished" ? "tutor.restart" : "tutor.resume")}</span>
              </button>
            ) : (
              <button type="button" className="memo-tutor-control primary" onClick={pause}>
                <Msym name="pause" size="1.35rem" fill={false} weight={500} />
                <span>{t("tutor.pause")}</span>
              </button>
            )}

            <button
              type="button"
              className="memo-tutor-control"
              onClick={end}
              aria-label={t("tutor.end")}
            >
              <Msym name="close" size="1.3rem" fill={false} weight={500} />
            </button>
          </div>
        </>
      )}
      </div>
    </>
  );
}
