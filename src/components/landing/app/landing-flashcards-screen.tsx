"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { StudyFlashcard } from "@/components/study-flashcard";
import {
  FLASHCARD_EXIT_ANIMATION_MS,
  type FlashcardBucket,
  type FlashcardExitStart,
} from "@/lib/study/flashcard-drag";

import { LandingAppScope, type LandingAppTheme } from "./landing-app-scope";
import {
  defaultLandingFlashcards,
  useLandingAutoplay,
  useLandingAutoplayStep,
  type LandingAutoplayStep,
  type LandingFlashcard,
} from "./landing-study-content";

/*
 * The note's Flashcards tab, as the phone draws it below the pill row.
 *
 * Transcribed from the flashcards branch of `lecture-workspace.tsx` — the same head,
 * progress bar, `StudyFlashcard` and `StudyCompletionCard`, with the same classes — and
 * driven by the same session rules (a round, the missed cards repeated as a next round,
 * "next" on an ungraded card counting as a miss), minus the network: grades live in local
 * state. The app renders both "Click to flip" and "Tap to flip" and lets the breakpoint
 * choose; this is always the phone screen, so it carries the phone's.
 */

type SessionResult = {
  attempts: number;
  firstConfidence: FlashcardBucket;
  latestConfidence: FlashcardBucket;
};

type RoundSummary = { cycle: number; total: number; known: number; missed: number };

type ExitAnimation = {
  bucket: FlashcardBucket;
  flipped: boolean;
  token: number;
  startXPercent: number;
  startYPercent: number;
  startRotationDeg: number;
};

type DeckState = {
  queue: string[];
  repeat: string[];
  index: number;
  cycle: number;
  cycleCount: number;
  flipped: boolean;
  summary: RoundSummary | null;
  results: Record<string, SessionResult>;
};

function freshDeck(ids: string[]): DeckState {
  return {
    queue: ids,
    repeat: [],
    index: 0,
    cycle: 1,
    cycleCount: ids.length,
    flipped: false,
    summary: null,
    results: {},
  };
}

export function LandingFlashcardsScreen({
  theme,
  content,
  autoplay = false,
  className,
}: {
  theme?: LandingAppTheme;
  content?: LandingFlashcard[];
  autoplay?: boolean;
  className?: string;
}) {
  const t = useT();
  const deck = useMemo(() => content ?? defaultLandingFlashcards(t), [content, t]);
  const deckIds = useMemo(() => deck.map((card) => card.id), [deck]);
  const [state, setState] = useState<DeckState>(() => freshDeck(deckIds));
  const [exit, setExit] = useState<ExitAnimation | null>(null);
  const exitTokenRef = useRef(0);
  const exitTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // A different deck starts a different session.
  const deckKey = deckIds.join("|");
  const [sessionDeckKey, setSessionDeckKey] = useState(deckKey);
  if (sessionDeckKey !== deckKey) {
    setSessionDeckKey(deckKey);
    setState(freshDeck(deckIds));
  }

  useEffect(
    () => () => {
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
      }
    },
    [],
  );

  const currentId = state.summary ? null : (state.queue[state.index] ?? null);
  const currentCard = deck.find((card) => card.id === currentId) ?? null;

  const grade = useCallback(
    (bucket: FlashcardBucket, exitStart?: FlashcardExitStart) => {
      if (!currentCard) {
        return;
      }

      exitTokenRef.current += 1;
      const token = exitTokenRef.current;

      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
      }

      setExit({
        bucket,
        flipped: state.flipped,
        token,
        startXPercent: exitStart?.xPercent ?? 0,
        startYPercent: exitStart?.yPercent ?? 0,
        startRotationDeg: exitStart?.rotationDeg ?? 0,
      });
      exitTimerRef.current = window.setTimeout(() => {
        setExit((current) => (current?.token === token ? null : current));
        exitTimerRef.current = null;
      }, FLASHCARD_EXIT_ANIMATION_MS);

      setState((current) => {
        const id = currentCard.id;
        const isLast = current.index >= current.queue.length - 1;
        const repeat =
          bucket === "again"
            ? Array.from(new Set([...current.repeat, id]))
            : current.repeat.filter((item) => item !== id);
        const previous = current.results[id];

        return {
          ...current,
          flipped: false,
          repeat,
          results: {
            ...current.results,
            [id]: {
              attempts: (previous?.attempts ?? 0) + 1,
              firstConfidence: previous?.firstConfidence ?? bucket,
              latestConfidence: bucket,
            },
          },
          index: isLast ? current.index : Math.min(current.index + 1, current.queue.length - 1),
          summary: isLast
            ? {
                cycle: current.cycle,
                total: current.cycleCount,
                known: current.cycleCount - repeat.length,
                missed: repeat.length,
              }
            : null,
        };
      });
    },
    [currentCard, state.flipped],
  );

  const flip = useCallback(() => setState((current) => ({ ...current, flipped: !current.flipped })), []);

  const navigate = (direction: "previous" | "next") => {
    if (exit) {
      return;
    }

    // Moving on from a card that was never graded counts it as a miss, as in the app.
    if (direction === "next" && currentId && !state.results[currentId]) {
      grade("again");
      return;
    }

    setState((current) => ({
      ...current,
      flipped: false,
      index:
        direction === "previous"
          ? Math.max(0, current.index - 1)
          : Math.min(current.queue.length - 1, current.index + 1),
    }));
  };

  const restart = useCallback(() => setState(freshDeck(deckIds)), [deckIds]);

  const continueReview = useCallback((ids: string[]) => {
    if (ids.length === 0) {
      return;
    }

    const repeatIds = new Set(ids);
    setState((current) => ({
      queue: ids,
      repeat: [],
      index: 0,
      cycle: current.cycle + 1,
      cycleCount: ids.length,
      flipped: false,
      summary: null,
      results: Object.fromEntries(
        Object.entries(current.results).filter(([id]) => !repeatIds.has(id)),
      ),
    }));
  }, []);

  const knownCount = state.queue.reduce((total, id) => {
    const answer = state.results[id]?.latestConfidence;
    return answer && answer !== "again" ? total + 1 : total;
  }, 0);
  const missedCount = state.queue.reduce(
    (total, id) => (state.results[id]?.latestConfidence === "again" ? total + 1 : total),
    0,
  );
  const repeatQueue =
    state.repeat.length > 0
      ? state.repeat
      : state.queue.filter((id) => state.results[id]?.latestConfidence === "again");
  const summary = state.summary;
  const summaryPercent =
    summary && summary.total > 0 ? Math.round((summary.known / summary.total) * 100) : 0;
  const currentAnswer = currentCard ? (state.results[currentCard.id]?.latestConfidence ?? null) : null;
  const canNavigate = Boolean(currentCard) && !exit;

  /*
   * The walkthrough: flip, read, grade — the second card of the first round is missed,
   * so the round ends by offering it again; the repeat round is known, and the set
   * starts over.
   */
  const { running } = useLandingAutoplay(autoplay, rootRef);
  let step: LandingAutoplayStep = null;

  if (summary) {
    step =
      summary.missed > 0
        ? { key: `repeat-${summary.cycle}`, delay: 3200, run: () => continueReview(repeatQueue) }
        : { key: `restart-${summary.cycle}`, delay: 4200, run: restart };
  } else if (currentCard && !exit) {
    const first = state.cycle === 1 && state.index === 0;
    step = state.flipped
      ? {
          key: `grade-${state.cycle}-${state.index}`,
          delay: 1900,
          run: () => grade(state.cycle === 1 && state.index === 1 ? "again" : "easy"),
        }
      : { key: `flip-${state.cycle}-${state.index}`, delay: first ? 1500 : 1100, run: flip };
  }

  useLandingAutoplayStep(running, step);

  return (
    <LandingAppScope
      theme={theme}
      className={["landing-study-screen", className].filter(Boolean).join(" ")}
    >
      <div ref={rootRef} className="landing-study-frame" data-note-tab="flashcards">
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
                  title={t(summary.missed === 0 ? "study.cards.allDone" : "study.cards.repeatMissed")}
                  percentage={summary.missed === 0 ? 100 : summaryPercent}
                  percentageLabel={t(summary.missed === 0 ? "study.setCompleted" : "study.roundScore")}
                  primaryMetric={{
                    label: t("study.correctThisRound"),
                    value: `${summary.known}/${summary.total}`,
                  }}
                  actions={
                    summary.missed === 0 ? (
                      <button
                        type="button"
                        onClick={restart}
                        className="lecture-study-refresh lecture-study-restart"
                        aria-label={t("study.restart")}
                        title={t("study.restart")}
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        {t("study.restartSet")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => continueReview(repeatQueue)}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        {t("study.repeatMissedCards", { count: summary.missed })}
                      </button>
                    )
                  }
                />
              ) : currentCard ? (
                <>
                  <div className="memo-study-head">
                    <span className="memo-study-head-title">
                      {t("study.cards.cardN", { index: state.index + 1 })}
                    </span>
                    <span className="memo-study-head-count">
                      {t("study.cards.remaining", {
                        count: Math.max(0, state.queue.length - state.index - 1),
                      })}
                    </span>
                  </div>
                  <div className="memo-progress cards">
                    <div
                      style={{
                        width: `${
                          state.queue.length > 0
                            ? Math.round((state.index / state.queue.length) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  <StudyFlashcard
                    key={currentCard.id}
                    front={currentCard.front}
                    back={currentCard.back}
                    flipped={state.flipped}
                    onFlip={flip}
                    onGrade={(bucket, exitStart) => grade(bucket, exitStart)}
                    flipHint={t("study.cards.flipMobile")}
                    answerLabel={
                      currentAnswer == null
                        ? null
                        : t(currentAnswer === "again" ? "study.cards.didntKnow" : "study.cards.knew")
                    }
                    answerClass={
                      currentAnswer == null ? "unanswered" : currentAnswer === "again" ? "again" : "easy"
                    }
                    answer={currentAnswer}
                    missedCount={missedCount}
                    knownCount={knownCount}
                    navigation={{
                      onPrevious: () => navigate("previous"),
                      onNext: () => navigate("next"),
                      canPrevious: canNavigate && state.index > 0,
                      canNext: canNavigate && state.index < state.queue.length - 1,
                    }}
                    exit={exit}
                    disabled={Boolean(exit)}
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </LandingAppScope>
  );
}
