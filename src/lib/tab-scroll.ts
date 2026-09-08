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

/** Which way along the row the reader is moving, and so which neighbour matters. */
export type PillTravel = "next" | "previous";

/**
 * Where a row should sit so the chosen pill and the pills either side of it are readable.
 *
 * Showing the chosen pill alone is not enough on a row people move along one step at a
 * time: it lands flush against a fade with its neighbours half-cut behind it, so the
 * things you are most likely to reach for next are the things you cannot read.
 *
 * The two sides are not equal — but which of them is the important one depends on which
 * way the reader is going, and that is what the first two attempts at this got wrong. Both
 * of them made the pill on the right required and the pill on the left optional. That is
 * correct while the reader is working rightwards, and exactly backwards when they turn
 * around: stepping back one tab, the pill they are heading for is the one on the left, and
 * it was the one being given up. On a row where three pills do not fit — the note tabs on
 * a phone — that meant every leftward tap parked them against the left fade with nothing
 * ahead of them, and the only way to see the tab before was to drag the row by hand.
 *
 * So the neighbour on the side being travelled towards is required, the one behind is
 * merely wanted. When the whole neighbourhood fits, all three are shown. When it does not,
 * the pill behind is given up and the chosen pill is never given up at all.
 */
export function pillNeighbourhoodScrollTarget(params: {
  row: { scrollLeft: number; clientWidth: number; scrollWidth: number; left: number };
  pill: { left: number; width: number };
  previous: { left: number; width: number } | null;
  next: { left: number; width: number } | null;
  /** Defaults to rightwards, which is where a row with no history is assumed to be going. */
  travel?: PillTravel;
}): number | null {
  const { row, pill, previous, next } = params;
  const travel = params.travel ?? "next";
  const toContent = (clientLeft: number) => clientLeft - row.left + row.scrollLeft;

  const pillStart = toContent(pill.left);
  const pillEnd = pillStart + pill.width;
  /* Both neighbours, collapsing to the pill's own edge at either end of the row. */
  const bothStart = previous ? toContent(previous.left) : pillStart;
  const bothEnd = next ? toContent(next.left) + next.width : pillEnd;

  /*
   * What to try and show, best first, each one giving up more than the last: all three
   * pills, then the chosen one with the neighbour it is heading towards, then the chosen
   * one alone. The first that fits the row wins, which is what keeps the chosen pill
   * whole on a row too narrow to hold even a pair.
   */
  const spans =
    travel === "next"
      ? [
          [bothStart, bothEnd],
          [pillStart, bothEnd],
          [pillStart, pillEnd],
        ]
      : [
          [bothStart, bothEnd],
          [bothStart, pillEnd],
          [pillStart, pillEnd],
        ];

  const [start, end] = spans.find(([from, to]) => to - from <= row.clientWidth) ?? [
    pillStart,
    pillEnd,
  ];

  return tabScrollTarget({
    scrollLeft: row.scrollLeft,
    viewportWidth: row.clientWidth,
    contentWidth: row.scrollWidth,
    pillLeft: start,
    pillWidth: end - start,
  });
}
