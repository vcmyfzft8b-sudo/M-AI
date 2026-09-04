/**
 * The flashcard's drag, as maths.
 *
 * A card is graded by throwing it: left for "didn't know", right for "knew".
 * The numbers that decide how far is far enough, how much the card leans as it
 * goes, and where the exit animation picks it up from, live here so that both
 * screens that show a flashcard — the deck and the memory palace — use the same
 * ones, and so the feel of it can be checked without a pointer.
 */

export const FLASHCARD_EXIT_ANIMATION_MS = 193;
const DRAG_TRIGGER_RATIO = 0.28;
const DRAG_TRIGGER_MIN_PX = 88;
const DRAG_TRIGGER_MAX_PX = 150;
const DRAG_MAX_ROTATION_DEG = 8;
/** How far the card can be pulled before it stops following the finger. */
const DRAG_LIMIT_RATIO = 0.56;
const DRAG_VERTICAL_LIMIT_PX = 42;
const DRAG_VERTICAL_DAMPING = 0.18;
/** Under this, the pointer was a tap and the card should flip instead. */
export const DRAG_INTENT_PX = 4;
/** Over this, the pointer was a throw and the tap that follows it is ignored. */
export const DRAG_CLICK_SUPPRESSION_PX = 8;

export type FlashcardBucket = "again" | "easy";

export type FlashcardExitStart = {
  xPercent: number;
  yPercent: number;
  rotationDeg: number;
};

/** How far a card has to travel to count as thrown, for a card this wide. */
export function flashcardDragThreshold(width: number) {
  return Math.min(
    DRAG_TRIGGER_MAX_PX,
    Math.max(DRAG_TRIGGER_MIN_PX, width * DRAG_TRIGGER_RATIO),
  );
}

export function flashcardDragRotation(deltaX: number, width: number) {
  if (width <= 0) {
    return 0;
  }

  const ratio = Math.max(-1, Math.min(1, deltaX / width));

  return ratio * DRAG_MAX_ROTATION_DEG;
}

/**
 * The card follows the finger sideways but barely vertically: a throw is a
 * horizontal gesture, and letting it wander up the screen makes it feel loose.
 */
export function clampFlashcardDrag(rawDeltaX: number, rawDeltaY: number, width: number) {
  const limit = width * DRAG_LIMIT_RATIO;

  return {
    deltaX: Math.max(-limit, Math.min(limit, rawDeltaX)),
    deltaY: Math.max(
      -DRAG_VERTICAL_LIMIT_PX,
      Math.min(DRAG_VERTICAL_LIMIT_PX, rawDeltaY * DRAG_VERTICAL_DAMPING),
    ),
  };
}

/** Where the exit animation takes over from the finger. */
export function flashcardExitStart(
  deltaX: number,
  deltaY: number,
  width: number,
): FlashcardExitStart {
  const safeWidth = Math.max(width, 1);

  return {
    xPercent: (deltaX / safeWidth) * 100,
    yPercent: (deltaY / safeWidth) * 100,
    rotationDeg: flashcardDragRotation(deltaX, safeWidth),
  };
}

/** Which way the card is leaning, or nothing while it has barely moved. */
export function flashcardDragDirection(deltaX: number): FlashcardBucket | null {
  if (Math.abs(deltaX) <= DRAG_INTENT_PX) {
    return null;
  }

  return deltaX < 0 ? "again" : "easy";
}

/** 0 at rest, 1 once the card would be graded if let go. */
export function flashcardDragProgress(deltaX: number, width: number) {
  const threshold = flashcardDragThreshold(width);

  return threshold > 0 ? Math.min(1, Math.abs(deltaX) / threshold) : 0;
}

export function isFlashcardThrown(deltaX: number, width: number) {
  return Math.abs(deltaX) >= flashcardDragThreshold(width);
}
