"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { useExamVoice } from "@/components/exams/use-exam-voice";
import { voiceHue } from "@/lib/tutor/voice-colors";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";

/*
 * The oral mock exam, as Astra runs it: a voice examiner asks the exam's questions one by one,
 * listens to the spoken answer, asks at most one follow-up, and moves on. It runs on the voice
 * tutor's own pieces (`useExamVoice`); the examiner's lines come from `/mock/[attemptId]/oral`.
 * The answers, transcribed, are handed back to be graded like a written mock.
 */

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
  const [index, setIndex] = useState(0);
  const answersRef = useRef<Record<string, string>>({});
  const currentRef = useRef({ index: 0, followedUp: false });
  const endAnswerRef = useRef<(unknown?: boolean) => Promise<void>>(async () => undefined);
  const voiceSession = useExamVoice({ lectureId, voice, onAnswerEnd: () => void endAnswerRef.current() });
  const { phase, heard, error, elapsed, orbRef, say, listen, stopListening, setPhase, teardown } = voiceSession;

  const finish = useCallback(() => {
    if (voiceSession.phaseRef.current === "finished") {
      return;
    }

    voiceSession.finish();
    onDone(answersRef.current);
  }, [onDone, voiceSession]);

  const ask = useCallback(
    async (questionIndex: number) => {
      const question = questions[questionIndex];

      if (!question) {
        finish();
        return;
      }

      currentRef.current = { index: questionIndex, followedUp: false };
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
      if (voiceSession.phaseRef.current !== "listening") {
        return;
      }

      const heardNow = stopListening();
      const current = currentRef.current;
      const question = questions[current.index];
      const said = unknown ? "" : heardNow;
      answersRef.current[question.id] = [answersRef.current[question.id], said].filter(Boolean).join(" ");
      setPhase("thinking");

      const response = await fetch(`/api/exams/${examId}/mock/${attemptId}/oral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionIndex: current.index,
          answer: answersRef.current[question.id] ?? "",
          alreadyFollowedUp: current.followedUp || unknown,
          language: voiceSession.languageRef.current,
        }),
      }).catch(() => null);
      const turn = response?.ok ? ((await response.json()) as { speech: string; followUp: boolean }) : null;
      const outOfTime = (Date.now() - voiceSession.startedAtRef.current) / 1000 >= durationMinutes * 60;

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
    [ask, attemptId, durationMinutes, examId, finish, listen, questions, say, setPhase, stopListening, t, voiceSession],
  );

  useEffect(() => {
    endAnswerRef.current = endAnswer;
  });

  /* Starting: the microphone first, then the talking time and keys, then the first question. */
  useEffect(() => {
    let cancelled = false;

    void voiceSession.start().then((started) => {
      if (started && !cancelled) {
        void ask(0);
      }
    });

    return () => {
      cancelled = true;
      teardown();
    };
    // Started once for the life of the exam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
