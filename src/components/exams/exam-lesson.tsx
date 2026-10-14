"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StudyGenerationNotice } from "@/components/generation-notice";
import { useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { NoteSpeedReader } from "@/components/note-speed-reader";
import { StudyFlashcard, type StudyFlashcardExit } from "@/components/study-flashcard";
import { StudyPracticeQuestion, StudyQuizQuestion } from "@/components/study-question";
import { LESSON_KIND_KEY, lessonHref } from "@/components/exams/exam-links";
import { ExamScreen } from "@/components/exams/exam-screen";
import { MemoBuddy, type BuddyMood } from "@/components/exams/memo-buddy";
import { EXAM_LESSON_KINDS, PRACTICE_LESSON_KINDS, type ExamLessonKind } from "@/lib/exams/exam-model";
import type { LessonGenerator, LessonLoad, LessonPayload } from "@/lib/exams/exams-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { FLASHCARD_EXIT_ANIMATION_MS, type FlashcardBucket } from "@/lib/study/flashcard-drag";

const POLL_MS = 4000;

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
      headline: "lesson" | "learned" | "mastered";
      /** The score, when a practice lesson came in under the target and will come back. */
      below: number | null;
      following: { label: string; href: string } | null;
    };

type WrittenMark = {
  marked: boolean;
  score?: number;
  maxScore: number;
  expectedAnswer: string;
  strengths?: string;
  missingPoints?: string;
};

export type ExamLessonModule = {
  lectureId: string;
  title: string;
  position: number;
  done: Record<ExamLessonKind, boolean>;
  latest: Record<ExamLessonKind, number | null>;
  /** Practice lessons the path still wants repeated, weakest first. */
  review: ExamLessonKind[];
  learned: boolean;
  mastered: boolean;
};

/** Where the path goes after this module: the next module still to master, or the mock exam. */
export type ExamLessonAfter =
  | { type: "module"; lectureId: string; title: string; kind: ExamLessonKind }
  | { type: "mock" }
  | null;

export function ExamLesson({
  examId,
  examTitle,
  module,
  kind,
  target,
  after,
}: {
  examId: string;
  examTitle: string;
  module: ExamLessonModule;
  kind: ExamLessonKind;
  /** The exam's goal, 0..100. */
  target: number;
  after: ExamLessonAfter;
}) {
  const { t } = useTranslations();
  const { navigateWithFeedback } = useInstantNavigation();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [buddy, setBuddy] = useState<{ mood: BuddyMood; key: number }>({ mood: "wave", key: 0 });
  const [saveError, setSaveError] = useState(false);
  const startedGeneration = useRef(false);
  /* `navigateWithFeedback` is a new function every render; a load keyed on it would restart forever. */
  const navigateRef = useRef(navigateWithFeedback);
  const examHref = `/app/exams/${examId}`;

  useEffect(() => {
    navigateRef.current = navigateWithFeedback;
  });

  const react = useCallback((mood: BuddyMood) => {
    setBuddy((current) => ({ mood, key: current.key + 1 }));
  }, []);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/exams/${examId}/lesson?lectureId=${module.lectureId}&kind=${kind}`,
      { cache: "no-store" },
    );

    if (response.status === 402) {
      navigateRef.current("/app/start");
      return;
    }

    if (!response.ok) {
      setPhase({ name: "failed", generator: null });
      return;
    }

    const load = (await response.json()) as LessonLoad;

    if (load.status === "ready") {
      setPhase({ name: "playing", lesson: load.lesson });
      return;
    }

    if (load.status === "failed") {
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
  }, [examId, kind, module.lectureId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (phase.name !== "generating") {
      return;
    }

    const timer = window.setTimeout(() => void load(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [load, phase]);

  async function save(correct: number, total: number, difficulty: number | null) {
    setSaveError(false);
    setPhase({ name: "saving" });

    const response = await fetch(`/api/exams/${examId}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lectureId: module.lectureId, kind, correct, total, difficulty }),
    }).catch(() => null);

    if (!response?.ok) {
      setSaveError(true);
      setPhase({ name: "zone", correct, total });
      return;
    }

    const doneAfter = { ...module.done, [kind]: true };

    if (kind === "summary") {
      navigateWithFeedback(lessonHref(examId, module.lectureId, nextKindAfter(doneAfter) ?? "flashcards"), { refresh: true });
      return;
    }

    /*
     * The same rule the path uses (`moduleProgress`): once every lesson has been done, a practice
     * lesson under the target comes back until it reaches it, and the module is mastered when
     * none is left. Lessons the path already wanted repeated for another reason stay wanted.
     */
    const goal = target / 100;
    const score = total > 0 ? Math.min(1, correct / total) : 1;
    const isPractice = (PRACTICE_LESSON_KINDS as readonly ExamLessonKind[]).includes(kind);
    const latestAfter = { ...module.latest, [kind]: isPractice ? score : module.latest[kind] };
    const learnedAfter = EXAM_LESSON_KINDS.every((entry) => doneAfter[entry]);
    const reviewAfter = learnedAfter
      ? [...PRACTICE_LESSON_KINDS]
          .filter(
            (entry) =>
              (latestAfter[entry] ?? 0) < goal - 1e-9 || (entry !== kind && module.review.includes(entry)),
          )
          .sort((left, right) => (latestAfter[left] ?? 0) - (latestAfter[right] ?? 0))
      : [];
    const masteredAfter = learnedAfter && reviewAfter.length === 0;
    const untried = nextKindAfter(doneAfter);
    const following = untried
      ? { label: t("exam.lesson.done.next", { lesson: t(LESSON_KIND_KEY[untried]) }), href: lessonHref(examId, module.lectureId, untried) }
      : reviewAfter[0]
        ? { label: t("exam.lesson.done.repeat", { lesson: t(LESSON_KIND_KEY[reviewAfter[0]]) }), href: lessonHref(examId, module.lectureId, reviewAfter[0]) }
        : after?.type === "module"
          ? { label: t("exam.lesson.done.nextModule", { title: after.title }), href: lessonHref(examId, after.lectureId, after.kind) }
          : after?.type === "mock"
            ? { label: t("exam.lesson.done.mock"), href: `${examHref}/mock` }
            : null;
    const below = isPractice && score < goal - 1e-9 ? Math.round(score * 100) : null;

    react(below === null ? "cheer" : "happy");
    setPhase({
      name: "done",
      correct,
      total,
      headline: masteredAfter && !module.mastered ? "mastered" : learnedAfter && !module.learned ? "learned" : "lesson",
      below,
      following,
    });
  }

  function nextKindAfter(done: Record<ExamLessonKind, boolean>) {
    const after = EXAM_LESSON_KINDS.slice(EXAM_LESSON_KINDS.indexOf(kind) + 1).find((entry) => !done[entry]);
    return after ?? EXAM_LESSON_KINDS.find((entry) => !done[entry]) ?? null;
  }

  const kindIndex = EXAM_LESSON_KINDS.indexOf(kind);
  const title = `${t("exam.dash.module", { index: module.position + 1 })} · ${t(LESSON_KIND_KEY[kind])}`;

  return (
    <ExamScreen backHref={examHref} backIcon="close" backLabel={examTitle} title={title} refreshOnBack>
      <div className="memo-exam-lesson-head">
        <div className="memo-exam-lesson-steps" aria-label={t("exam.lesson.progress", { index: kindIndex + 1, total: EXAM_LESSON_KINDS.length })}>
          {EXAM_LESSON_KINDS.map((entry, index) => (
            <i key={entry} className={module.done[entry] || index < kindIndex ? "on" : index === kindIndex ? "current" : ""} />
          ))}
        </div>
        <span className="memo-exam-lesson-module">{module.title}</span>
      </div>

      <div className="memo-panel study memo-exam-lesson">
        {phase.name === "loading" || phase.name === "saving" ? (
          <div className="memo-exam-center">
            <MemoBuddy mood="think" size="6rem" thought="💭" />
            <Loader2 className="h-5 w-5 animate-spin" aria-label={t("common.loading")} />
          </div>
        ) : phase.name === "generating" ? (
          <StudyGenerationNotice preview={GENERATOR_PREVIEW[phase.generator]} stageCopy={t(GENERATOR_STAGE[phase.generator])} />
        ) : phase.name === "failed" ? (
          <div className="memo-exam-center">
            <MemoBuddy mood="sad" size="6rem" />
            <p className="memo-study-empty-title">{t("exam.lesson.failed")}</p>
            <div className="memo-exam-cta-row">
              <button
                type="button"
                className="memo-button-ghost"
                onClick={() => {
                  startedGeneration.current = false;
                  setPhase({ name: "loading" });

                  if (phase.generator) {
                    void fetch(`/api/lectures/${module.lectureId}/${GENERATOR_ROUTE[phase.generator]}`, { method: "POST" })
                      .catch(() => null)
                      .finally(() => void load());
                  } else {
                    void load();
                  }
                }}
              >
                {t("common.retry")}
              </button>
              <button type="button" className="memo-button-coral" onClick={() => void save(0, 0, null)}>
                {t("exam.lesson.skip")}
              </button>
            </div>
          </div>
        ) : phase.name === "playing" ? (
          <LessonBody
            lesson={phase.lesson}
            lectureId={module.lectureId}
            onReact={react}
            buddy={buddy}
            onFinish={(correct, total) =>
              phase.lesson.kind === "summary" ? void save(1, 1, null) : setPhase({ name: "zone", correct, total })
            }
          />
        ) : phase.name === "zone" ? (
          <LearningZone
            correct={phase.correct}
            total={phase.total}
            error={saveError}
            onRetry={() => {
              setPhase({ name: "loading" });
              void load();
            }}
            onContinue={(difficulty) => void save(phase.correct, phase.total, difficulty)}
          />
        ) : (
          <div className="memo-exam-center memo-exam-done">
            <MemoBuddy mood={buddy.mood} moodKey={buddy.key} size="7rem" sparkles />
            <h2>
              {phase.headline === "mastered"
                ? t("exam.lesson.done.module")
                : phase.headline === "learned"
                  ? t("exam.lesson.done.learned", { target })
                  : t("exam.lesson.done.title")}
            </h2>
            {phase.below !== null ? (
              <p>{t("exam.lesson.done.below", { score: phase.below, target })}</p>
            ) : phase.total > 0 ? (
              <p>{t("exam.zone.score", { correct: phase.correct, total: phase.total })}</p>
            ) : null}
            <div className="memo-exam-cta-col">
              {phase.following ? (
                <NextStepButton step={phase.following} onGo={(href) => navigateWithFeedback(href, { refresh: true })} />
              ) : null}
              <button type="button" className="memo-button-ghost" onClick={() => navigateWithFeedback(examHref, { refresh: true })}>
                {t("exam.lesson.done.back")}
              </button>
            </div>
          </div>
        )}
      </div>
    </ExamScreen>
  );
}

function NextStepButton({
  step,
  onGo,
}: {
  step: { label: string; href: string };
  onGo: (href: string) => void;
}) {
  return (
    <button type="button" className="memo-button-coral" onClick={() => onGo(step.href)}>
      {step.label}
    </button>
  );
}

function LearningZone({
  correct,
  total,
  error,
  onRetry,
  onContinue,
}: {
  correct: number;
  total: number;
  error: boolean;
  onRetry: () => void;
  onContinue: (difficulty: number) => void;
}) {
  const { t } = useTranslations();
  const [difficulty, setDifficulty] = useState(3);
  const ratio = total > 0 ? correct / total : 1;
  const hint =
    difficulty <= 2 ? "exam.zone.hintHarder" : difficulty >= 4 ? "exam.zone.hintEasier" : "exam.zone.hintSame";

  return (
    <div className="memo-exam-center memo-exam-zone">
      <MemoBuddy mood={ratio >= 0.6 ? "happy" : "sad"} size="6rem" />
      <h2>{total > 0 ? t("exam.zone.score", { correct, total }) : t("exam.lesson.done.title")}</h2>
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
          onChange={(event) => setDifficulty(Number(event.target.value))}
        />
        <div className="memo-exam-zone-labels">
          <span>{t("exam.zone.easy")}</span>
          <span>{t("exam.zone.right")}</span>
          <span>{t("exam.zone.hard")}</span>
        </div>
      </div>
      <p className="memo-exam-fine">{t(hint)}</p>
      {error ? <p className="memo-inline-error">{t("exam.lesson.saveFailed")}</p> : null}
      <div className="memo-exam-cta-row">
        <button type="button" className="memo-button-ghost" onClick={onRetry}>
          {t("exam.zone.retry")}
        </button>
        <button type="button" className="memo-button-coral" onClick={() => onContinue(difficulty)}>
          {t("exam.zone.continue")}
        </button>
      </div>
    </div>
  );
}

function LessonBody({
  lesson,
  lectureId,
  onFinish,
  onReact,
  buddy,
}: {
  lesson: LessonPayload;
  lectureId: string;
  onFinish: (correct: number, total: number) => void;
  onReact: (mood: BuddyMood) => void;
  buddy: { mood: BuddyMood; key: number };
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
  const exitToken = useRef(0);

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
          {lesson.keyTopics.length > 0 ? (
            <>
              <span className="memo-eyebrow">{t("exam.lesson.keyTopics")}</span>
              <div className="memo-chip-row">
                {lesson.keyTopics.slice(0, 8).map((topic) => (
                  <span key={topic} className="memo-chip">
                    {topic}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="memo-chip-row">
          <button type="button" className="memo-chip" onClick={() => setSpeedReading(true)}>
            <Msym name="bolt" size="1.1rem" /> {t("exam.lesson.speedRead")}
          </button>
        </div>
        <div className="memo-exam-cta-row">
          <button type="button" className="memo-button-coral" onClick={() => onFinish(1, 1)}>
            {t("exam.lesson.finishWithQuiz")}
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

    const grade = (bucket: FlashcardBucket) => {
      exitToken.current += 1;
      setExit({ bucket, flipped, token: exitToken.current, startXPercent: 0, startYPercent: 0, startRotationDeg: 0 });
      void fetch(`/api/flashcards/${card.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidenceBucket: bucket }),
      }).catch(() => null);

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
          onGrade={(bucket) => grade(bucket)}
          flipHint={flipHint}
          missedCount={missed}
          knownCount={correct}
          exit={exit}
          disabled={Boolean(exit)}
        />
        <div className="memo-exam-buddy-corner">
          <MemoBuddy mood={buddy.mood} moodKey={buddy.key} size="3.6rem" />
        </div>
      </>
    );
  }

  if (lesson.kind === "quiz" || lesson.kind === "true_false") {
    const total = lesson.kind === "quiz" ? lesson.questions.length : lesson.statements.length;
    const question =
      lesson.kind === "quiz"
        ? (() => {
            const entry = lesson.questions[index];
            return entry
              ? { id: entry.id, prompt: entry.prompt, options: entry.options, correct_option_idx: entry.correctIndex, explanation: entry.explanation, answer: entry.options[entry.correctIndex] }
              : null;
          })()
        : (() => {
            const entry = lesson.statements[index];
            return entry
              ? {
                  id: entry.id,
                  prompt: t("exam.lesson.trueFalse.statement", { prompt: entry.prompt, claim: entry.claim }),
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

    const wrong = selection !== null && selection !== question.correct_option_idx;

    return (
      <div className="lecture-quiz-stage">
        <div className="memo-quiz-head">
          <span className="memo-quiz-count">{t("quiz.questionN", { index: index + 1 })}</span>
          <span className="memo-quiz-total">
            {index + 1} / {total}
          </span>
        </div>
        <div className="memo-progress quiz">
          <div style={{ width: `${Math.round(((index + 1) / total) * 100)}%` }} />
        </div>
        <div className="lecture-quiz-card">
          <StudyQuizQuestion
            question={question}
            order={question.options.map((_, optionIndex) => optionIndex)}
            selection={selection}
            onSelect={(choice) => {
              setSelection(choice);
              onReact(choice === question.correct_option_idx ? "happy" : "sad");
            }}
          />
          {selection !== null ? (
            <div className={`memo-exam-explain ${wrong ? "wrong" : "right"}`}>
              <div className="memo-exam-explain-head">
                <MemoBuddy mood={buddy.mood} moodKey={buddy.key} size="3rem" />
                <b>{wrong ? t("quiz.wrongTitle") : t("exam.lesson.correct")}</b>
              </div>
              {lesson.kind === "true_false" ? (
                <p>{t("exam.lesson.trueFalse.answer", { answer: question.answer })}</p>
              ) : null}
              {question.explanation ? <p>{question.explanation}</p> : null}
              <div className="memo-test-actions">
                <button type="button" className="memo-test-next" onClick={() => advance(total, !wrong)}>
                  {wrong ? t("quiz.understood") : t("exam.lesson.next")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
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

    const response = await fetch(`/api/lectures/${lectureId}/practice-test/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, typedAnswer: unknown ? "" : answer, declaredUnknown: unknown }),
    }).catch(() => null);
    const payload = response?.ok ? ((await response.json()) as WrittenMark) : null;

    setMarking(false);
    setMark(payload ?? { marked: false, maxScore: 5, expectedAnswer: "" });

    if (payload?.marked) {
      onReact((payload.score ?? 0) >= 3 ? "cheer" : "sad");
    }
  }

  return (
    <div className="lecture-practice-stage">
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
          <div className="memo-exam-buddy-corner">
            <MemoBuddy mood={buddy.mood} moodKey={buddy.key} size="3.4rem" />
          </div>
        </div>
      ) : null}

      <div className="memo-test-actions">
        {mark ? (
          <button
            type="button"
            className="memo-test-next"
            onClick={() => {
              const earned = mark.marked ? (mark.score ?? 0) : 0;
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
      <p className="memo-exam-fine">
        <Emoji symbol="✍️" size="1rem" /> {t("exam.lesson.writtenHint")}
      </p>
    </div>
  );
}
