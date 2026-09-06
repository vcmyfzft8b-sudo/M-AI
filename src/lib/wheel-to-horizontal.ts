/**
 * Turning a mouse wheel into sideways travel for a row that only scrolls on one
 * axis — the note screen's pill row, and the chip rows built the same way.
 *
 * A trackpad can already push a horizontal scroller sideways, so this exists for
 * the mouse: a wheel reports the whole gesture on `deltaY`, the browser looks for
 * something to scroll vertically, finds the page behind the row, and the row the
 * pointer is actually over never moves. Every pill past the fold is then reachable
 * only by dragging the scrollbar that the design hides.
 *
 * The maths is separated from the listener so the awkward parts — the units, and
 * knowing when to leave the page alone — can be tested without a DOM.
 */

/** A wheel notch in `deltaMode: "line"`, in pixels. Matches Firefox's own step. */
const LINE_HEIGHT_PX = 16;

export type WheelToHorizontalInput = {
  deltaX: number;
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

/**
 * How far the row should travel for this wheel event, or `null` to let the
 * browser have it.
 *
 * Null in three cases, and each one matters:
 *
 * - the row has nothing to scroll, so taking the event would pin the page under
 *   a row that cannot move;
 * - the gesture is already horizontal (a trackpad swipe, or shift+wheel, which
 *   both engines report on `deltaX`) — the browser handles it correctly and
 *   doubling it would scroll twice as far;
 * - the row is already at the end it is being pushed towards, so the page picks
 *   the gesture up and the wheel does not dead-end on the last pill.
 */
export function wheelToHorizontalScroll({
  deltaX,
  deltaY,
  deltaMode,
  scrollLeft,
  scrollWidth,
  clientWidth,
}: WheelToHorizontalInput): number | null {
  const travel = scrollWidth - clientWidth;

  // Sub-pixel overflow is a rounding artefact, not a scrollable row.
  if (travel <= 1) {
    return null;
  }

  if (Math.abs(deltaX) >= Math.abs(deltaY) || deltaY === 0) {
    return null;
  }

  /*
   * Chrome reports pixels, Firefox reports lines (~3 per notch) and a few
   * configurations report pages. Left unconverted, a Firefox notch moves the row
   * three pixels — which reads as the row being stuck rather than as scrolling.
   */
  const pixels =
    deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaMode === 2 ? deltaY * clientWidth : deltaY;

  const next = Math.min(Math.max(scrollLeft + pixels, 0), travel);
  const step = next - scrollLeft;

  return step === 0 ? null : step;
}
