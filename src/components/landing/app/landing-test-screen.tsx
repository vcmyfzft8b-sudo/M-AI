"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Loader2 } from "lucide-react";

import { useT } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { StudyPracticeQuestion } from "@/components/study-question";
import { PRACTICE_QUESTION_MAX_SCORE } from "@/lib/practice-test-scoring";

import { LandingAppScope, type LandingAppTheme } from "./landing-app-scope";
import {
  defaultLandingTest,
  useLandingAutoplay,
  useLandingAutoplayStep,
  type LandingAutoplayStep,
  type LandingTestContent,
  type LandingTestQuestion,
} from "./landing-study-content";

/*
 * The note's Test tab, as the phone draws it below the pill row.
 *
 * Transcribed from the practice-test branch of `lecture-workspace.tsx`: the start screen,
 * one open question at a time with Back / Next / Submit, and the graded attempt — the
 * app's `StudyCompletionCard` over the attempt history, and the breakdown under it.
 *
 * Nothing is sent anywhere. The mark is faked, deterministically, from how many of the
 * question's keyword stems the answer contains; the pause before it stands in for the
 * grader.
 */

const GRADING_DELAY_MS = 1400;

type GradedAnswer = {
  id: string;
  prompt: string;
  expectedAnswer: string;
  typed: string;
  unknown: boolean;
  score: number;
};

type Phase = "start" | "answering" | "graded";

function markAnswer(question: LandingTestQuestion, typed: string, unknown: boolean): number {
  if (unknown || !typed.trim()) {
    return 0;
  }

  const answer = typed.toLowerCase();
  const matched = question.keywords.filter((stem) => answer.includes(stem)).length;

  return matched >= 2 ? PRACTICE_QUESTION_MAX_SCORE : matched === 1 ? 3 : 1;
}

export function LandingTestScreen({
  theme,
  content,
  autoplay = false,
  className,
}: {
  theme?: LandingAppTheme;
  content?: LandingTestContent;
  autoplay?: boolean;
  className?: string;
}) {
  const t = useT();
  const test = useMemo(() => content ?? defaultLandingTest(t), [content, t]);
  const questions = test.questions;
  const [phase, setPhase] = useState<Phase>("start");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [unknownIds, setUnknownIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [graded, setGraded] = useState<GradedAnswer[]>([]);
  const [taken, setTaken] = useState<number[]>([]);
  const gradeTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (gradeTimerRef.current) {
        window.clearTimeout(gradeTimerRef.current);
      }
    },
    [],
  );

  const start = useCallback(() => {
    setAnswers({});
    setUnknownIds([]);
    setIndex(0);
    setPhase("answering");
  }, []);

  const setAnswer = useCallback((id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
  }, []);

  const toggleUnknown = (id: string, enabled: boolean) => {
    setUnknownIds((current) =>
      enabled ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id),
    );

    if (enabled) {
      setAnswers((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const submit = useCallback(() => {
    if (submitting) {
      return;
    }

    const result = questions.map((question) => {
      const typed = answers[question.id] ?? "";
      const unknown = unknownIds.includes(question.id);

      return {
        id: question.id,
        prompt: question.prompt,
        expectedAnswer: question.expectedAnswer,
        typed,
        unknown,
        score: markAnswer(question, typed, unknown),
      };
    });

    setSubmitting(true);
    gradeTimerRef.current = window.setTimeout(() => {
      gradeTimerRef.current = null;
      const total = result.reduce((sum, answer) => sum + answer.score, 0);
      const max = result.length * PRACTICE_QUESTION_MAX_SCORE;

      setGraded(result);
      setTaken((current) => [...current, max > 0 ? Math.round((total / max) * 100) : 0]);
      setSubmitting(false);
      setPhase("graded");
    }, GRADING_DELAY_MS);
  }, [answers, questions, submitting, unknownIds]);

  const total = questions.length;
  const current = Math.min(index, Math.max(total - 1, 0));
  const question = questions[current] ?? null;
  const isLast = current === total - 1;
  const answeredCount = questions.filter(
    (item) => unknownIds.includes(item.id) || Boolean(answers[item.id]?.trim()),
  ).length;

  const history = [...test.history, ...taken];
  const latestPercentage = taken[taken.length - 1] ?? 0;
  const scored = graded.reduce((sum, answer) => sum + answer.score, 0);
  const average = history.length
    ? Math.round(history.reduce((sum, value) => sum + value, 0) / history.length)
    : null;

  const next = () => {
    if (!isLast) {
      setIndex((value) => Math.min(total - 1, value + 1));
      return;
    }

    submit();
  };

  /*
   * The walkthrough: start, write each answer out, move on, submit, read the result,
   * and start again.
   */
  const { running } = useLandingAutoplay(autoplay, rootRef);
  let step: LandingAutoplayStep = null;

  if (phase === "start") {
    step = { key: "start", delay: 1800, run: start };
  } else if (phase === "graded") {
    step = { key: `again-${taken.length}`, delay: 5200, run: start };
  } else if (question && !submitting) {
    const typed = answers[question.id] ?? "";
    const target = question.expectedAnswer;

    step =
      typed.length < target.length && target.startsWith(typed)
        ? {
            key: `type-${current}-${typed.length}`,
            delay: typed.length === 0 ? 900 : 42,
            run: () => setAnswer(question.id, target.slice(0, typed.length + 1)),
          }
        : { key: `next-${current}`, delay: 1000, run: next };
  }

  useLandingAutoplayStep(running, step);

  return (
    <LandingAppScope
      theme={theme}
      className={["landing-study-screen", className].filter(Boolean).join(" ")}
    >
      <div ref={rootRef} className="landing-study-frame" data-note-tab="test">
        <div className="memo-panel study">
          <div className="workspace-panel-stack lecture-panel-stack">
            <div className="ios-card lecture-study-shell auto-height">
              {phase === "answering" && question ? (
                <div className="lecture-practice-shell">
                  <div className="lecture-practice-stage">
                    <div className="memo-test-meta">
                      <span className="memo-test-no">{t("quiz.questionN", { index: current + 1 })}</span>
                      <span className="memo-test-count">
                        {current + 1} / {total}
                      </span>
                    </div>
                    <div className="memo-progress test">
                      <div
                        style={{
                          width: `${total > 0 ? Math.round(((current + 1) / total) * 100) : 0}%`,
                        }}
                      />
                    </div>

                    <StudyPracticeQuestion
                      prompt={question.prompt}
                      answer={answers[question.id] ?? ""}
                      unknown={unknownIds.includes(question.id)}
                      disabled={submitting}
                      onAnswer={(value) => setAnswer(question.id, value)}
                      onUnknown={(value) => toggleUnknown(question.id, value)}
                    />

                    <div className="memo-test-actions">
                      <button
                        type="button"
                        className="memo-test-prev"
                        disabled={current === 0 || submitting}
                        onClick={() => setIndex((value) => Math.max(0, value - 1))}
                      >
                        {t("common.back")}
                      </button>
                      <button
                        type="button"
                        className="memo-test-next"
                        disabled={isLast && (submitting || answeredCount < total)}
                        onClick={next}
                      >
                        {isLast && submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {t(isLast ? "test.submit" : "common.next")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="lecture-practice-shell">
                  {phase === "graded" ? (
                    <div className="lecture-practice-results">
                      <StudyCompletionCard
                        eyebrow=""
                        title=""
                        subtitle={t("test.attemptN", { count: history.length })}
                        percentage={latestPercentage}
                        percentageLabel={t("study.score")}
                        primaryMetric={{
                          label: t("test.pointsScored"),
                          value: `${scored}/${graded.length * PRACTICE_QUESTION_MAX_SCORE}`,
                        }}
                        secondaryMetrics={[
                          { label: t("test.average"), value: average == null ? "-" : `${average}%` },
                          {
                            label: t("test.best"),
                            value: history.length ? `${Math.max(...history)}%` : "-",
                          },
                          {
                            label: t("test.lowest"),
                            value: history.length ? `${Math.min(...history)}%` : "-",
                          },
                          { label: t("test.attempts"), value: String(history.length) },
                        ]}
                        actions={
                          <button
                            type="button"
                            onClick={start}
                            className="lecture-study-refresh lecture-practice-start-button"
                          >
                            {t("study.test.startNew")}
                          </button>
                        }
                      />

                      <details className="lecture-practice-breakdown">
                        <summary>
                          <span className="lecture-practice-breakdown-icon" aria-hidden="true">
                            📝
                          </span>
                          <span className="lecture-practice-breakdown-label">{t("test.breakdown")}</span>
                          <span className="lecture-practice-breakdown-chevron" aria-hidden="true">
                            ▾
                          </span>
                        </summary>
                        <div className="lecture-practice-feedback-list">
                          {graded.map((answer, answerIndex) => (
                            <details key={answer.id} className="lecture-practice-feedback-card">
                              <summary className="lecture-practice-feedback-summary">
                                <span className="lecture-practice-feedback-label">
                                  {t("quiz.questionN", { index: answerIndex + 1 })}
                                </span>
                                <span className="lecture-practice-feedback-meta">
                                  <span>{`${answer.score}/${PRACTICE_QUESTION_MAX_SCORE}`}</span>
                                  <span className="lecture-practice-feedback-chevron" aria-hidden="true">
                                    ▾
                                  </span>
                                </span>
                              </summary>
                              <div className="lecture-practice-feedback-body">
                                <p className="lecture-practice-prompt">{answer.prompt}</p>
                                {answer.typed ? (
                                  <p className="lecture-practice-feedback-copy">
                                    <strong>{t("test.yourAnswer")}</strong> {answer.typed}
                                  </p>
                                ) : null}
                                <p className="lecture-practice-feedback-copy">
                                  <strong>{t("test.explanation")}</strong>{" "}
                                  {answer.unknown
                                    ? t("test.skipped")
                                    : t(
                                        answer.score >= PRACTICE_QUESTION_MAX_SCORE
                                          ? "landingStudy.test.feedbackFull"
                                          : answer.score > 1
                                            ? "landingStudy.test.feedbackPartial"
                                            : "landingStudy.test.feedbackMissed",
                                      )}
                                </p>
                                <p className="lecture-practice-feedback-copy">
                                  <strong>{t("test.expectedAnswer")}</strong> {answer.expectedAnswer}
                                </p>
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="memo-study-empty">
                      <div className="memo-study-empty-orb">
                        <Emoji symbol="📝" size="4.4rem" />
                      </div>
                      <span className="memo-study-empty-title">{t("note.subScreen.test")}</span>
                      <span className="memo-study-empty-copy">{t("test.intro")}</span>
                      <button type="button" onClick={start} className="memo-study-empty-cta">
                        <Msym name="assignment" size="1.2rem" fill={false} weight={500} />
                        {t("study.test.startNew")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </LandingAppScope>
  );
}
