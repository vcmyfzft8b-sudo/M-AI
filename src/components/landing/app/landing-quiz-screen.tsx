"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { StudyQuizQuestion } from "@/components/study-question";
import { QUIZ_CORRECT_PAUSE_MS, quizOptionLetter, shuffleIndices } from "@/lib/study/quiz";

import { LandingAppScope, type LandingAppTheme } from "./landing-app-scope";
import {
  defaultLandingQuiz,
  useLandingAutoplay,
  useLandingAutoplayStep,
  type LandingAutoplayStep,
  type LandingQuizQuestion,
} from "./landing-study-content";

/*
 * The note's Quiz tab, as the phone draws it below the pill row.
 *
 * Transcribed from the quiz branch of `lecture-workspace.tsx`: the head, the progress
 * bar, `StudyQuizQuestion` collapsed the way the phone collapses an answered question,
 * the verdict row on a miss, and `StudyCompletionCard` at the end of a round. The same
 * rules — a right answer moves on by itself after `QUIZ_CORRECT_PAUSE_MS`, a miss waits
 * for "Got it", and missed questions come back as the next round — in local state.
 *
 * "See why" hands the miss to the note's chat in the app. There is no chat here, so the
 * button is drawn only when the page gives it somewhere to go (`onReviewWhy`).
 *
 * The first round keeps the stored option order, so the server and the first paint
 * agree; later rounds shuffle as the app does.
 */

type RoundSummary = {
  cycle: number;
  total: number;
  correct: number;
  missed: number;
  missedQuestionIds: string[];
};

type QuizState = {
  queue: string[];
  index: number;
  round: number;
  roundCount: number;
  selections: Record<string, number>;
  orders: Record<string, number[]>;
  summary: RoundSummary | null;
};

function freshQuiz(questions: LandingQuizQuestion[], shuffle: boolean): QuizState {
  return {
    queue: questions.map((question) => question.id),
    index: 0,
    round: 1,
    roundCount: questions.length,
    selections: {},
    orders: Object.fromEntries(
      questions.map((question) => [
        question.id,
        shuffle
          ? shuffleIndices(question.options.length)
          : question.options.map((_, index) => index),
      ]),
    ),
    summary: null,
  };
}

export function LandingQuizScreen({
  theme,
  content,
  autoplay = false,
  className,
  onReviewWhy,
}: {
  theme?: LandingAppTheme;
  content?: LandingQuizQuestion[];
  autoplay?: boolean;
  className?: string;
  /** "See why": the app opens the note's chat with the question. Omit to hide it. */
  onReviewWhy?: (question: LandingQuizQuestion) => void;
}) {
  const t = useT();
  const questions = useMemo(() => content ?? defaultLandingQuiz(t), [content, t]);
  const byId = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const [state, setState] = useState<QuizState>(() => freshQuiz(questions, false));
  const advanceTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const questionsKey = questions.map((question) => question.id).join("|");
  const [sessionKey, setSessionKey] = useState(questionsKey);
  if (sessionKey !== questionsKey) {
    setSessionKey(questionsKey);
    setState(freshQuiz(questions, false));
  }

  useEffect(
    () => () => {
      if (advanceTimerRef.current) {
        window.clearTimeout(advanceTimerRef.current);
      }
    },
    [],
  );

  const currentId = state.summary ? null : (state.queue[state.index] ?? null);
  const question = currentId ? (byId.get(currentId) ?? null) : null;
  const selection = currentId ? (state.selections[currentId] ?? null) : null;
  const order = question
    ? (state.orders[question.id] ?? question.options.map((_, index) => index))
    : [];
  const answeredWrong =
    question !== null && selection !== null && selection !== question.correct_option_idx;

  const moveOn = useCallback(
    (selections?: Record<string, number>) => {
      setState((current) => {
        const nextIndex = current.index + 1;

        if (nextIndex < current.queue.length) {
          return { ...current, index: nextIndex };
        }

        const final = selections ?? current.selections;
        const summary = current.queue.reduce<RoundSummary>(
          (result, id) => {
            const item = byId.get(id);

            if (!item) {
              return result;
            }

            if (final[id] === item.correct_option_idx) {
              result.correct += 1;
            } else {
              result.missed += 1;
              result.missedQuestionIds.push(id);
            }

            return result;
          },
          { cycle: current.round, total: current.roundCount, correct: 0, missed: 0, missedQuestionIds: [] },
        );

        return { ...current, selections: final, summary };
      });
    },
    [byId],
  );

  const select = useCallback(
    (optionIndex: number) => {
      if (!question || selection !== null) {
        return;
      }

      const nextSelections = { ...state.selections, [question.id]: optionIndex };
      setState((current) => ({ ...current, selections: nextSelections }));

      // A right answer reads for a beat and moves on by itself; a miss waits.
      if (optionIndex === question.correct_option_idx) {
        if (advanceTimerRef.current) {
          window.clearTimeout(advanceTimerRef.current);
        }

        advanceTimerRef.current = window.setTimeout(() => {
          advanceTimerRef.current = null;
          moveOn(nextSelections);
        }, QUIZ_CORRECT_PAUSE_MS);
      }
    },
    [moveOn, question, selection, state.selections],
  );

  const restart = useCallback(() => setState(freshQuiz(questions, true)), [questions]);

  const continueReview = useCallback(() => {
    setState((current) => {
      const missed = current.summary?.missedQuestionIds ?? [];

      if (missed.length === 0) {
        return current;
      }

      return {
        queue: missed,
        index: 0,
        round: current.round + 1,
        roundCount: missed.length,
        selections: {},
        orders: {
          ...current.orders,
          ...Object.fromEntries(
            missed.map((id) => [id, shuffleIndices(byId.get(id)?.options.length ?? 0)]),
          ),
        },
        summary: null,
      };
    });
  }, [byId]);

  /*
   * The walkthrough: the first question right, the second wrong and acknowledged, the
   * rest right; the round ends offering the miss again, the repeat round is answered,
   * and the quiz starts over.
   */
  const { running } = useLandingAutoplay(autoplay, rootRef);
  const summary = state.summary;
  let step: LandingAutoplayStep = null;

  if (summary) {
    step =
      summary.missed > 0
        ? { key: `repeat-${summary.cycle}`, delay: 3200, run: continueReview }
        : { key: `restart-${summary.cycle}`, delay: 4200, run: restart };
  } else if (question && selection === null) {
    const miss = state.round === 1 && state.index === 1;
    const wrong = (question.correct_option_idx + 1) % Math.max(1, question.options.length);
    step = {
      key: `pick-${state.round}-${state.index}`,
      delay: state.round === 1 && state.index === 0 ? 1700 : 1500,
      run: () => select(miss ? wrong : question.correct_option_idx),
    };
  } else if (answeredWrong) {
    step = { key: `understood-${state.round}-${state.index}`, delay: 2600, run: () => moveOn() };
  }

  useLandingAutoplayStep(running, step);

  return (
    <LandingAppScope
      theme={theme}
      className={["landing-study-screen", className].filter(Boolean).join(" ")}
    >
      <div ref={rootRef} className="landing-study-frame" data-note-tab="quiz">
        <div className="memo-panel study">
          <div className="workspace-panel-stack lecture-panel-stack">
            <div className="ios-card lecture-study-shell auto-height">
              {summary ? (
                <StudyCompletionCard
                  eyebrow={
                    summary.missed === 0
                      ? t("study.completed")
                      : t("study.roundCompleted", { cycle: summary.cycle })
                  }
                  title={t(summary.missed === 0 ? "quiz.allDone" : "quiz.repeatMissed")}
                  percentage={
                    summary.missed === 0
                      ? 100
                      : summary.total > 0
                        ? Math.round((summary.correct / summary.total) * 100)
                        : 0
                  }
                  percentageLabel={t(summary.missed === 0 ? "study.setCompleted" : "study.roundScore")}
                  primaryMetric={{
                    label: t(summary.missed === 0 ? "quiz.questionsDone" : "study.correctThisRound"),
                    value:
                      summary.missed === 0
                        ? `${questions.length}/${questions.length}`
                        : `${summary.correct}/${summary.total}`,
                  }}
                  actions={
                    summary.missed === 0 ? (
                      <button
                        type="button"
                        onClick={restart}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        {t("quiz.restart")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={continueReview}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        {t("quiz.repeatMissedQuestions", { count: summary.missed })}
                      </button>
                    )
                  }
                />
              ) : question ? (
                <div className="lecture-quiz-stage">
                  {/* The phone's head: the label bold on the left, the count muted on the right. */}
                  <div className="memo-quiz-head">
                    <span className="memo-quiz-count">
                      {t("quiz.questionN", { index: state.index + 1 })}
                      {state.round > 1 ? t("quiz.roundN", { round: state.round }) : ""}
                    </span>
                    <span className="memo-quiz-total">
                      {state.index + 1} / {state.roundCount}
                    </span>
                  </div>
                  <div className="memo-progress quiz">
                    <div
                      style={{
                        width: `${
                          state.roundCount > 0
                            ? Math.round(((state.index + 1) / state.roundCount) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  <div className="lecture-quiz-card">
                    <StudyQuizQuestion
                      question={question}
                      order={order}
                      selection={selection}
                      collapseAnswered
                      onSelect={select}
                    />

                    {answeredWrong ? (
                      <div className="memo-quiz-result">
                        <span className="memo-quiz-result-badge">
                          <Msym name="cancel" size="1.25rem" />
                        </span>
                        <span className="memo-quiz-result-copy">
                          <span className="memo-quiz-result-title">{t("quiz.wrongTitle")}</span>
                          <span>
                            {t("quiz.correctAnswerIs", {
                              letter: quizOptionLetter(order, question.correct_option_idx),
                            })}
                          </span>
                        </span>
                        <div className="memo-quiz-result-actions">
                          {onReviewWhy ? (
                            <button
                              type="button"
                              onClick={() => {
                                moveOn();
                                onReviewWhy(question);
                              }}
                              className="memo-quiz-result-ghost"
                            >
                              {t("quiz.reviewWhy")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => moveOn()}
                            className="memo-quiz-result-primary"
                          >
                            {t("quiz.understood")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </LandingAppScope>
  );
}
