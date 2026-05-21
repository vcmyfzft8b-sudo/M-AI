import type { LectureDetail } from "@/lib/types";

const NOTE_CACHE_DB_NAME = "memo-note-cache";
const NOTE_CACHE_DB_VERSION = 1;
const NOTE_CACHE_STORE = "lecture-notes";
const NOTE_CACHE_LOCAL_STORAGE_PREFIX = "memo-note-cache:";
const NOTE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNED_MEDIA_URL_FRESH_MS = 50 * 60 * 1000;

type CachedLectureNoteDetail = {
  lectureId: string;
  cachedAt: number;
  detail: LectureDetail;
};

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function openNoteCacheDb() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(NOTE_CACHE_DB_NAME, NOTE_CACHE_DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTE_CACHE_STORE)) {
        db.createObjectStore(NOTE_CACHE_STORE, { keyPath: "lectureId" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  }).catch(() => null);
}

function toCachedNoteDetail(detail: LectureDetail): LectureDetail {
  return {
    ...detail,
    studyAsset: null,
    quizAsset: null,
    practiceTestAsset: null,
    studySession: null,
    studySections: [],
    flashcards: [],
    quizQuestions: [],
    practiceTestQuestions: [],
    practiceTestAttempts: [],
    practiceTestHistorySummary: {
      attemptCount: 0,
      averagePercentage: null,
      bestPercentage: null,
      lowestPercentage: null,
      latestPercentage: null,
      scoresByAttempt: [],
    },
    transcript: [],
    chatMessages: [],
    audioUrl: null,
    degraded: undefined,
  };
}

function withoutExpiredMediaUrls(cached: CachedLectureNoteDetail): LectureDetail {
  if (Date.now() - cached.cachedAt <= SIGNED_MEDIA_URL_FRESH_MS) {
    return cached.detail;
  }

  return {
    ...cached.detail,
    noteMedia: cached.detail.noteMedia.map((media) => ({
      ...media,
      signedUrl: "",
    })),
  };
}

function readLocalStorageCache(lectureId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(`${NOTE_CACHE_LOCAL_STORAGE_PREFIX}${lectureId}`);
    const cached = raw ? (JSON.parse(raw) as CachedLectureNoteDetail) : null;

    if (!cached || Date.now() - cached.cachedAt > NOTE_CACHE_MAX_AGE_MS) {
      return null;
    }

    return withoutExpiredMediaUrls(cached);
  } catch {
    return null;
  }
}

function writeLocalStorageCache(detail: LectureDetail) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const cached: CachedLectureNoteDetail = {
      lectureId: detail.lecture.id,
      cachedAt: Date.now(),
      detail: toCachedNoteDetail(detail),
    };

    window.localStorage.setItem(
      `${NOTE_CACHE_LOCAL_STORAGE_PREFIX}${detail.lecture.id}`,
      JSON.stringify(cached),
    );
  } catch {
    return;
  }
}

export async function readCachedLectureNoteDetail(lectureId: string) {
  const db = await openNoteCacheDb();
  if (!db) {
    return readLocalStorageCache(lectureId);
  }

  try {
    const transaction = db.transaction(NOTE_CACHE_STORE, "readonly");
    const store = transaction.objectStore(NOTE_CACHE_STORE);
    const cached = await requestToPromise<CachedLectureNoteDetail | undefined>(
      store.get(lectureId),
    );

    if (!cached || Date.now() - cached.cachedAt > NOTE_CACHE_MAX_AGE_MS) {
      return null;
    }

    return withoutExpiredMediaUrls(cached);
  } catch {
    return readLocalStorageCache(lectureId);
  } finally {
    db.close();
  }
}

export async function writeCachedLectureNoteDetail(detail: LectureDetail) {
  const db = await openNoteCacheDb();
  if (!db) {
    writeLocalStorageCache(detail);
    return;
  }

  try {
    const cached: CachedLectureNoteDetail = {
      lectureId: detail.lecture.id,
      cachedAt: Date.now(),
      detail: toCachedNoteDetail(detail),
    };
    const transaction = db.transaction(NOTE_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(NOTE_CACHE_STORE);
    await requestToPromise(store.put(cached));
  } catch {
    writeLocalStorageCache(detail);
    return;
  } finally {
    db.close();
  }
}
