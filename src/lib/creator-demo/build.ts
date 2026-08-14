/**
 * Pure builders that turn a demo content pack into the exact row shapes the
 * real app renders. Safe to run on the server (for the first paint of a
 * `/creator` page) and on the client (for notes "created" during a recording).
 */
import type { Json, LectureRow, TranscriptSegmentRow } from "@/lib/database.types";
import { NOTE_DOC_VERSION, type EditableNoteDoc, type NoteMediaAsset } from "@/lib/note-doc";
import {
  parseNoteTtsDocument,
  stripLeadingRedundantHeading,
  type NoteTtsBlock,
} from "@/lib/note-tts-text";
import type {
  AppLectureListItem,
  AppLibraryFolder,
  LectureDetail,
  PracticeTestHistorySummary,
} from "@/lib/types";
import {
  DEMO_SEED_FOLDERS,
  DEMO_SEED_NOTES,
  getDemoNotePack,
  type DemoNotePack,
} from "@/lib/creator-demo/content";

export const DEMO_USER_ID = "00000000-0000-4000-8000-creatordemo01";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Manual imports keep their real source type in the processing metadata. */
function buildProcessingMetadata(pack: DemoNotePack): Json {
  if (pack.sourceType === "audio") {
    return {};
  }

  return {
    manualImport: {
      sourceType: pack.sourceType,
    },
  };
}

function blockText(block: NoteTtsBlock): string {
  if (block.kind === "list") {
    return block.items.map((item) => item.tokens.map((token) => token.text).join("")).join(" ");
  }

  if (block.kind === "table") {
    return block.rows
      .map((row) => row.cells.map((cell) => cell.tokens.map((token) => token.text).join("")).join(" "))
      .join(" ");
  }

  return block.tokens.map((token) => token.text).join("");
}

/**
 * Figures are anchored to a phrase rather than a block index, so reworded or
 * reordered notes keep their images in the right place — and a stale anchor
 * degrades to "first block" instead of dropping the image.
 */
function resolveImageBlockIds(pack: DemoNotePack) {
  const { blocks } = parseNoteTtsDocument(
    stripLeadingRedundantHeading(pack.notesMd, pack.title),
  );

  return pack.images.map((image) => {
    const match = blocks.find((block) => blockText(block).includes(image.afterText));
    return match?.id ?? blocks[0]?.id ?? "";
  });
}

function buildNoteMedia(params: {
  lectureId: string;
  pack: DemoNotePack;
  createdAt: string;
}): { media: NoteMediaAsset[]; doc: EditableNoteDoc } {
  const { lectureId, pack, createdAt } = params;
  const blockIds = resolveImageBlockIds(pack);

  const media: NoteMediaAsset[] = pack.images.map((image, index) => ({
    id: `${lectureId}-media-${index}`,
    lecture_id: lectureId,
    user_id: DEMO_USER_ID,
    storage_path: `creator-demo/${image.file}`,
    mime_type: "image/svg+xml",
    byte_size: 0,
    original_file_name: image.fileName,
    created_at: createdAt,
    signedUrl: `/creator-demo/${image.file}`,
  }));

  return {
    media,
    doc: {
      version: NOTE_DOC_VERSION,
      baseNotesHash: `demo-${pack.key}`,
      updatedAt: createdAt,
      annotations: [],
      mediaBlocks: pack.images.map((image, index) => ({
        id: `${lectureId}-media-block-${index}`,
        mediaId: media[index].id,
        afterBlockId: blockIds[index],
        widthPercent: image.widthPercent ?? 100,
        xPercent: 50,
        createdAt,
      })),
    },
  };
}

export const EMPTY_PRACTICE_TEST_HISTORY: PracticeTestHistorySummary = {
  attemptCount: 0,
  averagePercentage: null,
  bestPercentage: null,
  lowestPercentage: null,
  latestPercentage: null,
  scoresByAttempt: [],
};

export function buildDemoLectureRow(params: {
  id: string;
  pack: DemoNotePack;
  createdAt: string;
  title?: string;
}): LectureRow {
  return {
    id: params.id,
    user_id: DEMO_USER_ID,
    title: params.title ?? params.pack.title,
    source_type: params.pack.sourceType === "audio" ? "audio" : "text",
    access_tier: "paid",
    storage_path: null,
    processing_metadata: buildProcessingMetadata(params.pack),
    duration_seconds: params.pack.durationSeconds,
    status: "ready",
    language_hint: "sl",
    error_message: null,
    created_at: params.createdAt,
    updated_at: params.createdAt,
  };
}

export function buildDemoLectureDetail(params: {
  id: string;
  packKey: string;
  createdAt: string;
  title?: string;
}): LectureDetail {
  const pack = getDemoNotePack(params.packKey);
  const { id, createdAt } = params;
  const lecture = buildDemoLectureRow({
    id,
    pack,
    createdAt,
    title: params.title,
  });

  const sections = pack.sections.map((section, index) => ({
    id: `${id}-sec-${index}`,
    lecture_id: id,
    idx: index,
    title: section.title,
    source_label: section.sourceLabel,
    source_start_ms: null,
    source_end_ms: null,
    source_page_start: null,
    source_page_end: null,
    unit_start_idx: index,
    unit_end_idx: index,
    card_count: pack.flashcards.filter((card) => card.sectionIdx === index).length,
    created_at: createdAt,
    reviewedCount: 0,
    completed: false,
  }));

  const flashcards = pack.flashcards.map((card, index) => ({
    id: `${id}-fc-${index}`,
    lecture_id: id,
    idx: index,
    front: card.front,
    back: card.back,
    hint: card.hint ?? null,
    difficulty: card.difficulty,
    section_id: sections[card.sectionIdx]?.id ?? null,
    source_unit_idx: card.sectionIdx,
    card_kind: "concept",
    concept_key: `${pack.key}-${index}`,
    source_type: pack.sourceType,
    source_locator: pack.sections[card.sectionIdx]?.sourceLabel ?? null,
    coverage_rank: index,
    created_at: createdAt,
    citations: [],
    progress: null,
  }));

  const quizQuestions = pack.quiz.map((question, index) => ({
    id: `${id}-quiz-${index}`,
    lecture_id: id,
    idx: index,
    prompt: question.prompt,
    options: [...question.options],
    correct_option_idx: question.correctOptionIdx,
    explanation: question.explanation,
    difficulty: question.difficulty,
    source_locator: null,
    created_at: createdAt,
  }));

  const practiceTestQuestions = pack.practice.map((question, index) => ({
    id: `${id}-pt-${index}`,
    lecture_id: id,
    idx: index,
    prompt: question.prompt,
    answer_guide: question.answerGuide,
    difficulty: question.difficulty,
    source_locator: null,
    source_unit_idx: index,
    concept_key: `${pack.key}-pt-${index}`,
    created_at: createdAt,
  }));

  const transcript: TranscriptSegmentRow[] = pack.transcript.map((segment, index) => ({
    id: `${id}-tr-${index}`,
    lecture_id: id,
    idx: index,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    speaker_label: segment.speakerLabel,
    text: segment.text,
    embedding: null,
    created_at: createdAt,
  }));

  const { media: noteMedia, doc: noteDoc } = buildNoteMedia({
    lectureId: id,
    pack,
    createdAt,
  });

  return {
    lecture,
    artifact: {
      lecture_id: id,
      summary: pack.summary,
      key_topics: [...pack.keyTopics],
      structured_notes_md: pack.notesMd,
      editable_notes_doc: noteDoc as unknown as Json,
      editable_notes_md: null,
      editable_notes_plain: null,
      editable_notes_revision: 0,
      editable_notes_updated_at: null,
      model_metadata: {},
      generated_at: createdAt,
    },
    editableNoteDoc: noteDoc,
    editableNoteRevision: 0,
    noteMedia,
    studyAsset: {
      lecture_id: id,
      status: "ready",
      error_message: null,
      model_metadata: {},
      generated_at: createdAt,
      updated_at: createdAt,
    },
    quizAsset: {
      lecture_id: id,
      status: "ready",
      error_message: null,
      model_metadata: {},
      generated_at: createdAt,
      updated_at: createdAt,
    },
    practiceTestAsset: {
      lecture_id: id,
      status: "ready",
      error_message: null,
      model_metadata: {},
      generated_at: createdAt,
      updated_at: createdAt,
    },
    studySession: null,
    studySections: sections,
    flashcards,
    quizQuestions,
    practiceTestQuestions,
    practiceTestAttempts: [],
    practiceTestHistorySummary: EMPTY_PRACTICE_TEST_HISTORY,
    transcript,
    chatMessages: [],
    audioUrl: null,
  };
}

export type DemoSeed = {
  order: string[];
  details: Record<string, LectureDetail>;
  folders: AppLibraryFolder[];
  packByLectureId: Record<string, string>;
};

/**
 * The library every recording starts from. Dates are relative to "now" so the
 * demo never shows a stale-looking list.
 */
export function buildDemoSeed(now = Date.now()): DemoSeed {
  const order: string[] = [];
  const details: Record<string, LectureDetail> = {};
  const packByLectureId: Record<string, string> = {};

  for (const note of DEMO_SEED_NOTES) {
    const createdAt = new Date(now - note.daysAgo * DAY_MS).toISOString();
    order.push(note.id);
    details[note.id] = buildDemoLectureDetail({
      id: note.id,
      packKey: note.packKey,
      createdAt,
    });
    packByLectureId[note.id] = note.packKey;
  }

  const folderCreatedAt = new Date(now - 12 * DAY_MS).toISOString();
  const folders: AppLibraryFolder[] = DEMO_SEED_FOLDERS.map((folder) => ({
    id: folder.id,
    name: folder.name,
    lectureIds: [...folder.noteIds],
    createdAt: folderCreatedAt,
    updatedAt: folderCreatedAt,
  }));

  return { order, details, folders, packByLectureId };
}

/**
 * Builds just the one seeded note, for the note route. Notes created during a
 * recording are unknown to the server and resolve on the client, so there is no
 * reason to build the whole library on every navigation.
 */
export function buildDemoSeedDetail(lectureId: string, now = Date.now()) {
  const note = DEMO_SEED_NOTES.find((entry) => entry.id === lectureId);

  if (!note) {
    return null;
  }

  return buildDemoLectureDetail({
    id: note.id,
    packKey: note.packKey,
    createdAt: new Date(now - note.daysAgo * DAY_MS).toISOString(),
  });
}

export function toLectureListItems(seed: {
  order: string[];
  details: Record<string, LectureDetail>;
}): AppLectureListItem[] {
  return seed.order
    .map((id) => seed.details[id]?.lecture)
    .filter((lecture): lecture is LectureRow => Boolean(lecture));
}
