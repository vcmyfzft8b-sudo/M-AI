import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createVerify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { SonioxNodeClient } from "@soniox/node";

type HttpMethod = "GET" | "POST" | "DELETE" | "PATCH" | "OPTIONS";

type MobileUser = {
  id: string;
  email?: string | null;
};

type MobileEnv = {
  supabaseURL: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  allowedProductIDs: Set<string>;
  bundleID?: string;
  appAppleID?: number;
  geminiAPIKey?: string;
  geminiTextModel: string;
  sonioxAPIKey?: string;
  sonioxModel: string;
  sonioxTTSModel: string;
  appStoreNotificationToken?: string;
  appStoreJWSVerificationMode: "strict" | "decode-only";
  appleRootCertificates: X509Certificate[];
};

type LectureRow = {
  id: string;
  user_id: string;
  title: string | null;
  source_type: string;
  storage_path: string | null;
  access_tier?: "paid" | "trial" | null;
  duration_seconds: number | null;
  status: string;
  language_hint: string | null;
  error_message: string | null;
  processing_metadata?: unknown;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  trial_lecture_id?: string | null;
  trial_consumed_at?: string | null;
};

type BillingSubscriptionRow = {
  id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

type AppStoreEntitlementRow = {
  id: string;
  product_id: string;
  transaction_id: string;
  original_transaction_id: string;
  environment: "sandbox" | "production";
  status: "active" | "expired" | "revoked" | "pending_verification";
  purchased_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

type LectureArtifactRow = {
  lecture_id: string;
  summary: string;
  key_topics: string[];
  structured_notes_md: string;
  editable_notes_md?: string | null;
  editable_notes_doc?: unknown;
  editable_notes_revision?: number | null;
  editable_notes_updated_at?: string | null;
  generated_at: string;
};

type NoteAnnotation = {
  id: string;
  kind: "highlight" | "underline";
  startWordIndex: number;
  endWordIndex: number;
  colorId?: string;
  createdAt: string;
};

type NoteMediaBlock = {
  id: string;
  mediaId: string;
  afterBlockId: string;
  widthPercent?: number;
  xPercent?: number;
  createdAt: string;
};

type EditableNoteDoc = {
  version: 1;
  baseNotesHash: string;
  updatedAt: string;
  annotations: NoteAnnotation[];
  mediaBlocks: NoteMediaBlock[];
};

type NoteMediaRow = {
  id: string;
  lecture_id: string;
  user_id: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  original_file_name: string | null;
  created_at: string;
};

type FlashcardRow = {
  id: string;
  lecture_id: string;
  idx: number;
  front: string;
  back: string;
  hint: string | null;
  difficulty: string;
  source_locator: string | null;
  progress?: FlashcardProgressRow | null;
};

type FlashcardProgressRow = {
  user_id: string;
  flashcard_id: string;
  confidence_bucket: "again" | "good" | "easy";
  review_count: number;
  last_reviewed_at: string | null;
};

type QuizQuestionRow = {
  id: string;
  lecture_id: string;
  idx: number;
  prompt: string;
  options_json: string[];
  correct_option_idx: number;
  explanation: string;
  difficulty: string;
  source_locator: string | null;
};

type StudyDifficulty = "easy" | "medium" | "hard";

type GeneratedFlashcard = {
  front: string;
  back: string;
  hint: string | null;
  difficulty: StudyDifficulty;
  sourceLocator: string | null;
  sourceUnitIndex: number;
  conceptKey: string;
};

type GeneratedQuizQuestion = {
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  difficulty: StudyDifficulty;
  sourceLocator: string | null;
};

type GeneratedPracticeQuestion = {
  prompt: string;
  answerGuide: string;
  difficulty: StudyDifficulty;
  sourceLocator: string | null;
  sourceUnitIndex: number | null;
  conceptKey: string | null;
};

type PracticeTestAttemptRow = {
  id: string;
  lecture_id: string;
  user_id: string;
  status: "in_progress" | "submitted" | "graded" | "failed";
  question_count: number;
  total_score: number | null;
  max_score: number | null;
  percentage: number | null;
  graded_at: string | null;
  model_metadata: unknown;
  created_at: string;
  updated_at: string;
};

type MobileStudyAssetRow = {
  lecture_id: string;
  status: "queued" | "generating" | "ready" | "failed";
  error_message: string | null;
  generated_at: string;
  updated_at: string;
};

type MobileStudySessionRow = {
  user_id: string;
  lecture_id: string;
  active_study_view: "notes" | "flashcards" | "quiz" | "practice_test";
  flashcard_state: unknown | null;
  quiz_state: unknown | null;
  practice_test_state: unknown | null;
  created_at: string;
  updated_at: string;
};

type MobileTTSChunkRow = {
  lecture_id: string;
  content_hash: string;
  chunk_index: number;
  text: string;
  word_start_index: number;
  word_end_index: number;
  language: string;
  voice: string;
  model: string;
  audio_storage_path: string;
  audio_mime_type: string;
  duration_ms: number;
  alignment_json: unknown;
};

type PracticeTestAttemptAnswerRow = {
  id: string;
  attempt_id: string;
  practice_test_question_id: string | null;
  idx: number;
  question_prompt: string | null;
  answer_guide_snapshot: string | null;
  difficulty_snapshot: string | null;
  source_locator_snapshot: string | null;
  typed_answer: string | null;
  photo_path: string | null;
  photo_mime_type: string | null;
  declared_unknown: boolean;
  score: number | null;
  grading_rationale: string | null;
  strengths: string | null;
  missing_points: string | null;
  expected_answer: string | null;
  grading_confidence: string | null;
  created_at: string;
  updated_at: string;
};

type GeneratedStudyAssets = {
  summary: string;
  keyTopics: string[];
  notesMarkdown: string;
  flashcards: GeneratedFlashcard[];
  quizQuestions: GeneratedQuizQuestion[];
  practiceQuestions: GeneratedPracticeQuestion[];
};

type SignedUploadTarget = {
  path: string;
  token: string;
  signedUrl: string;
};

type EntitlementState = {
  profile: ProfileRow | null;
  subscriptions: BillingSubscriptionRow[];
  appStoreEntitlements: AppStoreEntitlementRow[];
  hasPaidAccess: boolean;
  canCreateNotes: boolean;
};

type StoreKitVerifyRequest = {
  productId?: unknown;
  transactionId?: unknown;
  originalTransactionId?: unknown;
  signedTransactionJWS?: unknown;
  environment?: unknown;
};

type AppStoreNotificationRequest = {
  signedPayload?: unknown;
};

type ScanUploadFile = {
  index?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  size?: unknown;
};

type DecodedStoreKitPayload = {
  appAppleId?: number;
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  environment?: string;
  [key: string]: unknown;
};

type DecodedJWSHeader = {
  alg?: string;
  x5c?: unknown;
  kid?: string;
  typ?: string;
};

type DecodedAppStoreNotificationPayload = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  notificationVersion?: string;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    status?: number;
    [key: string]: unknown;
  };
  summary?: {
    requestIdentifier?: string;
    appAppleId?: number;
    bundleId?: string;
    environment?: string;
    status?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const STORAGE_BUCKET = "lecture-audio";
// Keep native creation limits identical to src/lib/constants.ts so a file is
// accepted or rejected consistently on mobile web and iOS.
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 3 * 60 * 60;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_SCAN_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SCAN_IMAGES = 10;
const INITIAL_AUDIO_VOICES = ["Grace", "Maya", "Emma", "Claire", "Nina", "Daniel", "Adrian", "Noah"];

function readInitialAudioOptions(body: Record<string, unknown>) {
  return {
    createInitialAudio: body.createInitialAudio === true,
    initialAudioVoice: readEnum(body.initialAudioVoice, INITIAL_AUDIO_VOICES, "Grace"),
  };
}
const MAX_INLINE_AI_SOURCE_BYTES = 18 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 60_000;
let sonioxClient: SonioxNodeClient | undefined;

function getSonioxClient(env: MobileEnv) {
  if (!env.sonioxAPIKey) {
    throw new HttpError(503, "Soniox transcription is not configured.", "transcription_not_configured");
  }
  sonioxClient ??= new SonioxNodeClient({ api_key: env.sonioxAPIKey });
  return sonioxClient;
}

export async function handleMobileRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    setBaseHeaders(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const method = normalizeMethod(req.method);
    const env = readEnv();
    const url = requestURL(req);
    const segments = mobileSegments(url);

    if (segments.length === 0 || segments[0] === "health") {
      json(res, 200, {
        ok: true,
        service: "memo-ios-mobile-backend",
      });
      return;
    }

    if (segments[0] === "storekit" && segments[1] === "notifications" && method === "POST") {
      await handleAppStoreNotification({ env, req, res, url });
      return;
    }

    const user = await authenticate(env, readBearerToken(req));

    if (segments[0] === "me" && method === "GET") {
      const entitlement = await fetchEntitlementState(env, user.id);
      json(res, 200, { user, ...entitlement });
      return;
    }

    if (segments[0] === "lectures") {
      await handleLectures({ env, method, req, res, segments, user });
      return;
    }

    if (segments[0] === "flashcards") {
      await handleFlashcards({ env, method, req, res, segments, user });
      return;
    }

    if (segments[0] === "storekit" && segments[1] === "verify" && method === "POST") {
      await handleStoreKitVerify({ env, req, res, user });
      return;
    }

    if (segments[0] === "account" && method === "DELETE") {
      await handleAccountDelete({ env, res, user });
      return;
    }

    throw new HttpError(404, "Unknown mobile API route.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const code = error instanceof HttpError ? error.code : undefined;
    json(res, status, { error: message, code });
  }
}

async function handleLectures(params: {
  env: MobileEnv;
  method: HttpMethod;
  req: IncomingMessage;
  res: ServerResponse;
  segments: string[];
  user: MobileUser;
}) {
  const { env, method, req, res, segments, user } = params;

  if (segments.length === 1 && method === "GET") {
    const [lectures, folders] = await Promise.all([
      listRows<LectureRow>(env, "lectures", {
        select:
          "id,user_id,title,source_type,access_tier,duration_seconds,status,language_hint,error_message,created_at,updated_at",
        user_id: `eq.${user.id}`,
        order: "updated_at.desc",
      }),
      listRows(env, "library_folders", {
        select: "id,name,created_at",
        user_id: `eq.${user.id}`,
        order: "created_at.desc",
      }),
    ]);
    json(res, 200, { lectures, folders });
    return;
  }

  if (segments.length === 2 && segments[1] === "manual" && method === "POST") {
    const body = await readJson(req, 8 * 1024);
    const sourceType = readEnum(body.sourceType, ["text", "pdf", "link", "scan", "audio"], "text");
    const languageHint = readString(body.languageHint, "sl") ?? "sl";
    const created = await createLectureDraft(env, user.id, sourceType, languageHint);
    json(res, 200, { lectureId: created.id });
    return;
  }

  if (segments.length === 2 && segments[1] === "text" && method === "POST") {
    const body = await readJson(req, 256 * 1024);
    const text = requiredString(body.text, "text").trim();
    const languageHint = readString(body.languageHint, "sl") ?? "sl";
    const lectureID = typeof body.lectureId === "string" && body.lectureId ? body.lectureId : null;
    const initialAudio = readInitialAudioOptions(body);
    const created = await createTextLecture(env, user.id, {
      lectureID,
      text,
      languageHint,
      ...initialAudio,
    });
    json(res, 200, { lectureId: created.id });
    return;
  }

  if (segments.length === 2 && segments[1] === "link" && method === "POST") {
    const body = await readJson(req, 16 * 1024);
    const url = requiredString(body.url, "url").trim();
    const languageHint = readString(body.languageHint, "sl") ?? "sl";
    const lectureID = typeof body.lectureId === "string" && body.lectureId ? body.lectureId : null;
    const initialAudio = readInitialAudioOptions(body);
    const created = await createLinkLecture(env, user.id, {
      lectureID,
      url,
      languageHint,
      ...initialAudio,
    });
    json(res, 200, { lectureId: created.id });
    return;
  }

  if (segments.length === 2 && segments[1] === "audio" && method === "POST") {
    const body = await readJson(req, 16 * 1024);
    const fileName = readString(body.fileName) ?? "recording.m4a";
    const mimeType = normalizeAudioMimeType(readString(body.mimeType) ?? "audio/mp4", fileName);
    const size = readPositiveNumber(
      body.size,
      "size",
      MAX_AUDIO_BYTES,
      "Zvočna datoteka je prevelika. Trenutna omejitev je 300 MB.",
    );
    const durationSeconds = readPositiveNumber(
      body.durationSeconds,
      "durationSeconds",
      MAX_AUDIO_SECONDS,
      "Zvočna datoteka je predolga. Omejitev je 3 ure.",
    );
    const languageHint = readString(body.languageHint, "sl") ?? "sl";
    const initialAudio = readInitialAudioOptions(body);
    const created = await createUploadLecture(env, user.id, {
      sourceType: "audio",
      languageHint,
      durationSeconds,
      metadata: {
        ...initialAudio,
        mobileUpload: {
          mode: "audio",
          fileName,
          mimeType,
          size,
          durationSeconds,
          preparedAt: new Date().toISOString(),
        },
      },
    });
    const path = buildAudioStoragePath(user.id, created.id, mimeType, fileName);
    const upload = await createSignedUpload(env, STORAGE_BUCKET, path);
    json(res, 200, { lectureId: created.id, ...upload });
    return;
  }

  if (segments.length === 2 && segments[1] === "document" && method === "POST") {
    const body = await readJson(req, 16 * 1024);
    const fileName = readString(body.fileName) ?? "document.pdf";
    const mimeType = normalizeDocumentMimeType(readString(body.mimeType) ?? "application/octet-stream", fileName);
    const size = readPositiveNumber(
      body.size,
      "size",
      MAX_DOCUMENT_BYTES,
      "Datoteka dokumenta je prevelika. Trenutna omejitev je 4 MB.",
    );
    const languageHint = readString(body.languageHint, "sl") ?? "sl";
    const initialAudio = readInitialAudioOptions(body);
    const created = await createUploadLecture(env, user.id, {
      sourceType: documentSourceType(fileName, mimeType),
      languageHint,
      metadata: {
        ...initialAudio,
        mobileUpload: {
          mode: "document",
          fileName,
          mimeType,
          size,
          preparedAt: new Date().toISOString(),
        },
      },
    });
    const path = buildDocumentStoragePath(user.id, created.id, fileName, mimeType);
    const upload = await createSignedUpload(env, STORAGE_BUCKET, path);
    json(res, 200, { lectureId: created.id, ...upload });
    return;
  }

  if (segments.length === 2 && segments[1] === "scan" && method === "POST") {
    const body = await readJson(req, 32 * 1024);
    const files = Array.isArray(body.files) ? (body.files as ScanUploadFile[]) : [];
    if (files.length < 1 || files.length > MAX_SCAN_IMAGES) {
      throw new HttpError(400, "Select between 1 and 10 scan images.");
    }
    const languageHint = readString(body.languageHint, "sl") ?? "sl";
    const initialAudio = readInitialAudioOptions(body);
    const created = await createUploadLecture(env, user.id, {
      sourceType: "scan",
      languageHint,
      metadata: {
        ...initialAudio,
        mobileUpload: {
          mode: "scan",
          imageCount: files.length,
          preparedAt: new Date().toISOString(),
        },
      },
    });
    const uploads: Array<SignedUploadTarget & { index: number; mimeType: string; fileName: string; size: number }> = [];
    const indexes = new Set<number>();
    for (let position = 0; position < files.length; position += 1) {
      const file = files[position] ?? {};
      const index = typeof file.index === "number" && Number.isInteger(file.index) ? file.index : position;
      if (indexes.has(index)) {
        throw new HttpError(400, "Duplicate scan image index.");
      }
      indexes.add(index);
      const fileName = readString(file.fileName) ?? `scan-${index + 1}.jpg`;
      const mimeType = normalizeImageMimeType(readString(file.mimeType) ?? "image/jpeg", fileName);
      const size = readPositiveNumber(
        file.size,
        "size",
        MAX_SCAN_IMAGE_BYTES,
        "Slika je tudi po stiskanju prevelika. Omejitev je 10 MB.",
      );
      const path = buildScanStoragePath(user.id, created.id, index, mimeType, fileName);
      uploads.push({
        index,
        fileName,
        mimeType,
        size,
        ...(await createSignedUpload(env, STORAGE_BUCKET, path)),
      });
    }
    json(res, 200, { lectureId: created.id, uploads });
    return;
  }

  if (segments.length === 2 && isUUID(segments[1]) && method === "GET") {
    await continueNativeLectureProcessing(env, user.id, segments[1]);
    const detail = await fetchLectureDetail(env, user.id, segments[1]);
    json(res, 200, detail);
    return;
  }

  if (segments.length === 2 && isUUID(segments[1]) && method === "DELETE") {
    const deleted = await deleteLectures(env, user.id, [segments[1]]);
    json(res, 200, { ok: true, deletedCount: deleted });
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "chat" && method === "POST") {
    const body = await readJson(req, 16 * 1024);
    const question = requiredString(body.question, "question").trim();
    const answer = await createGroundedChatReply(env, user.id, segments[1], question);
    json(res, 200, { answer });
    return;
  }

  if (segments.length === 4 && isUUID(segments[1]) && segments[2] === "tts" && segments[3] === "status" && method === "GET") {
    json(res, 200, await getNativeTTSStatus(env, user, segments[1]));
    return;
  }

  if (segments.length === 4 && isUUID(segments[1]) && segments[2] === "tts" && segments[3] === "chunks" && method === "POST") {
    const body = await readJson(req, 16 * 1024);
    json(res, 200, await getOrCreateNativeTTSChunk(env, user, segments[1], body));
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "study-session" && method === "PATCH") {
    await requireOwnedLecture(env, user.id, segments[1]);
    const body = await readJson(req, 256 * 1024);
    const activeStudyView = readEnum(body.activeStudyView, ["notes", "flashcards", "quiz", "practice_test"], "notes");
    const rows = await postgrest<MobileStudySessionRow[]>(
      env,
      "/rest/v1/lecture_study_sessions?on_conflict=user_id,lecture_id&select=user_id,lecture_id,active_study_view,flashcard_state,quiz_state,practice_test_state,created_at,updated_at",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          user_id: user.id,
          lecture_id: segments[1],
          active_study_view: activeStudyView,
          flashcard_state: body.flashcardState ?? null,
          quiz_state: body.quizState ?? null,
          practice_test_state: body.practiceTestState ?? null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    json(res, 200, { ok: true, studySession: rows[0] ?? null });
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "generate-study" && method === "POST") {
    const detail = await generateStudyAssetsForLecture(env, user.id, segments[1]);
    json(res, 200, detail);
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "retry" && method === "POST") {
    await retryMobileLecture(env, user.id, segments[1]);
    json(res, 200, { ok: true, lectureId: segments[1] });
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "flashcards" && method === "POST") {
    const body = await readJson(req, 32 * 1024);
    const flashcard = await createFlashcard(env, user.id, segments[1], body);
    json(res, 200, { flashcard });
    return;
  }

  if (
    segments.length === 4 &&
    isUUID(segments[1]) &&
    segments[2] === "quiz" &&
    segments[3] === "questions" &&
    method === "POST"
  ) {
    const body = await readJson(req, 32 * 1024);
    const question = await createQuizQuestion(env, user.id, segments[1], body);
    json(res, 200, { question });
    return;
  }

  if (
    segments.length === 5 &&
    isUUID(segments[1]) &&
    segments[2] === "quiz" &&
    segments[3] === "questions" &&
    isUUID(segments[4]) &&
    (method === "PATCH" || method === "DELETE")
  ) {
    if (method === "DELETE") {
      await deleteQuizQuestion(env, user.id, segments[1], segments[4]);
      json(res, 200, { deletedQuestionId: segments[4] });
    } else {
      const body = await readJson(req, 32 * 1024);
      const question = await updateQuizQuestion(env, user.id, segments[1], segments[4], body);
      json(res, 200, { question });
    }
    return;
  }

  if (
    segments.length === 4 &&
    isUUID(segments[1]) &&
    segments[2] === "practice-test" &&
    segments[3] === "attempt" &&
    method === "POST"
  ) {
    const attempt = await createMobilePracticeAttempt(env, user.id, segments[1]);
    json(res, 200, attempt);
    return;
  }

  if (
    segments.length === 6 &&
    isUUID(segments[1]) &&
    segments[2] === "practice-test" &&
    segments[3] === "attempt" &&
    isUUID(segments[4]) &&
    segments[5] === "submit" &&
    method === "POST"
  ) {
    const body = await readJson(req, 256 * 1024);
    const result = await submitMobilePracticeAttempt(env, user.id, segments[1], segments[4], body);
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "notes" && method === "PATCH") {
    const body = await readJson(req, 256 * 1024);
    const notesMarkdown = requiredString(body.notesMarkdown, "notesMarkdown").trim();
    if (!notesMarkdown) {
      throw new HttpError(400, "Notes cannot be empty.");
    }
    const detail = await updateEditableNotes(env, user.id, segments[1], notesMarkdown);
    json(res, 200, detail);
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "notes-doc" && method === "PATCH") {
    const body = await readJson(req, 256 * 1024);
    await requireNoteEditingAccess(env, user.id, segments[1]);
    const expectedRevision = readNonNegativeInteger(body.expectedRevision, "expectedRevision");
    const artifact = await readArtifactForNoteDoc(env, segments[1]);
    if (!artifact) throw new HttpError(409, "Notes are not ready yet.");
    const doc = readMobileNoteDocInput(body.doc, artifact);
    const updated = await updateMobileNoteDoc(env, segments[1], expectedRevision, doc);
    if (!updated) {
      throw new HttpError(409, "The notes changed. Refresh and try again.");
    }
    json(res, 200, {
      doc: parseMobileNoteDoc(updated),
      revision: updated.editable_notes_revision ?? expectedRevision + 1,
    });
    return;
  }

  if (
    segments.length === 4 &&
    isUUID(segments[1]) &&
    segments[2] === "note-media" &&
    segments[3] === "uploads" &&
    method === "POST"
  ) {
    const body = await readJson(req, 16 * 1024);
    const upload = await prepareNoteMediaUpload(env, user.id, segments[1], body);
    json(res, 200, upload);
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "note-media" && method === "POST") {
    const body = await readJson(req, 32 * 1024);
    const result = await finalizeNoteMediaUpload(env, user.id, segments[1], body);
    json(res, 200, result);
    return;
  }

  if (
    segments.length === 4 &&
    isUUID(segments[1]) &&
    segments[2] === "note-media" &&
    isUUID(segments[3]) &&
    method === "DELETE"
  ) {
    const result = await deleteNoteMedia(env, user.id, segments[1], segments[3]);
    json(res, 200, result);
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "finalize" && method === "POST") {
    const body = await readJson(req, 64 * 1024);
    await finalizeMobileUpload(env, user.id, segments[1], body);
    json(res, 200, { ok: true, lectureId: segments[1] });
    return;
  }

  throw new HttpError(404, "Unknown lectures route.");
}

async function handleFlashcards(params: {
  env: MobileEnv;
  method: HttpMethod;
  req: IncomingMessage;
  res: ServerResponse;
  segments: string[];
  user: MobileUser;
}) {
  const { env, method, req, res, segments, user } = params;

  if (segments.length === 2 && isUUID(segments[1]) && (method === "PATCH" || method === "DELETE")) {
    if (method === "DELETE") {
      await deleteFlashcard(env, user.id, segments[1]);
      json(res, 200, { deletedFlashcardId: segments[1] });
    } else {
      const body = await readJson(req, 32 * 1024);
      const flashcard = await updateFlashcard(env, user.id, segments[1], body);
      json(res, 200, { flashcard });
    }
    return;
  }

  if (segments.length === 3 && isUUID(segments[1]) && segments[2] === "progress" && method === "POST") {
    const body = await readJson(req, 4 * 1024);
    const confidenceBucket = readEnum(body.confidenceBucket, ["again", "good", "easy"], "");
    if (!confidenceBucket) {
      throw new HttpError(400, "Missing or invalid field: confidenceBucket.");
    }
    const progress = await saveFlashcardProgress(
      env,
      user.id,
      segments[1],
      confidenceBucket as FlashcardProgressRow["confidence_bucket"],
    );
    json(res, 200, { progress });
    return;
  }

  throw new HttpError(404, "Unknown flashcards route.");
}

async function handleStoreKitVerify(params: {
  env: MobileEnv;
  req: IncomingMessage;
  res: ServerResponse;
  user: MobileUser;
}) {
  const body = (await readJson(params.req, 64 * 1024)) as StoreKitVerifyRequest;
  const productId = requiredString(body.productId, "productId");
  const transactionId = requiredString(body.transactionId, "transactionId");
  const originalTransactionId = requiredString(body.originalTransactionId, "originalTransactionId");
  const signedTransactionJWS = requiredString(body.signedTransactionJWS, "signedTransactionJWS");

  if (params.env.allowedProductIDs.size > 0 && !params.env.allowedProductIDs.has(productId)) {
    throw new HttpError(400, "Unknown StoreKit product id.", "unknown_product");
  }

  const decoded = verifyAndDecodeStoreKitPayload(params.env, signedTransactionJWS);
  assertPayloadMatches({
    payload: decoded,
    productId,
    transactionId,
    originalTransactionId,
    bundleID: params.env.bundleID,
  });

  const rows = await upsertAppStoreEntitlement(
    params.env,
    params.user.id,
    signedTransactionJWS,
    decoded,
    { environment: body.environment },
  );

  json(params.res, 200, {
    ok: true,
    entitlement: rows[0] ?? null,
  });
}

async function handleAppStoreNotification(params: {
  env: MobileEnv;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
}) {
  assertAppStoreNotificationToken(params.env, params.req, params.url);
  const body = (await readJson(params.req, 256 * 1024)) as AppStoreNotificationRequest;
  const signedPayload = requiredString(body.signedPayload, "signedPayload");
  const notification = verifyAndDecodeAppStoreNotificationPayload(params.env, signedPayload);

  if (params.env.bundleID) {
    const bundleID = notification.data?.bundleId ?? notification.summary?.bundleId;
    if (bundleID && bundleID !== params.env.bundleID) {
      throw new HttpError(400, "App Store notification bundle id does not match this app.", "bundle_mismatch");
    }
  }
  if (params.env.appAppleID) {
    const appAppleID = notification.data?.appAppleId ?? notification.summary?.appAppleId;
    if (appAppleID && appAppleID !== params.env.appAppleID) {
      throw new HttpError(400, "App Store notification app id does not match this app.", "app_id_mismatch");
    }
  }

  const signedTransactionInfo = readString(notification.data?.signedTransactionInfo);
  const signedRenewalInfo = readString(notification.data?.signedRenewalInfo);
  const transaction = signedTransactionInfo
    ? verifyAndDecodeStoreKitPayload(params.env, signedTransactionInfo)
    : null;
  if (signedRenewalInfo) {
    verifyAndDecodeAppStoreJWS<Record<string, unknown>>(params.env, signedRenewalInfo, "App Store renewal info");
  }
  const productID = transaction?.productId;
  const originalTransactionID = transaction?.originalTransactionId;

  if (productID && params.env.allowedProductIDs.size > 0 && !params.env.allowedProductIDs.has(productID)) {
    throw new HttpError(400, "Unknown StoreKit product id.", "unknown_product");
  }

  const entitlementOwner = originalTransactionID && productID
    ? await findAppStoreEntitlementOwner(params.env, originalTransactionID, productID)
    : null;
  const statusOverride = notificationEntitlementStatus(notification.notificationType, transaction);
  let entitlement: AppStoreEntitlementRow | null = null;

  if (entitlementOwner && signedTransactionInfo && transaction) {
    const rows = await upsertAppStoreEntitlement(
      params.env,
      entitlementOwner.user_id,
      signedTransactionInfo,
      transaction,
      {
        environment: notification.data?.environment ?? notification.summary?.environment,
        statusOverride,
        rawNotification: {
          notificationType: notification.notificationType,
          subtype: notification.subtype,
          notificationUUID: notification.notificationUUID,
          notificationVersion: notification.notificationVersion,
        },
      },
    );
    entitlement = rows[0] ?? null;
  }

  await recordAppStoreNotification(params.env, {
    signedPayload,
    notification,
    transaction,
    userID: entitlementOwner?.user_id ?? null,
    processedStatus: entitlement ? "processed" : "recorded_unmatched",
  }).catch(ignoreMissingTable);

  json(params.res, 200, {
    ok: true,
    notificationType: notification.notificationType ?? null,
    processed: Boolean(entitlement),
    entitlement,
  });
}

async function handleAccountDelete(params: {
  env: MobileEnv;
  res: ServerResponse;
  user: MobileUser;
}) {
  const lectureRows = await listRows<LectureRow>(params.env, "lectures", {
    select: "id,storage_path,processing_metadata",
    user_id: `eq.${params.user.id}`,
  });
  const lectureIDs = lectureRows.map((row) => row.id);

  const noteMediaRows =
    lectureIDs.length > 0
      ? await listRows<{ storage_path: string | null }>(params.env, "lecture_note_media", {
          select: "storage_path",
          user_id: `eq.${params.user.id}`,
          lecture_id: `in.(${lectureIDs.join(",")})`,
        }).catch((error) => {
          if (isMissingTableError(error)) {
            return [];
          }
          throw error;
        })
      : [];

  const storagePaths = collectStoragePaths(lectureRows, noteMediaRows);
  if (storagePaths.length > 0) {
    await removeStorageObjects(params.env, "lecture-audio", storagePaths);
  }

  // Referenced paths alone are not enough for Apple 5.1.1(v): an upload whose
  // finalize never ran leaves bytes in the bucket while its lecture row still
  // has a null storage_path, so those objects would outlive the account. Sweep
  // everything under the user's own prefix as well.
  await removeStorageObjectsUnderPrefix(params.env, "lecture-audio", params.user.id);

  await Promise.all([
    deleteByUser(params.env, "mobile_app_store_entitlements", params.user.id).catch(ignoreMissingTable),
    deleteByUser(params.env, "billing_subscriptions", params.user.id),
    deleteByUser(params.env, "lectures", params.user.id),
    deleteByID(params.env, "profiles", params.user.id),
  ]);

  await supabaseAuthAdminDelete(params.env, params.user.id);

  json(params.res, 200, {
    ok: true,
    deletedLectureCount: lectureIDs.length,
  });
}

async function upsertAppStoreEntitlement(
  env: MobileEnv,
  userID: string,
  signedTransactionJWS: string,
  decoded: DecodedStoreKitPayload,
  options: {
    environment?: unknown;
    statusOverride?: "active" | "expired" | "revoked" | "pending_verification";
    rawNotification?: Record<string, unknown>;
  } = {},
) {
  const productId = requiredString(decoded.productId, "productId");
  const transactionId = requiredString(decoded.transactionId, "transactionId");
  const originalTransactionId = requiredString(decoded.originalTransactionId, "originalTransactionId");

  if (env.allowedProductIDs.size > 0 && !env.allowedProductIDs.has(productId)) {
    throw new HttpError(400, "Unknown StoreKit product id.", "unknown_product");
  }
  if (env.bundleID && decoded.bundleId && decoded.bundleId !== env.bundleID) {
    throw new HttpError(400, "StoreKit bundle id does not match this app.", "bundle_mismatch");
  }
  if (env.appAppleID && decoded.appAppleId && decoded.appAppleId !== env.appAppleID) {
    throw new HttpError(400, "StoreKit app id does not match this app.", "app_id_mismatch");
  }

  const revokedAt = dateFromAppleMillis(decoded.revocationDate);
  const expiresAt = dateFromAppleMillis(decoded.expiresDate);
  const purchasedAt = dateFromAppleMillis(decoded.purchaseDate);
  const environment = normalizeStoreKitEnvironment(decoded.environment ?? options.environment);
  const status =
    options.statusOverride ??
    (revokedAt != null
      ? "revoked"
      : expiresAt != null && Date.parse(expiresAt) <= Date.now()
        ? "expired"
        : "active");

  return postgrest<AppStoreEntitlementRow[]>(
    env,
    "/rest/v1/mobile_app_store_entitlements?on_conflict=original_transaction_id,product_id&select=id,product_id,transaction_id,original_transaction_id,environment,status,purchased_at,expires_at,revoked_at",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        user_id: userID,
        product_id: productId,
        transaction_id: transactionId,
        original_transaction_id: originalTransactionId,
        environment,
        status,
        purchased_at: purchasedAt,
        expires_at: expiresAt,
        revoked_at: revokedAt,
        signed_transaction_jws: signedTransactionJWS,
        raw_payload: {
          transaction: decoded,
          notification: options.rawNotification ?? null,
        },
      }),
    },
  );
}

async function findAppStoreEntitlementOwner(
  env: MobileEnv,
  originalTransactionID: string,
  productID: string,
) {
  const rows = await listRows<{ user_id: string }>(env, "mobile_app_store_entitlements", {
    select: "user_id",
    original_transaction_id: `eq.${originalTransactionID}`,
    product_id: `eq.${productID}`,
    limit: "1",
  }).catch((error) => {
    if (isMissingTableError(error)) {
      return [];
    }
    throw error;
  });
  return rows[0] ?? null;
}

async function recordAppStoreNotification(
  env: MobileEnv,
  params: {
    signedPayload: string;
    notification: DecodedAppStoreNotificationPayload;
    transaction: DecodedStoreKitPayload | null;
    userID: string | null;
    processedStatus: string;
  },
) {
  await postgrest(env, "/rest/v1/mobile_app_store_notifications?on_conflict=notification_uuid", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      notification_uuid: params.notification.notificationUUID ?? crypto.randomUUID(),
      notification_type: params.notification.notificationType ?? "UNKNOWN",
      subtype: params.notification.subtype ?? null,
      environment: normalizeStoreKitEnvironment(
        params.notification.data?.environment ?? params.notification.summary?.environment,
      ),
      user_id: params.userID,
      product_id: params.transaction?.productId ?? null,
      transaction_id: params.transaction?.transactionId ?? null,
      original_transaction_id: params.transaction?.originalTransactionId ?? null,
      processed_status: params.processedStatus,
      signed_payload_jws: params.signedPayload,
      raw_payload: params.notification,
    }),
  });
}

async function fetchEntitlementState(env: MobileEnv, userID: string): Promise<EntitlementState> {
  const [profiles, subscriptions, appStoreEntitlements] = await Promise.all([
    listRows<ProfileRow>(env, "profiles", {
      select: "id,email,full_name,trial_lecture_id,trial_consumed_at",
      id: `eq.${userID}`,
      limit: "1",
    }),
    listRows<BillingSubscriptionRow>(env, "billing_subscriptions", {
      select: "id,plan,status,current_period_end,cancel_at_period_end",
      user_id: `eq.${userID}`,
      order: "updated_at.desc",
    }),
    listRows<AppStoreEntitlementRow>(env, "mobile_app_store_entitlements", {
      select:
        "id,product_id,transaction_id,original_transaction_id,environment,status,purchased_at,expires_at,revoked_at",
      user_id: `eq.${userID}`,
      order: "updated_at.desc",
    }).catch((error) => {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }),
  ]);

  const now = Date.now();
  const hasStripeAccess = subscriptions.some((subscription) =>
    ["active", "trialing", "past_due"].includes(subscription.status),
  );
  const hasAppleAccess = appStoreEntitlements.some((entitlement) => {
    if (entitlement.status !== "active" || entitlement.revoked_at) {
      return false;
    }
    return !entitlement.expires_at || Date.parse(entitlement.expires_at) > now;
  });
  const profile = profiles[0] ?? null;
  const hasPaidAccess = hasStripeAccess || hasAppleAccess;

  return {
    profile,
    subscriptions,
    appStoreEntitlements,
    hasPaidAccess,
    canCreateNotes: hasPaidAccess || !profile?.trial_consumed_at,
  };
}

async function createLectureDraft(
  env: MobileEnv,
  userID: string,
  sourceType: string,
  languageHint: string,
) {
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.canCreateNotes) {
    throw new HttpError(402, "The free trial has already been used.", "trial_exhausted");
  }

  const accessTier = entitlement.hasPaidAccess ? "paid" : "trial";
  const rows = await postgrest<Array<{ id: string }>>(env, "/rest/v1/lectures?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userID,
      source_type: sourceType,
      access_tier: accessTier,
      status: "uploading",
      language_hint: languageHint,
    }),
  });
  const created = rows[0];
  if (!created) {
    throw new HttpError(500, "Could not create a note.");
  }

  await claimTrialIfNeeded(env, userID, created.id, entitlement.hasPaidAccess);
  return created;
}

async function createUploadLecture(
  env: MobileEnv,
  userID: string,
  params: {
    sourceType: string;
    languageHint: string;
    durationSeconds?: number;
    metadata: Record<string, unknown>;
  },
) {
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.canCreateNotes) {
    throw new HttpError(402, "The free trial has already been used.", "trial_exhausted");
  }

  const rows = await postgrest<Array<{ id: string }>>(env, "/rest/v1/lectures?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userID,
      source_type: params.sourceType,
      access_tier: entitlement.hasPaidAccess ? "paid" : "trial",
      status: "uploading",
      language_hint: params.languageHint,
      duration_seconds: params.durationSeconds ? Math.round(params.durationSeconds) : null,
      processing_metadata: params.metadata,
    }),
  });
  const created = rows[0];
  if (!created) {
    throw new HttpError(500, "Could not create an upload note.");
  }
  await claimTrialIfNeeded(env, userID, created.id, entitlement.hasPaidAccess);
  return created;
}

async function finalizeMobileUpload(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  body: Record<string, unknown>,
) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  const sourceType = readEnum(
    body.sourceType,
    ["audio", "pdf", "document", "scan", "text", "presentation"],
    lecture.source_type,
  );
  const path = readString(body.path);
  const originalFileName = readString(body.originalFileName);
  const scanImages = Array.isArray(body.scanImages)
    ? body.scanImages
        .map((item) => (isRecord(item) ? item : null))
        .filter((item): item is Record<string, unknown> => item != null)
    : [];

  const metadata = isRecord(lecture.processing_metadata) ? lecture.processing_metadata : {};
  const mobileUpload = isRecord(metadata.mobileUpload) ? metadata.mobileUpload : {};
  const uploadedAt = new Date().toISOString();
  const pendingScanImages = scanImages.map((image, index) => {
    const imagePath = requiredString(image.path, `scanImages[${index}].path`);
    assertOwnedStoragePath(userID, lectureID, imagePath);
    return {
      index: typeof image.index === "number" ? image.index : index,
      path: imagePath,
      mimeType: readString(image.mimeType) ?? "image/jpeg",
      fileName: readString(image.fileName) ?? `scan-${index + 1}.jpg`,
      size: readPositiveNumber(
        image.size,
        `scanImages[${index}].size`,
        MAX_SCAN_IMAGE_BYTES,
        "Slika je tudi po stiskanju prevelika. Omejitev je 10 MB.",
      ),
    };
  });

  if (path) {
    assertOwnedStoragePath(userID, lectureID, path);
  }

  const title = originalFileName
    ? titleFromFileName(originalFileName)
    : sourceType === "audio"
      ? "Audio recording"
      : sourceType === "scan"
        ? "Scanned notes"
        : "Uploaded document";

  await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      title,
      source_type: sourceType === "document" ? "pdf" : sourceType,
      storage_path: path ?? lecture.storage_path,
      status: "queued",
      error_message: null,
      processing_metadata: {
        ...metadata,
        pendingScanImages: pendingScanImages.length > 0 ? pendingScanImages : undefined,
        pendingDocument:
          sourceType !== "audio" && sourceType !== "scan" && path
            ? {
                path,
                mimeType: readString(mobileUpload.mimeType) ?? "application/octet-stream",
                fileName: originalFileName ?? readString(mobileUpload.fileName) ?? "document",
                size: typeof mobileUpload.size === "number" ? mobileUpload.size : null,
              }
            : undefined,
        processing: {
          stage:
            sourceType === "audio"
              ? "transcribing"
              : sourceType === "scan"
                ? "extracting_scan_text"
                : "extracting_document_text",
          updatedAt: uploadedAt,
          errorMessage: null,
        },
        mobileUpload: {
          ...mobileUpload,
          finalizedAt: uploadedAt,
          sourceType,
          originalFileName,
          storagePath: path ?? null,
          scanImages: pendingScanImages,
        },
      },
    }),
  });

  await startNativeLectureProcessing(env, userID, lectureID);
}

async function retryMobileLecture(env: MobileEnv, userID: string, lectureID: string) {
  const lecture = await requireNoteEditingAccess(env, userID, lectureID);
  await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "queued", error_message: null }),
  });
  await startNativeLectureProcessing(env, userID, lectureID);
}

async function startNativeLectureProcessing(env: MobileEnv, userID: string, lectureID: string) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  if (lecture.source_type !== "audio") {
    await generateStudyAssetsForLecture(env, userID, lectureID);
    return;
  }

  const metadata = isRecord(lecture.processing_metadata) ? lecture.processing_metadata : {};
  const nativeProcessing = isRecord(metadata.nativeProcessing) ? metadata.nativeProcessing : {};
  const existingTranscriptionID = readString(nativeProcessing.transcriptionId);
  if (existingTranscriptionID) {
    await continueNativeLectureProcessing(env, userID, lectureID);
    return;
  }
  if (!lecture.storage_path) {
    throw new HttpError(409, "The uploaded recording is missing.", "audio_missing");
  }

  const signedAudioURL = await createSignedDownload(env, STORAGE_BUCKET, lecture.storage_path);
  const languageHint = lecture.language_hint?.trim().toLowerCase();
  const transcription = await getSonioxClient(env).stt.transcribe({
    model: env.sonioxModel,
    audio_url: signedAudioURL,
    language_hints: languageHint && languageHint !== "auto" ? [languageHint] : ["sl"],
    language_hints_strict: false,
    enable_speaker_diarization: true,
    enable_language_identification: true,
    client_reference_id: lectureID,
    wait: false,
  });
  const now = new Date().toISOString();
  await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "transcribing",
      error_message: null,
      processing_metadata: {
        ...metadata,
        processing: { stage: "transcribing", updatedAt: now, errorMessage: null },
        nativeProcessing: {
          provider: "soniox",
          model: env.sonioxModel,
          transcriptionId: transcription.id,
          startedAt: now,
          updatedAt: now,
        },
      },
    }),
  });
}

async function continueNativeLectureProcessing(env: MobileEnv, userID: string, lectureID: string) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  if (lecture.source_type !== "audio" || lecture.status === "ready" || lecture.status === "failed") {
    return;
  }
  const metadata = isRecord(lecture.processing_metadata) ? lecture.processing_metadata : {};
  const nativeProcessing = isRecord(metadata.nativeProcessing) ? metadata.nativeProcessing : {};
  const transcriptionID = readString(nativeProcessing.transcriptionId);
  if (!transcriptionID) {
    if (lecture.storage_path) await startNativeLectureProcessing(env, userID, lectureID);
    return;
  }

  const transcription = await getSonioxClient(env).stt.get(transcriptionID);
  if (!transcription) {
    await failNativeLectureProcessing(env, userID, lecture, "Soniox transcription was not found.");
    return;
  }
  if (transcription.status === "error") {
    await failNativeLectureProcessing(
      env,
      userID,
      lecture,
      transcription.error_message || "The recording could not be transcribed.",
    );
    return;
  }
  if (transcription.status !== "completed") {
    return;
  }

  const transcript = await transcription.getTranscript();
  const transcriptText = transcript?.text.trim() ?? "";
  if (!transcript || transcriptText.length < 2) {
    await failNativeLectureProcessing(env, userID, lecture, "No clear speech was detected in the recording.");
    return;
  }
  const transcriptSegments = transcript
    .segments({ group_by: ["speaker", "language"] })
    .map((segment, index) => {
      const startMs = Math.max(0, Math.round(segment.start_ms ?? 0));
      return {
        lecture_id: lectureID,
        idx: index,
        start_ms: startMs,
        end_ms: Math.max(startMs, Math.round(segment.end_ms ?? startMs)),
        speaker_label: segment.speaker ?? null,
        text: segment.text.trim(),
      };
    })
    .filter((segment) => segment.text.length > 0);
  const durationMs = transcription.audio_duration_ms ?? transcriptSegments.at(-1)?.end_ms ?? 0;
  await replaceRows(env, "transcript_segments", lectureID, transcriptSegments.length > 0
    ? transcriptSegments
    : [{
        lecture_id: lectureID,
        idx: 0,
        start_ms: 0,
        end_ms: Math.max(durationMs, 1_000),
        speaker_label: null,
        text: transcriptText,
      }]);

  const completedAt = new Date().toISOString();
  await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      title: lecture.title?.trim() || titleFromText(transcriptText),
      duration_seconds: Math.max(1, Math.round(durationMs / 1_000)),
      status: "generating_notes",
      error_message: null,
      processing_metadata: {
        ...metadata,
        processing: { stage: "generating_notes", updatedAt: completedAt, errorMessage: null },
        nativeProcessing: {
          ...nativeProcessing,
          provider: "soniox",
          model: env.sonioxModel,
          transcriptionId: transcriptionID,
          completedAt,
          updatedAt: completedAt,
        },
      },
    }),
  });
  await transcription.destroy().catch(() => undefined);
  await generateStudyAssetsForLecture(env, userID, lectureID);
}

async function failNativeLectureProcessing(
  env: MobileEnv,
  userID: string,
  lecture: LectureRow,
  message: string,
) {
  const metadata = isRecord(lecture.processing_metadata) ? lecture.processing_metadata : {};
  const now = new Date().toISOString();
  await postgrest(env, `/rest/v1/lectures?id=eq.${lecture.id}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "failed",
      error_message: message,
      processing_metadata: {
        ...metadata,
        processing: { stage: "failed", updatedAt: now, errorMessage: message },
      },
    }),
  });
}

async function createTextLecture(
  env: MobileEnv,
  userID: string,
  params: {
    lectureID: string | null;
    text: string;
    languageHint: string;
    createInitialAudio: boolean;
    initialAudioVoice: string;
    sourceType?: "text" | "link";
    titleHint?: string;
    sourceURL?: string;
  },
) {
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.canCreateNotes && !params.lectureID) {
    throw new HttpError(402, "The free trial has already been used.", "trial_exhausted");
  }

  let lectureID = params.lectureID;
  if (lectureID) {
    await requireOwnedLecture(env, userID, lectureID);
  } else {
    const created = await createLectureDraft(env, userID, "text", params.languageHint);
    lectureID = created.id;
  }

  const notes = params.text.trim();
  const sourceType = params.sourceType ?? "text";
  await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      title: params.titleHint?.trim() || titleFromText(notes),
      source_type: sourceType,
      status: "queued",
      error_message: null,
      language_hint: params.languageHint,
      processing_metadata: {
        createInitialAudio: params.createInitialAudio,
        initialAudioVoice: params.initialAudioVoice,
        mobileImport: {
          mode: sourceType,
          sourceUrl: params.sourceURL,
          importedAt: new Date().toISOString(),
        },
        processing: {
          stage: "generating_notes",
          updatedAt: new Date().toISOString(),
          errorMessage: null,
        },
      },
    }),
  });

  await postgrest(env, "/rest/v1/transcript_segments", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      lecture_id: lectureID,
      idx: 0,
      start_ms: 0,
      end_ms: Math.max(1000, Math.min(notes.length * 45, 60 * 60 * 1000)),
      speaker_label: "Text import",
      text: notes,
    }),
  }).catch((error) => {
    if (error instanceof HttpError && error.status === 409) {
      return;
    }
    throw error;
  });

  await generateStudyAssetsForLecture(env, userID, lectureID);

  return { id: lectureID };
}

const UNSUPPORTED_VIDEO_LINK_MESSAGE =
  "Ta povezava izgleda kot video. MemoAI trenutno ustvarja zapiske iz spletnih strani, člankov, blogov in drugih besedilnih strani, ne pa iz videov. Prilepi povezavo do besedilne strani.";

const DIRECT_VIDEO_FILE_EXTENSIONS = [
  ".3g2", ".3gp", ".avi", ".m3u8", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm",
];

function isUnsupportedVideoURL(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, "");
  const hostMatches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  const startsWithSegment = (segment: string) => pathname === segment || pathname.startsWith(`${segment}/`);

  if (DIRECT_VIDEO_FILE_EXTENSIONS.some((extension) => pathname.endsWith(extension))) return true;
  if (hostMatches("youtu.be")) return pathname.length > 0;
  if (hostMatches("youtube.com") || hostMatches("youtube-nocookie.com")) {
    if (pathname === "/watch" || pathname === "/playlist") return true;
    if (["/clip", "/embed", "/live", "/shorts", "/v"].some(startsWithSegment)) return true;
  }
  if (hostMatches("vimeo.com") || hostMatches("dailymotion.com") || hostMatches("dai.ly")) {
    return pathname.length > 0;
  }
  if (hostMatches("tiktok.com")) {
    return hostname === "vm.tiktok.com" || hostname === "vt.tiktok.com" || pathname.includes("/video/");
  }
  if (hostname === "clips.twitch.tv" || hostMatches("twitch.tv")) {
    return hostname === "clips.twitch.tv" || startsWithSegment("/videos") || startsWithSegment("/clip");
  }
  if (hostMatches("instagram.com")) {
    return startsWithSegment("/reel") || startsWithSegment("/tv");
  }
  if (hostname === "fb.watch" || hostMatches("facebook.com")) {
    return hostname === "fb.watch" || startsWithSegment("/watch") || startsWithSegment("/reel") || startsWithSegment("/videos");
  }
  return false;
}

async function createLinkLecture(
  env: MobileEnv,
  userID: string,
  params: {
    lectureID: string | null;
    url: string;
    languageHint: string;
    createInitialAudio: boolean;
    initialAudioVoice: string;
  },
) {
  const parsedURL = new URL(params.url);
  if (!["http:", "https:"].includes(parsedURL.protocol)) {
    throw new HttpError(400, "Only http and https links are supported.");
  }
  if (isUnsupportedVideoURL(parsedURL)) {
    throw new HttpError(400, UNSUPPORTED_VIDEO_LINK_MESSAGE, "unsupported_video_link");
  }

  let lectureID = params.lectureID;
  if (lectureID) {
    await requireOwnedLecture(env, userID, lectureID);
  } else {
    lectureID = (await createLectureDraft(env, userID, "link", params.languageHint)).id;
  }

  await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_type: "link",
      title: parsedURL.hostname,
      status: "queued",
      language_hint: params.languageHint,
      processing_metadata: {
        createInitialAudio: params.createInitialAudio,
        initialAudioVoice: params.initialAudioVoice,
        pendingLinkUrl: parsedURL.toString(),
        processing: {
          stage: "reading_link",
          updatedAt: new Date().toISOString(),
          errorMessage: null,
        },
        mobileImport: {
          mode: "link",
          sourceUrl: parsedURL.toString(),
          importedAt: new Date().toISOString(),
        },
      },
    }),
  });

  const text = await fetchReadableText(parsedURL);
  return createTextLecture(env, userID, {
    lectureID,
    text,
    languageHint: params.languageHint,
    createInitialAudio: params.createInitialAudio,
    initialAudioVoice: params.initialAudioVoice,
    sourceType: "link",
    titleHint: parsedURL.hostname,
    sourceURL: parsedURL.toString(),
  });
}

async function fetchLectureDetail(env: MobileEnv, userID: string, lectureID: string) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  const [artifact, transcript, flashcardsBase, quizQuestions, practiceQuestions, studyAsset, quizAsset, practiceTestAsset, chatMessages, noteMediaRows, studySession] = await Promise.all([
    listRows<LectureArtifactRow>(env, "lecture_artifacts", {
      select: "lecture_id,summary,key_topics,structured_notes_md,editable_notes_md,editable_notes_doc,editable_notes_revision,editable_notes_updated_at,generated_at",
      lecture_id: `eq.${lectureID}`,
      limit: "1",
    }).then((rows) => rows[0] ?? null),
    listRows(env, "transcript_segments", {
      select: "id,lecture_id,idx,start_ms,end_ms,speaker_label,text",
      lecture_id: `eq.${lectureID}`,
      order: "idx.asc",
    }),
    listRows<FlashcardRow>(env, "flashcards", {
      select: "id,lecture_id,idx,front,back,hint,difficulty,source_locator",
      lecture_id: `eq.${lectureID}`,
      order: "idx.asc",
    }),
    listRows(env, "quiz_questions", {
      select: "id,lecture_id,idx,prompt,options_json,correct_option_idx,explanation,source_locator",
      lecture_id: `eq.${lectureID}`,
      order: "idx.asc",
    }),
    listRows(env, "practice_test_questions", {
      select: "id,lecture_id,idx,prompt,answer_guide,difficulty,source_locator,source_unit_idx,concept_key",
      lecture_id: `eq.${lectureID}`,
      order: "idx.asc",
    }).catch((error) => {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }),
    listRows<MobileStudyAssetRow>(env, "lecture_study_assets", {
      select: "lecture_id,status,error_message,generated_at,updated_at",
      lecture_id: `eq.${lectureID}`,
      limit: "1",
    }).then((rows) => rows[0] ?? null).catch((error) => {
      if (isMissingTableError(error)) return null;
      throw error;
    }),
    listRows<MobileStudyAssetRow>(env, "lecture_quiz_assets", {
      select: "lecture_id,status,error_message,generated_at,updated_at",
      lecture_id: `eq.${lectureID}`,
      limit: "1",
    }).then((rows) => rows[0] ?? null).catch((error) => {
      if (isMissingTableError(error)) return null;
      throw error;
    }),
    listRows<MobileStudyAssetRow>(env, "lecture_practice_test_assets", {
      select: "lecture_id,status,error_message,generated_at,updated_at",
      lecture_id: `eq.${lectureID}`,
      limit: "1",
    }).then((rows) => rows[0] ?? null).catch((error) => {
      if (isMissingTableError(error)) return null;
      throw error;
    }),
    listRows(env, "chat_messages", {
      select: "id,lecture_id,user_id,role,content,created_at",
      lecture_id: `eq.${lectureID}`,
      order: "created_at.asc",
    }),
    listRows<NoteMediaRow>(env, "lecture_note_media", {
      select: "id,lecture_id,user_id,storage_path,mime_type,byte_size,original_file_name,created_at",
      lecture_id: `eq.${lectureID}`,
      user_id: `eq.${userID}`,
      order: "created_at.asc",
    }).catch((error) => {
      if (isMissingTableError(error)) return [];
      throw error;
    }),
    listRows(env, "lecture_study_sessions", {
      select: "user_id,lecture_id,active_study_view,flashcard_state,quiz_state,practice_test_state,created_at,updated_at",
      lecture_id: `eq.${lectureID}`,
      user_id: `eq.${userID}`,
      limit: "1",
    }).then((rows) => rows[0] ?? null).catch((error) => {
      if (isMissingTableError(error)) return null;
      throw error;
    }),
  ]);
  const flashcards = await attachFlashcardProgress(env, userID, flashcardsBase);
  const noteMedia = await Promise.all(noteMediaRows.map(async (media) => ({
    ...media,
    signedUrl: await createSignedDownload(env, STORAGE_BUCKET, media.storage_path),
  })));
  const practiceAttemptRows = await listRows<PracticeTestAttemptRow>(env, "practice_test_attempts", {
    select: "id,lecture_id,user_id,status,question_count,total_score,max_score,percentage,graded_at,model_metadata,created_at,updated_at",
    lecture_id: `eq.${lectureID}`,
    user_id: `eq.${userID}`,
    order: "created_at.asc",
  }).catch((error) => {
    if (isMissingTableError(error)) return [];
    throw error;
  });
  const attemptAnswers = practiceAttemptRows.length > 0
    ? await listRows<PracticeTestAttemptAnswerRow>(env, "practice_test_attempt_answers", {
        select: "id,attempt_id,practice_test_question_id,idx,question_prompt,answer_guide_snapshot,difficulty_snapshot,source_locator_snapshot,typed_answer,photo_path,photo_mime_type,declared_unknown,score,grading_rationale,strengths,missing_points,expected_answer,grading_confidence,created_at,updated_at",
        attempt_id: `in.(${practiceAttemptRows.map((attempt) => attempt.id).join(",")})`,
        order: "idx.asc",
      })
    : [];
  const practiceTestAttempts = practiceAttemptRows.map((attempt) => ({
    ...attempt,
    answers: attemptAnswers.filter((answer) => answer.attempt_id === attempt.id),
  }));

  return {
    lecture,
    artifact,
    transcript,
    flashcards,
    quizQuestions,
    practiceQuestions,
    studyAsset,
    quizAsset,
    practiceTestAsset,
    practiceTestAttempts,
    practiceTestHistorySummary: buildMobilePracticeHistory(practiceAttemptRows),
    chatMessages,
    noteMedia,
    studySession,
  };
}

async function attachFlashcardProgress(
  env: MobileEnv,
  userID: string,
  flashcards: FlashcardRow[],
) {
  if (flashcards.length === 0) {
    return flashcards;
  }
  const ids = flashcards.map((flashcard) => flashcard.id);
  const progressRows = await listRows<FlashcardProgressRow>(env, "flashcard_progress", {
    select: "user_id,flashcard_id,confidence_bucket,review_count,last_reviewed_at",
    user_id: `eq.${userID}`,
    flashcard_id: `in.(${ids.join(",")})`,
  });
  const progressByFlashcard = new Map(progressRows.map((progress) => [progress.flashcard_id, progress]));
  return flashcards.map((flashcard) => ({
    ...flashcard,
    progress: progressByFlashcard.get(flashcard.id) ?? null,
  }));
}

async function saveFlashcardProgress(
  env: MobileEnv,
  userID: string,
  flashcardID: string,
  confidenceBucket: FlashcardProgressRow["confidence_bucket"],
) {
  const rows = await listRows<{ id: string; lecture_id: string }>(env, "flashcards", {
    select: "id,lecture_id",
    id: `eq.${flashcardID}`,
    limit: "1",
  });
  const flashcard = rows[0];
  if (!flashcard) {
    throw new HttpError(404, "No flashcard was found.");
  }
  const lecture = await requireOwnedLecture(env, userID, flashcard.lecture_id);
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.hasPaidAccess && lecture.access_tier !== "trial") {
    throw new HttpError(402, "Flashcard review is available for paid notes or your trial note.", "billing_required");
  }

  const existingRows = await listRows<FlashcardProgressRow>(env, "flashcard_progress", {
    select: "user_id,flashcard_id,confidence_bucket,review_count,last_reviewed_at",
    user_id: `eq.${userID}`,
    flashcard_id: `eq.${flashcardID}`,
    limit: "1",
  });
  const reviewCount = (existingRows[0]?.review_count ?? 0) + 1;
  const lastReviewedAt = new Date().toISOString();
  const saved = await postgrest<FlashcardProgressRow[]>(
    env,
    "/rest/v1/flashcard_progress?on_conflict=user_id,flashcard_id&select=user_id,flashcard_id,confidence_bucket,review_count,last_reviewed_at",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        user_id: userID,
        flashcard_id: flashcardID,
        confidence_bucket: confidenceBucket,
        review_count: reviewCount,
        last_reviewed_at: lastReviewedAt,
      }),
    },
  );
  return saved[0] ?? {
    user_id: userID,
    flashcard_id: flashcardID,
    confidence_bucket: confidenceBucket,
    review_count: reviewCount,
    last_reviewed_at: lastReviewedAt,
  };
}

async function assertStudyManagementAccess(env: MobileEnv, userID: string, lectureID: string) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.hasPaidAccess && lecture.access_tier !== "trial") {
    throw new HttpError(402, "Editing study material is available for paid notes or your trial note.", "billing_required");
  }
  return lecture;
}

function studyDifficulty(value: unknown) {
  return readEnum(value, ["easy", "medium", "hard"], "medium");
}

async function nextStudyIndex(env: MobileEnv, table: "flashcards" | "quiz_questions", lectureID: string) {
  const rows = await listRows<{ idx: number }>(env, table, {
    select: "idx",
    lecture_id: `eq.${lectureID}`,
    order: "idx.desc",
    limit: "1",
  });
  return (rows[0]?.idx ?? -1) + 1;
}

async function createFlashcard(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  body: Record<string, unknown>,
) {
  await assertStudyManagementAccess(env, userID, lectureID);
  const rows = await postgrest<FlashcardRow[]>(
    env,
    "/rest/v1/flashcards?select=id,lecture_id,idx,front,back,hint,difficulty,source_locator",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        lecture_id: lectureID,
        idx: await nextStudyIndex(env, "flashcards", lectureID),
        front: requiredString(body.front, "front").trim(),
        back: requiredString(body.back, "back").trim(),
        hint: readString(body.hint) ?? null,
        difficulty: studyDifficulty(body.difficulty),
        source_locator: null,
      }),
    },
  );
  if (!rows[0]) throw new HttpError(500, "Flashcard could not be created.");
  return { ...rows[0], progress: null };
}

async function ownedFlashcard(env: MobileEnv, userID: string, flashcardID: string) {
  const rows = await listRows<FlashcardRow>(env, "flashcards", {
    select: "id,lecture_id,idx,front,back,hint,difficulty,source_locator",
    id: `eq.${flashcardID}`,
    limit: "1",
  });
  const row = rows[0];
  if (!row) throw new HttpError(404, "No flashcard was found.");
  await assertStudyManagementAccess(env, userID, row.lecture_id);
  return row;
}

async function updateFlashcard(
  env: MobileEnv,
  userID: string,
  flashcardID: string,
  body: Record<string, unknown>,
) {
  await ownedFlashcard(env, userID, flashcardID);
  const rows = await postgrest<FlashcardRow[]>(
    env,
    `/rest/v1/flashcards?id=eq.${flashcardID}&select=id,lecture_id,idx,front,back,hint,difficulty,source_locator`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        front: requiredString(body.front, "front").trim(),
        back: requiredString(body.back, "back").trim(),
        hint: readString(body.hint) ?? null,
        difficulty: studyDifficulty(body.difficulty),
      }),
    },
  );
  if (!rows[0]) throw new HttpError(404, "No flashcard was found.");
  return { ...rows[0], progress: null };
}

async function deleteFlashcard(env: MobileEnv, userID: string, flashcardID: string) {
  await ownedFlashcard(env, userID, flashcardID);
  await postgrest(env, `/rest/v1/flashcards?id=eq.${flashcardID}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

function validatedQuizFields(body: Record<string, unknown>) {
  const options = Array.isArray(body.options) ? body.options.map((value) => requiredString(value, "options" ).trim()) : [];
  if (options.length !== 4) {
    throw new HttpError(400, "Quiz questions require exactly four answers.");
  }
  const correctOptionIndex = typeof body.correctOptionIndex === "number" ? body.correctOptionIndex : -1;
  if (!Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex > 3) {
    throw new HttpError(400, "Missing or invalid field: correctOptionIndex.");
  }
  return {
    prompt: requiredString(body.prompt, "prompt").trim(),
    options_json: options,
    correct_option_idx: correctOptionIndex,
    explanation: requiredString(body.explanation, "explanation").trim(),
    difficulty: studyDifficulty(body.difficulty),
    source_locator: null,
  };
}

async function createQuizQuestion(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  body: Record<string, unknown>,
) {
  await assertStudyManagementAccess(env, userID, lectureID);
  const rows = await postgrest<QuizQuestionRow[]>(
    env,
    "/rest/v1/quiz_questions?select=id,lecture_id,idx,prompt,options_json,correct_option_idx,explanation,difficulty,source_locator",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        lecture_id: lectureID,
        idx: await nextStudyIndex(env, "quiz_questions", lectureID),
        ...validatedQuizFields(body),
      }),
    },
  );
  if (!rows[0]) throw new HttpError(500, "Quiz question could not be created.");
  return rows[0];
}

async function ownedQuizQuestion(env: MobileEnv, userID: string, lectureID: string, questionID: string) {
  await assertStudyManagementAccess(env, userID, lectureID);
  const rows = await listRows<QuizQuestionRow>(env, "quiz_questions", {
    select: "id,lecture_id,idx,prompt,options_json,correct_option_idx,explanation,difficulty,source_locator",
    id: `eq.${questionID}`,
    lecture_id: `eq.${lectureID}`,
    limit: "1",
  });
  if (!rows[0]) throw new HttpError(404, "No quiz question was found.");
  return rows[0];
}

async function updateQuizQuestion(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  questionID: string,
  body: Record<string, unknown>,
) {
  await ownedQuizQuestion(env, userID, lectureID, questionID);
  const rows = await postgrest<QuizQuestionRow[]>(
    env,
    `/rest/v1/quiz_questions?id=eq.${questionID}&lecture_id=eq.${lectureID}&select=id,lecture_id,idx,prompt,options_json,correct_option_idx,explanation,difficulty,source_locator`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(validatedQuizFields(body)),
    },
  );
  if (!rows[0]) throw new HttpError(404, "No quiz question was found.");
  return rows[0];
}

async function deleteQuizQuestion(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  questionID: string,
) {
  await ownedQuizQuestion(env, userID, lectureID, questionID);
  await postgrest(env, `/rest/v1/quiz_questions?id=eq.${questionID}&lecture_id=eq.${lectureID}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function updateEditableNotes(env: MobileEnv, userID: string, lectureID: string, notesMarkdown: string) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.hasPaidAccess && lecture.access_tier !== "trial") {
    throw new HttpError(402, "Editing notes is available for paid notes or your trial note.", "billing_required");
  }

  const artifactRows = await listRows<LectureArtifactRow>(env, "lecture_artifacts", {
    select: "lecture_id",
    lecture_id: `eq.${lectureID}`,
    limit: "1",
  });
  if (!artifactRows[0]) {
    throw new HttpError(409, "Notes are not ready yet.");
  }

  await postgrest(env, `/rest/v1/lecture_artifacts?lecture_id=eq.${lectureID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      editable_notes_md: notesMarkdown,
    }),
  });

  return fetchLectureDetail(env, userID, lectureID);
}

async function requireNoteEditingAccess(env: MobileEnv, userID: string, lectureID: string) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.hasPaidAccess && lecture.access_tier !== "trial") {
    throw new HttpError(402, "Editing notes is available for paid notes or your trial note.", "billing_required");
  }
  return lecture;
}

async function prepareNoteMediaUpload(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  body: Record<string, unknown>,
) {
  await requireNoteEditingAccess(env, userID, lectureID);
  const fileName = requiredString(body.fileName, "fileName");
  const mimeType = normalizeImageMimeType(requiredString(body.mimeType, "mimeType"), fileName);
  const byteSize = readPositiveNumber(body.byteSize, "byteSize", MAX_SCAN_IMAGE_BYTES);
  if (!supportedNoteMediaMimeType(mimeType)) {
    throw new HttpError(400, "Supported photos are JPG, PNG, WebP, HEIC, or HEIF.");
  }
  const mediaId = crypto.randomUUID();
  const path = `${userID}/${lectureID}/note-media/${mediaId}.${extensionForMimeType(mimeType, fileName)}`;
  const upload = await createSignedUpload(env, STORAGE_BUCKET, path);
  return { mediaId, ...upload, mimeType, maxBytes: MAX_SCAN_IMAGE_BYTES, byteSize };
}

async function finalizeNoteMediaUpload(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  body: Record<string, unknown>,
) {
  await requireNoteEditingAccess(env, userID, lectureID);
  const mediaId = requiredString(body.mediaId, "mediaId");
  if (!isUUID(mediaId)) throw new HttpError(400, "Invalid photo ID.");
  const storagePath = requiredString(body.storagePath, "storagePath");
  const originalFileName = readString(body.originalFileName) ?? "photo.jpg";
  const mimeType = normalizeImageMimeType(requiredString(body.mimeType, "mimeType"), originalFileName);
  const byteSize = readPositiveNumber(body.byteSize, "byteSize", MAX_SCAN_IMAGE_BYTES);
  const afterBlockId = requiredString(body.afterBlockId, "afterBlockId").slice(0, 160);
  const expectedRevision = readNonNegativeInteger(body.expectedRevision, "expectedRevision");
  const expectedPrefix = `${userID}/${lectureID}/note-media/${mediaId}.`;
  if (!storagePath.startsWith(expectedPrefix) || !supportedNoteMediaMimeType(mimeType)) {
    throw new HttpError(400, "Invalid photo upload.");
  }

  const artifact = await readArtifactForNoteDoc(env, lectureID);
  if (!artifact) throw new HttpError(409, "Notes are not ready yet.");
  const currentRevision = artifact.editable_notes_revision ?? 0;
  if (currentRevision !== expectedRevision) {
    throw new HttpError(409, "The notes changed while the photo was uploading. Refresh and try again.");
  }

  const mediaRows = await postgrest<NoteMediaRow[]>(
    env,
    "/rest/v1/lecture_note_media?select=id,lecture_id,user_id,storage_path,mime_type,byte_size,original_file_name,created_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: mediaId,
        lecture_id: lectureID,
        user_id: userID,
        storage_path: storagePath,
        mime_type: mimeType,
        byte_size: byteSize,
        original_file_name: originalFileName,
      }),
    },
  );
  const media = mediaRows[0];
  if (!media) throw new HttpError(500, "The photo could not be saved.");

  const now = new Date().toISOString();
  const currentDoc = parseMobileNoteDoc(artifact);
  const nextDoc: EditableNoteDoc = {
    ...currentDoc,
    updatedAt: now,
    mediaBlocks: [...currentDoc.mediaBlocks, {
      id: crypto.randomUUID(),
      mediaId,
      afterBlockId,
      createdAt: now,
    }],
  };
  const updated = await updateMobileNoteDoc(env, lectureID, expectedRevision, nextDoc);
  if (!updated) {
    await Promise.all([
      postgrest(env, `/rest/v1/lecture_note_media?id=eq.${mediaId}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      }),
      removeStorageObjects(env, STORAGE_BUCKET, [storagePath]),
    ]);
    throw new HttpError(409, "The notes changed while the photo was uploading. Refresh and try again.");
  }

  return {
    doc: parseMobileNoteDoc(updated),
    revision: updated.editable_notes_revision ?? expectedRevision + 1,
    media: { ...media, signedUrl: await createSignedDownload(env, STORAGE_BUCKET, storagePath) },
  };
}

async function deleteNoteMedia(env: MobileEnv, userID: string, lectureID: string, mediaID: string) {
  await requireNoteEditingAccess(env, userID, lectureID);
  const mediaRows = await listRows<NoteMediaRow>(env, "lecture_note_media", {
    select: "id,lecture_id,user_id,storage_path,mime_type,byte_size,original_file_name,created_at",
    id: `eq.${mediaID}`,
    lecture_id: `eq.${lectureID}`,
    user_id: `eq.${userID}`,
    limit: "1",
  });
  const media = mediaRows[0];
  if (!media) throw new HttpError(404, "No photo was found.");
  const artifact = await readArtifactForNoteDoc(env, lectureID);
  if (!artifact) throw new HttpError(409, "Notes are not ready yet.");
  const revision = artifact.editable_notes_revision ?? 0;
  const currentDoc = parseMobileNoteDoc(artifact);
  const nextDoc: EditableNoteDoc = {
    ...currentDoc,
    updatedAt: new Date().toISOString(),
    mediaBlocks: currentDoc.mediaBlocks.filter((block) => block.mediaId !== mediaID),
  };
  const updated = await updateMobileNoteDoc(env, lectureID, revision, nextDoc);
  if (!updated) throw new HttpError(409, "The notes changed. Refresh and try again.");
  await Promise.all([
    postgrest(env, `/rest/v1/lecture_note_media?id=eq.${mediaID}&lecture_id=eq.${lectureID}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }),
    removeStorageObjects(env, STORAGE_BUCKET, [media.storage_path]),
  ]);
  return {
    doc: parseMobileNoteDoc(updated),
    revision: updated.editable_notes_revision ?? revision + 1,
    deletedMediaId: mediaID,
  };
}

async function readArtifactForNoteDoc(env: MobileEnv, lectureID: string) {
  const rows = await listRows<LectureArtifactRow>(env, "lecture_artifacts", {
    select: "lecture_id,summary,key_topics,structured_notes_md,editable_notes_md,editable_notes_doc,editable_notes_revision,editable_notes_updated_at,generated_at",
    lecture_id: `eq.${lectureID}`,
    limit: "1",
  });
  return rows[0] ?? null;
}

async function updateMobileNoteDoc(
  env: MobileEnv,
  lectureID: string,
  expectedRevision: number,
  doc: EditableNoteDoc,
) {
  const rows = await postgrest<LectureArtifactRow[]>(
    env,
    `/rest/v1/lecture_artifacts?lecture_id=eq.${lectureID}&editable_notes_revision=eq.${expectedRevision}&select=lecture_id,summary,key_topics,structured_notes_md,editable_notes_md,editable_notes_doc,editable_notes_revision,editable_notes_updated_at,generated_at`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        editable_notes_doc: doc,
        editable_notes_revision: expectedRevision + 1,
        editable_notes_updated_at: doc.updatedAt,
      }),
    },
  );
  return rows[0] ?? null;
}

function parseMobileNoteDoc(artifact: LectureArtifactRow): EditableNoteDoc {
  const raw = isRecord(artifact.editable_notes_doc) ? artifact.editable_notes_doc : {};
  const baseNotes = artifact.editable_notes_md?.trim() || artifact.structured_notes_md || "";
  const annotations = Array.isArray(raw.annotations)
    ? raw.annotations.filter(isMobileNoteAnnotation)
    : [];
  const mediaBlocks = Array.isArray(raw.mediaBlocks)
    ? raw.mediaBlocks.filter(isMobileNoteMediaBlock)
    : [];
  return {
    version: 1,
    baseNotesHash: readString(raw.baseNotesHash) ?? createHash("sha256").update(baseNotes).digest("hex"),
    updatedAt: readString(raw.updatedAt) ?? new Date(0).toISOString(),
    annotations,
    mediaBlocks,
  };
}

function readMobileNoteDocInput(value: unknown, artifact: LectureArtifactRow): EditableNoteDoc {
  if (!isRecord(value)) throw new HttpError(400, "Invalid note document.");
  const current = parseMobileNoteDoc(artifact);
  const annotations = Array.isArray(value.annotations)
    ? value.annotations.filter(isMobileNoteAnnotation)
    : null;
  const mediaBlocks = Array.isArray(value.mediaBlocks)
    ? value.mediaBlocks.filter(isMobileNoteMediaBlock)
    : null;
  if (!annotations || !mediaBlocks) throw new HttpError(400, "Invalid note document.");
  if (annotations.length > 2_000 || mediaBlocks.length > 200) {
    throw new HttpError(400, "The note document is too large.");
  }
  return {
    version: 1,
    baseNotesHash: readString(value.baseNotesHash) ?? current.baseNotesHash,
    updatedAt: readString(value.updatedAt) ?? new Date().toISOString(),
    annotations,
    mediaBlocks,
  };
}

function isMobileNoteAnnotation(value: unknown): value is NoteAnnotation {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    (value.kind === "highlight" || value.kind === "underline") &&
    Number.isInteger(value.startWordIndex) && Number.isInteger(value.endWordIndex) &&
    Number(value.startWordIndex) >= 0 && Number(value.endWordIndex) >= Number(value.startWordIndex) &&
    typeof value.createdAt === "string";
}

function isMobileNoteMediaBlock(value: unknown): value is NoteMediaBlock {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.mediaId === "string" &&
    typeof value.afterBlockId === "string" && typeof value.createdAt === "string";
}

function supportedNoteMediaMimeType(mimeType: string) {
  return ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mimeType);
}

async function createMobilePracticeAttempt(env: MobileEnv, userID: string, lectureID: string) {
  await requireNoteEditingAccess(env, userID, lectureID);
  let questions = await listRows<{
    id: string;
    lecture_id: string;
    idx: number;
    prompt: string;
    answer_guide: string;
    difficulty: string;
    source_locator: string | null;
  }>(env, "practice_test_questions", {
    select: "id,lecture_id,idx,prompt,answer_guide,difficulty,source_locator",
    lecture_id: `eq.${lectureID}`,
    order: "idx.asc",
  });
  if (questions.length === 0) {
    await generateStudyAssetsForLecture(env, userID, lectureID);
    questions = await listRows(env, "practice_test_questions", {
      select: "id,lecture_id,idx,prompt,answer_guide,difficulty,source_locator",
      lecture_id: `eq.${lectureID}`,
      order: "idx.asc",
    });
  }
  if (questions.length === 0) throw new HttpError(409, "A practice test could not be prepared right now.");

  const previous = await listRows<PracticeTestAttemptRow>(env, "practice_test_attempts", {
    select: "id,lecture_id,user_id,status,question_count,total_score,max_score,percentage,graded_at,model_metadata,created_at,updated_at",
    lecture_id: `eq.${lectureID}`,
    user_id: `eq.${userID}`,
    order: "created_at.asc",
  });
  const activeIDs = previous
    .filter((attempt) => attempt.status === "in_progress" || attempt.status === "submitted")
    .map((attempt) => attempt.id);
  if (activeIDs.length > 0) {
    await postgrest(env, `/rest/v1/practice_test_attempts?id=in.(${activeIDs.join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed" }),
    });
  }

  const selected = questions.slice(0, 8);
  const attemptID = crypto.randomUUID();
  const attemptRows = await postgrest<PracticeTestAttemptRow[]>(
    env,
    "/rest/v1/practice_test_attempts?select=id,lecture_id,user_id,status,question_count,total_score,max_score,percentage,graded_at,model_metadata,created_at,updated_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: attemptID,
        lecture_id: lectureID,
        user_id: userID,
        status: "in_progress",
        question_count: selected.length,
        model_metadata: {
          questionIds: selected.map((question) => question.id),
          attemptNumber: previous.length + 1,
          client: "ios-native",
        },
      }),
    },
  );
  const answers = await postgrest<PracticeTestAttemptAnswerRow[]>(
    env,
    "/rest/v1/practice_test_attempt_answers?select=id,attempt_id,practice_test_question_id,idx,question_prompt,answer_guide_snapshot,difficulty_snapshot,source_locator_snapshot,typed_answer,photo_path,photo_mime_type,declared_unknown,score,grading_rationale,strengths,missing_points,expected_answer,grading_confidence,created_at,updated_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(selected.map((question, index) => ({
        attempt_id: attemptID,
        practice_test_question_id: question.id,
        idx: index,
        question_prompt: question.prompt,
        answer_guide_snapshot: question.answer_guide,
        difficulty_snapshot: question.difficulty,
        source_locator_snapshot: question.source_locator,
      }))),
    },
  );
  return { ...(attemptRows[0] ?? {
    id: attemptID,
    lecture_id: lectureID,
    user_id: userID,
    status: "in_progress",
    question_count: selected.length,
    total_score: null,
    max_score: null,
    percentage: null,
    graded_at: null,
    model_metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }), answers };
}

async function submitMobilePracticeAttempt(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  attemptID: string,
  body: Record<string, unknown>,
) {
  await requireNoteEditingAccess(env, userID, lectureID);
  const attemptRows = await listRows<PracticeTestAttemptRow>(env, "practice_test_attempts", {
    select: "id,lecture_id,user_id,status,question_count,total_score,max_score,percentage,graded_at,model_metadata,created_at,updated_at",
    id: `eq.${attemptID}`,
    lecture_id: `eq.${lectureID}`,
    user_id: `eq.${userID}`,
    limit: "1",
  });
  const attempt = attemptRows[0];
  if (!attempt) throw new HttpError(404, "No practice-test attempt was found.");
  if (attempt.status !== "in_progress") throw new HttpError(409, "This practice test has already been submitted.");
  const storedAnswers = await listRows<PracticeTestAttemptAnswerRow>(env, "practice_test_attempt_answers", {
    select: "id,attempt_id,practice_test_question_id,idx,question_prompt,answer_guide_snapshot,difficulty_snapshot,source_locator_snapshot,typed_answer,photo_path,photo_mime_type,declared_unknown,score,grading_rationale,strengths,missing_points,expected_answer,grading_confidence,created_at,updated_at",
    attempt_id: `eq.${attemptID}`,
    order: "idx.asc",
  });
  const inputs = Array.isArray(body.answers) ? body.answers : [];
  if (inputs.length !== storedAnswers.length || inputs.length === 0 || inputs.length > 20) {
    throw new HttpError(400, "Every practice-test question needs an answer or 'I don't know'.");
  }
  const byID = new Map<string, { typedAnswer: string; declaredUnknown: boolean }>();
  for (const raw of inputs) {
    if (!isRecord(raw)) throw new HttpError(400, "Invalid practice-test answer.");
    const answerID = requiredString(raw.answerId, "answerId");
    const typedAnswer = typeof raw.typedAnswer === "string" ? raw.typedAnswer.trim().slice(0, 12_000) : "";
    const declaredUnknown = raw.declaredUnknown === true;
    if (!declaredUnknown && !typedAnswer) {
      throw new HttpError(400, "Every practice-test question needs an answer or 'I don't know'.");
    }
    byID.set(answerID, { typedAnswer, declaredUnknown });
  }
  for (const answer of storedAnswers) {
    if (!byID.has(answer.id)) throw new HttpError(400, "A practice-test answer is missing.");
  }

  await postgrest(env, `/rest/v1/practice_test_attempts?id=eq.${attemptID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "submitted" }),
  });
  const gradedAnswers = await Promise.all(storedAnswers.map(async (answer) => {
    const input = byID.get(answer.id)!;
    const grade = input.declaredUnknown
      ? {
          score: 0,
          expectedAnswer: answer.answer_guide_snapshot ?? "",
          rationale: "Marked as 'I don't know'.",
          strengths: "No submitted answer.",
          missingPoints: "A complete answer was not provided.",
          confidence: "high",
        }
      : await gradeMobilePracticeAnswer(
          env,
          answer.question_prompt ?? "",
          answer.answer_guide_snapshot ?? "",
          input.typedAnswer,
        );
    const rows = await postgrest<PracticeTestAttemptAnswerRow[]>(
      env,
      `/rest/v1/practice_test_attempt_answers?id=eq.${answer.id}&select=id,attempt_id,practice_test_question_id,idx,question_prompt,answer_guide_snapshot,difficulty_snapshot,source_locator_snapshot,typed_answer,photo_path,photo_mime_type,declared_unknown,score,grading_rationale,strengths,missing_points,expected_answer,grading_confidence,created_at,updated_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          typed_answer: input.typedAnswer || null,
          declared_unknown: input.declaredUnknown,
          score: grade.score,
          expected_answer: grade.expectedAnswer,
          grading_rationale: grade.rationale,
          strengths: grade.strengths,
          missing_points: grade.missingPoints,
          grading_confidence: grade.confidence,
        }),
      },
    );
    return rows[0] ?? answer;
  }));
  const totalScore = gradedAnswers.reduce((sum, answer) => sum + (answer.score ?? 0), 0);
  const maxScore = gradedAnswers.length * 5;
  const percentage = maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0;
  const gradedAt = new Date().toISOString();
  const updatedAttempts = await postgrest<PracticeTestAttemptRow[]>(
    env,
    `/rest/v1/practice_test_attempts?id=eq.${attemptID}&select=id,lecture_id,user_id,status,question_count,total_score,max_score,percentage,graded_at,model_metadata,created_at,updated_at`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "graded", total_score: totalScore, max_score: maxScore, percentage, graded_at: gradedAt }),
    },
  );
  return {
    result: { totalScore, maxScore, percentage },
    attempt: { ...(updatedAttempts[0] ?? attempt), answers: gradedAnswers },
  };
}

async function gradeMobilePracticeAnswer(
  env: MobileEnv,
  prompt: string,
  answerGuide: string,
  typedAnswer: string,
) {
  if (env.geminiAPIKey) {
    const instruction = [
      "Grade this student answer only against the supplied answer guide.",
      "Return only JSON with score (integer 0-5), expectedAnswer, rationale, strengths, missingPoints, confidence.",
      `Question: ${prompt}`,
      `Answer guide: ${answerGuide}`,
      `Student answer: ${typedAnswer}`,
    ].join("\n");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiTextModel)}:generateContent?key=${encodeURIComponent(env.geminiAPIKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: instruction }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      },
    );
    if (response.ok) {
      const payload = safeJSON(await response.text());
      const generated = safeJSON(readGeminiText(payload) ?? "");
      if (isRecord(generated)) {
        const rawScore = typeof generated.score === "number" ? generated.score : Number(generated.score);
        if (Number.isFinite(rawScore)) {
          return {
            score: Math.max(0, Math.min(5, Math.round(rawScore))),
            expectedAnswer: readString(generated.expectedAnswer) ?? answerGuide,
            rationale: readString(generated.rationale) ?? "The answer was compared with the answer guide.",
            strengths: readString(generated.strengths) ?? "Relevant points were recognized.",
            missingPoints: readString(generated.missingPoints) ?? "Review the expected answer.",
            confidence: readString(generated.confidence) ?? "medium",
          };
        }
      }
    }
  }
  const expectedWords = new Set(tokenizeForPracticeGrade(answerGuide));
  const answerWords = new Set(tokenizeForPracticeGrade(typedAnswer));
  const matches = [...expectedWords].filter((word) => answerWords.has(word)).length;
  const coverage = expectedWords.size > 0 ? matches / expectedWords.size : 0;
  const score = Math.max(0, Math.min(5, Math.round(coverage * 5)));
  return {
    score,
    expectedAnswer: answerGuide,
    rationale: "The answer was compared with the key concepts in the answer guide.",
    strengths: matches > 0 ? "The response includes relevant concepts." : "No key concepts were matched.",
    missingPoints: score === 5 ? "No major points are missing." : "Review the expected answer and add the missing key concepts.",
    confidence: "low",
  };
}

function tokenizeForPracticeGrade(value: string) {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
}

function buildMobilePracticeHistory(attempts: PracticeTestAttemptRow[]) {
  const graded = attempts.filter((attempt) => attempt.status === "graded" && typeof attempt.percentage === "number");
  const percentages = graded.map((attempt) => attempt.percentage ?? 0);
  return {
    attemptCount: graded.length,
    averagePercentage: graded.length > 0
      ? Number((percentages.reduce((sum, value) => sum + value, 0) / graded.length).toFixed(2))
      : null,
    bestPercentage: graded.length > 0 ? Math.max(...percentages) : null,
    lowestPercentage: graded.length > 0 ? Math.min(...percentages) : null,
    latestPercentage: graded.length > 0 ? percentages[percentages.length - 1] : null,
  };
}

async function generateStudyAssetsForLecture(env: MobileEnv, userID: string, lectureID: string) {
  let detail = await fetchLectureDetail(env, userID, lectureID);
  let sourceText = studySourceText(detail);
  if (sourceText.length < 80) {
    const extractedText = await extractUploadedSourceText(env, detail.lecture);
    if (extractedText.length >= 80) {
      await persistExtractedSourceText(env, lectureID, extractedText, detail.lecture.source_type);
      detail = await fetchLectureDetail(env, userID, lectureID);
      sourceText = studySourceText(detail);
    }
  }
  if (sourceText.length < 80) {
    throw new HttpError(400, "This note needs more extracted text before study assets can be generated.");
  }

  const startedAt = new Date().toISOString();
  await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "generating_notes",
      error_message: null,
    }),
  });
  await setStudyAssetStatus(env, lectureID, "generating", null, {
    source: "ios-mobile-backend",
    startedAt,
  });

  try {
    let generationMode = "local-study-generator";
    let modelName: string | null = null;
    let generated: GeneratedStudyAssets | null = null;
    if (env.geminiAPIKey) {
      try {
        generated = await generateStudyAssetsWithGemini(env, detail.lecture, sourceText);
        generationMode = "gemini-study-generator";
        modelName = env.geminiTextModel;
      } catch {
        generated = null;
      }
    }
    generated ??= generateLocalStudyAssets(sourceText, detail.lecture.language_hint ?? "sl");
    await persistGeneratedStudyAssets(env, lectureID, generated, {
      mode: generationMode,
      model: modelName,
      generatedAt: new Date().toISOString(),
    });
    await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "ready",
        error_message: null,
      }),
    });
    return fetchLectureDetail(env, userID, lectureID);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Study generation failed.";
    await setStudyAssetStatus(env, lectureID, "failed", message, {
      source: "ios-mobile-backend",
      failedAt: new Date().toISOString(),
    }).catch(ignoreMissingTable);
    await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "ready",
        error_message: null,
      }),
    }).catch(ignoreMissingTable);
    throw error;
  }
}

async function generateStudyAssetsWithGemini(
  env: MobileEnv,
  lecture: LectureRow,
  sourceText: string,
): Promise<GeneratedStudyAssets> {
  const prompt = [
    "Create study material for the Memo iOS app from the source text.",
    "Return only valid JSON with these keys: summary, keyTopics, notesMarkdown, flashcards, quizQuestions, practiceQuestions.",
    "flashcards must contain 8-14 objects with front, back, hint, difficulty, sourceLocator.",
    "quizQuestions must contain 6-10 objects with prompt, options, correctOptionIndex, explanation, difficulty, sourceLocator. Each options array must have exactly 4 strings.",
    "practiceQuestions must contain 4-8 objects with prompt, answerGuide, difficulty, sourceLocator.",
    `Use ${lecture.language_hint === "sl" ? "Slovenian" : "the source language"} for the study content.`,
    "Do not invent facts. Use only the source text.",
    "",
    "Source text:",
    sourceText.slice(0, 24_000),
  ].join("\n");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiTextModel)}:generateContent?key=${encodeURIComponent(env.geminiAPIKey ?? "")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!response.ok) {
    const parsed = safeJSON(await response.text());
    throw new HttpError(response.status, errorMessage(parsed) ?? "Gemini study generation failed.");
  }
  const parsed = safeJSON(await response.text());
  const text = readGeminiText(parsed);
  const rawJSON = text ? safeJSON(text) : null;
  return normalizeGeneratedStudyAssets(rawJSON, sourceText, lecture.language_hint ?? "sl");
}

async function persistGeneratedStudyAssets(
  env: MobileEnv,
  lectureID: string,
  generated: GeneratedStudyAssets,
  metadata: Record<string, unknown>,
) {
  const generatedAt = new Date().toISOString();
  await postgrest(env, "/rest/v1/lecture_artifacts?on_conflict=lecture_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      lecture_id: lectureID,
      summary: generated.summary,
      key_topics: generated.keyTopics,
      structured_notes_md: generated.notesMarkdown,
      editable_notes_md: generated.notesMarkdown,
      editable_notes_plain: markdownToPlainText(generated.notesMarkdown),
      model_metadata: {
        source: "ios-mobile-backend",
        ...metadata,
      },
      generated_at: generatedAt,
    }),
  });

  await Promise.all([
    replaceRows(env, "flashcards", lectureID, generated.flashcards.map((card, index) => ({
      lecture_id: lectureID,
      idx: index,
      front: card.front,
      back: card.back,
      hint: card.hint,
      citations_json: [],
      difficulty: card.difficulty,
      section_id: null,
      source_unit_idx: card.sourceUnitIndex,
      card_kind: "recall",
      concept_key: card.conceptKey,
      source_type: "ios_generated",
      source_locator: card.sourceLocator,
      coverage_rank: index,
    }))),
    replaceRows(env, "quiz_questions", lectureID, generated.quizQuestions.map((question, index) => ({
      lecture_id: lectureID,
      idx: index,
      prompt: question.prompt,
      options_json: question.options,
      correct_option_idx: question.correctOptionIndex,
      explanation: question.explanation,
      difficulty: question.difficulty,
      source_locator: question.sourceLocator,
    }))),
    replaceRows(env, "practice_test_questions", lectureID, generated.practiceQuestions.map((question, index) => ({
      lecture_id: lectureID,
      idx: index,
      prompt: question.prompt,
      answer_guide: question.answerGuide,
      difficulty: question.difficulty,
      source_locator: question.sourceLocator,
      source_unit_idx: question.sourceUnitIndex,
      concept_key: question.conceptKey,
    }))).catch((error) => {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }),
  ]);

  await setStudyAssetStatus(env, lectureID, "ready", null, {
    source: "ios-mobile-backend",
    ...metadata,
    generatedAt,
  });
}

async function replaceRows(env: MobileEnv, table: string, lectureID: string, rows: Array<Record<string, unknown>>) {
  await postgrest(env, `/rest/v1/${table}?lecture_id=eq.${lectureID}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (rows.length === 0) {
    return;
  }
  await postgrest(env, `/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
}

async function setStudyAssetStatus(
  env: MobileEnv,
  lectureID: string,
  status: "generating" | "ready" | "failed",
  errorMessageValue: string | null,
  metadata: Record<string, unknown>,
) {
  const row = {
    lecture_id: lectureID,
    status,
    error_message: errorMessageValue,
    model_metadata: metadata,
    generated_at: new Date().toISOString(),
  };
  await Promise.all([
    upsertAssetStatus(env, "lecture_study_assets", row),
    upsertAssetStatus(env, "lecture_quiz_assets", row),
    upsertAssetStatus(env, "lecture_practice_test_assets", row).catch((error) => {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }),
  ]);
}

async function upsertAssetStatus(env: MobileEnv, table: string, row: Record<string, unknown>) {
  await postgrest(env, `/rest/v1/${table}?on_conflict=lecture_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
}

async function createGroundedChatReply(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  question: string,
) {
  const lecture = await requireOwnedLecture(env, userID, lectureID);
  const entitlement = await fetchEntitlementState(env, userID);
  if (!entitlement.hasPaidAccess && lecture.access_tier !== "trial") {
    throw new HttpError(402, "Chat is available for paid notes or your trial note.", "billing_required");
  }
  if (lecture.status !== "ready") {
    throw new HttpError(409, "Chat is available when the note is ready.");
  }
  if (!entitlement.hasPaidAccess) {
    const previousUserMessages = await listRows<{ id: string }>(env, "chat_messages", {
      select: "id",
      lecture_id: `eq.${lectureID}`,
      user_id: `eq.${userID}`,
      role: "eq.user",
    });
    if (previousUserMessages.length >= 5) {
      throw new HttpError(402, "You have used all 5 free messages for this chat.", "trial_chat_limit_reached");
    }
  }
  const detail = await fetchLectureDetail(env, userID, lectureID);
  const notes = typeof detail.artifact?.editable_notes_md === "string" && detail.artifact.editable_notes_md.trim()
    ? detail.artifact.editable_notes_md
    : typeof detail.artifact?.structured_notes_md === "string"
      ? detail.artifact.structured_notes_md
    : "";
  const answerText = notes
    ? await answerGroundedChat(env, notes, question.slice(0, 4_000), lecture.language_hint ?? "sl")
    : "This note is still being prepared, so I cannot answer from its study material yet.";

  await postgrest(env, "/rest/v1/chat_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      lecture_id: lectureID,
      user_id: userID,
      role: "user",
      content: question,
    }),
  });

  const rows = await postgrest<Array<{
    id: string;
    lecture_id: string;
    user_id: string;
    role: string;
    content: string;
    created_at: string;
  }>>(env, "/rest/v1/chat_messages?select=id,lecture_id,user_id,role,content,created_at", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      lecture_id: lectureID,
      user_id: userID,
      role: "assistant",
      content: answerText,
    }),
  });

  return rows[0] ?? null;
}

const NATIVE_TTS_FREE_LIMIT_SECONDS = 5 * 60;
const NATIVE_TTS_PAID_LIMIT_SECONDS = 60 * 60;
const NATIVE_TTS_WORDS_PER_CHUNK = 220;

type NativeTTSWord = { text: string; globalIndex: number };
type NativeTTSPlan = {
  words: NativeTTSWord[];
  chunks: Array<{
    chunkIndex: number;
    text: string;
    wordStartIndex: number;
    wordEndIndex: number;
    estimatedSeconds: number;
  }>;
  contentHash: string;
};

async function getNativeTTSStatus(env: MobileEnv, user: MobileUser, lectureID: string) {
  const lecture = await requireOwnedLecture(env, user.id, lectureID);
  const plan = await buildNativeTTSPlan(env, lectureID);
  const entitlement = await fetchEntitlementState(env, user.id);
  const unlimited = user.email?.trim().toLowerCase() === "nace.valencic@gmail.com";
  const limitSeconds = unlimited
    ? Number.MAX_SAFE_INTEGER
    : entitlement.hasPaidAccess
      ? NATIVE_TTS_PAID_LIMIT_SECONDS
      : NATIVE_TTS_FREE_LIMIT_SECONDS;
  const usageDate = new Date().toISOString().slice(0, 10);
  const usage = unlimited
    ? null
    : (await listRows<{ seconds_used: number }>(env, "tts_daily_usage", {
        select: "seconds_used",
        user_id: `eq.${user.id}`,
        usage_date: `eq.${usageDate}`,
        limit: "1",
      }).catch(() => []))[0] ?? null;
  const secondsUsed = unlimited ? 0 : Math.max(0, Number(usage?.seconds_used ?? 0));

  return {
    available: lecture.status === "ready" && plan.words.length > 0 && Boolean(env.sonioxAPIKey),
    reason: !env.sonioxAPIKey
      ? "Text-to-speech is not configured."
      : lecture.status !== "ready"
        ? "The note is still being prepared."
        : plan.words.length === 0
          ? "This note does not contain readable text."
          : null,
    tier: entitlement.hasPaidAccess ? "paid" : "trial",
    limitSeconds,
    secondsUsed,
    remainingSeconds: unlimited ? limitSeconds : Math.max(limitSeconds - secondsUsed, 0),
    hasUnlimitedUsage: unlimited,
    chunkCount: plan.chunks.length,
    totalWords: plan.words.length,
  };
}

async function getOrCreateNativeTTSChunk(
  env: MobileEnv,
  user: MobileUser,
  lectureID: string,
  body: Record<string, unknown>,
) {
  const lecture = await requireOwnedLecture(env, user.id, lectureID);
  if (lecture.status !== "ready") throw new HttpError(409, "The note is still being prepared.");
  if (!env.sonioxAPIKey) throw new HttpError(503, "Text-to-speech is not configured.");

  const plan = await buildNativeTTSPlan(env, lectureID);
  const chunkIndex = readInteger(body.chunkIndex, 0);
  const chunk = plan.chunks[chunkIndex];
  if (!chunk) throw new HttpError(400, "Invalid audio chunk.");
  const sessionID = requiredString(body.sessionId, "sessionId").slice(0, 200);
  const voice = (readString(body.voice)?.trim() || "Grace").slice(0, 100);
  const language = normalizeNativeTTSLanguage(lecture.language_hint);
  const model = env.sonioxTTSModel;
  const entitlement = await fetchEntitlementState(env, user.id);
  const unlimited = user.email?.trim().toLowerCase() === "nace.valencic@gmail.com";
  const limitSeconds = entitlement.hasPaidAccess ? NATIVE_TTS_PAID_LIMIT_SECONDS : NATIVE_TTS_FREE_LIMIT_SECONDS;

  const quota = unlimited
    ? {
        allowed: true,
        secondsUsed: 0,
        remainingSeconds: Number.MAX_SAFE_INTEGER,
        limitSeconds: Number.MAX_SAFE_INTEGER,
        chargedSeconds: 0,
      }
    : await postgrest<{
        allowed?: boolean;
        secondsUsed?: number;
        remainingSeconds?: number;
        limitSeconds?: number;
        chargedSeconds?: number;
        code?: string;
      }>(env, "/rest/v1/rpc/consume_tts_daily_quota", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_lecture_id: lectureID,
          p_session_id: sessionID,
          p_content_hash: plan.contentHash,
          p_chunk_index: chunkIndex,
          p_usage_date: new Date().toISOString().slice(0, 10),
          p_seconds: chunk.estimatedSeconds,
          p_limit_seconds: limitSeconds,
        }),
      });
  if (!quota.allowed) {
    throw new HttpError(402, "The daily listening limit has been reached.", quota.code ?? "tts_daily_limit_reached");
  }

  const select = "lecture_id,content_hash,chunk_index,text,word_start_index,word_end_index,language,voice,model,audio_storage_path,audio_mime_type,duration_ms,alignment_json";
  const cached = (await listRows<MobileTTSChunkRow>(env, "lecture_tts_chunks", {
    select,
    lecture_id: `eq.${lectureID}`,
    content_hash: `eq.${plan.contentHash}`,
    chunk_index: `eq.${chunkIndex}`,
    language: `eq.${language}`,
    voice: `eq.${voice}`,
    model: `eq.${model}`,
    limit: "1",
  }))[0] ?? null;
  const row = cached ?? await generateNativeTTSChunk(env, user.id, lectureID, plan, chunk, language, voice, model);

  return {
    audioUrl: await createSignedDownload(env, STORAGE_BUCKET, row.audio_storage_path),
    chunkIndex: row.chunk_index,
    chunkCount: plan.chunks.length,
    wordStartIndex: row.word_start_index,
    wordEndIndex: row.word_end_index,
    durationMs: row.duration_ms,
    alignment: Array.isArray(row.alignment_json) ? row.alignment_json : [],
    limitSeconds: Number(quota.limitSeconds ?? limitSeconds),
    secondsUsed: Number(quota.secondsUsed ?? 0),
    remainingSeconds: Number(quota.remainingSeconds ?? Math.max(limitSeconds - Number(quota.secondsUsed ?? 0), 0)),
    hasUnlimitedUsage: unlimited,
  };
}

async function buildNativeTTSPlan(env: MobileEnv, lectureID: string): Promise<NativeTTSPlan> {
  const artifact = (await listRows<LectureArtifactRow>(env, "lecture_artifacts", {
    select: "lecture_id,summary,key_topics,structured_notes_md,editable_notes_md,editable_notes_doc,editable_notes_revision,editable_notes_updated_at,generated_at",
    lecture_id: `eq.${lectureID}`,
    limit: "1",
  }))[0] ?? null;
  const markdown = artifact?.editable_notes_md?.trim() || artifact?.structured_notes_md?.trim() || "";
  const plain = markdownToPlainText(markdown).replace(/\s+/g, " ").trim();
  const words = plain
    ? plain.split(" ").filter(Boolean).map((text, globalIndex) => ({ text, globalIndex }))
    : [];
  const chunks: NativeTTSPlan["chunks"] = [];
  for (let start = 0; start < words.length; start += NATIVE_TTS_WORDS_PER_CHUNK) {
    const end = Math.min(start + NATIVE_TTS_WORDS_PER_CHUNK, words.length);
    const text = words.slice(start, end).map((word) => word.text).join(" ");
    chunks.push({
      chunkIndex: chunks.length,
      text,
      wordStartIndex: start,
      wordEndIndex: end,
      estimatedSeconds: Math.max(1, Math.ceil(words.slice(start, end).length / 2.35)),
    });
  }
  return {
    words,
    chunks,
    contentHash: createHash("sha256").update(plain).digest("hex"),
  };
}

async function generateNativeTTSChunk(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  plan: NativeTTSPlan,
  chunk: NativeTTSPlan["chunks"][number],
  language: string,
  voice: string,
  model: string,
) {
  const audio = await getSonioxClient(env).tts.generate({
    text: chunk.text,
    model,
    language,
    voice,
    audio_format: "mp3",
    bitrate: 64_000,
  });
  const durationMs = chunk.estimatedSeconds * 1000;
  const wordCount = Math.max(chunk.wordEndIndex - chunk.wordStartIndex, 1);
  const alignment = plan.words.slice(chunk.wordStartIndex, chunk.wordEndIndex).map((word, offset) => ({
    wordIndex: word.globalIndex,
    startMs: Math.floor((offset / wordCount) * durationMs),
    endMs: Math.floor(((offset + 1) / wordCount) * durationMs),
  }));
  const path = `${userID}/${lectureID}/tts/${plan.contentHash}/${chunk.chunkIndex}-${createHash("sha256").update(`${model}:${voice}`).digest("hex").slice(0, 12)}.mp3`;
  await uploadStorageObject(env, STORAGE_BUCKET, path, Buffer.from(audio), "audio/mpeg");
  const rows = await postgrest<MobileTTSChunkRow[]>(env, `/rest/v1/lecture_tts_chunks?on_conflict=lecture_id,content_hash,chunk_index,language,voice,model&select=lecture_id,content_hash,chunk_index,text,word_start_index,word_end_index,language,voice,model,audio_storage_path,audio_mime_type,duration_ms,alignment_json`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      lecture_id: lectureID,
      content_hash: plan.contentHash,
      chunk_index: chunk.chunkIndex,
      text: chunk.text,
      word_start_index: chunk.wordStartIndex,
      word_end_index: chunk.wordEndIndex,
      language,
      voice,
      model,
      audio_storage_path: path,
      audio_mime_type: "audio/mpeg",
      duration_ms: durationMs,
      alignment_json: alignment,
    }),
  });
  const row = rows[0];
  if (!row) throw new HttpError(500, "Could not save generated audio.");
  return row;
}

function normalizeNativeTTSLanguage(value: string | null) {
  const normalized = (value || "sl").trim().toLowerCase().replace("_", "-");
  return normalized.split("-")[0] || "sl";
}

async function answerGroundedChat(env: MobileEnv, notes: string, question: string, language: string) {
  if (env.geminiAPIKey) {
    const prompt = [
      "Answer the student's question using only the supplied lecture notes.",
      "If the notes do not support an answer, say so clearly. Do not invent facts.",
      `Reply in ${language === "sl" ? "Slovenian" : "the language of the question"}.`,
      `Question: ${question}`,
      "Lecture notes:",
      notes.slice(0, 28_000),
    ].join("\n");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiTextModel)}:generateContent?key=${encodeURIComponent(env.geminiAPIKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.15, maxOutputTokens: 1200 },
        }),
      },
    );
    if (response.ok) {
      const generated = readGeminiText(safeJSON(await response.text()));
      if (generated?.trim()) return generated.trim();
    }
  }
  return answerFromNotes(notes, question);
}

async function deleteLectures(env: MobileEnv, userID: string, lectureIDs: string[]) {
  const lectureRows = await listRows<LectureRow>(env, "lectures", {
    select: "id,storage_path,processing_metadata",
    user_id: `eq.${userID}`,
    id: `in.(${lectureIDs.join(",")})`,
  });

  if (lectureRows.length === 0) {
    throw new HttpError(404, "No note was found.");
  }

  const ownedIDs = lectureRows.map((row) => row.id);
  const noteMediaRows = await listRows<{ storage_path: string | null }>(env, "lecture_note_media", {
    select: "storage_path",
    user_id: `eq.${userID}`,
    lecture_id: `in.(${ownedIDs.join(",")})`,
  }).catch((error) => {
    if (isMissingTableError(error)) {
      return [];
    }
    throw error;
  });

  await postgrest(env, `/rest/v1/lectures?user_id=eq.${userID}&id=in.(${ownedIDs.join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  const storagePaths = collectStoragePaths(lectureRows, noteMediaRows);
  if (storagePaths.length > 0) {
    try {
      await removeStorageObjects(env, "lecture-audio", storagePaths);
    } catch (error) {
      // The database row is already deleted at this point. The web route also
      // treats storage cleanup as best effort, so never report a failed delete
      // (or leave a stale native row) because an orphan cleanup was transient.
      console.warn("Lecture deleted but storage cleanup failed", {
        lectureIDs: ownedIDs,
        error,
      });
    }
  }

  return ownedIDs.length;
}

async function requireOwnedLecture(env: MobileEnv, userID: string, lectureID: string) {
  const rows = await listRows<LectureRow>(env, "lectures", {
    select: "*",
    id: `eq.${lectureID}`,
    user_id: `eq.${userID}`,
    limit: "1",
  });
  const lecture = rows[0];
  if (!lecture) {
    throw new HttpError(404, "No note was found.");
  }
  return lecture;
}

async function claimTrialIfNeeded(
  env: MobileEnv,
  userID: string,
  lectureID: string,
  hasPaidAccess: boolean,
) {
  if (hasPaidAccess) {
    return;
  }

  const result = await postgrest<{ allowed?: boolean; mode?: string; code?: string }>(
    env,
    "/rest/v1/rpc/claim_trial_lecture",
    {
      method: "POST",
      body: JSON.stringify({
        p_user_id: userID,
        p_lecture_id: lectureID,
      }),
    },
  );

  if (!result.allowed) {
    await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
      method: "DELETE",
    });
    throw new HttpError(402, "The free trial has already been used.", result.code ?? "trial_exhausted");
  }

  if (result.mode === "paid") {
    await postgrest(env, `/rest/v1/lectures?id=eq.${lectureID}&user_id=eq.${userID}`, {
      method: "PATCH",
      body: JSON.stringify({ access_tier: "paid" }),
    });
  }
}

async function listRows<T>(
  env: MobileEnv,
  table: string,
  query: Record<string, string>,
) {
  const params = new URLSearchParams(query);
  return postgrest<T[]>(env, `/rest/v1/${table}?${params.toString()}`);
}

async function deleteByUser(env: MobileEnv, table: string, userID: string) {
  await postgrest(env, `/rest/v1/${table}?user_id=eq.${userID}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function deleteByID(env: MobileEnv, table: string, id: string) {
  await postgrest(env, `/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function postgrest<T = unknown>(
  env: MobileEnv,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("apikey", env.supabaseServiceRoleKey);
  headers.set("Authorization", `Bearer ${env.supabaseServiceRoleKey}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${env.supabaseURL}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const parsed = text ? safeJSON(text) : null;

  if (!response.ok) {
    const message = errorMessage(parsed) ?? response.statusText;
    throw new HttpError(response.status, message);
  }

  return (parsed ?? {}) as T;
}

async function createSignedUpload(
  env: MobileEnv,
  bucket: string,
  path: string,
): Promise<SignedUploadTarget> {
  const response = await fetch(
    `${env.supabaseURL}/storage/v1/object/upload/sign/${bucket}/${encodeStoragePath(path)}`,
    {
      method: "POST",
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-upsert": "true",
      },
      body: JSON.stringify({}),
    },
  );
  const parsed = safeJSON(await response.text());
  if (!response.ok) {
    throw new HttpError(response.status, errorMessage(parsed) ?? "Could not prepare upload.");
  }
  const relativeURL = isRecord(parsed) ? readString(parsed.url) : null;
  const token = isRecord(parsed)
    ? readString(parsed.token) ?? (relativeURL ? new URL(relativeURL, env.supabaseURL).searchParams.get("token") : null)
    : null;
  const signedPath = isRecord(parsed) ? readString(parsed.path) ?? path : path;
  if (!token) {
    throw new HttpError(500, "Supabase did not return an upload token.");
  }
  const signedUrl = relativeURL
    ? resolveSupabaseStorageURL(env, relativeURL)
    : `${env.supabaseURL}/storage/v1/object/upload/sign/${bucket}/${encodeStoragePath(path)}?token=${encodeURIComponent(token)}`;

  return {
    path: signedPath,
    token,
    signedUrl,
  };
}

async function createSignedDownload(env: MobileEnv, bucket: string, path: string) {
  const response = await fetch(
    `${env.supabaseURL}/storage/v1/object/sign/${bucket}/${encodeStoragePath(path)}`,
    {
      method: "POST",
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ expiresIn: 60 * 60 }),
    },
  );
  const parsed = safeJSON(await response.text());
  if (!response.ok) {
    throw new HttpError(response.status, errorMessage(parsed) ?? "Could not open the photo.");
  }
  const relativeURL = isRecord(parsed)
    ? readString(parsed.signedURL) ?? readString(parsed.signedUrl)
    : null;
  if (!relativeURL) throw new HttpError(500, "Supabase did not return a signed photo URL.");
  return resolveSupabaseStorageURL(env, relativeURL);
}

function resolveSupabaseStorageURL(env: MobileEnv, value: string) {
  // The raw Storage REST API returns paths beginning with `/object/...`, while
  // the public endpoint is mounted below `/storage/v1`. The Supabase JS client
  // normally adds this prefix for web; the mobile adapter must do it itself.
  const normalized = value.startsWith("/object/") ? `/storage/v1${value}` : value;
  return new URL(normalized, env.supabaseURL).toString();
}

async function authenticate(env: MobileEnv, accessToken: string) {
  const response = await fetch(`${env.supabaseURL}/auth/v1/user`, {
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const parsed = safeJSON(await response.text());
  if (!response.ok) {
    throw new HttpError(401, "Invalid or expired mobile session.");
  }

  const id = readString((parsed as { id?: unknown }).id);
  if (!id) {
    throw new HttpError(401, "Invalid mobile session.");
  }

  return {
    id,
    email: readString((parsed as { email?: unknown }).email) ?? null,
  };
}

async function supabaseAuthAdminDelete(env: MobileEnv, userID: string) {
  const response = await fetch(`${env.supabaseURL}/auth/v1/admin/users/${userID}`, {
    method: "DELETE",
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok && response.status !== 404) {
    const parsed = safeJSON(await response.text());
    throw new HttpError(response.status, errorMessage(parsed) ?? "Could not delete Supabase user.");
  }
}

async function removeStorageObjects(env: MobileEnv, bucket: string, paths: string[]) {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (uniquePaths.length === 0) {
    return;
  }

  const response = await fetch(`${env.supabaseURL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ prefixes: uniquePaths }),
  });

  if (!response.ok) {
    const parsed = safeJSON(await response.text());
    throw new HttpError(response.status, errorMessage(parsed) ?? "Could not delete uploaded files.");
  }
}

/// Delete every object stored under `<prefix>/` in a bucket, paging through the
/// listing until it is exhausted. Used by account deletion so uploads that were
/// never linked back to a lecture row still go away with the account.
async function removeStorageObjectsUnderPrefix(
  env: MobileEnv,
  bucket: string,
  prefix: string,
) {
  const pageSize = 100;
  // Bound the sweep so a pathological account cannot spin forever; each pass
  // deletes what it lists, so the listing shrinks on every iteration.
  for (let pass = 0; pass < 100; pass += 1) {
    const response = await fetch(`${env.supabaseURL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ prefix, limit: pageSize, offset: 0 }),
    });

    if (!response.ok) {
      // Storage cleanup must not block deleting the account itself; the
      // relational rows and the auth user are the parts a user can observe.
      return;
    }

    const parsed = safeJSON(await response.text());
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return;
    }

    const paths = parsed
      .map((entry) => (isRecord(entry) && typeof entry.name === "string" ? `${prefix}/${entry.name}` : null))
      .filter((path): path is string => Boolean(path));

    if (paths.length === 0) {
      return;
    }

    await removeStorageObjects(env, bucket, paths);

    if (parsed.length < pageSize) {
      return;
    }
  }
}

function collectStoragePaths(
  lectures: Array<Pick<LectureRow, "storage_path" | "processing_metadata">>,
  noteMediaRows: Array<{ storage_path: string | null }>,
) {
  return [
    ...lectures.map((lecture) => lecture.storage_path).filter((path): path is string => Boolean(path)),
    ...lectures.flatMap((lecture) => parseAudioChunkPaths(lecture.processing_metadata)),
    ...lectures.flatMap((lecture) => extractScanImageStoragePaths(lecture.processing_metadata)),
    ...noteMediaRows.map((row) => row.storage_path).filter((path): path is string => Boolean(path)),
  ];
}

function parseAudioChunkPaths(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.audioChunks)) {
    return [];
  }
  return value.audioChunks
    .map((item) => (isRecord(item) && typeof item.path === "string" ? item.path : null))
    .filter((path): path is string => Boolean(path));
}

function extractScanImageStoragePaths(value: unknown) {
  if (!isRecord(value)) {
    return [];
  }
  const pendingScanImages = Array.isArray(value.pendingScanImages) ? value.pendingScanImages : [];
  const manualImport = isRecord(value.manualImport) ? value.manualImport : null;
  const modelMetadata = manualImport && isRecord(manualImport.modelMetadata)
    ? manualImport.modelMetadata
    : null;
  const sourceImageUploads = modelMetadata && Array.isArray(modelMetadata.sourceImageUploads)
    ? modelMetadata.sourceImageUploads
    : [];

  return [...pendingScanImages, ...sourceImageUploads]
    .map((item) => (isRecord(item) && typeof item.path === "string" ? item.path : null))
    .filter((path): path is string => Boolean(path));
}

function verifyAndDecodeStoreKitPayload(env: MobileEnv, jws: string): DecodedStoreKitPayload {
  return verifyAndDecodeAppStoreJWS<DecodedStoreKitPayload>(env, jws, "StoreKit transaction");
}

function verifyAndDecodeAppStoreNotificationPayload(
  env: MobileEnv,
  jws: string,
): DecodedAppStoreNotificationPayload {
  return verifyAndDecodeAppStoreJWS<DecodedAppStoreNotificationPayload>(env, jws, "App Store notification");
}

function verifyAndDecodeAppStoreJWS<T extends Record<string, unknown>>(
  env: MobileEnv,
  jws: string,
  purpose: string,
): T {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new HttpError(400, `Invalid ${purpose} JWS.`, "invalid_jws");
  }
  const header = safeJSON(Buffer.from(base64urlToBase64(parts[0]), "base64").toString("utf8"));
  const payload = safeJSON(Buffer.from(base64urlToBase64(parts[1]), "base64").toString("utf8"));
  if (!isRecord(header)) {
    throw new HttpError(400, `Invalid ${purpose} JWS header.`, "invalid_jws_header");
  }
  if (!isRecord(payload)) {
    throw new HttpError(400, `Invalid ${purpose} JWS payload.`, "invalid_jws_payload");
  }

  if (env.appStoreJWSVerificationMode === "strict") {
    verifyAppStoreJWSSignature({
      header: header as DecodedJWSHeader,
      signedContent: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(base64urlToBase64(parts[2]), "base64"),
      trustedRoots: env.appleRootCertificates,
      purpose,
    });
  }

  return payload as T;
}

function verifyAppStoreJWSSignature(params: {
  header: DecodedJWSHeader;
  signedContent: string;
  signature: Buffer;
  trustedRoots: X509Certificate[];
  purpose: string;
}) {
  if (params.trustedRoots.length === 0) {
    throw new HttpError(500, "Missing Apple root certificates for StoreKit JWS verification.");
  }
  if (params.header.alg !== "ES256") {
    throw new HttpError(400, `Unsupported ${params.purpose} JWS algorithm.`, "unsupported_jws_algorithm");
  }
  const chain = parseJWSX5CChain(params.header.x5c, params.purpose);
  validateCertificateChain(chain, params.trustedRoots, params.purpose);

  const verifier = createVerify("sha256");
  verifier.update(params.signedContent);
  verifier.end();
  const ok = verifier.verify(
    {
      key: chain[0].publicKey,
      dsaEncoding: "ieee-p1363",
    },
    params.signature,
  );
  if (!ok) {
    throw new HttpError(400, `${params.purpose} JWS signature is invalid.`, "invalid_jws_signature");
  }
}

function parseJWSX5CChain(value: unknown, purpose: string) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new HttpError(400, `${purpose} JWS is missing the Apple certificate chain.`, "missing_x5c");
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || entry.length < 100) {
      throw new HttpError(400, `${purpose} JWS contains an invalid certificate.`, "invalid_x5c");
    }
    try {
      return new X509Certificate(Buffer.from(entry, "base64"));
    } catch {
      throw new HttpError(400, `${purpose} JWS contains an unreadable certificate.`, "invalid_x5c");
    }
  });
}

function validateCertificateChain(chain: X509Certificate[], trustedRoots: X509Certificate[], purpose: string) {
  const now = Date.now();
  for (const certificate of chain) {
    assertCertificateDateValid(certificate, now, purpose);
  }
  for (let index = 0; index < chain.length - 1; index += 1) {
    const child = chain[index];
    const issuer = chain[index + 1];
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) {
      throw new HttpError(400, `${purpose} JWS certificate chain is invalid.`, "invalid_x5c_chain");
    }
  }
  const last = chain[chain.length - 1];
  const trusted = trustedRoots.some((root) => {
    assertCertificateDateValid(root, now, purpose);
    if (last.fingerprint256 === root.fingerprint256) {
      return true;
    }
    return last.checkIssued(root) && last.verify(root.publicKey);
  });
  if (!trusted) {
    throw new HttpError(400, `${purpose} JWS certificate chain is not anchored by a configured Apple root.`, "untrusted_x5c_root");
  }
}

function assertCertificateDateValid(certificate: X509Certificate, now: number, purpose: string) {
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if ((Number.isFinite(validFrom) && now < validFrom) || (Number.isFinite(validTo) && now > validTo)) {
    throw new HttpError(400, `${purpose} JWS certificate is outside its validity period.`, "expired_x5c");
  }
}

function assertAppStoreNotificationToken(env: MobileEnv, req: IncomingMessage, url: URL) {
  if (!env.appStoreNotificationToken) {
    throw new HttpError(500, "App Store notification token is not configured.", "missing_app_store_notification_token");
  }
  const header = req.headers["x-memo-app-store-notification-token"];
  const headerToken = Array.isArray(header) ? header[0] : header;
  const token = headerToken ?? url.searchParams.get("token") ?? "";
  if (token !== env.appStoreNotificationToken) {
    throw new HttpError(401, "Invalid App Store notification token.");
  }
}

function notificationEntitlementStatus(
  notificationType: string | undefined,
  transaction: DecodedStoreKitPayload | null,
): "active" | "expired" | "revoked" | "pending_verification" | undefined {
  switch (notificationType) {
    case "REFUND":
    case "REVOKE":
      return "revoked";
    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
      return "expired";
    case "SUBSCRIBED":
    case "DID_RENEW":
    case "REFUND_REVERSED":
    case "RENEWAL_EXTENDED":
      return "active";
    default:
      if (transaction?.revocationDate) {
        return "revoked";
      }
      if (transaction?.expiresDate && transaction.expiresDate <= Date.now()) {
        return "expired";
      }
      return undefined;
  }
}

function assertPayloadMatches(params: {
  payload: DecodedStoreKitPayload;
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  bundleID?: string;
}) {
  if (params.payload.productId && params.payload.productId !== params.productId) {
    throw new HttpError(400, "StoreKit product id does not match the signed payload.", "product_mismatch");
  }
  if (params.payload.transactionId && params.payload.transactionId !== params.transactionId) {
    throw new HttpError(400, "StoreKit transaction id does not match the signed payload.", "transaction_mismatch");
  }
  if (
    params.payload.originalTransactionId &&
    params.payload.originalTransactionId !== params.originalTransactionId
  ) {
    throw new HttpError(400, "StoreKit original transaction id does not match the signed payload.", "transaction_mismatch");
  }
  if (params.bundleID && params.payload.bundleId && params.payload.bundleId !== params.bundleID) {
    throw new HttpError(400, "StoreKit bundle id does not match this app.", "bundle_mismatch");
  }
}

function dateFromAppleMillis(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value).toISOString();
}

function normalizeStoreKitEnvironment(value: unknown): "sandbox" | "production" {
  return typeof value === "string" && value.toLowerCase() === "sandbox" ? "sandbox" : "production";
}

function titleFromText(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  if (!firstLine) {
    return "Text note";
  }
  return firstLine.length > 80 ? `${firstLine.slice(0, 77).trim()}...` : firstLine;
}

function summarizeText(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 240) {
    return clean || "Imported text note.";
  }
  const sentence = clean.match(/^(.{80,240}?[.!?])\s/)?.[1];
  return sentence ?? `${clean.slice(0, 237).trim()}...`;
}

function extractKeyTopics(text: string) {
  const headings = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 48)
    .slice(0, 6);
  return headings.length > 0 ? headings : ["Imported text"];
}

function answerFromNotes(notes: string, question: string) {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9čšžćđ]+/i)
    .filter((word) => word.length > 3);
  const paragraphs = notes
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const best = paragraphs.find((paragraph) => {
    const lower = paragraph.toLowerCase();
    return words.some((word) => lower.includes(word));
  });
  if (best) {
    return best.length > 1200 ? `${best.slice(0, 1197).trim()}...` : best;
  }
  return "I could not find a direct match in the note. Try asking with terms that appear in the generated notes.";
}

function studySourceText(detail: {
  lecture: LectureRow;
  artifact: LectureArtifactRow | null;
  transcript: unknown[];
}) {
  const artifactNotes = detail.artifact
    ? detail.artifact.editable_notes_md ?? detail.artifact.structured_notes_md
    : "";
  const usableArtifactNotes = isPlaceholderUploadNotes(artifactNotes) ? "" : artifactNotes;
  const transcriptText = Array.isArray(detail.transcript)
    ? detail.transcript
        .map((segment) => (isRecord(segment) ? readString(segment.text) : null))
        .filter((text): text is string => Boolean(text))
        .join("\n\n")
    : "";
  const parts = [usableArtifactNotes];
  if (transcriptText && !usableArtifactNotes.includes(transcriptText.slice(0, 240))) {
    parts.push(transcriptText);
  }
  return parts
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 32_000);
}

function isPlaceholderUploadNotes(notes: string) {
  return /Full AI extraction for this source type should run on the mobile backend before App Store release\./i.test(notes);
}

async function extractUploadedSourceText(env: MobileEnv, lecture: LectureRow) {
  const metadata = isRecord(lecture.processing_metadata) ? lecture.processing_metadata : {};
  const mobileUpload = isRecord(metadata.mobileUpload) ? metadata.mobileUpload : {};
  const scanPaths = lecture.source_type === "scan" ? extractScanImageStoragePaths(metadata).slice(0, MAX_SCAN_IMAGES) : [];
  if (scanPaths.length > 0) {
    return extractScanImagesWithGemini(env, lecture, scanPaths);
  }

  const path = lecture.storage_path ?? readString(mobileUpload.storagePath);
  if (!path) {
    return "";
  }
  assertOwnedStoragePath(lecture.user_id, lecture.id, path);
  const mimeType = readString(mobileUpload.mimeType) ?? mimeTypeFromStoragePath(path);
  const buffer = await downloadStorageObject(env, STORAGE_BUCKET, path, MAX_INLINE_AI_SOURCE_BYTES);
  if (!buffer) {
    return "";
  }
  const text = textFromKnownDocumentBuffer(buffer, mimeType);
  if (text.length >= 80) {
    return text;
  }
  if (!env.geminiAPIKey) {
    return "";
  }
  return extractTextWithGeminiInline(env, [
    {
      data: buffer,
      mimeType,
    },
  ], promptForSourceExtraction(lecture.source_type));
}

async function extractScanImagesWithGemini(env: MobileEnv, lecture: LectureRow, scanPaths: string[]) {
  if (!env.geminiAPIKey) {
    return "";
  }
  const files: Array<{ data: Buffer; mimeType: string }> = [];
  for (const path of scanPaths) {
    assertOwnedStoragePath(lecture.user_id, lecture.id, path);
    const data = await downloadStorageObject(env, STORAGE_BUCKET, path, MAX_SCAN_IMAGE_BYTES);
    if (data) {
      files.push({
        data,
        mimeType: mimeTypeFromStoragePath(path),
      });
    }
  }
  if (files.length === 0) {
    return "";
  }
  return extractTextWithGeminiInline(env, files, promptForSourceExtraction("scan"));
}

async function extractTextWithGeminiInline(
  env: MobileEnv,
  files: Array<{ data: Buffer; mimeType: string }>,
  prompt: string,
) {
  const totalBytes = files.reduce((total, file) => total + file.data.byteLength, 0);
  if (!env.geminiAPIKey || totalBytes > MAX_INLINE_AI_SOURCE_BYTES) {
    return "";
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiTextModel)}:generateContent?key=${encodeURIComponent(env.geminiAPIKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            ...files.map((file) => ({
              inlineData: {
                mimeType: file.mimeType,
                data: file.data.toString("base64"),
              },
            })),
          ],
        }],
        generationConfig: {
          temperature: 0,
        },
      }),
    },
  );
  if (!response.ok) {
    return "";
  }
  const parsed = safeJSON(await response.text());
  return cleanExtractedText(readGeminiText(parsed) ?? "");
}

async function persistExtractedSourceText(
  env: MobileEnv,
  lectureID: string,
  extractedText: string,
  sourceType: string,
) {
  const notes = cleanExtractedText(extractedText);
  await postgrest(env, "/rest/v1/lecture_artifacts?on_conflict=lecture_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      lecture_id: lectureID,
      summary: summarizeText(notes),
      key_topics: extractKeyTopics(notes),
      structured_notes_md: notes,
      editable_notes_md: notes,
      editable_notes_plain: markdownToPlainText(notes),
      model_metadata: {
        source: "ios-mobile-backend",
        generationMode: "mobile-source-extraction",
        sourceType,
        extractedAt: new Date().toISOString(),
      },
    }),
  });
  await replaceRows(env, "transcript_segments", lectureID, [{
    lecture_id: lectureID,
    idx: 0,
    start_ms: 0,
    end_ms: Math.max(1000, Math.min(notes.length * 45, 60 * 60 * 1000)),
    speaker_label: sourceType === "audio" ? "Audio transcript" : "Extracted text",
    text: notes,
  }]);
}

async function downloadStorageObject(env: MobileEnv, bucket: string, path: string, maxBytes: number) {
  const response = await fetch(`${env.supabaseURL}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`, {
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new HttpError(response.status, "Could not read the uploaded source file.");
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.byteLength <= maxBytes ? buffer : null;
}

/// Copies bytes into an ArrayBuffer-backed view, which is what `fetch` accepts
/// as a body under the DOM lib types.
function toRequestBytes(data: Buffer) {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return bytes;
}

async function uploadStorageObject(
  env: MobileEnv,
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string,
) {
  const response = await fetch(`${env.supabaseURL}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`, {
    method: "POST",
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    // A `Buffer` (or a view onto one) is not a `BodyInit` under the DOM lib
    // types, which require the bytes to be backed by a plain ArrayBuffer.
    body: toRequestBytes(data),
  });
  if (!response.ok) {
    const parsed = safeJSON(await response.text());
    throw new HttpError(response.status, errorMessage(parsed) ?? "Could not store generated audio.");
  }
}

function textFromKnownDocumentBuffer(buffer: Buffer, mimeType: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("text/plain") || normalized === "text/markdown") {
    return cleanExtractedText(buffer.toString("utf8"));
  }
  if (normalized === "text/html" || normalized === "application/xhtml+xml") {
    return cleanExtractedText(htmlToText(buffer.toString("utf8")));
  }
  if (normalized === "application/rtf" || normalized === "text/rtf") {
    return cleanExtractedText(buffer.toString("utf8").replace(/\\'[0-9a-f]{2}/gi, " ").replace(/[{}\\][a-z0-9-]*\s?/gi, " "));
  }
  return "";
}

function promptForSourceExtraction(sourceType: string) {
  if (sourceType === "scan") {
    return "Extract the readable study text from these scan images. Return only clean plain text in the original language. Preserve headings, lists, formulas, and important terms. Do not describe the image.";
  }
  if (sourceType === "audio") {
    return "Transcribe this lecture audio into clean study text in the original language. Return only the transcript text. Preserve important terms and structure when possible.";
  }
  return "Extract the readable study text from this uploaded document. Return only clean plain text in the original language. Preserve headings, lists, formulas, and important terms.";
}

function cleanExtractedText(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function generateLocalStudyAssets(sourceText: string, languageHint: string): GeneratedStudyAssets {
  const isSlovenian = languageHint === "sl";
  const units = sourceUnits(sourceText);
  const keyTopics = studyKeyTopics(sourceText, units);
  const summary = summarizeText(sourceText);
  const fallbackUnit = units[0] ?? summary;
  const selectedUnits = (units.length > 0 ? units : [fallbackUnit]).slice(0, 12);
  const notesMarkdown = [
    `# ${isSlovenian ? "Študijski zapiski" : "Study notes"}`,
    "",
    `## ${isSlovenian ? "Povzetek" : "Summary"}`,
    summary,
    "",
    `## ${isSlovenian ? "Ključne teme" : "Key topics"}`,
    ...keyTopics.map((topic) => `- ${topic}`),
    "",
    `## ${isSlovenian ? "Razlaga" : "Explanation"}`,
    ...selectedUnits.slice(0, 8).map((unit, index) => {
      const topic = keyTopics[index % keyTopics.length] ?? `${isSlovenian ? "Tema" : "Topic"} ${index + 1}`;
      return `### ${topic}\n\n${unit}`;
    }),
  ].join("\n");

  const flashcards = selectedUnits.slice(0, 12).map((unit, index) => {
    const topic = keyTopics[index % keyTopics.length] ?? `${isSlovenian ? "tema" : "topic"} ${index + 1}`;
    return {
      front: isSlovenian ? `Kaj je najpomembnejše pri temi "${topic}"?` : `What is the key point about "${topic}"?`,
      back: compactUnit(unit, 420),
      hint: compactUnit(topic, 120),
      difficulty: difficultyForIndex(index),
      sourceLocator: `${isSlovenian ? "Vir" : "Source"} ${index + 1}`,
      sourceUnitIndex: index,
      conceptKey: slugifyConcept(topic, index),
    };
  });

  const quizQuestions = selectedUnits.slice(0, 8).map((unit, index) => {
    const topic = keyTopics[index % keyTopics.length] ?? `${isSlovenian ? "tema" : "topic"} ${index + 1}`;
    const correct = compactUnit(unit, 180);
    const options = quizOptions(correct, selectedUnits, index, isSlovenian);
    return {
      prompt: isSlovenian ? `Katera trditev najbolje povzame "${topic}"?` : `Which statement best summarizes "${topic}"?`,
      options,
      correctOptionIndex: 0,
      explanation: correct,
      difficulty: difficultyForIndex(index),
      sourceLocator: `${isSlovenian ? "Vir" : "Source"} ${index + 1}`,
    };
  });

  const practiceQuestions = selectedUnits.slice(0, 8).map((unit, index) => {
    const topic = keyTopics[index % keyTopics.length] ?? `${isSlovenian ? "tema" : "topic"} ${index + 1}`;
    return {
      prompt: isSlovenian ? `Razloži temo "${topic}" s svojimi besedami.` : `Explain "${topic}" in your own words.`,
      answerGuide: compactUnit(unit, 520),
      difficulty: difficultyForIndex(index),
      sourceLocator: `${isSlovenian ? "Vir" : "Source"} ${index + 1}`,
      sourceUnitIndex: index,
      conceptKey: slugifyConcept(topic, index),
    };
  });

  return {
    summary,
    keyTopics,
    notesMarkdown,
    flashcards,
    quizQuestions,
    practiceQuestions,
  };
}

function sourceUnits(text: string) {
  const cleaned = text
    .replace(/[#*_`>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const paragraphs = text
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZČŠŽĆĐ0-9])/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 50);
  const units = uniqueStrings(paragraphs.length >= 3 ? paragraphs : cleaned.match(/.{80,520}(?:\s|$)/g) ?? [cleaned]);
  return units.map((unit) => compactUnit(unit, 650)).filter((unit) => unit.length >= 40).slice(0, 16);
}

function studyKeyTopics(text: string, units: string[]) {
  const headingTopics = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 56)
    .slice(0, 8);
  const fromUnits = units
    .map((unit) => {
      const words = unit.match(/[A-ZČŠŽĆĐ][A-Za-zČŠŽĆĐčšžćđ0-9-]{2,}(?:\s+[A-ZČŠŽĆĐ][A-Za-zČŠŽĆĐčšžćđ0-9-]{2,})?/g);
      return words?.[0] ?? unit.split(/\s+/).slice(0, 4).join(" ");
    })
    .map((topic) => topic.replace(/[.,:;!?]+$/g, "").trim())
    .filter((topic) => topic.length >= 3 && topic.length <= 56);
  const topics = uniqueStrings([...headingTopics, ...fromUnits]).slice(0, 8);
  return topics.length > 0 ? topics : ["Imported text"];
}

function quizOptions(correct: string, units: string[], index: number, isSlovenian: boolean) {
  const distractors = units
    .filter((_, unitIndex) => unitIndex !== index)
    .map((unit) => compactUnit(unit, 180));
  const fallback = isSlovenian
    ? ["Tema ni navedena v zapiskih.", "Trditev se nanaša na nepovezan primer.", "Besedilo tega ne podpira."]
    : ["The topic is not stated in the notes.", "The statement refers to an unrelated example.", "The text does not support this."];
  return uniqueStrings([correct, ...distractors, ...fallback]).slice(0, 4);
}

function normalizeGeneratedStudyAssets(value: unknown, sourceText: string, languageHint: string): GeneratedStudyAssets {
  const fallback = generateLocalStudyAssets(sourceText, languageHint);
  if (!isRecord(value)) {
    return fallback;
  }
  const summary = compactUnit(readString(value.summary) ?? fallback.summary, 700);
  const keyTopics = stringArray(value.keyTopics, 8);
  const notesMarkdown = readString(value.notesMarkdown) ?? fallback.notesMarkdown;
  const flashcards = Array.isArray(value.flashcards)
    ? value.flashcards
        .map((item, index) => normalizeFlashcard(item, index))
        .filter((item): item is GeneratedFlashcard => item != null)
        .slice(0, 16)
    : [];
  const quizQuestions = Array.isArray(value.quizQuestions)
    ? value.quizQuestions
        .map((item, index) => normalizeQuizQuestion(item, index, fallback.quizQuestions[index]))
        .filter((item): item is GeneratedQuizQuestion => item != null)
        .slice(0, 12)
    : [];
  const practiceQuestions = Array.isArray(value.practiceQuestions)
    ? value.practiceQuestions
        .map((item, index) => normalizePracticeQuestion(item, index))
        .filter((item): item is GeneratedPracticeQuestion => item != null)
        .slice(0, 10)
    : [];

  return {
    summary,
    keyTopics: keyTopics.length > 0 ? keyTopics : fallback.keyTopics,
    notesMarkdown: notesMarkdown.trim().length >= 40 ? notesMarkdown : fallback.notesMarkdown,
    flashcards: flashcards.length >= 3 ? flashcards : fallback.flashcards,
    quizQuestions: quizQuestions.length >= 3 ? quizQuestions : fallback.quizQuestions,
    practiceQuestions: practiceQuestions.length >= 2 ? practiceQuestions : fallback.practiceQuestions,
  };
}

function normalizeFlashcard(value: unknown, index: number): GeneratedFlashcard | null {
  if (!isRecord(value)) {
    return null;
  }
  const front = compactUnit(readString(value.front) ?? "", 240);
  const back = compactUnit(readString(value.back) ?? "", 700);
  if (!front || !back) {
    return null;
  }
  const hint = readString(value.hint);
  const sourceLocator = readString(value.sourceLocator) ?? readString(value.source_locator) ?? null;
  const concept = readString(value.conceptKey) ?? readString(value.concept_key) ?? front;
  return {
    front,
    back,
    hint: hint ? compactUnit(hint, 180) : null,
    difficulty: normalizeDifficulty(value.difficulty),
    sourceLocator,
    sourceUnitIndex: readInteger(value.sourceUnitIndex, index),
    conceptKey: slugifyConcept(concept, index),
  };
}

function normalizeQuizQuestion(
  value: unknown,
  index: number,
  fallback: GeneratedQuizQuestion | undefined,
): GeneratedQuizQuestion | null {
  if (!isRecord(value)) {
    return null;
  }
  const prompt = compactUnit(readString(value.prompt) ?? "", 260);
  const options = stringArray(value.options, 4).map((option) => compactUnit(option, 220));
  const explanation = compactUnit(readString(value.explanation) ?? options[0] ?? "", 520);
  if (!prompt || options.length < 2) {
    return null;
  }
  const paddedOptions = [...options, ...(fallback?.options ?? [])];
  while (paddedOptions.length < 4) {
    paddedOptions.push(`Option ${paddedOptions.length + 1}`);
  }
  const correctOptionIndex = readInteger(value.correctOptionIndex, readInteger(value.correct_option_idx, 0));
  return {
    prompt,
    options: uniqueStrings(paddedOptions).slice(0, 4),
    correctOptionIndex: Math.max(0, Math.min(correctOptionIndex, 3)),
    explanation,
    difficulty: normalizeDifficulty(value.difficulty),
    sourceLocator: readString(value.sourceLocator) ?? readString(value.source_locator) ?? null,
  };
}

function normalizePracticeQuestion(value: unknown, index: number): GeneratedPracticeQuestion | null {
  if (!isRecord(value)) {
    return null;
  }
  const prompt = compactUnit(readString(value.prompt) ?? "", 280);
  const answerGuide = compactUnit(readString(value.answerGuide) ?? readString(value.answer_guide) ?? "", 800);
  if (!prompt || !answerGuide) {
    return null;
  }
  const concept = readString(value.conceptKey) ?? readString(value.concept_key) ?? prompt;
  return {
    prompt,
    answerGuide,
    difficulty: normalizeDifficulty(value.difficulty),
    sourceLocator: readString(value.sourceLocator) ?? readString(value.source_locator) ?? null,
    sourceUnitIndex: readNullableInteger(value.sourceUnitIndex) ?? readNullableInteger(value.source_unit_idx) ?? index,
    conceptKey: slugifyConcept(concept, index),
  };
}

function readGeminiText(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    return null;
  }
  const candidate = value.candidates.find(isRecord);
  const content = isRecord(candidate?.content) ? candidate.content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map((part) => (isRecord(part) ? readString(part.text) : null))
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .trim();
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function stringArray(value: unknown, max: number) {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean),
  ).slice(0, max);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function compactUnit(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizeDifficulty(value: unknown): StudyDifficulty {
  return value === "easy" || value === "hard" ? value : "medium";
}

function difficultyForIndex(index: number): StudyDifficulty {
  if (index % 5 === 4) {
    return "hard";
  }
  if (index % 3 === 0) {
    return "easy";
  }
  return "medium";
}

function readInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function readNullableInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function slugifyConcept(value: string, index: number) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `concept-${index + 1}`;
}

function markdownToPlainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAudioMimeType(mimeType: string, fileName: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() || "";
  if (["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac"].includes(normalized)) {
    return "audio/mp4";
  }
  if (["audio/mpeg", "audio/mp3"].includes(normalized)) {
    return "audio/mpeg";
  }
  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    return "audio/wav";
  }
  if (normalized === "audio/webm") {
    return "audio/webm";
  }
  if (normalized === "audio/ogg") {
    return "audio/ogg";
  }
  if (normalized === "audio/opus") {
    return "audio/opus";
  }
  if (normalized === "audio/flac" || normalized === "audio/x-flac") {
    return "audio/flac";
  }
  if (normalized === "audio/aiff" || normalized === "audio/x-aiff") {
    return "audio/aiff";
  }
  if (normalized === "audio/x-caf") {
    return "audio/x-caf";
  }
  const ext = extensionFromFileName(fileName);
  if (ext === "m4a" || ext === "mp4" || ext === "aac") {
    return "audio/mp4";
  }
  if (ext === "mp3") {
    return "audio/mpeg";
  }
  if (ext === "wav") {
    return "audio/wav";
  }
  if (ext === "webm") {
    return "audio/webm";
  }
  if (ext === "ogg" || ext === "oga") {
    return "audio/ogg";
  }
  if (ext === "opus") {
    return "audio/opus";
  }
  if (ext === "flac") {
    return "audio/flac";
  }
  if (ext === "caf") {
    return "audio/x-caf";
  }
  if (ext === "aif" || ext === "aiff") {
    return "audio/aiff";
  }
  throw new HttpError(400, "Unsupported audio format.");
}

function normalizeDocumentMimeType(mimeType: string, fileName: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() || "";
  const ext = extensionFromFileName(fileName);
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "txt":
    case "md":
      return "text/plain";
    case "html":
    case "htm":
      return "text/html";
    case "rtf":
      return "application/rtf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      throw new HttpError(400, "Unsupported document format.");
  }
}

function normalizeImageMimeType(mimeType: string, fileName: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() || "";
  if (["image/jpeg", "image/jpg"].includes(normalized)) {
    return "image/jpeg";
  }
  if (["image/png", "image/heic", "image/heif", "image/webp"].includes(normalized)) {
    return normalized;
  }
  const ext = extensionFromFileName(fileName);
  if (ext === "jpg" || ext === "jpeg") {
    return "image/jpeg";
  }
  if (["png", "heic", "heif", "webp"].includes(ext)) {
    return `image/${ext}`;
  }
  throw new HttpError(400, "Unsupported scan image format.");
}

function documentSourceType(fileName: string, mimeType: string) {
  const ext = extensionFromFileName(fileName);
  if (ext === "pptx" || mimeType.includes("presentation")) {
    return "presentation";
  }
  if (["txt", "md", "html", "htm", "rtf"].includes(ext) || mimeType.startsWith("text/")) {
    return "text";
  }
  return "pdf";
}

function buildAudioStoragePath(userID: string, lectureID: string, mimeType: string, fileName: string) {
  return `${userID}/${lectureID}.${extensionForMimeType(mimeType, fileName)}`;
}

function buildDocumentStoragePath(userID: string, lectureID: string, fileName: string, mimeType: string) {
  return `${userID}/${lectureID}/documents/source.${extensionForMimeType(mimeType, fileName)}`;
}

function buildScanStoragePath(
  userID: string,
  lectureID: string,
  index: number,
  mimeType: string,
  fileName: string,
) {
  return `${userID}/${lectureID}/scans/photo-${String(index).padStart(3, "0")}.${extensionForMimeType(mimeType, fileName)}`;
}

function extensionForMimeType(mimeType: string, fileName: string) {
  const ext = extensionFromFileName(fileName);
  if (ext && /^[a-z0-9]+$/.test(ext)) {
    return ext;
  }
  switch (mimeType) {
    case "audio/mp4":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/opus":
      return "opus";
    case "audio/flac":
      return "flac";
    case "audio/x-caf":
      return "caf";
    case "audio/aiff":
      return "aiff";
    case "application/pdf":
      return "pdf";
    case "text/plain":
      return "txt";
    case "text/html":
      return "html";
    case "application/rtf":
      return "rtf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "pptx";
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

function mimeTypeFromStoragePath(path: string) {
  switch (extensionFromFileName(path)) {
    case "m4a":
    case "mp4":
    case "aac":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "pdf":
      return "application/pdf";
    case "txt":
    case "md":
      return "text/plain";
    case "html":
    case "htm":
      return "text/html";
    case "rtf":
      return "application/rtf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "png":
      return "image/png";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

function extensionFromFileName(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function assertOwnedStoragePath(userID: string, lectureID: string, path: string) {
  const prefix = `${userID}/${lectureID}`;
  if (path !== prefix && !path.startsWith(`${prefix}.`) && !path.startsWith(`${prefix}/`)) {
    throw new HttpError(400, "Invalid upload storage path.");
  }
}

function titleFromFileName(fileName: string) {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 80) || "Uploaded note";
}

function readPositiveNumber(value: unknown, field: string, max: number, tooLargeMessage?: string) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number) || number <= 0) {
    throw new HttpError(400, `Missing or invalid field: ${field}.`);
  }
  if (number > max) {
    throw new HttpError(400, tooLargeMessage ?? `Missing or invalid field: ${field}.`);
  }
  return number;
}

function readNonNegativeInteger(value: unknown, field: string) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 0) {
    throw new HttpError(400, `Missing or invalid field: ${field}.`);
  }
  return number;
}

async function fetchReadableText(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.2",
        "User-Agent": "Memo iOS Mobile Backend/0.1",
      },
    });
    if (!response.ok) {
      throw new HttpError(400, "The link could not be read.");
    }
    const raw = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const text = contentType.includes("text/plain") ? raw : htmlToText(raw);
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length < 50) {
      throw new HttpError(400, "The link did not contain enough readable text.");
    }
    return trimmed.slice(0, 200_000);
  } finally {
    clearTimeout(timeout);
  }
}

function htmlToText(html: string) {
  return decodeBasicHTMLEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function decodeBasicHTMLEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function readEnv(): MobileEnv {
  const supabaseURL = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
  const appAppleIDValue = process.env.MEMO_APPLE_APP_ID?.trim();
  return {
    supabaseURL,
    supabaseAnonKey: requiredEnv("SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    allowedProductIDs: new Set(
      (process.env.MEMO_STOREKIT_PRODUCT_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    bundleID: process.env.MEMO_IOS_BUNDLE_ID?.trim() || "eu.memoai.memo",
    appAppleID: appAppleIDValue ? Number(appAppleIDValue) : undefined,
    geminiAPIKey: process.env.GEMINI_API_KEY?.trim() || undefined,
    geminiTextModel: process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-2.5-flash-lite",
    sonioxAPIKey: process.env.SONIOX_API_KEY?.trim() || undefined,
    sonioxModel: process.env.SONIOX_MODEL?.trim() || "stt-async-v4",
    sonioxTTSModel: process.env.SONIOX_TTS_MODEL?.trim() || "tts-rt-v1",
    appStoreNotificationToken: process.env.MEMO_APP_STORE_NOTIFICATION_TOKEN?.trim() || undefined,
    appStoreJWSVerificationMode:
      process.env.MEMO_APP_STORE_JWS_VERIFICATION_MODE?.trim() === "decode-only"
        ? "decode-only"
        : "strict",
    appleRootCertificates: readAppleRootCertificates(),
  };
}

function readAppleRootCertificates() {
  const pemParts = [
    readAppleRootCertificatesFile(),
    process.env.MEMO_APPLE_ROOT_CERTIFICATES_PEM,
    process.env.MEMO_APPLE_ROOT_CERTIFICATES_BASE64
      ? Buffer.from(process.env.MEMO_APPLE_ROOT_CERTIFICATES_BASE64, "base64").toString("utf8")
      : undefined,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.replace(/\\n/g, "\n"));

  return pemParts.flatMap((pem) => {
    const matches = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    return matches.map((certificate) => new X509Certificate(certificate));
  });
}

function readAppleRootCertificatesFile() {
  const path = process.env.MEMO_APPLE_ROOT_CERTIFICATES_PATH?.trim();
  if (!path) {
    return undefined;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new HttpError(500, `Could not read Apple root certificates from ${path}.`);
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new HttpError(500, `Missing mobile backend environment variable: ${name}.`);
  }
  return value;
}

function normalizeMethod(method: string | undefined): HttpMethod {
  const normalized = (method ?? "GET").toUpperCase();
  if (["GET", "POST", "DELETE", "PATCH", "OPTIONS"].includes(normalized)) {
    return normalized as HttpMethod;
  }
  throw new HttpError(405, "Unsupported HTTP method.");
}

function requestURL(req: IncomingMessage) {
  return new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
}

function mobileSegments(url: URL) {
  const rewrittenPath = url.searchParams.get("__mobile_path");
  if (rewrittenPath) {
    return rewrittenPath.split("/").filter(Boolean).map(decodeURIComponent);
  }
  const stripped = url.pathname.replace(/^\/api\/mobile\/?/, "");
  return stripped.split("/").filter(Boolean).map(decodeURIComponent);
}

function readBearerToken(req: IncomingMessage) {
  const value = req.headers.authorization;
  const token = Array.isArray(value) ? value[0] : value;
  const match = token?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new HttpError(401, "Missing mobile bearer token.");
  }
  return match[1];
}

async function readJson(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  const parsed = safeJSON(raw);
  if (!isRecord(parsed)) {
    throw new HttpError(400, "Expected a JSON object.");
  }
  return parsed;
}

function safeJSON(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function errorMessage(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return readString(value.message) ?? readString(value.error) ?? readString(value.msg);
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing or invalid field: ${field}.`);
  }
  return value;
}

function readString(value: unknown, fallback?: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readEnum(value: unknown, allowed: string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function base64urlToBase64(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

function isMissingTableError(error: unknown) {
  return error instanceof HttpError && /does not exist|schema cache|could not find/i.test(error.message);
}

function ignoreMissingTable(error: unknown) {
  if (!isMissingTableError(error)) {
    throw error;
  }
}

function setBaseHeaders(res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
}

function json(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.end(JSON.stringify(body));
}
