import "server-only";

import type { StoredDocumentNoteImage } from "@/lib/document-image-extraction";
import {
  parseStoredNoteDoc,
  readLectureArtifactForNoteDoc,
  saveEditableNoteDoc,
  MAX_NOTE_MEDIA_BLOCKS,
} from "@/lib/note-doc-server";
import { normalizeText, scoreBlockForImage } from "@/lib/note-image-relevance";
import {
  parseNoteTtsDocument,
  type NoteTtsBlock,
  type NoteTtsInlineToken,
} from "@/lib/note-tts-text";

const MAX_AUTO_INSERTED_DOCUMENT_IMAGES = 6;
const MAX_FALLBACK_DOCUMENT_IMAGES = 6;
const DEFAULT_DOCUMENT_IMAGE_WIDTH_PERCENT = 82;
const DEFAULT_DOCUMENT_IMAGE_X_PERCENT = 50;
const MAX_DOCUMENT_IMAGES_PER_NOTE_BLOCK = 2;
/**
 * Scores are now length-normalised (note-image-relevance.ts), so this is a ratio rather than a
 * hit count: roughly "matched enough of the image's vocabulary to be worth claiming this
 * paragraph". Below it an image takes the evenly-spread fallback instead of a bad guess.
 */
const MIN_IMAGE_NOTE_RELEVANCE_SCORE = 0.9;
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
  const blockUsageCount = new Map<string, number>();
  let fallbackCount = 0;

  for (const candidate of [...ranked, ...fallbackRanked]) {
    if (selected.length >= Math.min(MAX_AUTO_INSERTED_DOCUMENT_IMAGES, params.openSlots)) {
      break;
    }

    if (candidate.fallback && fallbackCount >= MAX_FALLBACK_DOCUMENT_IMAGES) {
      continue;
    }

    const blockUsage = blockUsageCount.get(candidate.afterBlockId) ?? 0;

    if (blockUsage >= MAX_DOCUMENT_IMAGES_PER_NOTE_BLOCK) {
      continue;
    }

    blockUsageCount.set(candidate.afterBlockId, blockUsage + 1);

    selected.push(candidate);

    if (candidate.fallback) {
      fallbackCount += 1;
    }
  }

  return enforceSourceOrder(
    selected.sort((left, right) => left.index - right.index),
    params.blocks,
  );
}


/**
 * Order only arranges the images that relevance could not place. A finished note is a synthesis,
 * not a page-by-page rendering — it may well cover the last slide's idea first — so forcing every
 * image into source order overrides the scorer where it was confident. Measured on a three-page
 * handout, doing that dragged a correctly matched heart diagram up into the mitosis section.
 *
 * Fallback placements carry no topical claim at all, so among those an out-of-order image is
 * simply wrong: they are kept from rising above a scored image that precedes them in the source.
 */
function enforceSourceOrder<T extends { afterBlockId: string; fallback: boolean }>(
  placements: T[],
  blocks: Array<{ id: string }>,
) {
  const blockOrder = new Map(blocks.map((block, index) => [block.id, index]));
  let minimumIndex = -1;

  return placements.map((placement) => {
    const index = blockOrder.get(placement.afterBlockId) ?? -1;

    if (!placement.fallback) {
      // A scored placement is evidence; it sets the floor for later fallbacks and keeps its spot.
      minimumIndex = Math.max(minimumIndex, index);
      return placement;
    }

    if (index >= minimumIndex) {
      minimumIndex = index;
      return placement;
    }

    const corrected = blocks[minimumIndex];

    return corrected ? { ...placement, afterBlockId: corrected.id } : placement;
  });
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
