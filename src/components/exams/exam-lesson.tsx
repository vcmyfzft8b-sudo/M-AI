"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { StudyGenerationNotice } from "@/components/generation-notice";
import { useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { useInstantNavigation } from "@/components/navigation-loading";
import { NoteSpeedReader } from "@/components/note-speed-reader";
import { StudyFlashcard, type StudyFlashcardExit } from "@/components/study-flashcard";
import { StudyPracticeQuestion, StudyQuizQuestion } from "@/components/study-question";
import { LESSON_KIND_EMOJI, LESSON_KIND_KEY, lessonHref } from "@/components/exams/exam-links";
import { ExamScreen } from "@/components/exams/exam-screen";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { MemoBuddy, type BuddyMood } from "@/components/exams/memo-buddy";
import { ExamTutorLesson } from "@/components/exams/exam-tutor-lesson";
import { lessonUrl, takePrefetchedLesson } from "@/components/exams/lesson-prefetch";
import {
  GAP_LESSON_KINDS,
  lessonsToTarget,
  masteryAfterPractice,
  meetsPassMark,
  checkScorePasses,
  masteryGoal,
  percent,
  type ExamLessonKind,
  type PracticeLessonKind,
  type TrueFalseStatement,
} from "@/lib/exams/exam-model";
import type { LessonGenerator, LessonLoad, LessonPayload } from "@/lib/exams/exams-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { QUIZ_CORRECT_PAUSE_MS } from "@/lib/study/quiz";
import { FLASHCARD_EXIT_ANIMATION_MS, type FlashcardBucket, type FlashcardExitStart } from "@/lib/study/flashcard-drag";
import { paywallPath } from "@/lib/paywall-reasons";

const POLL_MS = 4000;

/* Each part of a lesson in its header. */
const LESSON_PART_EMOJI: Record<ExamLessonKind, string> = {
  summary: "📖",
  tutor: "🎙️",
  flashcards: "🃏",
  quiz: "❓",
  true_false: "⚖️",
  written: "✍️",
};

const GENERATOR_ROUTE: Record<LessonGenerator, string> = {
  study: "study",
  quiz: "quiz",
  practice_test: "practice-test",
};

const GENERATOR_PREVIEW = { study: "cards", quiz: "quiz", practice_test: "test" } as const;

const GENERATOR_STAGE: Record<LessonGenerator, MessageKey> = {
  study: "exam.lesson.generating.cards",
  quiz: "exam.lesson.generating.quiz",
  practice_test: "exam.lesson.generating.test",
};

type Phase =
  | { name: "loading" }
  | { name: "generating"; generator: LessonGenerator }
  | { name: "failed"; generator: LessonGenerator | null }
  | { name: "playing"; lesson: LessonPayload }
  | { name: "zone"; correct: number; total: number }
  | { name: "saving" }
  | {
      name: "done";
      correct: number;
      total: number;
      /** The topic's mastery before and after this lesson, 0..1 (Astra's "+N % gained"). */
      before: number;
      after: number;
      /** The lesson took the topic to its target. */
      reached: boolean;
      /** A check ("Preverjanje"): whether it passed at the goal by its own score, guessing taken out. */
      checkPassed: boolean | null;
      /** Knowledge gaps: earlier misses answered right this time, and this lesson's misses (they come back). */
      gapsClosed: number;
      gapsOpen: number;
    };

/*
 * The tutor scores each step 0, ¼, ½ or 1; results are whole counts, so its points are kept in
 * quarters (a three-step lesson is out of 12) and shown as a percentage.
 */
const TUTOR_QUARTERS = 4;

/** The questions a lesson showed, recorded with its result so the next try draws others. */
function shownItemIds(lesson: LessonPayload | null): string[] {
  switch (lesson?.kind) {
    case "summary":
      return (lesson.parts ?? []).flatMap((part) => shownItemIds(part));
    case "flashcards":
      return lesson.cards.map((card) => card.id);
    case "quiz":
    case "written":
      return lesson.questions.map((question) => question.id);
    case "true_false":
      return lesson.statements.map((statement) => statement.id);
    default:
      return [];
  }
}

type WrittenMark = {
  marked: boolean;
  score?: number;
  maxScore: number;
  expectedAnswer: string;
  strengths?: string;
  missingPoints?: string;
};

export type ExamLessonModule = {
  topicId: string;
  lectureId: string;
  title: string;
  position: number;
  /** The topic's mastery today (faded) and before fading, 0..1: a lesson builds on the unfaded one. */
  mastery: number;
  rawMastery: number;
  perfectRun: number;
};

/* A lesson load that is worth trying again rather than showing as failed straight away. */
class LessonLoadHiccup extends Error {}

/* How many times a lesson load is tried again on its own before the learner is asked. */
const LESSON_LOAD_RETRIES = 2;

export function ExamLesson({
  examId,
  examTitle,
  module,
  kind,
  check = false,
  target,
  instead,
}: {
  examId: string;
  examTitle: string;
  module: ExamLessonModule;
  kind: ExamLessonKind;
  /** The topic's check ("Preverjanje"): a longer quiz, passed at the goal by its own score. */
  check?: boolean;
  /** The exam's goal, 0..100. */
  target: number;
  /**
   * The exercise that takes a tutor lesson's place when the account has no talking time left: the
   * path's next lesson for the topic without the tutor. The learner is simply taken there.
   */
  instead: ExamLessonKind;
}) {
  const { t } = useTranslations();
  const { navigateWithFeedback } = useInstantNavigation();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  /*
   * Where the topic stands, for the result screen: the page's values at first, then each result's,
   * so a "Ponovi" builds on the lesson just done rather than on the page as it was opened.
   */
  const progressRef = useRef({ mastery: module.mastery, rawMastery: module.rawMastery, perfectRun: module.perfectRun });
  const [buddy, setBuddy] = useState<{ mood: BuddyMood; key: number }>({ mood: "wave", key: 0 });
  const [saveError, setSaveError] = useState(false);
  /* The learning-zone answer, 1 (too easy) to 5 (too hard). */
  const [difficulty, setDifficulty] = useState(3);
  const startedGeneration = useRef(false);
  const lessonRef = useRef<LessonPayload | null>(null);
  /* The questions this try got wrong (knowledge gaps), saved with the result. */
  const missedRef = useRef(new Set<string>());
  /* A lesson's parts: which one is on (-1 while reading) and what they scored so far. */
  const [part, setPart] = useState(-1);
  const tallyRef = useRef({ correct: 0, total: 0 });
  /* `navigateWithFeedback` is a new function every render; a load keyed on it would restart forever. */
  const navigateRef = useRef(navigateWithFeedback);
  const examHref = `/app/exams/${examId}`;

  useEffect(() => {
    navigateRef.current = navigateWithFeedback;
  });

  const react = useCallback((mood: BuddyMood) => {
    setBuddy((current) => ({ mood, key: current.key + 1 }));
  }, []);

  const fetchLesson = useCallback(async () => {
    const early = await takePrefetchedLesson(examId, module.topicId, kind);

    if (early) {
      const ready = early.body as Extract<LessonLoad, { status: "ready" }>;
      lessonRef.current = ready.lesson;
      missedRef.current = new Set();
      setPart(-1);
      setPhase({ name: "playing", lesson: ready.lesson });
      return;
    }

    const response = await fetch(lessonUrl(examId, module.topicId, kind, check), { cache: "no-store" });

    if (response.status === 402) {
      // Back to the prep, not this lesson, which would only send the learner here again.
      navigateRef.current(paywallPath("exam", `/app/exams/${examId}`));
      return;
    }

    if (response.status === 409 && kind === "tutor") {
      const body = (await response.json().catch(() => null)) as { code?: string } | null;

      // No talking time left: the topic's next exercise opens instead, without a word.
      if (body?.code === "tutor_time") {
        navigateRef.current(lessonHref(examId, module.topicId, instead));
        return;
      }
    }

    if (!response.ok) {
      // A busy or briefly failing server: worth another try before the learner sees it.
      throw new LessonLoadHiccup();
    }

    const load = (await response.json()) as LessonLoad;

    if (load.status === "ready") {
      lessonRef.current = load.lesson;
      missedRef.current = new Set();
      setPart(-1);
      setPhase({ name: "playing", lesson: load.lesson });
      return;
    }

    if (load.status === "failed") {
      // The lesson itself (the tutor's plan) failed rather than the note's material: try again.
      if (load.generator === null) {
        throw new LessonLoadHiccup();
      }

      setPhase({ name: "failed", generator: load.generator });
      return;
    }

    if (load.status === "missing" && !startedGeneration.current) {
      startedGeneration.current = true;
      await fetch(`/api/lectures/${module.lectureId}/${GENERATOR_ROUTE[load.generator]}`, {
        method: "POST",
      }).catch(() => null);
    }

    setPhase({ name: "generating", generator: load.generator });
  }, [check, examId, instead, kind, module.lectureId, module.topicId]);

  /*
   * A network failure, a busy server or a failed plan is tried again twice on its own, a moment
   * apart, while the lesson shows as loading; only then is it a failed lesson with its retry. On
   * a poll while the material is being made a failure is only a missed poll, and the next one
   * follows.
   */
  const load = useCallback(
    async ({ polling = false }: { polling?: boolean } = {}) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await fetchLesson();
          return;
        } catch {
          if (polling) {
            return;
          }

          if (attempt >= LESSON_LOAD_RETRIES) {
            setPhase({ name: "failed", generator: null });
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 1500 * (attempt + 1)));
        }
      }
    },
    [fetchLesson],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const goal = target / 100;

  /* While the material is being made, a poll every few seconds, each one scheduled after the last whatever it returned. */
  const generating = phase.name === "generating";

  useEffect(() => {
    if (!generating) {
      return;
    }

    let stopped = false;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await load({ polling: true });

        if (!stopped) {
          schedule();
        }
      }, POLL_MS);
    };

    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [generating, load]);

  /** Saves the lesson; a summary then opens `then` (a format the learner picked) or the suggestion. */
  async function save(correct: number, total: number, difficulty: number | null) {
    setSaveError(false);
    setPhase({ name: "saving" });

    const response = await fetch(`/api/exams/${examId}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topicId: module.topicId,
        kind,
        correct,
        total,
        difficulty,
        itemIds: shownItemIds(lessonRef.current),
        missedIds: [...missedRef.current],
      }),
    }).catch(() => null);

    if (!response?.ok) {
      setSaveError(true);
      setPhase({ name: "zone", correct, total });
      return;
    }

    // A lesson read alone tested nothing: back to the path. One with parts shows its result.
    if (kind === "summary" && total === 0) {
      navigateWithFeedback(examHref, { refresh: true });
      return;
    }

    /*
     * Astra's result: the lesson moves the topic's mastery a step towards its score
     * (`masteryAfterLesson`, from the unfaded mastery: a lesson ends the fading), and the done
     * screen says by how much. "Nadaljuj" goes back to the path, which has the next lesson.
     */
    const score = total > 0 ? Math.min(1, correct / total) : 1;
    // From where the topic stands now: the page's values, or the last result's after "Ponovi".
    const now = progressRef.current;
    // A lesson that tested nothing (the reading alone) moves nothing.
    const moved = total > 0 ? masteryAfterPractice(now.rawMastery, now.perfectRun, kind, score) : null;
    const after = moved ? moved.mastery : now.mastery;

    if (moved) {
      progressRef.current = { mastery: moved.mastery, rawMastery: moved.mastery, perfectRun: moved.perfectRun };
    }
    const mark = masteryGoal(goal);
    const missedNow = missedRef.current.size;
    const repeatedOf = (lesson: LessonPayload | null): string[] =>
      lesson?.kind === "summary"
        ? (lesson.parts ?? []).flatMap(repeatedOf)
        : lesson && "repeated" in lesson
          ? (lesson.repeated ?? [])
          : [];
    const repeatedIds = repeatedOf(lessonRef.current);
    const gapsClosed = repeatedIds.filter((id) => !missedRef.current.has(id)).length;
    const reached = meetsPassMark(after, mark) && !meetsPassMark(now.mastery, mark);

    react(after > now.mastery ? "cheer" : "happy");
    setPhase({
      name: "done",
      correct,
      total,
      before: now.mastery,
      after,
      reached,
      checkPassed: check && total > 0 ? checkScorePasses(kind, correct / total, mark) : null,
      gapsClosed,
      gapsOpen: GAP_LESSON_KINDS.includes(kind as PracticeLessonKind) ? missedNow : 0,
    });
  }

  const scoreLine = (correct: number, total: number) =>
    kind === "tutor"
      ? t("exam.tutor.score", { percent: percent(correct / Math.max(1, total)) })
      : t("exam.zone.score", { correct, total });
  const title = `${t("exam.dash.module", { index: module.position + 1 })} · ${check ? t("exam.lesson.check") : t(LESSON_KIND_KEY[kind])}`;

  function retryLoad(generator: LessonGenerator | null) {
    startedGeneration.current = false;
    setPhase({ name: "loading" });

    if (generator) {
      void fetch(`/api/lectures/${module.lectureId}/${GENERATOR_ROUTE[generator]}`, { method: "POST" })
        .catch(() => null)
        .finally(() => void load());
    } else {
      void load();
    }
  }

  /* Out of talking time: the topic's next exercise, without a word about the tutor. */
  function useInstead() {
    navigateWithFeedback(lessonHref(examId, module.topicId, instead));
  }

  function enterZone(correct: number, total: number) {
    setDifficulty(3);
    setPhase({ name: "zone", correct, total });
  }

  /* The lesson's parts after the reading: start the first, or save the reading alone when there are none. */
  function startParts(lesson: LessonPayload) {
    tallyRef.current = { correct: 0, total: 0 };

    if (lesson.kind === "summary" && (lesson.parts?.length ?? 0) > 0) {
      setPart(0);
    } else {
      void save(0, 0, null);
    }
  }

  function finishPart(lesson: LessonPayload, correct: number, total: number) {
    const tally = { correct: tallyRef.current.correct + correct, total: tallyRef.current.total + total };
    tallyRef.current = tally;
    const count = lesson.kind === "summary" ? (lesson.parts?.length ?? 0) : 0;

    if (part + 1 < count) {
      setPart(part + 1);
    } else {
      enterZone(tally.correct, tally.total);
    }
  }

  /*
   * The screen's buttons, at the foot of the phone like every other exam screen's (and held at the
   * bottom of the window on desktop) rather than wherever the content happens to end.
   */
  const cta =
    phase.name === "failed" ? (
      <div className="memo-exam-cta-row">
        <button type="button" className="memo-button-ghost" onClick={() => retryLoad(phase.generator)}>
          {t("common.retry")}
        </button>
        <button type="button" className="memo-button-coral" onClick={() => void save(0, 0, null)}>
          {t("exam.lesson.skip")}
        </button>
      </div>
    ) : phase.name === "playing" && phase.lesson.kind === "summary" && part < 0 ? (
      <button type="button" className="memo-button-coral" onClick={() => startParts(phase.lesson)}>
        {t("exam.zone.continue")}
      </button>
    ) : phase.name === "zone" ? (
      <div className="memo-exam-cta-row">
        <button type="button" className="memo-button-ghost" onClick={() => retryLoad(null)}>
          {t("exam.zone.retry")}
        </button>
        <button type="button" className="memo-button-coral" onClick={() => void save(phase.correct, phase.total, difficulty)}>
          {t("exam.zone.continue")}
        </button>
      </div>
    ) : phase.name === "done" ? (
      <div className="memo-exam-cta-row">
        <button type="button" className="memo-button-ghost" onClick={() => retryLoad(null)}>
          {t("exam.lesson.repeatLesson")}
        </button>
        <button type="button" className="memo-button-coral" onClick={() => navigateWithFeedback(examHref, { refresh: true })}>
          {t("exam.zone.continue")}
        </button>
      </div>
    ) : null;

  return (
    <ExamScreen backHref={examHref} backIcon="close" backLabel={examTitle} title={title} refreshOnBack cta={cta}>
      {/* A lesson's parts, as Astra counts its steps: the reading, then each part in turn. */}
      {phase.name === "playing" && phase.lesson.kind === "summary" && (phase.lesson.parts?.length ?? 0) > 0 ? (
        <div className="memo-exam-lesson-head">
          <ol className="memo-exam-lesson-parts" aria-label={t("exam.lesson.parts")}>
            {[{ kind: "summary" as const }, ...(phase.lesson.parts ?? [])].map((entry, index) => (
              <li
                key={`${entry.kind}:${index}`}
                className={index - 1 === part ? "current" : index - 1 < part ? "done" : undefined}
              >
                <Emoji symbol={LESSON_PART_EMOJI[entry.kind]} size="0.95rem" />
                {t(index === 0 ? "exam.lesson.part.read" : LESSON_KIND_KEY[entry.kind])}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="memo-panel study memo-exam-lesson">
        {phase.name === "loading" || phase.name === "saving" ? (
          <LessonLoading kind={kind} saving={phase.name === "saving"} />
        ) : phase.name === "generating" ? (
          <StudyGenerationNotice preview={GENERATOR_PREVIEW[phase.generator]} stageCopy={t(GENERATOR_STAGE[phase.generator])} />
        ) : phase.name === "failed" ? (
          <div className="memo-exam-center">
            <MemoBuddy mood="sad" size="6rem" />
            <p className="memo-study-empty-title">{t("exam.lesson.failed")}</p>
          </div>
        ) : phase.name === "playing" && phase.lesson.kind === "summary" && part >= 0 && phase.lesson.parts?.[part] ? (
          /*
           * The lesson's parts, one after another (Astra's lesson: read, check, quiz): each is the
           * app's own lesson of that kind, and the scores add up into the lesson's one result.
           */
          <LessonBody
            key={`part:${part}`}
            lesson={phase.lesson.parts[part]}
            examId={examId}
            topicId={module.topicId}
            lectureId={module.lectureId}
            onReact={react}
            onMissed={(itemId) => {
              // A written answer missed here would never come back in a quiz: only quiz misses are gaps.
              if (phase.lesson.kind === "summary" && phase.lesson.parts?.[part]?.kind !== "written") {
                missedRef.current.add(itemId);
              }
            }}
            onRecovered={(itemId) => missedRef.current.delete(itemId)}
            onFinish={(correct, total) => finishPart(phase.lesson, correct, total)}
          />
        ) : phase.name === "playing" ? (
          <LessonBody
            lesson={phase.lesson}
            examId={examId}
            topicId={module.topicId}
            lectureId={module.lectureId}
            onReact={react}
            onMissed={(itemId) => missedRef.current.add(itemId)}
            onRecovered={(itemId) => missedRef.current.delete(itemId)}
            onOutOfTime={useInstead}
            onFinish={(correct, total) => enterZone(correct, total)}
          />
        ) : phase.name === "zone" ? (
          <LearningZone
            correct={phase.correct}
            total={phase.total}
            scoreLine={scoreLine(phase.correct, phase.total)}
            error={saveError}
            difficulty={difficulty}
            onDifficulty={setDifficulty}
          />
        ) : (
          <div className="memo-exam-center memo-exam-done">
            <MemoBuddy mood={buddy.mood} moodKey={buddy.key} size="6rem" sparkles={phase.after > phase.before} />
            {/* Astra's result: what the lesson added to the topic, and where the topic now stands. */}
            <h2 className="memo-exam-gain">
              {phase.checkPassed === true
                ? t("exam.lesson.check.passed")
                : phase.checkPassed === false
                  ? t("exam.lesson.check.failed")
                  : phase.reached
                    ? t("exam.lesson.done.reached")
                    : t("exam.lesson.done.gained", { percent: Math.max(0, percent(phase.after) - percent(phase.before)) })}
            </h2>
            <div className="memo-exam-done-mastery">
              <span>
                {t("exam.lesson.done.topicMastery")}
                <b>{t("exam.percent", { percent: percent(phase.after) })}</b>
              </span>
              <div className="memo-exam-mastery-bar">
                <div className="memo-progress goal">
                  <div style={{ width: `${percent(phase.after)}%` }} />
                </div>
                <i style={{ "--goal": `${target}%` } as CSSProperties} aria-hidden="true" />
              </div>
            </div>
            {phase.total > 0 && kind !== "summary" ? <p>{scoreLine(phase.correct, phase.total)}</p> : null}
            {/* Under the goal the module goes on: the lessons it still needs, and only then the next. */}
            {phase.reached || meetsPassMark(phase.after, masteryGoal(target / 100)) ? null : (
              <p className="memo-exam-lessons-left">
                {t("exam.lesson.done.lessonsLeft", { count: lessonsToTarget(phase.after, target / 100), target })}
              </p>
            )}
            {/* What comes back and until when: the misses, until they are answered right. */}
            {phase.gapsClosed > 0 || phase.gapsOpen > 0 ? (
              <div className="memo-exam-gap-facts">
                {phase.gapsClosed > 0 ? (
                  <span className="closed">
                    <Emoji symbol="✅" size="1rem" />
                    {t("exam.lesson.done.gapsClosed", { count: phase.gapsClosed })}
                  </span>
                ) : null}
                {phase.gapsOpen > 0 ? (
                  <span>
                    <Emoji symbol="🧩" size="1rem" />
                    {t("exam.lesson.done.gapsOpen", { count: phase.gapsOpen })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </ExamScreen>
  );
}

/* What a lesson load is doing, said a line at a time while it waits: all three are what it does. */
const LOADING_LINES = ["exam.lesson.loading.fresh", "exam.lesson.loading.gaps", "exam.lesson.loading.level"] as const;

/*
 * Waiting for a lesson (or for its result to be saved): Memo thinking about the lesson in hand, the
 * lesson's name, a line on what is being done, and the app's sweeping bar, centred on the screen.
 */
function LessonLoading({ kind, saving }: { kind: ExamLessonKind; saving: boolean }) {
  const { t } = useTranslations();
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (saving) {
      return;
    }

    const timer = window.setInterval(() => setLine((current) => (current + 1) % LOADING_LINES.length), 2400);
    return () => window.clearInterval(timer);
  }, [saving]);

  return (
    <div className="memo-exam-center memo-exam-loading" role="status" aria-live="polite">
      <MemoBuddy mood="think" size="6.5rem" thought={saving ? "📊" : LESSON_KIND_EMOJI[kind]} />
      <h2>{saving ? t("exam.lesson.loading.saving") : t("exam.lesson.loading.title", { lesson: t(LESSON_KIND_KEY[kind]) })}</h2>
      <p key={saving ? "saving" : line} className="memo-exam-loading-line">
        {saving ? t("exam.lesson.loading.savingLine") : t(LOADING_LINES[line])}
      </p>
      <span className="memo-gen-track memo-exam-loading-track" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}

function LearningZone({
  correct,
  total,
  scoreLine,
  error,
  difficulty,
  onDifficulty,
}: {
  correct: number;
  total: number;
  scoreLine: string;
  error: boolean;
  difficulty: number;
  onDifficulty: (difficulty: number) => void;
}) {
  const { t } = useTranslations();
  const ratio = total > 0 ? correct / total : 1;
  const hint =
    difficulty <= 2 ? "exam.zone.hintHarder" : difficulty >= 4 ? "exam.zone.hintEasier" : "exam.zone.hintSame";

  return (
    <div className="memo-exam-center memo-exam-zone">
      <MemoBuddy mood={ratio >= 0.6 ? "happy" : "sad"} size="6rem" />
      <h2>{total > 0 ? scoreLine : t("exam.lesson.done.title")}</h2>
      <p>{t("exam.zone.question")}</p>
      <div className="memo-exam-zone-card">
        <div className="memo-exam-zone-faces" aria-hidden="true">
          <span>😴</span>
          <span>🙂</span>
          <span>😅</span>
          <span>🥵</span>
        </div>
        <input
          id="exam-zone"
          type="range"
          min={1}
          max={5}
          step={1}
          value={difficulty}
          aria-label={t("exam.zone.question")}
          className="memo-exam-zone-range"
          onChange={(event) => onDifficulty(Number(event.target.value))}
        />
        <div className="memo-exam-zone-labels">
          <span>{t("exam.zone.easy")}</span>
          <span>{t("exam.zone.right")}</span>
          <span>{t("exam.zone.hard")}</span>
        </div>
      </div>
      <p className="memo-exam-fine">{t(hint)}</p>
      {error ? <p className="memo-inline-error">{t("exam.lesson.saveFailed")}</p> : null}
    </div>
  );
}

function LessonBody({
  lesson,
  examId,
  topicId,
  lectureId,
  onFinish,
  onMissed,
  onRecovered,
  onReact,
  onOutOfTime,
}: {
  lesson: LessonPayload;
  examId: string;
  topicId: string;
  lectureId: string;
  onFinish: (correct: number, total: number) => void;
  /** A question answered wrong: it stays open as a knowledge gap until a later lesson gets it right. */
  onMissed: (itemId: string) => void;
  /**
   * A miss answered right in the lesson's own retry round: Astra counts it as learned, so it does
   * not stay open as a knowledge gap.
   */
  onRecovered: (itemId: string) => void;
  onReact: (mood: BuddyMood) => void;
  /** The tutor found no talking time left: another exercise takes its place. */
  onOutOfTime?: () => void;
}) {
  const { t } = useTranslations();
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [selection, setSelection] = useState<number | null>(null);

  const [flipped, setFlipped] = useState(false);
  const [exit, setExit] = useState<StudyFlashcardExit | null>(null);
  const [missed, setMissed] = useState(0);
  const [speedReading, setSpeedReading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [marking, setMarking] = useState(false);
  const [mark, setMark] = useState<WrittenMark | null>(null);
  const [writtenTotal, setWrittenTotal] = useState(0);
  /*
   * Astra's exercise guides a learner to the full answer rather than only marking it: a written
   * answer that fell short can be fixed once, with what it missed as the hint. The two tries count
   * half each.
   */
  const [revision, setRevision] = useState<{ first: number; hint: string } | null>(null);
  const exitToken = useRef(0);
  /*
   * A quiz miss's explanation, opened by "Preglej zakaj" in a sheet (a dialog on desktop), so the
   * question never grows past the screen. "Razumem" in the sheet closes it and moves on.
   */
  const [showWhy, setShowWhy] = useState(false);
  const nextAfterWhy = useRef(false);
  /* The quiz's misses, by place, and once the last question is answered the round that asks them again. */
  const [missedAt, setMissedAt] = useState<number[]>([]);
  const [retry, setRetry] = useState<number[] | null>(null);
  /* A right quiz answer moves on by itself after a beat; leaving the lesson cancels it. */
  const advanceTimer = useRef<number | undefined>(undefined);
  /*
   * A quiz or true/false answer is done with: on to the next question. A miss is asked again in a
   * retry round once the last question is answered (the score stays the first try's), and a miss
   * answered right there is no longer a knowledge gap.
   */
  function advanceQuiz(gotIt: boolean) {
    const ids =
      lesson.kind === "quiz"
        ? lesson.questions.map((entry) => entry.id)
        : lesson.kind === "true_false"
          ? lesson.statements.map((entry) => entry.id)
          : [];
    const total = ids.length;

    window.clearTimeout(advanceTimer.current);
    setSelection(null);
    setShowWhy(false);

    if (retry) {
      const id = ids[retry[index] ?? -1];

      if (gotIt && id) {
        onRecovered(id);
      }

      if (index + 1 >= retry.length) {
        onFinish(correct, total);
      } else {
        setIndex(index + 1);
      }

      return;
    }

    const nextCorrect = correct + (gotIt ? 1 : 0);
    const misses = gotIt ? missedAt : [...missedAt, index];
    setCorrect(nextCorrect);
    setMissedAt(misses);

    if (index + 1 < total) {
      setIndex(index + 1);
    } else if (misses.length > 0) {
      setRetry(misses);
      setIndex(0);
    } else {
      onFinish(nextCorrect, total);
    }
  }

  /* `useSheet` reads its callback through a ref, so a new function each render is fine. */
  const whySheet = useSheet(() => {
    setShowWhy(false);

    if (nextAfterWhy.current) {
      nextAfterWhy.current = false;
      advanceQuiz(false);
    }
  });
  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  const flipHint = (
    <>
      <span className="memo-only-desktop">{t("study.cards.flipDesktop")}</span>
      <span className="memo-only-mobile">{t("study.cards.flipMobile")}</span>
    </>
  );

  function advance(count: number, gotIt: boolean) {
    const nextCorrect = correct + (gotIt ? 1 : 0);
    setCorrect(nextCorrect);

    if (index + 1 >= count) {
      onFinish(nextCorrect, count);
      return;
    }

    setIndex(index + 1);
    setSelection(null);
    setFlipped(false);
  }

  if (lesson.kind === "summary") {
    if (speedReading) {
      return (
        <NoteSpeedReader
          lectureId={lectureId}
          content={`${lesson.summary}\n\n${lesson.notesMarkdown}`}
          onClose={() => setSpeedReading(false)}
        />
      );
    }

    return (
      <div className="memo-exam-summary">
        <div className="memo-exam-buddy-line">
          <MemoBuddy mood="wave" size="4rem" thought="📖" />
          <p>{t("exam.lesson.summary.intro")}</p>
        </div>
        <div className="memo-exam-card memo-exam-summary-card">
          <p>{lesson.summary}</p>
          {/* The topic's key points: whole sentences, so a list rather than chips. */}
          {lesson.keyTopics.length > 0 ? (
            <>
              <span className="memo-eyebrow">{t("exam.lesson.keyPoints")}</span>
              <ul className="memo-exam-points">
                {lesson.keyTopics.slice(0, 8).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div className="memo-chip-row">
          <button type="button" className="memo-chip" onClick={() => setSpeedReading(true)}>
            <Msym name="bolt" size="1.1rem" />
            <span>{t("exam.lesson.speedRead")}</span>
          </button>
        </div>
      </div>
    );
  }

  if (lesson.kind === "flashcards") {
    const card = lesson.cards[index];

    if (!card) {
      return null;
    }

    // A thrown card carries on from where it was let go, as the note's deck does; a button press starts at rest.
    const grade = (bucket: FlashcardBucket, exitStart?: FlashcardExitStart) => {
      exitToken.current += 1;
      setExit({
        bucket,
        flipped,
        token: exitToken.current,
        startXPercent: exitStart?.xPercent ?? 0,
        startYPercent: exitStart?.yPercent ?? 0,
        startRotationDeg: exitStart?.rotationDeg ?? 0,
      });
      // Cards written for a topic outside the material are not in the note's deck.
      if (!lesson.generated) {
        void fetch(`/api/flashcards/${card.id}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confidenceBucket: bucket }),
        }).catch(() => null);
      }

      if (bucket === "again") {
        setMissed((current) => current + 1);
        onReact("sad");
      } else {
        onReact("happy");
      }

      window.setTimeout(() => {
        setExit(null);
        advance(lesson.cards.length, bucket !== "again");
      }, FLASHCARD_EXIT_ANIMATION_MS);
    };

    return (
      <>
        <div className="memo-study-head">
          <span className="memo-study-head-title">{t("study.cards.cardN", { index: index + 1 })}</span>
          <span className="memo-study-head-count">
            {t("study.cards.remaining", { count: Math.max(0, lesson.cards.length - index - 1) })}
          </span>
        </div>
        <div className="memo-progress cards">
          <div style={{ width: `${Math.round((index / lesson.cards.length) * 100)}%` }} />
        </div>
        <StudyFlashcard
          key={card.id}
          front={card.front}
          back={card.back}
          flipped={flipped}
          onFlip={() => setFlipped((current) => !current)}
          onGrade={(bucket, exitStart) => grade(bucket, exitStart)}
          flipHint={flipHint}
          missedCount={missed}
          knownCount={correct}
          exit={exit}
          disabled={Boolean(exit)}
        />
      </>
    );
  }

  if (lesson.kind === "quiz" || lesson.kind === "true_false") {
    const total = lesson.kind === "quiz" ? lesson.questions.length : lesson.statements.length;
    /* In the retry round `index` walks the misses; the score stays the first try's. */
    const at = retry ? (retry[index] ?? -1) : index;
    /*
     * Astra's "quick review before the finish": the questions missed come back once, asked another
     * way. A quiz question shows its answers in reverse; a false statement comes back with the right
     * answer as the claim.
     */
    const flipClaim = (entry: TrueFalseStatement) =>
      retry && !entry.isTrue ? { ...entry, claim: entry.correctAnswer, isTrue: true } : entry;
    const question =
      lesson.kind === "quiz"
        ? (() => {
            const entry = lesson.questions[at];
            return entry
              ? { id: entry.id, context: null, prompt: entry.prompt, options: entry.options, correct_option_idx: entry.correctIndex, explanation: entry.explanation, answer: entry.options[entry.correctIndex] }
              : null;
          })()
        : (() => {
            const found = lesson.statements[at];
            const entry = found ? flipClaim(found) : undefined;
            return entry
              ? {
                  id: entry.id,
                  /* The question asked, small; the answer claimed for it is the statement judged. */
                  context: entry.prompt,
                  prompt: entry.claim,
                  options: [t("exam.lesson.trueFalse.true"), t("exam.lesson.trueFalse.false")],
                  correct_option_idx: entry.isTrue ? 0 : 1,
                  explanation: entry.explanation,
                  answer: entry.correctAnswer,
                }
              : null;
          })();

    if (!question) {
      return null;
    }

    const order =
      retry && lesson.kind === "quiz"
        ? question.options.map((_, optionIndex) => optionIndex).reverse()
        : question.options.map((_, optionIndex) => optionIndex);
    const wrong = selection !== null && selection !== question.correct_option_idx;

    const next = advanceQuiz;

    /*
     * The note's quiz, as the app has it: on the phone an answered question collapses to the
     * answers worth reading; a right answer reads for a beat and moves on by itself; a miss shows
     * the app's result row, whose "Preglej zakaj" opens the explanation in place (a lesson has no
     * chat to send it to).
     */
    return (
      <div className="lecture-quiz-stage">
        <div className="memo-quiz-head">
          <span className="memo-quiz-count">
            {retry ? t("exam.lesson.retry.title") : t("quiz.questionN", { index: index + 1 })}
          </span>
          <span className="memo-quiz-total">
            {index + 1} / {retry ? retry.length : total}
          </span>
        </div>
        <div className="memo-progress quiz">
          <div style={{ width: `${Math.round(((index + 1) / (retry ? retry.length : total)) * 100)}%` }} />
        </div>
        {retry && index === 0 && selection === null ? (
          <p className="memo-exam-retry-note">{t("exam.lesson.retry.body")}</p>
        ) : null}
        <div className="lecture-quiz-card">
          {question.context ? <p className="memo-exam-tf-context">{question.context}</p> : null}
          <StudyQuizQuestion
            key={`${question.id}:${retry ? "retry" : "first"}`}
            question={question}
            order={order}
            selection={selection}
            collapseAnswered
            onSelect={(choice) => {
              if (selection !== null) {
                return;
              }

              setSelection(choice);
              setShowWhy(false);

              if (choice === question.correct_option_idx) {
                onReact("happy");
                window.clearTimeout(advanceTimer.current);
                advanceTimer.current = window.setTimeout(() => next(true), QUIZ_CORRECT_PAUSE_MS);
              } else {
                onReact("sad");

                if (!retry) {
                  onMissed(question.id);
                }
              }
            }}
          />
          {wrong ? (
            <div className="memo-quiz-result">
              <span className="memo-quiz-result-badge">
                <Msym name="cancel" size="1.25rem" />
              </span>
              <span className="memo-quiz-result-copy">
                <span className="memo-quiz-result-title">{t("quiz.wrongTitle")}</span>
                {/*
                 * The right answer is marked above. A false statement also says what is right
                 * instead, the one thing the screen does not show.
                 */}
                {lesson.kind === "true_false" && question.correct_option_idx === 1 ? (
                  <span>{t("exam.lesson.trueFalse.answer", { answer: question.answer })}</span>
                ) : null}
              </span>
              <div className="memo-quiz-result-actions">
                {question.explanation ? (
                  <button type="button" onClick={() => setShowWhy(true)} className="memo-quiz-result-ghost">
                    {t("quiz.reviewWhy")}
                  </button>
                ) : null}
                <button type="button" onClick={() => next(false)} className="memo-quiz-result-primary">
                  {t("quiz.understood")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {wrong && showWhy && question.explanation ? (
          <MemoPortal>
            <button
              type="button"
              aria-label={t("common.close")}
              className={sheetClass("memo-scrim", whySheet.closing)}
              onClick={() => whySheet.dismiss()}
            />
            <div
              className={sheetClass("memo-sheet memo-dialog memo-exam-why-sheet", whySheet.closing)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="exam-quiz-why"
              {...whySheet.dragProps}
            >
              <div className="memo-grab" data-drag-handle />
              <div className="memo-sheet-title">
                <span id="exam-quiz-why">{t("quiz.reviewWhy")}</span>
                <button type="button" className="memo-sheet-close" aria-label={t("common.close")} onClick={() => whySheet.dismiss()}>
                  <Msym name="close" size="1.45rem" fill={false} weight={500} />
                </button>
              </div>
              <p className="memo-exam-why-answer">
                <Msym name="check_circle" size="1.3rem" />
                <span>{question.answer}</span>
              </p>
              <p className="memo-exam-quiz-why">{question.explanation}</p>
              <div className="memo-sheet-actions">
                <button
                  type="button"
                  className="memo-button-solid"
                  onClick={() => {
                    nextAfterWhy.current = true;
                    whySheet.dismiss();
                  }}
                >
                  {t("quiz.understood")}
                </button>
              </div>
            </div>
          </MemoPortal>
        ) : null}
      </div>
    );
  }

  if (lesson.kind === "tutor") {
    return (
      <ExamTutorLesson
        examId={examId}
        topicId={topicId}
        lectureId={lesson.lectureId}
        topicTitle={lesson.topicTitle}
        steps={lesson.steps}
        onReact={onReact}
        onOutOfTime={onOutOfTime}
        onFinish={(points, total) => onFinish(Math.round(points * TUTOR_QUARTERS), total * TUTOR_QUARTERS)}
      />
    );
  }

  const question = lesson.questions[index];

  if (!question) {
    return null;
  }

  const passed = mark?.marked && (mark.score ?? 0) >= 3;

  async function check() {
    if (!question) {
      return;
    }

    setMarking(true);

    const body = { questionId: question.id, typedAnswer: unknown ? "" : answer, declaredUnknown: unknown };
    // A question written for a topic outside the material is marked by the exam, not the note's test.
    const response = await fetch(
      lesson.kind === "written" && lesson.generated
        ? `/api/exams/${examId}/written`
        : `/api/lectures/${lectureId}/practice-test/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lesson.kind === "written" && lesson.generated ? { ...body, topicId } : body),
      },
    ).catch(() => null);
    const payload = response?.ok ? ((await response.json()) as WrittenMark) : null;

    setMarking(false);
    setMark(payload ?? { marked: false, maxScore: 5, expectedAnswer: "" });

    if (payload?.marked) {
      onReact((payload.score ?? 0) >= 3 ? "cheer" : "sad");

      if ((payload.score ?? 0) < 3) {
        onMissed(question.id);
      }
    }
  }

  return (
    <div className="lecture-practice-stage">
      {/* The note's test head: the question and where it sits, over the bar. */}
      <div className="memo-test-meta">
        <span className="memo-test-no">{t("quiz.questionN", { index: index + 1 })}</span>
        <span className="memo-test-count">
          {index + 1} / {lesson.questions.length}
        </span>
      </div>
      <div className="memo-progress test">
        <div style={{ width: `${Math.round(((index + 1) / lesson.questions.length) * 100)}%` }} />
      </div>
      {revision ? (
        <p className="memo-exam-written-hint">
          <Emoji symbol="💡" size="1rem" />
          <span>{revision.hint}</span>
        </p>
      ) : null}
      <StudyPracticeQuestion
        prompt={question.prompt}
        answer={answer}
        unknown={unknown}
        disabled={marking || mark !== null}
        showUnknown={mark === null}
        onAnswer={setAnswer}
        onUnknown={setUnknown}
      />

      {mark ? (
        <div className={`memo-palace-mark ${passed ? "pass" : "fail"}`}>
          {mark.marked ? (
            <p className="memo-palace-mark-score">
              <Msym name={passed ? "check_circle" : "cancel"} size="1.3rem" />
              {t("palace.scoreOf", { score: mark.score ?? 0, total: mark.maxScore })}
            </p>
          ) : (
            <p className="memo-palace-mark-score unmarked">{t("test.notMarked")}</p>
          )}
          {mark.strengths ? (
            <p className="memo-palace-mark-line">
              <span className="memo-palace-model-label">{t("test.strengths")}</span>
              {mark.strengths}
            </p>
          ) : null}
          {mark.missingPoints ? (
            <p className="memo-palace-mark-line">
              <span className="memo-palace-model-label">{t("test.missing")}</span>
              {mark.missingPoints}
            </p>
          ) : null}
          {mark.expectedAnswer ? (
            <p className="memo-palace-mark-line">
              <span className="memo-palace-model-label">{t("test.expectedAnswer")}</span>
              {mark.expectedAnswer}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="memo-test-actions">
        {mark && mark.marked && !passed && !revision && (mark.missingPoints || mark.expectedAnswer) ? (
          <button
            type="button"
            className="memo-test-prev"
            onClick={() => {
              setRevision({ first: mark.score ?? 0, hint: mark.missingPoints || mark.expectedAnswer });
              setUnknown(false);
              setMark(null);
            }}
          >
            {t("exam.written.revise")}
          </button>
        ) : null}
        {mark ? (
          <button
            type="button"
            className="memo-test-next"
            onClick={() => {
              const second = mark.marked ? (mark.score ?? 0) : 0;
              const earned = revision ? Math.round((revision.first + second) / 2) : second;
              const possible = mark.marked ? mark.maxScore : 0;
              const nextTotal = writtenTotal + possible;
              const nextCorrect = correct + earned;

              if (index + 1 >= lesson.questions.length) {
                onFinish(nextCorrect, nextTotal);
                return;
              }

              setCorrect(nextCorrect);
              setWrittenTotal(nextTotal);
              setIndex(index + 1);
              setAnswer("");
              setUnknown(false);
              setMark(null);
              setRevision(null);
            }}
          >
            {t("exam.lesson.next")}
          </button>
        ) : (
          <button
            type="button"
            className="memo-test-next"
            disabled={marking || (!unknown && answer.trim().length === 0)}
            onClick={() => void check()}
          >
            {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{marking ? t("palace.checking") : t("palace.checkAnswer")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
