/*
 * The study path's geometry, in rem: lessons are stops on one smooth line that swings gently left
 * and right down the screen, one stop per row. Pure, so the dashboard and its tests agree on it.
 */

/** Height of one stop's row: the stop, its label and the room to the next one. */
export const PATH_ROW_REM = 8.6;
/** Diameter of a stop (the next one is drawn larger, around the same centre). */
export const PATH_STATION_REM = 4.5;
/** How far the line swings either side of the middle. */
export const PATH_SWING_REM = 6;

/** A stop's horizontal offset from the middle, by its place on the whole path. */
export function pathOffset(index: number) {
  return Math.round(Math.sin((index * Math.PI) / 4) * PATH_SWING_REM * 100) / 100;
}

/** The centre of a stop within its module's stretch of path, `row` stops down. */
export function pathPoint(index: number, row: number) {
  return { x: pathOffset(index), y: Math.round((row * PATH_ROW_REM + PATH_STATION_REM / 2) * 100) / 100 };
}

/**
 * One smooth line through the given centres (rem, the middle at x = 0), as SVG path data: a
 * Catmull-Rom curve written as cubic Béziers, so it passes through every stop with no corners.
 */
export function pathCurve(points: { x: number; y: number }[]) {
  if (points.length === 0) {
    return "";
  }

  const at = (index: number) => points[Math.min(Math.max(index, 0), points.length - 1)];
  const fixed = (value: number) => Math.round(value * 100) / 100;
  let data = `M ${fixed(points[0].x)} ${fixed(points[0].y)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const [before, from, to, after] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    const first = { x: from.x + (to.x - before.x) / 6, y: from.y + (to.y - before.y) / 6 };
    const second = { x: to.x - (after.x - from.x) / 6, y: to.y - (after.y - from.y) / 6 };
    data += ` C ${fixed(first.x)} ${fixed(first.y)}, ${fixed(second.x)} ${fixed(second.y)}, ${fixed(to.x)} ${fixed(to.y)}`;
  }

  return data;
}

/** Memo sits beside the next stop, on the side the line is not swinging towards. */
export function pathBuddySide(index: number): "left" | "right" {
  return pathOffset(index) > 0 ? "left" : "right";
}
