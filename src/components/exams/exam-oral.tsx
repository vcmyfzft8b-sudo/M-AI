"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { requestTutorMicrophone, TutorSpeechInput } from "@/lib/tutor/speech-input";
import { GeminiTutorSpeechOutput } from "@/lib/tutor/gemini-speech-output";
import { hasWebAudio, TutorSpeechOutput } from "@/lib/tutor/speech-output";
import { LevelEnvelope } from "@/lib/tutor/turn-audio";
import { voiceHue } from "@/lib/tutor/voice-colors";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";

/*
 * The oral mock exam, as Astra runs it: a voice examiner asks the exam's questions one by one,
 * listens to the spoken answer, asks at most one follow-up, and moves on. It runs on the voice
 * tutor's own pieces (the same Soniox keys, recogniser, speech output, sphere and talking-time
 * allowance); the examiner's lines come from `/mock/[attemptId]/oral`. The answers, transcribed,
 * are handed back to be graded like a written mock.
 */

type Phase = "preparing" | "speaking" | "listening" | "thinking" | "finished";

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

/* After the learner stops talking, this much quiet ends the answer. */
const ANSWER_SILENCE_MS = 3500;
/* A fresh key is fetched this long before the current slice of talking time runs out. */
const RENEW_BEFORE_SECONDS = 25;

export function ExamOral({
  examId,
  attemptId,
  lectureId,
  questions,
  durationMinutes,
  voice,
  onDone,
  onQuit,
}: {
  examId: string;
  attemptId: string;
  /** The note whose tutor session the examiner speaks through (talking time is counted there). */
  lectureId: string;
  questions: { id: string; prompt: string }[];
  durationMinutes: number;
  voice: NoteTtsVoice;
  onDone: (answers: Record<string, string>) => void;
  onQuit: () => void;
}) {
  const { t } = useTranslations();
  const [phase, setPhase] = useState<Phase>("preparing");
  const [index, setIndex] = useState(0);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const phaseRef = useRef<Phase>("preparing");
  const outputRef = useRef<TutorSpeechOutput | GeminiTutorSpeechOutput | null>(null);
  const inputRef = useRef<TutorSpeechInput | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const envelopeRef = useRef(new LevelEnvelope());
  const answersRef = useRef<Record<string, string>>({});
  const currentRef = useRef({ index: 0, followedUp: false, heard: "" });
  const silenceRef = useRef<number | null>(null);
  const grantRef = useRef<{ grantId: string | null; grantedSeconds: number; startedAt: number } | null>(null);
  const startedAtRef = useRef(0);
  const closedRef = useRef(false);
  const renewingRef = useRef(false);
  /* The session's speech language: the examiner speaks it, and the recogniser listens for it. */
  const languageRef = useRef("sl");

  const setPhaseNow = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
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

    if (silenceRef.current !== null) {
      window.clearTimeout(silenceRef.current);
    }

    inputRef.current?.close();
    outputRef.current?.close();
    inputRef.current = null;
    outputRef.current = null;
    settle(true);
  }, [settle]);

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

  /* Says one line and resolves when the last of it has been heard. The microphone is muted meanwhile. */
  const say = useCallback(
    async (text: string) => {
      const output = outputRef.current;

      if (!output || closedRef.current) {
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

  const finish = useCallback(() => {
    if (closedRef.current) {
      return;
    }

    setPhaseNow("finished");
    teardown();
    onDone(answersRef.current);
  }, [onDone, setPhaseNow, teardown]);

  const listen = useCallback(() => {
    if (closedRef.current) {
      return;
    }

    currentRef.current.heard = "";
    setHeard("");
    inputRef.current?.resetUtterance();
    inputRef.current?.setMuted(false);
    setPhaseNow("listening");
  }, [setPhaseNow]);

  const ask = useCallback(
    async (questionIndex: number) => {
      const question = questions[questionIndex];

      if (!question) {
        finish();
        return;
      }

      currentRef.current = { index: questionIndex, followedUp: false, heard: "" };
      setIndex(questionIndex);
      const lead = questionIndex === 0 ? `${t("exam.oral.intro")} ` : "";
      await say(`${lead}${t("exam.oral.question", { index: questionIndex + 1 })} ${question.prompt}`);
      listen();
    },
    [finish, listen, questions, say, t],
  );

  /* The answer is over: the examiner follows up once, or closes the question and asks the next. */
  const endAnswer = useCallback(
    async (unknown = false) => {
      if (phaseRef.current !== "listening" || closedRef.current) {
        return;
      }

      if (silenceRef.current !== null) {
        window.clearTimeout(silenceRef.current);
        silenceRef.current = null;
      }

      inputRef.current?.setMuted(true);
      const current = currentRef.current;
      const question = questions[current.index];
      const said = unknown ? "" : current.heard.trim();
      answersRef.current[question.id] = [answersRef.current[question.id], said].filter(Boolean).join(" ");
      setPhaseNow("thinking");

      const response = await fetch(`/api/exams/${examId}/mock/${attemptId}/oral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionIndex: current.index,
          answer: answersRef.current[question.id] ?? "",
          alreadyFollowedUp: current.followedUp || unknown,
          language: languageRef.current,
        }),
      }).catch(() => null);
      const turn = response?.ok ? ((await response.json()) as { speech: string; followUp: boolean }) : null;
      const outOfTime = (Date.now() - startedAtRef.current) / 1000 >= durationMinutes * 60;

      if (turn?.speech) {
        await say(turn.speech);
      }

      if (turn?.followUp && !outOfTime) {
        currentRef.current.followedUp = true;
        listen();
        return;
      }

      if (outOfTime || current.index >= questions.length - 1) {
        await say(t("exam.oral.closing"));
        finish();
        return;
      }

      void ask(current.index + 1);
    },
    [ask, attemptId, durationMinutes, examId, finish, listen, questions, say, setPhaseNow, t],
  );

  const endAnswerRef = useRef(endAnswer);

  useEffect(() => {
    endAnswerRef.current = endAnswer;
  });

  /* Starting: the microphone first, then the talking time and keys, then the first question. */
  useEffect(() => {
    let cancelled = false;
    // A remount (React's development double mount, or a fast remount) starts a fresh session.
    closedRef.current = false;

    async function start() {
      if (!hasWebAudio()) {
        setError(t("tutor.error.unsupported"));
        return;
      }

      let microphone: MediaStream;

      try {
        microphone = await requestTutorMicrophone();
      } catch {
        setError(t("tutor.error.micDenied"));
        return;
      }

      try {
        const session = await openSession();
        languageRef.current = session.language;

        if (cancelled) {
          microphone.getTracks().forEach((track) => track.stop());
          settle(true);
          return;
        }

        /* The examiner speaks with the tutor's voice: Gemini's, or Soniox's when the server says so. */
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

              setHeard([currentRef.current.heard, text].filter(Boolean).join(" "));

              if (silenceRef.current !== null) {
                window.clearTimeout(silenceRef.current);
                silenceRef.current = null;
              }
            },
            onUtterance: (text) => {
              if (phaseRef.current !== "listening" || !text.trim()) {
                return;
              }

              currentRef.current.heard = [currentRef.current.heard, text.trim()].filter(Boolean).join(" ");
              setHeard(currentRef.current.heard);

              if (silenceRef.current !== null) {
                window.clearTimeout(silenceRef.current);
              }

              silenceRef.current = window.setTimeout(() => void endAnswerRef.current(), ANSWER_SILENCE_MS);
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
        void ask(0);
      } catch (caught) {
        microphone.getTracks().forEach((track) => track.stop());
        setError(caught instanceof Error ? caught.message : t("exam.oral.error.start"));
      }
    }

    void start();

    return () => {
      cancelled = true;
      teardown();
    };
    // Started once for the life of the exam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const left = Math.max(0, durationMinutes * 60 - elapsed);
  const status =
    phase === "preparing"
      ? t("exam.oral.state.preparing")
      : phase === "speaking"
        ? t("exam.oral.state.speaking")
        : phase === "listening"
          ? t("exam.oral.state.listening")
          : phase === "thinking"
            ? t("exam.oral.state.thinking")
            : t("exam.oral.state.finished");

  return (
    <div className={`memo-tutor memo-exam-oral phase-${phase}`} style={{ "--orb-hue": voiceHue(voice) } as CSSProperties}>
      <div className="memo-exam-oral-top">
        <span>{t("exam.mock.question", { index: index + 1, total: questions.length })}</span>
        <span className="memo-exam-oral-clock">
          <Msym name="timer" size="1.05rem" fill={false} />
          {`${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`}
        </span>
      </div>

      <div className="memo-orb" ref={orbRef} aria-hidden="true">
        <span className="memo-orb-glow" />
        <span className="memo-orb-body" />
        <span className="memo-orb-ring" />
        <span className="memo-orb-ring second" />
      </div>

      <p className="memo-tutor-statusrow" role="status" aria-live="polite">
        <span className="memo-tutor-status-dot" />
        {status}
      </p>

      <p className="memo-exam-oral-question">{questions[index]?.prompt}</p>

      <div className="memo-tutor-caption">
        {heard ? <p className={`memo-tutor-heard ${phase === "listening" ? "draft" : ""}`.trim()}>{heard}</p> : null}
      </div>

      {error ? <p className="memo-inline-error memo-tutor-error">{error}</p> : null}

      <div className="memo-exam-oral-actions">
        {phase === "listening" ? (
          <>
            <button type="button" className="memo-button-ghost" onClick={() => void endAnswer(true)}>
              {t("test.dontKnow")}
            </button>
            <button type="button" className="memo-primary-pill" onClick={() => void endAnswer()}>
              {t("exam.oral.done")}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="memo-button-ghost memo-exam-oral-end"
          onClick={() => {
            if (phase === "preparing" || Object.keys(answersRef.current).length === 0) {
              teardown();
              onQuit();
              return;
            }

            finish();
          }}
        >
          <Msym name="close" size="1.2rem" fill={false} /> {t("exam.oral.end")}
        </button>
      </div>
    </div>
  );
}
