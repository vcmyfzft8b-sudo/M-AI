import type { PalaceLayout } from "./layout.ts";

/**
 * The way to the next stop, as the streets run.
 *
 * The town is a grid, and nobody walks through a house to get somewhere, so
 * the route follows the pavements: along the street you are on, round the
 * corner at a junction (crossing where the zebra stripes are), along the
 * street the stop is on. At most two corners — one to turn onto the stop's
 * street, or two via a cross street when it runs parallel to yours.
 *
 * Pure geometry, kept away from three.js so it can be tested.
 */

export type Point = { x: number; z: number };

/** Where people walk: the middle of the pavement, the same line the pedestrians keep to. */
export const WALKING_OFFSET = 8.2;

type Street = { axis: "x" | "z"; line: number; along: number; side: 1 | -1 };
type Houses = Pick<PalaceLayout, "houses">["houses"];

function streetLines(layout: Pick<PalaceLayout, "roads">) {
  return [...new Set(layout.roads.filter((road) => road.width > road.depth).map((road) => road.z))].sort((a, b) => a - b);
}

/** Whether the straight walk between two points passes through a house, or brushes its walls. */
function blocked(houses: Houses, a: Point, b: Point) {
  const margin = 0.4;
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);

  for (let step = 0; step <= steps; step++) {
    const t = steps === 0 ? 0 : step / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;

    for (const house of houses) {
      const dx = x - house.x;
      const dz = z - house.z;

      if (
        Math.abs(dx * Math.cos(house.facing) - dz * Math.sin(house.facing)) < house.width / 2 + margin &&
        Math.abs(dx * Math.sin(house.facing) + dz * Math.cos(house.facing)) < house.depth / 2 + margin
      )
        return true;
    }
  }

  return false;
}

/** The two centre lines either side of a value (one, at the edge of town). */
function bracketing(lines: readonly number[], value: number) {
  const below = [...lines].reverse().find((line) => line <= value);
  const above = lines.find((line) => line > value);

  return [below, above].filter((line): line is number => line !== undefined);
}

/**
 * The street a point is on, and which side of it: the nearest of the four
 * round its block that can be reached without walking through a house — a
 * door on a corner lot faces one street and backs onto another, and a stop in
 * a garden may have houses on two sides.
 */
function snap(lines: readonly number[], houses: Houses, point: Point): Street {
  const candidates: Street[] = [
    ...bracketing(lines, point.z).map((line): Street => ({ axis: "x", line, along: point.x, side: point.z >= line ? 1 : -1 })),
    ...bracketing(lines, point.x).map((line): Street => ({ axis: "z", line, along: point.z, side: point.x >= line ? 1 : -1 })),
  ].sort(
    (a, b) =>
      Math.abs((a.axis === "x" ? point.z : point.x) - a.line) - Math.abs((b.axis === "x" ? point.z : point.x) - b.line),
  );

  return candidates.find((street) => !blocked(houses, point, onStreet(street, street.along))) ?? candidates[0];
}

/**
 * A way out for a point hemmed in on all four sides — a stop in the garden in
 * the middle of a block, with houses all round it. A breadth-first search over
 * a one-metre grid of the block finds the gap between houses, and the route is
 * then pulled straight wherever there is a clear line. Empty when the point
 * can reach a street directly; otherwise ends on the block's pavement.
 */
function escape(lines: readonly number[], houses: Houses, point: Point): Point[] {
  const street = snap(lines, houses, point);

  if (!blocked(houses, point, onStreet(street, street.along))) return [];

  const [left, right] = bracketing(lines, point.x);
  const [low, high] = bracketing(lines, point.z);

  if (right === undefined || high === undefined) return [];

  const minX = left + WALKING_OFFSET;
  const maxX = right - WALKING_OFFSET;
  const minZ = low + WALKING_OFFSET;
  const maxZ = high - WALKING_OFFSET;
  const columns = Math.ceil(maxX - minX) + 1;
  const rows = Math.ceil(maxZ - minZ) + 1;
  const cell = (column: number, row: number) => ({ x: minX + column, z: minZ + row });
  const open = (column: number, row: number) => {
    const { x, z } = cell(column, row);

    return !houses.some((house) => {
      const dx = x - house.x;
      const dz = z - house.z;

      return (
        Math.abs(dx * Math.cos(house.facing) - dz * Math.sin(house.facing)) < house.width / 2 + 0.6 &&
        Math.abs(dx * Math.sin(house.facing) + dz * Math.cos(house.facing)) < house.depth / 2 + 0.6
      );
    });
  };
  const startColumn = Math.max(0, Math.min(columns - 1, Math.round(point.x - minX)));
  const startRow = Math.max(0, Math.min(rows - 1, Math.round(point.z - minZ)));
  const previous = new Map<number, number>([[startRow * columns + startColumn, -1]]);
  const queue = [startRow * columns + startColumn];
  let exit = -1;

  while (queue.length && exit < 0) {
    const current = queue.shift()!;
    const column = current % columns;
    const row = Math.floor(current / columns);

    if (column === 0 || row === 0 || column === columns - 1 || row === rows - 1) {
      exit = current;
      break;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = (row + dr) * columns + column + dc;

      if (previous.has(next) || !open(column + dc, row + dr)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }

  if (exit < 0) return [];

  const route: Point[] = [];

  for (let at = exit; at >= 0; at = previous.get(at) ?? -1) route.unshift(cell(at % columns, Math.floor(at / columns)));

  /* Pull the staircase of cells straight wherever the line is clear. */
  const straight: Point[] = [];
  let from = point;
  let index = 0;

  while (index < route.length) {
    let farthest = index;

    for (let ahead = route.length - 1; ahead > index; ahead--)
      if (!blocked(houses, from, route[ahead])) {
        farthest = ahead;
        break;
      }
    straight.push(route[farthest]);
    from = route[farthest];
    index = farthest + 1;
  }

  return straight;
}

/** A point on a street's walking line. */
function onStreet(street: Pick<Street, "axis" | "line" | "side">, along: number): Point {
  const offset = street.line + street.side * WALKING_OFFSET;

  return street.axis === "x" ? { x: along, z: offset } : { x: offset, z: along };
}

/** The route from `from` to `to` along the pavements, as a polyline including both ends. */
export function guidePath(layout: Pick<PalaceLayout, "roads" | "houses">, from: Point, to: Point): Point[] {
  const lines = streetLines(layout);

  if (lines.length === 0) return [from, to];

  /* Out of a hemmed-in garden first, to a corner of the block, if need be. */
  const exit = escape(lines, layout.houses, from);
  const entry = escape(lines, layout.houses, to).reverse();
  const origin = exit.at(-1) ?? from;
  const destination = entry[0] ?? to;
  const start = snap(lines, layout.houses, origin);
  const end = snap(lines, layout.houses, destination);
  const points: Point[] = [from, ...exit, onStreet(start, start.along)];

  if (start.axis === end.axis && start.line === end.line) {
    points.push(onStreet(end, end.along));
  } else if (start.axis !== end.axis) {
    /* Round one corner: where the two walking lines meet. */
    const corner = onStreet(start, end.line + end.side * WALKING_OFFSET);

    points.push(corner, onStreet(end, end.along));
  } else {
    /* Parallel streets: over by the cross street that costs the least walking. */
    const cross = lines.reduce((best, line) =>
      Math.abs(start.along - line) + Math.abs(end.along - line) < Math.abs(start.along - best) + Math.abs(end.along - best)
        ? line
        : best,
    );
    const side: 1 | -1 = (start.along + end.along) / 2 >= cross ? 1 : -1;
    const at = cross + side * WALKING_OFFSET;

    points.push(onStreet(start, at), onStreet(end, at), onStreet(end, end.along));
  }

  points.push(...entry, to);

  /* Drop steps shorter than a stride; they are only noise at a corner. */
  return points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.z - points[index - 1].z) > 0.5);
}

/** Points every `spacing` metres along a polyline, from `offset` in, with the heading at each. */
export function alongPath(path: readonly Point[], spacing: number, offset: number, limit: number) {
  const marks: { x: number; z: number; heading: number; distance: number }[] = [];
  let travelled = 0;
  let next = offset;

  for (let index = 1; index < path.length && marks.length < limit; index++) {
    const a = path[index - 1];
    const b = path[index];
    const length = Math.hypot(b.x - a.x, b.z - a.z);

    if (length === 0) continue;

    const heading = Math.atan2(b.x - a.x, b.z - a.z);

    while (next <= travelled + length && marks.length < limit) {
      const t = (next - travelled) / length;

      marks.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading, distance: next });
      next += spacing;
    }
    travelled += length;
  }

  return marks;
}
