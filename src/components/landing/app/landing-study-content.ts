"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

/*
 * What the three practice screens on the landing page study, and the one piece of
 * machinery they share: the scripted walkthrough.
 *
 * The screens themselves are the app's (see landing-flashcards-screen.tsx and its two
 * siblings). The material is not — it stands in for the learner's own coursework, the
 * same sample lecture the landing's flow demo uses (`flowDemo.card*`, `flowDemo.quiz*`,
 * `flowDemo.test*`), so it arrives through the catalogue in the reader's language.
 */

export type LandingFlashcard = { id: string; front: string; back: string };

/** The same shape `StudyQuizQuestion` takes. */
export type LandingQuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correct_option_idx: number;
};

export type LandingTestQuestion = {
  id: string;
  prompt: string;
  /** Shown in the breakdown, and what the walkthrough types. */
  expectedAnswer: string;
  /**
   * Word stems an answer is marked against, in the reader's language because the
   * answer is. The demo cannot grade; it fakes a deterministic mark from these.
   */
  keywords: string[];
};

export type LandingTestContent = {
  questions: LandingTestQuestion[];
  /** Percentages of the attempts the demo learner already has behind them. */
  history: number[];
};

const CARDS = [
  { qKey: "flowDemo.card1Q", aKey: "flowDemo.card1A" },
  { qKey: "flowDemo.card2Q", aKey: "flowDemo.card2A" },
  { qKey: "flowDemo.card3Q", aKey: "flowDemo.card3A" },
] as const satisfies ReadonlyArray<{ qKey: MessageKey; aKey: MessageKey }>;

const QUIZ = [
  {
    qKey: "flowDemo.quiz1Q",
    optionKeys: ["flowDemo.quiz1O1", "flowDemo.quiz1O2", "flowDemo.quiz1O3", "flowDemo.quiz1O4"],
    correct: 0,
  },
  {
    qKey: "flowDemo.quiz2Q",
    optionKeys: ["flowDemo.quiz2O1", "flowDemo.quiz2O2", "flowDemo.quiz2O3", "flowDemo.quiz2O4"],
    correct: 1,
  },
  {
    qKey: "flowDemo.quiz3Q",
    optionKeys: ["flowDemo.quiz3O1", "flowDemo.quiz3O2", "flowDemo.quiz3O3", "flowDemo.quiz3O4"],
    correct: 2,
  },
  {
    qKey: "flowDemo.quiz4Q",
    optionKeys: ["flowDemo.quiz4O1", "flowDemo.quiz4O2", "flowDemo.quiz4O3", "flowDemo.quiz4O4"],
    correct: 2,
  },
] as const satisfies ReadonlyArray<{
  qKey: MessageKey;
  optionKeys: readonly MessageKey[];
  correct: number;
}>;

const TEST = [
  { qKey: "flowDemo.test1Q", keysKey: "flowDemo.test1Keys", aKey: "flowDemo.test1A" },
  { qKey: "flowDemo.test2Q", keysKey: "flowDemo.test2Keys", aKey: "flowDemo.test2A" },
  { qKey: "flowDemo.test3Q", keysKey: "flowDemo.test3Keys", aKey: "flowDemo.test3A" },
] as const satisfies ReadonlyArray<{ qKey: MessageKey; keysKey: MessageKey; aKey: MessageKey }>;

/* The flow demo's history, so both demos report the same learner. */
const TEST_HISTORY = [64, 82];

export function defaultLandingFlashcards(t: Translate<MessageKey>): LandingFlashcard[] {
  return CARDS.map((card, index) => ({
    id: `landing-card-${index + 1}`,
    front: t(card.qKey),
    back: t(card.aKey),
  }));
}

export function defaultLandingQuiz(t: Translate<MessageKey>): LandingQuizQuestion[] {
  return QUIZ.map((question, index) => ({
    id: `landing-quiz-${index + 1}`,
    prompt: t(question.qKey),
    options: question.optionKeys.map((key) => t(key)),
    correct_option_idx: question.correct,
  }));
}

export function defaultLandingTest(t: Translate<MessageKey>): LandingTestContent {
  return {
    questions: TEST.map((question, index) => ({
      id: `landing-test-${index + 1}`,
      prompt: t(question.qKey),
      expectedAnswer: t(question.aKey),
      keywords: t(question.keysKey)
        .split(",")
        .map((stem) => stem.trim().toLowerCase())
        .filter(Boolean),
    })),
    history: TEST_HISTORY,
  };
}

/*
 * The walkthrough.
 *
 * Each screen describes its next scripted move as a function of its own state — "flip
 * this card in 1.4 s", "pick the right answer in 1.6 s" — and this runs it. Because the
 * move is recomputed from state after every change, the script needs no cursor of its
 * own and cannot fall out of step with what is on the screen.
 *
 * It runs only while the screen is on the page's screen, never under reduced motion, and
 * stops for good the first time the visitor touches, clicks or types inside it: from
 * then on the screen is theirs.
 */
export type LandingAutoplayStep = { key: string; delay: number; run: () => void } | null;

export function useLandingAutoplay(
  enabled: boolean,
  rootRef: RefObject<HTMLElement | null>,
): { running: boolean; stop: () => void } {
  const [allowed, setAllowed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAllowed(!reducedMotion.matches);

    sync();
    reducedMotion.addEventListener("change", sync);

    return () => reducedMotion.removeEventListener("change", sync);
  }, [enabled]);

  useEffect(() => {
    const root = rootRef.current;

    if (!enabled || !root) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.35 },
    );
    observer.observe(root);

    /* Any real input ends the script — programmatic state changes fire none of these. */
    const stop = () => setStopped(true);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((name) => root.addEventListener(name, stop, { capture: true, passive: true }));

    return () => {
      observer.disconnect();
      events.forEach((name) => root.removeEventListener(name, stop, { capture: true }));
    };
  }, [enabled, rootRef]);

  return {
    running: enabled && allowed && visible && !stopped,
    stop: () => setStopped(true),
  };
}

/** Schedules the screen's next scripted move while the walkthrough runs. */
export function useLandingAutoplayStep(running: boolean, step: LandingAutoplayStep) {
  const runRef = useRef<(() => void) | null>(null);
  const run = step ? step.run : null;
  const key = step ? step.key : null;
  const delay = step ? step.delay : 0;

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (!running || key === null) {
      return;
    }

    const timer = window.setTimeout(() => runRef.current?.(), delay);

    return () => window.clearTimeout(timer);
  }, [running, key, delay]);
}
