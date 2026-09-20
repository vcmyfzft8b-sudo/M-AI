"use client";

/**
 * What the app remembers so it can be read with no connection.
 *
 * Every `/app` screen is server-rendered from the database, so with the network
 * gone there is nothing to render — not a stale page, an empty one. The fix is
 * for the app to keep its own copy of what it last showed: the library, the
 * folders, and the full detail of every note that has been opened. Offline the
 * same components are mounted against that copy instead of against a server
 * response, which is why the screens look identical rather than like a reduced
 * "offline version".
 *
 * IndexedDB rather than `localStorage`: a single note's detail — note document,
 * transcript, cards, quiz, practice test, chat — runs to hundreds of kilobytes,
 * and `localStorage` is a synchronous 5 MB box shared with everything else on
 * the origin.
 *
 * The store is per account. `meta.userId` is checked on every read and the
 * whole database is dropped when it does not match, so signing in as somebody
 * else on a shared phone can never surface the previous account's notes.
 */
import type { AppLectureListItem, AppLibraryFolder, LectureDetail } from "@/lib/types";

const DATABASE = "memo-offline";
const DATABASE_VERSION = 1;
const STORE = "snapshots";

export const OFFLINE_META_KEY = "meta";
export const OFFLINE_HOME_KEY = "home";
export const OFFLINE_LECTURE_KEY_PREFIX = "lecture:";

/**
 * How many note details are kept. Each is the whole workspace payload, so this
 * is the one entry that could grow without limit; past the cap the least
 * recently saved go first. Fifty is well beyond a semester of notes for the
 * accounts we see, and a library larger than that still keeps every note the
 * reader actually opens.
 */
export const MAX_CACHED_LECTURES = 50;

export type OfflineMeta = {
  userId: string;
  savedAt: number;
};

export type OfflineHomeSnapshot = {
  userId: string;
  lectures: AppLectureListItem[];
  folders: AppLibraryFolder[];
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  savedAt: number;
};

export type OfflineLectureSnapshot = {
  userId: string;
  detail: LectureDetail;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  savedAt: number;
};

/**
 * When each cached note was last written, as one small record.
 *
 * Pruning needs the oldest, and the only other way to know that is to read
 * every note back — which is tens of megabytes of note documents, transcripts
 * and cards deserialised on a phone, on every save, for the length of a single
 * number. The index is rebuilt from the keys if it is ever missing.
 */
export const OFFLINE_LECTURE_INDEX_KEY = "lectureIndex";

type OfflineLectureIndex = Record<string, number>;

export function lectureSnapshotKey(lectureId: string) {
  return `${OFFLINE_LECTURE_KEY_PREFIX}${lectureId}`;
}

function supported() {
  return typeof indexedDB !== "undefined";
}

let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (!supported()) {
    return Promise.resolve(null);
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;

    try {
      request = indexedDB.open(DATABASE, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      /*
       * Another tab upgrading or deleting the database blocks this handle and
       * every later request on it hangs. Dropping the memoised promise means
       * the next call opens a fresh one rather than queueing behind a dead
       * connection.
       */
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => resolve(null);
    // Private browsing and "block all cookies" reject the open silently.
    request.onblocked = () => resolve(null);
  });

  return databasePromise;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (database) =>
      new Promise<T | null>((resolve) => {
        if (!database) {
          resolve(null);
          return;
        }

        try {
          const transaction = database.transaction(STORE, mode);
          const request = work(transaction.objectStore(STORE));

          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

async function readKey<T>(key: string): Promise<T | null> {
  return (await run<T>("readonly", (store) => store.get(key) as IDBRequest<T>)) ?? null;
}

async function writeKey(key: string, value: unknown) {
  await run("readwrite", (store) => store.put(value, key) as IDBRequest<IDBValidKey>);
}

async function deleteKeys(keys: string[]) {
  if (keys.length === 0) {
    return;
  }

  const database = await openDatabase();

  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);

      keys.forEach((key) => store.delete(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Everything, for a sign-out or an account change. */
export async function clearOfflineSnapshots() {
  const database = await openDatabase();

  if (!database) {
    return;
  }

  await run("readwrite", (store) => store.clear() as IDBRequest<undefined>);
}

export async function readOfflineMeta() {
  return readKey<OfflineMeta>(OFFLINE_META_KEY);
}

/**
 * Drops the store when it belongs to a different account. Called before every
 * write, so that a second account on the same device starts from nothing.
 */
export async function ensureOfflineOwner(userId: string) {
  const meta = await readOfflineMeta();

  if (meta && meta.userId !== userId) {
    await clearOfflineSnapshots();
  }
}

export async function saveOfflineHome(snapshot: Omit<OfflineHomeSnapshot, "savedAt">) {
  await ensureOfflineOwner(snapshot.userId);
  await writeKey(OFFLINE_META_KEY, { userId: snapshot.userId, savedAt: Date.now() } satisfies OfflineMeta);
  await writeKey(OFFLINE_HOME_KEY, { ...snapshot, savedAt: Date.now() } satisfies OfflineHomeSnapshot);
}

export async function readOfflineHome() {
  return readKey<OfflineHomeSnapshot>(OFFLINE_HOME_KEY);
}

export async function saveOfflineLecture(snapshot: Omit<OfflineLectureSnapshot, "savedAt">) {
  await ensureOfflineOwner(snapshot.userId);
  await writeKey(OFFLINE_META_KEY, { userId: snapshot.userId, savedAt: Date.now() } satisfies OfflineMeta);
  const savedAt = Date.now();

  await writeKey(lectureSnapshotKey(snapshot.detail.lecture.id), {
    ...snapshot,
    savedAt,
  } satisfies OfflineLectureSnapshot);
  await pruneOfflineLectures(snapshot.detail.lecture.id, savedAt);
}

export async function readOfflineLecture(lectureId: string) {
  return readKey<OfflineLectureSnapshot>(lectureSnapshotKey(lectureId));
}

export async function forgetOfflineLecture(lectureId: string) {
  const index = await readKey<OfflineLectureIndex>(OFFLINE_LECTURE_INDEX_KEY);

  if (index) {
    delete index[lectureId];
    await writeKey(OFFLINE_LECTURE_INDEX_KEY, index);
  }

  await deleteKeys([lectureSnapshotKey(lectureId)]);
}

/** Which notes can be opened with no connection, newest copy first. */
export async function listOfflineLectureIds() {
  const keys = await run<IDBValidKey[]>(
    "readonly",
    (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>,
  );

  return (keys ?? [])
    .filter((key): key is string => typeof key === "string" && key.startsWith(OFFLINE_LECTURE_KEY_PREFIX))
    .map((key) => key.slice(OFFLINE_LECTURE_KEY_PREFIX.length));
}

async function pruneOfflineLectures(savedId: string, savedAt: number) {
  const stored = (await readKey<OfflineLectureIndex>(OFFLINE_LECTURE_INDEX_KEY)) ?? {};
  const ids = await listOfflineLectureIds();
  const index: OfflineLectureIndex = {};

  /*
   * Keyed off what is actually in the store rather than off the index, so an
   * index that has fallen behind — a store cleared for a new account, a write
   * that failed — cannot keep a name alive for a note that is gone. A note with
   * no recorded time sorts oldest, which is the safe way round: the worst it
   * costs is re-caching a note on the next visit.
   */
  for (const id of ids) {
    index[id] = id === savedId ? savedAt : stored[id] ?? 0;
  }

  await writeKey(OFFLINE_LECTURE_INDEX_KEY, index);

  if (ids.length <= MAX_CACHED_LECTURES) {
    return;
  }

  await deleteKeys(
    ids
      .sort((first, second) => index[first] - index[second])
      .slice(0, ids.length - MAX_CACHED_LECTURES)
      .map(lectureSnapshotKey),
  );
}

/**
 * The mind map, which is the one note tab whose content is not part of the
 * detail payload: it is built on demand and fetched when the tab is opened. It
 * is cached under its own key so that a map that has been looked at once is
 * still there with no connection.
 */
export const OFFLINE_MINDMAP_KEY_PREFIX = "mindmap:";

export type OfflineMindmapSnapshot = {
  userId: string;
  payload: unknown;
  savedAt: number;
};

export function mindmapSnapshotKey(lectureId: string) {
  return `${OFFLINE_MINDMAP_KEY_PREFIX}${lectureId}`;
}

/**
 * Unlike the other writers this one takes no account id, because the screen
 * that calls it does not know one — it is a note tab, handed a lecture id and
 * nothing else. The owner is read from the store instead, which is sound: a
 * mind map can only be looked at from inside a note, and opening that note is
 * what wrote the meta record in the first place. No meta means nothing has
 * been cached for anybody yet, and there is nothing for this to belong to.
 */
export async function saveOfflineMindmap(params: { lectureId: string; payload: unknown }) {
  const meta = await readOfflineMeta();

  if (!meta) {
    return;
  }

  await writeKey(mindmapSnapshotKey(params.lectureId), {
    userId: meta.userId,
    payload: params.payload,
    savedAt: Date.now(),
  } satisfies OfflineMindmapSnapshot);
}

export async function readOfflineMindmap(lectureId: string) {
  return readKey<OfflineMindmapSnapshot>(mindmapSnapshotKey(lectureId));
}
