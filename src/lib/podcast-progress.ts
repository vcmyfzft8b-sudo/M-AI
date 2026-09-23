/**
 * Where a listener got to in an episode, on the way to and from the server.
 *
 * The store is the episode row — progress is only worth having if it follows somebody from the
 * bus to a desk, and a number in one browser does not. What lives here is the client half of
 * that: when to write, and what to do about the writes that do not land.
 *
 * Three things call it, and they are three different urgencies:
 *
 *   - a throttled tick while playing, which is a safety net rather than the real save;
 *   - pause and leaving the player, which is the real save;
 *   - the tab going away, which cannot await anything and so uses `sendBeacon`.
 *
 * The local buffer is not a second store. It holds pending and failed writes — a flaky connection,
 * a phone that locked mid-request — and replays them on the next save and on the next load. A
 * position that survived to `localStorage` but never reached the server is still better than
 * the one the server has, and is applied over it on the way in.
 */

const BUFFER_KEY = "memo-podcast-progress";

/** How often a position is written while the episode is simply playing. */
export const PROGRESS_SAVE_INTERVAL_MS = 15_000;

/**
 * How close to the end counts as having heard it.
 *
 * Episodes end on a spoken sentence rather than on silence, and a listener who has heard the
 * last sentence stops the tab rather than sitting through the tail. Anything past this reads as
 * finished; anything short of it is a position worth resuming from.
 */
const FINISHED_WITHIN_MS = 15_000;

export type PodcastProgress = {
  positionMs: number;
  durationMs: number | null;
  finished: boolean;
  /** When this client last touched it, so a buffered write can be compared with the server's. */
  updatedAt: number;
};

/*
 * The note the episode belongs to, carried in the entry rather than in the key.
 *
 * The buffer outlives the screen and holds entries for every note this browser has listened to,
 * so a replay has to know where to send each one. Sending them all to whichever note happens to
 * be open would 404 against the route's ownership check and leave them buffered for ever.
 */
type BufferedProgress = PodcastProgress & { lectureId: string };

type Buffer = Record<string, BufferedProgress>;

// Keep ordinary writes in gesture order: a slow Pause save must not land after
// a newer seek. Different episodes remain independent.
const pendingSaves = new Map<string, Promise<void>>();

function readBuffer(): Buffer {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(BUFFER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    return parsed && typeof parsed === "object" ? (parsed as Buffer) : {};
  } catch {
    /* Private browsing, or something that is not ours under our key. Start empty. */
    return {};
  }
}

function writeBuffer(buffer: Buffer) {
  try {
    window.localStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    /* Storage refused. The position is still on its way to the server; only the retry is lost. */
  }
}

/** Whether a position is far enough into the episode to be worth resuming from at all. */
export function isResumable(progress: { positionMs: number; durationMs: number | null }) {
  /*
   * The first few seconds are not a place anybody left off, they are a tap that opened the wrong
   * episode. Offering to resume from 0:03 is offering to start it.
   */
  return progress.positionMs > 20_000;
}

export function hasFinished(positionMs: number, durationMs: number | null) {
  return durationMs !== null && durationMs > 0 && positionMs >= durationMs - FINISHED_WITHIN_MS;
}

/**
 * The server's progress for an episode, corrected by anything this device knows and it does not.
 *
 * A buffered entry has not been acknowledged yet, so it wins outright rather
 * than being merged field by field.
 */
export function mergeStoredProgress<T extends { id: string } & Partial<PodcastProgress>>(
  episodes: T[],
): T[] {
  const buffer = readBuffer();

  if (Object.keys(buffer).length === 0) {
    return episodes;
  }

  return episodes.map((episode) => {
    const pending = buffer[episode.id];

    if (!pending) {
      return episode;
    }

    return {
      ...episode,
      positionMs: pending.positionMs,
      durationMs: pending.durationMs ?? episode.durationMs ?? null,
      finished: episode.finished || pending.finished,
    };
  });
}

function forget(episodeId: string, acknowledged: PodcastProgress) {
  const buffer = readBuffer();
  const pending = buffer[episodeId];

  if (!pending || pending.updatedAt !== acknowledged.updatedAt ||
      pending.positionMs !== acknowledged.positionMs ||
      pending.durationMs !== acknowledged.durationMs ||
      pending.finished !== acknowledged.finished) {
    return;
  }

  delete buffer[episodeId];
  writeBuffer(buffer);
}

function remember(lectureId: string, episodeId: string, progress: PodcastProgress) {
  writeBuffer({ ...readBuffer(), [episodeId]: { ...progress, lectureId } });
}

type SaveParams = {
  lectureId: string;
  episodeId: string;
  positionMs: number;
  durationMs: number | null;
};

function buildBody(params: SaveParams) {
  return JSON.stringify({
    episodeId: params.episodeId,
    positionMs: Math.max(0, Math.round(params.positionMs)),
    durationMs: params.durationMs && params.durationMs > 0 ? Math.round(params.durationMs) : null,
    finished: hasFinished(params.positionMs, params.durationMs),
  });
}

/**
 * Saves a position, and keeps it locally if the save does not land.
 *
 * Never rejects. Every caller is somewhere a listener is doing something else — pausing, leaving
 * a screen, hearing the next sentence — and a rejected promise there is a crash in the middle of
 * playback over a number nobody asked for.
 */
export async function savePodcastProgress(params: SaveParams) {
  const body = buildBody(params);
  const progress = {
    positionMs: Math.max(0, Math.round(params.positionMs)),
    durationMs: params.durationMs,
    finished: hasFinished(params.positionMs, params.durationMs),
    updatedAt: Date.now(),
  };
  // Buffer before waiting: closing the screen must not lose a queued save.
  remember(params.lectureId, params.episodeId, progress);
  const previous = pendingSaves.get(params.episodeId) ?? Promise.resolve();
  const work = previous.then(async () => {
    try {
      const response = await fetch(`/api/lectures/${params.lectureId}/podcast/progress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      });

      const payload = (await response.json().catch(() => null)) as { saved?: boolean } | null;

      if (response.ok && payload?.saved === true) {
        forget(params.episodeId, progress);
      }
    } catch {
      // The newest position is already buffered. Never replace it with the
      // older position from a failed request.
    }
  });
  pendingSaves.set(params.episodeId, work);
  await work;
  if (pendingSaves.get(params.episodeId) === work) {
    pendingSaves.delete(params.episodeId);
  }
}

/**
 * The last save, made as the tab goes away.
 *
 * `sendBeacon` rather than `fetch`, because a page being unloaded is given no time to await one —
 * and buffered first rather than after, because there is no completion to react to. A beacon that
 * did land only costs the next load one redundant replay.
 */
export function beaconPodcastProgress(params: SaveParams) {
  remember(params.lectureId, params.episodeId, {
    positionMs: Math.max(0, Math.round(params.positionMs)),
    durationMs: params.durationMs,
    finished: hasFinished(params.positionMs, params.durationMs),
    updatedAt: Date.now(),
  });

  try {
    navigator.sendBeacon?.(
      `/api/lectures/${params.lectureId}/podcast/progress`,
      /* Typed as JSON so the route's content-type check passes; a bare string is text/plain. */
      new Blob([buildBody(params)], { type: "application/json" }),
    );
  } catch {
    /* The buffer above is the fallback, and it is already written. */
  }
}

/**
 * Re-sends everything a previous session could not, without blocking anything on the result.
 *
 * Only this note's entries. The others belong to notes this screen has no business writing to,
 * and the route would refuse them — they wait for their own note to be opened.
 */
export function flushBufferedProgress(lectureId: string) {
  for (const [episodeId, progress] of Object.entries(readBuffer())) {
    if (progress.lectureId !== lectureId) {
      continue;
    }

    void savePodcastProgress({
      lectureId,
      episodeId,
      positionMs: progress.positionMs,
      durationMs: progress.durationMs,
    });
  }
}
