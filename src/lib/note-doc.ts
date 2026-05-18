import type { Json, LectureNoteMediaRow } from "@/lib/database.types";

export const NOTE_DOC_VERSION = 1;

export type NoteAnnotationKind = "highlight" | "underline";

export type NoteAnnotation = {
  id: string;
  kind: NoteAnnotationKind;
  startWordIndex: number;
  endWordIndex: number;
  colorId?: string;
  createdAt: string;
};

export type NoteMediaBlock = {
  id: string;
  mediaId: string;
  afterBlockId: string;
  createdAt: string;
};

export type EditableNoteDoc = {
  version: typeof NOTE_DOC_VERSION;
  baseNotesHash: string;
  updatedAt: string;
  annotations: NoteAnnotation[];
  mediaBlocks: NoteMediaBlock[];
};

export type NoteMediaAsset = LectureNoteMediaRow & {
  signedUrl: string;
};

export function createEmptyNoteDoc(params: {
  baseNotesHash: string;
  updatedAt?: string;
}): EditableNoteDoc {
  return {
    version: NOTE_DOC_VERSION,
    baseNotesHash: params.baseNotesHash,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
    annotations: [],
    mediaBlocks: [],
  };
}

function parseRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseAnnotation(value: unknown): NoteAnnotation | null {
  const record = parseRecord(value);
  const kind = record.kind === "highlight" || record.kind === "underline" ? record.kind : null;

  if (
    typeof record.id !== "string" ||
    !kind ||
    typeof record.startWordIndex !== "number" ||
    typeof record.endWordIndex !== "number" ||
    typeof record.createdAt !== "string" ||
    !Number.isInteger(record.startWordIndex) ||
    !Number.isInteger(record.endWordIndex) ||
    record.startWordIndex < 0 ||
    record.endWordIndex < record.startWordIndex
  ) {
    return null;
  }

  return {
    id: record.id,
    kind,
    startWordIndex: record.startWordIndex,
    endWordIndex: record.endWordIndex,
    colorId: typeof record.colorId === "string" ? record.colorId : undefined,
    createdAt: record.createdAt,
  };
}

function parseMediaBlock(value: unknown): NoteMediaBlock | null {
  const record = parseRecord(value);

  if (
    typeof record.id !== "string" ||
    typeof record.mediaId !== "string" ||
    typeof record.afterBlockId !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    mediaId: record.mediaId,
    afterBlockId: record.afterBlockId,
    createdAt: record.createdAt,
  };
}

export function parseEditableNoteDoc(
  value: Json | null | undefined,
  fallbackBaseNotesHash: string,
): EditableNoteDoc {
  const record = parseRecord(value);
  const baseNotesHash =
    typeof record.baseNotesHash === "string" && record.baseNotesHash
      ? record.baseNotesHash
      : fallbackBaseNotesHash;
  const updatedAt =
    typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString();
  const annotations = Array.isArray(record.annotations)
    ? record.annotations.flatMap((item) => {
        const parsed = parseAnnotation(item);
        return parsed ? [parsed] : [];
      })
    : [];
  const mediaBlocks = Array.isArray(record.mediaBlocks)
    ? record.mediaBlocks.flatMap((item) => {
        const parsed = parseMediaBlock(item);
        return parsed ? [parsed] : [];
      })
    : [];

  return {
    version: NOTE_DOC_VERSION,
    baseNotesHash,
    updatedAt,
    annotations,
    mediaBlocks,
  };
}

export function serializeEditableNoteDoc(doc: EditableNoteDoc): Json {
  return {
    version: NOTE_DOC_VERSION,
    baseNotesHash: doc.baseNotesHash,
    updatedAt: doc.updatedAt,
    annotations: doc.annotations.map((annotation) => ({
      id: annotation.id,
      kind: annotation.kind,
      startWordIndex: annotation.startWordIndex,
      endWordIndex: annotation.endWordIndex,
      colorId: annotation.colorId,
      createdAt: annotation.createdAt,
    })),
    mediaBlocks: doc.mediaBlocks.map((block) => ({
      id: block.id,
      mediaId: block.mediaId,
      afterBlockId: block.afterBlockId,
      createdAt: block.createdAt,
    })),
  };
}
