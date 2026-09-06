"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

import { EmojiIcon } from "@/components/emoji-icon";
import { useT } from "@/components/i18n-provider";
import {
  clampFlashcardDrag,
  DRAG_CLICK_SUPPRESSION_PX,
  DRAG_INTENT_PX,
  flashcardDragDirection,
  flashcardDragProgress,
  flashcardDragRotation,
  flashcardExitStart,
  isFlashcardThrown,
  type FlashcardBucket,
  type FlashcardExitStart,
} from "@/lib/study/flashcard-drag";

/**
 * The flashcard, wherever a flashcard is shown.
 *
 * One component so the deck screen and the memory palace cannot drift apart:
 * the same card, the same flip, the same throw left or right to grade, the same
 * card flying off when it is graded. Everything about *which* card and what
 * grading does belongs to the screen around it; this owns the gesture.
 *
 * Give it a `key` of the card's id: a half-finished drag belongs to the card it
 * started on, and remounting is how it is left behind.
 */

export type StudyFlashcardExit = {
  /** Any confidence bucket: only "again" reads as a miss, the rest as a hit. */
  bucket: "again" | "good" | "easy";
  flipped: boolean;
  /** Changes per grade, so React restarts the animation rather than reusing it. */
  token: number;
  startXPercent: number;
  startYPercent: number;
  startRotationDeg: number;
};

export function StudyFlashcard({
  front,
  back,
  flipped,
  onFlip,
  onGrade,
  flipHint,
  answerLabel = null,
  answerClass = "unanswered",
  answer = null,
  missedCount,
  knownCount,
  navigation = null,
  trailing = null,
  exit = null,
  disabled = false,
}: {
  front: string;
  back: string;
  flipped: boolean;
  onFlip: () => void;
  /** A throw that went far enough; `exitStart` is where the card was let go. */
  onGrade: (bucket: FlashcardBucket, exitStart: FlashcardExitStart) => void;
  flipHint: ReactNode;
  answerLabel?: string | null;
  answerClass?: string;
  /** How this card was last graded, for the pressed state on the buttons. */
  answer?: "again" | "good" | "easy" | null;
  missedCount: number;
  knownCount: number;
  /** The arrows either side of the review buttons, where there is a deck to
      move through. The palace has one card at a time, so it passes none. */
  navigation?: {
    onPrevious: () => void;
    onNext: () => void;
    canPrevious: boolean;
    canNext: boolean;
  } | null;
  /**
   * One control belonging to the deck rather than to the card, sat at the end of the review
   * row. Editing lives here rather than in a header of its own above the card: a row of its
   * own cost sixty pixels of card on every screen, for a button pressed once a term.
   */
  trailing?: ReactNode;
  exit?: StudyFlashcardExit | null;
  disabled?: boolean;
}) {
  const t = useT();
  const sessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const [drag, setDrag] = useState({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
  /*
   * On a screen too narrow for the row, grading goes back to being a throw.
   *
   * The row is four controls wide — two arrows and the two grades — and on a phone it is
   * already the widest thing under the card. Where it no longer fits, the two grades stop
   * being pressable and become the score they were also showing, and the arrows go: the card
   * can still be graded by throwing it, which is how it is mostly graded anyway, and a row
   * that overflows its card is worse than no row.
   *
   * Measured rather than guessed. At 375px the row asks for 306 of the 338 it is given, so
   * the arrows stay on every ordinary phone. It runs out somewhere around 350 — call it 353
   * once a two-digit score has widened both grades — and 359 is the last common width below
   * that, an iPhone SE at 320 being what this is really for.
   */
  const [swipeOnly, setSwipeOnly] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 359px)");
    const sync = () => setSwipeOnly(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener("change", sync);

    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  const resetDrag = useCallback(() => {
    sessionRef.current = null;
    setDrag({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
  }, []);

  useEffect(
    () => () => {
      if (suppressTimerRef.current) {
        window.clearTimeout(suppressTimerRef.current);
      }
    },
    [],
  );

  /*
   * A throw ends in a click the browser fires anyway. Swallowing the next one
   * is what stops a graded card flipping over on its way out.
   */
  const suppressNextClick = (durationMs = 700) => {
    suppressClickRef.current = true;

    if (suppressTimerRef.current) {
      window.clearTimeout(suppressTimerRef.current);
    }

    suppressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, durationMs);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already cancelled the pointer.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const rawDeltaX = event.clientX - session.startX;
    const rawDeltaY = event.clientY - session.startY;

    if (Math.abs(rawDeltaX) <= DRAG_INTENT_PX && Math.abs(rawDeltaY) <= DRAG_INTENT_PX) {
      return;
    }

    if (Math.abs(rawDeltaX) > DRAG_CLICK_SUPPRESSION_PX) {
      suppressNextClick();
    }

    const { deltaX, deltaY } = clampFlashcardDrag(rawDeltaX, rawDeltaY, session.width);

    setDrag({ isDragging: true, deltaX, deltaY, width: session.width });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const rawDeltaX = event.clientX - session.startX;
    const rawDeltaY = event.clientY - session.startY;
    const { deltaX, deltaY } = clampFlashcardDrag(rawDeltaX, rawDeltaY, session.width);
    const thrown = isFlashcardThrown(deltaX, session.width);

    if (
      Math.abs(rawDeltaX) > DRAG_CLICK_SUPPRESSION_PX ||
      Math.abs(rawDeltaY) > DRAG_CLICK_SUPPRESSION_PX
    ) {
      suppressNextClick();
    }

    resetDrag();

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }

    if (thrown) {
      suppressNextClick();
      onGrade(
        deltaX < 0 ? "again" : "easy",
        flashcardExitStart(deltaX, deltaY, session.width),
      );
    }
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;

      if (suppressTimerRef.current) {
        window.clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }

      return;
    }

    onFlip();
  };

  const direction = flashcardDragDirection(drag.deltaX);
  const dragStyle = {
    "--lecture-flashcard-drag-x": `${drag.deltaX}px`,
    "--lecture-flashcard-drag-y": `${drag.deltaY}px`,
    "--lecture-flashcard-drag-rotation": `${flashcardDragRotation(drag.deltaX, drag.width)}deg`,
    "--lecture-flashcard-drag-progress": flashcardDragProgress(drag.deltaX, drag.width),
  } as CSSProperties;

  const face = (side: "front" | "answer", copy: string) => (
    <div className={`lecture-flashcard-face lecture-flashcard-face-${side}`}>
      <div className="lecture-flashcard-face-header">
        {answerLabel ? (
          <span className={`lecture-flashcard-answer-label ${answerClass}`}>{answerLabel}</span>
        ) : null}
      </div>
      <p className="lecture-flashcard-content">{copy}</p>
      <span className="lecture-flashcard-side-label">{flipHint}</span>
    </div>
  );

  const againLabel = t("study.cards.didntKnow");
  const knewLabel = t("study.cards.knew");

  return (
    <>
    <div className="lecture-flashcard-stage">
      <div className="lecture-flashcard-stage-card">
        <button
          type="button"
          className={`lecture-flashcard ${flipped ? "flipped" : ""} ${
            drag.isDragging ? "dragging" : ""
          } ${direction ? `drag-${direction}` : ""}`}
          style={dragStyle}
          onClick={handleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={resetDrag}
        >
          <div className="lecture-flashcard-rotator">
            {face("front", front)}
            {face("answer", back)}
          </div>
          <div className="lecture-flashcard-drag-overlay" aria-hidden="true">
            <EmojiIcon symbol={direction === "again" ? "❌" : "✅"} size="2.25rem" />
          </div>
        </button>

        {exit ? (
          <div
            key={exit.token}
            className={`lecture-flashcard-exit-card ${exit.bucket} ${exit.flipped ? "flipped" : ""}`}
            style={
              {
                "--lecture-flashcard-exit-start-x": `${exit.startXPercent}%`,
                "--lecture-flashcard-exit-start-y": `${exit.startYPercent}%`,
                "--lecture-flashcard-exit-start-rotation": `${exit.startRotationDeg}deg`,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <div className="lecture-flashcard-rotator">
              <div className="lecture-flashcard-face lecture-flashcard-face-front">
                <div className="lecture-flashcard-exit-blank" />
              </div>
              <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                <div className="lecture-flashcard-exit-blank" />
              </div>
            </div>
            <div className="lecture-flashcard-exit-overlay">
              <EmojiIcon symbol={exit.bucket === "again" ? "❌" : "✅"} size="2.25rem" />
            </div>
          </div>
        ) : null}
      </div>
    </div>

    {/* The review row, which is the same row on both screens: a miss and its
        running count on the left, the count and a tick on the right. */}
    <div className="lecture-flashcard-toolbar">
      <div className={`lecture-flashcard-review ${swipeOnly ? "swipe-only" : ""}`.trim()}>
        {navigation && !swipeOnly ? (
          <button
            type="button"
            onClick={navigation.onPrevious}
            disabled={!navigation.canPrevious}
            className="lecture-flashcard-nav-button previous"
            aria-label={t("study.cards.previous")}
            title={t("study.cards.previous")}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
        ) : null}
        {swipeOnly ? (
          /*
           * A score, not a control. Rendered as text rather than as a disabled button so
           * that it is read as the running count it is — a button nothing can press is a
           * worse thing to meet with a screen reader than no button at all.
           */
          <span className="lecture-flashcard-review-score again">
            <X aria-hidden="true" />
            <span>{missedCount}</span>
            <span className="memo-visually-hidden">{againLabel}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onGrade("again", { xPercent: 0, yPercent: 0, rotationDeg: 0 })}
            className={`lecture-flashcard-review-button again ${answer === "again" ? "selected" : ""}`}
            aria-label={againLabel}
            title={againLabel}
          >
            <X aria-hidden="true" />
            <span>{missedCount}</span>
          </button>
        )}
        {swipeOnly ? (
          <span className="lecture-flashcard-review-score easy">
            <span>{knownCount}</span>
            <Check aria-hidden="true" />
            <span className="memo-visually-hidden">{knewLabel}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onGrade("easy", { xPercent: 0, yPercent: 0, rotationDeg: 0 })}
            className={`lecture-flashcard-review-button easy ${
              answer && answer !== "again" ? "selected" : ""
            }`}
            aria-label={knewLabel}
            title={knewLabel}
          >
            <span>{knownCount}</span>
            <Check aria-hidden="true" />
          </button>
        )}
        {navigation && !swipeOnly ? (
          <button
            type="button"
            onClick={navigation.onNext}
            disabled={!navigation.canNext}
            className="lecture-flashcard-nav-button next"
            aria-label={t("study.cards.next")}
            title={t("study.cards.next")}
          >
            <ArrowRight aria-hidden="true" />
          </button>
        ) : null}
        {trailing}
      </div>
    </div>
    </>
  );
}
