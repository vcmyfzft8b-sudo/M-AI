"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { storedTutorVoice, useExamVoice } from "@/components/exams/use-exam-voice";
import { tutorStepPoints, type TutorVerdict } from "@/lib/exams/exam-model";
import type { TutorStep } from "@/lib/exams/exam-tutor-server";
import { voiceHue } from "@/lib/tutor/voice-colors";

/*
 * A topic's tutor lesson: the voice tutor explains the topic a point at a time and, after each
 * point, asks about it and listens. An answer right at the first ask scores in full; otherwise the
 * tutor says what was missing, asks once more (half), then gives the answer and goes on. The
 * learner may type instead of speaking at any time, and without a microphone or talking time the
 * whole lesson runs in writing.
 */

export function ExamTutorLesson({
  examId,
  topicId,
  lectureId,
  topicTitle,
  steps,
  onFinish,
  onReact,
}: {
  examId: string;
  topicId: string;
  lectureId: string;
  topicTitle: string;
  steps: TutorStep[];
  /** Points scored (each step 0..1) out of the number of steps. */
  onFinish: (points: number, total: number) => void;
  onReact: (mood: "happy" | "sad") => void;
}) {
  const { t } = useTranslations();
  const [voice] = useState(storedTutorVoice);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  /* In writing, the tutor's reply waits to be read: the next point comes when the learner goes on. */
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const continueRef = useRef<(() => void) | null>(null);
  const verdictsRef = useRef<TutorVerdict[][]>([]);
  const currentRef = useRef({ index: 0, attempt: 1 });
  const endAnswerRef = useRef<(answer?: string) => Promise<void>>(async () => undefined);
  const session = useExamVoice({ lectureId, voice, allowText: true, onAnswerEnd: () => void endAnswerRef.current() });
  const { phase, heard, line, error, textMode, orbRef, say, listen, stopListening, setPhase, teardown } = session;

  const finish = useCallback(() => {
    if (session.phaseRef.current === "finished") {
      return;
    }

    session.finish();
    const points = steps.reduce((sum, _, stepIndex) => sum + tutorStepPoints(verdictsRef.current[stepIndex] ?? []), 0);
    onFinish(points, steps.length);
  }, [onFinish, session, steps]);

  const teach = useCallback(
    async (stepIndex: number) => {
      const step = steps[stepIndex];

      if (!step) {
        finish();
        return;
      }

      currentRef.current = { index: stepIndex, attempt: 1 };
      setIndex(stepIndex);
      setTyped("");
      const lead = stepIndex === 0 ? `${t("exam.tutor.intro", { topic: topicTitle })} ` : "";
      // Spoken whole; written out, the question stands on its own under the explanation.
      await say(`${lead}${step.explain} ${step.question}`, `${lead}${step.explain}`);
      listen();
    },
    [finish, listen, say, steps, t, topicTitle],
  );

  /* An answer is in (spoken, typed, or "I don't know" as an empty one): mark it and reply. */
  const endAnswer = useCallback(
    async (answer?: string) => {
      if (session.phaseRef.current !== "listening") {
        return;
      }

      const spoken = stopListening();
      const given = (answer ?? spoken).trim();
      const { index: stepIndex, attempt } = currentRef.current;
      const step = steps[stepIndex];
      setPhase("thinking");
      setTyped("");

      const response = await fetch(`/api/exams/${examId}/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId,
          question: step.question,
          answerGuide: step.answerGuide,
          answer: given,
          attempt,
          isLast: stepIndex >= steps.length - 1,
          language: session.languageRef.current,
        }),
      }).catch(() => null);
      const turn = response?.ok
        ? ((await response.json()) as { verdict: TutorVerdict; speech: string; askAgain: boolean })
        : null;
      const verdict: TutorVerdict = turn?.verdict ?? (given ? "partial" : "wrong");
      verdictsRef.current[stepIndex] = [...(verdictsRef.current[stepIndex] ?? []), verdict];
      onReact(verdict === "correct" ? "happy" : "sad");

      if (turn?.speech) {
        await say(turn.speech);
      }

      if (textMode && !turn?.askAgain) {
        setAwaitingContinue(true);
        await new Promise<void>((resolve) => {
          continueRef.current = resolve;
        });
        setAwaitingContinue(false);
      }

      if (turn?.askAgain) {
        currentRef.current = { index: stepIndex, attempt: 2 };
        listen();
        return;
      }

      if (stepIndex >= steps.length - 1) {
        finish();
        return;
      }

      void teach(stepIndex + 1);
    },
    [examId, finish, listen, onReact, say, session, setPhase, steps, stopListening, teach, textMode, topicId],
  );

  useEffect(() => {
    endAnswerRef.current = endAnswer;
  });

  /* Starting: the voice if it can have one, writing if not, then the first point. */
  useEffect(() => {
    let cancelled = false;

    void session.start().then((started) => {
      if (started && !cancelled) {
        void teach(0);
      }
    });

    return () => {
      cancelled = true;
      teardown();
    };
    // Started once for the life of the lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitTyped(event: FormEvent) {
    event.preventDefault();

    if (typed.trim()) {
      void endAnswer(typed);
    }
  }

  const step = steps[index];
  const status =
    phase === "preparing"
      ? t("exam.tutor.state.preparing")
      : phase === "speaking"
        ? textMode
          ? t("exam.tutor.state.reading")
          : t("exam.tutor.state.speaking")
        : phase === "listening"
          ? textMode
            ? t("exam.tutor.state.typing")
            : t("exam.tutor.state.listening")
          : phase === "thinking"
            ? t("exam.tutor.state.thinking")
            : t("exam.oral.state.finished");

  return (
    <div className={`memo-tutor memo-exam-oral memo-exam-tutor phase-${phase} ${textMode ? "in-writing" : ""}`.trim()} style={{ "--orb-hue": voiceHue(voice) } as CSSProperties}>
      <div className="memo-exam-oral-top">
        <span>{t("exam.tutor.step", { index: index + 1, total: steps.length })}</span>
        {textMode ? (
          <span className="memo-exam-tutor-mode">
            <Msym name="keyboard" size="1.05rem" fill={false} /> {t("exam.tutor.textMode")}
          </span>
        ) : null}
      </div>

      {/* The tutor's sphere follows the voice; in writing, Memo is the tutor. */}
      {textMode ? (
        <MemoBuddy mood={phase === "thinking" ? "think" : "idle"} size="4.6rem" />
      ) : (
        <div className="memo-orb" ref={orbRef} aria-hidden="true">
          <span className="memo-orb-glow" />
          <span className="memo-orb-body" />
          <span className="memo-orb-ring" />
          <span className="memo-orb-ring second" />
        </div>
      )}

      <p className="memo-tutor-statusrow" role="status" aria-live="polite">
        <span className="memo-tutor-status-dot" />
        {status}
      </p>

      {/* What the tutor says, written out as it speaks: the whole lesson in writing without a voice. */}
      {line ? <p className="memo-exam-tutor-line">{line}</p> : null}
      {step && phase !== "preparing" && phase !== "finished" ? <p className="memo-exam-oral-question">{step.question}</p> : null}

      <div className="memo-tutor-caption">
        {heard ? <p className={`memo-tutor-heard ${phase === "listening" ? "draft" : ""}`.trim()}>{heard}</p> : null}
      </div>

      {error && !textMode ? <p className="memo-inline-error memo-tutor-error">{error}</p> : null}

      {phase === "listening" ? (
        <form className="memo-exam-tutor-type" onSubmit={submitTyped}>
          <input
            className="memo-field"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={textMode ? t("exam.tutor.typePlaceholder") : t("exam.tutor.orType")}
            aria-label={t("exam.tutor.typePlaceholder")}
            enterKeyHint="send"
          />
          <button type="submit" className="memo-close-button" aria-label={t("exam.tutor.send")} disabled={!typed.trim()}>
            <Msym name="arrow_upward" size="1.3rem" fill={false} weight={600} />
          </button>
        </form>
      ) : null}

      <div className="memo-exam-oral-actions">
        {phase === "listening" ? (
          <>
            <button type="button" className="memo-button-ghost" onClick={() => void endAnswer("")}>
              {t("test.dontKnow")}
            </button>
            {textMode ? null : (
              <button type="button" className="memo-primary-pill" onClick={() => void endAnswer()}>
                {t("exam.oral.done")}
              </button>
            )}
          </>
        ) : null}
        {awaitingContinue ? (
          <button type="button" className="memo-primary-pill" onClick={() => continueRef.current?.()}>
            {index >= steps.length - 1 ? t("exam.tutor.finish") : t("exam.tutor.next")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
