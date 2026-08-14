"use client";

/**
 * In-memory library for the `/creator` demo. Everything a recording does —
 * creating a note, renaming it, swiping flashcards, answering a quiz, taking a
 * practice test, chatting — is applied here. Nothing leaves the browser and no
 * file the creator picks is ever read or uploaded.
 *
 * State survives client navigation and reloads within the tab (sessionStorage)
 * and resets when the tab is closed.
 */
import type { FlashcardConfidenceBucket } from "@/lib/database.types";
import {
  buildDemoLectureDetail,
  buildDemoSeed,
  toLectureListItems,
  DEMO_USER_ID,
  type DemoSeed,
} from "@/lib/creator-demo/build";
import {
  DEMO_CREATE_PACKS,
  getDemoNotePack,
  type DemoNotePack,
} from "@/lib/creator-demo/content";
import type { EditableNoteDoc } from "@/lib/note-doc";
import type {
  AppLectureListItem,
  AppLibraryFolder,
  ChatMessageWithCitations,
  LectureDetail,
  PracticeTestAttemptWithAnswers,
  PracticeTestHistorySummary,
  StudySession,
} from "@/lib/types";

export type CreatorDemoState = DemoSeed;

export type DemoCreateKind = keyof typeof DEMO_CREATE_PACKS;

const SESSION_STORAGE_KEY = "memoai:creator-demo:v1";

let state: CreatorDemoState | null = null;
let hydratedFromSession = false;
let createCounter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function persist() {
  if (typeof window === "undefined" || !state) {
    return;
  }

  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage is a convenience here; a full or blocked store is not fatal.
  }
}

function setState(next: CreatorDemoState) {
  state = next;
  persist();
  emit();
}

/** Seeds the singleton with the exact data the server rendered. */
export function initCreatorDemoState(seed: CreatorDemoState) {
  if (!state) {
    state = seed;
  }

  return state;
}

export function getCreatorDemoState(): CreatorDemoState {
  if (!state) {
    state = buildDemoSeed();
  }

  return state;
}

export function subscribeToCreatorDemo(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Restores notes created earlier in this tab. Client-only, runs after mount. */
export function hydrateCreatorDemoFromSession() {
  if (hydratedFromSession || typeof window === "undefined") {
    return;
  }

  hydratedFromSession = true;

  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as CreatorDemoState;

    if (!parsed || !Array.isArray(parsed.order) || !parsed.details) {
      return;
    }

    setState(parsed);
  } catch {
    // A corrupted snapshot just means the demo starts from the seed library.
  }
}

/**
 * A reset also has to drop the real app's localStorage caches, or a previous
 * take's folder filter and half-finished flashcard sessions come back on the
 * seeded notes. Only demo-scoped keys are touched: a signed-in visitor's own
 * folders and study sessions must survive untouched.
 */
function isDemoOwnedStorageKey(key: string) {
  return (
    key === `nota-library-folders:${DEMO_USER_ID}` ||
    key === `nota-selected-library-folder:${DEMO_USER_ID}` ||
    key.startsWith("lecture-study-session:demo-")
  );
}

export function resetCreatorDemo() {
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);

      const staleKeys = Object.keys(window.localStorage).filter(isDemoOwnedStorageKey);

      for (const key of staleKeys) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore: the in-memory reset below is what matters.
    }
  }

  createCounter = 0;
  setState(buildDemoSeed());
}

export function getDemoLectures(): AppLectureListItem[] {
  return toLectureListItems(getCreatorDemoState());
}

export function getDemoFolders(): AppLibraryFolder[] {
  return getCreatorDemoState().folders;
}

export function getDemoLectureDetail(lectureId: string): LectureDetail | null {
  return getCreatorDemoState().details[lectureId] ?? null;
}

function getPack(lectureId: string): DemoNotePack {
  return getDemoNotePack(getCreatorDemoState().packByLectureId[lectureId] ?? "");
}

function updateDetail(
  lectureId: string,
  update: (detail: LectureDetail) => LectureDetail,
) {
  const current = getCreatorDemoState();
  const detail = current.details[lectureId];

  if (!detail) {
    return null;
  }

  const nextDetail = update(detail);
  setState({
    ...current,
    details: { ...current.details, [lectureId]: nextDetail },
  });

  return nextDetail;
}

function nextDemoId(prefix: string) {
  createCounter += 1;
  return `demo-${prefix}-${createCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Reserves the note a create flow will produce. The id exists immediately so
 * the note route can be prefetched while the demo plays its processing stages,
 * but nothing enters the library until `commit()` — a cancelled create leaves
 * no trace.
 *
 * The creator's own file is never read: the body comes from the authored pack
 * matching the source they picked.
 */
export function prepareDemoLecture(kind: DemoCreateKind) {
  const packKeys = DEMO_CREATE_PACKS[kind] ?? DEMO_CREATE_PACKS.record;
  const id = nextDemoId("note");

  return {
    id,
    commit() {
      const current = getCreatorDemoState();

      if (current.details[id]) {
        return id;
      }

      const usedCount = Object.values(current.packByLectureId).filter((key) =>
        packKeys.includes(key),
      ).length;
      const packKey = packKeys[usedCount % packKeys.length];
      const createdAt = new Date().toISOString();

      setState({
        ...current,
        order: [id, ...current.order],
        details: {
          ...current.details,
          [id]: buildDemoLectureDetail({ id, packKey, createdAt }),
        },
        packByLectureId: { ...current.packByLectureId, [id]: packKey },
      });

      return id;
    },
  };
}

export function createDemoLecture(kind: DemoCreateKind) {
  return prepareDemoLecture(kind).commit();
}

export function renameDemoLecture(lectureId: string, title: string) {
  return updateDetail(lectureId, (detail) => ({
    ...detail,
    lecture: { ...detail.lecture, title, updated_at: new Date().toISOString() },
  }));
}

export function deleteDemoLecture(lectureId: string) {
  const current = getCreatorDemoState();

  if (!current.details[lectureId]) {
    return;
  }

  const details = { ...current.details };
  const packByLectureId = { ...current.packByLectureId };
  delete details[lectureId];
  delete packByLectureId[lectureId];

  setState({
    ...current,
    order: current.order.filter((id) => id !== lectureId),
    details,
    packByLectureId,
    folders: current.folders.map((folder) => ({
      ...folder,
      lectureIds: folder.lectureIds.filter((id) => id !== lectureId),
    })),
  });
}

export function setDemoFlashcardProgress(params: {
  flashcardId: string;
  confidenceBucket: FlashcardConfidenceBucket;
}) {
  const current = getCreatorDemoState();
  const lectureId = current.order.find((id) =>
    current.details[id]?.flashcards.some((card) => card.id === params.flashcardId),
  );

  if (!lectureId) {
    return null;
  }

  const reviewedAt = new Date().toISOString();
  let progress: LectureDetail["flashcards"][number]["progress"] = null;

  updateDetail(lectureId, (detail) => ({
    ...detail,
    flashcards: detail.flashcards.map((card) => {
      if (card.id !== params.flashcardId) {
        return card;
      }

      progress = {
        user_id: DEMO_USER_ID,
        flashcard_id: card.id,
        confidence_bucket: params.confidenceBucket,
        review_count: (card.progress?.review_count ?? 0) + 1,
        last_reviewed_at: reviewedAt,
      };

      return { ...card, progress };
    }),
  }));

  return progress;
}

export function saveDemoStudySession(
  lectureId: string,
  payload: Partial<Omit<StudySession, "user_id" | "lecture_id" | "created_at" | "updated_at">>,
) {
  const now = new Date().toISOString();

  return updateDetail(lectureId, (detail) => ({
    ...detail,
    studySession: {
      user_id: DEMO_USER_ID,
      lecture_id: lectureId,
      active_study_view:
        payload.active_study_view ?? detail.studySession?.active_study_view ?? "flashcards",
      flashcard_state: payload.flashcard_state ?? detail.studySession?.flashcard_state ?? null,
      quiz_state: payload.quiz_state ?? detail.studySession?.quiz_state ?? null,
      practice_test_state:
        payload.practice_test_state ?? detail.studySession?.practice_test_state ?? null,
      created_at: detail.studySession?.created_at ?? now,
      updated_at: now,
    },
  }));
}

export function appendDemoChatMessages(lectureId: string, question: string) {
  const pack = getPack(lectureId);
  const detail = getDemoLectureDetail(lectureId);
  const answerIndex = (detail?.chatMessages.filter((message) => message.role === "assistant").length ?? 0) %
    pack.chatAnswers.length;
  const now = new Date().toISOString();

  const userMessage: ChatMessageWithCitations = {
    id: nextDemoId("chat"),
    lecture_id: lectureId,
    user_id: DEMO_USER_ID,
    role: "user",
    content: question,
    citations: [],
    created_at: now,
  };

  const assistantMessage: ChatMessageWithCitations = {
    id: nextDemoId("chat"),
    lecture_id: lectureId,
    user_id: DEMO_USER_ID,
    role: "assistant",
    content: pack.chatAnswers[answerIndex],
    citations: [],
    created_at: new Date(Date.now() + 1).toISOString(),
  };

  updateDetail(lectureId, (current) => ({
    ...current,
    chatMessages: [...current.chatMessages, userMessage, assistantMessage],
  }));

  return assistantMessage;
}

function buildHistorySummary(
  attempts: PracticeTestAttemptWithAnswers[],
): PracticeTestHistorySummary {
  const graded = attempts.filter(
    (attempt) => attempt.status === "graded" && typeof attempt.percentage === "number",
  );

  const scoresByAttempt = graded.map((attempt, index) => ({
    attemptId: attempt.id,
    attemptNumber: index + 1,
    createdAt: attempt.created_at,
    percentage: attempt.percentage ?? 0,
    totalScore: attempt.total_score ?? 0,
    maxScore: attempt.max_score ?? 0,
  }));

  if (scoresByAttempt.length === 0) {
    return {
      attemptCount: 0,
      averagePercentage: null,
      bestPercentage: null,
      lowestPercentage: null,
      latestPercentage: null,
      scoresByAttempt: [],
    };
  }

  const percentages = scoresByAttempt.map((entry) => entry.percentage);

  return {
    attemptCount: scoresByAttempt.length,
    averagePercentage: Number(
      (percentages.reduce((total, value) => total + value, 0) / percentages.length).toFixed(2),
    ),
    bestPercentage: Math.max(...percentages),
    lowestPercentage: Math.min(...percentages),
    latestPercentage: percentages[percentages.length - 1],
    scoresByAttempt,
  };
}

export function startDemoPracticeAttempt(lectureId: string) {
  const detail = getDemoLectureDetail(lectureId);

  if (!detail) {
    return null;
  }

  const attemptId = nextDemoId("attempt");
  const now = new Date().toISOString();
  const questions = detail.practiceTestQuestions;

  const attempt: PracticeTestAttemptWithAnswers = {
    id: attemptId,
    lecture_id: lectureId,
    user_id: DEMO_USER_ID,
    status: "in_progress",
    question_count: questions.length,
    total_score: null,
    max_score: null,
    percentage: null,
    graded_at: null,
    model_metadata: {},
    created_at: now,
    updated_at: now,
    answers: questions.map((question, index) => ({
      id: `${attemptId}-a-${index}`,
      attempt_id: attemptId,
      practice_test_question_id: question.id,
      idx: index,
      question_prompt: question.prompt,
      answer_guide_snapshot: question.answer_guide,
      difficulty_snapshot: question.difficulty,
      source_locator_snapshot: question.source_locator,
      typed_answer: null,
      photo_path: null,
      photo_mime_type: null,
      declared_unknown: false,
      score: null,
      grading_rationale: null,
      strengths: null,
      missing_points: null,
      expected_answer: null,
      grading_confidence: null,
      created_at: now,
      updated_at: now,
      question,
    })),
  };

  updateDetail(lectureId, (current) => ({
    ...current,
    practiceTestAttempts: [...current.practiceTestAttempts, attempt],
  }));

  return attempt;
}

/**
 * Grades a demo attempt from answer length and the authored feedback for that
 * question, so the result screen always shows a believable mix of scores.
 */
export function submitDemoPracticeAttempt(params: {
  lectureId: string;
  attemptId: string;
  answers: Array<{ answerId: string; typedAnswer: string; declaredUnknown: boolean }>;
}) {
  const pack = getPack(params.lectureId);
  const submittedAt = new Date().toISOString();
  const answersById = new Map(params.answers.map((answer) => [answer.answerId, answer]));

  return updateDetail(params.lectureId, (detail) => {
    const attempts = detail.practiceTestAttempts.map((attempt) => {
      if (attempt.id !== params.attemptId) {
        return attempt;
      }

      const gradedAnswers = attempt.answers.map((answer) => {
        const submitted = answersById.get(answer.id);
        const typedAnswer = submitted?.typedAnswer?.trim() ?? "";
        const declaredUnknown = submitted?.declaredUnknown ?? false;
        const authored = pack.practice[answer.idx];

        const score = declaredUnknown
          ? 0
          : typedAnswer.length === 0
            ? 0
            : typedAnswer.length < 30
              ? 2
              : typedAnswer.length < 90
                ? 4
                : 5;

        const rationale = declaredUnknown
          ? "Označil si, da odgovora ne veš. Preberi razlago in poskusi znova."
          : score >= 4
            ? "Odgovor zajame glavno idejo in jo pravilno razloži."
            : score > 0
              ? "Odgovor gre v pravo smer, a je prekratek za polno število točk."
              : "Odgovora ni bilo mogoče oceniti, ker je prazen.";

        return {
          ...answer,
          typed_answer: typedAnswer || null,
          declared_unknown: declaredUnknown,
          score,
          grading_rationale: rationale,
          strengths: score > 0 ? authored?.strengths ?? null : null,
          missing_points: score < 5 ? authored?.missingPoints ?? null : null,
          expected_answer: authored?.expectedAnswer ?? answer.answer_guide_snapshot,
          grading_confidence: "high",
          updated_at: submittedAt,
        };
      });

      const totalScore = gradedAnswers.reduce((total, answer) => total + (answer.score ?? 0), 0);
      const maxScore = gradedAnswers.length * 5;

      return {
        ...attempt,
        status: "graded" as const,
        total_score: totalScore,
        max_score: maxScore,
        percentage: maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0,
        graded_at: submittedAt,
        updated_at: submittedAt,
        answers: gradedAnswers,
      };
    });

    return {
      ...detail,
      practiceTestAttempts: attempts,
      practiceTestHistorySummary: buildHistorySummary(attempts),
    };
  });
}

export function upsertDemoFlashcard(params: {
  lectureId: string;
  flashcardId?: string;
  front: string;
  back: string;
  hint: string | null;
  difficulty: "easy" | "medium" | "hard";
}) {
  const detail = getDemoLectureDetail(params.lectureId);

  if (!detail) {
    return null;
  }

  const now = new Date().toISOString();
  const existing = params.flashcardId
    ? detail.flashcards.find((card) => card.id === params.flashcardId)
    : null;

  const flashcard = existing
    ? {
        ...existing,
        front: params.front,
        back: params.back,
        hint: params.hint,
        difficulty: params.difficulty,
      }
    : {
        id: nextDemoId("fc"),
        lecture_id: params.lectureId,
        idx: detail.flashcards.length,
        front: params.front,
        back: params.back,
        hint: params.hint,
        difficulty: params.difficulty,
        section_id: null,
        source_unit_idx: 0,
        card_kind: "concept",
        concept_key: `custom-${detail.flashcards.length}`,
        source_type: detail.lecture.source_type,
        source_locator: null,
        coverage_rank: detail.flashcards.length,
        created_at: now,
        citations: [],
        progress: null,
      };

  updateDetail(params.lectureId, (current) => ({
    ...current,
    flashcards: existing
      ? current.flashcards.map((card) => (card.id === flashcard.id ? flashcard : card))
      : [...current.flashcards, flashcard],
  }));

  return flashcard;
}

export function deleteDemoFlashcard(lectureId: string, flashcardId: string) {
  updateDetail(lectureId, (detail) => ({
    ...detail,
    flashcards: detail.flashcards.filter((card) => card.id !== flashcardId),
  }));
}

export function upsertDemoQuizQuestion(params: {
  lectureId: string;
  questionId?: string;
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
}) {
  const detail = getDemoLectureDetail(params.lectureId);

  if (!detail) {
    return null;
  }

  const existing = params.questionId
    ? detail.quizQuestions.find((question) => question.id === params.questionId)
    : null;

  const question = existing
    ? {
        ...existing,
        prompt: params.prompt,
        options: params.options,
        correct_option_idx: params.correctOptionIndex,
        explanation: params.explanation,
        difficulty: params.difficulty,
      }
    : {
        id: nextDemoId("quiz"),
        lecture_id: params.lectureId,
        idx: detail.quizQuestions.length,
        prompt: params.prompt,
        options: params.options,
        correct_option_idx: params.correctOptionIndex,
        explanation: params.explanation,
        difficulty: params.difficulty,
        source_locator: null,
        created_at: new Date().toISOString(),
      };

  updateDetail(params.lectureId, (current) => ({
    ...current,
    quizQuestions: existing
      ? current.quizQuestions.map((item) => (item.id === question.id ? question : item))
      : [...current.quizQuestions, question],
  }));

  return question;
}

export function deleteDemoQuizQuestion(lectureId: string, questionId: string) {
  updateDetail(lectureId, (detail) => ({
    ...detail,
    quizQuestions: detail.quizQuestions.filter((question) => question.id !== questionId),
  }));
}

export function saveDemoNoteDoc(lectureId: string, doc: EditableNoteDoc) {
  const detail = updateDetail(lectureId, (current) => ({
    ...current,
    editableNoteDoc: doc,
    editableNoteRevision: current.editableNoteRevision + 1,
    artifact: current.artifact
      ? {
          ...current.artifact,
          editable_notes_updated_at: doc.updatedAt,
        }
      : current.artifact,
  }));

  return detail
    ? { doc: detail.editableNoteDoc as EditableNoteDoc, revision: detail.editableNoteRevision }
    : null;
}

export function addDemoNoteMedia(params: {
  lectureId: string;
  mediaId: string;
  mimeType: string;
  byteSize: number;
  originalFileName: string | null;
  previewUrl: string;
  afterBlockId: string;
}) {
  const now = new Date().toISOString();
  const detail = getDemoLectureDetail(params.lectureId);

  if (!detail) {
    return null;
  }

  const media = {
    id: params.mediaId,
    lecture_id: params.lectureId,
    user_id: DEMO_USER_ID,
    storage_path: `demo/${params.mediaId}`,
    mime_type: params.mimeType,
    byte_size: params.byteSize,
    original_file_name: params.originalFileName,
    created_at: now,
    signedUrl: params.previewUrl,
  };

  const currentDoc = detail.editableNoteDoc;
  const nextDoc: EditableNoteDoc = {
    version: 1,
    baseNotesHash: currentDoc?.baseNotesHash ?? `demo-${params.lectureId}`,
    updatedAt: now,
    annotations: currentDoc?.annotations ?? [],
    mediaBlocks: [
      ...(currentDoc?.mediaBlocks ?? []),
      {
        id: nextDemoId("block"),
        mediaId: params.mediaId,
        afterBlockId: params.afterBlockId,
        widthPercent: 100,
        xPercent: 50,
        createdAt: now,
      },
    ],
  };

  const updated = updateDetail(params.lectureId, (current) => ({
    ...current,
    noteMedia: [...current.noteMedia, media],
    editableNoteDoc: nextDoc,
    editableNoteRevision: current.editableNoteRevision + 1,
  }));

  return updated
    ? { doc: nextDoc, revision: updated.editableNoteRevision, media }
    : null;
}

export function deleteDemoNoteMedia(lectureId: string, mediaId: string) {
  const updated = updateDetail(lectureId, (detail) => {
    const currentDoc = detail.editableNoteDoc;

    return {
      ...detail,
      noteMedia: detail.noteMedia.filter((media) => media.id !== mediaId),
      editableNoteDoc: currentDoc
        ? {
            ...currentDoc,
            updatedAt: new Date().toISOString(),
            mediaBlocks: currentDoc.mediaBlocks.filter((block) => block.mediaId !== mediaId),
          }
        : currentDoc,
      editableNoteRevision: detail.editableNoteRevision + 1,
    };
  });

  return updated
    ? { doc: updated.editableNoteDoc as EditableNoteDoc, revision: updated.editableNoteRevision }
    : null;
}

export function createDemoFolder(name: string) {
  const current = getCreatorDemoState();
  const now = new Date().toISOString();
  const folder: AppLibraryFolder = {
    id: nextDemoId("folder"),
    name,
    lectureIds: [],
    createdAt: now,
    updatedAt: now,
  };

  setState({ ...current, folders: [...current.folders, folder] });
  return folder;
}

export function updateDemoFolder(params: {
  folderId: string;
  name?: string;
  lectureIds?: string[];
}) {
  const current = getCreatorDemoState();
  let updated: AppLibraryFolder | null = null;

  const folders = current.folders.map((folder) => {
    if (folder.id !== params.folderId) {
      return folder;
    }

    updated = {
      ...folder,
      name: params.name ?? folder.name,
      lectureIds: params.lectureIds ?? folder.lectureIds,
      updatedAt: new Date().toISOString(),
    };

    return updated;
  });

  setState({ ...current, folders });
  return updated;
}

export function deleteDemoFolder(folderId: string) {
  const current = getCreatorDemoState();
  setState({
    ...current,
    folders: current.folders.filter((folder) => folder.id !== folderId),
  });
}
