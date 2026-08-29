import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { GeminiUsageContext } from "@/lib/ai/usage-logging";
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

const imagePlacementSchema = z.object({
  placements: z
    .array(
      z.object({
        /** The [n] label of the image being judged. */
        imageNumber: z.number().int().min(1),
        /** False drops the image from the note entirely. */
        include: z.boolean(),
        /** The [n] label of the note block the image belongs directly under; 0 when include is false. */
        afterBlockNumber: z.number().int().min(0),
      }),
    )
    .max(40),
});

const IMAGE_PLACEMENT_INSTRUCTIONS = `You place figures from a source document into the finished study note built from it, and you throw away the ones that do not belong. You are given the note as a numbered list of blocks, and the candidate images as a numbered list of descriptions with the source text that surrounded them.

For every image decide two things:
- include: only when the image genuinely helps a student learn the material next to it — a diagram, a chart with real data, a labelled figure, a worked example, a table rendered as a picture. Exclude decoration, logos, slide backgrounds, stock photos, portraits without study value, and images whose content the note already fully states in text or a table.
- afterBlockNumber: the block the image belongs DIRECTLY under — the paragraph, list or table that discusses what the image shows. Judge by topic, not by position in the source: the note reorders material. If no block truly discusses it, exclude it rather than parking it somewhere plausible.

Never place more than two images under the same block. Return a judgment for every image.`;

/**
 * The model as the picture editor: it sees the finished note and every candidate image, keeps
 * only the ones that add study value and seats each under the block that actually discusses it.
 * Introduced 2026-08-29 to replace two mechanical behaviours the reader saw as misplacement: a
 * vocabulary-overlap scorer that cannot judge topic, and an evenly-spread fallback that inserted
 * unmatched images regardless of fit. Any failure falls back to exactly that mechanical path —
 * a note must never lose its pictures to a judgment call that errored.
 */
async function judgeImagePlacements(params: {
  images: StoredDocumentNoteImage[];
  blocks: Array<{ id: string; text: string }>;
  usageContext?: GeminiUsageContext;
}) {
  const blockList = params.blocks
    .map((block, index) => `[${index + 1}] ${block.text.slice(0, 220)}`)
    .join("\n");
  const imageList = params.images
    .map((image, index) => {
      const description = (image.description ?? "").slice(0, 300);
      const context = (image.contextText ?? "").slice(0, 300);

      return `[${index + 1}] description: ${description || "(none)"}\n    surrounding source text: ${context || "(none)"}`;
    })
    .join("\n");

  const selection = await generateStructuredObject({
    schema: imagePlacementSchema,
    stage: "chat",
    maxOutputTokens: Math.max(1200, params.images.length * 90),
    instructions: IMAGE_PLACEMENT_INSTRUCTIONS,
    input: `NOTE BLOCKS:\n${blockList}\n\nCANDIDATE IMAGES:\n${imageList}`,
    usageContext: { ...(params.usageContext ?? {}), stage: "image_placement" },
  });

  const placements: Array<{ image: StoredDocumentNoteImage; afterBlockId: string }> = [];
  const blockUsageCount = new Map<string, number>();

  for (const judgment of selection.placements) {
    const image = params.images[judgment.imageNumber - 1];
    const block = params.blocks[judgment.afterBlockNumber - 1];

    if (!image || !judgment.include || !block) {
      continue;
    }

    if (placements.some((placed) => placed.image.mediaId === image.mediaId)) {
      continue;
    }

    const blockUsage = blockUsageCount.get(block.id) ?? 0;

    if (blockUsage >= MAX_DOCUMENT_IMAGES_PER_NOTE_BLOCK) {
      continue;
    }

    blockUsageCount.set(block.id, blockUsage + 1);
    placements.push({ image, afterBlockId: block.id });

    if (placements.length >= MAX_AUTO_INSERTED_DOCUMENT_IMAGES) {
      break;
    }
  }

  return placements;
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
  usageContext?: GeminiUsageContext;
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
  const candidates = documentImages.filter((image) => !existingMediaIds.has(image.mediaId));

  let plannedMediaBlocks: Array<{ image: StoredDocumentNoteImage; afterBlockId: string }> = [];

  if (candidates.length > 0 && openSlots > 0) {
    try {
      plannedMediaBlocks = (
        await judgeImagePlacements({
          images: candidates,
          blocks,
          usageContext: params.usageContext,
        })
      ).slice(0, openSlots);
    } catch (error) {
      console.warn(
        "Image placement judgment failed; falling back to mechanical placement.",
        error instanceof Error ? error.message : error,
      );
      plannedMediaBlocks = planDocumentImageMediaBlocks({
        documentImages,
        blocks,
        existingMediaIds,
        openSlots,
      });
    }
  }

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
