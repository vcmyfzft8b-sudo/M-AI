"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { lessonHref } from "@/components/exams/exam-links";
import { ExamScreen } from "@/components/exams/exam-screen";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { mockQuestionCounts, MOCK_DURATIONS } from "@/lib/exams/exam-model";
import type { MockQuestionForLearner, MockResult } from "@/lib/exams/exams-server";

type Attempt = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  questions: MockQuestionForLearner[];
};

type Answer = { selected?: number | null; text?: string; unknown?: boolean };

type Phase =
  | { name: "setup" }
  | { name: "sitting"; attempt: Attempt }
  | { name: "grading"; attempt: Attempt }
  | { name: "result"; result: MockResult };

function answered(question: MockQuestionForLearner, answer: Answer | undefined) {
  if (!answer) {
    return false;
  }

  if (answer.unknown) {
    return true;
  }

  return question.kind === "choice" ? typeof answer.selected === "number" : Boolean(answer.text?.trim());
}

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function ExamMock({
  examId,
  examTitle,
  moduleCount,
  passPercentage,
  hasPaidAccess,
  moduleTitles,
  lastResult,
}: {
  examId: string;
  examTitle: string;
  moduleCount: number;
  passPercentage: number;
  hasPaidAccess: boolean;
  moduleTitles: Record<string, string>;
  lastResult: MockResult | null;
}) {
  const { t } = useTranslations();
  const { navigateWithFeedback } = useInstantNavigation();
  const [phase, setPhase] = useState<Phase>({ name: "setup" });
  const [duration, setDuration] = useState<number>(45);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState<"ai" | "answers">("ai");
  const submitting = useRef(false);
  const answersRef = useRef(answers);
  const examHref = `/app/exams/${examId}`;
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const confirmSheet = useSheet(closeConfirm);
  const counts = mockQuestionCounts(duration);

  const storageKey = phase.name === "sitting" ? `memo-exam-mock:${phase.attempt.id}` : null;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(answers));
    } catch {
      /* Private mode or a full disk: the answers are still held in memory. */
    }
  }, [answers, storageKey]);


  async function start() {
    if (!hasPaidAccess) {
      navigateWithFeedback("/app/start");
      return;
    }

    setStarting(true);
    setError(null);

    const response = await fetch(`/api/exams/${examId}/mock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMinutes: duration }),
    }).catch(() => null);

    if (response?.status === 402) {
      navigateWithFeedback("/app/start");
      return;
    }

    const payload = response?.ok ? ((await response.json()) as { attempt: Attempt }) : null;
    setStarting(false);

    if (!payload) {
      const message = response ? ((await response.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError(message ?? t("exam.mock.error.start"));
      return;
    }

    setAnswers({});
    setFlags({});
    setIndex(0);
    setNow(Date.now());
    setPhase({ name: "sitting", attempt: payload.attempt });
  }

  const submit = useCallback(
    async (attempt: Attempt, current: Record<string, Answer>) => {
      if (submitting.current) {
        return;
      }

      submitting.current = true;
      setConfirmOpen(false);
      setError(null);
      setPhase({ name: "grading", attempt });

      const response = await fetch(`/api/exams/${examId}/mock/${attempt.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: attempt.questions.map((question) => ({ questionId: question.id, ...current[question.id] })),
        }),
      }).catch(() => null);
      const payload = response?.ok ? ((await response.json()) as { result: MockResult | null }) : null;
      submitting.current = false;

      if (!payload?.result) {
        setError(t("exam.mock.error.submit"));
        setPhase({ name: "sitting", attempt });
        return;
      }

      try {
        window.localStorage.removeItem(`memo-exam-mock:${attempt.id}`);
      } catch {
        /* Nothing to clean up. */
      }

      setTab("ai");
      setPhase({ name: "result", result: payload.result });
    },
    [examId, t],
  );

  const secondsLeft =
    phase.name === "sitting"
      ? phase.attempt.durationMinutes * 60 - (now - new Date(phase.attempt.startedAt).getTime()) / 1000
      : 0;

  /* The clock, and handing in on its own when it runs out. */
  useEffect(() => {
    if (phase.name !== "sitting") {
      return;
    }

    const attempt = phase.attempt;
    const endsAt = new Date(attempt.startedAt).getTime() + attempt.durationMinutes * 60_000;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);

      if (current >= endsAt) {
        void submit(attempt, answersRef.current);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, submit]);

  if (phase.name === "setup") {
    return (
      <ExamScreen
        refreshOnBack
        backHref={examHref}
        backLabel={examTitle}
        backIcon="close"
        title={t("exam.mock.title")}
        cta={
          <button type="button" className="memo-button-coral" disabled={starting} onClick={() => void start()}>
            {starting ? t("exam.mock.starting") : hasPaidAccess ? t("exam.mock.start") : t("exam.mock.paid.cta")}
          </button>
        }
      >
        <div className="memo-exam-center">
          <MemoBuddy mood="wave" size="6.5rem" thought="🎓" sparkles />
          <h1 className="memo-exam-step-title">{t("exam.mock.setup.title")}</h1>
          <p className="memo-exam-fine">{t("exam.mock.setup.body", { count: moduleCount })}</p>
        </div>

        {!hasPaidAccess ? (
          <div className="memo-exam-card memo-exam-upsell">
            <b>{t("exam.mock.paid.title")}</b>
            <p>{t("exam.mock.paid.body")}</p>
          </div>
        ) : null}

        <span className="memo-exam-label">{t("exam.mock.duration")}</span>
        <div className="memo-segment memo-exam-segment">
          {MOCK_DURATIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={duration === value ? "active" : ""}
              aria-pressed={duration === value}
              onClick={() => setDuration(value)}
            >
              {t("exam.minutes", { minutes: value })}
            </button>
          ))}
        </div>

        <div className="memo-exam-card memo-exam-facts">
          <div>
            <Msym name="quiz" size="1.3rem" fill={false} />
            <span>{t("exam.mock.choice")}</span>
            <b>{counts.choice}</b>
          </div>
          <div>
            <Msym name="edit" size="1.3rem" fill={false} />
            <span>{t("exam.mock.written")}</span>
            <b>{counts.written}</b>
          </div>
          <div>
            <Msym name="timer" size="1.3rem" fill={false} />
            <span>{t("exam.mock.duration")}</span>
            <b>{t("exam.minutes", { minutes: duration })}</b>
          </div>
          <div>
            <Msym name="flag" size="1.3rem" fill={false} />
            <span>{t("exam.mock.pass")}</span>
            <b>{passPercentage} %</b>
          </div>
        </div>

        {error ? <p className="memo-inline-error">{error}</p> : null}

        {lastResult ? (
          <button type="button" className="memo-exam-link" onClick={() => setPhase({ name: "result", result: lastResult })}>
            <Msym name="history" size="1.2rem" fill={false} />
            {t("exam.mock.lastResult", { grade: lastResult.grade, percent: Math.round(lastResult.percentage) })}
          </button>
        ) : null}
      </ExamScreen>
    );
  }

  if (phase.name === "grading") {
    return (
      <ExamScreen
        refreshOnBack
        backHref={examHref}
        backLabel={examTitle}
        backIcon="close"
        title={t("exam.mock.title")}
      >
        <div className="memo-exam-center memo-exam-grading" role="status" aria-live="polite">
          <MemoBuddy mood="think" size="7rem" thought="📝" />
          <h1 className="memo-exam-step-title">{t("exam.mock.grading.title")}</h1>
          <p className="memo-exam-fine">{t("exam.mock.grading.body")}</p>
          <span className="memo-gen-track" aria-hidden="true">
            <span />
          </span>
        </div>
      </ExamScreen>
    );
  }

  if (phase.name === "result") {
    const { result } = phase;
    const weakTitle = result.weakestLectureId ? moduleTitles[result.weakestLectureId] : null;

    return (
      <ExamScreen
        refreshOnBack
        backHref={examHref}
        backLabel={examTitle}
        backIcon="close"
        title={t("exam.mock.result.title")}
        cta={
          <div className="memo-exam-cta-row">
            <button type="button" className="memo-button-ghost" onClick={() => setPhase({ name: "setup" })}>
              {t("exam.mock.result.retry")}
            </button>
            {result.weakestLectureId ? (
              <button
                type="button"
                className="memo-button-coral"
                onClick={() => navigateWithFeedback(lessonHref(examId, result.weakestLectureId!, "quiz"), { refresh: true })}
              >
                {t("exam.mock.result.practice")}
              </button>
            ) : (
              <button type="button" className="memo-button-coral" onClick={() => navigateWithFeedback(examHref, { refresh: true })}>
                {t("exam.lesson.done.back")}
              </button>
            )}
          </div>
        }
      >
        <div className="memo-exam-result-head">
          <MemoBuddy mood={result.passed ? "cheer" : "sad"} size="6rem" sparkles={result.passed} />
          <div>
            <span className="memo-eyebrow">{t("exam.mock.title")}</span>
            <h1>{t("exam.mock.result.grade", { grade: result.grade })}</h1>
            <p>
              {Math.round(result.percentage)} % · {t("exam.mock.result.points", { score: Math.round(result.totalScore * 10) / 10, total: result.maxScore })}
            </p>
          </div>
        </div>

        <div className="memo-exam-card memo-exam-facts">
          <div>
            <Msym name="timer" size="1.3rem" fill={false} />
            <span>{t("exam.mock.duration")}</span>
            <b>{t("exam.mock.result.time", { used: result.minutesUsed, total: result.durationMinutes })}</b>
          </div>
          <div>
            <Msym name="flag" size="1.3rem" fill={false} />
            <span>{t("exam.mock.pass")}</span>
            <b>{result.passed ? t("exam.mock.result.passed") : t("exam.mock.result.failed")}</b>
          </div>
        </div>

        <div className="memo-segment memo-exam-segment">
          <button type="button" className={tab === "ai" ? "active" : ""} aria-pressed={tab === "ai"} onClick={() => setTab("ai")}>
            {t("exam.mock.result.aiReview")}
          </button>
          <button type="button" className={tab === "answers" ? "active" : ""} aria-pressed={tab === "answers"} onClick={() => setTab("answers")}>
            {t("exam.mock.result.answers")}
          </button>
        </div>

        {tab === "ai" ? (
          <div className="memo-exam-feedback">
            <div className="memo-exam-feedback-block good">
              <b>
                <Msym name="thumb_up" size="1.1rem" /> {t("exam.mock.result.strengths")}
              </b>
              {result.strengths.length > 0 ? (
                result.strengths.map((line) => <p key={line}>{line}</p>)
              ) : (
                <p>{t("exam.mock.result.noStrengths")}</p>
              )}
            </div>
            <div className="memo-exam-feedback-block weak">
              <b>
                <Msym name="error" size="1.1rem" /> {t("exam.mock.result.weak")}
              </b>
              {result.weakPoints.length > 0 ? (
                result.weakPoints.map((line) => <p key={line}>{line}</p>)
              ) : (
                <p>{t("exam.mock.result.noWeak")}</p>
              )}
            </div>
            <div className="memo-exam-feedback-block tip">
              <b>
                <Msym name="lightbulb" size="1.1rem" /> {t("exam.mock.result.recs")}
              </b>
              <p>{weakTitle ? t("exam.mock.result.recsBody", { title: weakTitle }) : t("exam.mock.result.recsDone")}</p>
            </div>
          </div>
        ) : (
          <ol className="memo-exam-answers">
            {result.items.map((item, itemIndex) => {
              const right = item.answer.maxScore > 0 && item.answer.score >= item.answer.maxScore * 0.6;
              const yourAnswer =
                item.question.kind === "choice"
                  ? typeof item.answer.selected === "number"
                    ? item.question.options[item.answer.selected]
                    : null
                  : item.answer.text?.trim() || null;

              return (
                <li key={item.question.id} className={right ? "right" : "wrong"}>
                  <div className="memo-exam-answers-head">
                    <span>{t("exam.mock.question", { index: itemIndex + 1, total: result.items.length })}</span>
                    <b>
                      {item.answer.marked
                        ? t("exam.mock.result.points", { score: item.answer.score, total: item.answer.maxScore })
                        : t("test.notMarked")}
                    </b>
                  </div>
                  <p className="memo-exam-answers-q">{item.question.prompt}</p>
                  <p>
                    <span className="memo-palace-model-label">{t("exam.mock.result.yourAnswer")}</span>
                    {item.answer.unknown ? t("test.dontKnow") : (yourAnswer ?? t("exam.mock.result.noAnswer"))}
                  </p>
                  {item.question.kind === "choice" && item.correctIndex !== null ? (
                    <p>
                      <span className="memo-palace-model-label">{t("exam.mock.result.correct")}</span>
                      {item.question.options[item.correctIndex]}
                    </p>
                  ) : item.answer.expectedAnswer ? (
                    <p>
                      <span className="memo-palace-model-label">{t("test.expectedAnswer")}</span>
                      {item.answer.expectedAnswer}
                    </p>
                  ) : null}
                  {item.answer.missingPoints ? (
                    <p>
                      <span className="memo-palace-model-label">{t("test.missing")}</span>
                      {item.answer.missingPoints}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </ExamScreen>
    );
  }

  const { attempt } = phase;
  const question = attempt.questions[index];
  const current = answers[question.id] ?? {};
  const answeredCount = attempt.questions.filter((entry) => answered(entry, answers[entry.id])).length;
  const unanswered = attempt.questions.length - answeredCount;
  const flagged = attempt.questions.filter((entry) => flags[entry.id]).length;
  const isLast = index === attempt.questions.length - 1;
  const setAnswer = (patch: Answer) =>
    setAnswers((existing) => ({ ...existing, [question.id]: { ...existing[question.id], ...patch } }));

  return (
    <ExamScreen
      refreshOnBack
      backHref={examHref}
        backLabel={examTitle}
      backIcon="close"
      title={clock(secondsLeft)}
      trailing={
        <button
          type="button"
          className={`memo-close-button ${flags[question.id] ? "memo-exam-flagged" : ""}`.trim()}
          aria-pressed={Boolean(flags[question.id])}
          aria-label={t("exam.mock.flag")}
          onClick={() => setFlags((existing) => ({ ...existing, [question.id]: !existing[question.id] }))}
        >
          <Msym name="flag" size="1.35rem" fill={Boolean(flags[question.id])} weight={500} />
        </button>
      }
      cta={
        <div className="memo-exam-cta-row">
          <button type="button" className="memo-button-ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            {t("common.back")}
          </button>
          {isLast ? (
            <button type="button" className="memo-button-coral" onClick={() => setConfirmOpen(true)}>
              {t("exam.mock.submit")}
            </button>
          ) : (
            <button type="button" className="memo-primary-pill memo-exam-next" onClick={() => setIndex(index + 1)}>
              {t("exam.mock.next")}
            </button>
          )}
        </div>
      }
    >
      <div className="memo-exam-dots" role="list">
        {attempt.questions.map((entry, entryIndex) => (
          <button
            key={entry.id}
            type="button"
            role="listitem"
            aria-label={t("exam.mock.question", { index: entryIndex + 1, total: attempt.questions.length })}
            className={[
              answered(entry, answers[entry.id]) ? "answered" : "",
              flags[entry.id] ? "flagged" : "",
              entryIndex === index ? "current" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setIndex(entryIndex)}
          />
        ))}
      </div>

      <div className="memo-panel study memo-exam-lesson">
        <p className="memo-exam-fine">
          {t("exam.mock.question", { index: index + 1, total: attempt.questions.length })} ·{" "}
          {question.kind === "choice" ? t("exam.mock.points", { count: 1 }) : t("exam.mock.points", { count: 5 })}
        </p>

        {question.kind === "choice" ? (
          <div className="lecture-quiz-card">
            <span className="memo-quiz-eyebrow">{t("quiz.chooseOne")}</span>
            <p className="lecture-quiz-prompt">{question.prompt}</p>
            <div className="lecture-quiz-options">
              {question.options.map((option, optionIndex) => (
                <button
                  key={`${question.id}-${optionIndex}`}
                  type="button"
                  className={`lecture-quiz-option ${current.selected === optionIndex ? "selected" : ""}`}
                  aria-pressed={current.selected === optionIndex}
                  onClick={() => setAnswer({ selected: optionIndex, unknown: false })}
                >
                  <span className="lecture-quiz-option-label">{String.fromCharCode(65 + optionIndex)}</span>
                  <span className="lecture-quiz-option-copy">{option}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="lecture-practice-stage">
            <p className="lecture-practice-prompt">{question.prompt}</p>
            <textarea
              id={`exam-mock-answer-${question.id}`}
              value={current.text ?? ""}
              disabled={Boolean(current.unknown)}
              onChange={(event) => setAnswer({ text: event.target.value })}
              aria-label={t("test.yourAnswer")}
              className="ios-textarea lecture-practice-textarea"
              placeholder={t("test.answerPlaceholder")}
            />
            <div className="lecture-practice-controls">
              <label className="lecture-practice-unknown">
                <input
                  type="checkbox"
                  checked={Boolean(current.unknown)}
                  onChange={(event) => setAnswer({ unknown: event.target.checked })}
                />
                {t("test.dontKnow")}
              </label>
            </div>
          </div>
        )}
        {error ? <p className="memo-inline-error">{error}</p> : null}
      </div>

      {confirmOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", confirmSheet.closing)}
            onClick={() => confirmSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet", confirmSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-submit-title"
            {...confirmSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <div className="memo-sheet-title">
              <span id="exam-submit-title">{t("exam.mock.submitSheet.title")}</span>
              <button type="button" className="memo-sheet-close" aria-label={t("common.close")} onClick={() => confirmSheet.dismiss()}>
                <Msym name="close" size="1.45rem" fill={false} weight={500} />
              </button>
            </div>
            <div className="memo-exam-card memo-exam-facts">
              <div>
                <Msym name="check_circle" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.answered")}</span>
                <b>
                  {answeredCount} / {attempt.questions.length}
                </b>
              </div>
              <div>
                <Msym name="radio_button_unchecked" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.unanswered")}</span>
                <b>{unanswered}</b>
              </div>
              <div>
                <Msym name="flag" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.flagged")}</span>
                <b>{flagged}</b>
              </div>
              <div>
                <Msym name="timer" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.left")}</span>
                <b>{clock(secondsLeft)}</b>
              </div>
            </div>
            <div className="memo-sheet-actions">
              <button type="button" className="memo-sheet-coral" onClick={() => void submit(attempt, answers)}>
                {t("exam.mock.submit")}
              </button>
              <button type="button" className="memo-sheet-ghost" onClick={() => confirmSheet.dismiss()}>
                {t("exam.mock.submitSheet.back")}
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      <p className="memo-exam-fine memo-exam-sitting-note">
        <Emoji symbol="⏱️" size="1rem" /> {t("exam.mock.sittingNote")}
      </p>
    </ExamScreen>
  );
}
