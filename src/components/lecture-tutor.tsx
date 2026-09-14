"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { useT } from "@/components/i18n-provider";
import { VoiceUsageSheet, type VoiceUsage } from "@/components/voice-usage-sheet";
import { readChatStream } from "@/lib/chat-stream-client";
import { TUTOR_GRANT_KEY_GRACE_SECONDS } from "@/lib/tutor-allowance";
import {
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_VOICES,
  NOTE_TTS_VOICE_STORAGE_KEY,
  normalizeNoteTtsVoice,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";
import {
  judgeHeard,
  LevelEnvelope,
  SpeechTextBuffer,
  stripAudioTags,
} from "@/lib/tutor/turn-audio";
import {
  SpeechInputError,
  TutorSpeechInput,
} from "@/lib/tutor/speech-input";
import { clearsHeardLine, latestHeardSentence, showsHeardLine, type TutorPhase } from "@/lib/tutor/heard-line";
import { PreparedTutorReply, preparedReplyKey } from "@/lib/tutor/prepared-reply";
import { TutorClipPlayer } from "@/lib/tutor/clip-player";
import { reportTutorFailure, resetTutorFailureReports } from "@/lib/tutor/report";
import { SpeechOutputError, TutorSpeechOutput } from "@/lib/tutor/speech-output";
import { credentialsExpireAt, isFinalSlice, nextSliceDueAt } from "@/lib/tutor/slice";
import { appendSpokenSoFar } from "@/lib/tutor/spoken-so-far";
import { voiceHue } from "@/lib/tutor/voice-colors";
import { hasStaticVoiceSamples, voiceSampleClip } from "@/lib/tutor/voice-clips";

/**
 * The spoken walkthrough.
 *
 * A tutor talking a learner through their own lecture, out loud, that can be
 * interrupted mid-sentence the way a person can. The shape of the thing is a
 * loop of turns — the tutor takes one topic at a time — with two ways out of
 * every turn: it finishes, or the learner cuts in.
 *
 * Cutting in is the part everything else is arranged around, so it is worth
 * saying plainly how it works: the microphone is open the whole session, and
 * exactly one thing stops the tutor — the recognizer sending back a word.
 *
 * One word is enough, and nothing short of one will do. The room is not
 * consulted at all. An earlier version was: the microphone was watched locally
 * and the voice ducked within a tenth of a second of any sound shaped like a
 * voice, on the theory that the words could confirm it a moment later. It was
 * quicker and it was unusable, because no measurement of a sound can tell you
 * that a person is talking *to you* — so the lesson dipped for a door, a car, a
 * dog, a sibling in the next room, and the learner heard a tutor that flinched.
 * Waiting for the words costs a few hundred milliseconds of the tutor still
 * talking after somebody starts, which is what a person does anyway.
 *
 * Its own voice is not one of those words. What has actually left the speaker is
 * known to the sentence, so anything the microphone brings back that is entirely
 * made of it is dropped — and dropped from the recognizer's buffer, not merely
 * ignored, or it would be waiting on the front of the learner's next question.
 *
 * When an interruption does land, what the tutor had already *said* is recorded —
 * not what it had generated, which by then is usually a sentence or two further on.
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
 * How long before the Soniox keys expire the session quietly takes its next slice.
 *
 * The keys are minted for the slice of talking time the server reserved, and they are the
 * whole enforcement, so they really do stop working. Renewing on a margin rather than on
 * the expiry itself keeps the swap out of the middle of a turn and leaves room for the
 * round trip that fetches it. Without this the conversation ran into a wall at the half
 * hour: Soniox answers an expired key with a 401, which reached the learner as "the
 * connection to the voice service dropped" and paused the walkthrough.
 *
 * Only ever a margin on a slice long enough to have one. A slice shorter than this margin
 * is already due the moment it is adopted, which is why `nextSliceDueAt` decides the
 * moment instead of this constant alone — see the reasoning in `@/lib/tutor/slice`.
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

type TutorTopic = { title: string; points: string[] };
type TutorPlan = { subject: string; topics: TutorTopic[] };

/*
 * One shape, defined where the meter that reads it lives. Kept as an alias rather than a
 * second declaration because the two drifted the moment the allowance gained a field: a
 * structural copy typechecks until it does not.
 */
type TutorUsage = VoiceUsage;

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


export function LectureTutor({
  lectureId,
  isReady,
  language,
  headSlot,
  onOpenFlashcards,
}: {
  lectureId: string;
  isReady: boolean;
  /**
   * The language the material is written in, and so the one the tutor will speak.
   * Worked out the same way the server works it out, so that auditioning a voice
   * plays the language it is being auditioned for — see the call site.
   */
  language: string;
  /** The note's title row, which the usage pill is portalled into. */
  headSlot: HTMLElement | null;
  /**
   * The way to the cards, offered at the end of a walkthrough. Absent when the note has
   * none — an empty deck is a worse ending than no second button.
   */
  onOpenFlashcards?: () => void;
}) {
  const t = useT();

  const [phase, setPhase] = useState<TutorPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  /** False when the microphone was refused or is absent: the walkthrough runs, barge-in does not. */
  const [canListen, setCanListen] = useState(true);
  const [heard, setHeard] = useState<{ text: string; settled: boolean } | null>(null);
  const heardRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    // Keep the latest words visible when one sentence fills the caption window.
    if (heardRef.current) heardRef.current.scrollTop = heardRef.current.scrollHeight;
  }, [heard]);
  const [voice, setVoice] = useState<NoteTtsVoice>(DEFAULT_NOTE_TTS_VOICE);
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  const [usage, setUsage] = useState<TutorUsage | null>(null);
  const [blocked, setBlocked] = useState<TutorBlock | null>(null);
  const [buyingCredits, setBuyingCredits] = useState(false);
  /** The picker behind the collapsed voice row, open. */
  const [pickingVoice, setPickingVoice] = useState(false);
  /**
   * Where the walkthrough has got to, as state rather than as the ref the turn loop runs on.
   *
   * The running order lives in a ref because the turns read it from inside async
   * continuations that must not close over a stale render. But it is also a fact about the
   * screen now — a topic, and a position in a list of them — so the two are kept alongside
   * each other and this one is written wherever the ref moves.
   */
  const [progress, setProgress] = useState<{ title: string; index: number; total: number } | null>(
    null,
  );
  /**
   * What the session came to, held for the screen that says so.
   *
   * Counted here rather than read off the refs at render time because settling the grant
   * zeroes the seconds the moment the walkthrough ends — the summary is the last thing that
   * wants those numbers and it would be reading them a beat too late.
   */
  const [summary, setSummary] = useState<{
    topics: number;
    minutes: number;
    questions: number;
  } | null>(null);
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
  /** When the keys in the browser's hands stop working, as milliseconds. */
  const credentialsExpireAtRef = useRef<number | null>(null);
  /*
   * When to reach for the next slice. Held rather than recomputed from the expiry, because
   * a final slice comes due at the end of its talking time and an ordinary one on the
   * renewal margin, and the alarm and the check before each turn have to agree on which.
   */
  const nextSliceDueAtRef = useRef<number | null>(null);
  const renewalTimerRef = useRef<number | null>(null);
  /* Declared here and filled in below, so a turn can pause the session it is running in. */
  const pauseRef = useRef<() => void>(() => {});
  /** The renewal in progress, so three callers cannot reserve three slices. */
  const renewalInFlightRef = useRef<Promise<boolean> | null>(null);
  const followUpTimerRef = useRef<number | null>(null);
  const followUpRef = useRef<{ action: () => void; delay: number } | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  /*
   * Auditioning a voice used to be a session: credentials, a socket, and the model
   * synthesizing a line it had synthesized a thousand times before — about a second
   * and a half after the tap, on a screen where nothing else had happened yet, and
   * holding one of the account's few concurrent streams while it did. The line never
   * varies, so it is rendered once by scripts/generate-tutor-voice-clips.mjs and
   * shipped; the tap is now a file starting to play.
   */
  const previewRef = useRef<TutorClipPlayer | null>(null);
  /* Only the newest tap owns the preview; an earlier one still loading bows out. */
  const previewTokenRef = useRef(0);
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
  const preparedReplyRef = useRef(new PreparedTutorReply<Response>());

  const setPhaseNow = useCallback((next: TutorPhase) => {
    phaseRef.current = next;
    if (clearsHeardLine(next)) {
      setHeard(null);
      preparedReplyRef.current.clear();
    }
    setPhase(next);
  }, []);

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const scheduleFollowUp = useCallback((action: () => void, delay: number) => {
    clearTimer(followUpTimerRef);
    followUpRef.current = { action, delay };
    followUpTimerRef.current = window.setTimeout(action, delay);
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
    previewRef.current?.stop();
    setPreviewVoice(null);
  }, []);

  const teardown = useCallback(() => {
    preparedReplyRef.current.clear();
    runIdRef.current += 1;
    floorTokenRef.current += 1;
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    clearTimer(followUpTimerRef);
    clearTimer(renewalTimerRef);
    credentialsExpireAtRef.current = null;
    nextSliceDueAtRef.current = null;

    if (levelFrameRef.current !== null) {
      window.cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }

    envelopeRef.current.reset();
    orbRef.current?.style.setProperty("--orb-level", "0");

    planPromiseRef.current = null;
    stopPreview();
    outputRef.current?.close();
    outputRef.current = null;
    inputRef.current?.close();
    inputRef.current = null;
  }, [stopPreview]);

  /*
   * The voice clips, fetched before anybody asks for one.
   *
   * Auditioning a voice plays a pre-rendered file rather than synthesizing anything, so the wait
   * on a first tap is not the tutor thinking — it is one HTTP request for about sixty kilobytes,
   * which on a phone is the difference between a button that responds and one that seems not to
   * have registered the tap. The picker sits on the idle screen, which is exactly where somebody
   * is about to try three voices in a row, so the whole set for this language is pulled while
   * they are reading the page.
   *
   * The elements are held for the life of the screen rather than discarded, because an element
   * that is garbage collected takes its buffered audio with it and the next tap pays again. They
   * cost nothing else: nothing is ever played through them, and they are released on unmount.
   */
  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }

    /*
     * All eleven where the clips are files; only the chosen one where they are not.
     *
     * A language nothing was pre-rendered for has its samples synthesized on demand, and pulling
     * all eleven ahead of a tap nobody has made would spend eleven paid syntheses on a picker the
     * learner may never open. Warming the one voice that is already selected costs a single call,
     * makes the tap most people actually make instant, and leaves the other ten to pay for
     * themselves if anybody wants to hear them.
     */
    const wanted = hasStaticVoiceSamples(language) ? NOTE_TTS_VOICES : [voice];

    const held = wanted.map((option) => {
      const clip = new Audio();
      clip.preload = "auto";
      clip.src = voiceSampleClip(option, language);

      return clip;
    });

    return () => {
      for (const clip of held) {
        // Cancels anything still in flight, so leaving the screen does not keep downloading.
        clip.src = "";
      }
    };
  }, [language, voice]);


  const pickerRef = useRef<HTMLDetailsElement | null>(null);
  /*
   * Closing is driven from the element rather than from state alone: `<details>` owns its
   * own open flag, and setting only the React copy leaves a panel that will not reopen.
   */
  const closePicker = useCallback(() => {
    setPickingVoice(false);

    if (pickerRef.current) {
      pickerRef.current.open = false;
    }
  }, []);
  const sheet = useSheet(closePicker);

  useEffect(() => {
    setVoice(readStoredVoice());
  }, []);

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

      const input = inputRef.current;

      if (input) {
        /*
         * The recognizer is the half that has to be rebuilt, and at a busy moment there
         * may be no stream left to rebuild it with. That costs cutting in by speaking and
         * nothing else, so it is said plainly and the walkthrough carries on.
         */
        const listening = await input.useKey(payload.realtime.stt.apiKey);

        setCanListen(listening && !input.isMuted);

        if (!listening) {
          setError(t("tutor.error.listeningBusy"));
        }
      }

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
    const dueAt = nextSliceDueAtRef.current;

    if (dueAt === null || Date.now() < dueAt) {
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
    clearTimer(renewalTimerRef);

    /*
     * Counted from now rather than read off `realtime.tts.expiresAt`: that instant is on
     * Soniox's clock and every check made against it is on the learner's. See
     * `credentialsExpireAt` for what a slow one did to a free minute.
     */
    credentialsExpireAtRef.current = credentialsExpireAt({
      grantedSeconds: session.grantedSeconds,
      keyGraceSeconds: TUTOR_GRANT_KEY_GRACE_SECONDS,
      receivedAt: Date.now(),
    });

    if (credentialsExpireAtRef.current === null) {
      nextSliceDueAtRef.current = null;

      return;
    }

    nextSliceDueAtRef.current = nextSliceDueAt({
      expiresAt: credentialsExpireAtRef.current,
      finalSlice: isFinalSlice(session),
      renewalMarginMs: CREDENTIAL_RENEWAL_MARGIN_MS,
      keyGraceMs: TUTOR_GRANT_KEY_GRACE_SECONDS * 1000,
    });

    const delay = Math.max(0, nextSliceDueAtRef.current - Date.now());

    renewalTimerRef.current = window.setTimeout(() => {
      void renewCredentialsRef.current();
    }, delay);
  }, []);

  const adoptCredentialsRef = useRef(adoptCredentials);
  adoptCredentialsRef.current = adoptCredentials;


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
      spentSecondsRef.current += 1;
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

      orbRef.current?.style.setProperty("--orb-level", envelopeRef.current.push(raw).toFixed(4));
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

      // Claim the floor before any await, including a still-loading lesson plan.
      // Pausing or speaking again must invalidate this turn even during preparation.
      const prepared = (kind === "answer" || kind === "feedback") && options.question
        ? preparedReplyRef.current.take(preparedReplyKey(kind, options.index ?? topicIndexRef.current, options.question))
        : null;
      preparedReplyRef.current.clear();
      const controller = prepared?.controller ?? new AbortController();
      turnAbortRef.current?.abort();
      floorTokenRef.current += 1;
      const floorToken = floorTokenRef.current;
      const isCurrent = () =>
        !controller.signal.aborted &&
        runId === runIdRef.current &&
        floorToken === floorTokenRef.current;
      turnAbortRef.current = controller;
      clearTimer(followUpTimerRef);
      setPhaseNow("thinking");
      inputRef.current?.resetUtterance();

      const index = options.index ?? topicIndexRef.current;
      let turn: ReturnType<TutorSpeechOutput["speak"]> | null = null;
      const buffer = new SpeechTextBuffer();

      try {
        // Replies use the note and conversation directly. Waiting for the running
        // order here can hold an opening interruption for tens of seconds.
        const needsPlan = kind === "teach" || kind === "resume" || kind === "closing";
        const currentPlan =
          kind === "opening"
            ? null
            : (planRef.current ?? (needsPlan ? await planPromiseRef.current : null));

        if (!isCurrent()) {
          return;
        }

        if (needsPlan && !currentPlan) {
          throw new Error(t("tutor.error.startFailed"));
        }

        /*
         * One retry, and only for the request itself.
         *
         * A phone that changes cell, comes out of a pocket or wakes from a locked screen
         * drops exactly one request, and a walkthrough should not end for that — the
         * learner gets a red box and has to press Continue for something that had already
         * fixed itself. Retried only here, before a word has been spoken: asking again
         * once the voice has started would say the same sentence twice.
         */
        const requestTurn = async () => {
          if (prepared) {
            const ready = await prepared.result;
            controller.signal.throwIfAborted();
            if (ready) return ready;
          }
          for (let attempt = 0; ; attempt += 1) {
            controller.signal.throwIfAborted();
            try {
              return await fetch(`/api/lectures/${lectureId}/tutor/turn`, {
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
        };

        // Warm an idle socket while the server authenticates and writes the reply.
        // Only a confirmed utterance can start speech; any prepared reply stays silent.
        const prepareSpeech = async () => {
          if (!(await renewCredentialsRef.current()) || !isCurrent()) {
            return false;
          }
          await output.ensureOpen();
          return isCurrent();
        };
        const [response, speechReady] = await Promise.all([requestTurn(), prepareSpeech()]);

        if (!isCurrent() || !speechReady) {
          controller.abort();
          return;
        }

        if (!response.ok || !response.headers.get("Content-Type")?.includes("text/event-stream")) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string; code?: TutorBlock; usage?: TutorUsage }
            | null;

          /*
           * A refusal, not a fault: their access ended while they were inside the
           * walkthrough. Both `tutor/session` call sites have always met a 402 with the
           * paywall; this one threw, so a learner who pressed Resume six minutes into a
           * lesson was shown a red box quoting the billing sentence — and it was reported
           * as a defect — instead of the wall they had actually hit. Ends the session
           * where it stands, exactly as a refused renewal does.
           */
          if (response.status === 402) {
            if (payload?.usage) {
              setUsage(payload.usage);
            }

            setBlocked(payload?.code ?? "tutor_credits_needed");
            settleGrant();
            teardown();
            planRef.current = null;
            setPhaseNow("idle");

            return;
          }

          throw new Error(payload?.error ?? t("tutor.error.turnFailed"));
        }

        /*
         * The warm connection may not have survived the wait.
         *
         * Soniox hangs up on an output stream that has asked for no audio after about
         * ten seconds, and warming beside the request starts that clock before the
         * request is answered rather than when the first word is ready. An opening
         * takes longer than ten seconds often enough — it is written from the whole
         * note — and `speak` then threw at a socket that had already gone, which the
         * learner met as a red box in place of the walkthrough they had just started.
         * Replacing it here costs a handshake, and only when it really did die.
         */
        if (!output.isOpen) {
          await output.ensureOpen();

          if (!isCurrent()) {
            controller.abort();
            return;
          }
        }

        turn = output.speak();
        setPhaseNow("speaking");

        let spokeAnything = false;
        const result = await readChatStream<{
          speech: string;
          handBack: boolean;
          awaitingExplanation: boolean;
        }>(
          response,
          (text) => {
            if (!isCurrent()) {
              return;
            }
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
          spokenSoFarRef.current = appendSpokenSoFar(spokenSoFarRef.current, spoken);
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
        // Also cancel the request if the parallel speech preparation failed.
        controller.abort();
        if (turnAbortRef.current === controller) {
          turnAbortRef.current = null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onTurnFinished is defined below and stable
    [lectureId, setPhaseNow, settleGrant, t, teardown],
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
      /*
       * Counted here, before the slice is handed back: settling zeroes the seconds, and
       * they are half of what the closing screen has to say.
       */
      setSummary({
        topics: planRef.current?.topics.length ?? 0,
        minutes: Math.max(1, Math.round(spentSecondsRef.current / 60)),
        questions: historyRef.current.filter((entry) => entry.role === "learner").length,
      });
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
      scheduleFollowUp(() => {
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

      scheduleFollowUp(
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
     * Two turns open a topic without finishing it, and both hand over to a teach turn on the
     * same topic, which continues from what has already been said rather than starting again.
     *
     * The opening, because it was written before the running order existed.
     *
     * And the resume, because one turn cannot both bridge out of an interruption and finish the
     * topic it interrupted. Measured 2026-09-04 on the omrezja-sl fixture: asked to do both, a
     * resume taught one of the topic's three remaining points and the walkthrough then moved on,
     * leaving the other two untaught on every topic the learner had asked a question about.
     * Bridging and handing over covers two of three — the same as the slower model that used to
     * write these managed on its own, without giving up the speed that replaced it.
     */
    if (kind === "opening" || kind === "resume") {
      void runTurnRef.current("teach", { index: kind === "opening" ? 0 : index });

      return;
    }

    advanceToNextTopic(index);
  }

  /** Puts the running order's current position on the screen. Silent until the plan lands. */
  function showTopic(index: number) {
    const topics = planRef.current?.topics ?? [];

    if (topics.length === 0) {
      setProgress(null);

      return;
    }

    /* The closing turn runs on the last topic's index, which is one past the end of the walk. */
    const shown = Math.min(index, topics.length - 1);

    setProgress({ title: topics[shown].title, index: shown, total: topics.length });
  }

  function advanceToNextTopic(index: number) {
    const nextIndex = index + 1;
    const total = planRef.current?.topics.length ?? 0;

    spokenSoFarRef.current = "";
    awaitingExplanationRef.current = false;
    topicIndexRef.current = nextIndex;
    showTopic(nextIndex);

    if (nextIndex >= total) {
      void runTurnRef.current("closing", { index: Math.max(0, total - 1) });

      return;
    }

    void runTurnRef.current("teach", { index: nextIndex });
  }

  /**
   * Who the recognizer was listening to, and what to do about anyone who is not the
   * learner.
   *
   * The tutor is deaf to itself, and deaf in two steps. The text is judged against what
   * has actually left its own speaker — nothing at all while the room has been the
   * learner's, so their turn is never second-guessed — and anything that is not a person
   * asking something is then *dropped from the recognizer's buffer* rather than merely
   * ignored here. That second step is the one that was missing: Soniox builds one
   * utterance until it hears a pause and the tutor never pauses, so a session on a phone
   * speaker accumulated the tutor's own paragraph and then glued the learner's question
   * onto the end of it. The model was asked to answer both.
   *
   * Dropping is safe by definition: text that reaches here as anything but "learner"
   * contains no word of theirs to lose.
   */
  const whoSpoke = useCallback((text: string) => {
    const speaker = judgeHeard(text, outputRef.current?.spokenIntoRoom() ?? "", language);

    if (speaker !== "learner") {
      inputRef.current?.resetUtterance();
    }

    return speaker;
  }, [language]);

  /**
   * The learner has taken the floor. Stop, and record only what they heard.
   */
  const commitInterruption = useCallback(() => {
    floorTokenRef.current += 1;
    clearTimer(followUpTimerRef);
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;

    const stopped = outputRef.current?.stop({ fadeOut: true });

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

    setPhaseNow("listening");

    /*
     * Handing the floor over is not the same as being asked a question, and sometimes
     * nothing follows it: a word said to somebody else in the room, or a sentence
     * abandoned halfway. The session would otherwise sit in silence forever waiting for
     * a question that was never coming, so the topic is picked back up — and the learner
     * can always cut in again.
     */
    clearTimer(followUpTimerRef);
    scheduleFollowUp(() => {
      if (phaseRef.current === "listening") {
        void runTurnRef.current("resume");
      }
    }, FOLLOW_UP_SILENCE_MS);
  }, [scheduleFollowUp, setPhaseNow]);

  const startSession = useCallback(async () => {
    /*
     * First, before the network is touched: a voice being auditioned stops the moment
     * Start is pressed. Starting takes a second or two, and a sample still playing
     * underneath the loading state sounds like the tutor has already begun — in the
     * wrong voice, saying something that has nothing to do with the note.
     */
    stopPreview();
    closePicker();

    /* A new session gets a clean slate: last session's failures are not this one's. */
    resetTutorFailureReports();
    setError(null);
    setCanListen(true);
    historyRef.current = [];
    spokenSoFarRef.current = "";
    awaitingExplanationRef.current = false;
    topicIndexRef.current = 0;
    setProgress(null);
    setSummary(null);
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
          /*
           * The greeting has been playing for most of a minute by now with nothing under it
           * saying what is being walked through, because until this lands there is nothing
           * to say. This is the first moment there is.
           */
          showTopic(topicIndexRef.current);
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
        onPartial: (text) => {
          if (
            phaseRef.current === "paused" || phaseRef.current === "finished" ||
            phaseRef.current === "idle" || phaseRef.current === "preparing"
          ) {
            return;
          }
          if (whoSpoke(text) !== "learner") {
            return;
          }

          // A reply still loading must yield on the first real word too.
          if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
            commitInterruption();
          }

          setHeard({ text: latestHeardSentence(text, language), settled: false });

          // Prepare silently after a stable multiword partial. No speech is created
          // until endpointing confirms these exact words; revisions discard it.
          if (!awaitingExplanationRef.current && text.length <= 1000 && (text.match(/\p{Letter}+/gu)?.length ?? 0) >= 4) {
            const kind = awaitingExplanationRef.current ? "feedback" : "answer";
            const index = topicIndexRef.current;
            const body = JSON.stringify({
              kind, topicIndex: index, plan: planRef.current, question: text,
              history: [...historyRef.current, { role: "learner", content: text }].slice(-12),
            });
            preparedReplyRef.current.update(preparedReplyKey(kind, index, text), (signal) =>
              fetch(`/api/lectures/${lectureId}/tutor/turn`, {
                method: "POST", headers: { "Content-Type": "application/json" }, signal, body,
              }),
            );
          } else {
            preparedReplyRef.current.discard();
          }

          // A silence timer is measured from the learner's latest words, not
          // from when we asked. Preserve its action (including explain-back).
          const followUp = followUpRef.current;
          if (phaseRef.current === "listening" && followUp) {
            scheduleFollowUp(
              followUp.action,
              Math.max(
                followUp.delay,
                awaitingExplanationRef.current ? EXPLAIN_BACK_SILENCE_MS : FOLLOW_UP_SILENCE_MS,
              ),
            );
          }
        },
        onUtterance: (text) => {
          if (
            phaseRef.current === "paused" || phaseRef.current === "finished" ||
            phaseRef.current === "idle" || phaseRef.current === "preparing"
          ) {
            return;
          }

          if (whoSpoke(text) !== "learner") {
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
          setHeard({ text: latestHeardSentence(text, language), settled: true });
          historyRef.current.push({ role: "learner", content: text });

          /*
           * If the tutor had asked them to explain the idea back, this is that attempt —
           * it needs marking, not answering. Anything else is a question.
           */
          const kind = awaitingExplanationRef.current ? "feedback" : "answer";
          awaitingExplanationRef.current = false;
          void runTurnRef.current(kind, { question: text });
        },
        onError: (inputError: SpeechInputError) => {
          /*
           * A page on its way into the background takes its sockets with it. The pause
           * that follows closes the recognizer on purpose, but the order the browser
           * chooses is its own — so a death that arrives first is still the screen lock,
           * not a fault, and the learner must not come back to a red box about it.
           */
          if (document.visibilityState === "hidden") {
            return;
          }

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

    void runTurnRef.current("opening", { index: 0 });
  }, [
    closePicker,
    commitInterruption,
    scheduleFollowUp,
    language,
    lectureId,
    setPhaseNow,
    settleGrant,
    stopPreview,
    t,
    voice,
    whoSpoke,
  ]);

  function pause() {
    floorTokenRef.current += 1;
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

  /**
   * Back to the top of a topic — the one it is on, or the one before it.
   *
   * A walkthrough is not a track list, so this is not "previous track": what a learner
   * wants when a paragraph goes past them is that paragraph again, and only when they are
   * already at the start of one do they mean the one before. So the first press repeats
   * what is being said now, and a second press — with nothing said yet on this topic —
   * steps back. That also makes it safe on the first topic, where there is no back to go.
   */
  function skipToPreviousTopic() {
    if (!planRef.current) {
      return;
    }

    const atTopicStart = spokenSoFarRef.current === "";
    const index = Math.max(0, atTopicStart ? topicIndexRef.current - 1 : topicIndexRef.current);

    floorTokenRef.current += 1;
    clearTimer(followUpTimerRef);
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    outputRef.current?.stop();

    spokenSoFarRef.current = "";
    awaitingExplanationRef.current = false;
    topicIndexRef.current = index;
    showTopic(index);
    setError(null);

    void restoreListening();
    void runTurnRef.current("teach", { index });
  }

  function end() {
    settleGrant();
    teardown();
    planRef.current = null;
    setProgress(null);
    setSummary(null);
    setPhaseNow("idle");
  }

  /*
   * Auditioning a voice.
   *
   * The line is the same every time, so it is a file: `public/tutor-demo`, rendered
   * per voice per language by `scripts/generate-tutor-voice-clips.mjs`. The tap
   * plays it, which is instant and costs the account nothing — where this used to
   * fetch credentials, open a socket and wait on the model, about a second and a
   * half of a screen that looked broken, while holding one of the few concurrent
   * streams the whole organization shares.
   */
  const previewPlayer = useCallback(() => {
    if (!previewRef.current) {
      previewRef.current = new TutorClipPlayer();
    }

    return previewRef.current;
  }, []);

  useEffect(() => () => previewRef.current?.destroy(), []);

  async function previewVoiceSample(next: NoteTtsVoice) {
    setVoice(next);

    /*
     * Two voices must never talk over each other. Stopping handles the one already
     * playing; the token handles the subtler case — a tap whose file is still
     * loading, which would otherwise start after the voice tapped later had begun.
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

    const player = previewPlayer();
    player.onEnded = () => {
      if (token === previewTokenRef.current) {
        setPreviewVoice(null);
      }
    };

    try {
      /* In the note's language — a voice previewed in the wrong one tells you nothing. */
      await player.play(voiceSampleClip(next, language));
    } catch {
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
  /*
   * The phase is now said by a mark as well as a word, so the word can be the short one.
   * "Preparing the walkthrough…" was carrying the whole signal on its own; the dot beside
   * it is doing that job from here, and a status line long enough to wrap is a caption.
   */
  const isPaused = phase === "paused";

  if (!isReady) {
    return <p className="ios-info lecture-empty-message">{t("api.tutorNotReady")}</p>;
  }

  /*
   * The voices, behind the row that says which one you have.
   *
   * Eleven chips used to be on the screen the whole time, bleeding off both edges under the
   * sphere, for a decision most people make once and never revisit. The scroller is the same
   * scroller — tapping a chip still plays that voice — it just waits behind a tap now.
   */
  const voicePicker = (
    <div className="memo-tutor-voices" role="radiogroup" aria-label={t("tutor.voice.label")}>
      {NOTE_TTS_VOICES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={voice === option}
          className={`memo-tutor-voice ${voice === option ? "active" : ""} ${
            previewVoice === option ? "playing" : ""
          }`.trim()}
          /*
           * Its own hue, not the chosen voice's. The eleven are spread round the wheel
           * precisely so that the choice is a visible one, and a picker that draws them all
           * in the colour of the voice you already have throws that away — see
           * voice-colors.ts.
           */
          style={{ "--voice-hue": voiceHue(option) } as CSSProperties}
          onClick={() => void previewVoiceSample(option)}
        >
          <span className="memo-tutor-voice-dot" aria-hidden="true" />
          <span>{option}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/*
        * One meter for both spoken features. The tutor and the podcast spend the same minutes,
        * so they show them with the same object rather than two that drift apart.
        *
        * It sits in the note's own title row rather than in the dock: "28 min left today" is
        * the whole question somebody asks of it, and at the foot of the screen it was below
        * the thing it describes.
        */}
      <VoiceUsageSheet
        usage={usage}
        slot={headSlot}
        blocked={Boolean(blocked)}
        buyingCredits={buyingCredits}
        onBuyCredits={() => void buyCredits()}
      />
      <div
        className={`memo-tutor phase-${phase}`}
        style={{ "--orb-hue": voiceHue(previewVoice ?? voice) } as CSSProperties}
      >
        {/*
          * The sphere. Its scale and glow ride the live audio level, so it breathes
          * with whichever voice is in the room rather than animating on a timer —
          * a loop that runs while nothing is being said is the thing that makes a
          * voice UI look fake.
          */}
        <div className="memo-orb" ref={orbRef} aria-hidden="true">
          <span className="memo-orb-glow" />
          <span className="memo-orb-body" />
          <span className="memo-orb-ring" />
          <span className="memo-orb-ring second" />
        </div>

        {!isRunning ? (
          /* What this is, before it has said anything. */
          <div className="memo-tutor-intro">
            <p className="memo-tutor-title">{t("tutor.idle.title")}</p>
            <p className="memo-tutor-lede">{t("tutor.idle.lede")}</p>
          </div>
        ) : phase === "finished" ? (
          <div className="memo-tutor-intro">
            <p className="memo-tutor-title">{t("tutor.finished.title")}</p>
            {/* What happened, not "Finished" — the sphere going quiet already said that. */}
            <p className="memo-tutor-lede">
              {summary
                ? t(summary.questions > 0 ? "tutor.finished.summary" : "tutor.finished.summaryQuiet", {
                    topics: t("tutor.finished.topics", { count: summary.topics }),
                    minutes: t("tutor.finished.minutes", { count: summary.minutes }),
                    questions: t("tutor.finished.questions", { count: summary.questions }),
                  })
                : t("tutor.state.finished")}
            </p>
          </div>
        ) : isPreparing ? (
          <div className="memo-tutor-loading-copy" role="status">
            <p className="memo-tutor-title">{t("tutor.state.preparing")}</p>
            <p className="memo-tutor-lede">{t("tutor.state.preparingHint")}</p>
          </div>
        ) : statusKey ? (
          /*
           * The phase, said once: a dot in the voice's own hue and one word. The dot is the
           * half that gets read — the sphere at rest and the sphere mid-sentence look almost
           * the same, and a mark that moves with the state resolves that without being read.
           */
          <p className="memo-tutor-statusrow" role="status">
            <span className="memo-tutor-status-dot" aria-hidden="true" />
            {t(statusKey)}
          </p>
        ) : null}

        {isRunning && !isPreparing && phase !== "finished" ? (
          <div className="memo-tutor-caption" aria-live="off">
            {heard && showsHeardLine(phase) ? (
              <p ref={heardRef} className={`memo-tutor-heard ${heard.settled ? "" : "draft"}`.trim()}>
                {heard.text}
              </p>
            ) : null}
          </div>
        ) : null}

        {/*
          * The microphone was refused or is absent, so the walkthrough runs but cutting in
          * does not — which is the one thing this screen promises that would otherwise fail
          * silently. It used to be said by the mute button sitting disabled; the button has
          * gone, so it is said in words.
          */}
        {isRunning && !canListen && phase !== "finished" ? (
          <p className="memo-tutor-hint">{t("tutor.hint.muted")}</p>
        ) : null}

        {error ? <p className="memo-inline-error memo-tutor-error">{error}</p> : null}

        {/*
          * Where the walkthrough has got to. One row rather than the two quiet lines it
          * replaces, with the bar every other measure of progress in this app uses.
          */}
        {isRunning && !isPreparing && phase !== "finished" && progress ? (
          <div className="memo-tutor-topicrow">
            <div className="memo-tutor-topic">
              <span className="memo-tutor-topic-title">{progress.title}</span>
              <span className="memo-tutor-topic-count">
                {progress.index + 1} / {progress.total}
              </span>
            </div>
            <div
              className="memo-tutor-topicbar"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={progress.total}
              aria-valuenow={progress.index + 1}
              aria-label={progress.title}
            >
              <span style={{ width: `${((progress.index + 1) / progress.total) * 100}%` }} />
            </div>
          </div>
        ) : null}

        {!isRunning ? (
          <>
            {/*
              * The voice, collapsed to one row that shows it and its colour. Opens the same
              * picker on a tap: a popover against itself on the desktop, and on the phone the
              * dragged sheet every other choice in this app arrives in — which is exactly what
              * the usage meter beside the title already does.
              */}
            <details
              className="memo-tutor-picker"
              ref={pickerRef}
              onToggle={(event) => setPickingVoice(event.currentTarget.open)}
            >
              <summary className="memo-capture-row memo-tutor-voicerow">
                <span className="memo-tutor-voice-swatch" aria-hidden="true" />
                <span className="memo-capture-row-copy">
                  <span>{voice}</span>
                  <span>{t("tutor.voice.label")}</span>
                </span>
                <Msym
                  name={pickingVoice ? "expand_more" : "chevron_right"}
                  size="1.5rem"
                  fill={false}
                  weight={400}
                />
              </summary>
              <div className="memo-tutor-picker-popover memo-only-desktop">
                <p className="memo-tutor-picker-heading">{t("tutor.voice.hint")}</p>
                {voicePicker}
              </div>
            </details>

            {pickingVoice ? (
              <MemoPortal>
                <button
                  type="button"
                  className={sheetClass("note-read-usage-mobile-backdrop memo-only-mobile", sheet.closing)}
                  onClick={() => sheet.dismiss()}
                  aria-label={t("common.close")}
                />
                <div
                  className={sheetClass(
                    "note-read-usage-mobile-sheet memo-tutor-picker-sheet memo-only-mobile",
                    sheet.closing,
                  )}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("tutor.voice.label")}
                  {...sheet.dragProps}
                  /*
                   * The sheet is portalled to the end of the document, so it is not inside
                   * `.memo-tutor` and inherits nothing from it — including the hue the
                   * chosen chip is tinted with. Without this the selected voice loses its
                   * fill and its ring and reads as one of the ten that are not selected.
                   *
                   * Merged into the drag's own style rather than set beside it: that one
                   * carries the finger's translate, and whichever of the two is written
                   * second wins outright.
                   */
                  style={
                    {
                      ...sheet.dragProps.style,
                      "--orb-hue": voiceHue(previewVoice ?? voice),
                    } as CSSProperties
                  }
                >
                  {/* The grabber every sheet in this app wears, and the one place `useSheet`
                      will start a drag from without swallowing a chip's tap. */}
                  <div className="memo-grab" data-drag-handle />
                  <p className="memo-tutor-picker-heading">{t("tutor.voice.hint")}</p>
                  {voicePicker}
                </div>
              </MemoPortal>
            ) : null}

            <button type="button" className="memo-tutor-start" onClick={() => void startSession()}>
              <Msym name="play_arrow" size="1.3rem" fill weight={500} />
              <span>{t("tutor.start")}</span>
            </button>
          </>
        ) : phase === "finished" ? (
          /*
           * Two ways out, and the second is new. Everything they have just had explained is
           * also sitting in the cards, and the end of a walkthrough is the one moment in the
           * app where somebody has just proved they want this material — so the cards are
           * offered here rather than left to the pill row, which is the only route today.
           */
          <div className="memo-tutor-actions">
            <button type="button" className="memo-tutor-start" onClick={() => void startSession()}>
              {/* `replay`, not `restart_alt`: that glyph draws its arrowhead detached from
                  the ring, which at this size reads as a broken icon rather than as a
                  circular arrow. */}
              <Msym name="replay" size="1.3rem" fill={false} weight={500} />
              <span>{t("tutor.restart")}</span>
            </button>

            {onOpenFlashcards ? (
              <button type="button" className="memo-tutor-second" onClick={onOpenFlashcards}>
                <Msym name="style" size="1.2rem" fill={false} weight={500} />
                <span>{t("tutor.finished.flashcards")}</span>
              </button>
            ) : null}
          </div>
        ) : isPreparing ? (
          <button type="button" className="memo-button-ghost memo-tutor-cancel" onClick={end}>
            {t("common.cancel")}
          </button>
        ) : (
          /*
           * The transport. Round icon buttons rather than bordered pills with the word
           * "Pause" written beside a pause glyph, and the same set the podcast player uses —
           * the two spoken screens are one instrument and should not need different hands.
           *
           */
          <div className="memo-tutor-controls">
            <button
              type="button"
              className="memo-tutor-control"
              onClick={skipToPreviousTopic}
              disabled={isPreparing || !progress}
              aria-label={t("tutor.previous")}
            >
              <Msym name="skip_previous" size="1.45rem" fill={false} weight={500} />
            </button>

            <button
              type="button"
              className="memo-tutor-control primary"
              onClick={isPaused ? resume : pause}
              disabled={isPreparing}
              aria-label={t(isPaused ? "tutor.resume" : "tutor.pause")}
            >
              <Msym name={isPaused ? "play_arrow" : "pause"} size="1.8rem" fill weight={500} />
            </button>

            <button
              type="button"
              className="memo-tutor-control"
              onClick={end}
              aria-label={t("tutor.end")}
            >
              <Msym name="close" size="1.45rem" fill={false} weight={500} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
