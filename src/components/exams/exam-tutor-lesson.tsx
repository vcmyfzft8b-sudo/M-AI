"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { ExamVoicePicker } from "@/components/exams/exam-voice-picker";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { storedTutorVoice, useExamVoice } from "@/components/exams/use-exam-voice";
import { tutorStepPoints, type TutorVerdict } from "@/lib/exams/exam-model";
import type { TutorStep } from "@/lib/exams/exam-tutor-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { voiceHue } from "@/lib/tutor/voice-colors";

/*
 * A topic's tutor lesson, as the app's voice tutor runs a note (`LectureTutor`): the same sphere
 * riding the voice, the same one-word status with its dot, only the learner's own words captioned,
 * the topic row with its bar, and the same round transport. It is a conversation: the tutor
 * explains a point out loud and asks about it, the learner answers out loud, and going quiet ends
 * the answer. Right at the first ask scores in full; otherwise the tutor says what was missing and
 * asks once more (half), then gives the answer and goes on.
 *
 * Without a microphone or talking time there is no voice, so the lesson runs in writing: the
 * tutor's lines are shown, Memo stands in for the sphere, and the answers are typed.
 */

type Stage = "idle" | "running" | "paused";

/*
 * The silence that ends an answer only starts once the learner has said something; a learner who
 * says nothing at all is taken, after this long, not to know, and the tutor teaches the answer.
 */
const NO_SPEECH_MS = 20_000;

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
  const [voice, setVoice] = useState(storedTutorVoice);
  const [stage, setStage] = useState<Stage>("idle");
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [pickingVoice, setPickingVoice] = useState(false);
  /* In writing, the tutor's reply waits to be read: the next point comes when the learner goes on. */
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const continueRef = useRef<(() => void) | null>(null);
  const verdictsRef = useRef<TutorVerdict[][]>([]);
  const currentRef = useRef({ index: 0, attempt: 1 });
  /* Each run of the conversation; a pause, a repeat or the end starts a new one, and the old one stops where it is. */
  const flowRef = useRef(0);
  const endAnswerRef = useRef<(answer?: string) => Promise<void>>(async () => undefined);
  const session = useExamVoice({ lectureId, voice, allowText: true, onAnswerEnd: () => void endAnswerRef.current() });
  const { phase, heard, line, error, textMode, orbRef, say, listen, stopListening, setPhase, hush } = session;

  /* The lesson is over (or ended): its score goes to the lesson's own result screen, as every lesson's does. */
  const wrapUp = useCallback(() => {
    flowRef.current += 1;
    session.finish();
    const points = steps.reduce((sum, _, stepIndex) => sum + tutorStepPoints(verdictsRef.current[stepIndex] ?? []), 0);
    onFinish(points, steps.length);
  }, [onFinish, session, steps]);

  const teach = useCallback(
    async (stepIndex: number) => {
      const step = steps[stepIndex];

      if (!step) {
        wrapUp();
        return;
      }

      const flow = ++flowRef.current;
      currentRef.current = { index: stepIndex, attempt: 1 };
      setIndex(stepIndex);
      setTyped("");
      const lead = stepIndex === 0 ? `${t("exam.tutor.intro", { topic: topicTitle })} ` : "";
      // Spoken whole; written out (without a voice), the question stands on its own under the explanation.
      await say(`${lead}${step.explain} ${step.question}`, `${lead}${step.explain}`);

      if (flow === flowRef.current) {
        listen();
      }
    },
    [listen, say, steps, t, topicTitle, wrapUp],
  );

  /* An answer is in (spoken, or typed in writing): mark it, and the tutor answers back. */
  const endAnswer = useCallback(
    async (answer?: string) => {
      if (session.phaseRef.current !== "listening") {
        return;
      }

      const flow = flowRef.current;
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

      if (flow !== flowRef.current) {
        return;
      }

      const turn = response?.ok
        ? ((await response.json()) as { verdict: TutorVerdict; speech: string; askAgain: boolean })
        : null;
      const verdict: TutorVerdict = turn?.verdict ?? (given ? "partial" : "wrong");
      verdictsRef.current[stepIndex] = [...(verdictsRef.current[stepIndex] ?? []), verdict];
      onReact(verdict === "correct" ? "happy" : "sad");

      if (turn?.speech) {
        await say(turn.speech);
      }

      if (flow !== flowRef.current) {
        return;
      }

      if (turn?.askAgain) {
        currentRef.current = { index: stepIndex, attempt: 2 };
        listen();
        return;
      }

      if (textMode) {
        setAwaitingContinue(true);
        await new Promise<void>((resolve) => {
          continueRef.current = resolve;
        });
        setAwaitingContinue(false);

        if (flow !== flowRef.current) {
          return;
        }
      }

      if (stepIndex >= steps.length - 1) {
        wrapUp();
        return;
      }

      void teach(stepIndex + 1);
    },
    [examId, listen, onReact, say, session, setPhase, steps, stopListening, teach, textMode, topicId, wrapUp],
  );

  useEffect(() => {
    endAnswerRef.current = endAnswer;
  });

  /* Nothing heard at all since the question: an empty answer, so the step moves on. */
  const waitingInSilence = stage === "running" && !textMode && phase === "listening" && !heard;

  useEffect(() => {
    if (!waitingInSilence) {
      return;
    }

    const timer = window.setTimeout(() => void endAnswerRef.current(""), NO_SPEECH_MS);
    return () => window.clearTimeout(timer);
  }, [waitingInSilence, index]);

  /* Leaving the screen closes the session and reports the talking time used. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => session.teardown(), []);

  /* "Začni": a tap, so the voice may play; the microphone and talking time, then the first point. */
  async function begin() {
    verdictsRef.current = [];
    setPickingVoice(false);
    setStage("running");

    if (await session.start()) {
      void teach(0);
    }
  }

  /* Cancelling while it prepares goes back to the start, as the app's tutor does. */
  function cancel() {
    flowRef.current += 1;
    session.teardown();
    setStage("idle");
  }

  function pause() {
    flowRef.current += 1;
    continueRef.current = null;
    setAwaitingContinue(false);
    hush();
    setStage("paused");
  }

  /* Resuming, or going back over the point, explains the current point again from its start. */
  function replayPoint() {
    flowRef.current += 1;
    continueRef.current = null;
    setAwaitingContinue(false);
    hush();
    setStage("running");
    void teach(currentRef.current.index);
  }

  /* The voice dropped: the same point again, in writing. */
  function continueInWriting() {
    flowRef.current += 1;
    continueRef.current = null;
    setAwaitingContinue(false);
    session.switchToText();
    setStage("running");
    void teach(currentRef.current.index);
  }

  function submitTyped(event: FormEvent) {
    event.preventDefault();

    if (typed.trim()) {
      void endAnswer(typed);
    }
  }

  const running = stage === "running" || stage === "paused";
  const preparing = running && phase === "preparing";
  const statusKey: MessageKey | null =
    stage === "paused"
      ? "tutor.state.paused"
      : phase === "speaking"
        ? "tutor.state.speaking"
        : phase === "listening"
          ? "tutor.state.listening"
          : phase === "thinking"
            ? "tutor.state.thinking"
            : null;

  return (
    <div
      className={`memo-tutor memo-exam-tutor phase-${stage === "paused" ? "paused" : running ? phase : "idle"} ${
        textMode ? "in-writing" : ""
      }`.trim()}
      style={{ "--orb-hue": voiceHue(voice) } as CSSProperties}
    >
      {/* The sphere rides whichever voice is in the room; in writing, Memo is the tutor. */}
      {textMode && running ? (
        <MemoBuddy mood={phase === "thinking" ? "think" : "idle"} size="5rem" />
      ) : (
        <div className="memo-orb" ref={orbRef} aria-hidden="true">
          <span className="memo-orb-glow" />
          <span className="memo-orb-body" />
          <span className="memo-orb-ring" />
          <span className="memo-orb-ring second" />
        </div>
      )}

      {stage === "idle" ? (
        <div className="memo-tutor-intro">
          <p className="memo-tutor-title">{t("exam.tutor.idle.title")}</p>
          <p className="memo-tutor-lede">{t("exam.tutor.idle.lede")}</p>
        </div>
      ) : preparing ? (
        <div className="memo-tutor-loading-copy" role="status">
          <p className="memo-tutor-title">{t("tutor.state.preparing")}</p>
          <p className="memo-tutor-lede">{t("tutor.state.preparingHint")}</p>
        </div>
      ) : statusKey ? (
        <p className="memo-tutor-statusrow" role="status">
          <span className="memo-tutor-status-dot" aria-hidden="true" />
          {t(statusKey)}
        </p>
      ) : null}

      {/* The tutor speaks; only the learner's own words are captioned, as in the app's tutor. */}
      {running && !preparing && !textMode ? (
        <div className="memo-tutor-caption" aria-live="off">
          {heard ? <p className={`memo-tutor-heard ${phase === "listening" ? "draft" : ""}`.trim()}>{heard}</p> : null}
        </div>
      ) : null}

      {/* In writing: the tutor's line, the question, and a box to answer in. */}
      {running && textMode && stage !== "paused" ? (
        <>
          {line ? <p className="memo-exam-tutor-line">{line}</p> : null}
          {phase === "listening" || phase === "thinking" ? (
            <p className="memo-exam-oral-question">{steps[index]?.question}</p>
          ) : null}
          {phase === "listening" ? (
            <form className="memo-exam-tutor-type" onSubmit={submitTyped}>
              <input
                className="memo-field"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={t("exam.tutor.typePlaceholder")}
                aria-label={t("exam.tutor.typePlaceholder")}
                enterKeyHint="send"
              />
              <button type="submit" className="memo-close-button" aria-label={t("exam.tutor.send")} disabled={!typed.trim()}>
                <Msym name="arrow_upward" size="1.3rem" fill={false} weight={600} />
              </button>
            </form>
          ) : null}
          {awaitingContinue ? (
            <button type="button" className="memo-tutor-second" onClick={() => continueRef.current?.()}>
              <span>{index >= steps.length - 1 ? t("exam.tutor.finish") : t("exam.tutor.next")}</span>
              <Msym name="arrow_forward" size="1.2rem" fill={false} weight={500} />
            </button>
          ) : null}
          <p className="memo-tutor-hint">{t("exam.tutor.textHint")}</p>
        </>
      ) : null}

      {/* Spoken answers end on their own when the learner goes quiet; these end one at once. */}
      {stage === "running" && !textMode && phase === "listening" ? (
        <div className="memo-exam-oral-actions">
          <button type="button" className="memo-button-ghost" onClick={() => void endAnswer("")}>
            {t("test.dontKnow")}
          </button>
          <button type="button" className="memo-primary-pill" onClick={() => void endAnswer()}>
            {t("exam.oral.done")}
          </button>
        </div>
      ) : null}

      {error && !textMode ? (
        <>
          <p className="memo-inline-error memo-tutor-error">{error}</p>
          {running && !preparing ? (
            <button type="button" className="memo-tutor-second" onClick={continueInWriting}>
              <Msym name="keyboard" size="1.2rem" fill={false} weight={500} />
              <span>{t("exam.tutor.toText")}</span>
            </button>
          ) : null}
        </>
      ) : null}

      {/* Where the lesson has got to: the topic, and its points as a bar. */}
      {running && !preparing ? (
        <div className="memo-tutor-topicrow">
          <div className="memo-tutor-topic">
            <span className="memo-tutor-topic-title">{topicTitle}</span>
            <span className="memo-tutor-topic-count">
              {index + 1} / {steps.length}
            </span>
          </div>
          <div
            className="memo-tutor-topicbar"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
            aria-label={topicTitle}
          >
            <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {stage === "idle" ? (
        <>
          {/* The voice, collapsed to one row that shows it and its colour, as the app's tutor has it. */}
          <details
            className="memo-tutor-picker memo-exam-tutor-picker"
            open={pickingVoice}
            onToggle={(event) => setPickingVoice(event.currentTarget.open)}
          >
            <summary className="memo-capture-row memo-tutor-voicerow">
              <span className="memo-tutor-voice-swatch" aria-hidden="true" />
              <span className="memo-capture-row-copy">
                <span>{voice}</span>
                <span>{t("tutor.voice.label")}</span>
              </span>
              <Msym name={pickingVoice ? "expand_more" : "chevron_right"} size="1.5rem" fill={false} weight={400} />
            </summary>
            <div className="memo-exam-tutor-voices">
              <p className="memo-tutor-picker-heading">{t("tutor.voice.hint")}</p>
              <ExamVoicePicker voice={voice} onChange={setVoice} label={t("tutor.voice.label")} />
            </div>
          </details>

          <button type="button" className="memo-tutor-start" onClick={() => void begin()}>
            <Msym name="play_arrow" size="1.3rem" fill weight={500} />
            <span>{t("tutor.start")}</span>
          </button>
        </>
      ) : preparing ? (
        <button type="button" className="memo-button-ghost memo-tutor-cancel" onClick={cancel}>
          {t("common.cancel")}
        </button>
      ) : (
        /* The app tutor's transport: back over the point, pause or carry on, end. */
        <div className="memo-tutor-controls">
          <button type="button" className="memo-tutor-control" onClick={replayPoint} aria-label={t("exam.tutor.repeat")}>
            <Msym name="skip_previous" size="1.45rem" fill={false} weight={500} />
          </button>
          <button
            type="button"
            className="memo-tutor-control primary"
            onClick={stage === "paused" ? replayPoint : pause}
            aria-label={t(stage === "paused" ? "tutor.resume" : "tutor.pause")}
          >
            <Msym name={stage === "paused" ? "play_arrow" : "pause"} size="1.8rem" fill weight={500} />
          </button>
          <button type="button" className="memo-tutor-control" onClick={wrapUp} aria-label={t("tutor.end")}>
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>
      )}
    </div>
  );
}
