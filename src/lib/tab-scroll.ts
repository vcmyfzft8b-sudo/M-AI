/*
 * Where a horizontal pill row should sit after one of its pills is tapped.
 *
 * The note screen's tabs overflow their scroller on the phone, so the pill you
 * reach for is regularly the half-cut one at the edge — and a tap that only
 * changes the tab leaves it exactly as cut as it was. This works out how far
 * the row has to move to show it whole.
 *
 * The arithmetic is out here rather than in the component because the cases
 * that matter are the awkward ones — the pill wider than the room it has, the
 * row that does not overflow at all, the last pill in the row — and those are
 * cheap to assert on numbers and fiddly to reproduce by hand in a browser.
 */

/**
 * How much room stays clear beside the pill the row scrolls to. The phone row
 * fades its trailing 2.2rem out under a mask, so a pill parked flush against
 * that edge lands half-faded; the gutter also leaves the next pill along
 * peeking in, which is what says the row keeps going.
 */
export const TAB_SCROLL_GUTTER_PX = 40;

export type TabScrollGeometry = {
  /** How far the row is scrolled now. */
  scrollLeft: number;
  /** The visible width of the row. */
  viewportWidth: number;
  /** The full scrollable width of the row's contents. */
  contentWidth: number;
  /** The pill's left edge, measured from the start of those contents. */
  pillLeft: number;
  /** The pill's width. */
  pillWidth: number;
  /** Overridden only by the tests. */
  gutter?: number;
};

/**
 * The scroll offset that shows the pill whole, or `null` when the row is
 * already close enough that moving it would only be noise.
 *
 * A pill already fully in view does not move the row at all: the reader chose
 * where the row sits, and the tap they just made was about the tab, not the
 * scroller.
 */
export function tabScrollTarget(geometry: TabScrollGeometry): number | null {
  const { scrollLeft, viewportWidth, contentWidth, pillLeft, pillWidth } = geometry;

  const maxScroll = Math.max(0, contentWidth - viewportWidth);
  if (maxScroll <= 0) return null;

  /*
   * A pill too wide to carry a gutter on both sides gets whatever is left,
   * split evenly, so it still ends up centred rather than jammed against one
   * edge with the full gutter on the other.
   */
  const gutter = Math.min(
    geometry.gutter ?? TAB_SCROLL_GUTTER_PX,
    Math.max(0, (viewportWidth - pillWidth) / 2),
  );

  const leadingCut = scrollLeft + gutter - pillLeft;
  const trailingCut = pillLeft + pillWidth + gutter - (scrollLeft + viewportWidth);

  /*
   * Leading first. When a pill overflows both ways — one wider than the row,
   * which the gutter clamp above allows — showing its start is the useful
   * half: that is where the icon and the first of the label are.
   */
  const wanted =
    leadingCut > 0 ? scrollLeft - leadingCut : trailingCut > 0 ? scrollLeft + trailingCut : scrollLeft;

  const target = Math.min(Math.max(wanted, 0), maxScroll);
  return Math.abs(target - scrollLeft) < 1 ? null : target;
}
