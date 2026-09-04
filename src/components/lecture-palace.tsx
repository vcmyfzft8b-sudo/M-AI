"use client";

import { Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { StudyFlashcard, type StudyFlashcardExit } from "@/components/study-flashcard";
import {
  FLASHCARD_EXIT_ANIMATION_MS,
  type FlashcardBucket,
} from "@/lib/study/flashcard-drag";
import { QUIZ_CORRECT_PAUSE_MS, quizOptionLetter, shuffleIndices } from "@/lib/study/quiz";
import type { PalaceGame, PalaceSnapshot } from "@/lib/palace/game";
import {
  buildPalaceLayout,
  mapArrowAngle,
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
/** Memo's mascot, the same file the town hangs outside its houses. */
const MASCOT_SRC = "/memo-mascot.png";
/** How far the minimap sees, in metres — about two blocks in every direction. */
const MAP_RANGE = 95;
/** The stick is dead in the middle, so a resting thumb is not a slow walk. */
const STICK_DEADZONE = 6;
const STICK_RADIUS = 46;

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
  const exitTimerRef = useRef<number | null>(null);
  const exitTokenRef = useRef(0);

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  const [nearStationId, setNearStationId] = useState<string | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  /* Shuffled once when the station opens, exactly as the quiz screen does it. */
  const [quizOrder, setQuizOrder] = useState<number[]>([]);
  const [testAnswer, setTestAnswer] = useState("");
  const [isTestUnknown, setIsTestUnknown] = useState(false);
  const [isAnswerShown, setIsAnswerShown] = useState(false);
  const [cardExit, setCardExit] = useState<StudyFlashcardExit | null>(null);
  const [districtIndex, setDistrictIndex] = useState(0);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [stickKnob, setStickKnob] = useState<{ x: number; y: number } | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  /*
   * Bumped when the GPU drops the drawing context: the canvas element itself
   * has to be replaced, because a lost context cannot be reopened on it.
   */
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  /* The mascot, loaded once so the map can draw the real thing on every stop. */
  const mascotRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new Image();

    image.src = MASCOT_SRC;
    image.decoding = "async";
    mascotRef.current = image;
  }, []);

  const items = useMemo(
    () =>
      selectPalaceItems({
        cards: cards.map((card) => ({
          id: card.id,
          sectionId: card.section_id,
          /* Higher is more important; the walk takes the important ones first. */
          weight: card.coverage_rank,
        })),
        quiz: quizQuestions,
        test: practiceQuestions.map((question) => ({
          id: question.id,
          weight: question.importance ?? 0,
        })),
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

  /*
   * The options are shuffled when the station opens, the way the quiz screen
   * shuffles them when a round starts: the same question should not always have
   * its answer at B.
   */
  useEffect(() => {
    if (!station || station.kind !== "quiz") return;

    const question = quizById.get(station.id);

    setQuizOrder(question ? shuffleIndices(question.options.length) : []);
  }, [quizById, station]);

  /**
   * The map, which is how you find the next one.
   *
   * Centred on the player and zoomed to the few streets around them, because a
   * whole town squeezed into a circle this size is a smudge. Memo's own face
   * marks every house that still has something waiting — the same mascot that
   * is standing on the path outside it — so "where next" is answered by
   * looking. Stops beyond the edge of the map are pinned to the rim in the
   * direction they lie, so the map always has a next move in it, and the ones
   * already done fade to a tick.
   */
  const drawMinimap = useCallback(
    (snapshot: PalaceSnapshot, collectedIds: Set<string>) => {
      const canvas = minimapRef.current;

      if (!canvas || !layout) return;

      const context = canvas.getContext("2d");

      if (!context) return;

      const size = canvas.width;
      const radius = size / 2;
      const scale = radius / MAP_RANGE;
      const toCanvas = (x: number, z: number) => ({
        x: radius + (x - snapshot.x) * scale,
        y: radius + (z - snapshot.z) * scale,
      });

      context.clearRect(0, 0, size, size);
      context.save();
      context.beginPath();
      context.arc(radius, radius, radius, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = "rgba(14, 12, 20, 0.82)";
      context.fillRect(0, 0, size, size);

      /* The streets, at their real width: the grid is what you navigate by. */
      context.strokeStyle = "rgba(255, 255, 255, 0.2)";
      context.lineWidth = Math.max(2, 11 * scale);
      layout.roads.forEach((road) => {
        const horizontal = road.width > road.depth;
        const line = toCanvas(road.x, road.z);

        if (horizontal ? line.y < -20 || line.y > size + 20 : line.x < -20 || line.x > size + 20) {
          return;
        }

        context.beginPath();

        if (horizontal) {
          context.moveTo(0, line.y);
          context.lineTo(size, line.y);
        } else {
          context.moveTo(line.x, 0);
          context.lineTo(line.x, size);
        }

        context.stroke();
      });

      const mascot = mascotRef.current;
      const icon = 20;
      let nearest: { distance: number; point: { x: number; y: number } } | null = null;

      layout.stations.forEach((entry) => {
        const distance = Math.hypot(entry.x - snapshot.x, entry.z - snapshot.z);
        const done = collectedIds.has(entry.id);
        const point = toCanvas(entry.x, entry.z);

        if (!done && (!nearest || distance < nearest.distance)) {
          nearest = { distance, point };
        }

        if (distance > MAP_RANGE) {
          if (done) return;

          /* Off the edge: pinned to the rim, pointing the way to walk. */
          const angle = Math.atan2(entry.z - snapshot.z, entry.x - snapshot.x);
          const pinned = {
            x: radius + Math.cos(angle) * (radius - 9),
            y: radius + Math.sin(angle) * (radius - 9),
          };

          context.save();
          context.translate(pinned.x, pinned.y);
          context.rotate(angle);
          context.fillStyle = `hsl(${entry.hue} 85% 65%)`;
          context.beginPath();
          context.moveTo(6, 0);
          context.lineTo(-4, 4.5);
          context.lineTo(-4, -4.5);
          context.closePath();
          context.fill();
          context.restore();

          return;
        }

        if (done) {
          context.strokeStyle = `hsl(${entry.hue} 55% 72% / 0.7)`;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(point.x - 3.4, point.y);
          context.lineTo(point.x - 0.6, point.y + 3);
          context.lineTo(point.x + 3.6, point.y - 3.2);
          context.stroke();

          return;
        }

        /* A disc in the neighbourhood's colour behind the face, so a pale
           mascot still reads against a dark map at this size. */
        context.fillStyle = `hsl(${entry.hue} 80% 62%)`;
        context.beginPath();
        context.arc(point.x, point.y, icon / 2, 0, Math.PI * 2);
        context.fill();

        if (mascot?.complete && mascot.naturalWidth > 0) {
          context.drawImage(mascot, point.x - icon / 2, point.y - icon / 2, icon, icon);
        }
      });

      if (nearest) {
        const target = nearest as { distance: number; point: { x: number; y: number } };

        if (target.distance <= MAP_RANGE) {
          context.strokeStyle = "rgba(255, 255, 255, 0.8)";
          context.lineWidth = 1.8;
          context.beginPath();
          context.arc(target.point.x, target.point.y, icon / 2 + 4, 0, Math.PI * 2);
          context.stroke();
        }
      }

      /* The player sits at the middle of their own map, facing up the screen. */
      context.save();
      context.translate(radius, radius);
      context.rotate(mapArrowAngle(snapshot.facing));
      context.fillStyle = "#ffffff";
      context.strokeStyle = "rgba(14, 12, 20, 0.9)";
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(0, -8);
      context.lineTo(6, 6.4);
      context.lineTo(0, 3);
      context.lineTo(-6, 6.4);
      context.closePath();
      context.fill();
      context.stroke();
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
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
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
    async (
      cardId: string,
      confidenceBucket: FlashcardBucket,
      exitStart?: { xPercent: number; yPercent: number; rotationDeg: number },
    ) => {
      if (confidenceBucket === "easy") {
        collect(cardId);
      }

      /*
       * The card flies off the way it does on the deck screen — same animation,
       * same length — and the walk resumes as it goes rather than after it.
       */
      exitTokenRef.current += 1;

      const token = exitTokenRef.current;

      setCardExit({
        bucket: confidenceBucket,
        flipped: isFlipped,
        token,
        startXPercent: exitStart?.xPercent ?? 0,
        startYPercent: exitStart?.yPercent ?? 0,
        startRotationDeg: exitStart?.rotationDeg ?? 0,
      });

      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
      }

      exitTimerRef.current = window.setTimeout(() => {
        setCardExit((current) => (current?.token === token ? null : current));
        exitTimerRef.current = null;
      }, FLASHCARD_EXIT_ANIMATION_MS);

      leaveStation();

      /*
       * The same record the deck screen writes, with the same buckets. Fire and
       * forget on purpose: a dropped request must not stop the walk, and the
       * next grade carries the card again.
       */
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
    [collect, isFlipped, leaveStation],
  );

  const answerQuiz = useCallback(
    (questionId: string, optionIndex: number, correctIndex: number) => {
      setQuizChoice(optionIndex);

      if (optionIndex !== correctIndex) return;

      /* Right: let the green land for the same beat the quiz screen gives it. */
      collect(questionId);
      releaseTimerRef.current = window.setTimeout(leaveStation, QUIZ_CORRECT_PAUSE_MS);
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
          <StudyFlashcard
            key={card.id}
            front={card.front}
            back={card.back}
            flipped={isFlipped}
            onFlip={() => setIsFlipped((current) => !current)}
            onGrade={(bucket, exitStart) => void gradeCard(card.id, bucket, exitStart)}
            flipHint={flipHint}
            exit={cardExit}
          />

          <div className="lecture-flashcard-toolbar">
            <div className="lecture-flashcard-review">
              <button
                type="button"
                className="lecture-flashcard-review-button again"
                aria-label={t("palace.notYet")}
                onClick={() => void gradeCard(card.id, "again")}
              >
                <X aria-hidden="true" />
                <span>{t("palace.notYet")}</span>
              </button>
              <button
                type="button"
                className="lecture-flashcard-review-button easy"
                aria-label={t("palace.gotIt")}
                onClick={() => void gradeCard(card.id, "easy")}
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
      const order =
        quizOrder.length === question.options.length
          ? quizOrder
          : question.options.map((_, index) => index);

      return (
        <div className="lecture-quiz-card">
          <span className="memo-quiz-eyebrow">{t("quiz.chooseOne")}</span>
          <p className="lecture-quiz-prompt">{question.prompt}</p>

          <div className="lecture-quiz-options">
            {order.map((optionIndex, displayIndex) => {
              const option = question.options[optionIndex] ?? "";
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
                    {String.fromCharCode(65 + displayIndex)}
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
                    letter: quizOptionLetter(order, question.correct_option_idx),
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
          disabled={isTestUnknown}
          className="ios-textarea lecture-practice-textarea"
          placeholder={t("test.answerPlaceholder")}
        />

        <div className="lecture-practice-controls">
          <label className="lecture-practice-unknown">
            <input
              type="checkbox"
              checked={isTestUnknown}
              onChange={(event) => setIsTestUnknown(event.target.checked)}
            />
            {t("test.dontKnow")}
          </label>
        </div>

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
              <canvas ref={minimapRef} width={220} height={220} />
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
