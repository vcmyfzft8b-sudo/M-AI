"use client";

import { Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import type { PalaceGame, PalaceSnapshot } from "@/lib/palace/game";
import {
  buildPalaceLayout,
  mapArrowAngle,
  mapExtent,
  selectPalaceItems,
  type StudyKind,
} from "@/lib/palace/layout";
import type {
  FlashcardWithCitations,
  PracticeTestQuestion,
  QuizQuestionWithOptions,
  StudySectionWithProgress,
} from "@/lib/types";

/**
 * The memory palace.
 *
 * The oldest study technique there is, which is why it is worth building: a walk
 * through a place is held far better than a list. So the note's own study
 * material is scattered through a town — one neighbourhood per section of the
 * note, one house per item, every house built differently — and you walk it.
 *
 * What waits outside a house is the app's own study screen, not a copy of it:
 * the flashcard that flips, the quiz that marks you, the practice question with
 * its model answer. The town is the index; the screens are the ones the rest of
 * the app already uses.
 *
 * A recall here is a recall everywhere: grading a flashcard posts to the same
 * progress the deck screen writes.
 *
 * The engine is loaded only when the door is opened — three.js is far too much
 * to hand every reader of a note.
 */

const COLLECTED_STORAGE_PREFIX = "memo.palace.collected.";
/** The stick is dead in the middle, so a resting thumb is not a slow walk. */
const STICK_DEADZONE = 6;
const STICK_RADIUS = 46;
/** How long a correct quiz answer stays on screen before the walk resumes. */
const CORRECT_ANSWER_PAUSE = 900;

function readCollected(lectureId: string) {
  try {
    const raw = window.localStorage.getItem(`${COLLECTED_STORAGE_PREFIX}${lectureId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    /* A private window with storage switched off still gets to play. */
    return new Set<string>();
  }
}

function writeCollected(lectureId: string, collected: Set<string>) {
  try {
    window.localStorage.setItem(
      `${COLLECTED_STORAGE_PREFIX}${lectureId}`,
      JSON.stringify([...collected]),
    );
  } catch {
    /* Nothing to do about it, and nothing worth interrupting the game for. */
  }
}

export function LecturePalace({
  lectureId,
  cards,
  quizQuestions,
  practiceQuestions,
  sections,
  isReady,
}: {
  lectureId: string;
  cards: FlashcardWithCitations[];
  quizQuestions: QuizQuestionWithOptions[];
  practiceQuestions: PracticeTestQuestion[];
  sections: StudySectionWithProgress[];
  isReady: boolean;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<PalaceGame | null>(null);
  const snapshotRef = useRef<PalaceSnapshot | null>(null);
  const stickRef = useRef<{ pointerId: number; originX: number; originY: number } | null>(null);
  const lookRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const releaseTimerRef = useRef<number | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  const [nearStationId, setNearStationId] = useState<string | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [testAnswer, setTestAnswer] = useState("");
  const [isAnswerShown, setIsAnswerShown] = useState(false);
  const [districtIndex, setDistrictIndex] = useState(0);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [stickKnob, setStickKnob] = useState<{ x: number; y: number } | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  /*
   * Bumped when the GPU drops the drawing context: the canvas element itself
   * has to be replaced, because a lost context cannot be reopened on it.
   */
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  const items = useMemo(
    () =>
      selectPalaceItems({
        cards: cards.map((card) => ({ id: card.id, sectionId: card.section_id })),
        quiz: quizQuestions,
        test: practiceQuestions,
      }),
    [cards, practiceQuestions, quizQuestions],
  );

  const layout = useMemo(
    () =>
      items.length === 0
        ? null
        : buildPalaceLayout({
            seedSource: lectureId,
            items,
            sections: sections.map((section) => ({ id: section.id, title: section.title })),
            fallbackTitle: t("palace.district.default"),
          }),
    [items, lectureId, sections, t],
  );

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const quizById = useMemo(
    () => new Map(quizQuestions.map((question) => [question.id, question])),
    [quizQuestions],
  );
  const testById = useMemo(
    () => new Map(practiceQuestions.map((question) => [question.id, question])),
    [practiceQuestions],
  );

  /* Where the walk got to last time, restored on the client only. */
  useEffect(() => {
    setCollected(readCollected(lectureId));
  }, [lectureId]);

  useEffect(() => {
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const station = useMemo(
    () => layout?.stations.find((entry) => entry.id === nearStationId) ?? null,
    [layout, nearStationId],
  );

  const drawMinimap = useCallback(
    (snapshot: PalaceSnapshot, collectedIds: Set<string>) => {
      const canvas = minimapRef.current;

      if (!canvas || !layout) return;

      const context = canvas.getContext("2d");

      if (!context) return;

      const size = canvas.width;
      const scale = size / (mapExtent(layout) * 2);
      const toCanvas = (x: number, z: number) => ({
        x: size / 2 + x * scale,
        y: size / 2 + z * scale,
      });

      context.clearRect(0, 0, size, size);
      context.fillStyle = "rgba(18, 16, 26, 0.72)";
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      context.fill();
      context.save();
      context.clip();

      layout.districts.forEach((district) => {
        const center = toCanvas(district.center.x, district.center.z);

        context.fillStyle = `hsl(${district.hue} 55% 60% / 0.2)`;
        context.beginPath();
        context.arc(center.x, center.y, district.radius * scale, 0, Math.PI * 2);
        context.fill();
      });

      /* The streets, so the map reads as a town rather than a constellation. */
      context.strokeStyle = "rgba(255, 255, 255, 0.16)";
      context.lineWidth = 1.4;
      layout.roads.forEach((road) => {
        const from = toCanvas(road.x - road.width / 2, road.z - road.depth / 2);
        const to = toCanvas(road.x + road.width / 2, road.z + road.depth / 2);

        context.beginPath();
        context.moveTo((from.x + to.x) / 2, from.y);
        context.lineTo((from.x + to.x) / 2, to.y);
        context.moveTo(from.x, (from.y + to.y) / 2);
        context.lineTo(to.x, (from.y + to.y) / 2);
        context.stroke();
      });

      layout.stations.forEach((entry) => {
        const point = toCanvas(entry.x, entry.z);
        const isCollected = collectedIds.has(entry.id);

        context.fillStyle = isCollected
          ? "rgba(255, 255, 255, 0.28)"
          : `hsl(${entry.hue} 85% 62%)`;
        context.beginPath();
        context.arc(point.x, point.y, isCollected ? 2 : 3.1, 0, Math.PI * 2);
        context.fill();
      });

      /* The player is an arrow, because a dot cannot tell you which way you face. */
      const player = toCanvas(snapshot.x, snapshot.z);

      context.save();
      context.translate(player.x, player.y);
      context.rotate(mapArrowAngle(snapshot.facing));
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.moveTo(0, -6);
      context.lineTo(4.6, 5);
      context.lineTo(0, 2.4);
      context.lineTo(-4.6, 5);
      context.closePath();
      context.fill();
      context.restore();
      context.restore();
    },
    [layout],
  );

  /* The frame callback must not re-render: it fires sixty times a second. */
  const collectedRef = useRef(collected);

  useEffect(() => {
    collectedRef.current = collected;
  }, [collected]);

  const openStation = useCallback((stationId: string | null) => {
    setNearStationId(stationId);
    setIsFlipped(false);
    setQuizChoice(null);
    setTestAnswer("");
    setIsAnswerShown(false);
  }, []);

  const startGame = useCallback(async () => {
    if (!layout || gameRef.current) return;

    setIsLoading(true);
    setLoadError(null);

    try {
      const { createPalaceGame } = await import("@/lib/palace/game");
      const canvas = canvasRef.current;

      if (!canvas) return;

      let minimapFrame = 0;

      gameRef.current = createPalaceGame({
        canvas,
        layout,
        collectedIds: [...collectedRef.current],
        onNearStation: openStation,
        onContextLost: () => {
          gameRef.current = null;
          setCanvasEpoch((current) => current + 1);
        },
        onFrame: (snapshot) => {
          snapshotRef.current = snapshot;
          minimapFrame += 1;

          /* Twenty map redraws a second is plenty, and leaves the GPU alone. */
          if (minimapFrame % 3 === 0) {
            drawMinimap(snapshot, collectedRef.current);
          }

          setDistrictIndex((current) =>
            current === snapshot.districtIndex ? current : snapshot.districtIndex,
          );
        },
      });
    } catch (error) {
      /* A device without WebGL, or a chunk that never arrived. */
      setLoadError(error instanceof Error ? error.message : t("palace.unsupported"));
    } finally {
      setIsLoading(false);
    }
  }, [drawMinimap, layout, openStation, t]);

  useEffect(() => {
    if (!isOpen) return;

    /* A restarted engine puts you back at the spawn, with nothing under your nose. */
    openStation(null);
    void startGame();

    return () => {
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [canvasEpoch, isOpen, openStation, startGame]);

  useEffect(
    () => () => {
      if (releaseTimerRef.current) window.clearTimeout(releaseTimerRef.current);
    },
    [],
  );

  /* The page behind must not scroll under the town while it is open. */
  useEffect(() => {
    if (!isOpen) return;

    const previous = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onResize = () => gameRef.current?.resize();
    /* A backgrounded tab should not keep a render loop alive on a phone battery. */
    const onVisibility = () => gameRef.current?.setPaused(document.hidden);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  /* The map sheet stops the world; the loop keeps rendering. */
  useEffect(() => {
    gameRef.current?.setPaused(isMapOpen);

    if (isMapOpen) {
      gameRef.current?.setMove(0, 0);
    }
  }, [isMapOpen]);

  const leaveStation = useCallback(() => {
    gameRef.current?.releaseStation();
    openStation(null);
  }, [openStation]);

  const collect = useCallback(
    (stationId: string) => {
      setCollected((current) => {
        const next = new Set(current);

        next.add(stationId);
        writeCollected(lectureId, next);

        return next;
      });
      gameRef.current?.markCollected(stationId);
    },
    [lectureId],
  );

  /**
   * A flashcard graded in the town is a flashcard graded in the app: the same
   * record the deck screen writes. Fire and forget on purpose — a dropped
   * request must not stop the walk, and the next grade carries the card again.
   */
  const gradeCard = useCallback(
    async (cardId: string, confidenceBucket: "again" | "good") => {
      if (confidenceBucket === "good") {
        collect(cardId);
      }

      leaveStation();

      try {
        await fetch(`/api/flashcards/${cardId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confidenceBucket }),
        });
      } catch {
        /* Offline in a lecture hall is the normal case, not an error to raise. */
      }
    },
    [collect, leaveStation],
  );

  const answerQuiz = useCallback(
    (questionId: string, optionIndex: number, correctIndex: number) => {
      setQuizChoice(optionIndex);

      if (optionIndex !== correctIndex) return;

      /* Right: let the green land before the walk starts again. */
      collect(questionId);
      releaseTimerRef.current = window.setTimeout(leaveStation, CORRECT_ANSWER_PAUSE);
    },
    [collect, leaveStation],
  );

  const restart = useCallback(() => {
    setCollected(new Set());
    writeCollected(lectureId, new Set());
    setIsOpen(false);
  }, [lectureId]);

  const onStickPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (stickRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    stickRef.current = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY };
    setStickKnob({ x: event.clientX, y: event.clientY });
  };

  const onStickPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const stick = stickRef.current;

    if (!stick || stick.pointerId !== event.pointerId) return;

    const dx = event.clientX - stick.originX;
    const dy = event.clientY - stick.originY;
    const distance = Math.hypot(dx, dy);

    if (distance < STICK_DEADZONE) {
      gameRef.current?.setMove(0, 0);

      return;
    }

    const clamped = Math.min(1, distance / STICK_RADIUS);
    const nx = (dx / distance) * clamped;
    const ny = (dy / distance) * clamped;

    /* Up on the stick is forward, so the vertical axis is inverted. */
    gameRef.current?.setMove(-ny, nx);
    setStickKnob({ x: stick.originX + nx * STICK_RADIUS, y: stick.originY + ny * STICK_RADIUS });
  };

  const endStick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (stickRef.current?.pointerId !== event.pointerId) return;

    stickRef.current = null;
    gameRef.current?.setMove(0, 0);
    setStickKnob(null);
  };

  const onLookPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lookRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    lookRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onLookPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const look = lookRef.current;

    if (!look || look.pointerId !== event.pointerId) return;

    gameRef.current?.look(event.clientX - look.x, event.clientY - look.y);
    look.x = event.clientX;
    look.y = event.clientY;
  };

  const endLook = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lookRef.current?.pointerId !== event.pointerId) return;

    lookRef.current = null;
  };

  if (!isReady || !layout) {
    return (
      <div className="memo-palace-intro">
        <div className="memo-palace-cover placeholder" aria-hidden="true" />
        <h2 className="memo-palace-heading">{t("palace.title")}</h2>
        <p className="memo-palace-copy">{isReady ? t("palace.empty") : t("palace.notReady")}</p>
      </div>
    );
  }

  const total = layout.stations.length;
  const done = layout.stations.filter((entry) => collected.has(entry.id)).length;
  const district = layout.districts[districtIndex] ?? layout.districts[0];
  const kindLabel: Record<StudyKind, string> = {
    card: t("note.tab.flashcards"),
    quiz: t("note.tab.quiz"),
    test: t("note.subScreen.test"),
  };
  /*
   * "Click to flip" on a mouse, "Tap to flip" on a phone — both rendered, the
   * stylesheet picks, exactly as the deck screen does it.
   */
  const flipHint = (
    <>
      <span className="memo-only-desktop">{t("study.cards.flipDesktop")}</span>
      <span className="memo-only-mobile">{t("study.cards.flipMobile")}</span>
    </>
  );

  function renderStation() {
    if (!station) return null;

    if (station.kind === "card") {
      const card = cardsById.get(station.id);

      if (!card) return null;

      return (
        <>
          <div className="lecture-flashcard-stage">
            <div className="lecture-flashcard-stage-card">
              <button
                type="button"
                className={`lecture-flashcard ${isFlipped ? "flipped" : ""}`}
                onClick={() => setIsFlipped((current) => !current)}
              >
                <div className="lecture-flashcard-rotator">
                  <div className="lecture-flashcard-face lecture-flashcard-face-front">
                    <div className="lecture-flashcard-face-header" />
                    <p className="lecture-flashcard-content">{card.front}</p>
                    <span className="lecture-flashcard-side-label">{flipHint}</span>
                  </div>
                  <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                    <div className="lecture-flashcard-face-header" />
                    <p className="lecture-flashcard-content">{card.back}</p>
                    <span className="lecture-flashcard-side-label">{flipHint}</span>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="lecture-flashcard-toolbar">
            <div className="lecture-flashcard-review">
              <button
                type="button"
                className="lecture-flashcard-review-button again"
                onClick={() => void gradeCard(card.id, "again")}
              >
                <X aria-hidden="true" />
                <span>{t("palace.notYet")}</span>
              </button>
              <button
                type="button"
                className="lecture-flashcard-review-button easy"
                onClick={() => void gradeCard(card.id, "good")}
              >
                <span>{t("palace.gotIt")}</span>
                <Check aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      );
    }

    if (station.kind === "quiz") {
      const question = quizById.get(station.id);

      if (!question) return null;

      const wrong = quizChoice !== null && quizChoice !== question.correct_option_idx;

      return (
        <div className="lecture-quiz-card">
          <span className="memo-quiz-eyebrow">{t("quiz.chooseOne")}</span>
          <p className="lecture-quiz-prompt">{question.prompt}</p>

          <div className="lecture-quiz-options">
            {question.options.map((option, optionIndex) => {
              const isSelected = quizChoice === optionIndex;
              const isCorrect = quizChoice !== null && optionIndex === question.correct_option_idx;
              const isIncorrect = quizChoice !== null && isSelected && !isCorrect;

              return (
                <button
                  key={`${question.id}-${optionIndex}`}
                  type="button"
                  disabled={quizChoice !== null}
                  onClick={() => answerQuiz(question.id, optionIndex, question.correct_option_idx)}
                  className={`lecture-quiz-option ${isSelected ? "selected" : ""} ${
                    isCorrect ? "correct" : ""
                  } ${isIncorrect ? "incorrect" : ""}`}
                >
                  <span className="lecture-quiz-option-label">
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span className="lecture-quiz-option-copy">{option}</span>
                  {isCorrect || isIncorrect ? (
                    <span className="lecture-quiz-option-mark">
                      <Msym name={isCorrect ? "check" : "close"} size="1.2rem" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {wrong ? (
            <div className="memo-quiz-result">
              <span className="memo-quiz-result-badge">
                <Msym name="cancel" size="1.25rem" />
              </span>
              <span className="memo-quiz-result-copy">
                <span className="memo-quiz-result-title">{t("quiz.wrongTitle")}</span>
                <span>
                  {t("quiz.correctAnswerIs", {
                    letter: String.fromCharCode(65 + question.correct_option_idx),
                  })}
                </span>
              </span>
              <div className="memo-quiz-result-actions">
                <button type="button" className="memo-quiz-result-primary" onClick={leaveStation}>
                  {t("quiz.understood")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    const question = testById.get(station.id);

    if (!question) return null;

    return (
      <div className="lecture-practice-stage">
        <p className="lecture-practice-prompt">{question.prompt}</p>
        <textarea
          value={testAnswer}
          onChange={(event) => setTestAnswer(event.target.value)}
          className="ios-textarea lecture-practice-textarea"
          placeholder={t("test.answerPlaceholder")}
        />

        {isAnswerShown ? (
          <div className="memo-palace-model">
            <span className="memo-palace-model-label">{t("test.expectedAnswer")}</span>
            <p>{question.answer_guide}</p>
          </div>
        ) : null}

        <div className="memo-test-actions">
          {isAnswerShown ? (
            <>
              <button type="button" className="memo-test-prev" onClick={leaveStation}>
                {t("palace.notYet")}
              </button>
              <button
                type="button"
                className="memo-test-next"
                onClick={() => {
                  collect(question.id);
                  leaveStation();
                }}
              >
                {t("palace.gotIt")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="memo-test-next"
              onClick={() => setIsAnswerShown(true)}
            >
              {t("palace.checkAnswer")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="memo-palace-intro">
        <div className="memo-palace-cover" aria-hidden="true">
          <span className="memo-palace-cover-sky" />
          <span className="memo-palace-cover-tower tall" />
          <span className="memo-palace-cover-tower" />
          <span className="memo-palace-cover-tower short" />
          <span className="memo-palace-cover-token" />
        </div>
        <h2 className="memo-palace-heading">{t("palace.title")}</h2>
        <p className="memo-palace-copy">{t("palace.intro")}</p>

        <div className="memo-palace-progress" role="group" aria-label={t("palace.progressLabel")}>
          <div className="memo-palace-bar">
            <span style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
          </div>
          <p className="memo-palace-count">{t("palace.progressCount", { done, total })}</p>
        </div>

        <div className="memo-palace-actions">
          <button type="button" className="memo-palace-cta" onClick={() => setIsOpen(true)}>
            <Msym name="explore" size="1.15rem" />
            {done > 0 ? t("palace.resume") : t("palace.start")}
          </button>
          {done > 0 ? (
            <button type="button" className="memo-button-outline small" onClick={restart}>
              {t("palace.restart")}
            </button>
          ) : null}
        </div>

        <ul className="memo-palace-districts">
          {layout.districts.map((entry) => {
            const entryDone = entry.stationIds.filter((id) => collected.has(id)).length;

            return (
              <li key={entry.index}>
                <span
                  className="memo-palace-dot"
                  style={{ background: `hsl(${entry.hue} 70% 58%)` }}
                />
                <span className="memo-palace-district-title">{entry.title}</span>
                <span className="memo-palace-district-count">
                  {entryDone}/{entry.stationIds.length}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {isOpen ? (
        <MemoPortal>
          <div
            className="memo-palace-stage"
            role="dialog"
            aria-modal="true"
            aria-label={t("palace.title")}
          >
            <canvas key={canvasEpoch} ref={canvasRef} className="memo-palace-canvas" />

            <div
              className="memo-palace-look"
              onPointerDown={onLookPointerDown}
              onPointerMove={onLookPointerMove}
              onPointerUp={endLook}
              onPointerCancel={endLook}
            />

            {isTouch ? (
              <div
                className="memo-palace-stick"
                onPointerDown={onStickPointerDown}
                onPointerMove={onStickPointerMove}
                onPointerUp={endStick}
                onPointerCancel={endStick}
              >
                {stickKnob ? (
                  <span
                    className="memo-palace-knob"
                    style={{ left: `${stickKnob.x}px`, top: `${stickKnob.y}px` }}
                  />
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              className="memo-palace-map"
              onClick={() => setIsMapOpen(true)}
              aria-label={t("palace.map")}
            >
              <canvas ref={minimapRef} width={170} height={170} />
            </button>

            <div className="memo-palace-hud-top">
              <span className="memo-palace-score">
                <span className="memo-palace-score-token" aria-hidden="true" />
                {done} <span className="memo-palace-score-slash">/</span> {total}
              </span>
              <span className="memo-palace-district-pill">{district?.title}</span>
            </div>

            <button type="button" className="memo-palace-exit" onClick={() => setIsOpen(false)}>
              <Msym name="arrow_back" size="1.1rem" />
              {t("palace.exit")}
            </button>

            {isTouch ? (
              <button
                type="button"
                className="memo-palace-jump"
                onPointerDown={() => gameRef.current?.jump()}
                aria-label={t("palace.jump")}
              >
                <Msym name="keyboard_double_arrow_up" size="1.5rem" />
              </button>
            ) : (
              <p className="memo-palace-hint">{t("palace.hintDesktop")}</p>
            )}

            {isLoading ? (
              <div className="memo-palace-loading">
                <p>{t("palace.loading")}</p>
                <span className="memo-palace-loading-bar" />
              </div>
            ) : null}

            {loadError ? (
              <div className="memo-palace-loading">
                <p>{t("palace.unsupported")}</p>
                <button
                  type="button"
                  className="memo-button-outline small"
                  onClick={() => setIsOpen(false)}
                >
                  {t("palace.exit")}
                </button>
              </div>
            ) : null}

            {station ? (
              <div className={`memo-palace-panel ${station.kind}`}>
                <div className="memo-palace-panel-head">
                  <span className="memo-palace-panel-kind">{kindLabel[station.kind]}</span>
                  <span className="memo-palace-panel-where">{district?.title}</span>
                  <button
                    type="button"
                    className="memo-palace-panel-close"
                    aria-label={t("common.close")}
                    onClick={leaveStation}
                  >
                    <Msym name="close" size="1.1rem" />
                  </button>
                </div>
                {renderStation()}
              </div>
            ) : null}

            {isMapOpen ? (
              <div className="memo-palace-sheet">
                <div className="memo-palace-sheet-inner">
                  <h3>{t("palace.districts")}</h3>
                  <ul>
                    {layout.districts.map((entry) => {
                      const entryDone = entry.stationIds.filter((id) => collected.has(id)).length;

                      return (
                        <li key={entry.index}>
                          <span
                            className="memo-palace-dot"
                            style={{ background: `hsl(${entry.hue} 70% 58%)` }}
                          />
                          <span className="memo-palace-district-title">{entry.title}</span>
                          <span className="memo-palace-district-count">
                            {entryDone}/{entry.stationIds.length}
                          </span>
                          <button
                            type="button"
                            className="memo-button-outline small"
                            onClick={() => {
                              gameRef.current?.travelTo(entry.index);
                              setIsMapOpen(false);
                            }}
                          >
                            {t("palace.travel")}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    className="memo-palace-cta small"
                    onClick={() => setIsMapOpen(false)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            ) : null}

            {done === total ? (
              <div className="memo-palace-done">
                <p className="memo-palace-done-title">{t("palace.done.title")}</p>
                <p className="memo-palace-done-copy">{t("palace.done.copy")}</p>
                <div className="memo-palace-card-actions">
                  <button type="button" className="memo-button-outline small" onClick={restart}>
                    {t("palace.restart")}
                  </button>
                  <button
                    type="button"
                    className="memo-palace-cta small"
                    onClick={() => setIsOpen(false)}
                  >
                    {t("palace.exit")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
