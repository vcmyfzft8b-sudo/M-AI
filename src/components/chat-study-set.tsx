"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import {
  MindmapCanvas,
  type MindmapCanvasHandle,
} from "@/components/mindmap-canvas";
import { Msym } from "@/components/msym";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { StudyFlashcard, type StudyFlashcardExit } from "@/components/study-flashcard";
import { StudyPracticeQuestion, StudyQuizQuestion } from "@/components/study-question";
import {
  countChatStudyItems,
  isChatStudySet,
  type ChatStudyAttachment,
  type ChatStudyKind,
  type ChatStudySet,
} from "@/lib/chat-study-set";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { MindmapDoc, MindmapNode } from "@/lib/mindmap-doc";
import { flattenMindmap, mindmapBranchIndexOf } from "@/lib/mindmap-doc";
import {
  MINDMAP_REFERENCE_FRAMES,
  mindmapBranchColor,
  suggestMindmapFold,
} from "@/lib/mindmap-layout";
import { NOTE_TABS } from "@/lib/note-tabs";
import { FLASHCARD_EXIT_ANIMATION_MS, type FlashcardBucket } from "@/lib/study/flashcard-drag";
import { QUIZ_CORRECT_PAUSE_MS } from "@/lib/study/quiz";

/**
 * A study set the tutor made in the chat, drawn under the reply that introduced it.
 *
 * Every part of it is the note screen's own: the flashcard is `StudyFlashcard`, the questions are
 * `StudyQuizQuestion` and `StudyPracticeQuestion`, the result is `StudyCompletionCard`, the map is
 * `MindmapCanvas`, and the body sits inside `.memo-panel` so the same stylesheet dresses it. What
 * is the chat's own is only the frame (a heading naming the set, in the note tab's colour) and the
 * sizing that fits a deck into a bubble. A set made here and the same set on a tab cannot drift
 * apart, because there is only one of each thing.
 *
 * Progress is the session's, not the account's: a chat set is a quick pass, and the note's own
 * tabs are where spaced review is kept.
 */

const KIND_TAB: Record<ChatStudyKind, (typeof NOTE_TABS)[number]> = Object.fromEntries(
  NOTE_TABS.filter((tab) => ["flashcards", "quiz", "test", "mindmap"].includes(tab.id)).map(
    (tab) => [tab.id, tab],
  ),
) as Record<ChatStudyKind, (typeof NOTE_TABS)[number]>;

const MAKING_KEY: Record<ChatStudyKind, MessageKey> = {
  flashcards: "chat.set.making.flashcards",
  quiz: "chat.set.making.quiz",
  test: "chat.set.making.test",
  mindmap: "chat.set.making.mindmap",
};

const COUNT_KEY: Record<ChatStudyKind, MessageKey> = {
  flashcards: "chat.set.count.cards",
  quiz: "chat.set.count.questions",
  test: "chat.set.count.questions",
  mindmap: "chat.set.count.topics",
};

function SetFrame({
  kind,
  heading,
  title,
  className = "",
  children,
}: {
  kind: ChatStudyKind;
  heading: ReactNode;
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const tab = KIND_TAB[kind];
  const sectionRef = useKeepGrowthInView();

  return (
    <section
      ref={sectionRef}
      className={`memo-chat-set ${className}`.trim()}
      data-kind={kind}
      style={{ "--tab-tint": tab.tint } as CSSProperties}
    >
      <header className="memo-chat-set-head">
        <span className="memo-chat-set-icon" aria-hidden="true">
          <Msym name={tab.icon} size="1.15rem" />
        </span>
        <span className="memo-chat-set-heading">
          <span className="memo-chat-set-kind">{heading}</span>
          {title ? <span className="memo-chat-set-title">{title}</span> : null}
        </span>
      </header>
      {children}
    </section>
  );
}

/**
 * Keeps what a set grows by on screen.
 *
 * Answering in a set adds to it (a verdict, an explanation, the model answer, the results), and in
 * a chat that is near the foot of the log it lands below the composer, so the button that carries
 * on is out of sight. When the set grows and its new foot is hidden, the log scrolls just far
 * enough to show it, and never so far that the set's own top leaves the view. The chat's logs
 * already follow new messages; this is only for a message that changes size in place.
 */
function useKeepGrowthInView() {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    const log = node?.closest<HTMLElement>(".memo-chat-log, .memo-homechat-log, .memo-m-chat-log");

    if (!node || !log) {
      return;
    }

    let height = node.getBoundingClientRect().height;
    const sizes = new ResizeObserver(() => {
      const box = node.getBoundingClientRect();
      const grew = box.height > height + 1;
      height = box.height;

      if (!grew) {
        return;
      }

      const view = log.getBoundingClientRect();
      const hidden = box.bottom - view.bottom;

      if (hidden > 0) {
        log.scrollTop += Math.min(hidden + 12, Math.max(0, box.top - view.top - 12));
      }
    });

    sizes.observe(node);
    return () => sizes.disconnect();
  }, []);

  return ref;
}

/** Holds the set's place while the second call writes it. */
export function ChatStudySetPending({ kind }: { kind: ChatStudyKind }) {
  const t = useT();

  return (
    <SetFrame
      kind={kind}
      className="pending"
      heading={t(KIND_TAB[kind].labelKey)}
      title={
        <span role="status" className="memo-chat-set-making">
          <Msym name="progress_activity" className="memo-spin" size="1rem" />
          {t(MAKING_KEY[kind])}
        </span>
      }
    >
      <div className="memo-chat-set-ghost" aria-hidden="true" />
    </SetFrame>
  );
}

export function ChatStudySetCard({ attachment }: { attachment: ChatStudyAttachment }) {
  const t = useT();

  if (!isChatStudySet(attachment)) {
    return (
      <SetFrame
        kind={attachment.kind}
        className="failed"
        heading={t(KIND_TAB[attachment.kind].labelKey)}
        title={t("chat.set.failed")}
      />
    );
  }

  return (
    <SetFrame kind={attachment.kind} heading={<SetHeading set={attachment} />} title={attachment.title}>
      {attachment.kind === "mindmap" ? (
        <ChatMindmap doc={attachment.doc} title={attachment.title} />
      ) : (
        <div className="memo-panel memo-chat-set-body">
          <SetBody set={attachment} />
        </div>
      )}
    </SetFrame>
  );
}

function SetHeading({ set }: { set: ChatStudySet }) {
  const t = useT();

  return (
    <>
      {t(KIND_TAB[set.kind].labelKey)}
      <span aria-hidden="true"> · </span>
      {t(COUNT_KEY[set.kind], { count: countChatStudyItems(set) })}
    </>
  );
}

function SetBody({ set }: { set: Exclude<ChatStudySet, { kind: "mindmap" }> }) {
  switch (set.kind) {
    case "flashcards":
      return <ChatFlashcards cards={set.cards} />;
    case "quiz":
      return <ChatQuiz questions={set.questions} />;
    case "test":
      return <ChatTest questions={set.questions} />;
  }
}

function RestartButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="lecture-study-refresh lecture-study-restart">
      <Msym name="replay" size="1.2rem" fill={false} weight={500} />
      {label}
    </button>
  );
}

/**
 * Where the learner is in the set: the line every study screen heads itself with, without the
 * screen's progress bar, which a message has no room for.
 */
function StudyProgress({ label, count }: { label: string; count: string }) {
  return (
    <div className="memo-study-head">
      <span className="memo-study-head-title">{label}</span>
      <span className="memo-study-head-count">{count}</span>
    </div>
  );
}

/** A clamp that keeps the timer of the last answer from firing into a remounted set. */
function useTimeout() {
  const timerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const schedule = useCallback(
    (callback: () => void, delayMs: number) => {
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        callback();
      }, delayMs);
    },
    [clear],
  );

  return { schedule, clear };
}

function ChatFlashcards({ cards }: { cards: { front: string; back: string }[] }) {
  const t = useT();
  /* The cards of this round, by index into `cards`: all of them, then only the missed ones. */
  const [queue, setQueue] = useState(() => cards.map((_, index) => index));
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [grades, setGrades] = useState<Record<number, FlashcardBucket>>({});
  const [exit, setExit] = useState<StudyFlashcardExit | null>(null);
  const tokenRef = useRef(0);
  const exitTimer = useTimeout();

  const cardIndex = queue[position];
  const card = cardIndex === undefined ? null : cards[cardIndex];
  const roundGrades = queue.map((index) => grades[index]).filter(Boolean);
  const missed = roundGrades.filter((grade) => grade === "again").length;
  const known = roundGrades.length - missed;

  const flipHint = (
    <>
      <span className="memo-only-desktop">{t("study.cards.flipDesktop")}</span>
      <span className="memo-only-mobile">{t("study.cards.flipMobile")}</span>
    </>
  );

  function grade(bucket: FlashcardBucket, exitStart: { xPercent: number; yPercent: number; rotationDeg: number }) {
    if (cardIndex === undefined) {
      return;
    }

    tokenRef.current += 1;
    const token = tokenRef.current;

    setExit({
      bucket: bucket === "again" ? "again" : "easy",
      flipped,
      token,
      startXPercent: exitStart.xPercent,
      startYPercent: exitStart.yPercent,
      startRotationDeg: exitStart.rotationDeg,
    });
    exitTimer.schedule(
      () => setExit((current) => (current?.token === token ? null : current)),
      FLASHCARD_EXIT_ANIMATION_MS,
    );
    setGrades((current) => ({ ...current, [cardIndex]: bucket }));
    setFlipped(false);
    setPosition((current) => current + 1);
  }

  function startRound(indices: number[]) {
    setQueue(indices);
    setPosition(0);
    setFlipped(false);
    setExit(null);
    setGrades((current) => {
      const next = { ...current };
      for (const index of indices) delete next[index];
      return next;
    });
  }

  if (!card) {
    const missedIndices = queue.filter((index) => grades[index] === "again");

    return (
      <StudyCompletionCard
        compact
        eyebrow={t("study.completed")}
        title={t(missedIndices.length === 0 ? "study.cards.allDone" : "study.cards.repeatMissed")}
        percentage={queue.length > 0 ? (known / queue.length) * 100 : 100}
        percentageLabel={t("study.score")}
        primaryMetric={{ label: t("study.correctThisRound"), value: `${known}/${queue.length}` }}
        actions={
          missedIndices.length > 0 ? (
            <RestartButton
              label={t("study.repeatMissedCards", { count: missedIndices.length })}
              onClick={() => startRound(missedIndices)}
            />
          ) : (
            <RestartButton
              label={t("study.restartSet")}
              onClick={() => startRound(cards.map((_, index) => index))}
            />
          )
        }
      />
    );
  }

  return (
    <>
      <StudyProgress
        label={t("study.cards.cardN", { index: position + 1 })}
        count={t("study.cards.remaining", { count: Math.max(0, queue.length - position - 1) })}
      />
      <StudyFlashcard
        key={`${cardIndex}-${position}`}
        front={card.front}
        back={card.back}
        flipped={flipped}
        onFlip={() => setFlipped((current) => !current)}
        onGrade={(bucket, exitStart) => grade(bucket, exitStart)}
        flipHint={flipHint}
        answerLabel={
          grades[cardIndex] ? t(grades[cardIndex] === "again" ? "study.cards.didntKnow" : "study.cards.knew") : null
        }
        answerClass={grades[cardIndex] === "again" ? "again" : "easy"}
        answer={grades[cardIndex] ?? null}
        missedCount={missed}
        knownCount={known}
        navigation={{
          onPrevious: () => {
            setFlipped(false);
            setPosition((current) => Math.max(0, current - 1));
          },
          onNext: () => {
            setFlipped(false);
            setPosition((current) => Math.min(queue.length - 1, current + 1));
          },
          canPrevious: position > 0,
          canNext: position < queue.length - 1,
        }}
        exit={exit}
      />
    </>
  );
}

function ChatQuiz({
  questions,
}: {
  questions: { prompt: string; options: string[]; correctIndex: number; explanation: string | null }[];
}) {
  const t = useT();
  const [queue, setQueue] = useState(() => questions.map((_, index) => index));
  const [position, setPosition] = useState(0);
  const [selection, setSelection] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, boolean>>({});
  const advance = useTimeout();

  const questionIndex = queue[position];
  const question = questionIndex === undefined ? null : questions[questionIndex];
  /* The server already shuffled the options and stored them in that order. */
  const order = useMemo(
    () => (question ? question.options.map((_, index) => index) : []),
    [question],
  );

  function next() {
    advance.clear();
    setSelection(null);
    setPosition((current) => current + 1);
  }

  function select(optionIndex: number) {
    if (!question || questionIndex === undefined || selection !== null) {
      return;
    }

    const correct = optionIndex === question.correctIndex;

    setSelection(optionIndex);
    setResults((current) => ({ ...current, [questionIndex]: correct }));

    if (correct) {
      advance.schedule(next, QUIZ_CORRECT_PAUSE_MS);
    }
  }

  function startRound(indices: number[]) {
    advance.clear();
    setQueue(indices);
    setPosition(0);
    setSelection(null);
  }

  if (!question || questionIndex === undefined) {
    const missedIndices = queue.filter((index) => results[index] === false);
    const correct = queue.length - missedIndices.length;

    return (
      <StudyCompletionCard
        compact
        eyebrow={t("study.completed")}
        title={t(missedIndices.length === 0 ? "quiz.finished" : "quiz.repeatMissed")}
        percentage={queue.length > 0 ? (correct / queue.length) * 100 : 100}
        percentageLabel={t("study.score")}
        primaryMetric={{ label: t("study.correctThisRound"), value: `${correct}/${queue.length}` }}
        actions={
          missedIndices.length > 0 ? (
            <RestartButton
              label={t("quiz.repeatMissedQuestions", { count: missedIndices.length })}
              onClick={() => startRound(missedIndices)}
            />
          ) : (
            <RestartButton
              label={t("quiz.restart")}
              onClick={() => startRound(questions.map((_, index) => index))}
            />
          )
        }
      />
    );
  }

  const wrong = selection !== null && selection !== question.correctIndex;

  return (
    <div className="lecture-quiz-stage">
      <StudyProgress
        label={t("quiz.questionN", { index: position + 1 })}
        count={`${position + 1} / ${queue.length}`}
      />
      <div className="lecture-quiz-card">
        <StudyQuizQuestion
          question={{
            id: `q${questionIndex}`,
            prompt: question.prompt,
            options: question.options,
            correct_option_idx: question.correctIndex,
          }}
          order={order}
          selection={selection}
          /* What the quiz tab does on a phone, at every width here: a bubble has no room to keep
             two options nobody chose on screen above the verdict. */
          collapseAnswered
          onSelect={select}
        />

        {wrong ? (
          <div className="memo-quiz-result">
            <span className="memo-quiz-result-badge">
              <Msym name="cancel" size="1.25rem" />
            </span>
            <span className="memo-quiz-result-copy">
              <span className="memo-quiz-result-title">{t("quiz.wrongTitle")}</span>
              {/*
                * No "the correct answer is B": on a phone the options carry no letters until the
                * tab's collapsed review brings them back, and here the right option is already
                * ticked in green right above.
                */}
              {question.explanation ? (
                <span className="memo-palace-why">
                  <span className="memo-palace-model-label">{t("palace.explanation")}</span>
                  {question.explanation}
                </span>
              ) : null}
            </span>
            <div className="memo-quiz-result-actions">
              <button type="button" onClick={next} className="memo-quiz-result-primary">
                {t("quiz.understood")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Open questions, marked by the learner against a model answer.
 *
 * The note's test is marked by a model, which needs the question stored against the note; these
 * are not, and a set made from the whole library belongs to no note at all. So this is the memory
 * palace's arrangement instead: write your answer, see the answer it is marked against, say
 * whether you had it.
 */
function ChatTest({ questions }: { questions: { prompt: string; answer: string }[] }) {
  const t = useT();
  const [position, setPosition] = useState(0);
  const [draft, setDraft] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);

  const question = questions[position];

  function mark(knew: boolean) {
    setResults((current) => [...current, knew]);
    setDraft("");
    setUnknown(false);
    setRevealed(false);
    setPosition((current) => current + 1);
  }

  if (!question) {
    const known = results.filter(Boolean).length;

    return (
      <StudyCompletionCard
        compact
        eyebrow={t("study.completed")}
        title={t("chat.set.testFinished")}
        percentage={questions.length > 0 ? (known / questions.length) * 100 : 100}
        percentageLabel={t("study.score")}
        primaryMetric={{ label: t("study.correctAnswers"), value: `${known}/${questions.length}` }}
        actions={
          <RestartButton
            label={t("study.restart")}
            onClick={() => {
              setResults([]);
              setPosition(0);
            }}
          />
        }
      />
    );
  }

  return (
    <div className="lecture-practice-stage">
      <StudyProgress
        label={t("quiz.questionN", { index: position + 1 })}
        count={`${position + 1} / ${questions.length}`}
      />
      <StudyPracticeQuestion
        prompt={question.prompt}
        answer={draft}
        unknown={unknown}
        disabled={revealed}
        showUnknown={!revealed}
        onAnswer={setDraft}
        onUnknown={setUnknown}
      />

      {revealed ? (
        <div className="memo-palace-mark">
          <p className="memo-palace-mark-line">
            <span className="memo-palace-model-label">{t("test.expectedAnswer")}</span>
            {question.answer}
          </p>
        </div>
      ) : null}

      <div className="memo-test-actions">
        {revealed && unknown ? (
          /* "I don't know" already said how it went; there is nothing left to mark. */
          <button type="button" className="memo-test-next" onClick={() => mark(false)}>
            {t("quiz.understood")}
          </button>
        ) : revealed ? (
          /* The deck's own grade buttons, worded rather than counted: the same two answers. */
          <div className="lecture-flashcard-review memo-chat-set-grade">
            <button
              type="button"
              className="lecture-flashcard-review-button again"
              onClick={() => mark(false)}
            >
              <Msym name="close" size="1.05rem" />
              <span>{t("study.cards.didntKnow")}</span>
            </button>
            <button
              type="button"
              className="lecture-flashcard-review-button easy"
              onClick={() => mark(true)}
            >
              <Msym name="check" size="1.05rem" />
              <span>{t("study.cards.knew")}</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="memo-test-next"
            disabled={!unknown && draft.trim().length === 0}
            onClick={() => setRevealed(true)}
          >
            <span>{unknown ? t("chat.set.skip") : t("palace.checkAnswer")}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* Nothing to subscribe to: `useSyncExternalStore` is only here to tell the server from the client. */
function subscribeToNothing() {
  return () => undefined;
}

/**
 * The map, small in the bubble and whole when opened.
 *
 * The bubble's copy is a picture of the map, not the map: a canvas that pans under a finger
 * inside a log that scrolls under the same finger is a trap on a phone, so in the log it is
 * covered by the button that opens it. Opened, it is the note tab's stage at full screen.
 *
 * Drawn only once mounted. How it folds depends on the screen it is drawn on, and the server
 * cannot know that, so a map rendered there would be re-folded on hydration.
 */
function ChatMindmap({ doc, title }: { doc: MindmapDoc; title: string }) {
  const t = useT();
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const [open, setOpen] = useState(false);
  const [userCollapsedIds, setUserCollapsedIds] = useState<ReadonlySet<string> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const previewRef = useRef<MindmapCanvasHandle | null>(null);
  const fullRef = useRef<MindmapCanvasHandle | null>(null);

  const suggestedFold = useMemo(() => {
    if (!mounted) {
      return new Set<string>();
    }

    const isPhone = window.matchMedia("(max-width: 1099px)").matches;

    return suggestMindmapFold(doc, { frame: MINDMAP_REFERENCE_FRAMES[isPhone ? "phone" : "desktop"] });
  }, [doc, mounted]);
  const collapsedIds = userCollapsedIds ?? suggestedFold;

  const toggleCollapse = useCallback(
    (nodeId: string) => {
      setUserCollapsedIds((previous) => {
        const next = new Set(previous ?? suggestedFold);

        if (!next.delete(nodeId)) {
          next.add(nodeId);
        }

        return next;
      });
    },
    [suggestedFold],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const selected: MindmapNode | null = useMemo(
    () => (selectedId ? (flattenMindmap(doc).find((node) => node.id === selectedId) ?? null) : null),
    [doc, selectedId],
  );

  const mapTitle = doc.title || title;

  return (
    <>
      <div className="memo-mm-stage memo-chat-set-map">
        {mounted ? (
          <MindmapCanvas
            doc={doc}
            title={mapTitle}
            collapsedIds={collapsedIds}
            selectedId={null}
            matchedIds={null}
            onSelect={() => undefined}
            onToggleCollapse={() => undefined}
            handleRef={previewRef}
            ariaLabel={t("mindmap.canvasLabel")}
          />
        ) : null}
        <button type="button" className="memo-chat-set-map-open" onClick={() => setOpen(true)}>
          <span className="memo-chat-set-map-open-label">
            <Msym name="open_in_full" size="1.05rem" fill={false} weight={500} />
            {t("chat.set.openMindmap")}
          </span>
        </button>
      </div>

      {open ? (
        <MemoPortal>
          <div className="memo-mm-overlay memo-chat-set-map-overlay">
            <div
              className="memo-mm-stage fullscreen"
              role="application"
              aria-label={t("mindmap.canvasLabel")}
            >
              <MindmapCanvas
                doc={doc}
                title={mapTitle}
                collapsedIds={collapsedIds}
                selectedId={selectedId}
                matchedIds={null}
                onSelect={setSelectedId}
                onToggleCollapse={toggleCollapse}
                handleRef={fullRef}
                ariaLabel={t("mindmap.canvasLabel")}
              />
              <div className="memo-mm-toolbar">
                <div className="memo-mm-tools">
                  <button
                    type="button"
                    className="memo-mm-tool"
                    onClick={() => setOpen(false)}
                    aria-label={t("mindmap.exitFullscreen")}
                    title={t("mindmap.exitFullscreen")}
                  >
                    <Msym name="close_fullscreen" size="1.1rem" fill={false} weight={500} />
                  </button>
                </div>
              </div>
              {selected ? (
                <div className="memo-mm-detail" role="status">
                  <div className="memo-mm-detail-head">
                    <span
                      className="memo-mm-detail-dot"
                      style={{ background: mindmapBranchColor(mindmapBranchIndexOf(selected.id)) }}
                    />
                    <p className="memo-mm-detail-label">{selected.label}</p>
                    <button
                      type="button"
                      className="memo-mm-detail-close"
                      aria-label={t("common.close")}
                      onClick={() => setSelectedId(null)}
                    >
                      <Msym name="close" size="1rem" fill={false} weight={500} />
                    </button>
                  </div>
                  {selected.detail ? <p className="memo-mm-detail-copy">{selected.detail}</p> : null}
                  {selected.children.length > 0 ? (
                    <div className="memo-mm-detail-actions">
                      <button
                        type="button"
                        className="memo-mm-detail-action"
                        onClick={() => toggleCollapse(selected.id)}
                      >
                        <Msym
                          name={collapsedIds.has(selected.id) ? "unfold_more" : "unfold_less"}
                          size="0.95rem"
                          fill={false}
                          weight={500}
                        />
                        <span>
                          {t(collapsedIds.has(selected.id) ? "mindmap.unfoldNode" : "mindmap.foldNode", {
                            count: selected.children.length,
                          })}
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
