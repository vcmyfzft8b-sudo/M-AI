"use client";

/**
 * Offline stand-in for every `/api/*` route the app calls while the creator
 * demo is on screen. It answers from the in-memory demo store, so the real UI
 * runs its normal request flow without a session, a database or an AI call.
 *
 * Anything not matched falls through to `{ ok: true }` rather than a network
 * error, so an unexpected background call can never surface an error banner in
 * the middle of a recording.
 */
import { buildNoteTtsChunks, parseNoteTtsDocument, stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import type { EditableNoteDoc } from "@/lib/note-doc";
import {
  addDemoNoteMedia,
  appendDemoChatMessages,
  createDemoFolder,
  deleteDemoFlashcard,
  deleteDemoFolder,
  deleteDemoLecture,
  deleteDemoNoteMedia,
  deleteDemoQuizQuestion,
  getCreatorDemoState,
  getDemoFolders,
  getDemoLectureDetail,
  renameDemoLecture,
  saveDemoNoteDoc,
  saveDemoStudySession,
  setDemoFlashcardProgress,
  startDemoPracticeAttempt,
  submitDemoPracticeAttempt,
  updateDemoFolder,
  upsertDemoFlashcard,
  upsertDemoQuizQuestion,
} from "@/lib/creator-demo/store";

const SUPABASE_SIGNED_UPLOAD_MARKER = "/storage/v1/object/upload/sign/";

/** Blobs handed to the fake storage upload, so note photos can render locally. */
const uploadedBlobUrls = new Map<string, string>();

/**
 * The workspace ignores a detail refresh that lands within 3s of the previous
 * one (`MIN_DETAIL_REFRESH_INTERVAL_MS`). Real endpoints are never fast enough
 * to hit that window, but the demo is — so the practice test would grade
 * without the result ever being rendered. Holding those responses until the
 * window has passed keeps the follow-up refresh effective.
 */
const DETAIL_REFRESH_THROTTLE_MS = 3000;
let lastDetailFetchAt = 0;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForDetailRefreshWindow() {
  const remaining = DETAIL_REFRESH_THROTTLE_MS + 120 - (Date.now() - lastDetailFetchAt);

  if (remaining > 0) {
    await delay(remaining);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJsonBody(init: RequestInit | undefined, input: RequestInfo | URL) {
  const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);

  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  if (body instanceof Blob) {
    try {
      return JSON.parse(await body.text()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return {};
}

function getMethod(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

/**
 * The storage client sends a picked photo either as the raw blob or wrapped in
 * FormData, depending on version and platform. Either way the bytes stay in the
 * browser: they become an object URL the demo note renders from.
 */
function extractUploadBlob(input: RequestInfo | URL, init: RequestInit | undefined) {
  const body = init?.body ?? (input instanceof Request ? input.body : null);

  if (body instanceof Blob) {
    return body;
  }

  if (body instanceof FormData) {
    for (const value of body.values()) {
      if (value instanceof Blob) {
        return value;
      }
    }
  }

  return null;
}

function getUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return new URL(input, window.location.origin);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url, window.location.origin);
}

/**
 * A silent WAV of the requested length. Playback still drives the read-along
 * highlighting, without shipping or generating any audio.
 */
function createSilentWavDataUrl(durationSeconds: number) {
  const sampleRate = 8000;
  const frameCount = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataSize = frameCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return `data:audio/wav;base64,${window.btoa(binary)}`;
}

function buildTtsPlan(lectureId: string) {
  const detail = getDemoLectureDetail(lectureId);
  const notes = detail?.artifact?.structured_notes_md;

  if (!notes) {
    return null;
  }

  const document = parseNoteTtsDocument(
    stripLeadingRedundantHeading(notes, detail?.lecture.title),
  );

  return { document, chunks: buildNoteTtsChunks(document) };
}

const TTS_LIMIT_SECONDS = 3600;

function ttsStatus(lectureId: string) {
  const plan = buildTtsPlan(lectureId);

  return {
    available: true,
    reason: null,
    tier: "paid" as const,
    limitSeconds: TTS_LIMIT_SECONDS,
    secondsUsed: 0,
    remainingSeconds: TTS_LIMIT_SECONDS,
    hasUnlimitedUsage: true,
    chunkCount: plan?.chunks.length ?? 0,
    totalWords: plan?.document.words.length ?? 0,
  };
}

function ttsChunk(lectureId: string, chunkIndex: number) {
  const plan = buildTtsPlan(lectureId);
  const chunk = plan?.chunks[chunkIndex];

  if (!plan || !chunk) {
    return json({ error: "Poslušanje ni na voljo." }, 404);
  }

  const wordCount = Math.max(1, chunk.wordEndIndex - chunk.wordStartIndex);
  const msPerWord = 380;
  const durationMs = wordCount * msPerWord;
  const alignment = Array.from({ length: wordCount }, (_, index) => ({
    wordIndex: chunk.wordStartIndex + index,
    startMs: index * msPerWord,
    endMs: (index + 1) * msPerWord,
  }));

  return json({
    audioUrl: createSilentWavDataUrl(durationMs / 1000),
    chunkIndex: chunk.chunkIndex,
    chunkCount: plan.chunks.length,
    wordStartIndex: chunk.wordStartIndex,
    wordEndIndex: chunk.wordEndIndex,
    durationMs,
    alignment,
    limitSeconds: TTS_LIMIT_SECONDS,
    secondsUsed: 0,
    remainingSeconds: TTS_LIMIT_SECONDS,
    hasUnlimitedUsage: true,
    tier: "paid",
  });
}

async function handleLectureRoute(
  segments: string[],
  method: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  const [lectureId, ...rest] = segments;
  const detail = getDemoLectureDetail(lectureId);

  if (rest.length === 0) {
    if (method === "GET") {
      lastDetailFetchAt = Date.now();
      return detail ? json(detail) : json({ error: "Ni najdeno." }, 404);
    }

    if (method === "DELETE") {
      deleteDemoLecture(lectureId);
      return json({ ok: true });
    }

    if (method === "PATCH") {
      const body = await readJsonBody(init, input);
      const title = typeof body.title === "string" ? body.title : null;

      if (title) {
        renameDemoLecture(lectureId, title);
      }

      return json({ ok: true });
    }
  }

  const [section, ...tail] = rest;

  switch (section) {
    case "study-session": {
      const body = await readJsonBody(init, input);
      saveDemoStudySession(lectureId, body as never);
      return json({ ok: true });
    }

    case "retry":
    case "study":
    case "quiz": {
      if (section === "quiz" && tail[0] === "questions") {
        return handleQuizQuestionRoute(lectureId, tail.slice(1), method, input, init);
      }

      return json({ ok: true });
    }

    case "chat": {
      const body = await readJsonBody(init, input);
      const question = typeof body.question === "string" ? body.question : "";
      const answer = appendDemoChatMessages(lectureId, question);
      return json({ answer });
    }

    case "notes-doc": {
      if (method === "GET") {
        return json({
          doc: detail?.editableNoteDoc ?? null,
          revision: detail?.editableNoteRevision ?? 0,
        });
      }

      const body = await readJsonBody(init, input);
      const saved = saveDemoNoteDoc(lectureId, body.doc as EditableNoteDoc);
      return saved ? json(saved) : json({ error: "Ni najdeno." }, 404);
    }

    case "note-media": {
      if (tail[0] === "uploads") {
        const body = await readJsonBody(init, input);
        const mediaId = `demo-media-${Math.random().toString(36).slice(2, 10)}`;

        return json({
          mediaId,
          path: `demo/${mediaId}`,
          token: "demo-token",
          mimeType:
            typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream",
          maxBytes: 15 * 1024 * 1024,
        });
      }

      if (method === "DELETE" && tail[0]) {
        const result = deleteDemoNoteMedia(lectureId, tail[0]);
        return result ? json(result) : json({ error: "Ni najdeno." }, 404);
      }

      const body = await readJsonBody(init, input);
      const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
      const result = addDemoNoteMedia({
        lectureId,
        mediaId: typeof body.mediaId === "string" ? body.mediaId : `demo-media-${Date.now()}`,
        mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/jpeg",
        byteSize: typeof body.byteSize === "number" ? body.byteSize : 0,
        originalFileName:
          typeof body.originalFileName === "string" ? body.originalFileName : null,
        previewUrl: uploadedBlobUrls.get(storagePath) ?? "",
        afterBlockId: typeof body.afterBlockId === "string" ? body.afterBlockId : "",
      });

      return result ? json(result) : json({ error: "Ni najdeno." }, 404);
    }

    case "flashcards": {
      const body = await readJsonBody(init, input);
      const flashcard = upsertDemoFlashcard({
        lectureId,
        front: String(body.front ?? ""),
        back: String(body.back ?? ""),
        hint: typeof body.hint === "string" ? body.hint : null,
        difficulty: (body.difficulty as "easy" | "medium" | "hard") ?? "medium",
      });

      return flashcard ? json({ flashcard }) : json({ error: "Ni najdeno." }, 404);
    }

    case "practice-test": {
      if (tail[0] === "attempt" && tail.length === 1) {
        const attempt = startDemoPracticeAttempt(lectureId);

        if (!attempt) {
          return json({ error: "Ni najdeno." }, 404);
        }

        await waitForDetailRefreshWindow();
        return json({
          id: attempt.id,
          questions: attempt.answers.map((answer) => answer.question),
        });
      }

      if (tail[0] === "attempt" && tail[2] === "submit") {
        const body = await readJsonBody(init, input);
        submitDemoPracticeAttempt({
          lectureId,
          attemptId: tail[1],
          answers: Array.isArray(body.answers)
            ? (body.answers as Array<{
                answerId: string;
                typedAnswer: string;
                declaredUnknown: boolean;
              }>)
            : [],
        });

        await waitForDetailRefreshWindow();
        return json({ ok: true });
      }

      return json({ ok: true });
    }

    case "tts": {
      if (tail[0] === "status") {
        return json(ttsStatus(lectureId));
      }

      if (tail[0] === "chunks") {
        const body = await readJsonBody(init, input);
        const chunkIndex = typeof body.chunkIndex === "number" ? body.chunkIndex : 0;
        return ttsChunk(lectureId, chunkIndex);
      }

      return json({ ok: true });
    }

    default:
      return json({ ok: true });
  }
}

async function handleQuizQuestionRoute(
  lectureId: string,
  segments: string[],
  method: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  const questionId = segments[0];

  if (method === "DELETE" && questionId) {
    deleteDemoQuizQuestion(lectureId, questionId);
    return json({ deletedQuestionId: questionId });
  }

  const body = await readJsonBody(init, input);
  const question = upsertDemoQuizQuestion({
    lectureId,
    questionId,
    prompt: String(body.prompt ?? ""),
    options: Array.isArray(body.options) ? (body.options as string[]) : [],
    correctOptionIndex:
      typeof body.correctOptionIndex === "number" ? body.correctOptionIndex : 0,
    explanation: String(body.explanation ?? ""),
    difficulty: (body.difficulty as "easy" | "medium" | "hard") ?? "medium",
  });

  return question ? json({ question }) : json({ error: "Ni najdeno." }, 404);
}

async function handleFolderRoute(
  segments: string[],
  method: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  const folderId = segments[0];
  const body = await readJsonBody(init, input);

  if (!folderId) {
    if (method === "GET") {
      return json({ folders: getDemoFolders() });
    }

    if (method === "POST") {
      const folder = createDemoFolder(String(body.name ?? "Nova mapa"));
      const withLectures = updateDemoFolder({
        folderId: folder.id,
        lectureIds: Array.isArray(body.lectureIds) ? (body.lectureIds as string[]) : [],
      });

      return json({ folder: withLectures ?? folder }, 201);
    }

    if (method === "PUT") {
      const incoming = Array.isArray(body.folders)
        ? (body.folders as Array<{ name: string; lectureIds?: string[] }>)
        : [];

      for (const folder of incoming) {
        const created = createDemoFolder(folder.name);
        updateDemoFolder({ folderId: created.id, lectureIds: folder.lectureIds ?? [] });
      }

      return json({ folders: getDemoFolders() });
    }
  }

  if (method === "DELETE") {
    deleteDemoFolder(folderId);
    return json({ ok: true });
  }

  if (method === "PATCH") {
    const folder = updateDemoFolder({
      folderId,
      name: typeof body.name === "string" ? body.name : undefined,
      lectureIds: Array.isArray(body.lectureIds) ? (body.lectureIds as string[]) : undefined,
    });

    return folder ? json({ folder }) : json({ error: "Ni najdeno." }, 404);
  }

  return json({ ok: true });
}

async function handleDemoRequest(
  pathname: string,
  method: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  const segments = pathname.split("/").filter(Boolean).slice(1);
  const [group, ...rest] = segments;

  switch (group) {
    case "lectures":
      return handleLectureRoute(rest, method, input, init);

    case "flashcards": {
      const [flashcardId, action] = rest;

      if (action === "progress") {
        const body = await readJsonBody(init, input);
        const progress = setDemoFlashcardProgress({
          flashcardId,
          confidenceBucket: (body.confidenceBucket as "again" | "good" | "easy") ?? "good",
        });

        return json({ progress });
      }

      if (method === "DELETE") {
        const state = getCreatorDemoState();
        const lectureId = state.order.find((id) =>
          state.details[id]?.flashcards.some((card) => card.id === flashcardId),
        );

        if (lectureId) {
          deleteDemoFlashcard(lectureId, flashcardId);
        }

        return json({ deletedFlashcardId: flashcardId });
      }

      const state = getCreatorDemoState();
      const lectureId = state.order.find((id) =>
        state.details[id]?.flashcards.some((card) => card.id === flashcardId),
      );
      const body = await readJsonBody(init, input);
      const flashcard = lectureId
        ? upsertDemoFlashcard({
            lectureId,
            flashcardId,
            front: String(body.front ?? ""),
            back: String(body.back ?? ""),
            hint: typeof body.hint === "string" ? body.hint : null,
            difficulty: (body.difficulty as "easy" | "medium" | "hard") ?? "medium",
          })
        : null;

      return flashcard ? json({ flashcard }) : json({ error: "Ni najdeno." }, 404);
    }

    case "library-folders":
      return handleFolderRoute(rest, method, input, init);

    default:
      return json({ ok: true });
  }
}

/**
 * Wraps the real fetch. Only `/api/*` and the signed-upload endpoint are
 * answered locally; everything else (RSC payloads, analytics) passes through.
 */
export function createCreatorDemoFetch(originalFetch: typeof fetch): typeof fetch {
  return async function creatorDemoFetch(input, init) {
    let url: URL;

    try {
      url = getUrl(input);
    } catch {
      return originalFetch(input, init);
    }

    if (url.pathname.includes(SUPABASE_SIGNED_UPLOAD_MARKER)) {
      // Bucket-qualified path in the URL; the store keys media by object path.
      const storagePath = url.pathname.split(SUPABASE_SIGNED_UPLOAD_MARKER)[1] ?? "";
      const objectPath = decodeURIComponent(storagePath.split("/").slice(1).join("/"));
      const blob = extractUploadBlob(input, init);

      if (blob) {
        uploadedBlobUrls.set(objectPath, URL.createObjectURL(blob));
      }

      return json({ Key: objectPath });
    }

    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    try {
      return await handleDemoRequest(url.pathname, getMethod(input, init), input, init);
    } catch {
      return json({ ok: true });
    }
  } as typeof fetch;
}
