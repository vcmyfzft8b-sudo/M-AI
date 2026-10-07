/**
 * How much of the note's annotation dock fits beside the chat button.
 *
 * The dock's row is the highlight button (marker icon plus a "Highlight"
 * label), then underline, fix-a-word, colour and photo. On a phone it shares
 * one line with the chat button, so it only has the line's width less that
 * button. Fitting used to be decided by a breakpoint — fold the label below
 * 360px — which was measured before the fix-a-word button joined the row; from
 * then on, phones between 360px and about 397px wide cut the photo button off
 * at the dock's edge. Deciding from the widths themselves holds on every
 * screen, and in every language, whatever the label's length.
 *
 * - "full": everything, label included.
 * - "compact": the label folds away and the marker icon stands for it.
 * - "tight": compact, and the buttons close up a little as well — for the
 *   narrowest phones, where even the icons alone do not fit.
 */
export type AnnotateDockFit = "full" | "compact" | "tight";

/**
 * What "tight" takes off the row, in rem: three icon buttons 0.25rem narrower,
 * the colour button 0.3rem, and the highlight button's padding 0.2rem a side.
 * Kept beside the rules that do it (`[data-fit="tight"]` in redesign.css).
 */
export const TIGHT_SAVINGS_REM = 3 * 0.25 + 0.3 + 2 * 0.2;

/**
 * The chat button's share of the dock's line on a phone: its 3.4rem and the
 * 0.7rem gap. The same number as `.memo-dock-pill { max-width: calc(100% - 4.1rem) }`.
 */
export const CHAT_SLOT_REM = 4.1;

/** A few pixels of slack, so a row that fits exactly does not flicker between two states. */
const SLACK_PX = 2;

export function annotateDockFit({
  icons,
  label,
  room,
}: {
  /** The row's width without the label, at the buttons' normal size, in px. */
  icons: number;
  /** The label's own width plus its gap from the icon, in px. */
  label: number;
  /** The widest the dock may be, in px. */
  room: number;
}): AnnotateDockFit {
  if (icons + label <= room + SLACK_PX) {
    return "full";
  }

  if (icons <= room + SLACK_PX) {
    return "compact";
  }

  return "tight";
}
