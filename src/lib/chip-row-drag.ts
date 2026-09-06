/**
 * Grab-and-pull for the rows that scroll sideways.
 *
 * A finger already drags these; a mouse has nothing. The design hides every
 * scrollbar, so on desktop the only ways to reach the pills past the edge were
 * the wheel and picking a tab and letting the row scroll itself. Holding the row
 * and pulling it is what people try first, and it did nothing.
 *
 * The whole difficulty is that the row is made of buttons, so the same
 * mousedown-move-up either scrolls the row or presses a pill, and the gesture
 * has to decide which without ever losing a plain click. That decision is here,
 * as arithmetic, rather than in a listener where it can only be checked by hand.
 */

/**
 * How far the pointer travels before this stops being a click and becomes a
 * drag. Matches the study manager's rows, which make the same choice — and it
 * is deliberately larger than the 4px tap-slop the phone uses, because a mouse
 * is steadier than a thumb and a smaller number turns an ordinary click on a
 * pill into a one-pixel drag that eats it.
 */
export const CHIP_DRAG_SLOP_PX = 8;

export type ChipRowDragStart = {
  pointerX: number;
  scrollLeft: number;
};

/**
 * Where the row should sit while the pointer is at `pointerX`, or `null` while
 * the gesture is still short enough to be a click.
 *
 * `dragging` says the threshold was already crossed earlier in this gesture:
 * once it is a drag it stays one, so a pull that comes back through its own
 * start point keeps scrolling instead of flickering back into a click.
 */
export function chipRowDragScrollLeft(
  start: ChipRowDragStart,
  pointerX: number,
  dragging: boolean,
): number | null {
  const travelled = pointerX - start.pointerX;

  if (!dragging && Math.abs(travelled) < CHIP_DRAG_SLOP_PX) {
    return null;
  }

  // The content follows the hand, so the row moves against it.
  return start.scrollLeft - travelled;
}

/**
 * Whether a pointerdown should begin a drag at all.
 *
 * Touch is excluded on purpose: the browser's own panning is better than
 * anything reimplemented here — it has the rubber-banding, the momentum and the
 * handover to the back-swipe — and running both at once means the row moves
 * twice as far as the finger. This gesture exists for the pointers that have no
 * pan of their own.
 */
export function shouldStartChipRowDrag({
  pointerType,
  button,
  scrollWidth,
  clientWidth,
}: {
  pointerType: string;
  /** `PointerEvent.button`: 0 is the primary one. */
  button: number;
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  if (pointerType === "touch" || button !== 0) {
    return false;
  }

  // Sub-pixel overflow is a rounding artefact, not a row that can be pulled.
  return scrollWidth - clientWidth > 1;
}
