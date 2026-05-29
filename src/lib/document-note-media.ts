import "server-only";

import type { StoredDocumentNoteImage } from "@/lib/document-image-extraction";
import {
  parseStoredNoteDoc,
  readLectureArtifactForNoteDoc,
  saveEditableNoteDoc,
  MAX_NOTE_MEDIA_BLOCKS,
} from "@/lib/note-doc-server";
import {
  parseNoteTtsDocument,
  type NoteTtsBlock,
  type NoteTtsInlineToken,
} from "@/lib/note-tts-text";

const MAX_AUTO_INSERTED_DOCUMENT_IMAGES = 6;
const MAX_FALLBACK_DOCUMENT_IMAGES = 6;
const DEFAULT_DOCUMENT_IMAGE_WIDTH_PERCENT = 82;
const DEFAULT_DOCUMENT_IMAGE_X_PERCENT = 50;
const MIN_IMAGE_NOTE_RELEVANCE_SCORE = 3;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "they",
  "their",
  "image",
  "document",
  "visual",
  "nearby",
  "related",
  "from",
  "page",
  "slide",
  "source",
  "material",
  "notes",
  "study",
  "stran",
  "slika",
  "dokument",
  "prosojnica",
  "vizual",
  "gradivo",
  "zapiski",
  "študij",
  "studij",
  "povezano",
  "prikazuje",
  "vsebuje",
  "ima",
  "lahko",
  "smo",
  "bomo",
  "in",
  "ali",
  "kot",
  "pri",
  "ter",
  "tudi",
  "kaj",
  "kako",
  "zakaj",
]);

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenText(tokens: NoteTtsInlineToken[]) {
  return tokens.map((token) => token.text).join("");
}

function blockText(block: NoteTtsBlock) {
  if (block.kind === "table") {
    return block.rows
      .flatMap((row) => row.cells.map((cell) => tokenText(cell.tokens)))
      .join(" ");
  }

  if (block.kind === "list") {
    return block.items.map((item) => tokenText(item.tokens)).join(" ");
  }

  return tokenText(block.tokens);
}

function keywords(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .slice(0, 80);
}

function keywordSet(value: string) {
  return new Set(keywords(value));
}

function scoreBlockForImage(params: {
  blockText: string;
  image: StoredDocumentNoteImage;
}) {
  const imageKeywords = keywordSet(
    [
      params.image.description,
      params.image.contextText,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (imageKeywords.size === 0) {
    return 0;
  }

  const text = normalizeText(params.blockText);
  const blockKeywords = keywordSet(params.blockText);
  let score = 0;

  for (const keyword of imageKeywords) {
    if (blockKeywords.has(keyword)) {
      score += keyword.length >= 7 ? 3 : 2;
    } else if (text.includes(keyword)) {
      score += keyword.length >= 7 ? 2 : 1;
    }
  }

  return score;
}

function findImagePlacement(params: {
  image: StoredDocumentNoteImage;
  blocks: Array<{ id: string; text: string }>;
}): { afterBlockId: string; score: number } | null {
  if (params.blocks.length === 0) {
    return null;
  }

  let best = {
    id: params.blocks[Math.min(1, params.blocks.length - 1)].id,
    score: 0,
  };

  for (const block of params.blocks) {
    const score = scoreBlockForImage({
      blockText: block.text,
      image: params.image,
    });

    if (score > best.score) {
      best = { id: block.id, score };
    }
  }

  if (best.score > 0) {
    return {
      afterBlockId: best.id,
      score: best.score,
    };
  }

  return null;
}

function findSourceOrderPlacement(params: {
  imageIndex: number;
  usefulImageCount: number;
  blocks: Array<{ id: string; text: string }>;
}) {
  if (params.blocks.length === 0) {
    return null;
  }

  if (params.usefulImageCount <= 1) {
    return params.blocks[Math.min(1, params.blocks.length - 1)].id;
  }

  const blockIndex = Math.round(
    (params.imageIndex / (params.usefulImageCount - 1)) * (params.blocks.length - 1),
  );

  return params.blocks[Math.max(0, Math.min(params.blocks.length - 1, blockIndex))].id;
}

function isLikelyUsefulStudyImage(image: StoredDocumentNoteImage) {
  const area = image.width * image.height;
  const description = normalizeText(image.description ?? "");
  const context = normalizeText(image.contextText ?? "");

  if (area < 42_000 && context.length > 160) {
    return false;
  }

  if (
    /\b(decorative|logo|icon|stock|watermark|advertisement|screenshot only)\b/.test(description)
  ) {
    return false;
  }

  if (
    /\b(okras|logotip|ikona|vodni znak|oglas)\b/.test(description)
  ) {
    return false;
  }

  return description.length > 0 || context.length > 0;
}

function planDocumentImageMediaBlocks(params: {
  documentImages: StoredDocumentNoteImage[];
  blocks: Array<{ id: string; text: string }>;
  existingMediaIds: Set<string>;
  openSlots: number;
}) {
  const usefulImages = params.documentImages
    .filter((image) => !params.existingMediaIds.has(image.mediaId))
    .filter(isLikelyUsefulStudyImage);
  const ranked = usefulImages
    .flatMap((image, index) => {
      const placement = findImagePlacement({
        image,
        blocks: params.blocks,
      });

      if (!placement || placement.score < MIN_IMAGE_NOTE_RELEVANCE_SCORE) {
        return [];
      }

      return [
        {
          image,
          index,
          fallback: false,
          ...placement,
        },
      ];
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const fallbackRanked = usefulImages.flatMap((image, index) => {
    if (ranked.some((candidate) => candidate.image.mediaId === image.mediaId)) {
      return [];
    }

    const afterBlockId = findSourceOrderPlacement({
      imageIndex: index,
      usefulImageCount: usefulImages.length,
      blocks: params.blocks,
    });

    if (!afterBlockId) {
      return [];
    }

    return [
      {
        image,
        index,
        afterBlockId,
        score: 0,
        fallback: true,
      },
    ];
  });

  const selected: typeof ranked = [];
  const usedBlocks = new Set<string>();
  const usedPages = new Set<number>();
  let fallbackCount = 0;

  for (const candidate of [...ranked, ...fallbackRanked]) {
    if (selected.length >= Math.min(MAX_AUTO_INSERTED_DOCUMENT_IMAGES, params.openSlots)) {
      break;
    }

    if (candidate.fallback && fallbackCount >= MAX_FALLBACK_DOCUMENT_IMAGES) {
      continue;
    }

    const pageNumber = candidate.image.sourcePageNumber;

    if (usedBlocks.has(candidate.afterBlockId)) {
      continue;
    }

    if (typeof pageNumber === "number" && usedPages.has(pageNumber)) {
      continue;
    }

    usedBlocks.add(candidate.afterBlockId);

    if (typeof pageNumber === "number") {
      usedPages.add(pageNumber);
    }

    selected.push(candidate);

    if (candidate.fallback) {
      fallbackCount += 1;
    }
  }

  return selected.sort((left, right) => left.index - right.index);
}

function parseStoredDocumentImages(value: unknown): StoredDocumentNoteImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (
      typeof record.mediaId !== "string" ||
      typeof record.storagePath !== "string" ||
      typeof record.mimeType !== "string" ||
      typeof record.byteSize !== "number" ||
      typeof record.originalFileName !== "string" ||
      typeof record.width !== "number" ||
      typeof record.height !== "number" ||
      typeof record.sourcePartLabel !== "string"
    ) {
      return [];
    }

    return [
      {
        mediaId: record.mediaId,
        storagePath: record.storagePath,
        mimeType: record.mimeType,
        byteSize: record.byteSize,
        originalFileName: record.originalFileName,
        width: record.width,
        height: record.height,
        sourcePartLabel: record.sourcePartLabel,
        sourcePageNumber:
          typeof record.sourcePageNumber === "number" ? record.sourcePageNumber : null,
        contextText: typeof record.contextText === "string" ? record.contextText : null,
        description: typeof record.description === "string" ? record.description : null,
      } satisfies StoredDocumentNoteImage,
    ];
  });
}

export function getStoredDocumentImagesFromMetadata(metadata: Record<string, unknown>) {
  return parseStoredDocumentImages(metadata.documentImages);
}

export async function attachDocumentImagesToNotes(params: {
  lectureId: string;
  structuredNotesMd: string;
  documentImages: StoredDocumentNoteImage[];
}) {
  const documentImages = params.documentImages;

  if (documentImages.length === 0) {
    return;
  }

  const artifact = await readLectureArtifactForNoteDoc(params.lectureId);

  if (!artifact) {
    return;
  }

  const parsedNotes = parseNoteTtsDocument(params.structuredNotesMd);
  const blocks = parsedNotes.blocks.map((block) => ({
    id: block.id,
    text: blockText(block),
  }));

  if (blocks.length === 0) {
    return;
  }

  const storedDoc = parseStoredNoteDoc(artifact);
  const existingMediaIds = new Set(storedDoc.mediaBlocks.map((block) => block.mediaId));
  const openSlots = Math.max(0, MAX_NOTE_MEDIA_BLOCKS - storedDoc.mediaBlocks.length);
  const plannedMediaBlocks = planDocumentImageMediaBlocks({
    documentImages,
    blocks,
    existingMediaIds,
    openSlots,
  });

  if (plannedMediaBlocks.length === 0) {
    return;
  }

  const createdAt = new Date().toISOString();
  const nextDoc = {
    ...storedDoc,
    mediaBlocks: [
      ...storedDoc.mediaBlocks,
      ...plannedMediaBlocks.map((planned) => ({
        id: crypto.randomUUID(),
        mediaId: planned.image.mediaId,
        afterBlockId: planned.afterBlockId,
        widthPercent: DEFAULT_DOCUMENT_IMAGE_WIDTH_PERCENT,
        xPercent: DEFAULT_DOCUMENT_IMAGE_X_PERCENT,
        createdAt,
      })),
    ],
  };

  if (nextDoc.mediaBlocks.length === storedDoc.mediaBlocks.length) {
    return;
  }

  await saveEditableNoteDoc({
    lectureId: params.lectureId,
    expectedRevision: artifact.editable_notes_revision ?? 0,
    doc: nextDoc,
  });
}
