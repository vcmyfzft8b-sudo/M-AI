"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  X,
} from "lucide-react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppLayout } from "@/components/app-layout-context";
import { useAppHref, useIsCreatorDemo } from "@/components/creator-demo/creator-demo-context";
import { EmojiIcon } from "@/components/emoji-icon";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { NoteReadAloud } from "@/components/note-read-aloud";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { MemoPortal } from "@/components/memo-portal";
import { RecordingPlayer } from "@/components/recording-player";
import {
  getApiErrorMessage,
  parseApiResponse,
  redirectToBillingIfNeeded,
} from "@/lib/billing-client";
import type { FlashcardConfidenceBucket, StudyAssetStatus } from "@/lib/database.types";
import { canRetryLectureFailure } from "@/lib/lecture-failure-codes";
import {
  getEffectiveLectureSourceType,
  getLectureSourceDetail,
  getLectureSourceLabel,
  isRecord,
  lectureShowsTranscript,
  shouldCreateInitialNoteAudio,
} from "@/lib/lecture-source-metadata";
import { isNoteEnrichmentPending } from "@/lib/note-enrichment-status";
import { noteEmoji } from "@/lib/note-emoji";
import type { EditableNoteDoc, NoteAnnotation, NoteAnnotationKind } from "@/lib/note-doc";
import { NOTE_TTS_HIGHLIGHT_COLORS } from "@/lib/note-tts-settings";
import { parseNoteTtsDocument, stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import {
  POLL_INTERVAL_MS,
  STORAGE_BUCKET,
} from "@/lib/constants";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import Image from "next/image";
import { createPortal } from "react-dom";

import { TypingDots } from "@/components/typing-dots";
import { useDictation } from "@/components/use-dictation";
import { readChatStream } from "@/lib/chat-stream-client";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { usePathname, useRouter } from "next/navigation";
import type {
  ChatMessageWithCitations,
  LectureDetail,
  PersistedFlashcardSessionState,
  PersistedPracticeTestSessionState,
  PersistedQuizSessionState,
  QuizQuestionWithOptions,
} from "@/lib/types";
import {
  formatCalendarDate,
  formatTimestamp,
} from "@/lib/utils";

type WorkspaceTab = "notes" | "study" | "chat" | "transcript" | "audio";
type StudyMaterialView = "flashcards" | "quiz" | "practice_test";
type FlashcardSessionResult = {
  attempts: number;
  firstConfidence: FlashcardConfidenceBucket;
  latestConfidence: FlashcardConfidenceBucket;
};

type FlashcardRoundSummary = {
  cycle: number;
  total: number;
  known: number;
  missed: number;
};

type FlashcardExitAnimation = {
  flashcard: LectureDetail["flashcards"][number];
  bucket: FlashcardConfidenceBucket;
  flipped: boolean;
  token: number;
  startXPercent: number;
  startYPercent: number;
  startRotationDeg: number;
};

type FlashcardDragState = {
  isDragging: boolean;
  deltaX: number;
  deltaY: number;
  width: number;
};

type FlashcardDragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
};

type StudyManagerItemDragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  offset: number;
  isDragging: boolean;
};

type FlashcardExitStart = {
  xPercent: number;
  yPercent: number;
  rotationDeg: number;
};

type QuizRoundSummary = {
  cycle: number;
  total: number;
  correct: number;
  missed: number;
  missedQuestionIds: string[];
};

type FlashcardProgressResponse = {
  error?: unknown;
  progress?: LectureDetail["flashcards"][number]["progress"];
};

type ChatResponse = {
  answer?: ChatMessageWithCitations;
  code?: string;
  error?: unknown;
};

type NoteSelectionRange = {
  startWordIndex: number;
  endWordIndex: number;
};

type NotesDocResponse = {
  doc: EditableNoteDoc;
  revision: number;
  updatedAt?: string | null;
  error?: unknown;
};

type NoteMediaUploadResponse = {
  mediaId: string;
  path: string;
  token: string;
  mimeType: string;
  maxBytes: number;
  error?: unknown;
};

type NoteMediaFinalizeResponse = NotesDocResponse & {
  media?: LectureDetail["noteMedia"][number];
};

type StudyItemDifficulty = "easy" | "medium" | "hard";

type FlashcardFormState = {
  front: string;
  back: string;
  hint: string;
  difficulty: StudyItemDifficulty;
};

type QuizQuestionFormState = {
  prompt: string;
  options: [string, string, string, string];
  correctOptionIndex: number;
  explanation: string;
  difficulty: StudyItemDifficulty;
};

type FlashcardMutationResponse = {
  flashcard: LectureDetail["flashcards"][number];
  error?: unknown;
};

type QuizQuestionMutationResponse = {
  question: LectureDetail["quizQuestions"][number];
  error?: unknown;
};

/** The five swatches the redesign shows in the dock's colour palette. */
const NOTE_HIGHLIGHT_COLORS = [
  "orange",
  "yellow",
  "green",
  "blue",
  "pink",
].map((colorId) => {
  const color = NOTE_TTS_HIGHLIGHT_COLORS.find((item) => item.id === colorId);

  return {
    id: colorId,
    label: color?.label ?? colorId,
    value: color?.currentBackground ?? "#fb923c",
    /** Text colour that reads on top of `value`, for the brush button. */
    contrast: color?.currentColor ?? "#431407",
  };
});

type StudySessionSnapshot = {
  savedAt: string;
  activeStudyView: StudyMaterialView;
  flashcardState: PersistedFlashcardSessionState | null;
  quizState: PersistedQuizSessionState | null;
  practiceTestState: PersistedPracticeTestSessionState | null;
};

const STUDY_SESSION_STORAGE_KEY_PREFIX = "lecture-study-session:";
const NETWORK_REQUEST_ERROR_MESSAGE = "Povezava je bila prekinjena. Poskusi znova.";
const FAST_DETAIL_POLL_INTERVAL_MS = 5000;
const MIN_DETAIL_REFRESH_INTERVAL_MS = 3000;
const STUDY_SESSION_SAVE_DEBOUNCE_MS = 5000;
const STUDY_SESSION_FAILED_RETRY_COOLDOWN_MS = 30_000;
const STUDY_SESSION_KEEPALIVE_MAX_BYTES = 60 * 1024;
const STUDY_MANAGER_ACTION_REVEAL_PX = 78;

/**
 * How long after the last `visualViewport` resize the soft keyboard is treated
 * as having stopped moving. iOS animates the keys in over roughly a quarter of
 * a second and scrolls the focused field into view somewhere in there; this is
 * the margin that puts the study manager's own correction last.
 */
const KEYBOARD_SETTLE_MS = 300;

function ignoreBackgroundRequestError() {
  return null;
}

function isInterruptedFetchError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "NetworkError";
  }

  return error instanceof TypeError && /failed to fetch|load failed|network/i.test(error.message);
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (isInterruptedFetchError(error)) {
    return NETWORK_REQUEST_ERROR_MESSAGE;
  }

  return error instanceof Error ? error.message : fallback;
}

/**
 * The redesign's pill row. Study is three peers rather than one tab with an
 * inner switch, and chat has left the row entirely — it is the side panel on
 * desktop and the bar at the foot of the note on the phone.
 *
 * Each pill carries its own tint, which the active state mixes into its
 * background and border.
 */
const NOTE_TABS = [
  { id: "notes", view: null, label: "Zapiski", icon: "description", tint: "#f45f5a" },
  {
    id: "flashcards",
    view: "flashcards",
    label: "Flashcards",
    icon: "style",
    tint: "oklch(0.66 0.15 295)",
  },
  { id: "quiz", view: "quiz", label: "Kviz", icon: "quiz", tint: "oklch(0.66 0.15 340)" },
  {
    id: "test",
    view: "practice_test",
    label: "Test",
    icon: "assignment",
    tint: "oklch(0.66 0.15 150)",
  },
  { id: "transcript", view: null, label: "Prepis", icon: "text_snippet", tint: "oklch(0.66 0.15 250)" },
] as const;

type NoteTabId = (typeof NOTE_TABS)[number]["id"];

/** How close to the foot of the chat log still counts as "reading the tail". */
const STICK_TO_BOTTOM_PX = 120;

/** Opening prompts in the chat panel, as the redesign lists them. */
const CHAT_SUGGESTIONS = [
  "Povzemi predavanje",
  "Razloži ključni pojem",
  "Naredi 5 vprašanj",
  "Podaljšaj zapiske",
];

function getNoteTabs({ showsTranscript }: { showsTranscript: boolean }) {
  return NOTE_TABS.filter((tab) => tab.id !== "transcript" || showsTranscript);
}

function shouldPollLecture(status: LectureDetail["lecture"]["status"]) {
  return ["uploading", "queued", "transcribing", "generating_notes"].includes(status);
}

function shouldPollAsset(status: StudyAssetStatus | null | undefined) {
  return status === "queued" || status === "generating";
}

function shouldPollDetail(detail: LectureDetail) {
  if (shouldPollLecture(detail.lecture.status)) {
    return true;
  }

  if (isNoteEnrichmentPending(detail.artifact?.model_metadata)) {
    return true;
  }

  if (detail.lecture.status === "ready" && !detail.artifact) {
    return true;
  }

  if (
    (detail.flashcards.length === 0 && shouldPollAsset(detail.studyAsset?.status)) ||
    shouldPollAsset(detail.quizAsset?.status)
  ) {
    return true;
  }

  if (shouldPollAsset(detail.practiceTestAsset?.status)) {
    return true;
  }

  if (detail.studyAsset?.status === "ready" && detail.flashcards.length === 0) {
    return true;
  }

  if (detail.quizAsset?.status === "ready" && detail.quizQuestions.length === 0) {
    return true;
  }

  if (detail.practiceTestAsset?.status === "ready" && detail.practiceTestQuestions.length === 0) {
    return true;
  }

  return false;
}

function getStudySessionStorageKey(lectureId: string) {
  return `${STUDY_SESSION_STORAGE_KEY_PREFIX}${lectureId}`;
}

function createClientFallbackNoteDoc(): EditableNoteDoc {
  return {
    version: 1,
    baseNotesHash: "local",
    updatedAt: new Date(0).toISOString(),
    annotations: [],
    mediaBlocks: [],
  };
}

function mergeNoteDocs(baseDoc: EditableNoteDoc, nextDoc: EditableNoteDoc): EditableNoteDoc {
  const annotationsById = new Map(baseDoc.annotations.map((annotation) => [annotation.id, annotation]));
  const mediaBlocksById = new Map(baseDoc.mediaBlocks.map((mediaBlock) => [mediaBlock.id, mediaBlock]));

  for (const annotation of nextDoc.annotations) {
    annotationsById.set(annotation.id, annotation);
  }

  for (const mediaBlock of nextDoc.mediaBlocks) {
    mediaBlocksById.set(mediaBlock.id, mediaBlock);
  }

  return {
    ...baseDoc,
    updatedAt: new Date().toISOString(),
    annotations: Array.from(annotationsById.values()),
    mediaBlocks: Array.from(mediaBlocksById.values()),
  };
}

function annotationRangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return firstStart <= secondEnd && secondStart <= firstEnd;
}

function isSelectionFullyCoveredByAnnotations(
  annotations: NoteAnnotation[],
  selection: NoteSelectionRange,
) {
  let cursor = selection.startWordIndex;
  const sortedAnnotations = annotations
    .filter((annotation) =>
      annotationRangesOverlap(
        annotation.startWordIndex,
        annotation.endWordIndex,
        selection.startWordIndex,
        selection.endWordIndex,
      ),
    )
    .sort((first, second) => first.startWordIndex - second.startWordIndex);

  for (const annotation of sortedAnnotations) {
    if (annotation.startWordIndex > cursor) {
      return false;
    }

    cursor = Math.max(cursor, annotation.endWordIndex + 1);

    if (cursor > selection.endWordIndex) {
      return true;
    }
  }

  return false;
}

function removeSelectionFromAnnotation(annotation: NoteAnnotation, selection: NoteSelectionRange) {
  const pieces: NoteAnnotation[] = [];

  if (annotation.startWordIndex < selection.startWordIndex) {
    pieces.push({
      ...annotation,
      id: crypto.randomUUID(),
      endWordIndex: selection.startWordIndex - 1,
    });
  }

  if (annotation.endWordIndex > selection.endWordIndex) {
    pieces.push({
      ...annotation,
      id: crypto.randomUUID(),
      startWordIndex: selection.endWordIndex + 1,
    });
  }

  return pieces;
}

function doRectsOverlap(first: DOMRect, second: DOMRect, padding = 8) {
  return !(
    first.right + padding < second.left ||
    first.left - padding > second.right ||
    first.bottom + padding < second.top ||
    first.top - padding > second.bottom
  );
}

function createEmptyFlashcardForm(): FlashcardFormState {
  return {
    front: "",
    back: "",
    hint: "",
    difficulty: "medium",
  };
}

function createEmptyQuizQuestionForm(): QuizQuestionFormState {
  return {
    prompt: "",
    options: ["", "", "", ""],
    correctOptionIndex: 0,
    explanation: "",
    difficulty: "medium",
  };
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function readStudySessionSnapshot(lectureId: string): StudySessionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getStudySessionStorageKey(lectureId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StudySessionSnapshot>;
    if (
      typeof parsed.savedAt !== "string" ||
      (parsed.activeStudyView !== "flashcards" &&
        parsed.activeStudyView !== "quiz" &&
        parsed.activeStudyView !== "practice_test")
    ) {
      return null;
    }

    return {
      savedAt: parsed.savedAt,
      activeStudyView: parsed.activeStudyView,
      flashcardState: parsed.flashcardState ?? null,
      quizState: parsed.quizState ?? null,
      practiceTestState: parsed.practiceTestState ?? null,
    };
  } catch {
    return null;
  }
}

function writeStudySessionSnapshot(lectureId: string, snapshot: StudySessionSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getStudySessionStorageKey(lectureId), JSON.stringify(snapshot));
  } catch {}
}

function mergeLectureDetailWithStoredStudySession(detail: LectureDetail) {
  const snapshot = readStudySessionSnapshot(detail.lecture.id);
  if (!snapshot) {
    return detail;
  }

  if (toTimestamp(snapshot.savedAt) <= toTimestamp(detail.studySession?.updated_at)) {
    return detail;
  }

  return {
    ...detail,
    studySession: {
      user_id: detail.studySession?.user_id ?? detail.lecture.user_id,
      lecture_id: detail.lecture.id,
      active_study_view: snapshot.activeStudyView,
      flashcard_state: snapshot.flashcardState,
      quiz_state: snapshot.quizState,
      practice_test_state: snapshot.practiceTestState,
      created_at: detail.studySession?.created_at ?? snapshot.savedAt,
      updated_at: snapshot.savedAt,
    },
  };
}

function detailSectionFailed(detail: LectureDetail, section: string) {
  return detail.degraded?.failedSections.includes(section) ?? false;
}

function mergeLectureDetailForRefresh(current: LectureDetail, next: LectureDetail) {
  const merged = mergeLectureDetailWithStoredStudySession(next);

  if (
    current.lecture.id === merged.lecture.id &&
    current.lecture.status === "ready" &&
    merged.lecture.status !== "ready" &&
    toTimestamp(merged.lecture.updated_at) <= toTimestamp(current.lecture.updated_at)
  ) {
    return current;
  }

  if (
    current.lecture.id === merged.lecture.id &&
    current.artifact?.structured_notes_md?.trim() &&
    !merged.artifact?.structured_notes_md?.trim() &&
    detailSectionFailed(merged, "artifact")
  ) {
    return {
      ...merged,
      artifact: current.artifact,
    };
  }

  return merged;
}

function confidenceLabel(value: FlashcardConfidenceBucket) {
  if (value === "again") {
    return "Nisem vedel";
  }
  return "Vedel sem";
}

const FLASHCARD_EXIT_ANIMATION_MS = 193;
const FLASHCARD_DRAG_TRIGGER_RATIO = 0.28;
const FLASHCARD_DRAG_TRIGGER_MIN_PX = 88;
const FLASHCARD_DRAG_TRIGGER_MAX_PX = 150;
const FLASHCARD_DRAG_MAX_ROTATION_DEG = 8;

function isScanImport(detail: LectureDetail) {
  const sourceType = getEffectiveLectureSourceType(detail.lecture);

  return lectureShowsTranscript({
    lecture: detail.lecture,
    artifact: detail.artifact,
  }) && sourceType !== "audio";
}

function getScanTranscriptFallback(detail: LectureDetail) {
  if (!isScanImport(detail)) {
    return [];
  }

  const metadata = detail.lecture.processing_metadata;

  if (!isRecord(metadata)) {
    return [];
  }

  const manualImport = metadata.manualImport;

  if (!isRecord(manualImport)) {
    return [];
  }

  const blocks = Array.isArray(manualImport.blocks) ? manualImport.blocks : [];
  const segments: Array<{
    id: string;
    start_ms: number;
    end_ms: number;
    speaker_label: string | null;
    text: string;
  }> = [];
  let startMs = 0;

  for (const [index, block] of blocks.entries()) {
    if (!isRecord(block)) {
      continue;
    }

    const text = typeof block.text === "string" ? block.text.trim() : "";

    if (!text) {
      continue;
    }

    const label = typeof block.label === "string" && block.label.trim() ? block.label.trim() : null;
    const pageNumber = typeof block.pageNumber === "number" ? block.pageNumber : null;
    const durationMs = Math.max(Math.round(text.split(/\s+/).filter(Boolean).length * 420), 6000);

    segments.push({
      id: `scan-fallback-${index}`,
      start_ms: startMs,
      end_ms: startMs + durationMs,
      speaker_label:
        pageNumber != null
          ? label
            ? `Page ${pageNumber} · ${label}`
            : `Page ${pageNumber}`
          : label,
      text,
    });
    startMs += durationMs;
  }

  if (segments.length > 0) {
    return segments;
  }

  const text = typeof manualImport.text === "string" ? manualImport.text.trim() : "";

  if (!text) {
    return [];
  }

  return [
    {
      id: "scan-fallback-text",
      start_ms: 0,
      end_ms: Math.max(Math.round(text.split(/\s+/).filter(Boolean).length * 420), 6000),
      speaker_label: null,
      text,
    },
  ];
}

function formatScanTranscriptLabel(label: string | null) {
  if (!label?.trim()) {
    return "Prepis fotografije";
  }

  return label.trim().replace(/^Page\s+(\d+)/i, "Stran $1");
}

function studyStageLabel(stage: unknown) {
  if (stage === "building_sections") {
    return "Gradim učne sklope";
  }

  if (stage === "planning_coverage") {
    return "Izluščujem pojme";
  }

  if (stage === "generating_cards") {
    return "Ustvarjam kartice";
  }

  if (stage === "repairing_coverage") {
    return "Zapolnjujem vrzeli";
  }

  if (stage === "publishing_deck") {
    return "Preverjam pokritost";
  }

  return "Pripravljam učna orodja";
}

function quizStageLabel(stage: unknown) {
  if (stage === "generating_questions") {
    return "Ustvarjam kviz";
  }

  if (stage === "publishing_quiz") {
    return "Objavljam kviz";
  }

  if (stage === "ready") {
    return "Kviz je pripravljen";
  }

  return "Pripravljam kviz";
}

function practiceTestStageLabel(stage: unknown) {
  if (stage === "generating_question_bank") {
    return "Sestavljam vprašanja";
  }

  if (stage === "ready") {
    return "Preizkus je pripravljen";
  }

  return "Pripravljam preizkus";
}

function getLectureProcessingStage(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.processing)) {
    return null;
  }

  return typeof metadata.processing.stage === "string" ? metadata.processing.stage : null;
}

function lectureProcessingStageLabel(
  status: LectureDetail["lecture"]["status"],
  processingStage?: string | null,
) {
  if (processingStage === "preparing_audio") {
    return "Ustvarjam zvok";
  }

  if (processingStage === "extracting_document_text") {
    return "Berem dokument";
  }

  if (processingStage === "extracting_scan_text") {
    return "Berem fotografije";
  }

  if (processingStage === "annotating_notes") {
    return "Označujem pomembne dele";
  }

  if (processingStage === "checking_document_images") {
    return "Dodajam slike iz gradiva";
  }

  if (processingStage === "reading_link") {
    return "Berem povezavo";
  }

  if (status === "uploading") {
    return "Nalagam gradivo";
  }

  if (status === "queued") {
    return "Pripravljam obdelavo";
  }

  if (status === "transcribing") {
    return "Prepisujem predavanje";
  }

  if (status === "generating_notes") {
    return "Ustvarjam zapiske";
  }

  return "Pripravljam zapiske";
}

type GenerationPreview = "notes" | "cards" | "quiz" | "test";

/** The note body a generating note is on its way to becoming. */
const GENERATION_NOTE_PARAGRAPHS = [
  ["full", "full", "short"],
  ["full", "full", "full", "short"],
  ["full", "short"],
] as const;

const GENERATION_QUIZ_OPTIONS = [0, 1, 2, 3];

/**
 * The ghost of the thing being generated, in the shape that will replace it.
 *
 * Built the way the two route skeletons are — out of the real screen's own
 * measurements rather than out of a spinner that says nothing about what is
 * coming. A wait that ends in a stack of flashcards should look like a stack of
 * flashcards filling in.
 */
function GenerationSkeleton({ kind }: { kind: GenerationPreview }) {
  if (kind === "notes") {
    return (
      <div className="memo-gen-preview" aria-hidden="true">
        {GENERATION_NOTE_PARAGRAPHS.map((paragraph, index) => (
          <div key={index} className="memo-gen-para">
            <span className="app-loading-pill memo-gen-heading" />
            {paragraph.map((line, lineIndex) => (
              <span
                key={lineIndex}
                className={`app-loading-pill memo-gen-line ${line === "short" ? "short" : ""}`.trim()}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (kind === "cards") {
    return (
      <div className="memo-gen-preview" aria-hidden="true">
        <div className="memo-gen-deckhead">
          <div className="memo-gen-cardhead">
            <span className="app-loading-pill" />
            <span className="app-loading-pill" />
          </div>
          <span className="app-loading-pill memo-gen-bar cards" />
        </div>
        <div className="memo-gen-face">
          <span className="app-loading-pill" />
          <span className="app-loading-pill" />
        </div>
      </div>
    );
  }

  if (kind === "quiz") {
    return (
      <div className="memo-gen-preview" aria-hidden="true">
        <span className="app-loading-pill memo-gen-bar quiz" />
        <div className="memo-gen-quizcard">
          <span className="app-loading-pill memo-gen-prompt" />
          {GENERATION_QUIZ_OPTIONS.map((option) => (
            <span key={option} className="app-loading-pill memo-gen-option" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="memo-gen-preview" aria-hidden="true">
      <span className="app-loading-pill memo-gen-bar test" />
      <div className="memo-gen-testblock">
        <span className="app-loading-pill memo-gen-prompt" />
        <span className="app-loading-pill memo-gen-testinput" />
      </div>
    </div>
  );
}

/**
 * A stage caption over the ghost of what is being made.
 *
 * The caption carries the one thing a skeleton cannot: these waits run for
 * minutes and move through named stages, and "Ustvarjam kartice" is the
 * difference between a screen that is working and a screen that is stuck. It
 * sits on the panel itself — the panel is already the surface, and the card
 * this used to draw around itself landed as a second card inside the first.
 */
function StudyGenerationNotice({
  stageCopy,
  bodyCopy = "Ustvarjanje teče v ozadju. Lahko zapreš ta pogled in se vrneš čez nekaj minut.",
  preview,
}: {
  stageCopy: string;
  bodyCopy?: string;
  preview: GenerationPreview;
}) {
  return (
    <div className="memo-gen" role="status" aria-live="polite" aria-busy="true">
      <div className="memo-gen-head">
        <p className="memo-gen-stage">{stageCopy}</p>
        <p className="memo-gen-copy">{bodyCopy}</p>
        <span className="memo-gen-track" aria-hidden="true">
          <span />
        </span>
      </div>
      <GenerationSkeleton kind={preview} />
    </div>
  );
}

function isLegacySectionId(value: string) {
  return value.startsWith("legacy-");
}

function randomInt(maxExclusive: number) {
  if (maxExclusive <= 1) {
    return 0;
  }

  if (!globalThis.crypto?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }

  const maxUint32 = 0x1_0000_0000;
  const biasSafeLimit = maxUint32 - (maxUint32 % maxExclusive);
  const buffer = new Uint32Array(1);
  let randomValue = 0;

  do {
    globalThis.crypto.getRandomValues(buffer);
    randomValue = buffer[0] ?? 0;
  } while (randomValue >= biasSafeLimit);

  return randomValue % maxExclusive;
}

function shuffleIndices(length: number) {
  const indices = Array.from({ length }, (_, index) => index);

  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const currentValue = indices[index];
    indices[index] = indices[swapIndex] ?? index;
    indices[swapIndex] = currentValue ?? swapIndex;
  }

  return indices;
}

function buildQuizOptionOrders(
  questionIds: string[],
  questionsById: Map<string, QuizQuestionWithOptions>,
) {
  return new Map(
    questionIds.flatMap((questionId) => {
      const question = questionsById.get(questionId);

      if (!question) {
        return [];
      }

      return [[questionId, shuffleIndices(question.options.length)]];
    }),
  );
}

function getInitialStudyView(detail: LectureDetail): StudyMaterialView {
  if (detail.studySession?.active_study_view === "flashcards" && detail.flashcards.length > 0) {
    return "flashcards";
  }

  if (detail.studySession?.active_study_view === "quiz" && detail.quizQuestions.length > 0) {
    return "quiz";
  }

  if (
    detail.studySession?.active_study_view === "practice_test" &&
    detail.practiceTestQuestions.length > 0
  ) {
    return "practice_test";
  }

  if (detail.flashcards.length > 0) {
    return "flashcards";
  }

  if (detail.quizQuestions.length > 0) {
    return "quiz";
  }

  if (detail.practiceTestQuestions.length > 0) {
    return "practice_test";
  }

  return "flashcards";
}

function buildDefaultFlashcardSessionState(
  flashcardIds: string[],
): PersistedFlashcardSessionState {
  return {
    reviewQueue: flashcardIds,
    repeatQueue: [],
    activeFlashcardIndex: 0,
    reviewCycle: 1,
    cycleCardCount: flashcardIds.length,
    roundSummary: null,
    sessionResults: {},
  };
}

function sanitizeFlashcardSessionState(
  session: PersistedFlashcardSessionState | null | undefined,
  flashcardIds: string[],
): PersistedFlashcardSessionState {
  const validIds = new Set(flashcardIds);
  const fallback = buildDefaultFlashcardSessionState(flashcardIds);

  if (!session) {
    return fallback;
  }

  let reviewQueue = session.reviewQueue.filter((id) => validIds.has(id));
  const repeatQueue = session.repeatQueue.filter((id) => validIds.has(id));
  const sessionResults = Object.fromEntries(
    Object.entries(session.sessionResults).filter(([id]) => validIds.has(id)),
  );
  const roundSummary = session.roundSummary
    ? {
        cycle: Math.max(1, session.roundSummary.cycle),
        total: Math.max(0, session.roundSummary.total),
        known: Math.max(0, session.roundSummary.known),
        missed: Math.max(0, session.roundSummary.missed),
      }
    : null;
  const hasPersistedActiveIndex =
    typeof session.activeFlashcardIndex === "number" && session.activeFlashcardIndex >= 0;
  let activeFlashcardIndex =
    reviewQueue.length > 0
      ? Math.min(Math.max(0, session.activeFlashcardIndex ?? 0), reviewQueue.length - 1)
      : 0;

  if (!hasPersistedActiveIndex && flashcardIds.length > 0 && !roundSummary) {
    const activeFlashcardId = reviewQueue[0];
    activeFlashcardIndex = activeFlashcardId
      ? Math.max(0, flashcardIds.findIndex((id) => id === activeFlashcardId))
      : 0;
    reviewQueue = flashcardIds;
  }

  if (!roundSummary) {
    const queuedIds = new Set([...reviewQueue, ...repeatQueue]);
    const missingFlashcardIds = flashcardIds.filter((id) => !queuedIds.has(id));
    reviewQueue = [...reviewQueue, ...missingFlashcardIds];
  }

  if (flashcardIds.length > 0 && reviewQueue.length === 0 && !roundSummary) {
    return fallback;
  }

  const cycleCardCount = Math.max(
    reviewQueue.length,
    Math.min(Math.max(0, session.cycleCardCount), flashcardIds.length),
  );

  return {
    reviewQueue,
    repeatQueue,
    activeFlashcardIndex,
    reviewCycle: Math.max(1, session.reviewCycle),
    cycleCardCount,
    roundSummary,
    sessionResults,
  };
}

function serializeQuizOptionOrders(optionOrders: Map<string, number[]>) {
  return Object.fromEntries(optionOrders.entries());
}

function buildDefaultQuizSessionState(
  questionIds: string[],
  questionsById: Map<string, QuizQuestionWithOptions>,
): PersistedQuizSessionState {
  return {
    quizQueue: questionIds,
    quizRound: 1,
    quizRoundCount: questionIds.length,
    roundSummary: null,
    activeQuestionIndex: 0,
    selections: {},
    optionOrders: serializeQuizOptionOrders(buildQuizOptionOrders(questionIds, questionsById)),
  };
}

function sanitizeQuizSessionState(
  session: PersistedQuizSessionState | null | undefined,
  questionIds: string[],
  questionsById: Map<string, QuizQuestionWithOptions>,
): PersistedQuizSessionState {
  const validIds = new Set(questionIds);
  const fallback = buildDefaultQuizSessionState(questionIds, questionsById);

  if (!session) {
    return fallback;
  }

  const quizQueue = session.quizQueue.filter((id) => validIds.has(id));
  const selections = Object.fromEntries(
    Object.entries(session.selections).filter(([id, optionIndex]) => {
      const question = questionsById.get(id);
      return !!question && optionIndex >= 0 && optionIndex < question.options.length;
    }),
  );
  const optionOrders = Object.fromEntries(
    Object.entries(session.optionOrders).flatMap(([id, order]) => {
      const question = questionsById.get(id);

      if (!question || order.length !== question.options.length) {
        return [];
      }

      const normalizedOrder = order.filter(
        (optionIndex) =>
          Number.isInteger(optionIndex) &&
          optionIndex >= 0 &&
          optionIndex < question.options.length,
      );

      if (new Set(normalizedOrder).size !== question.options.length) {
        return [];
      }

      return [[id, normalizedOrder]];
    }),
  );
  const roundSummary = session.roundSummary
    ? {
        cycle: Math.max(1, session.roundSummary.cycle),
        total: Math.max(0, session.roundSummary.total),
        correct: Math.max(0, session.roundSummary.correct),
        missed: Math.max(0, session.roundSummary.missed),
        missedQuestionIds: session.roundSummary.missedQuestionIds.filter((id) => validIds.has(id)),
      }
    : null;

  const nextQuizQueue = !roundSummary
    ? [
        ...quizQueue,
        ...questionIds.filter((id) => !quizQueue.includes(id)),
      ]
    : quizQueue;

  if (questionIds.length > 0 && nextQuizQueue.length === 0 && !roundSummary) {
    return fallback;
  }

  const quizRoundCount = Math.max(
    nextQuizQueue.length,
    Math.min(Math.max(0, session.quizRoundCount), questionIds.length),
  );

  return {
    quizQueue: nextQuizQueue,
    quizRound: Math.max(1, session.quizRound),
    quizRoundCount,
    roundSummary,
    activeQuestionIndex:
      nextQuizQueue.length > 0
        ? Math.min(Math.max(0, session.activeQuestionIndex), nextQuizQueue.length - 1)
        : 0,
    selections,
    optionOrders: {
      ...fallback.optionOrders,
      ...optionOrders,
    },
  };
}

function sanitizePracticeTestSessionState(
  session: PersistedPracticeTestSessionState | null | undefined,
  detail: LectureDetail,
): PersistedPracticeTestSessionState {
  const attemptsById = new Map(detail.practiceTestAttempts.map((attempt) => [attempt.id, attempt]));
  const currentAttemptCandidate =
    session?.currentAttemptId ? attemptsById.get(session.currentAttemptId) ?? null : null;
  const currentAttempt =
    (currentAttemptCandidate?.status === "in_progress" ? currentAttemptCandidate : null) ??
    detail.practiceTestAttempts.find((attempt) => attempt.status === "in_progress") ??
    null;
  const latestGradedAttempt =
    detail.practiceTestAttempts
      .filter((attempt) => attempt.status === "graded")
      .slice(-1)[0] ?? null;
  const attemptQuestionIds = currentAttempt
    ? currentAttempt.answers
        .map((answer) => answer.practice_test_question_id)
        .filter((id): id is string => Boolean(id))
    : [];
  const validQuestionIds = new Set(attemptQuestionIds);
  const textAnswers = Object.fromEntries(
    Object.entries(session?.textAnswers ?? {}).filter(([questionId]) => validQuestionIds.has(questionId)),
  );

  for (const answer of currentAttempt?.answers ?? []) {
    const questionKey = answer.practice_test_question_id ?? `snapshot-${answer.id}`;

    if (!textAnswers[questionKey] && answer.typed_answer) {
      textAnswers[questionKey] = answer.typed_answer;
    }
  }

  return {
    currentAttemptId: currentAttempt?.id ?? null,
    attemptQuestionIds,
    textAnswers,
    unknownQuestionIds: (session?.unknownQuestionIds ?? []).filter((id) => validQuestionIds.has(id)),
    latestViewedAttemptId:
      session?.latestViewedAttemptId ??
      latestGradedAttempt?.id ??
      currentAttempt?.id ??
      null,
    submittedAt: session?.submittedAt ?? null,
  };
}

function ChatBubble({ message }: { message: ChatMessageWithCitations }) {
  const assistant = message.role === "assistant";

  return (
    <div className={assistant ? "memo-bubble-bot" : "memo-bubble-user"}>
      <p className="memo-bubble-copy">{message.content}</p>
    </div>
  );
}

/**
 * The phone artboard says "Tapni", the desktop one "Klikni". Both are rendered
 * and the stylesheet picks, so this needs no viewport state on the client.
 */
/** What the phone navbar calls each study screen. Flashcards names nothing. */
const SUB_SCREEN_TITLES: Record<string, string> = {
  flashcards: "",
  quiz: "Kviz",
  test: "Vadbeni test",
  transcript: "Prepis",
};

const flipHint = (
  <>
    <span className="memo-only-desktop">Klikni za obrat</span>
    <span className="memo-only-mobile">Tapni za obrat</span>
  </>
);

export function LectureWorkspace({
  initialDetail,
  hasPaidAccess,
  trialLectureId,
  initialTrialChatMessagesRemaining,
}: {
  initialDetail: LectureDetail;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  initialTrialChatMessagesRemaining: number;
}) {
  const router = useRouter();
  const { navigateWithFeedback, overlay: navigationOverlay, navigatingTo } = useInstantNavigation();
  const notePathname = usePathname();
  const isCreatorDemo = useIsCreatorDemo();
  const [detail, setDetail] = useState(initialDetail);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("notes");
  const [question, setQuestion] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  // Redesign chrome. Chat is a side panel that can be dismissed to a pill and
  // reopened; on the phone the same conversation is a sheet.
  const { setChatOpen, chatSlot } = useAppLayout();
  const homeHref = useAppHref("/app");
  const startHref = useAppHref("/app/start");
  const [isChatDismissed, setIsChatDismissed] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const quizAdvanceTimerRef = useRef<number | null>(null);
  const closeMobileChat = useCallback(() => setIsMobileChatOpen(false), []);
  /*
   * Dictation for the chat composer. What it hears is appended to whatever is
   * already in the field rather than replacing it, so speaking after typing
   * continues the sentence instead of throwing it away.
   */
  const dictation = useDictation({
    onText: useCallback((text: string) => {
      setQuestion((current) => (current.trim() ? `${current.trim()} ${text}` : text));
    }, []),
  });
  const chatSheet = useSheet(closeMobileChat, { scrollable: true });

  /*
   * The phone note screen carries the design's actions menu: the more button
   * in the navbar opens a sheet naming the note, with Preimenuj and Izbriši on
   * it, each of which swaps to its own sheet the way the library rows do.
   */
  const [noteActionsOpen, setNoteActionsOpen] = useState(false);
  const [noteRenameOpen, setNoteRenameOpen] = useState(false);
  const [noteDeleteOpen, setNoteDeleteOpen] = useState(false);
  const [noteRenameValue, setNoteRenameValue] = useState("");
  const [noteActionError, setNoteActionError] = useState<string | null>(null);
  const [isNoteActionBusy, setIsNoteActionBusy] = useState(false);

  const noteActionsSheet = useSheet(useCallback(() => setNoteActionsOpen(false), []));
  const renameSheet = useSheet(
    useCallback(() => {
      setNoteRenameOpen(false);
      setNoteActionError(null);
    }, []),
    { locked: isNoteActionBusy },
  );
  const deleteSheet = useSheet(
    useCallback(() => {
      setNoteDeleteOpen(false);
      setNoteActionError(null);
    }, []),
    { locked: isNoteActionBusy },
  );
  const [practiceQuestionIndex, setPracticeQuestionIndex] = useState(0);

  // A pending auto-advance must not fire after the quiz is left behind.
  useEffect(
    () => () => {
      window.clearTimeout(quizAdvanceTimerRef.current ?? undefined);
    },
    [],
  );
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);

  const [isSending, setIsSending] = useState(false);
  const [trialChatMessagesRemaining, setTrialChatMessagesRemaining] = useState(
    initialTrialChatMessagesRemaining,
  );
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRegeneratingStudy, setIsRegeneratingStudy] = useState(false);
  const [isRegeneratingQuiz, setIsRegeneratingQuiz] = useState(false);
  const [isStartingPracticeTest, setIsStartingPracticeTest] = useState(false);
  const [isAwaitingStudyGeneration, setIsAwaitingStudyGeneration] = useState(false);
  const [isAwaitingQuizGeneration, setIsAwaitingQuizGeneration] = useState(false);
  const [isAwaitingPracticeTestGeneration, setIsAwaitingPracticeTestGeneration] = useState(false);
  const [isSubmittingPracticeTest, setIsSubmittingPracticeTest] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isSavingNoteDoc, setIsSavingNoteDoc] = useState(false);
  const [noteSelection, setNoteSelection] = useState<NoteSelectionRange | null>(null);
  const [isHighlightPaletteOpen, setIsHighlightPaletteOpen] = useState(false);
  const [selectedHighlightColorId, setSelectedHighlightColorId] = useState("orange");
  const activeHighlightColor =
    NOTE_HIGHLIGHT_COLORS.find((color) => color.id === selectedHighlightColorId) ??
    NOTE_HIGHLIGHT_COLORS[0];
  const [selectedNoteBlockId, setSelectedNoteBlockId] = useState<string | null>(null);
  const [selectedMediaBlockId, setSelectedMediaBlockId] = useState<string | null>(null);
  const [deletingNoteMediaIds, setDeletingNoteMediaIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [optimisticNoteMedia, setOptimisticNoteMedia] = useState<LectureDetail["noteMedia"]>(
    () => [],
  );
  const notePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const noteAnnotationShellRef = useRef<HTMLDivElement | null>(null);
  const deletingNoteMediaIdsRef = useRef(new Set<string>());
  const optimisticNoteMediaUrlsRef = useRef(new Map<string, string>());
  const studyManagerSheetRef = useRef<HTMLDivElement | null>(null);
  const noteScrollRef = useRef<HTMLDivElement | null>(null);
  const studyManagerItemSuppressClickRef = useRef(false);
  const studyManagerItemDragRef = useRef<StudyManagerItemDragState | null>(null);
  const deletingStudyItemIdsRef = useRef(new Set<string>());
  const [isStudyManagerOpen, setIsStudyManagerOpen] = useState(false);
  const [studyManagerSearch, setStudyManagerSearch] = useState("");
  const [studyManagerItemDrag, setStudyManagerItemDrag] =
    useState<StudyManagerItemDragState | null>(null);
  const [openStudyManagerActionItemId, setOpenStudyManagerActionItemId] = useState<string | null>(
    null,
  );
  const [editingFlashcardId, setEditingFlashcardId] = useState<string | null>(null);
  const [flashcardForm, setFlashcardForm] = useState<FlashcardFormState>(
    createEmptyFlashcardForm,
  );
  const [editingQuizQuestionId, setEditingQuizQuestionId] = useState<string | null>(null);
  const [quizQuestionForm, setQuizQuestionForm] = useState<QuizQuestionFormState>(
    createEmptyQuizQuestionForm,
  );
  const [isSavingStudyItem, setIsSavingStudyItem] = useState(false);
  const [deletingStudyItemIds, setDeletingStudyItemIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isFlashcardFlipped, setIsFlashcardFlipped] = useState(false);
  const [activeStudyView, setActiveStudyView] = useState<StudyMaterialView>(
    getInitialStudyView(initialDetail),
  );
  const initialFlashcardSession = sanitizeFlashcardSessionState(
    initialDetail.studySession?.flashcard_state,
    initialDetail.flashcards.map((flashcard) => flashcard.id),
  );
  const initialQuizQuestionsById = new Map(
    initialDetail.quizQuestions.map((question) => [question.id, question]),
  );
  const initialQuizSession = sanitizeQuizSessionState(
    initialDetail.studySession?.quiz_state,
    initialDetail.quizQuestions.map((question) => question.id),
    initialQuizQuestionsById,
  );
  const initialPracticeTestSession = sanitizePracticeTestSessionState(
    initialDetail.studySession?.practice_test_state,
    initialDetail,
  );
  const [reviewQueue, setReviewQueue] = useState<string[]>(initialFlashcardSession.reviewQueue);
  const [repeatQueue, setRepeatQueue] = useState<string[]>(initialFlashcardSession.repeatQueue);
  const [activeFlashcardIndex, setActiveFlashcardIndex] = useState(
    initialFlashcardSession.activeFlashcardIndex,
  );
  const [reviewCycle, setReviewCycle] = useState(initialFlashcardSession.reviewCycle);
  const [cycleCardCount, setCycleCardCount] = useState(initialFlashcardSession.cycleCardCount);
  const [flashcardRoundSummary, setFlashcardRoundSummary] = useState<FlashcardRoundSummary | null>(
    initialFlashcardSession.roundSummary,
  );
  const [flashcardExitAnimation, setFlashcardExitAnimation] = useState<FlashcardExitAnimation | null>(
    null,
  );
  const [flashcardDrag, setFlashcardDrag] = useState<FlashcardDragState>({
    isDragging: false,
    deltaX: 0,
    deltaY: 0,
    width: 0,
  });
  const [flashcardSessionResults, setFlashcardSessionResults] = useState<
    Record<string, FlashcardSessionResult>
  >(initialFlashcardSession.sessionResults);
  const [quizQueue, setQuizQueue] = useState<string[]>(initialQuizSession.quizQueue);
  const [quizRound, setQuizRound] = useState(initialQuizSession.quizRound);
  const [quizRoundCount, setQuizRoundCount] = useState(initialQuizSession.quizRoundCount);
  const [quizRoundSummary, setQuizRoundSummary] = useState<QuizRoundSummary | null>(
    initialQuizSession.roundSummary,
  );
  const [activeQuizQuestionIndex, setActiveQuizQuestionIndex] = useState(
    initialQuizSession.activeQuestionIndex,
  );
  const [quizSelections, setQuizSelections] = useState<Record<string, number>>(
    initialQuizSession.selections,
  );
  const [quizOptionOrders, setQuizOptionOrders] = useState<Map<string, number[]>>(
    new Map(Object.entries(initialQuizSession.optionOrders)),
  );
  const [currentPracticeAttemptId, setCurrentPracticeAttemptId] = useState<string | null>(
    initialPracticeTestSession.currentAttemptId,
  );
  const [practiceAttemptQuestionIds, setPracticeAttemptQuestionIds] = useState<string[]>(
    initialPracticeTestSession.attemptQuestionIds,
  );
  const [practiceTextAnswers, setPracticeTextAnswers] = useState<Record<string, string>>(
    initialPracticeTestSession.textAnswers,
  );
  const [practiceUnknownQuestionIds, setPracticeUnknownQuestionIds] = useState<string[]>(
    initialPracticeTestSession.unknownQuestionIds,
  );
  const [latestViewedPracticeAttemptId, setLatestViewedPracticeAttemptId] = useState<string | null>(
    initialPracticeTestSession.latestViewedAttemptId,
  );
  const [practiceSubmittedAt, setPracticeSubmittedAt] = useState<string | null>(
    initialPracticeTestSession.submittedAt,
  );
  const [chatLogNode, setChatLogNode] = useState<HTMLDivElement | null>(null);
  /** The answer as it is being written, replaced by the saved message at the end. */
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const flashcardFeedbackTimerRef = useRef<number | null>(null);
  const flashcardFeedbackTokenRef = useRef(0);
  const flashcardDragSessionRef = useRef<FlashcardDragSession | null>(null);
  const suppressNextFlashcardClickRef = useRef(false);
  const suppressNextFlashcardClickTimerRef = useRef<number | null>(null);
  const studySessionPayloadRef = useRef<string | null>(null);
  const detailRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastDetailRefreshAtRef = useRef(0);
  const studySessionWriteInFlightRef = useRef<Promise<void> | null>(null);
  const studySessionWritePayloadRef = useRef<string | null>(null);
  const lastPersistedStudySessionPayloadRef = useRef<string | null>(null);
  const lastFailedStudySessionPayloadRef = useRef<string | null>(null);
  const lastFailedStudySessionAtRef = useRef(0);
  const studyDeck = detail.flashcards;
  const flashcardDeckKey = studyDeck.map((flashcard) => flashcard.id).join("|");
  const quizDeckKey = detail.quizQuestions.map((question) => question.id).join("|");
  const practiceAttemptDeckKey = detail.practiceTestAttempts
    .map((attempt) => `${attempt.id}:${attempt.status}:${attempt.updated_at}`)
    .join("|");
  const isTrialLecture = !hasPaidAccess && trialLectureId === detail.lecture.id;
  const chatLimitReached = isTrialLecture && trialChatMessagesRemaining <= 0;
  const quizQuestionsById = useMemo(
    () => new Map(detail.quizQuestions.map((question) => [question.id, question])),
    [detail.quizQuestions],
  );
  const practiceAttemptsById = useMemo(
    () => new Map(detail.practiceTestAttempts.map((attempt) => [attempt.id, attempt])),
    [detail.practiceTestAttempts],
  );
  const currentReviewFlashcardId = reviewQueue[activeFlashcardIndex] ?? null;
  const showsTranscript = lectureShowsTranscript({
    lecture: detail.lecture,
    artifact: detail.artifact,
  });
  const shouldPollCurrentDetail = shouldPollDetail(detail);
  const detailPollIntervalMs =
    (detail.flashcards.length === 0 && shouldPollAsset(detail.studyAsset?.status)) ||
    shouldPollAsset(detail.quizAsset?.status)
      ? FAST_DETAIL_POLL_INTERVAL_MS
      : POLL_INTERVAL_MS;

  const refreshLectureDetail = useCallback(async (options?: { force?: boolean }) => {
    const now = Date.now();

    if (!options?.force && now - lastDetailRefreshAtRef.current < MIN_DETAIL_REFRESH_INTERVAL_MS) {
      return detailRefreshInFlightRef.current ?? undefined;
    }

    if (detailRefreshInFlightRef.current) {
      return detailRefreshInFlightRef.current;
    }

    lastDetailRefreshAtRef.current = now;

    const refreshRequest = (async () => {
      try {
        const refresh = await fetch(`/api/lectures/${detail.lecture.id}`, {
          cache: "no-store",
        });

        if (!refresh.ok) {
          return;
        }

        const nextDetail = (await refresh.json()) as LectureDetail;
        setDetail((current) => mergeLectureDetailForRefresh(current, nextDetail));
      } catch {
        return;
      }
    })().finally(() => {
      if (detailRefreshInFlightRef.current === refreshRequest) {
        detailRefreshInFlightRef.current = null;
      }
    });

    detailRefreshInFlightRef.current = refreshRequest;
    return refreshRequest;
  }, [detail.lecture.id]);

  const persistStudySessionPayload = useCallback((
    payload: string,
    options?: { force?: boolean; preferBeacon?: boolean },
  ) => {
    const now = Date.now();

    if (lastPersistedStudySessionPayloadRef.current === payload) {
      return;
    }

    if (
      !options?.force &&
      lastFailedStudySessionPayloadRef.current === payload &&
      now - lastFailedStudySessionAtRef.current < STUDY_SESSION_FAILED_RETRY_COOLDOWN_MS
    ) {
      return;
    }

    if (
      studySessionWriteInFlightRef.current &&
      studySessionWritePayloadRef.current === payload
    ) {
      return;
    }

    const payloadBlob = new Blob([payload], {
      type: "application/json",
    });
    const canUsePageLifecycleTransport = payloadBlob.size <= STUDY_SESSION_KEEPALIVE_MAX_BYTES;

    if (
      options?.preferBeacon &&
      canUsePageLifecycleTransport &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const queued = navigator.sendBeacon(
        `/api/lectures/${detail.lecture.id}/study-session`,
        payloadBlob,
      );

      if (queued) {
        lastPersistedStudySessionPayloadRef.current = payload;
        lastFailedStudySessionPayloadRef.current = null;
      }
      return;
    }

    if (options?.preferBeacon && !canUsePageLifecycleTransport) {
      return;
    }

    studySessionWritePayloadRef.current = payload;
    const writeRequest = fetch(`/api/lectures/${detail.lecture.id}/study-session`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
      keepalive: canUsePageLifecycleTransport,
    })
      .then((response) => {
        if (response.ok) {
          lastPersistedStudySessionPayloadRef.current = payload;
          lastFailedStudySessionPayloadRef.current = null;
          return;
        }

        lastFailedStudySessionPayloadRef.current = payload;
        lastFailedStudySessionAtRef.current = Date.now();
      })
      .catch(() => {
        lastFailedStudySessionPayloadRef.current = payload;
        lastFailedStudySessionAtRef.current = Date.now();
        ignoreBackgroundRequestError();
      })
      .finally(() => {
        if (studySessionWriteInFlightRef.current === writeRequest) {
          studySessionWriteInFlightRef.current = null;
          studySessionWritePayloadRef.current = null;
        }
      });

    studySessionWriteInFlightRef.current = writeRequest;
  }, [detail.lecture.id]);

  useEffect(() => {
    const nextDetail = mergeLectureDetailWithStoredStudySession(initialDetail);
    setDetail(nextDetail);
    setActiveStudyView(getInitialStudyView(nextDetail));
  }, [initialDetail]);

  useEffect(() => {
    if (activeTab === "transcript" && !showsTranscript) {
      setActiveTab("notes");
    }
  }, [activeTab, showsTranscript]);

  useEffect(() => {
    if (activeTab === "audio" && !detail.audioUrl) {
      setActiveTab("notes");
    }
  }, [activeTab, detail.audioUrl]);

  useEffect(() => {
    if (activeTab === "study") {
      setActiveStudyView((current) => {
        if (current === "practice_test" && detail.practiceTestQuestions.length > 0) {
          return current;
        }

        if (current === "quiz" && detail.quizQuestions.length > 0) {
          return current;
        }

        if (detail.flashcards.length > 0) {
          return "flashcards";
        }

        if (detail.quizQuestions.length > 0) {
          return "quiz";
        }

        if (detail.practiceTestQuestions.length > 0) {
          return "practice_test";
        }

        return "flashcards";
      });
    }
  }, [activeTab, detail.flashcards.length, detail.practiceTestQuestions.length, detail.quizQuestions.length]);

  useEffect(() => {
    if (!shouldPollCurrentDetail) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshLectureDetail();
    }, detailPollIntervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshLectureDetail({ force: true });
      }
    };

    const handleFocus = () => {
      void refreshLectureDetail();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    detail.flashcards.length,
    detail.lecture.id,
    detail.lecture.status,
    detail.practiceTestAsset?.status,
    detail.practiceTestQuestions.length,
    detail.quizAsset?.status,
    detail.quizQuestions.length,
    detailPollIntervalMs,
    refreshLectureDetail,
    detail.studyAsset?.status,
    shouldPollCurrentDetail,
  ]);

  useEffect(() => {
    setIsFlashcardFlipped(false);
    flashcardDragSessionRef.current = null;
    setFlashcardDrag({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
  }, [activeTab, currentReviewFlashcardId]);

  useEffect(() => {
    const flashcardIds = flashcardDeckKey ? flashcardDeckKey.split("|") : [];
    const nextState = sanitizeFlashcardSessionState(
      detail.studySession?.flashcard_state,
      flashcardIds,
    );

    setReviewQueue(nextState.reviewQueue);
    setRepeatQueue(nextState.repeatQueue);
    setActiveFlashcardIndex(nextState.activeFlashcardIndex);
    setReviewCycle(nextState.reviewCycle);
    setCycleCardCount(nextState.cycleCardCount);
    setFlashcardRoundSummary(nextState.roundSummary);
    setFlashcardSessionResults(nextState.sessionResults);
    setFlashcardExitAnimation(null);
    setFlashcardDrag({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
    setStudyError(null);
  }, [detail.studySession?.flashcard_state, flashcardDeckKey]);

  useEffect(() => {
    const quizQuestionIds = quizDeckKey ? quizDeckKey.split("|") : [];
    const nextState = sanitizeQuizSessionState(
      detail.studySession?.quiz_state,
      quizQuestionIds,
      quizQuestionsById,
    );

    setQuizQueue(nextState.quizQueue);
    setQuizRound(nextState.quizRound);
    setQuizRoundCount(nextState.quizRoundCount);
    setQuizRoundSummary(nextState.roundSummary);
    setActiveQuizQuestionIndex(nextState.activeQuestionIndex);
    setQuizSelections(nextState.selections);
    setQuizOptionOrders(new Map(Object.entries(nextState.optionOrders)));
  }, [detail.studySession?.quiz_state, quizDeckKey, quizQuestionsById]);

  useEffect(() => {
    const nextState = sanitizePracticeTestSessionState(
      detail.studySession?.practice_test_state,
      detail,
    );

    setCurrentPracticeAttemptId(nextState.currentAttemptId);
    setPracticeAttemptQuestionIds(nextState.attemptQuestionIds);
    setPracticeTextAnswers(nextState.textAnswers);
    setPracticeUnknownQuestionIds(nextState.unknownQuestionIds);
    setLatestViewedPracticeAttemptId(nextState.latestViewedAttemptId);
    setPracticeSubmittedAt(nextState.submittedAt);
  }, [detail.studySession?.practice_test_state, detail, practiceAttemptDeckKey]);

  useEffect(() => {
    return () => {
      if (flashcardFeedbackTimerRef.current) {
        window.clearTimeout(flashcardFeedbackTimerRef.current);
      }
      if (suppressNextFlashcardClickTimerRef.current) {
        window.clearTimeout(suppressNextFlashcardClickTimerRef.current);
      }
    };
  }, []);

  /*
   * The chat log follows its own content. A MutationObserver rather than a
   * dependency list, because an answer arrives a token at a time — the message
   * count never changes while it is being written, so nothing else would fire.
   *
   * It only sticks when the reader is already at the bottom: having scrolled up
   * to re-read something, being yanked back down by every arriving token is
   * worse than losing the tail.
   */
  useEffect(() => {
    const log = chatLogNode;

    if (!log) {
      return;
    }

    const isNearBottom = () =>
      log.scrollHeight - log.scrollTop - log.clientHeight < STICK_TO_BOTTOM_PX;

    const stick = () => {
      log.scrollTop = log.scrollHeight;
    };

    stick();

    let pinned = true;
    const handleScroll = () => {
      pinned = isNearBottom();
    };

    const observer = new MutationObserver(() => {
      if (pinned) {
        stick();
      }
    });

    observer.observe(log, { childList: true, subtree: true, characterData: true });
    log.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      log.removeEventListener("scroll", handleScroll);
    };
  }, [chatLogNode]);

  useEffect(() => {
    const nextSavedAt = new Date().toISOString();
    const nextSession = {
      activeStudyView,
      flashcardState:
        studyDeck.length > 0
          ? {
              reviewQueue,
              repeatQueue,
              activeFlashcardIndex,
              reviewCycle,
              cycleCardCount,
              roundSummary: flashcardRoundSummary,
              sessionResults: flashcardSessionResults,
            }
          : null,
      quizState:
        detail.quizQuestions.length > 0
          ? {
              quizQueue,
              quizRound,
              quizRoundCount,
              roundSummary: quizRoundSummary,
              activeQuestionIndex: activeQuizQuestionIndex,
              selections: quizSelections,
              optionOrders: serializeQuizOptionOrders(quizOptionOrders),
            }
          : null,
      practiceTestState:
        detail.practiceTestQuestions.length > 0
          ? {
              currentAttemptId: currentPracticeAttemptId,
              attemptQuestionIds: practiceAttemptQuestionIds,
              textAnswers: practiceTextAnswers,
              unknownQuestionIds: practiceUnknownQuestionIds,
              latestViewedAttemptId: latestViewedPracticeAttemptId,
              submittedAt: practiceSubmittedAt,
            }
          : null,
    };
    const payload = JSON.stringify(nextSession);

    studySessionPayloadRef.current = payload;
    writeStudySessionSnapshot(detail.lecture.id, {
      ...nextSession,
      savedAt: nextSavedAt,
    });

    const timeoutId = window.setTimeout(() => {
      persistStudySessionPayload(payload);
    }, STUDY_SESSION_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeQuizQuestionIndex,
    activeFlashcardIndex,
    activeStudyView,
    cycleCardCount,
    currentPracticeAttemptId,
    detail.lecture.id,
    detail.practiceTestQuestions.length,
    detail.quizQuestions.length,
    flashcardRoundSummary,
    flashcardSessionResults,
    latestViewedPracticeAttemptId,
    practiceAttemptQuestionIds,
    practiceSubmittedAt,
    practiceTextAnswers,
    practiceUnknownQuestionIds,
    quizOptionOrders,
    quizQueue,
    quizRound,
    quizRoundCount,
    quizRoundSummary,
    quizSelections,
    repeatQueue,
    reviewCycle,
    reviewQueue,
    persistStudySessionPayload,
    studyDeck.length,
  ]);

  useEffect(() => {
    const flushStudySession = (preferBeacon = false) => {
      if (!studySessionPayloadRef.current) {
        return;
      }

      persistStudySessionPayload(studySessionPayloadRef.current, {
        force: true,
        preferBeacon,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushStudySession(true);
      }
    };

    const handlePageHide = () => {
      flushStudySession(true);
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      flushStudySession();
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistStudySessionPayload]);
  const cleanedStructuredNotes = useMemo(() => {
    if (!detail.artifact?.structured_notes_md) {
      return null;
    }

    return stripLeadingRedundantHeading(
      detail.artifact.structured_notes_md,
      detail.lecture.title,
    );
  }, [detail.artifact?.structured_notes_md, detail.lecture.title]);
  const activeNoteDoc = detail.editableNoteDoc ?? createClientFallbackNoteDoc();
  const renderedNoteMedia = useMemo(() => {
    const savedMediaIds = new Set(detail.noteMedia.map((media) => media.id));
    return [
      ...detail.noteMedia,
      ...optimisticNoteMedia.filter((media) => !savedMediaIds.has(media.id)),
    ];
  }, [detail.noteMedia, optimisticNoteMedia]);
  const noteBlockIds = useMemo(
    () => (cleanedStructuredNotes ? parseNoteTtsDocument(cleanedStructuredNotes).blocks.map((block) => block.id) : []),
    [cleanedStructuredNotes],
  );
  useEffect(
    () => () => {
      optimisticNoteMediaUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      optimisticNoteMediaUrlsRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const isAnnotationPaletteExpanded =
      activeTab === "notes" && Boolean(noteSelection) && isHighlightPaletteOpen;

    // The note dock is rendered twice — once portalled for mobile, once inside
    // the card for desktop — and the hidden copy still matches the selector with
    // an all-zero rect. Measuring that one never overlaps anything, so pick the
    // copy that is actually laid out.
    function findVisibleAnnotationToolbar() {
      const toolbars = document.querySelectorAll(
        ".mobile-note-annotation-pill .note-annotation-toolbar",
      );

      for (const toolbar of toolbars) {
        if (toolbar instanceof HTMLElement && toolbar.offsetParent !== null) {
          return toolbar;
        }
      }

      return null;
    }

    function updateDockOverlapState() {
      if (!isAnnotationPaletteExpanded) {
        delete document.body.dataset.noteAnnotationDockOverlap;
        return;
      }

      const annotationToolbar = findVisibleAnnotationToolbar();
      const mobileDockToggle = document.querySelector(".mobile-dock-toggle");

      if (!annotationToolbar || !(mobileDockToggle instanceof HTMLElement)) {
        delete document.body.dataset.noteAnnotationDockOverlap;
        return;
      }

      const overlaps = doRectsOverlap(
        annotationToolbar.getBoundingClientRect(),
        mobileDockToggle.getBoundingClientRect(),
      );

      if (overlaps) {
        document.body.dataset.noteAnnotationDockOverlap = "true";
      } else {
        delete document.body.dataset.noteAnnotationDockOverlap;
      }
    }

    updateDockOverlapState();
    const animationFrame = window.requestAnimationFrame(updateDockOverlapState);
    window.addEventListener("resize", updateDockOverlapState);
    window.visualViewport?.addEventListener("resize", updateDockOverlapState);

    // The pill widens over 220ms when the palette opens, so the collision only
    // exists once that transition has run. Watch the element instead of trusting
    // a single measurement taken while it is still narrow.
    const toolbar = isAnnotationPaletteExpanded ? findVisibleAnnotationToolbar() : null;
    let resizeObserver: ResizeObserver | null = null;

    if (toolbar) {
      resizeObserver = new ResizeObserver(updateDockOverlapState);
      resizeObserver.observe(toolbar);
      toolbar.addEventListener("transitionend", updateDockOverlapState);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateDockOverlapState);
      window.visualViewport?.removeEventListener("resize", updateDockOverlapState);
      resizeObserver?.disconnect();
      toolbar?.removeEventListener("transitionend", updateDockOverlapState);
      delete document.body.dataset.noteAnnotationDockOverlap;
    };
  }, [activeTab, isHighlightPaletteOpen, noteSelection]);
  const notesArtifactLoadFailed =
    !cleanedStructuredNotes &&
    detail.lecture.status === "ready" &&
    detailSectionFailed(detail, "artifact");
  const noteEnrichmentPending = isNoteEnrichmentPending(detail.artifact?.model_metadata);
  const studyStage =
    detail.studyAsset?.model_metadata &&
    typeof detail.studyAsset.model_metadata === "object" &&
    !Array.isArray(detail.studyAsset.model_metadata) &&
    "stage" in detail.studyAsset.model_metadata
      ? detail.studyAsset.model_metadata.stage
      : null;
  const studyStageCopy = studyStageLabel(studyStage);
  const quizStage =
    detail.quizAsset?.model_metadata &&
    typeof detail.quizAsset.model_metadata === "object" &&
    !Array.isArray(detail.quizAsset.model_metadata) &&
    "stage" in detail.quizAsset.model_metadata
      ? detail.quizAsset.model_metadata.stage
      : null;
  const quizStageCopy = quizStageLabel(quizStage);
  const practiceTestStage =
    detail.practiceTestAsset?.model_metadata &&
    typeof detail.practiceTestAsset.model_metadata === "object" &&
    !Array.isArray(detail.practiceTestAsset.model_metadata) &&
    "stage" in detail.practiceTestAsset.model_metadata
      ? detail.practiceTestAsset.model_metadata.stage
      : null;
  const practiceTestStageCopy = practiceTestStageLabel(practiceTestStage);
  const lectureProcessingStageCopy = lectureProcessingStageLabel(
    detail.lecture.status,
    getLectureProcessingStage(detail.lecture.processing_metadata),
  );
  const totalFlashcards = studyDeck.length;
  const flashcardFirstPassKnownCount = studyDeck.reduce((total, flashcard) => {
    return flashcardSessionResults[flashcard.id]?.firstConfidence !== "again" &&
      flashcardSessionResults[flashcard.id]?.firstConfidence
      ? total + 1
      : total;
  }, 0);
  const flashcardConfidencePercent =
    totalFlashcards > 0 ? Math.round((flashcardFirstPassKnownCount / totalFlashcards) * 100) : 0;
  const currentQuizQuestionId = quizQueue[activeQuizQuestionIndex] ?? null;
  const activeQuizQuestion = currentQuizQuestionId
    ? (quizQuestionsById.get(currentQuizQuestionId) ?? null)
    : null;
  const activeQuizSelection =
    currentQuizQuestionId ? (quizSelections[currentQuizQuestionId] ?? null) : null;
  const activeQuizOptionOrder =
    currentQuizQuestionId && activeQuizQuestion
      ? (quizOptionOrders.get(currentQuizQuestionId) ??
        Array.from({ length: activeQuizQuestion.options.length }, (_, index) => index))
      : [];
  /*
   * The design only interrupts on a wrong answer: a right one advances on its
   * own, and the miss opens a row that names the answer and offers a way into
   * chat. The letter shown is the option's position in the shuffled order, not
   * its index in the stored question.
   */
  const quizAnswerWasWrong =
    activeQuizQuestion !== null &&
    activeQuizSelection !== null &&
    activeQuizSelection !== activeQuizQuestion.correct_option_idx;
  const correctQuizOptionLetter = activeQuizQuestion
    ? String.fromCharCode(
        65 + Math.max(0, activeQuizOptionOrder.indexOf(activeQuizQuestion.correct_option_idx)),
      )
    : "";
  const totalQuizQuestions = detail.quizQuestions.length;
  const quizRoundPercent =
    quizRoundSummary && quizRoundSummary.total > 0
      ? Math.round((quizRoundSummary.correct / quizRoundSummary.total) * 100)
      : 0;
  const persistedPracticeAttempt =
    currentPracticeAttemptId ? practiceAttemptsById.get(currentPracticeAttemptId) ?? null : null;
  const currentPracticeAttempt =
    (persistedPracticeAttempt?.status === "in_progress" ? persistedPracticeAttempt : null) ??
    detail.practiceTestAttempts.find((attempt) => attempt.status === "in_progress") ??
    null;
  const currentPracticeAttemptKey = currentPracticeAttempt?.id ?? null;

  // A fresh attempt starts at its first question.
  useEffect(() => {
    setPracticeQuestionIndex(0);
  }, [currentPracticeAttemptKey]);
  const latestGradedPracticeAttempt =
    [...detail.practiceTestAttempts].reverse().find((attempt) => attempt.status === "graded") ?? null;
  const visiblePracticeAttempt =
    (latestViewedPracticeAttemptId
      ? practiceAttemptsById.get(latestViewedPracticeAttemptId) ?? null
      : null) ?? latestGradedPracticeAttempt;
  const visiblePracticeAttemptPercentage = Math.round(visiblePracticeAttempt?.percentage ?? 0);
  const practiceAttemptAnswers = currentPracticeAttempt?.answers ?? [];
  const hasCompletedPracticeTest = detail.practiceTestHistorySummary.attemptCount > 0;
  const practiceQuestionsAnsweredCount = practiceAttemptAnswers.filter((answer) => {
    const questionId = answer.practice_test_question_id ?? `snapshot-${answer.id}`;
    return (
      practiceUnknownQuestionIds.includes(questionId) ||
      Boolean(practiceTextAnswers[questionId]?.trim())
    );
  }).length;
  const isStudyGenerating =
    totalFlashcards === 0 && (shouldPollAsset(detail.studyAsset?.status) || isAwaitingStudyGeneration);
  const isQuizGenerating = shouldPollAsset(detail.quizAsset?.status) || isAwaitingQuizGeneration;
  const isPracticeTestGenerating =
    shouldPollAsset(detail.practiceTestAsset?.status) || isAwaitingPracticeTestGeneration;

  useEffect(() => {
    if (
      isAwaitingStudyGeneration &&
      (shouldPollAsset(detail.studyAsset?.status) ||
        detail.studyAsset?.status === "failed" ||
        detail.studyAsset?.status === "ready" ||
        detail.flashcards.length > 0)
    ) {
      setIsAwaitingStudyGeneration(false);
    }
  }, [detail.flashcards.length, detail.studyAsset?.status, isAwaitingStudyGeneration]);

  useEffect(() => {
    if (
      isAwaitingQuizGeneration &&
      (shouldPollAsset(detail.quizAsset?.status) ||
        detail.quizAsset?.status === "failed" ||
        detail.quizAsset?.status === "ready" ||
        detail.quizQuestions.length > 0)
    ) {
      setIsAwaitingQuizGeneration(false);
    }
  }, [detail.quizAsset?.status, detail.quizQuestions.length, isAwaitingQuizGeneration]);

  useEffect(() => {
    if (
      isAwaitingPracticeTestGeneration &&
      (shouldPollAsset(detail.practiceTestAsset?.status) ||
        detail.practiceTestAsset?.status === "failed" ||
        detail.practiceTestQuestions.length > 0 ||
        detail.practiceTestAttempts.some((attempt) => attempt.status === "in_progress"))
    ) {
      setIsAwaitingPracticeTestGeneration(false);
    }
  }, [
    detail.practiceTestAsset?.status,
    detail.practiceTestAttempts,
    detail.practiceTestQuestions.length,
    isAwaitingPracticeTestGeneration,
  ]);

  async function handleRetry() {
    setIsRetrying(true);
    const response = await fetch(`/api/lectures/${detail.lecture.id}/retry`, {
      method: "POST",
    }).catch(ignoreBackgroundRequestError);
    setIsRetrying(false);

    if (!response?.ok) {
      return;
    }

    await refreshLectureDetail({ force: true });
  }

  useEffect(() => {
    void refreshLectureDetail({ force: true });
  }, [refreshLectureDetail]);

  async function handleStudyCreate() {
    setStudyError(null);
    setIsAwaitingStudyGeneration(true);
    setIsRegeneratingStudy(true);

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/study`, {
        method: "POST",
      });
      await parseApiResponse<{ ok: true }>(response);
    } catch (error) {
      if (redirectToBillingIfNeeded({ error, router })) {
        return;
      }

      setIsAwaitingStudyGeneration(false);
      setStudyError(getRequestErrorMessage(error, "Učnih orodij ni bilo mogoče ponovno ustvariti."));
      return;
    } finally {
      setIsRegeneratingStudy(false);
    }

    await refreshLectureDetail();
  }

  async function handleQuizCreate() {
    setStudyError(null);
    setIsAwaitingQuizGeneration(true);
    setIsRegeneratingQuiz(true);

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/quiz`, {
        method: "POST",
      });
      await parseApiResponse<{ ok: true }>(response);
    } catch (error) {
      if (redirectToBillingIfNeeded({ error, router })) {
        return;
      }

      setIsAwaitingQuizGeneration(false);
      setStudyError(getRequestErrorMessage(error, "Kviza ni bilo mogoče ustvariti."));
      return;
    } finally {
      setIsRegeneratingQuiz(false);
    }

    await refreshLectureDetail();
  }

  async function handlePracticeTestStart() {
    setStudyError(null);
    setIsAwaitingPracticeTestGeneration(true);
    setIsStartingPracticeTest(true);

    let payload: {
      id?: string;
      questions?: Array<{ id: string }>;
    };

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/practice-test/attempt`, {
        method: "POST",
      });
      payload = await parseApiResponse(response);
    } catch (error) {
      if (redirectToBillingIfNeeded({ error, router })) {
        return;
      }

      setIsAwaitingPracticeTestGeneration(false);
      setStudyError(
        getRequestErrorMessage(error, "Novega preizkusa ni bilo mogoče začeti."),
      );
      return;
    } finally {
      setIsStartingPracticeTest(false);
    }

    setCurrentPracticeAttemptId(payload?.id ?? null);
    setPracticeAttemptQuestionIds(
      Array.isArray(payload?.questions) ? payload.questions.map((question: { id: string }) => question.id) : [],
    );
    setPracticeTextAnswers({});
    setPracticeUnknownQuestionIds([]);
    setLatestViewedPracticeAttemptId(payload?.id ?? null);
    setPracticeSubmittedAt(null);
    await refreshLectureDetail();
  }

  function handlePracticeAnswerChange(questionId: string, value: string) {
    setPracticeTextAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  }

  function handlePracticeUnknownToggle(questionId: string, enabled: boolean) {
    setPracticeUnknownQuestionIds((current) => {
      if (enabled) {
        return current.includes(questionId) ? current : [...current, questionId];
      }

      return current.filter((id) => id !== questionId);
    });

    if (enabled) {
      setPracticeTextAnswers((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
    }
  }

  function getFlashcardDragThreshold(width: number) {
    return Math.min(
      FLASHCARD_DRAG_TRIGGER_MAX_PX,
      Math.max(FLASHCARD_DRAG_TRIGGER_MIN_PX, width * FLASHCARD_DRAG_TRIGGER_RATIO),
    );
  }

  function getFlashcardDragRotation(deltaX: number, width: number) {
    if (width <= 0) {
      return 0;
    }

    const ratio = Math.max(-1, Math.min(1, deltaX / width));
    return ratio * FLASHCARD_DRAG_MAX_ROTATION_DEG;
  }

  function getFlashcardExitStart(deltaX: number, deltaY: number, width: number): FlashcardExitStart {
    const safeWidth = Math.max(width, 1);

    return {
      xPercent: (deltaX / safeWidth) * 100,
      yPercent: (deltaY / safeWidth) * 100,
      rotationDeg: getFlashcardDragRotation(deltaX, safeWidth),
    };
  }

  function resetFlashcardDrag() {
    flashcardDragSessionRef.current = null;
    setFlashcardDrag({ isDragging: false, deltaX: 0, deltaY: 0, width: 0 });
  }

  function suppressNextFlashcardClick(durationMs = 700) {
    suppressNextFlashcardClickRef.current = true;

    if (suppressNextFlashcardClickTimerRef.current) {
      window.clearTimeout(suppressNextFlashcardClickTimerRef.current);
    }

    suppressNextFlashcardClickTimerRef.current = window.setTimeout(() => {
      suppressNextFlashcardClickRef.current = false;
      suppressNextFlashcardClickTimerRef.current = null;
    }, durationMs);
  }

  function clearNextFlashcardClickSuppression() {
    suppressNextFlashcardClickRef.current = false;

    if (suppressNextFlashcardClickTimerRef.current) {
      window.clearTimeout(suppressNextFlashcardClickTimerRef.current);
      suppressNextFlashcardClickTimerRef.current = null;
    }
  }

  function handleFlashcardPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (
      flashcardExitAnimation ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    flashcardDragSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already cancelled the pointer.
    }
  }

  function handleFlashcardPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = flashcardDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const rawDeltaX = event.clientX - session.startX;
    const rawDeltaY = event.clientY - session.startY;
    const hasIntent = Math.abs(rawDeltaX) > 4 || Math.abs(rawDeltaY) > 4;

    if (!hasIntent) {
      return;
    }

    if (Math.abs(rawDeltaX) > 8) {
      suppressNextFlashcardClick();
    }

    const maxDrag = session.width * 0.56;
    const deltaX = Math.max(-maxDrag, Math.min(maxDrag, rawDeltaX));
    const deltaY = Math.max(-42, Math.min(42, rawDeltaY * 0.18));

    setFlashcardDrag({
      isDragging: true,
      deltaX,
      deltaY,
      width: session.width,
    });
  }

  function handleFlashcardPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = flashcardDragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const rawDeltaX = event.clientX - session.startX;
    const rawDeltaY = event.clientY - session.startY;
    const maxDrag = session.width * 0.56;
    const deltaX = Math.max(-maxDrag, Math.min(maxDrag, rawDeltaX));
    const deltaY = Math.max(-42, Math.min(42, rawDeltaY * 0.18));
    const threshold = getFlashcardDragThreshold(session.width);
    const shouldSubmit = Math.abs(deltaX) >= threshold;
    const bucket: FlashcardConfidenceBucket = deltaX < 0 ? "again" : "easy";

    if (Math.abs(rawDeltaX) > 8 || Math.abs(rawDeltaY) > 8) {
      suppressNextFlashcardClick();
    }

    resetFlashcardDrag();

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }

    if (shouldSubmit) {
      suppressNextFlashcardClick();
      void handleFlashcardProgress(bucket, {
        exitStart: getFlashcardExitStart(deltaX, deltaY, session.width),
      });
    }
  }

  function handleFlashcardClick() {
    if (suppressNextFlashcardClickRef.current) {
      clearNextFlashcardClickSuppression();
      return;
    }

    setIsFlashcardFlipped((current) => !current);
  }

  async function handlePracticeTestSubmit() {
    if (!currentPracticeAttempt) {
      return;
    }

    const answers = currentPracticeAttempt.answers.map((answer) => {
      const questionId = answer.practice_test_question_id ?? `snapshot-${answer.id}`;
      return {
        answerId: answer.id,
        typedAnswer: practiceTextAnswers[questionId] ?? "",
        declaredUnknown: practiceUnknownQuestionIds.includes(questionId),
      };
    });

    setStudyError(null);
    setIsSubmittingPracticeTest(true);
    let response: Response;
    let payload: { error?: unknown } | null = null;
    try {
      response = await fetch(
        `/api/lectures/${detail.lecture.id}/practice-test/attempt/${currentPracticeAttempt.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ answers }),
        },
      );
      payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    } catch (error) {
      setStudyError(getRequestErrorMessage(error, "Preizkusa ni bilo mogoče oddati."));
      return;
    } finally {
      setIsSubmittingPracticeTest(false);
    }

    if (!response.ok) {
      setStudyError(getApiErrorMessage(payload, "Preizkusa ni bilo mogoče oddati."));
      return;
    }

    const submittedAt = new Date().toISOString();
    setPracticeSubmittedAt(submittedAt);
    setLatestViewedPracticeAttemptId(currentPracticeAttempt.id);
    await refreshLectureDetail();
  }

  async function handleFlashcardProgress(
    confidenceBucket: FlashcardConfidenceBucket,
    options?: { exitStart?: FlashcardExitStart },
  ) {
    const currentFlashcardId = reviewQueue[activeFlashcardIndex];
    const flashcard = studyDeck.find((item) => item.id === currentFlashcardId);
    if (!flashcard) {
      return;
    }

    setStudyError(null);
    const isLastCardInRound = activeFlashcardIndex >= reviewQueue.length - 1;
    const previousDetail = detail;
    const previousReviewQueue = reviewQueue;
    const previousRepeatQueue = repeatQueue;
    const previousActiveFlashcardIndex = activeFlashcardIndex;
    const previousRoundSummary = flashcardRoundSummary;
    const previousResults = flashcardSessionResults[flashcard.id];
    const previousProgress = flashcard.progress;
    const wasFlashcardFlipped = isFlashcardFlipped;
    const nextRepeatQueue =
      confidenceBucket === "again"
        ? Array.from(new Set([...repeatQueue, flashcard.id]))
        : repeatQueue.filter((id) => id !== flashcard.id);
    flashcardFeedbackTokenRef.current += 1;
    const feedbackToken = flashcardFeedbackTokenRef.current;
    const nextProgress = {
      ...(previousProgress ?? {
        user_id: detail.lecture.user_id,
        flashcard_id: flashcard.id,
        confidence_bucket: confidenceBucket,
        review_count: 0,
        last_reviewed_at: null,
      }),
      confidence_bucket: confidenceBucket,
      review_count: (previousProgress?.review_count ?? 0) + 1,
      last_reviewed_at: new Date().toISOString(),
    };

    if (flashcardFeedbackTimerRef.current) {
      window.clearTimeout(flashcardFeedbackTimerRef.current);
    }

    setFlashcardExitAnimation({
      flashcard,
      bucket: confidenceBucket,
      flipped: wasFlashcardFlipped,
      token: feedbackToken,
      startXPercent: options?.exitStart?.xPercent ?? 0,
      startYPercent: options?.exitStart?.yPercent ?? 0,
      startRotationDeg: options?.exitStart?.rotationDeg ?? 0,
    });
    setIsFlashcardFlipped(false);
    flashcardFeedbackTimerRef.current = window.setTimeout(() => {
      setFlashcardExitAnimation((current) =>
        current?.token === feedbackToken ? null : current,
      );
      flashcardFeedbackTimerRef.current = null;
    }, FLASHCARD_EXIT_ANIMATION_MS);

    setDetail((current) => ({
      ...current,
      studySections: current.studySections.map((section) => {
        const matchesSection = isLegacySectionId(section.id)
          ? !flashcard.section_id
          : section.id === flashcard.section_id;

        if (!matchesSection) {
          return section;
        }

        const wasReviewed = (flashcard.progress?.review_count ?? 0) > 0;
        const nextReviewedCount = wasReviewed
          ? section.reviewedCount
          : Math.min(section.reviewedCount + 1, section.card_count);
        return {
          ...section,
          reviewedCount: nextReviewedCount,
          completed: nextReviewedCount >= section.card_count,
        };
      }),
      flashcards: current.flashcards.map((currentFlashcard) =>
        currentFlashcard.id === flashcard.id
          ? {
              ...currentFlashcard,
              progress: nextProgress,
            }
          : currentFlashcard,
      ),
    }));
    setFlashcardSessionResults((current) => {
      const previous = current[flashcard.id];

      return {
        ...current,
        [flashcard.id]: {
          attempts: (previous?.attempts ?? 0) + 1,
          firstConfidence: previous?.firstConfidence ?? confidenceBucket,
          latestConfidence: confidenceBucket,
        },
      };
    });

    setRepeatQueue(nextRepeatQueue);

    if (isLastCardInRound) {
      setFlashcardRoundSummary({
        cycle: reviewCycle,
        total: cycleCardCount,
        known: cycleCardCount - nextRepeatQueue.length,
        missed: nextRepeatQueue.length,
      });
    } else {
      setActiveFlashcardIndex((current) => Math.min(current + 1, reviewQueue.length - 1));
    }

    let response: Response;
    let payload: FlashcardProgressResponse | null = null;
    try {
      response = await fetch(`/api/flashcards/${flashcard.id}/progress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confidenceBucket }),
      });
      payload = (await response.json().catch(() => null)) as FlashcardProgressResponse | null;
    } catch (error) {
      setDetail(previousDetail);
      setFlashcardSessionResults((current) => {
        const next = { ...current };

        if (previousResults) {
          next[flashcard.id] = previousResults;
        } else {
          delete next[flashcard.id];
        }

        return next;
      });
      setReviewQueue(previousReviewQueue);
      setRepeatQueue(previousRepeatQueue);
      setActiveFlashcardIndex(previousActiveFlashcardIndex);
      setFlashcardRoundSummary(previousRoundSummary);
      setStudyError(getRequestErrorMessage(error, "Napredka pri karticah ni bilo mogoče shraniti."));
      return;
    }

    if (!response.ok) {
      setDetail(previousDetail);
      setFlashcardSessionResults((current) => {
        const next = { ...current };

        if (previousResults) {
          next[flashcard.id] = previousResults;
        } else {
          delete next[flashcard.id];
        }

        return next;
      });
      setReviewQueue(previousReviewQueue);
      setRepeatQueue(previousRepeatQueue);
      setActiveFlashcardIndex(previousActiveFlashcardIndex);
      setFlashcardRoundSummary(previousRoundSummary);
      setStudyError(
        getApiErrorMessage(payload, "Napredka pri karticah ni bilo mogoče shraniti."),
      );
      return;
    }

    const savedProgress = payload?.progress;
    if (savedProgress) {
      setDetail((current) => ({
        ...current,
        flashcards: current.flashcards.map((currentFlashcard) =>
          currentFlashcard.id === flashcard.id
            ? {
                ...currentFlashcard,
                progress: savedProgress,
              }
            : currentFlashcard,
        ),
      }));
    }
  }

  function continueFlashcardReview(nextRepeatQueue = repeatQueue) {
    if (nextRepeatQueue.length === 0) {
      return;
    }

    const repeatIds = new Set(nextRepeatQueue);
    setReviewQueue(nextRepeatQueue);
    setRepeatQueue([]);
    setActiveFlashcardIndex(0);
    setReviewCycle((current) => current + 1);
    setCycleCardCount(nextRepeatQueue.length);
    setIsFlashcardFlipped(false);
    setFlashcardRoundSummary(null);
    setFlashcardSessionResults((current) =>
      Object.fromEntries(Object.entries(current).filter(([flashcardId]) => !repeatIds.has(flashcardId))),
    );
    setStudyError(null);
  }

  function restartFlashcardReview() {
    const initialQueue = studyDeck.map((flashcard) => flashcard.id);
    setReviewQueue(initialQueue);
    setRepeatQueue([]);
    setActiveFlashcardIndex(0);
    setReviewCycle(1);
    setCycleCardCount(initialQueue.length);
    setIsFlashcardFlipped(false);
    setFlashcardRoundSummary(null);
    setFlashcardSessionResults({});
    setStudyError(null);
  }

  function handleFlashcardNavigate(direction: "previous" | "next") {
    if (flashcardExitAnimation) {
      return;
    }

    if (
      direction === "next" &&
      currentReviewFlashcardId &&
      !flashcardSessionResults[currentReviewFlashcardId]
    ) {
      void handleFlashcardProgress("again");
      return;
    }

    setIsFlashcardFlipped(false);
    setStudyError(null);
    setActiveFlashcardIndex((current) => {
      if (direction === "previous") {
        return Math.max(0, current - 1);
      }

      return Math.min(reviewQueue.length - 1, current + 1);
    });
  }

  function handleQuizSelection(optionIndex: number) {
    if (!activeQuizQuestion || !currentQuizQuestionId) {
      return;
    }

    // Already answered — the reveal stands until the question is left.
    if (activeQuizSelection !== null) {
      return;
    }

    setQuizSelections((current) => ({
      ...current,
      [currentQuizQuestionId]: optionIndex,
    }));

    // A right answer needs no interruption — the design lets it read for a
    // beat, then moves on by itself. A miss waits for the feedback row.
    if (optionIndex === activeQuizQuestion.correct_option_idx) {
      window.clearTimeout(quizAdvanceTimerRef.current ?? undefined);
      quizAdvanceTimerRef.current = window.setTimeout(() => moveQuizQuestion(1), 780);
    }
  }

  function finishQuizRound() {
    const summary = quizQueue.reduce<QuizRoundSummary>(
      (current, questionId) => {
        const question = quizQuestionsById.get(questionId);

        if (!question) {
          return current;
        }

        if (quizSelections[questionId] === question.correct_option_idx) {
          current.correct += 1;
          return current;
        }

        current.missed += 1;
        current.missedQuestionIds.push(questionId);
        return current;
      },
      {
        cycle: quizRound,
        total: quizRoundCount,
        correct: 0,
        missed: 0,
        missedQuestionIds: [],
      },
    );

    setQuizRoundSummary(summary);
  }

  /*
   * "Preglej zakaj" hands the miss to chat, exactly as the design does: it
   * moves on to the next question, opens the panel (or the phone sheet) and
   * sends the question already written.
   */
  function reviewQuizAnswerInChat() {
    if (!activeQuizQuestion) {
      return;
    }

    const answer = activeQuizQuestion.options[activeQuizQuestion.correct_option_idx] ?? "";
    const prompt = `Pomagaj mi razumeti, zakaj je »${answer}« pravilen odgovor na »${activeQuizQuestion.prompt}«`;

    moveQuizQuestion(1);
    setIsChatDismissed(false);
    setIsMobileChatOpen(true);
    void submitChatQuestion(prompt);
  }

  function moveQuizQuestion(direction: -1 | 1) {
    const nextIndex = activeQuizQuestionIndex + direction;

    if (direction === 1 && nextIndex >= quizQueue.length) {
      finishQuizRound();
      return;
    }

    setActiveQuizQuestionIndex(
      Math.max(0, Math.min(nextIndex, Math.max(quizQueue.length - 1, 0))),
    );
  }

  function continueQuizReview() {
    if (!quizRoundSummary || quizRoundSummary.missedQuestionIds.length === 0) {
      return;
    }

    setQuizQueue(quizRoundSummary.missedQuestionIds);
    setQuizRound((current) => current + 1);
    setQuizRoundCount(quizRoundSummary.missedQuestionIds.length);
    setQuizRoundSummary(null);
    setActiveQuizQuestionIndex(0);
    setQuizSelections({});
    setQuizOptionOrders(buildQuizOptionOrders(quizRoundSummary.missedQuestionIds, quizQuestionsById));
    setStudyError(null);
  }

  function restartQuiz() {
    const initialQueue = quizDeckKey ? quizDeckKey.split("|") : [];
    setQuizQueue(initialQueue);
    setQuizRound(1);
    setQuizRoundCount(initialQueue.length);
    setQuizRoundSummary(null);
    setActiveQuizQuestionIndex(0);
    setQuizSelections({});
    setQuizOptionOrders(buildQuizOptionOrders(initialQueue, quizQuestionsById));
    setStudyError(null);
  }

  /**
   * `override` lets a suggestion chip send its own text: React state has not
   * settled by the time the click handler runs, so reading `question` back
   * would send the previous value.
   */
  async function submitChatQuestion(override?: string) {
    const draft = (override ?? question).trim();

    if (!draft || chatLimitReached) {
      return;
    }

    const tempUserMessage: ChatMessageWithCitations = {
      id: `temp-user-${Date.now()}`,
      lecture_id: detail.lecture.id,
      user_id: "me",
      role: "user",
      content: draft,
      citations: [],
      created_at: new Date().toISOString(),
    };

    setDetail((current) => ({
      ...current,
      chatMessages: [...current.chatMessages, tempUserMessage],
    }));
    setIsSending(true);
    setChatError(null);
    const currentQuestion = draft;
    setQuestion("");

    let response: Response;
    let payload: ChatResponse | null = null;
    try {
      response = await fetch(`/api/lectures/${detail.lecture.id}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
        }),
      });

      /*
       * A refusal — the trial limit, a lecture still processing — comes back as
       * ordinary JSON before the stream begins, so both shapes are handled: an
       * event stream is read frame by frame, anything else is parsed as before.
       */
      payload = response.headers.get("Content-Type")?.includes("text/event-stream")
        ? await readChatStream<ChatResponse>(response, setStreamingAnswer)
        : ((await response.json().catch(() => null)) as ChatResponse | null);
    } catch (error) {
      setChatError(getRequestErrorMessage(error, "Odgovora ni bilo mogoče ustvariti."));
      setDetail((current) => ({
        ...current,
        chatMessages: current.chatMessages.filter(
          (message) => message.id !== tempUserMessage.id,
        ),
      }));
      return;
    } finally {
      setIsSending(false);
      setStreamingAnswer("");
    }

    if (!response.ok) {
      if (payload?.code === "trial_chat_limit_reached") {
        setTrialChatMessagesRemaining(0);
        setChatError(null);
      } else {
        setChatError(getApiErrorMessage(payload, "Odgovora ni bilo mogoče ustvariti."));
      }

      setDetail((current) => ({
        ...current,
        chatMessages: current.chatMessages.filter(
          (message) => message.id !== tempUserMessage.id,
        ),
      }));
      return;
    }

    const chatAnswer = payload?.answer;
    if (!chatAnswer) {
      setChatError("Odgovora ni bilo mogoče ustvariti.");
      setDetail((current) => ({
        ...current,
        chatMessages: current.chatMessages.filter(
          (message) => message.id !== tempUserMessage.id,
        ),
      }));
      return;
    }

    setDetail((current) => ({
      ...current,
      chatMessages: [
        ...current.chatMessages.filter((message) => message.id !== tempUserMessage.id),
        tempUserMessage,
        chatAnswer,
      ],
    }));

    if (isTrialLecture) {
      setTrialChatMessagesRemaining((current) => Math.max(current - 1, 0));
    }
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitChatQuestion();
  }

  function handleChatKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (!question.trim() || detail.lecture.status !== "ready" || isSending || chatLimitReached) {
      return;
    }

    void submitChatQuestion();
  }

  function applySavedNoteDoc(payload: NotesDocResponse) {
    setDetail((current) => ({
      ...current,
      editableNoteDoc: payload.doc,
      editableNoteRevision: payload.revision,
      artifact: current.artifact
        ? {
            ...current.artifact,
            editable_notes_doc: payload.doc,
            editable_notes_revision: payload.revision,
            editable_notes_updated_at: payload.updatedAt ?? new Date().toISOString(),
          }
        : current.artifact,
    }));
  }

  function applyOptimisticNoteDoc(doc: EditableNoteDoc) {
    setDetail((current) => ({
      ...current,
      editableNoteDoc: doc,
      artifact: current.artifact
        ? {
            ...current.artifact,
            editable_notes_doc: doc,
            editable_notes_updated_at: doc.updatedAt,
          }
        : current.artifact,
    }));
  }

  async function persistNoteDoc(nextDoc: EditableNoteDoc) {
    setIsSavingNoteDoc(true);
    setNoteError(null);

    try {
      const saveDoc = async (doc: EditableNoteDoc, expectedRevision: number) => {
        const response = await fetch(`/api/lectures/${detail.lecture.id}/notes-doc`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expectedRevision,
            doc,
          }),
        });
        const payload = (await response.json().catch(() => null)) as NotesDocResponse | null;

        return { response, payload };
      };

      let { response, payload } = await saveDoc(nextDoc, detail.editableNoteRevision);

      if (response.status === 409 && payload?.doc && Number.isInteger(payload.revision)) {
        const rebasedDoc = mergeNoteDocs(payload.doc, nextDoc);
        applySavedNoteDoc(payload);
        ({ response, payload } = await saveDoc(rebasedDoc, payload.revision));
      }

      if (!response.ok || !payload?.doc) {
        if (response.status === 409 && payload?.doc) {
          applySavedNoteDoc(payload);
        }
        setNoteError(getApiErrorMessage(payload, "Shranjevanje ni uspelo."));
        return null;
      }

      applySavedNoteDoc(payload);
      return payload.doc;
    } catch {
      setNoteError("Shranjevanje ni uspelo.");
      return null;
    } finally {
      setIsSavingNoteDoc(false);
    }
  }

  function updateNoteTextSelection(root: HTMLElement | null = noteAnnotationShellRef.current) {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setNoteSelection(null);
      setIsHighlightPaletteOpen(false);
      return;
    }

    const range = selection.getRangeAt(0);

    if (!root || !root.contains(range.commonAncestorContainer)) {
      setNoteSelection(null);
      setIsHighlightPaletteOpen(false);
      return;
    }

    const selectedWordElements = Array.from(root.querySelectorAll<HTMLElement>(".note-read-word"))
      .filter((element) => {
        try {
          return range.intersectsNode(element);
        } catch {
          return false;
        }
      });
    const selectedWordIndexes = selectedWordElements.flatMap((element) => {
      const index = Number(element.dataset.wordIndex);
      return Number.isInteger(index) ? [index] : [];
    });

    if (selectedWordIndexes.length === 0) {
      setNoteSelection(null);
      setIsHighlightPaletteOpen(false);
      return;
    }

    const selectedBlockId = selectedWordElements[0]?.closest<HTMLElement>("[data-note-block-id]")?.dataset.noteBlockId;

    if (selectedBlockId) {
      setSelectedNoteBlockId(selectedBlockId);
      setSelectedMediaBlockId(null);
    }

    setNoteSelection({
      startWordIndex: Math.min(...selectedWordIndexes),
      endWordIndex: Math.max(...selectedWordIndexes),
    });
  }

  useEffect(() => {
    if (activeTab !== "notes") {
      return;
    }

    let animationFrame = 0;
    let timeoutId = 0;

    const scheduleSelectionUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeoutId);
      animationFrame = window.requestAnimationFrame(() => {
        updateNoteTextSelection();
        timeoutId = window.setTimeout(updateNoteTextSelection, 120);
      });
    };

    document.addEventListener("selectionchange", scheduleSelectionUpdate);
    window.addEventListener("touchend", scheduleSelectionUpdate, { passive: true });
    window.addEventListener("pointerup", scheduleSelectionUpdate, { passive: true });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeoutId);
      document.removeEventListener("selectionchange", scheduleSelectionUpdate);
      window.removeEventListener("touchend", scheduleSelectionUpdate);
      window.removeEventListener("pointerup", scheduleSelectionUpdate);
    };
  }, [activeTab]);

  function handleApplyAnnotation(kind: NoteAnnotationKind, colorId = selectedHighlightColorId) {
    if (!noteSelection) {
      return;
    }

    const matchingAnnotations = activeNoteDoc.annotations.filter(
      (annotation) =>
        annotation.kind === kind &&
        annotationRangesOverlap(
          annotation.startWordIndex,
          annotation.endWordIndex,
          noteSelection.startWordIndex,
          noteSelection.endWordIndex,
        ),
    );
    // Coverage decides removal regardless of color. Filtering to the picker's current color made
    // toggling someone-else's-color highlights (the model's yellow, most of all) REPLACE them
    // with the picker color instead of removing them — the reader selected marked text, tapped
    // highlight, and watched it change color. Selecting fully-highlighted text and tapping the
    // tool now always removes exactly the selected words, whatever color marked them.
    const shouldRemoveSelection = isSelectionFullyCoveredByAnnotations(
      matchingAnnotations,
      noteSelection,
    );
    const annotationsWithoutSelectionForKind = activeNoteDoc.annotations.flatMap((annotation) => {
      const shouldSplitAnnotation =
        annotation.kind === kind &&
        annotationRangesOverlap(
          annotation.startWordIndex,
          annotation.endWordIndex,
          noteSelection.startWordIndex,
          noteSelection.endWordIndex,
        );

      return shouldSplitAnnotation ? removeSelectionFromAnnotation(annotation, noteSelection) : [annotation];
    });
    const nextDoc: EditableNoteDoc = {
      ...activeNoteDoc,
      updatedAt: new Date().toISOString(),
      annotations: shouldRemoveSelection
        ? annotationsWithoutSelectionForKind
        : [
            ...annotationsWithoutSelectionForKind,
            {
              id: crypto.randomUUID(),
              kind,
              startWordIndex: noteSelection.startWordIndex,
              endWordIndex: noteSelection.endWordIndex,
              colorId,
              createdAt: new Date().toISOString(),
            },
          ],
    };

    applyOptimisticNoteDoc(nextDoc);
    window.getSelection()?.removeAllRanges();
    setNoteSelection(null);
    setIsHighlightPaletteOpen(false);
    void persistNoteDoc(nextDoc);
  }

  async function handleNotePhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !selectedNoteBlockId) {
      return;
    }

    const createdAt = new Date().toISOString();
    const optimisticMediaId = crypto.randomUUID();
    const optimisticBlockId = `optimistic-${crypto.randomUUID()}`;
    const localPreviewUrl = URL.createObjectURL(file);
    const optimisticMedia: LectureDetail["noteMedia"][number] = {
      id: optimisticMediaId,
      lecture_id: detail.lecture.id,
      user_id: "",
      storage_path: "",
      mime_type: file.type || "application/octet-stream",
      byte_size: file.size,
      original_file_name: file.name,
      created_at: createdAt,
      signedUrl: localPreviewUrl,
    };
    const optimisticDoc: EditableNoteDoc = {
      ...activeNoteDoc,
      updatedAt: createdAt,
      mediaBlocks: [
        ...activeNoteDoc.mediaBlocks,
        {
          id: optimisticBlockId,
          mediaId: optimisticMediaId,
          afterBlockId: selectedNoteBlockId,
          widthPercent: 100,
          xPercent: 50,
          createdAt,
        },
      ],
    };

    optimisticNoteMediaUrlsRef.current.set(optimisticMediaId, localPreviewUrl);
    setOptimisticNoteMedia((current) => [...current, optimisticMedia]);
    applyOptimisticNoteDoc(optimisticDoc);

    // The demo note has no row behind it to upload against, and the design's
    // own artboard simply splices the photo into the body — so stop at the
    // local preview rather than round-tripping to an endpoint that will 404.
    if (isCreatorDemo) {
      return;
    }

    setIsSavingNoteDoc(true);
    setNoteError(null);

    try {
      const uploadResponse = await fetch(`/api/lectures/${detail.lecture.id}/note-media/uploads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          byteSize: file.size,
        }),
      });
      const uploadPayload = await parseApiResponse<NoteMediaUploadResponse>(uploadResponse);
      const supabase = createSupabaseBrowserClient();
      const uploadResult = await supabase.storage
        .from(STORAGE_BUCKET)
        .uploadToSignedUrl(uploadPayload.path, uploadPayload.token, file, {
          contentType: uploadPayload.mimeType,
        });

      if (uploadResult.error) {
        throw new Error(uploadResult.error.message);
      }

      const finalizeResponse = await fetch(`/api/lectures/${detail.lecture.id}/note-media`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mediaId: uploadPayload.mediaId,
          storagePath: uploadPayload.path,
          mimeType: uploadPayload.mimeType,
          byteSize: file.size,
          originalFileName: file.name,
          afterBlockId: selectedNoteBlockId,
          expectedRevision: detail.editableNoteRevision,
        }),
      });
      const finalizePayload = await parseApiResponse<NoteMediaFinalizeResponse>(finalizeResponse);

      applySavedNoteDoc(finalizePayload);

      const savedMedia = finalizePayload.media;

      if (savedMedia) {
        setDetail((current) => ({
          ...current,
          noteMedia: [
            ...current.noteMedia.filter((media) => media.id !== savedMedia.id),
            savedMedia,
          ],
        }));
      }
    } catch (error) {
      setDetail((current) => {
        const currentDoc = current.editableNoteDoc;

        if (!currentDoc?.mediaBlocks.some((block) => block.id === optimisticBlockId)) {
          return current;
        }

        const nextDoc = {
          ...currentDoc,
          updatedAt: new Date().toISOString(),
          mediaBlocks: currentDoc.mediaBlocks.filter((block) => block.id !== optimisticBlockId),
        };

        return {
          ...current,
          editableNoteDoc: nextDoc,
          artifact: current.artifact
            ? {
                ...current.artifact,
                editable_notes_doc: nextDoc,
                editable_notes_updated_at: nextDoc.updatedAt,
              }
            : current.artifact,
        };
      });
      setNoteError(getRequestErrorMessage(error, "Fotografije ni bilo mogoče dodati."));
    } finally {
      setOptimisticNoteMedia((current) =>
        current.filter((media) => media.id !== optimisticMediaId),
      );
      const objectUrl = optimisticNoteMediaUrlsRef.current.get(optimisticMediaId);

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        optimisticNoteMediaUrlsRef.current.delete(optimisticMediaId);
      }
      setIsSavingNoteDoc(false);
    }
  }

  function handleMoveMediaBlock(mediaBlockId: string, direction: "up" | "down") {
    const block = activeNoteDoc.mediaBlocks.find((item) => item.id === mediaBlockId);

    if (!block || noteBlockIds.length === 0) {
      return;
    }

    const currentIndex = Math.max(0, noteBlockIds.indexOf(block.afterBlockId));
    const nextIndex =
      direction === "up"
        ? Math.max(0, currentIndex - 1)
        : Math.min(noteBlockIds.length - 1, currentIndex + 1);
    const nextBlockId = noteBlockIds[nextIndex];

    if (!nextBlockId || nextBlockId === block.afterBlockId) {
      return;
    }

    const nextDoc = {
      ...activeNoteDoc,
      updatedAt: new Date().toISOString(),
      mediaBlocks: activeNoteDoc.mediaBlocks.map((item) =>
        item.id === mediaBlockId ? { ...item, afterBlockId: nextBlockId } : item,
      ),
    };

    applyOptimisticNoteDoc(nextDoc);
    void persistNoteDoc(nextDoc);
  }

  function handleLayoutMediaBlock(
    mediaBlockId: string,
    update: { widthPercent?: number; xPercent?: number },
  ) {
    const boundedWidthPercent =
      typeof update.widthPercent === "number"
        ? Math.min(100, Math.max(35, Math.round(update.widthPercent)))
        : undefined;
    const boundedXPercent =
      typeof update.xPercent === "number"
        ? Math.min(100, Math.max(0, Math.round(update.xPercent)))
        : undefined;

    const nextDoc = {
      ...activeNoteDoc,
      updatedAt: new Date().toISOString(),
      mediaBlocks: activeNoteDoc.mediaBlocks.map((item) =>
        item.id === mediaBlockId
          ? {
              ...item,
              widthPercent: boundedWidthPercent ?? item.widthPercent,
              xPercent: boundedXPercent ?? item.xPercent,
            }
          : item,
      ),
    };

    applyOptimisticNoteDoc(nextDoc);
    void persistNoteDoc(nextDoc);
  }

  async function handleDeleteNoteMedia(mediaId: string) {
    if (deletingNoteMediaIdsRef.current.has(mediaId)) {
      return;
    }

    deletingNoteMediaIdsRef.current.add(mediaId);
    setDeletingNoteMediaIds(new Set(deletingNoteMediaIdsRef.current));
    setIsSavingNoteDoc(true);
    setNoteError(null);

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/note-media/${mediaId}`, {
        method: "DELETE",
      });
      const payload = await parseApiResponse<NotesDocResponse & { deletedMediaId?: string }>(response);
      applySavedNoteDoc(payload);
      setDetail((current) => ({
        ...current,
        noteMedia: current.noteMedia.filter((media) => media.id !== mediaId),
      }));
      setSelectedMediaBlockId(null);
    } catch (error) {
      setNoteError(getRequestErrorMessage(error, "Fotografije ni bilo mogoče izbrisati."));
    } finally {
      deletingNoteMediaIdsRef.current.delete(mediaId);
      setDeletingNoteMediaIds(new Set(deletingNoteMediaIdsRef.current));
      setIsSavingNoteDoc(false);
    }
  }

  const closeStudyManager = useCallback(() => {
    studyManagerItemDragRef.current = null;
    setStudyManagerItemDrag(null);
    setOpenStudyManagerActionItemId(null);
    setIsStudyManagerOpen(false);
  }, []);

  /*
   * This sheet keeps its own drag — it is scroll-aware and has to coexist with
   * the per-row swipe — but the exit is the design's shared one: `.closing`
   * carries it out of frame rather than the sheet jumping there in a frame.
   */
  const studyManagerSheet = useSheet(closeStudyManager, { scrollable: true });
  const dismissStudyManager = studyManagerSheet.dismiss;

  const animateCloseStudyManager = useCallback(() => {
    dismissStudyManager();
  }, [dismissStudyManager]);

  useEffect(() => {
    if (!isStudyManagerOpen) {
      return;
    }

    const shouldLockBodyScroll = window.innerWidth < 1100;
    const scrollY = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;
    if (shouldLockBodyScroll) {
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        animateCloseStudyManager();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      if (shouldLockBodyScroll) {
        document.body.style.overflow = previousOverflow;
        document.body.style.position = previousPosition;
        document.body.style.top = previousTop;
        document.body.style.width = previousWidth;
        window.scrollTo(0, scrollY);
      }
      window.removeEventListener("keydown", handleEscape);
    };
  }, [animateCloseStudyManager, isStudyManagerOpen]);

  /*
   * The sheet shortens from the bottom when the keyboard opens — `--memo-kb`
   * takes the keys' height out of its `max-height` — and it is its own
   * scroller, so a field that was in view a moment ago can end up outside the
   * new edge.
   *
   * WebKit scrolls the sheet itself to clear the keys, and it overshoots: on a
   * phone it puts the search field's top edge past the top of the sheet, half
   * of it cut off under the rounded corner. It does that *after* the resize
   * that announces the keys, so the correction has to outlast the animation —
   * hence the three passes rather than one, and `scroll-padding` on the sheet
   * so landing the field never means jamming it against an edge.
   */
  useEffect(() => {
    if (!isStudyManagerOpen) {
      return;
    }

    const sheet = studyManagerSheetRef.current;

    if (!sheet) {
      return;
    }

    let frame = 0;
    let settled = 0;

    const reveal = () => {
      const focused = document.activeElement;

      /*
       * Fields only. A button is what the keyboard is *not* about, and where a
       * tap on one already moves the sheet — the row edit buttons scroll it
       * back to the form — chasing the button instead would undo that.
       *
       * `nearest` scrolls the least that still shows the field, so a form
       * already in view is left exactly where the reader put it.
       */
      if (
        focused instanceof HTMLElement &&
        sheet.contains(focused) &&
        focused.matches("input, textarea, select")
      ) {
        focused.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };

    /*
     * Now, next frame, and once the keyboard has stopped moving. The first
     * pass is for the layout we can already see; the second is for the frame
     * `--memo-kb` lands in, since `KeyboardInset` publishes the inset from
     * this same `resize` and listener order is just mount order; the third is
     * for WebKit, which scrolls the sheet on its own account while the keys
     * animate and would otherwise get the last word.
     */
    const revealThroughTheKeyboard = () => {
      reveal();
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reveal);
      window.clearTimeout(settled);
      settled = window.setTimeout(reveal, KEYBOARD_SETTLE_MS);
    };

    sheet.addEventListener("focusin", revealThroughTheKeyboard);
    window.visualViewport?.addEventListener("resize", revealThroughTheKeyboard);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settled);
      sheet.removeEventListener("focusin", revealThroughTheKeyboard);
      window.visualViewport?.removeEventListener("resize", revealThroughTheKeyboard);
    };
  }, [isStudyManagerOpen]);

  function getStudyManagerItemOffset(itemId: string) {
    if (studyManagerItemDrag?.id === itemId) {
      return studyManagerItemDrag.offset;
    }

    return openStudyManagerActionItemId === itemId ? -STUDY_MANAGER_ACTION_REVEAL_PX : 0;
  }

  function handleStudyManagerItemPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    itemId: string,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;

    if (
      target instanceof Element &&
      target.closest("button, a, input, textarea, select")
    ) {
      return;
    }

    const nextDrag = {
      id: itemId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: openStudyManagerActionItemId === itemId ? -STUDY_MANAGER_ACTION_REVEAL_PX : 0,
      offset: openStudyManagerActionItemId === itemId ? -STUDY_MANAGER_ACTION_REVEAL_PX : 0,
      isDragging: false,
    };
    studyManagerItemDragRef.current = nextDrag;
    studyManagerItemSuppressClickRef.current = false;
  }

  function handleStudyManagerItemPointerMove(
    event: ReactPointerEvent<HTMLElement>,
    itemId: string,
  ) {
    const current = studyManagerItemDragRef.current;

    if (!current || current.id !== itemId || current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    const isHorizontalDrag =
      current.isDragging || (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY));

    if (!isHorizontalDrag) {
      return;
    }

    event.preventDefault();
    studyManagerItemSuppressClickRef.current = true;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const nextDrag = {
      ...current,
      offset: Math.min(0, Math.max(-STUDY_MANAGER_ACTION_REVEAL_PX, current.startOffset + deltaX)),
      isDragging: true,
    };
    studyManagerItemDragRef.current = nextDrag;
    setStudyManagerItemDrag(nextDrag);
  }

  function handleStudyManagerItemPointerEnd(
    event: ReactPointerEvent<HTMLElement>,
    itemId: string,
  ) {
    const current = studyManagerItemDragRef.current;

    if (!current || current.id !== itemId || current.pointerId !== event.pointerId) {
      return;
    }

    const shouldOpen = current.offset < -STUDY_MANAGER_ACTION_REVEAL_PX / 2;
    setOpenStudyManagerActionItemId(shouldOpen ? itemId : null);
    studyManagerItemDragRef.current = null;
    setStudyManagerItemDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleStudyManagerItemClick(
    event: ReactMouseEvent<HTMLElement>,
    startEdit: () => void,
  ) {
    if (studyManagerItemSuppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      studyManagerItemSuppressClickRef.current = false;
      return;
    }

    startEdit();
    requestAnimationFrame(() => {
      const sheet = document.querySelector(".study-manager-sheet");
      sheet?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function startFlashcardCreate() {
    setEditingFlashcardId(null);
    setOpenStudyManagerActionItemId(null);
    setFlashcardForm(createEmptyFlashcardForm());
  }

  function startFlashcardEdit(flashcard: LectureDetail["flashcards"][number]) {
    setEditingFlashcardId(flashcard.id);
    setOpenStudyManagerActionItemId(null);
    setFlashcardForm({
      front: flashcard.front,
      back: flashcard.back,
      hint: flashcard.hint ?? "",
      difficulty: flashcard.difficulty,
    });
  }

  function startQuizQuestionCreate() {
    setEditingQuizQuestionId(null);
    setOpenStudyManagerActionItemId(null);
    setQuizQuestionForm(createEmptyQuizQuestionForm());
  }

  function startQuizQuestionEdit(question: LectureDetail["quizQuestions"][number]) {
    setEditingQuizQuestionId(question.id);
    setOpenStudyManagerActionItemId(null);
    setQuizQuestionForm({
      prompt: question.prompt,
      options: [
        question.options[0] ?? "",
        question.options[1] ?? "",
        question.options[2] ?? "",
        question.options[3] ?? "",
      ],
      correctOptionIndex: question.correct_option_idx,
      explanation: question.explanation,
      difficulty: question.difficulty,
    });
  }

  async function handleFlashcardFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setStudyError(null);
    setIsSavingStudyItem(true);

    try {
      const response = await fetch(
        editingFlashcardId
          ? `/api/flashcards/${editingFlashcardId}`
          : `/api/lectures/${detail.lecture.id}/flashcards`,
        {
          method: editingFlashcardId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            front: flashcardForm.front,
            back: flashcardForm.back,
            hint: null,
            difficulty: flashcardForm.difficulty,
          }),
        },
      );
      const payload = await parseApiResponse<FlashcardMutationResponse>(response);
      const savedFlashcard = payload.flashcard;

      setDetail((current) => {
        const existing = current.flashcards.find((flashcard) => flashcard.id === savedFlashcard.id);
        const merged = {
          ...savedFlashcard,
          citations: existing?.citations ?? savedFlashcard.citations ?? [],
          progress: existing?.progress ?? savedFlashcard.progress ?? null,
        };
        const nextFlashcards = existing
          ? current.flashcards.map((flashcard) =>
              flashcard.id === savedFlashcard.id ? merged : flashcard,
            )
          : [...current.flashcards, merged];

        return {
          ...current,
          flashcards: nextFlashcards.sort((first, second) => first.idx - second.idx),
        };
      });

      if (!editingFlashcardId) {
        setReviewQueue((current) =>
          current.includes(savedFlashcard.id) ? current : [...current, savedFlashcard.id],
        );
        setCycleCardCount((current) => current + 1);
      }

      startFlashcardCreate();
    } catch (error) {
      setStudyError(getRequestErrorMessage(error, "Kartice ni bilo mogoče shraniti."));
    } finally {
      setIsSavingStudyItem(false);
    }
  }

  async function handleDeleteFlashcard(flashcardId: string) {
    if (deletingStudyItemIdsRef.current.has(flashcardId)) {
      return;
    }

    deletingStudyItemIdsRef.current.add(flashcardId);
    setDeletingStudyItemIds(new Set(deletingStudyItemIdsRef.current));
    setOpenStudyManagerActionItemId(flashcardId);
    setStudyError(null);

    try {
      const response = await fetch(`/api/flashcards/${flashcardId}`, {
        method: "DELETE",
      });
      await parseApiResponse<{ deletedFlashcardId: string }>(response);
      setDetail((current) => ({
        ...current,
        flashcards: current.flashcards.filter((flashcard) => flashcard.id !== flashcardId),
      }));
      setReviewQueue((current) => current.filter((id) => id !== flashcardId));
      setRepeatQueue((current) => current.filter((id) => id !== flashcardId));
      setFlashcardSessionResults((current) => {
        const next = { ...current };
        delete next[flashcardId];
        return next;
      });
      setActiveFlashcardIndex((current) => Math.max(0, current - 1));
    } catch (error) {
      setStudyError(getRequestErrorMessage(error, "Kartice ni bilo mogoče izbrisati."));
    } finally {
      deletingStudyItemIdsRef.current.delete(flashcardId);
      setDeletingStudyItemIds(new Set(deletingStudyItemIdsRef.current));
    }
  }

  async function handleQuizQuestionFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setStudyError(null);
    setIsSavingStudyItem(true);

    try {
      const response = await fetch(
        editingQuizQuestionId
          ? `/api/lectures/${detail.lecture.id}/quiz/questions/${editingQuizQuestionId}`
          : `/api/lectures/${detail.lecture.id}/quiz/questions`,
        {
          method: editingQuizQuestionId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(quizQuestionForm),
        },
      );
      const payload = await parseApiResponse<QuizQuestionMutationResponse>(response);
      const savedQuestion = payload.question;

      setDetail((current) => {
        const existing = current.quizQuestions.find((question) => question.id === savedQuestion.id);
        const nextQuestions = existing
          ? current.quizQuestions.map((question) =>
              question.id === savedQuestion.id ? savedQuestion : question,
            )
          : [...current.quizQuestions, savedQuestion];

        return {
          ...current,
          quizQuestions: nextQuestions.sort((first, second) => first.idx - second.idx),
        };
      });

      if (!editingQuizQuestionId) {
        setQuizQueue((current) =>
          current.includes(savedQuestion.id) ? current : [...current, savedQuestion.id],
        );
        setQuizRoundCount((current) => current + 1);
        setQuizOptionOrders((current) => {
          const next = new Map(current);
          next.set(savedQuestion.id, shuffleIndices(savedQuestion.options.length));
          return next;
        });
      } else {
        setQuizSelections((current) => {
          const next = { ...current };
          delete next[savedQuestion.id];
          return next;
        });
        setQuizOptionOrders((current) => {
          const next = new Map(current);
          next.set(savedQuestion.id, shuffleIndices(savedQuestion.options.length));
          return next;
        });
      }

      startQuizQuestionCreate();
    } catch (error) {
      setStudyError(getRequestErrorMessage(error, "Vprašanja ni bilo mogoče shraniti."));
    } finally {
      setIsSavingStudyItem(false);
    }
  }

  async function handleDeleteQuizQuestion(questionId: string) {
    if (deletingStudyItemIdsRef.current.has(questionId)) {
      return;
    }

    deletingStudyItemIdsRef.current.add(questionId);
    setDeletingStudyItemIds(new Set(deletingStudyItemIdsRef.current));
    setOpenStudyManagerActionItemId(questionId);
    setStudyError(null);

    try {
      const response = await fetch(`/api/lectures/${detail.lecture.id}/quiz/questions/${questionId}`, {
        method: "DELETE",
      });
      await parseApiResponse<{ deletedQuestionId: string }>(response);
      setDetail((current) => ({
        ...current,
        quizQuestions: current.quizQuestions.filter((question) => question.id !== questionId),
      }));
      setQuizQueue((current) => current.filter((id) => id !== questionId));
      setQuizSelections((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      setQuizOptionOrders((current) => {
        const next = new Map(current);
        next.delete(questionId);
        return next;
      });
      setActiveQuizQuestionIndex((current) => Math.max(0, current - 1));
    } catch (error) {
      setStudyError(getRequestErrorMessage(error, "Vprašanja ni bilo mogoče izbrisati."));
    } finally {
      deletingStudyItemIdsRef.current.delete(questionId);
      setDeletingStudyItemIds(new Set(deletingStudyItemIdsRef.current));
    }
  }

  /**
   * The conversation itself. The redesign shows it in a side panel on desktop
   * and a sheet on the phone, so the body is shared and only the frame differs.
   */
  /**
   * The conversation itself. The redesign shows it in a side panel on desktop
   * and a sheet on the phone, so the body is shared and only the frame differs.
   */
  function renderChatBody() {
    const composerDisabled =
      detail.lecture.status !== "ready" || isSending || chatLimitReached;
    // Nothing to send yet, and a microphone to offer instead.
    const showChatMic = dictation.supported && !question.trim() && !isSending;

    return (
      <>
        <div ref={setChatLogNode} className="memo-chat-log memo-scroll">
          <div className="memo-chat-intro">
            <span className="memo-avatar">
              <Image src="/memo-mascot.png" alt="" width={320} height={288} />
            </span>
            <p>
              Živjo, jaz sem Memo AI. Vprašaj me karkoli o tem predavanju — povzetek, razlago
              pojma ali primer za izpit.
              {showsTranscript ? " Kot kontekst uporabim zapiske in prepis." : ""}
            </p>
          </div>

          {detail.chatMessages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))}

          {/* While the answer streams it renders in a real bubble, so the text
              lands where the saved message will sit rather than jumping. The
              placeholder only shows before the first token arrives. */}
          {streamingAnswer ? (
            <div className="memo-bubble-bot streaming">
              <p className="memo-bubble-copy">
                {streamingAnswer}
                <span className="memo-caret" aria-hidden="true" />
              </p>
            </div>
          ) : isSending ? (
            <TypingDots />
          ) : null}
        </div>

        <div className="memo-chat-foot">
          {detail.chatMessages.length === 0 && !composerDisabled ? (
            <div className="memo-chip-row memo-chiprow">
              {CHAT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="memo-chip"
                  onClick={() => void submitChatQuestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={handleChatSubmit} className="memo-chat-input">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleChatKeyDown}
              disabled={composerDisabled}
              placeholder="Napiši svoje vprašanje"
              aria-label="Napiši svoje vprašanje"
            />
            {/*
              * One control, two jobs: an empty field offers the microphone, and
              * the moment there is something to send it becomes Send. Two
              * buttons side by side would mean the common one — Send — is never
              * where the thumb already is.
              */}
            {showChatMic ? (
              <button
                type="button"
                disabled={composerDisabled || dictation.transcribing}
                className={`memo-chat-send mic ${dictation.listening ? "listening" : ""} ${
                  dictation.transcribing ? "transcribing" : ""
                }`.trim()}
                onClick={dictation.toggle}
                aria-pressed={dictation.listening}
                aria-label={
                  dictation.transcribing
                    ? "Prepisujem povedano"
                    : dictation.listening
                      ? "Ustavi narekovanje"
                      : "Narekuj vprašanje"
                }
              >
                {dictation.transcribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Msym name={dictation.listening ? "stop" : "mic"} size="1.35rem" />
                )}
              </button>
            ) : (
              <button
                type="submit"
                disabled={composerDisabled}
                className={`memo-chat-send ${question.trim() ? "ready" : ""}`.trim()}
                aria-label="Pošlji sporočilo"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Msym name="arrow_upward" size="1.35rem" />
                )}
              </button>
            )}
          </form>

          {dictation.error ? (
            <p className="memo-chat-status danger">{dictation.error}</p>
          ) : dictation.transcribing ? (
            <p className="memo-chat-status">Prepisujem povedano…</p>
          ) : chatError ? (
            <p className="memo-chat-status danger">{chatError}</p>
          ) : detail.lecture.status !== "ready" ? (
            <p className="memo-chat-status">Na voljo bo po koncu obdelave.</p>
          ) : chatLimitReached ? (
            <div className="memo-chat-limit">
              <p className="memo-chat-status">
                Porabil si brezplačna sporočila za ta zapisek.
              </p>
              <button
                type="button"
                className="memo-button-outline small"
                onClick={() => navigateWithFeedback(startHref)}
              >
                Nadgradi
              </button>
            </div>
          ) : null}
        </div>
      </>
    );
  }

  function renderPanel() {
    if (activeTab === "notes") {
      // The dock's annotate layer: brush, underline, colour, photo, and the
      // swatch row the colour button slides open.
      // One photo control, shown in the dock both while text is selected and
      // while a block is — the dock is where the design keeps note actions, and
      // it used to be reachable only through a text selection or a button
      // stranded in a row below the note.
      const photoDockButton = (
        <button
          type="button"
          className="memo-annotate-icon"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => notePhotoInputRef.current?.click()}
          disabled={isSavingNoteDoc || !selectedNoteBlockId}
          aria-label="Dodaj fotografijo"
          title="Dodaj fotografijo"
        >
          <Msym name="add_photo_alternate" size="1.25rem" fill={false} weight={500} />
        </button>
      );

      const annotationToolbar = noteSelection ? (
        <>
          <button
            type="button"
            className="memo-annotate-primary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void handleApplyAnnotation("highlight")}
            disabled={isSavingNoteDoc}
            aria-label="Označi"
            title="Označi"
            style={
              {
                "--marker-cur": activeHighlightColor.value,
                "--marker-cur-text": activeHighlightColor.contrast,
              } as CSSProperties
            }
          >
            <Msym name="ink_highlighter" size="1.25rem" fill={false} weight={500} />
            <span className="memo-annotate-label">Označi</span>
          </button>
          <button
            type="button"
            className="memo-annotate-icon"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void handleApplyAnnotation("underline")}
            disabled={isSavingNoteDoc}
            aria-label="Podčrtaj"
            title="Podčrtaj"
          >
            <span
              className="memo-annotate-underline"
              style={{ "--marker-cur": activeHighlightColor.value } as CSSProperties}
            >
              U
            </span>
          </button>
          <button
            type="button"
            className={`memo-palette-trigger ${isHighlightPaletteOpen ? "open" : ""}`.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setIsHighlightPaletteOpen((current) => !current)}
            disabled={isSavingNoteDoc}
            aria-label="Barva"
            title="Barva"
          >
            <Msym name="palette" size="1.25rem" fill={false} weight={500} />
          </button>
          {photoDockButton}
          <div
            className={`memo-swatches ${isHighlightPaletteOpen ? "open" : ""}`.trim()}
            aria-label="Barva označevanja"
          >
            {NOTE_HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`memo-swatch ${
                  selectedHighlightColorId === color.id ? "selected" : ""
                }`.trim()}
                style={{ background: color.value }}
                onPointerDown={(event) => event.preventDefault()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setSelectedHighlightColorId(color.id)}
                aria-label={color.label}
                title={color.label}
              />
            ))}
          </div>
        </>
      ) : null;
      /*
       * The dock is the listen control until words are selected, and the
       * annotation row for exactly as long as they are. A block selected on its
       * own used to put the photo button there alone, which read as a third
       * kind of dock; the photo control lives on the annotation row instead.
       */
      const dockToolbar = noteSelection ? annotationToolbar : null;
      /*
       * Only a failure earns a line above the note. Saving used to announce
       * itself here, which pushed the whole note down the moment a highlight
       * or a photo landed and pulled it back up when the save finished — the
       * note jumped under the reader's finger for something that needs no
       * acknowledgement. It saves quietly instead.
       */
      const noteStatus = noteError ? (
        <span className="note-toolbar-status error">{noteError}</span>
      ) : null;

      return (
        <div className="memo-notes-panel">
          {cleanedStructuredNotes && detail.lecture.status === "ready" && !noteEnrichmentPending ? (
            <div className="memo-note-body">
              <div
                ref={noteAnnotationShellRef}
                className="markdown lecture-markdown note-annotation-shell"
                onMouseUp={(event) => updateNoteTextSelection(event.currentTarget)}
                onKeyUp={(event) => updateNoteTextSelection(event.currentTarget)}
              >
                <input
                  ref={notePhotoInputRef}
                  type="file"
                  accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => void handleNotePhotoSelected(event)}
                />
                <NoteReadAloud
                  lectureId={detail.lecture.id}
                  content={cleanedStructuredNotes}
                  autoPrepareFirstChunk={shouldCreateInitialNoteAudio(
                    detail.lecture.processing_metadata,
                  )}
                  annotationToolbar={dockToolbar}
                  toolbarAccessory={noteStatus}
                  annotationActive={Boolean(noteSelection)}
                  annotationPaletteOpen={isHighlightPaletteOpen}
                  dockContainer={dockSlot}
                  annotations={activeNoteDoc.annotations}
                  mediaBlocks={activeNoteDoc.mediaBlocks}
                  noteMedia={renderedNoteMedia}
                  selectedBlockId={selectedNoteBlockId}
                  selectedMediaBlockId={selectedMediaBlockId}
                  deletingMediaIds={deletingNoteMediaIds}
                  onBlockSelect={(blockId) => {
                    setSelectedNoteBlockId(blockId);
                    setSelectedMediaBlockId(null);
                  }}
                  onMediaBlockSelect={(blockId) => {
                    setSelectedMediaBlockId(blockId);
                    setSelectedNoteBlockId(null);
                  }}
                  onMoveMediaBlock={handleMoveMediaBlock}
                  onLayoutMediaBlock={handleLayoutMediaBlock}
                  onDeleteMedia={(mediaId) => void handleDeleteNoteMedia(mediaId)}
                />
              </div>
            </div>
          ) : shouldPollLecture(detail.lecture.status) ||
            noteEnrichmentPending ||
            notesArtifactLoadFailed ? (
            /* The wrapper the finished note uses, so the caption and the ghost
               paragraphs sit exactly where the note's own text will. */
            <div className="memo-note-body">
              <StudyGenerationNotice
                preview="notes"
                stageCopy={notesArtifactLoadFailed ? "Nalaganje zapiskov" : lectureProcessingStageCopy}
                bodyCopy={
                  notesArtifactLoadFailed
                    ? "Zapiski so pripravljeni, vendar se niso naložili v tem poskusu. Poskušamo znova."
                    : "Obdelava teče v ozadju. Lahko zapreš ta pogled in se vrneš čez nekaj minut."
                }
              />
            </div>
          ) : (
            <p className="ios-info lecture-empty-message">Zapiski še niso pripravljeni.</p>
          )}
        </div>
      );
    }

    if (activeTab === "study") {
      const currentFlashcard = studyDeck.find((flashcard) => flashcard.id === currentReviewFlashcardId) ?? null;
      const currentFlashcardAnswer =
        currentFlashcard ? flashcardSessionResults[currentFlashcard.id]?.latestConfidence ?? null : null;
      const currentFlashcardAnswerLabel =
        currentFlashcardAnswer == null
          ? null
          : currentFlashcardAnswer === "again"
            ? "Nisem vedel"
            : "Vedel sem";
      const currentFlashcardAnswerClass =
        currentFlashcardAnswer == null
          ? "unanswered"
          : currentFlashcardAnswer === "again"
            ? "again"
            : "easy";
      const flashcardKnownCount = reviewQueue.reduce((total, flashcardId) => {
        const answer = flashcardSessionResults[flashcardId]?.latestConfidence;
        return answer && answer !== "again" ? total + 1 : total;
      }, 0);
      const flashcardMissedCount = reviewQueue.reduce((total, flashcardId) => {
        return flashcardSessionResults[flashcardId]?.latestConfidence === "again" ? total + 1 : total;
      }, 0);
      const visibleFlashcardRepeatQueue =
        repeatQueue.length > 0
          ? repeatQueue
          : reviewQueue.filter(
              (flashcardId) => flashcardSessionResults[flashcardId]?.latestConfidence === "again",
            );
      const derivedFlashcardRoundSummary =
        !flashcardRoundSummary &&
        reviewQueue.length > 0 &&
        reviewQueue.every((flashcardId) => flashcardSessionResults[flashcardId]?.latestConfidence)
          ? {
              cycle: reviewCycle,
              total: cycleCardCount || reviewQueue.length,
              known: flashcardKnownCount,
              missed: flashcardMissedCount,
            }
          : null;
      const visibleFlashcardRoundSummary = flashcardRoundSummary ?? derivedFlashcardRoundSummary;
      const visibleFlashcardRoundPercent =
        visibleFlashcardRoundSummary && visibleFlashcardRoundSummary.total > 0
          ? Math.round((visibleFlashcardRoundSummary.known / visibleFlashcardRoundSummary.total) * 100)
          : 0;
      const canNavigateFlashcard =
        !!currentFlashcard &&
        !flashcardExitAnimation &&
        !visibleFlashcardRoundSummary;
      const canNavigatePreviousFlashcard = canNavigateFlashcard && activeFlashcardIndex > 0;
      const canNavigateNextFlashcard =
        canNavigateFlashcard && activeFlashcardIndex < reviewQueue.length - 1;
      const flashcardDragThreshold = getFlashcardDragThreshold(flashcardDrag.width);
      const flashcardDragProgress =
        flashcardDragThreshold > 0
          ? Math.min(1, Math.abs(flashcardDrag.deltaX) / flashcardDragThreshold)
          : 0;
      const flashcardDragDirection =
        Math.abs(flashcardDrag.deltaX) > 4
          ? flashcardDrag.deltaX < 0
            ? "again"
            : "easy"
          : null;
      const flashcardDragStyle = {
        "--lecture-flashcard-drag-x": `${flashcardDrag.deltaX}px`,
        "--lecture-flashcard-drag-y": `${flashcardDrag.deltaY}px`,
        "--lecture-flashcard-drag-rotation": `${getFlashcardDragRotation(
          flashcardDrag.deltaX,
          flashcardDrag.width,
        )}deg`,
        "--lecture-flashcard-drag-progress": flashcardDragProgress,
      } as CSSProperties;
      const shouldAutoSizeStudyShell =
        activeStudyView === "flashcards" ||
        activeStudyView === "quiz" ||
        activeStudyView === "practice_test";
      const activeMaterialError =
        activeStudyView === "flashcards"
          ? detail.studyAsset?.error_message
          : activeStudyView === "quiz"
            ? detail.quizAsset?.error_message
            : detail.practiceTestAsset?.error_message;
      const normalizedStudySearch = studyManagerSearch.trim().toLowerCase();
      const managedFlashcards = studyDeck.filter((flashcard) => {
        if (!normalizedStudySearch) {
          return true;
        }

        return `${flashcard.front} ${flashcard.back} ${flashcard.hint ?? ""}`
          .toLowerCase()
          .includes(normalizedStudySearch);
      });
      const managedQuizQuestions = detail.quizQuestions.filter((question) => {
        if (!normalizedStudySearch) {
          return true;
        }

        return `${question.prompt} ${question.options.join(" ")} ${question.explanation}`
          .toLowerCase()
          .includes(normalizedStudySearch);
      });
      const canManageActiveStudyView =
        (activeStudyView === "flashcards" && detail.flashcards.length > 0) ||
        (activeStudyView === "quiz" && detail.quizQuestions.length > 0);
      const openStudyManager = () => {
        window.dispatchEvent(new Event("memoai:mobile-dock-close"));
        studyManagerItemDragRef.current = null;
        setStudyManagerItemDrag(null);
        setOpenStudyManagerActionItemId(null);
        setIsStudyManagerOpen(true);
        setStudyManagerSearch("");
        if (activeStudyView === "flashcards") {
          startFlashcardCreate();
        } else if (activeStudyView === "quiz") {
          startQuizQuestionCreate();
        }
      };

      return (
        <>
          <div className="workspace-panel-stack lecture-panel-stack">
            <div
              className={`ios-card lecture-study-shell ${shouldAutoSizeStudyShell ? "auto-height" : ""}`}
            >
              <div className="lecture-study-header">
                {/* The design carries no readiness chip here — the material
                    being on screen is the signal. */}
                <div className="lecture-study-title" />
                <div className="lecture-study-header-actions">
                  {canManageActiveStudyView ? (
                    <button
                      type="button"
                      className="lecture-study-manage-button"
                      onClick={openStudyManager}
                    >
                      <Msym name="edit_square" size="1.2rem" fill={false} weight={500} />
                      <span>Uredi</span>
                    </button>
                  ) : null}
                  {activeStudyView === "practice_test" ? (
                    <span className="lecture-study-status demo">Demo</span>
                  ) : null}
                </div>
              </div>

              <div className="ios-segmented lecture-study-mode-switch">
                {([
                  { id: "flashcards", label: "Flashcards" },
                  { id: "quiz", label: "Kviz" },
                  { id: "practice_test", label: "Test" },
                ] as const).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveStudyView(item.id)}
                    className={`ios-segment ${activeStudyView === item.id ? "active" : ""}`}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

            {studyError ? <p className="danger-panel lecture-inline-note">{studyError}</p> : null}
            {activeMaterialError ? (
              <p className="danger-panel lecture-inline-note">{activeMaterialError}</p>
            ) : null}

            {activeStudyView === "flashcards" ? (
              totalFlashcards === 0 ? (
                isStudyGenerating ? (
                  <StudyGenerationNotice preview="cards" stageCopy={studyStageCopy} />
                ) : (
                  <div className="memo-study-empty">
                    <div className="memo-study-empty-orb">
                      <Emoji symbol="🗂️" size="4.4rem" />
                    </div>
                    <p className="memo-study-empty-title">
                      {detail.lecture.status !== "ready"
                        ? "Učna orodja se odklenejo, ko je obdelava zapiska končana."
                        : detail.studyAsset?.status === "failed"
                          ? "Ustvarjanje kartic ni uspelo."
                          : "Ustvari kartice, ko si pripravljen."}
                    </p>
                    <p className="memo-study-empty-copy">
                      {detail.lecture.status !== "ready"
                        ? "Najprej nastanejo zapiski. Nato lahko kartice ustvariš ročno."
                        : "Ustvari učni komplet v istem jeziku in iz iste vsebine kot tvoji zapiski."}
                    </p>
                    {detail.lecture.status === "ready" ? (
                      <button
                        type="button"
                        onClick={() => void handleStudyCreate()}
                        disabled={isRegeneratingStudy}
                        className="memo-study-empty-cta"
                      >
                        {isRegeneratingStudy ? (
                          <Msym name="progress_activity" className="memo-spin" size="1.2rem" />
                        ) : (
                          <Msym name="style" size="1.2rem" fill={false} weight={500} />
                        )}
                        Ustvari kartice
                      </button>
                    ) : null}
                  </div>
                )
            ) : visibleFlashcardRoundSummary ? (
                <StudyCompletionCard
                  eyebrow={
                    visibleFlashcardRoundSummary.missed === 0
                      ? "Zaključeno"
                      : `Krog ${visibleFlashcardRoundSummary.cycle} zaključen`
                  }
                  title={
                    visibleFlashcardRoundSummary.missed === 0
                      ? "Vse kartice so predelane"
                      : "Ponovi kartice, ki si jih zgrešil"
                  }
                  percentage={visibleFlashcardRoundSummary.missed === 0 ? 100 : visibleFlashcardRoundPercent}
                  percentageLabel={visibleFlashcardRoundSummary.missed === 0 ? "Komplet opravljen" : "Rezultat kroga"}
                  primaryMetric={{
                    label: "Pravilno v tem krogu",
                    value: `${visibleFlashcardRoundSummary.known}/${visibleFlashcardRoundSummary.total}`,
                  }}
                  actions={
                    visibleFlashcardRoundSummary.missed === 0 ? (
                      <button
                        type="button"
                        onClick={restartFlashcardReview}
                        className="lecture-study-refresh lecture-study-restart"
                        aria-label="Začni znova"
                        title="Začni znova"
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        Začni komplet znova
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => continueFlashcardReview(visibleFlashcardRepeatQueue)}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        Ponovi {visibleFlashcardRoundSummary.missed}{" "}
                        {visibleFlashcardRoundSummary.missed === 1 ? "zgrešeno kartico" : "zgrešene kartice"}
                      </button>
                    )
                  }
                />
            ) : currentFlashcard ? (
                <>
                  {/* The redesign heads the deck with its position and a thick
                      progress bar. */}
                  <div className="memo-study-head">
                    <span className="memo-study-head-title">
                      Kartica {activeFlashcardIndex + 1}
                    </span>
                    <span className="memo-study-head-count">
                      {Math.max(0, reviewQueue.length - activeFlashcardIndex - 1)} ostalo
                    </span>
                  </div>
                  <div className="memo-progress cards">
                    <div
                      style={{
                        width: `${
                          reviewQueue.length > 0
                            ? Math.round((activeFlashcardIndex / reviewQueue.length) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  <div className="lecture-flashcard-stage">
                    <div className="lecture-flashcard-stage-card">
                      <button
                        type="button"
                        className={`lecture-flashcard ${isFlashcardFlipped ? "flipped" : ""} ${
                          flashcardDrag.isDragging ? "dragging" : ""
                        } ${flashcardDragDirection ? `drag-${flashcardDragDirection}` : ""}`}
                        style={flashcardDragStyle}
                        onClick={handleFlashcardClick}
                        onPointerDown={handleFlashcardPointerDown}
                        onPointerMove={handleFlashcardPointerMove}
                        onPointerUp={handleFlashcardPointerEnd}
                        onPointerCancel={resetFlashcardDrag}
                      >
                        <div className="lecture-flashcard-rotator">
                          <div className="lecture-flashcard-face lecture-flashcard-face-front">
                            <div className="lecture-flashcard-face-header">
                              {currentFlashcardAnswerLabel ? (
                                <span className={`lecture-flashcard-answer-label ${currentFlashcardAnswerClass}`}>
                                  {currentFlashcardAnswerLabel}
                                </span>
                              ) : null}
                            </div>
                            <p className="lecture-flashcard-content">{currentFlashcard.front}</p>
                            <span className="lecture-flashcard-side-label">{flipHint}</span>
                          </div>
                          <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                            <div className="lecture-flashcard-face-header">
                              {currentFlashcardAnswerLabel ? (
                                <span className={`lecture-flashcard-answer-label ${currentFlashcardAnswerClass}`}>
                                  {currentFlashcardAnswerLabel}
                                </span>
                              ) : null}
                            </div>
                            <p className="lecture-flashcard-content">{currentFlashcard.back}</p>
                            <span className="lecture-flashcard-side-label">{flipHint}</span>
                          </div>
                        </div>
                        <div className="lecture-flashcard-drag-overlay" aria-hidden="true">
                          <EmojiIcon
                            symbol={flashcardDragDirection === "again" ? "❌" : "✅"}
                            size="2.25rem"
                          />
                        </div>
                      </button>
                      {flashcardExitAnimation ? (
                        <div
                          key={flashcardExitAnimation.token}
                          className={`lecture-flashcard-exit-card ${flashcardExitAnimation.bucket} ${
                            flashcardExitAnimation.flipped ? "flipped" : ""
                          }`}
                          style={
                            {
                              "--lecture-flashcard-exit-start-x": `${flashcardExitAnimation.startXPercent}%`,
                              "--lecture-flashcard-exit-start-y": `${flashcardExitAnimation.startYPercent}%`,
                              "--lecture-flashcard-exit-start-rotation": `${flashcardExitAnimation.startRotationDeg}deg`,
                            } as CSSProperties
                          }
                          aria-hidden="true"
                        >
                          <div className="lecture-flashcard-rotator">
                            <div className="lecture-flashcard-face lecture-flashcard-face-front">
                              <div className="lecture-flashcard-exit-blank" />
                            </div>
                            <div className="lecture-flashcard-face lecture-flashcard-face-answer">
                              <div className="lecture-flashcard-exit-blank" />
                            </div>
                          </div>
                          <div className="lecture-flashcard-exit-overlay">
                            {flashcardExitAnimation.bucket === "again" ? (
                              <EmojiIcon symbol="❌" size="2.25rem" />
                            ) : (
                              <EmojiIcon symbol="✅" size="2.25rem" />
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="lecture-flashcard-toolbar">
                    <div className="lecture-flashcard-review">
                      <button
                        type="button"
                        onClick={() => handleFlashcardNavigate("previous")}
                        disabled={!canNavigatePreviousFlashcard}
                        className="lecture-flashcard-nav-button previous"
                        aria-label="Prejšnja kartica"
                        title="Prejšnja kartica"
                      >
                        <ArrowLeft aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleFlashcardProgress("again")}
                        className={`lecture-flashcard-review-button again ${
                          currentFlashcardAnswer === "again" ? "selected" : ""
                        }`}
                        aria-label={confidenceLabel("again")}
                        title={confidenceLabel("again")}
                      >
                        <X aria-hidden="true" />
                        <span>{flashcardMissedCount}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleFlashcardProgress("easy")}
                        className={`lecture-flashcard-review-button easy ${
                          currentFlashcardAnswer && currentFlashcardAnswer !== "again" ? "selected" : ""
                        }`}
                        aria-label={confidenceLabel("easy")}
                        title={confidenceLabel("easy")}
                      >
                        <span>{flashcardKnownCount}</span>
                        <Check aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFlashcardNavigate("next")}
                        disabled={!canNavigateNextFlashcard}
                        className="lecture-flashcard-nav-button next"
                        aria-label="Naslednja kartica"
                        title="Naslednja kartica"
                      >
                        <ArrowRight aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <StudyCompletionCard
                  eyebrow="Zaključeno"
                  title="Učenje s karticami je končano"
                  percentage={flashcardConfidencePercent}
                  percentageLabel="Rezultat"
                  primaryMetric={{
                    label: "Pravilni odgovori",
                    value: `${flashcardFirstPassKnownCount}/${totalFlashcards}`,
                  }}
                  actions={
                    <button
                      type="button"
                      onClick={restartFlashcardReview}
                      className="lecture-study-refresh lecture-study-restart"
                      aria-label="Začni znova"
                      title="Začni znova"
                    >
                      <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                      Začni komplet znova
                    </button>
                  }
                />
              )
            ) : activeStudyView === "quiz" ? (
              totalQuizQuestions === 0 ? (
                isQuizGenerating ? (
                  <StudyGenerationNotice preview="quiz" stageCopy={quizStageCopy} />
                ) : (
                  <div className="memo-study-empty">
                    <div className="memo-study-empty-orb">
                      <Emoji symbol="❓" size="4.4rem" />
                    </div>
                    <p className="memo-study-empty-title">
                      {detail.lecture.status !== "ready"
                        ? "Učna orodja se odklenejo, ko je obdelava zapiska končana."
                        : detail.quizAsset?.status === "failed"
                          ? "Ustvarjanje kviza ni uspelo."
                          : "Ustvari kviz, ko si pripravljen."}
                    </p>
                    <p className="memo-study-empty-copy">
                      {detail.lecture.status !== "ready"
                        ? "Najprej nastanejo zapiski. Nato lahko kvize ustvariš ročno."
                        : "Ustvari vprašanja z več izbirami v istem jeziku kot tvoji zapiski."}
                    </p>
                    {detail.lecture.status === "ready" ? (
                      <button
                        type="button"
                        onClick={() => void handleQuizCreate()}
                        disabled={isRegeneratingQuiz}
                        className="memo-study-empty-cta"
                      >
                        {isRegeneratingQuiz ? (
                          <Msym name="progress_activity" className="memo-spin" size="1.2rem" />
                        ) : (
                          <Msym name="quiz" size="1.2rem" fill={false} weight={500} />
                        )}
                        Ustvari kviz
                      </button>
                    ) : null}
                  </div>
                )
              ) : quizRoundSummary ? (
                <StudyCompletionCard
                  eyebrow={
                    quizRoundSummary.missed === 0
                      ? "Zaključeno"
                      : `Krog ${quizRoundSummary.cycle} zaključen`
                  }
                  title={
                    quizRoundSummary.missed === 0
                      ? "Vsa vprašanja so predelana"
                      : "Ponovi vprašanja, ki si jih zgrešil"
                  }
                  percentage={quizRoundSummary.missed === 0 ? 100 : quizRoundPercent}
                  percentageLabel={quizRoundSummary.missed === 0 ? "Komplet opravljen" : "Rezultat kroga"}
                  primaryMetric={{
                    label: quizRoundSummary.missed === 0 ? "Predelana vprašanja" : "Pravilno v tem krogu",
                    value:
                      quizRoundSummary.missed === 0
                        ? `${totalQuizQuestions}/${totalQuizQuestions}`
                        : `${quizRoundSummary.correct}/${quizRoundSummary.total}`,
                  }}
                  actions={
                    quizRoundSummary.missed === 0 ? (
                      <button
                        type="button"
                        onClick={restartQuiz}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        Začni kviz znova
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={continueQuizReview}
                        className="lecture-study-refresh lecture-study-restart"
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        Ponovi {quizRoundSummary.missed}{" "}
                        {quizRoundSummary.missed === 1 ? "zgrešeno vprašanje" : "zgrešena vprašanja"}
                      </button>
                    )
                  }
                />
              ) : activeQuizQuestion ? (
                <div className="lecture-quiz-stage">
                  {/* The redesign heads the quiz with its position and a
                      progress bar rather than a bare counter. */}
                  {/* Desktop writes the position as one line, "Vprašanje 1 od
                      8". The phone splits it the way it splits the flashcard
                      header: the label bold on the left, the count muted on
                      the right. */}
                  <div className="memo-quiz-head">
                    <span className="memo-quiz-count">
                      Vprašanje {activeQuizQuestionIndex + 1}
                      <span className="memo-only-desktop"> od {quizRoundCount}</span>
                      {quizRound > 1 ? ` · Krog ${quizRound}` : ""}
                    </span>
                    <span className="memo-quiz-total memo-only-mobile">
                      {activeQuizQuestionIndex + 1} / {quizRoundCount}
                    </span>
                  </div>
                  <div className="memo-progress quiz">
                    <div
                      style={{
                        width: `${
                          quizRoundCount > 0
                            ? Math.round(((activeQuizQuestionIndex + 1) / quizRoundCount) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  <div className="lecture-quiz-card">
                    <span className="memo-quiz-eyebrow">Izberi en odgovor</span>
                    <p className="lecture-quiz-prompt">{activeQuizQuestion.prompt}</p>

                    <div className="lecture-quiz-options">
                      {activeQuizOptionOrder.map((optionIndex, displayIndex) => {
                        const option = activeQuizQuestion.options[optionIndex] ?? "";
                        const isSelected = activeQuizSelection === optionIndex;
                        const isCorrect =
                          activeQuizSelection !== null &&
                          optionIndex === activeQuizQuestion.correct_option_idx;
                        const isIncorrect =
                          activeQuizSelection !== null &&
                          isSelected &&
                          optionIndex !== activeQuizQuestion.correct_option_idx;

                        return (
                          <button
                            key={`${activeQuizQuestion.id}-${optionIndex}`}
                            type="button"
                            onClick={() => handleQuizSelection(optionIndex)}
                            disabled={activeQuizSelection !== null}
                            className={`lecture-quiz-option ${isSelected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isIncorrect ? "incorrect" : ""}`}
                          >
                            <span className="lecture-quiz-option-label">
                              {String.fromCharCode(65 + displayIndex)}
                            </span>
                            <span className="lecture-quiz-option-copy">{option}</span>
                            {isCorrect || isIncorrect ? (
                              <span className="lecture-quiz-option-mark">
                                <Msym name={isCorrect ? "check" : "close"} size="1.2rem" />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>

                    {quizAnswerWasWrong ? (
                      <div className="memo-quiz-result">
                        <span className="memo-quiz-result-badge">
                          <Msym name="cancel" size="1.25rem" />
                        </span>
                        <span className="memo-quiz-result-copy">
                          <span className="memo-quiz-result-title">Ups, ni pravilno.</span>
                          <span>Pravilen odgovor je {correctQuizOptionLetter}</span>
                        </span>
                        <div className="memo-quiz-result-actions">
                          <button
                            type="button"
                            onClick={reviewQuizAnswerInChat}
                            className="memo-quiz-result-ghost"
                          >
                            Preglej zakaj
                          </button>
                          <button
                            type="button"
                            onClick={() => moveQuizQuestion(1)}
                            className="memo-quiz-result-primary"
                          >
                            Razumem
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <StudyCompletionCard
                  eyebrow="Odlično"
                  title="Kviz je zaključen"
                  percentage={100}
                  percentageLabel="Komplet opravljen"
                  primaryMetric={{
                    label: "Predelana vprašanja",
                    value: `${totalQuizQuestions}/${totalQuizQuestions}`,
                  }}
                  actions={
                    <button
                      type="button"
                      onClick={restartQuiz}
                      className="lecture-study-refresh lecture-study-restart"
                    >
                      <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                      Začni kviz znova
                    </button>
                  }
                />
              )
            ) : detail.practiceTestQuestions.length === 0 ? (
              isPracticeTestGenerating ? (
                <StudyGenerationNotice preview="test" stageCopy={practiceTestStageCopy} />
              ) : (
                <div className="memo-study-empty">
                  <div className="memo-study-empty-orb">
                    <Emoji symbol="📝" size="4.4rem" />
                  </div>
                  <p className="memo-study-empty-title">
                    {detail.lecture.status !== "ready"
                      ? "Učna orodja se odklenejo, ko je obdelava zapiska končana."
                      : detail.practiceTestAsset?.status === "failed"
                        ? "Ustvarjanje preizkusa ni uspelo."
                        : hasCompletedPracticeTest
                          ? "Začni nov preizkus, ko si pripravljen."
                          : "Ustvari svoj prvi preizkus."}
                  </p>
                  <p className="memo-study-empty-copy">
                    {detail.lecture.status !== "ready"
                      ? "Najprej nastanejo zapiski. Nato lahko začneš preizkus."
                      : hasCompletedPracticeTest
                        ? "Vsak nov preizkus prinese nov naključen nabor odprtih vprašanj."
                        : "Najprej ustvari prvi nabor samostojnih odprtih vprašanj, nato preglej rezultate in po koncu začni nove preizkuse."}
                  </p>
                  {detail.lecture.status === "ready" ? (
                    <button
                      type="button"
                      onClick={() => void handlePracticeTestStart()}
                      disabled={isStartingPracticeTest}
                      className="memo-study-empty-cta"
                    >
                      {isStartingPracticeTest ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {hasCompletedPracticeTest ? "Začni nov preizkus" : "Ustvari preizkus"}
                    </button>
                  ) : null}
                </div>
              )
            ) : currentPracticeAttempt ? (
              (() => {
                /*
                 * The design takes the test one question at a time, the way the
                 * quiz does — a counter, a progress bar, the prompt, and a row
                 * that walks back and forward until the last question submits.
                 */
                const total = practiceAttemptAnswers.length;
                const index = Math.min(practiceQuestionIndex, Math.max(total - 1, 0));
                const answer = practiceAttemptAnswers[index];

                if (!answer) {
                  return null;
                }

                const questionId = answer.practice_test_question_id ?? `snapshot-${answer.id}`;
                const isUnknown = practiceUnknownQuestionIds.includes(questionId);
                const isLast = index === total - 1;

                return (
                  <div className="lecture-practice-shell">
                    <div className="lecture-practice-stage">
                      <div className="memo-test-meta">
                        <span className="memo-test-no">Vprašanje {index + 1}</span>
                        <span className="memo-test-count">
                          {index + 1} / {total}
                        </span>
                      </div>
                      <div className="memo-progress test">
                        <div
                          style={{
                            width: `${total > 0 ? Math.round(((index + 1) / total) * 100) : 0}%`,
                          }}
                        />
                      </div>

                      <p className="lecture-practice-prompt">
                        {answer.question?.prompt ?? "Vprašanje ni na voljo."}
                      </p>
                      <textarea
                        value={practiceTextAnswers[questionId] ?? ""}
                        onChange={(event) => handlePracticeAnswerChange(questionId, event.target.value)}
                        disabled={isUnknown}
                        className="ios-textarea lecture-practice-textarea"
                        placeholder="Napiši svoj odgovor…"
                      />

                      <div className="lecture-practice-controls">
                        <label className="lecture-practice-unknown">
                          <input
                            type="checkbox"
                            checked={isUnknown}
                            onChange={(event) =>
                              handlePracticeUnknownToggle(questionId, event.target.checked)
                            }
                          />
                          Ne vem
                        </label>
                      </div>

                      <div className="memo-test-actions">
                        <button
                          type="button"
                          className="memo-test-prev"
                          disabled={index === 0}
                          onClick={() => setPracticeQuestionIndex((current) => Math.max(0, current - 1))}
                        >
                          Nazaj
                        </button>
                        <button
                          type="button"
                          className="memo-test-next"
                          disabled={
                            isLast &&
                            (isSubmittingPracticeTest ||
                              practiceQuestionsAnsweredCount < practiceAttemptAnswers.length)
                          }
                          onClick={() => {
                            if (!isLast) {
                              setPracticeQuestionIndex((current) => Math.min(total - 1, current + 1));
                              return;
                            }

                            void handlePracticeTestSubmit();
                          }}
                        >
                          {isLast && isSubmittingPracticeTest ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {isLast ? "Oddaj preizkus" : "Naprej"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="lecture-practice-shell">
                {visiblePracticeAttempt && visiblePracticeAttempt.status === "graded" ? (
                  <div className="lecture-practice-results">
                    <StudyCompletionCard
                      eyebrow=""
                      title=""
                      subtitle={`Poskus ${detail.practiceTestHistorySummary.attemptCount}`}
                      percentage={visiblePracticeAttemptPercentage}
                      percentageLabel="Rezultat"
                      primaryMetric={{
                        label: "Dosežene točke",
                        value: `${visiblePracticeAttempt.total_score ?? 0}/${visiblePracticeAttempt.max_score ?? 0}`,
                      }}
                      secondaryMetrics={[
                        {
                          label: "Povprečje",
                          value:
                            detail.practiceTestHistorySummary.averagePercentage == null
                              ? "-"
                              : `${Math.round(detail.practiceTestHistorySummary.averagePercentage)}%`,
                        },
                        {
                          label: "Najboljši rezultat",
                          value:
                            detail.practiceTestHistorySummary.bestPercentage == null
                              ? "-"
                              : `${Math.round(detail.practiceTestHistorySummary.bestPercentage)}%`,
                        },
                        {
                          label: "Najnižji rezultat",
                          value:
                            detail.practiceTestHistorySummary.lowestPercentage == null
                              ? "-"
                              : `${Math.round(detail.practiceTestHistorySummary.lowestPercentage)}%`,
                        },
                        {
                          label: "Poskusi",
                          value: String(detail.practiceTestHistorySummary.attemptCount),
                        },
                      ]}
                      actions={
                        !isPracticeTestGenerating ? (
                          <button
                            type="button"
                            onClick={() => void handlePracticeTestStart()}
                            disabled={isStartingPracticeTest}
                            className="lecture-study-refresh lecture-practice-start-button"
                          >
                            {isStartingPracticeTest ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : null}
                            Začni nov preizkus
                          </button>
                        ) : null
                      }
                    />

                    <details className="lecture-practice-breakdown">
                      <summary>
                        <span className="lecture-practice-breakdown-icon" aria-hidden="true">
                          📝
                        </span>
                        <span className="lecture-practice-breakdown-label">Podrobnosti poskusa</span>
                        <span className="lecture-practice-breakdown-chevron" aria-hidden="true">
                          ▾
                        </span>
                      </summary>
                      <div className="lecture-practice-feedback-list">
                        {visiblePracticeAttempt.answers.map((answer, index) => (
                          <details key={answer.id} className="lecture-practice-feedback-card">
                            <summary className="lecture-practice-feedback-summary">
                              <span className="lecture-practice-feedback-label">
                                Vprašanje {index + 1}
                              </span>
                              <span className="lecture-practice-feedback-meta">
                                <span>{answer.score ?? 0}/5</span>
                                <span
                                  className="lecture-practice-feedback-chevron"
                                  aria-hidden="true"
                                >
                                  ▾
                                </span>
                              </span>
                            </summary>
                            <div className="lecture-practice-feedback-body">
                              <p className="lecture-practice-prompt">{answer.question?.prompt}</p>
                              {answer.typed_answer ? (
                                <p className="lecture-practice-feedback-copy">
                                  <strong>Tvoj odgovor:</strong> {answer.typed_answer}
                                </p>
                              ) : null}
                              <p className="lecture-practice-feedback-copy">
                                <strong>Razlaga:</strong> {answer.grading_rationale ?? "Brez povratne informacije."}
                              </p>
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="memo-study-empty">
                    <div className="memo-study-empty-orb">
                      <Emoji symbol="📝" size="4.4rem" />
                    </div>
                    <span className="memo-study-empty-title">Vadbeni test</span>
                    <span className="memo-study-empty-copy">
                      Odprta vprašanja iz tega predavanja. Odgovore napišeš s svojimi
                      besedami, Memo pa jih oceni in pojasni.
                    </span>
                    {!isPracticeTestGenerating ? (
                      <button
                        type="button"
                        onClick={() => void handlePracticeTestStart()}
                        disabled={isStartingPracticeTest}
                        className="memo-study-empty-cta"
                      >
                        {isStartingPracticeTest ? (
                          <Msym name="progress_activity" className="memo-spin" size="1.2rem" />
                        ) : (
                          <Msym name="assignment" size="1.2rem" fill={false} weight={500} />
                        )}
                        Začni nov preizkus
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>

          <MemoPortal>
            {isStudyManagerOpen && (activeStudyView === "flashcards" || activeStudyView === "quiz") ? (
              <div
                className={sheetClass("study-manager-backdrop", studyManagerSheet.closing)}
                role="presentation"
                onClick={animateCloseStudyManager}
              >
                <div
                  ref={studyManagerSheetRef}
                  className={sheetClass(
                    "study-manager-sheet mobile-draggable-sheet",
                    studyManagerSheet.closing,
                  )}
                  role="dialog"
                  aria-modal="true"
                  aria-label={activeStudyView === "flashcards" ? "Uredi kartice" : "Uredi kviz"}
                  onClick={(event) => event.stopPropagation()}
                  {...studyManagerSheet.dragProps}
                >
                  <div
                    className="study-manager-top-drag-zone"
                    aria-hidden="true"
                    data-drag-handle
                  />
                  <button
                    type="button"
                    className="mobile-sheet-drag-handle study-manager-drag-handle"
                    aria-label="Povleci navzdol za zapiranje"
                    data-drag-handle
                  />
                  <div className="study-manager-header">
                    <div>
                      <p className="study-manager-eyebrow">
                        {activeStudyView === "flashcards" ? "Flashcards" : "Kviz"}
                      </p>
                      <h2>{activeStudyView === "flashcards" ? "Uredi kartice" : "Uredi vprašanja"}</h2>
                    </div>
                    <button
                      type="button"
                      className="app-close-button study-manager-icon-button"
                      onClick={animateCloseStudyManager}
                      aria-label="Zapri"
                      title="Zapri"
                    >
                      <Msym name="close" size="1.45rem" fill={false} weight={500} />
                    </button>
                  </div>

                  {activeStudyView === "flashcards" ? (
                    <>
                      <form
                        onSubmit={handleFlashcardFormSubmit}
                        className="study-manager-form study-manager-form-flashcards"
                      >
                        {editingFlashcardId ? (
                          <div className="study-manager-form-header">
                            <button type="button" onClick={startFlashcardCreate}>
                              <Msym name="add" size="1.1rem" />
                              Nova
                            </button>
                          </div>
                        ) : null}
                        <label>
                          <span>Vprašanje</span>
                          <textarea
                            value={flashcardForm.front}
                            onChange={(event) =>
                              setFlashcardForm((current) => ({ ...current, front: event.target.value }))
                            }
                            rows={3}
                            required
                          />
                        </label>
                        <label>
                          <span>Odgovor</span>
                          <textarea
                            value={flashcardForm.back}
                            onChange={(event) =>
                              setFlashcardForm((current) => ({ ...current, back: event.target.value }))
                            }
                            rows={3}
                            required
                          />
                        </label>
                        <button type="submit" className="study-manager-save" disabled={isSavingStudyItem}>
                          {isSavingStudyItem ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Msym name="check" size="1.15rem" />
                          )}
                          {editingFlashcardId ? "Shrani kartico" : "Dodaj kartico"}
                        </button>
                      </form>

                      <div className="ios-search notes-search study-manager-search">
                        <Msym name="search" size="1.1rem" fill={false} weight={500} />
                        <input
                          value={studyManagerSearch}
                          onChange={(event) => setStudyManagerSearch(event.target.value)}
                          placeholder="Poišči..."
                        />
                      </div>

                      <div className="study-manager-list">
                        {managedFlashcards.map((flashcard) => {
                          const isDeleting = deletingStudyItemIds.has(flashcard.id);
                          const itemOffset = getStudyManagerItemOffset(flashcard.id);
                          const isItemSwipeActive = Boolean(
                            studyManagerItemDrag?.id === flashcard.id ||
                              openStudyManagerActionItemId === flashcard.id ||
                              itemOffset < 0,
                          );

                          return (
                            <article
                              key={flashcard.id}
                              className={`study-manager-item ${isItemSwipeActive ? "is-swiping" : ""}`}
                              data-swipe-open={openStudyManagerActionItemId === flashcard.id ? "true" : undefined}
                            >
                              <div className="study-manager-item-actions" aria-label="Dejanja kartice">
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => void handleDeleteFlashcard(flashcard.id)}
                                  disabled={isDeleting}
                                  aria-busy={isDeleting}
                                >
                                  <span
                                    className={`study-manager-action-circle ${
                                      isDeleting ? "is-loading" : ""
                                    }`}
                                  >
                                    {isDeleting ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <EmojiIcon symbol="🗑️" size="1.1rem" />
                                    )}
                                  </span>
                                  <span className="study-manager-action-label">
                                    {isDeleting ? "Brisanje" : "Izbriši"}
                                  </span>
                                </button>
                              </div>
                              <div
                                className="study-manager-item-surface"
                                onPointerDown={(event) =>
                                  handleStudyManagerItemPointerDown(event, flashcard.id)
                                }
                                onPointerMove={(event) =>
                                  handleStudyManagerItemPointerMove(event, flashcard.id)
                                }
                                onPointerUp={(event) =>
                                  handleStudyManagerItemPointerEnd(event, flashcard.id)
                                }
                                onPointerCancel={(event) =>
                                  handleStudyManagerItemPointerEnd(event, flashcard.id)
                                }
                                onClick={(event) =>
                                  handleStudyManagerItemClick(event, () => startFlashcardEdit(flashcard))
                                }
                                style={
                                  {
                                    "--study-manager-swipe-offset": `${itemOffset}px`,
                                  } as CSSProperties
                                }
                              >
                                <div className="study-manager-item-content">
                                  <strong>{flashcard.front}</strong>
                                  <p>{flashcard.back}</p>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <form
                        onSubmit={handleQuizQuestionFormSubmit}
                        className="study-manager-form study-manager-form-quiz"
                      >
                        {editingQuizQuestionId ? (
                          <div className="study-manager-form-header">
                            <button type="button" onClick={startQuizQuestionCreate}>
                              <Msym name="add" size="1.1rem" />
                              Novo
                            </button>
                          </div>
                        ) : null}
                        <label>
                          <span>Vprašanje</span>
                          <textarea
                            value={quizQuestionForm.prompt}
                            onChange={(event) =>
                              setQuizQuestionForm((current) => ({ ...current, prompt: event.target.value }))
                            }
                            rows={3}
                            required
                          />
                        </label>
                        <div className="study-manager-options">
                          {quizQuestionForm.options.map((option, index) => (
                            <label key={`quiz-option-${index}`}>
                              <span>{String.fromCharCode(65 + index)}</span>
                              <div>
                                <input
                                  type="radio"
                                  checked={quizQuestionForm.correctOptionIndex === index}
                                  onChange={() =>
                                    setQuizQuestionForm((current) => ({
                                      ...current,
                                      correctOptionIndex: index,
                                    }))
                                  }
                                  aria-label={`Pravilen odgovor ${String.fromCharCode(65 + index)}`}
                                />
                                <input
                                  value={option}
                                  onChange={(event) =>
                                    setQuizQuestionForm((current) => {
                                      const options = [...current.options] as QuizQuestionFormState["options"];
                                      options[index] = event.target.value;
                                      return { ...current, options };
                                    })
                                  }
                                  required
                                />
                              </div>
                            </label>
                          ))}
                        </div>
                        <button type="submit" className="study-manager-save" disabled={isSavingStudyItem}>
                          {isSavingStudyItem ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Msym name="check" size="1.15rem" />
                          )}
                          {editingQuizQuestionId ? "Shrani vprašanje" : "Dodaj vprašanje"}
                        </button>
                      </form>

                      <div className="ios-search notes-search study-manager-search">
                        <Msym name="search" size="1.1rem" fill={false} weight={500} />
                        <input
                          value={studyManagerSearch}
                          onChange={(event) => setStudyManagerSearch(event.target.value)}
                          placeholder="Poišči..."
                        />
                      </div>

                      <div className="study-manager-list">
                        {managedQuizQuestions.map((question) => {
                          const isDeleting = deletingStudyItemIds.has(question.id);
                          const itemOffset = getStudyManagerItemOffset(question.id);
                          const isItemSwipeActive = Boolean(
                            studyManagerItemDrag?.id === question.id ||
                              openStudyManagerActionItemId === question.id ||
                              itemOffset < 0,
                          );

                          return (
                            <article
                              key={question.id}
                              className={`study-manager-item ${isItemSwipeActive ? "is-swiping" : ""}`}
                              data-swipe-open={openStudyManagerActionItemId === question.id ? "true" : undefined}
                            >
                              <div className="study-manager-item-actions" aria-label="Dejanja vprašanja">
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => void handleDeleteQuizQuestion(question.id)}
                                  disabled={isDeleting}
                                  aria-busy={isDeleting}
                                >
                                  <span
                                    className={`study-manager-action-circle ${
                                      isDeleting ? "is-loading" : ""
                                    }`}
                                  >
                                    {isDeleting ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <EmojiIcon symbol="🗑️" size="1.1rem" />
                                    )}
                                  </span>
                                  <span className="study-manager-action-label">
                                    {isDeleting ? "Brisanje" : "Izbriši"}
                                  </span>
                                </button>
                              </div>
                              <div
                                className="study-manager-item-surface"
                                onPointerDown={(event) =>
                                  handleStudyManagerItemPointerDown(event, question.id)
                                }
                                onPointerMove={(event) =>
                                  handleStudyManagerItemPointerMove(event, question.id)
                                }
                                onPointerUp={(event) =>
                                  handleStudyManagerItemPointerEnd(event, question.id)
                                }
                                onPointerCancel={(event) =>
                                  handleStudyManagerItemPointerEnd(event, question.id)
                                }
                                onClick={(event) =>
                                  handleStudyManagerItemClick(event, () => startQuizQuestionEdit(question))
                                }
                                style={
                                  {
                                    "--study-manager-swipe-offset": `${itemOffset}px`,
                                  } as CSSProperties
                                }
                              >
                                <div className="study-manager-item-content">
                                  <strong>{question.prompt}</strong>
                                  <p>{question.options[question.correct_option_idx] ?? question.options[0]}</p>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </MemoPortal>

          {/* On the phone this rides in the dock row beside the chat bar —
              the slot the listen pill uses on the notes tab, which no study
              tab fills. */}
          {canManageActiveStudyView && !isStudyManagerOpen && dockSlot
            ? createPortal(
                <button
                  type="button"
                  className="mobile-study-manage-pill memo-only-mobile flex"
                  onClick={openStudyManager}
                  aria-label={activeStudyView === "flashcards" ? "Uredi kartice" : "Uredi kviz"}
                >
                  <Msym name="edit_square" size="1.3rem" fill={false} weight={500} />
                  <span className="mobile-study-manage-pill-label">Uredi</span>
                </button>,
                dockSlot,
              )
            : null}
        </>
      );
    }

    if (activeTab === "transcript" || activeTab === "audio") {
      const transcriptSegments =
        detail.transcript.length > 0 ? detail.transcript : getScanTranscriptFallback(detail);
      const isScanTranscript = isScanImport(detail);

      return (
        <div className="memo-transcript">
          {/* The redesign puts the recording's player above the transcript
              rather than on a tab of its own. */}
          {detail.audioUrl ? (
            <RecordingPlayer key={detail.audioUrl} src={detail.audioUrl} />
          ) : null}

          {transcriptSegments.length > 0 ? (
            <div className="memo-transcript-rows">
              {transcriptSegments.map((segment) => (
                <div key={segment.id} className="memo-transcript-row">
                  <span className="memo-transcript-time">
                    {isScanTranscript
                      ? formatScanTranscriptLabel(segment.speaker_label)
                      : formatTimestamp(segment.start_ms)}
                  </span>
                  <span className="memo-transcript-text">{segment.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="memo-empty">
              <Emoji symbol="📜" size="2rem" />
              <p>Prepis se še pripravlja.</p>
              <p>Ko bo pripravljen, se bo prikazal tukaj.</p>
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  const noteEmojiSymbol = detail.lecture.emoji?.trim() || noteEmoji(detail.lecture);

  function navigateHome() {
    // Leaving the note is a whole-screen swap, so it goes through the shared
    // feedback path: the library's skeleton paints in the tap frame instead of
    // the note sitting there unchanged while the router fetches.
    navigateWithFeedback(homeHref);
  }

  async function renameNote() {
    const nextTitle = noteRenameValue.trim();

    if (!nextTitle || nextTitle === lectureTitle) {
      renameSheet.dismiss();
      return;
    }

    try {
      setNoteActionError(null);
      setIsNoteActionBusy(true);
      const response = await fetch(`/api/lectures/${detail.lecture.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Naslova ni bilo mogoče shraniti.");
      }

      setIsNoteActionBusy(false);
      renameSheet.dismiss(() => startTransition(() => router.refresh()));
    } catch (error) {
      setNoteActionError(
        error instanceof Error ? error.message : "Naslova ni bilo mogoče shraniti.",
      );
      setIsNoteActionBusy(false);
    }
  }

  async function deleteNote() {
    try {
      setNoteActionError(null);
      setIsNoteActionBusy(true);
      const response = await fetch(`/api/lectures/${detail.lecture.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Zapiska ni bilo mogoče izbrisati.");
      }

      // The note is gone, so there is nothing to come back to: leave for the
      // library rather than closing the sheet onto a dead screen.
      setIsNoteActionBusy(false);
      navigateWithFeedback(homeHref);
    } catch (error) {
      setNoteActionError(
        error instanceof Error ? error.message : "Zapiska ni bilo mogoče izbrisati.",
      );
      setIsNoteActionBusy(false);
    }
  }

  /*
   * Each tab starts at its own top. The scroller is shared, so without this a
   * tab opens at the last one's offset — which on the study tabs leaves the
   * pills sitting half-faded under the navbar.
   */
  useEffect(() => {
    noteScrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab, activeStudyView]);

  const activeTabId: NoteTabId =
    activeTab === "notes"
      ? "notes"
      : activeTab === "transcript" || activeTab === "audio"
        ? "transcript"
        : activeStudyView === "flashcards"
          ? "flashcards"
          : activeStudyView === "quiz"
            ? "quiz"
            : "test";

  /**
   * Desktop shows the conversation as the grid's third column, so it is
   * portalled into the slot the shell renders (see AppLayoutProvider). The
   * phone shows the same body as a full-height sheet.
   *
   * The quiz owns the bottom of the screen with its own result sheet, so chat
   * steps aside there — matching the redesign, where "Preglej zakaj" is the way
   * into chat from a quiz.
   */
  // The design keeps the chat panel open on every tab; only the button that
  // brings it back is withheld on the quiz, which wants the full width while a
  // question is on screen.
  //
  // It also closes the moment a navigation away starts. The panel is portalled
  // into the shell's third grid column, outside the content area the loading
  // overlay covers, so leaving the note with it open left the note's chat
  // standing beside the library's skeleton until the route committed.
  const isLeavingNote = navigatingTo != null && navigatingTo !== notePathname;
  const showChatPanel = !isChatDismissed && !isLeavingNote;

  useEffect(() => {
    setChatOpen(showChatPanel);
    return () => setChatOpen(false);
  }, [setChatOpen, showChatPanel]);

  const desktopChatPanel =
    showChatPanel && chatSlot
      ? createPortal(
          <>
            {isChatExpanded ? (
              <button
                type="button"
                aria-label="Pomanjšaj klepet"
                className="memo-chat-scrim"
                onClick={() => setIsChatExpanded(false)}
              />
            ) : null}
            <aside className={`memo-chat-aside ${isChatExpanded ? "expanded" : ""}`.trim()}>
              <div className="memo-chat-head">
                <div className="memo-chat-head-row">
                  <span className="memo-avatar">
                    <Image src="/memo-mascot.png" alt="" width={320} height={288} />
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    aria-label={isChatExpanded ? "Pomanjšaj" : "Razširi"}
                    className="memo-icon-button"
                    onClick={() => setIsChatExpanded((current) => !current)}
                  >
                    <Msym
                      name={isChatExpanded ? "close_fullscreen" : "open_in_full"}
                      size="1.2rem"
                      fill={false}
                      weight={500}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label="Zapri klepet"
                    className="memo-icon-button"
                    onClick={() => {
                      setIsChatDismissed(true);
                      setIsChatExpanded(false);
                    }}
                  >
                    <Msym name="close" size="1.45rem" fill={false} weight={500} />
                  </button>
                </div>

                <h2>Klepet s tem zapiskom</h2>
                <div className="memo-chat-rule" />
              </div>

              {renderChatBody()}
            </aside>
          </>,
          chatSlot,
        )
      : null;

  const mobileChatSheet = isMobileChatOpen ? (
    <MemoPortal>
      <button
        type="button"
        aria-label="Zapri klepet"
        className={sheetClass("memo-scrim memo-only-mobile", chatSheet.closing)}
        onClick={() => chatSheet.dismiss()}
      />
      <div
        className={sheetClass(
          "memo-sheet-full surface memo-only-mobile memo-note-chat-sheet",
          chatSheet.closing,
        )}
        role="dialog"
        aria-modal="true"
        {...chatSheet.dragProps}
      >
        {/* The grabber is the only place a drag may start here: the log below
            it scrolls, and a finger on that should pan rather than dismiss. */}
        <div className="memo-grab-wide" data-drag-handle="true">
          <span />
        </div>
        <div className="memo-m-chat-head" data-drag-zone>
          <span className="memo-m-chat-heading">
            <span className="memo-m-chat-title">Klepet s tem zapiskom</span>
          </span>
          <button
            type="button"
            aria-label="Zapri"
            className="memo-m-chat-head-btn right"
            onClick={() => chatSheet.dismiss()}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>

        {renderChatBody()}
      </div>
    </MemoPortal>
  ) : null;

  const chatPanel = (
    <>
      {desktopChatPanel}
      {mobileChatSheet}
    </>
  );

  const lectureTitle = detail.lecture.title?.trim() || "Predavanje v obdelavi";
  // The phone prints the source beside the date — "28. 8. 2026, Zvok,
  // 1 h 12 min" — where desktop shows the date alone.
  const noteSourceDetail = getLectureSourceDetail(detail.lecture);
  const noteMetaLine = [
    formatCalendarDate(detail.lecture.created_at),
    getLectureSourceLabel(
      getEffectiveLectureSourceType(detail.lecture),
      detail.lecture.processing_metadata,
    ),
    noteSourceDetail,
  ]
    .filter(Boolean)
    .join(", ");

  /*
   * The note's own actions, as the design's `actions` sheet draws them: the
   * title named quietly at the top, Preimenuj and Izbriši on their own cards,
   * and Prekliči closing it out. Each action swaps sheets on the spot, which is
   * what the design does between sheets in one flow.
   */
  const noteActionSheets = (
    <>
      {noteActionsOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label="Zapri"
            className={sheetClass("memo-scrim memo-only-mobile", noteActionsSheet.closing)}
            onClick={() => noteActionsSheet.dismiss()}
          />
          <section
            className={sheetClass("memo-action-sheet memo-only-mobile", noteActionsSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-label={`Dejanja zapiska ${lectureTitle}`}
            {...noteActionsSheet.dragProps}
          >
            <span className="mobile-sheet-drag-handle" data-drag-handle="true" />
            <p className="memo-action-sheet-target">{lectureTitle}</p>

            <div className="memo-action-sheet-list">
              <button
                type="button"
                className="memo-action-sheet-item"
                onClick={() => {
                  setNoteActionsOpen(false);
                  setNoteRenameValue(lectureTitle);
                  setNoteRenameOpen(true);
                }}
              >
                <Msym name="edit" size="1.4rem" fill weight={500} />
                Preimenuj
              </button>

              <button
                type="button"
                className="memo-action-sheet-item danger"
                onClick={() => {
                  setNoteActionsOpen(false);
                  setNoteDeleteOpen(true);
                }}
              >
                <Msym name="delete" size="1.4rem" fill weight={500} />
                Izbriši
              </button>

              <button
                type="button"
                className="memo-action-sheet-cancel"
                onClick={() => noteActionsSheet.dismiss()}
              >
                Prekliči
              </button>
            </div>
          </section>
        </MemoPortal>
      ) : null}

      {noteRenameOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label="Zapri"
            className={sheetClass("memo-scrim memo-only-mobile", renameSheet.closing)}
            onClick={() => renameSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet memo-dialog memo-only-mobile", renameSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-rename-title"
            {...renameSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <span id="note-rename-title" className="memo-sheet-heading">
              Preimenuj zapisek
            </span>
            <input
              className="memo-sheet-field"
              value={noteRenameValue}
              onChange={(event) => setNoteRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                event.currentTarget.blur();
                void renameNote();
              }}
              placeholder="Naslov zapiska"
              enterKeyHint="done"
              autoCapitalize="sentences"
              autoCorrect="off"
              autoComplete="off"
            />
            {noteActionError ? <p className="memo-inline-error">{noteActionError}</p> : null}
            <div className="memo-sheet-actions">
              <button
                type="button"
                className="memo-sheet-coral"
                onClick={() => void renameNote()}
                disabled={isNoteActionBusy}
              >
                {isNoteActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Shrani
              </button>
              <button
                type="button"
                className="memo-sheet-ghost"
                onClick={() => renameSheet.dismiss()}
                disabled={isNoteActionBusy}
              >
                Prekliči
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      {noteDeleteOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label="Zapri"
            className={sheetClass("memo-scrim memo-only-mobile", deleteSheet.closing)}
            onClick={() => deleteSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet memo-dialog memo-only-mobile", deleteSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-delete-title"
            {...deleteSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <span id="note-delete-title" className="memo-sheet-heading">
              Izbriši zapisek
            </span>
            <p className="memo-sheet-copy">
              Zapisek »{lectureTitle}« bo trajno izbrisan skupaj s prepisom, karticami in
              kvizi.
            </p>
            {noteActionError ? <p className="memo-inline-error">{noteActionError}</p> : null}
            <div className="memo-sheet-actions">
              <button
                type="button"
                className="memo-sheet-danger"
                onClick={() => void deleteNote()}
                disabled={isNoteActionBusy}
              >
                {isNoteActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Izbriši zapisek
              </button>
              <button
                type="button"
                className="memo-sheet-ghost"
                onClick={() => deleteSheet.dismiss()}
                disabled={isNoteActionBusy}
              >
                Prekliči
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );

  function selectNoteTab(tab: (typeof NOTE_TABS)[number]) {
    if (tab.id === "notes") {
      setActiveTab("notes");
      return;
    }

    if (tab.id === "transcript") {
      setActiveTab("transcript");
      return;
    }

    setActiveTab("study");

    if (tab.view) {
      setActiveStudyView(tab.view);
    }
  }

  const tabPills = (
    <div className="memo-tabs memo-chiprow">
      {getNoteTabs({ showsTranscript }).map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => selectNoteTab(tab)}
          className={`memo-tab ${activeTabId === tab.id ? "active" : ""}`.trim()}
          style={{ "--tab-tint": tab.tint } as CSSProperties}
          aria-current={activeTabId === tab.id ? "page" : undefined}
        >
          <Msym name={tab.icon} size="1.2rem" fill={false} weight={500} />
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );

  /*
   * The design carries no overflow menu on the note screen. Its only item that
   * was not already reachable — retrying a failed import — is shown in the open
   * instead, and only when there is something to retry.
   */
  const noteMenu =
    detail.lecture.status === "failed" &&
    canRetryLectureFailure(detail.lecture) ? (
      <div className="memo-note-actions">
        <button type="button" className="memo-note-action" onClick={handleRetry}>
          {isRetrying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Msym name="refresh" size="1.15rem" fill={false} weight={500} />
          )}
          <span>Poskusi znova</span>
        </button>
      </div>
    ) : null;

  return (
    <>
      {navigationOverlay}
      <div className="memo-note-screen" data-note-tab={activeTabId}>
        {/* Phone chrome: back, the note's emoji, and the actions menu. */}
        <div className="memo-m-navbar memo-only-mobile flex">
          <button
            type="button"
            aria-label="Nazaj"
            className="memo-m-navbtn"
            onClick={navigateHome}
          >
            <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
          </button>
          {/* The notes screen shows the note's emoji; each study screen names
              itself instead, and flashcards names nothing — the design's own
              mapping. */}
          {activeTabId === "notes" ? (
            <Emoji symbol={noteEmojiSymbol} className="memo-m-noteemoji" size="1.5rem" />
          ) : (
            <span className="memo-m-navtitle">{SUB_SCREEN_TITLES[activeTabId]}</span>
          )}
          <button
            type="button"
            aria-label="Dejanja"
            className="memo-m-navbtn filled"
            onClick={() => {
              setNoteRenameValue(lectureTitle);
              setNoteActionError(null);
              setNoteActionsOpen(true);
            }}
          >
            <Msym name="more_horiz" size="1.35rem" fill weight={500} />
          </button>
        </div>

        <div className="memo-note-card">
          <div className="memo-breadcrumb memo-only-desktop">
            <button type="button" onClick={navigateHome}>
              Moji zapiski
            </button>
            <Msym name="chevron_right" size="1.1rem" fill={false} weight={400} />
            <span className="memo-breadcrumb-current">Podrobnosti zapiska</span>
          </div>

          <div className="memo-note-scroll" ref={noteScrollRef}>
            {tabPills}

            <div className="memo-note-head memo-only-desktop">
              <span className="memo-note-head-emoji">
                <Emoji symbol={noteEmojiSymbol} size="1.45rem" />
              </span>
              <h1>{lectureTitle}</h1>
            </div>

            <h1 className="memo-m-note-title memo-only-mobile memo-notes-tab-only">
              {lectureTitle}
            </h1>

            {noteMenu}

            <div className="memo-note-date memo-only-desktop">
              <span>{formatCalendarDate(detail.lecture.created_at)}</span>
            </div>

            <div className="memo-m-note-meta memo-only-mobile flex memo-notes-tab-only">
              <span>{noteMetaLine}</span>
            </div>

            {detail.lecture.error_message ? (
              <p className="memo-inline-error">{detail.lecture.error_message}</p>
            ) : null}

            {activeTabId === "notes" ? <div className="memo-study-divider-off" /> : null}

            <div className={`memo-panel ${activeTabId === "notes" ? "" : "study"}`.trim()}>
              {renderPanel()}
            </div>
          </div>

          {/* The bottom row: the listen / annotate pill (rendered into the slot
              by NoteReadAloud) and the way into chat. */}
          <div className="memo-dock">
            <div className="memo-dock-slot" ref={setDockSlot} />

            {isChatDismissed && activeTabId !== "quiz" ? (
              <button
                type="button"
                aria-label="Odpri klepet"
                className="memo-chat-fab memo-only-desktop"
                onClick={() => setIsChatDismissed(false)}
              >
                <Msym name="forum" size="1.35rem" />
                <span>Klepet</span>
              </button>
            ) : null}

            <button
              type="button"
              className="memo-m-chatbar memo-only-mobile"
              onClick={() => setIsMobileChatOpen(true)}
              aria-label="Klepetaj s tem zapiskom"
            >
              <span className="memo-m-chatbar-label">Klepetaj s tem zapiskom</span>
              <span className="memo-m-chatbar-icon">
                <Msym name="mic" size="1.35rem" className="mic" />
                <Msym name="chat_bubble" size="1.35rem" className="bubble" />
              </span>
              </button>

            {/*
              * The circle at the end of the bar is a microphone, so it dictates
              * rather than just decorating: it opens the chat and starts
              * listening, and what it hears lands in the composer. It sits
              * beside the bar rather than inside it because a button cannot
              * contain another button — the stylesheet lays it over the icon
              * slot the bar already draws.
              */}
            {dictation.supported ? (
              <button
                type="button"
                className={`memo-m-chatbar-mic ${dictation.listening ? "listening" : ""} ${
                  dictation.transcribing ? "transcribing" : ""
                }`.trim()}
                onClick={() => {
                  setIsMobileChatOpen(true);
                  dictation.toggle();
                }}
                aria-pressed={dictation.listening}
                aria-label={dictation.listening ? "Ustavi narekovanje" : "Narekuj vprašanje"}
              />
            ) : null}
          </div>
        </div>
      </div>

      {chatPanel}
      {noteActionSheets}
    </>
  );
}
