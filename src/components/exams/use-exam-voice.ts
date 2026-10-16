"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { requestTutorMicrophone, TutorSpeechInput } from "@/lib/tutor/speech-input";
import { GeminiTutorSpeechOutput } from "@/lib/tutor/gemini-speech-output";
import { hasWebAudio, TutorSpeechOutput } from "@/lib/tutor/speech-output";
import { LevelEnvelope } from "@/lib/tutor/turn-audio";
import {
  DEFAULT_NOTE_TTS_VOICE,
  normalizeNoteTtsVoice,
  NOTE_TTS_VOICE_STORAGE_KEY,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";

/*
 * A spoken exchange on the voice tutor's own pieces (the same Soniox keys, recogniser, speech
 * output, sphere and talking-time allowance), for the oral mock exam and the tutor lesson: say a
 * line, listen for an answer, report when the learner has finished. What is said and what an
 * answer leads to is the caller's.
 *
 * With `allowText`, a session that cannot have a voice (no microphone, no talking time left, no
 * Web Audio) still runs, in writing: the lines are shown rather than spoken and the learner types.
 */

export type VoicePhase = "preparing" | "speaking" | "listening" | "thinking" | "finished";

type Session = {
  language: string;
  grantId: string | null;
  grantedSeconds: number;
  realtime: {
    stt: { apiKey: string; url: string; model: string };
    /* Gemini unless the server says Soniox (TTS_PROVIDER), exactly as the tutor reads it. */
    tts: { provider?: "gemini" | "soniox"; apiKey: string; url: string; model: string; voice: NoteTtsVoice };
  };
};

/** The voice the learner picked for the tutor on this device; the exam's voices start from it. */
export function storedTutorVoice(): NoteTtsVoice {
  try {
    return normalizeNoteTtsVoice(window.localStorage.getItem(NOTE_TTS_VOICE_STORAGE_KEY));
  } catch {
    return DEFAULT_NOTE_TTS_VOICE;
  }
}

/* After the learner stops talking, this much quiet ends the answer. */
const ANSWER_SILENCE_MS = 3500;
/* A fresh key is fetched this long before the current slice of talking time runs out. */
const RENEW_BEFORE_SECONDS = 25;

/* One slice of talking time. Settling it clears `grantId`, so the same slice is never reported twice. */
type Grant = { grantId: string | null; grantedSeconds: number; startedAt: number };

function grantOf(session: Session): Grant {
  return { grantId: session.grantId, grantedSeconds: session.grantedSeconds, startedAt: Date.now() };
}

export function useExamVoice({
  lectureId,
  voice,
  allowText = false,
  fallbackLanguage = "sl",
  onAnswerEnd,
}: {
  /** The note whose tutor session the voice speaks through (talking time is counted there). */
  lectureId: string;
  voice: NoteTtsVoice;
  allowText?: boolean;
  /** The language lines are in when no session says otherwise (text mode). */
  fallbackLanguage?: string;
  /** The learner has gone quiet after speaking: their answer is over. */
  onAnswerEnd: () => void;
}) {
  const { t } = useTranslations();
  const [phase, setPhase] = useState<VoicePhase>("preparing");
  const [heard, setHeard] = useState("");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [textMode, setTextMode] = useState(false);
  /* Why the lesson went on in writing (no microphone, no talking time, the voice dropped), as said to the learner. */
  const [textNote, setTextNote] = useState<string | null>(null);
  /* Whether the tutor's voice is on: in writing it still speaks when only the microphone is missing. */
  const [speaks, setSpeaks] = useState(false);

  const phaseRef = useRef<VoicePhase>("preparing");
  const outputRef = useRef<TutorSpeechOutput | GeminiTutorSpeechOutput | null>(null);
  const inputRef = useRef<TutorSpeechInput | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const envelopeRef = useRef(new LevelEnvelope());
  const heardRef = useRef("");
  const silenceRef = useRef<number | null>(null);
  const grantRef = useRef<Grant | null>(null);
  const startedAtRef = useRef(0);
  const closedRef = useRef(false);
  /*
   * Which start() is the live one. Every start and every teardown moves it on, so a start still
   * waiting on the microphone or the session when it was cancelled (and perhaps started again)
   * knows to close what it opened rather than build a second session beside the new one.
   */
  const generationRef = useRef(0);
  const renewingRef = useRef(false);
  /* The session's speech language: the voice speaks it, and the recogniser listens for it. */
  const languageRef = useRef(fallbackLanguage);
  const onAnswerEndRef = useRef(onAnswerEnd);

  useEffect(() => {
    onAnswerEndRef.current = onAnswerEnd;
  });

  const setPhaseNow = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearSilence = useCallback(() => {
    if (silenceRef.current !== null) {
      window.clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  }, []);

  /* Reports the talking time one slice used, once. */
  const settleGrant = useCallback(
    (grant: Grant | null, keepalive = false) => {
      const grantId = grant?.grantId;

      if (!grant || !grantId) {
        return;
      }

      grant.grantId = null;
      void fetch(`/api/lectures/${lectureId}/tutor/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId,
          secondsUsed: Math.min(grant.grantedSeconds, Math.round((Date.now() - grant.startedAt) / 1000)),
        }),
        keepalive,
      }).catch(() => null);
    },
    [lectureId],
  );

  const settle = useCallback((keepalive = false) => settleGrant(grantRef.current, keepalive), [settleGrant]);

  const teardown = useCallback(() => {
    generationRef.current += 1;
    closedRef.current = true;
    clearSilence();
    inputRef.current?.close();
    outputRef.current?.close();
    inputRef.current = null;
    outputRef.current = null;
    setSpeaks(false);
    settle(true);
  }, [clearSilence, settle]);

  const openSession = useCallback(async () => {
    const response = await fetch(`/api/lectures/${lectureId}/tutor/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice }),
    });
    const payload = (await response.json().catch(() => null)) as (Session & { error?: string }) | null;

    if (!response.ok || !payload?.realtime) {
      throw new Error(payload?.error ?? t("exam.oral.error.start"));
    }

    return payload;
  }, [lectureId, t, voice]);

  /*
   * Says one line (shows it, and speaks it when there is a voice) and resolves when it has been
   * heard. `shown` is what to write out when it differs from what is said (a question shown on its
   * own, say, rather than twice).
   */
  const say = useCallback(
    async (text: string, shown: string = text) => {
      if (closedRef.current) {
        return;
      }

      setLine(shown);
      const output = outputRef.current;

      if (!output) {
        setPhaseNow("speaking");
        return;
      }

      inputRef.current?.setMuted(true);
      setPhaseNow("speaking");
      const turn = output.speak({ voice });
      turn.push(text);
      turn.end();
      await turn.finished.catch(() => null);
    },
    [setPhaseNow, voice],
  );

  /* Opens the microphone for an answer (or, in writing, waits for one to be typed). */
  const listen = useCallback(() => {
    if (closedRef.current) {
      return;
    }

    heardRef.current = "";
    setHeard("");
    inputRef.current?.resetUtterance();
    inputRef.current?.setMuted(false);
    setPhaseNow("listening");
  }, [setPhaseNow]);

  /* Stops listening and hands back what was heard. */
  const stopListening = useCallback(() => {
    clearSilence();
    inputRef.current?.setMuted(true);
    return heardRef.current.trim();
  }, [clearSilence]);

  /* Cuts the voice off mid-line and closes the microphone (a pause, or going back over a point). */
  const hush = useCallback(() => {
    clearSilence();
    inputRef.current?.setMuted(true);
    outputRef.current?.stop({ fadeOut: true });
  }, [clearSilence]);

  /*
   * The voice has dropped (the recogniser or the speech output lost its connection): with
   * `allowText`, the rest goes on in writing. The microphone and keys are closed and the talking
   * time used so far is reported; what is said next is shown, and the learner types.
   */
  const switchToText = useCallback(() => {
    if (!allowText || closedRef.current) {
      return;
    }

    clearSilence();
    inputRef.current?.close();
    outputRef.current?.close();
    inputRef.current = null;
    outputRef.current = null;
    setSpeaks(false);
    settle(true);
    setError(null);
    setTextMode(true);
    setTextNote(t("tutor.error.connection"));
  }, [allowText, clearSilence, settle, t]);

  const finish = useCallback(() => {
    if (closedRef.current) {
      return;
    }

    setPhaseNow("finished");
    teardown();
  }, [setPhaseNow, teardown]);

  /** Starts the session: microphone, talking time and keys. False if it could not start at all. */
  const start = useCallback(async (): Promise<boolean> => {
    // A remount (React's development double mount, or a fast remount) starts a fresh session.
    const generation = (generationRef.current += 1);
    const stale = () => generation !== generationRef.current;
    closedRef.current = false;
    // A start after writing (the learner asked to try the microphone again) tries the voice first.
    setTextMode(false);
    setTextNote(null);

    const fallBack = (message: string) => {
      if (stale()) {
        return false;
      }

      if (allowText) {
        setTextMode(true);
        setTextNote(message);
        startedAtRef.current = Date.now();
        return true;
      }

      setError(message);
      return false;
    };

    if (!hasWebAudio()) {
      return fallBack(t("tutor.error.unsupported"));
    }

    /*
     * Without a microphone the voice still speaks when the lesson allows writing: the tutor talks,
     * asks and marks as always, and the learner types the answers. Only an exam that must be spoken
     * stops here.
     */
    let microphone: MediaStream | null = null;

    try {
      microphone = await requestTutorMicrophone();
    } catch {
      if (!allowText) {
        return fallBack(t("tutor.error.micDenied"));
      }
    }

    const stopMicrophone = () => microphone?.getTracks().forEach((track) => track.stop());

    if (stale()) {
      stopMicrophone();
      return false;
    }

    let grant: Grant | null = null;
    let output: TutorSpeechOutput | GeminiTutorSpeechOutput | null = null;
    let input: TutorSpeechInput | null = null;
    // Everything this start opened, closed: on a failure, or when a newer start or a teardown has
    // overtaken it while it waited.
    const abandon = () => {
      stopMicrophone();
      input?.close();
      output?.close();
      settleGrant(grant, true);
    };

    try {
      const session = await openSession();
      grant = grantOf(session);

      if (stale()) {
        abandon();
        return false;
      }

      grantRef.current = grant;
      languageRef.current = session.language;

      const SpeechOutput = session.realtime.tts.provider === "gemini" ? GeminiTutorSpeechOutput : TutorSpeechOutput;
      output = new SpeechOutput(
        {
          url: session.realtime.tts.url,
          apiKey: session.realtime.tts.apiKey,
          model: session.realtime.tts.model,
          voice: session.realtime.tts.voice,
          language: session.language,
        },
        { onError: () => setError(t("tutor.error.connection")) },
      );
      if (microphone) {
        input = new TutorSpeechInput(
          { ...session.realtime.stt, languages: [session.language] },
          {
            onPartial: (text) => {
              if (phaseRef.current !== "listening") {
                return;
              }

              setHeard([heardRef.current, text].filter(Boolean).join(" "));
              clearSilence();
            },
            onUtterance: (text) => {
              if (phaseRef.current !== "listening" || !text.trim()) {
                return;
              }

              heardRef.current = [heardRef.current, text.trim()].filter(Boolean).join(" ");
              setHeard(heardRef.current);
              clearSilence();
              silenceRef.current = window.setTimeout(() => onAnswerEndRef.current(), ANSWER_SILENCE_MS);
            },
            onError: () => setError(t("tutor.error.connection")),
          },
        );
      }

      await output.connect();
      await output.resumeAudio();

      if (input && microphone) {
        await input.start(microphone);
      }

      if (stale()) {
        abandon();
        return false;
      }

      input?.setMuted(true);
      outputRef.current = output;
      inputRef.current = input;
      setSpeaks(true);
      startedAtRef.current = Date.now();

      if (!microphone) {
        // Spoken to, answering in writing.
        setTextMode(true);
        setTextNote(t("exam.tutor.noMicVoice"));
      }

      return true;
    } catch (caught) {
      abandon();
      return fallBack(caught instanceof Error ? caught.message : t("exam.oral.error.start"));
    }
  }, [allowText, clearSilence, openSession, settleGrant, t]);

  /*
   * Closing the tab or locking the phone does not unmount anything, so the talking time used is
   * reported on pagehide as well, as the tutor does. Unreported time is charged in full later.
   */
  useEffect(() => {
    const report = () => settle(true);
    window.addEventListener("pagehide", report);
    return () => window.removeEventListener("pagehide", report);
  }, [settle]);

  /* The clock, and renewing the keys before the slice of talking time they were minted for runs out. */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!startedAtRef.current || closedRef.current) {
        return;
      }

      setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000));
      const grant = grantRef.current;

      if (
        grant &&
        outputRef.current &&
        !renewingRef.current &&
        (Date.now() - grant.startedAt) / 1000 > grant.grantedSeconds - RENEW_BEFORE_SECONDS
      ) {
        renewingRef.current = true;
        settle();
        const generation = generationRef.current;
        void openSession()
          .then(async (session) => {
            const next = grantOf(session);

            // Ended while the key was on its way: the new slice is reported unused at once.
            if (generation !== generationRef.current) {
              settleGrant(next, true);
              return;
            }

            grantRef.current = next;
            outputRef.current?.useKey(session.realtime.tts.apiKey);
            await inputRef.current?.useKey(session.realtime.stt.apiKey);
          })
          .catch(() => setError(t("exam.oral.error.time")))
          .finally(() => {
            renewingRef.current = false;
          });
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [openSession, settle, settleGrant, t]);

  /* The sphere follows whichever voice is sounding, as it does for the tutor. */
  useEffect(() => {
    let frame = 0;
    const pump = () => {
      const speaking = outputRef.current?.getLevel() ?? 0;
      const listening = phaseRef.current === "listening" ? (inputRef.current?.getLevel() ?? 0) * 1.6 : 0;
      orbRef.current?.style.setProperty("--orb-level", envelopeRef.current.push(Math.max(speaking, listening)).toFixed(4));
      frame = window.requestAnimationFrame(pump);
    };

    frame = window.requestAnimationFrame(pump);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return {
    phase,
    phaseRef,
    setPhase: setPhaseNow,
    heard,
    line,
    error,
    elapsed,
    textMode,
    textNote,
    speaks,
    orbRef,
    languageRef,
    startedAtRef,
    start,
    say,
    listen,
    stopListening,
    hush,
    switchToText,
    finish,
    teardown,
  };
}
