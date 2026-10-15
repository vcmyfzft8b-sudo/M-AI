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

  const phaseRef = useRef<VoicePhase>("preparing");
  const outputRef = useRef<TutorSpeechOutput | GeminiTutorSpeechOutput | null>(null);
  const inputRef = useRef<TutorSpeechInput | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const envelopeRef = useRef(new LevelEnvelope());
  const heardRef = useRef("");
  const silenceRef = useRef<number | null>(null);
  const grantRef = useRef<{ grantId: string | null; grantedSeconds: number; startedAt: number } | null>(null);
  const startedAtRef = useRef(0);
  const closedRef = useRef(false);
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

  const settle = useCallback(
    (keepalive = false) => {
      const grant = grantRef.current;

      if (!grant?.grantId) {
        return;
      }

      grantRef.current = { ...grant, grantId: null };
      void fetch(`/api/lectures/${lectureId}/tutor/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId: grant.grantId,
          secondsUsed: Math.min(grant.grantedSeconds, Math.round((Date.now() - grant.startedAt) / 1000)),
        }),
        keepalive,
      }).catch(() => null);
    },
    [lectureId],
  );

  const teardown = useCallback(() => {
    closedRef.current = true;
    clearSilence();
    inputRef.current?.close();
    outputRef.current?.close();
    inputRef.current = null;
    outputRef.current = null;
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

    grantRef.current = { grantId: payload.grantId, grantedSeconds: payload.grantedSeconds, startedAt: Date.now() };
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
    closedRef.current = false;

    const fallBack = (message: string) => {
      if (allowText) {
        setTextMode(true);
        startedAtRef.current = Date.now();
        return true;
      }

      setError(message);
      return false;
    };

    if (!hasWebAudio()) {
      return fallBack(t("tutor.error.unsupported"));
    }

    let microphone: MediaStream;

    try {
      microphone = await requestTutorMicrophone();
    } catch {
      return fallBack(t("tutor.error.micDenied"));
    }

    try {
      const session = await openSession();
      languageRef.current = session.language;

      if (closedRef.current) {
        microphone.getTracks().forEach((track) => track.stop());
        settle(true);
        return false;
      }

      const SpeechOutput = session.realtime.tts.provider === "gemini" ? GeminiTutorSpeechOutput : TutorSpeechOutput;
      const output = new SpeechOutput(
        {
          url: session.realtime.tts.url,
          apiKey: session.realtime.tts.apiKey,
          model: session.realtime.tts.model,
          voice: session.realtime.tts.voice,
          language: session.language,
        },
        { onError: () => setError(t("tutor.error.connection")) },
      );
      const input = new TutorSpeechInput(
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

      outputRef.current = output;
      inputRef.current = input;
      await output.connect();
      await output.resumeAudio();
      await input.start(microphone);
      input.setMuted(true);
      startedAtRef.current = Date.now();
      return true;
    } catch (caught) {
      microphone.getTracks().forEach((track) => track.stop());
      inputRef.current?.close();
      outputRef.current?.close();
      inputRef.current = null;
      outputRef.current = null;
      settle(true);
      return fallBack(caught instanceof Error ? caught.message : t("exam.oral.error.start"));
    }
  }, [allowText, clearSilence, openSession, settle, t]);

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
        void openSession()
          .then(async (session) => {
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
  }, [openSession, settle, t]);

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
    orbRef,
    languageRef,
    startedAtRef,
    start,
    say,
    listen,
    stopListening,
    hush,
    finish,
    teardown,
  };
}
