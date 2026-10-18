import { practicesOwed, type ExamLessonKind, type ModuleState } from "./exam-model.ts";

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

/**
 * The lessons ahead of a module, drawn locked: at most this many, however many it still needs (the
 * pill under the first says the full count).
 */
export const MAX_LOCKED_SHOWN = 12;

/*
 * The lessons a module has done, drawn most recent last: only the last few, so a module worked at
 * for weeks is not a column of identical circles to scroll past. The rest open with one tap.
 */
export const DONE_SHOWN = 4;

export type PathStation =
  | { type: "done"; id: string; topicId: string; kind: ExamLessonKind; score: number }
  | { type: "next"; topicId: string; kind: ExamLessonKind; check: boolean }
  /** A lesson still to come; `left` is how many the module still needs, counted from here. */
  | { type: "locked"; topicId: string; index: number; left: number };

/** One module's stretch of the path, `start` stops into the whole path (its place on the swing). */
export type PathRun = { topicId: string; start: number; stations: PathStation[] };

type PathModule = Pick<ModuleState, "topicId" | "mastery"> &
  Partial<Pick<ModuleState, "rawMastery" | "checkDue">> & { position: number; pending?: boolean };

/**
 * The path's stations, module by module in path order: each module's lessons done (oldest first),
 * then what it still needs to reach the goal, so every module shows its estimate from the start, not
 * only the one being studied. In the module "Next up" is in, that is "Next up" and the lessons after
 * it. The estimate is `practicesOwed` from where the module's knowledge is now, so a weak lesson
 * visibly adds stations and a module never started shows the whole way to the goal.
 *
 * `next` is "Next up" when the screen shows it; `ahead` is false once nothing is being worked
 * towards (the exam has passed, or the prep is archived), and then only what was done is drawn.
 */
export function pathStations({
  modules,
  history,
  next,
  ahead,
  unfolded,
  target,
}: {
  modules: readonly PathModule[];
  history: readonly { id: string; topicId: string; kind: ExamLessonKind; score: number }[];
  next: { topicId: string; kind: ExamLessonKind; check: boolean } | null;
  ahead: boolean;
  /** Modules whose earlier lessons the learner unfolded. */
  unfolded: ReadonlySet<string>;
  /** The goal, as a share (0.9). */
  target: number;
}) {
  const stations: PathStation[] = [];
  /* How many of each module's earlier lessons are folded away, by topic. */
  const folded = new Map<string, number>();

  for (const pathModule of [...modules].sort((left, right) => left.position - right.position)) {
    // A note still being made has no topics yet; the screen's "reading your material" card stands for it.
    if (pathModule.pending) {
      continue;
    }

    const done = history.filter((entry) => entry.topicId === pathModule.topicId);
    const hidden = unfolded.has(pathModule.topicId) ? 0 : Math.max(0, done.length - DONE_SHOWN);

    if (hidden > 0) {
      folded.set(pathModule.topicId, hidden);
    }

    for (const entry of done.slice(hidden)) {
      stations.push({ type: "done", id: entry.id, topicId: entry.topicId, kind: entry.kind, score: entry.score });
    }

    const owed = practicesOwed(pathModule, target);
    const isNext = next !== null && next.topicId === pathModule.topicId;

    if (isNext) {
      stations.push({ type: "next", topicId: pathModule.topicId, kind: next.kind, check: next.check });
    }

    // The lessons after "Next up" here; elsewhere, every lesson the module still needs.
    const left = isNext ? Math.max(1, owed) - 1 : ahead ? owed : 0;

    for (let index = 0; index < Math.min(MAX_LOCKED_SHOWN, left); index += 1) {
      stations.push({ type: "locked", topicId: pathModule.topicId, index, left });
    }
  }

  /* The stations in runs of one module each, every run under its module's chapter card. */
  const runs: PathRun[] = [];
  stations.forEach((station, index) => {
    const current = runs.at(-1);

    if (current && current.topicId === station.topicId) {
      current.stations.push(station);
    } else {
      runs.push({ topicId: station.topicId, start: index, stations: [station] });
    }
  });

  return { runs, folded };
}

/**
 * The module a shut one is waiting on: the nearest one before it that can be studied. The path
 * passes over a module that cannot be (a note still being made, or one the learner's plan does
 * not open), so "opens when module N reaches the goal" must name the one that really holds it.
 */
export function gatingModule<T extends { topicId: string; position: number }>(
  modules: readonly T[],
  topicId: string,
  usable: (module: T) => boolean,
) {
  const ordered = [...modules].sort((left, right) => left.position - right.position);
  const at = ordered.findIndex((candidate) => candidate.topicId === topicId);

  return at > 0 ? (ordered.slice(0, at).reverse().find(usable) ?? null) : null;
}
