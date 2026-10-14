/*
 * The study path's geometry, in rem: lessons are stations on a line that swings gently left and
 * right down the screen, one station per row. Pure, so the dashboard and its tests agree on it.
 */

/** Height of one station's row: the station, its label and the gap to the next one. */
export const PATH_ROW_REM = 8;
/** Diameter of a station. */
export const PATH_STATION_REM = 4.5;
/** How far the line swings either side of the middle. */
export const PATH_SWING_REM = 4;

/** A station's horizontal offset from the middle, by its place on the whole path. */
export function pathOffset(index: number) {
  return Math.round(Math.sin((index * Math.PI) / 4) * PATH_SWING_REM * 100) / 100;
}

/** The segment from one station's centre to the next one's, a row further down. */
export function pathSegment(index: number) {
  const dx = pathOffset(index + 1) - pathOffset(index);
  return {
    length: Math.round(Math.hypot(dx, PATH_ROW_REM) * 100) / 100,
    angle: Math.round(((Math.atan2(PATH_ROW_REM, dx) * 180) / Math.PI) * 100) / 100,
  };
}

/** Memo sits beside the current station, on the side the line is not swinging towards. */
export function pathBuddySide(index: number): "left" | "right" {
  return pathOffset(index) > 0 ? "left" : "right";
}
