import "server-only";

import path from "node:path";

import { PartMediaResolutionLevel } from "@google/genai";
import JSZip from "jszip";
import sharp from "sharp";

import { generateTextWithGeminiFile } from "@/lib/ai/gemini";
import { MAX_SCAN_IMAGE_BYTES, STORAGE_BUCKET } from "@/lib/constants";
import {
  isDocxDocument,
  isPdfDocument,
  isPptxDocument,
} from "@/lib/document-files";
import { getPdfJs } from "@/lib/manual-lectures";
import { getServerEnv } from "@/lib/server-env";
import { buildLectureNoteMediaStoragePath } from "@/lib/storage";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const MAX_DOCUMENT_IMAGES = 12;
const MAX_IMAGE_DESCRIPTION_COUNT = 8;
const MIN_DOCUMENT_IMAGE_WIDTH = 140;
const MIN_DOCUMENT_IMAGE_HEIGHT = 100;
const MIN_DOCUMENT_IMAGE_AREA = 24_000;
const DOCUMENT_IMAGE_OUTPUT_MIME_TYPE = "image/jpeg";

export type ExtractedDocumentImage = {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  width: number;
  height: number;
  sourcePartLabel: string;
  sourcePageNumber?: number | null;
  contextText?: string | null;
  description?: string | null;
};

export type StoredDocumentNoteImage = {
  mediaId: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  originalFileName: string;
  width: number;
  height: number;
  sourcePartLabel: string;
  sourcePageNumber?: number | null;
  contextText?: string | null;
  description?: string | null;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function parseXmlAttributes(value: string) {
  const attributes = new Map<string, string>();

  for (const match of value.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attributes.set(match[1], decodeXmlText(match[2] ?? ""));
  }

  return attributes;
}

function extractOfficeXmlText(xml: string) {
  const runs = Array.from(xml.matchAll(/<(?:a|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|w):t>/g))
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter(Boolean);

  return normalizeWhitespace(runs.join(" "));
}

function getOfficePartNumber(pathValue: string) {
  return Number.parseInt(pathValue.match(/(\d+)\.xml$/)?.[1] ?? "0", 10);
}

function getSortedZipParts(zip: JSZip, pattern: RegExp) {
  const parts: string[] = [];

  zip.forEach((pathValue, file) => {
    if (!file.dir && pattern.test(pathValue)) {
      parts.push(pathValue);
    }
  });

  return parts.sort((left, right) => getOfficePartNumber(left) - getOfficePartNumber(right));
}

async function parseRelationships(zip: JSZip, relsPath: string, baseDir: string) {
  const relsXml = await zip.file(relsPath)?.async("string");
  const relationships = new Map<string, string>();

  if (!relsXml) {
    return relationships;
  }

  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attributes = parseXmlAttributes(match[1] ?? "");
    const id = attributes.get("Id");
    const target = attributes.get("Target");

    if (!id || !target || target.startsWith("http:") || target.startsWith("https:")) {
      continue;
    }

    relationships.set(id, path.posix.normalize(path.posix.join(baseDir, target)));
  }

  return relationships;
}

function extractEmbeddedRelationshipIds(xml: string) {
  return Array.from(xml.matchAll(/r:embed="([^"]+)"/g)).map((match) => match[1]);
}

function getMimeTypeFromPath(pathValue: string) {
  const extension = pathValue.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }

  if (extension === "png") {
    return "image/png";
  }

  if (extension === "webp") {
    return "image/webp";
  }

  return null;
}

async function normalizeImageForNotes(params: {
  bytes: Buffer;
  sourceName: string;
  sourcePartLabel: string;
  sourcePageNumber?: number | null;
  contextText?: string | null;
}): Promise<ExtractedDocumentImage | null> {
  if (params.bytes.length <= 0 || params.bytes.length > MAX_SCAN_IMAGE_BYTES) {
    return null;
  }

  let pipeline = sharp(params.bytes, { limitInputPixels: 40_000_000 }).rotate();
  const metadata = await pipeline.metadata().catch(() => null);
  const width = metadata?.width ?? 0;
  const height = metadata?.height ?? 0;

  if (
    width < MIN_DOCUMENT_IMAGE_WIDTH ||
    height < MIN_DOCUMENT_IMAGE_HEIGHT ||
    width * height < MIN_DOCUMENT_IMAGE_AREA
  ) {
    return null;
  }

  pipeline = pipeline
    .flatten({ background: "#ffffff" })
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    });

  const output = await pipeline.jpeg({ quality: 86, mozjpeg: true }).toBuffer();

  if (output.length <= 0 || output.length > MAX_SCAN_IMAGE_BYTES) {
    return null;
  }

  return {
    fileName: `${params.sourceName.replace(/\.[^.]+$/i, "")}.jpg`,
    mimeType: DOCUMENT_IMAGE_OUTPUT_MIME_TYPE,
    bytes: output,
    width,
    height,
    sourcePartLabel: params.sourcePartLabel,
    sourcePageNumber: params.sourcePageNumber ?? null,
    contextText: params.contextText ?? null,
  };
}

async function describeDocumentImage(image: ExtractedDocumentImage) {
  const file = new File([new Uint8Array(image.bytes)], image.fileName, { type: image.mimeType });
  const contextHint = image.contextText
    ? `\nNearby document text: ${image.contextText.slice(0, 700)}`
    : "";

  try {
    const env = getServerEnv();
    const description = await generateTextWithGeminiFile({
      instructions: `Decide if this embedded document image is useful for studying the nearby source material. Keep diagrams, charts, process illustrations, network layouts, tables, UI examples, screenshots that teach a concept, and concrete photos that explain the topic. Reject decorative icons, logos, stock filler, watermarks, repeated small symbols, or images that do not add study value.

If useful, return exactly: USEFUL: one short sentence describing the concrete concept or relationship shown.
If not useful, return exactly: NOT_USEFUL: short reason.
Return plain text only.${contextHint}`,
      file,
      model: env.GEMINI_TEXT_MODEL,
      maxOutputTokens: 180,
      maxAttempts: 1,
      mediaResolution: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
    });

    const normalized = normalizeWhitespace(description);

    if (/^not_useful\s*:/i.test(normalized)) {
      return null;
    }

    return normalized.replace(/^useful\s*:\s*/i, "").slice(0, 360);
  } catch (error) {
    console.warn("Document image description failed.", error);
    return undefined;
  }
}

async function extractDocxImages(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("string");
  const relationships = await parseRelationships(zip, "word/_rels/document.xml.rels", "word");
  const images: ExtractedDocumentImage[] = [];

  if (!documentXml) {
    return images;
  }

  for (const paragraphMatch of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    if (images.length >= MAX_DOCUMENT_IMAGES) {
      break;
    }

    const paragraphXml = paragraphMatch[0];
    const contextText = extractOfficeXmlText(paragraphXml);
    const relationshipIds = extractEmbeddedRelationshipIds(paragraphXml);

    for (const relationshipId of relationshipIds) {
      if (images.length >= MAX_DOCUMENT_IMAGES) {
        break;
      }

      const mediaPath = relationships.get(relationshipId);
      const mimeType = mediaPath ? getMimeTypeFromPath(mediaPath) : null;
      const mediaFile = mediaPath ? zip.file(mediaPath) : null;

      if (!mediaPath || !mimeType || !mediaFile) {
        continue;
      }

      const image = await normalizeImageForNotes({
        bytes: Buffer.from(await mediaFile.async("uint8array")),
        sourceName: path.posix.basename(mediaPath),
        sourcePartLabel: "Word document",
        contextText,
      });

      if (image) {
        images.push(image);
      }
    }
  }

  return images;
}

async function extractPptxImages(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slidePaths = getSortedZipParts(zip, /^ppt\/slides\/slide\d+\.xml$/);
  const images: ExtractedDocumentImage[] = [];

  for (const slidePath of slidePaths) {
    if (images.length >= MAX_DOCUMENT_IMAGES) {
      break;
    }

    const slideNumber = getOfficePartNumber(slidePath);
    const slideXml = await zip.file(slidePath)?.async("string");

    if (!slideXml) {
      continue;
    }

    const relationshipPath = `ppt/slides/_rels/${path.posix.basename(slidePath)}.rels`;
    const relationships = await parseRelationships(zip, relationshipPath, "ppt/slides");
    const contextText = extractOfficeXmlText(slideXml);
    const relationshipIds = extractEmbeddedRelationshipIds(slideXml);

    for (const relationshipId of relationshipIds) {
      if (images.length >= MAX_DOCUMENT_IMAGES) {
        break;
      }

      const mediaPath = relationships.get(relationshipId);
      const mimeType = mediaPath ? getMimeTypeFromPath(mediaPath) : null;
      const mediaFile = mediaPath ? zip.file(mediaPath) : null;

      if (!mediaPath || !mimeType || !mediaFile) {
        continue;
      }

      const image = await normalizeImageForNotes({
        bytes: Buffer.from(await mediaFile.async("uint8array")),
        sourceName: path.posix.basename(mediaPath),
        sourcePartLabel: `Slide ${slideNumber}`,
        sourcePageNumber: slideNumber,
        contextText,
      });

      if (image) {
        images.push(image);
      }
    }
  }

  return images;
}

function getPdfObject(store: unknown, name: string) {
  if (!store || typeof store !== "object" || !("get" in store)) {
    return Promise.resolve(null);
  }

  const pdfObjectStore = store as {
    get: (id: string, callback?: (value: unknown) => void) => unknown;
  };

  return new Promise<unknown | null>((resolve) => {
    let settled = false;
    const finish = (value: unknown | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    try {
      const value = pdfObjectStore.get(name, (resolvedValue) => finish(resolvedValue ?? null));

      if (value) {
        finish(value);
      }
    } catch {
      finish(null);
    }

    setTimeout(() => finish(null), 500);
  });
}

async function extractPdfImages(file: File) {
  const images: ExtractedDocumentImage[] = [];
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  try {
    const document = await loadingTask.promise;

    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        if (images.length >= MAX_DOCUMENT_IMAGES) {
          break;
        }

        const page = await document.getPage(pageNumber);

        try {
          const [textContent, operatorList] = await Promise.all([
            page.getTextContent().catch(() => null),
            page.getOperatorList(),
          ]);
          const pageContext =
            textContent?.items
              .flatMap((item) =>
                item && typeof item === "object" && "str" in item && typeof item.str === "string"
                  ? [item.str]
                  : [],
              )
              .join(" ")
              .slice(0, 800) ?? "";
          const pdfOps = pdfjs.OPS as Record<string, number | undefined>;
          const imageOps = new Set(
            [
              pdfOps.paintImageXObject,
              pdfOps.paintJpegXObject,
              pdfOps.paintInlineImageXObject,
              pdfOps.paintXObject,
            ].filter((op): op is number => typeof op === "number"),
          );

          for (let opIndex = 0; opIndex < operatorList.fnArray.length; opIndex += 1) {
            if (images.length >= MAX_DOCUMENT_IMAGES) {
              break;
            }

            if (!imageOps.has(operatorList.fnArray[opIndex])) {
              continue;
            }

            const args = operatorList.argsArray[opIndex] ?? [];
            const candidate =
              typeof args[0] === "string"
                ? ((await getPdfObject(page.objs, args[0])) ??
                  (await getPdfObject(page.commonObjs, args[0])))
                : args[0];

            if (!candidate || typeof candidate !== "object") {
              continue;
            }

            const record = candidate as {
              data?: unknown;
              width?: unknown;
              height?: unknown;
            };
            const width = typeof record.width === "number" ? record.width : 0;
            const height = typeof record.height === "number" ? record.height : 0;
            const data = record.data;

            if (
              !data ||
              width < MIN_DOCUMENT_IMAGE_WIDTH ||
              height < MIN_DOCUMENT_IMAGE_HEIGHT ||
              width * height < MIN_DOCUMENT_IMAGE_AREA
            ) {
              continue;
            }

            const bytes = Buffer.from(data as Uint8Array);
            const pixelCount = width * height;
            const channels =
              bytes.length === pixelCount * 4
                ? 4
                : bytes.length === pixelCount * 3
                  ? 3
                  : bytes.length === pixelCount
                    ? 1
                    : null;

            if (!channels) {
              continue;
            }

            const image = await normalizeImageForNotes({
              bytes: await sharp(bytes, {
                raw: {
                  width,
                  height,
                  channels,
                },
              }).png().toBuffer(),
              sourceName: `pdf-page-${pageNumber}-image-${images.length + 1}.png`,
              sourcePartLabel: `Page ${pageNumber}`,
              sourcePageNumber: pageNumber,
              contextText: normalizeWhitespace(pageContext),
            });

            if (image) {
              images.push(image);
            }
          }
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await document.cleanup();
      await document.destroy();
    }
  } finally {
    await loadingTask.destroy();
  }

  return images;
}

async function addImageDescriptions(images: ExtractedDocumentImage[]) {
  const describedImages: ExtractedDocumentImage[] = [];

  for (const [index, image] of images.entries()) {
    if (index >= MAX_IMAGE_DESCRIPTION_COUNT) {
      describedImages.push(image);
      continue;
    }

    const description = await describeDocumentImage(image);

    if (description === null) {
      const area = image.width * image.height;
      const hasNearbyContext = normalizeWhitespace(image.contextText ?? "").length >= 80;

      if (area < 120_000 && !hasNearbyContext) {
        continue;
      }

      describedImages.push(image);
      continue;
    }

    describedImages.push({
      ...image,
      description: description ?? image.description,
    });
  }

  return describedImages;
}

export async function extractDocumentImages(file: File) {
  let images: ExtractedDocumentImage[] = [];

  try {
    if (isDocxDocument(file)) {
      images = await extractDocxImages(file);
    } else if (isPptxDocument(file)) {
      images = await extractPptxImages(file);
    } else if (isPdfDocument(file)) {
      images = await extractPdfImages(file);
    }
  } catch (error) {
    console.warn("Document image extraction failed.", error);
    images = [];
  }

  return addImageDescriptions(images.slice(0, MAX_DOCUMENT_IMAGES));
}

export async function storeDocumentImagesAsNoteMedia(params: {
  lectureId: string;
  userId: string;
  images: ExtractedDocumentImage[];
}) {
  const service = createSupabaseServiceRoleClient();
  const storedImages: StoredDocumentNoteImage[] = [];

  for (const [index, image] of params.images.entries()) {
    const mediaId = crypto.randomUUID();
    const storagePath = buildLectureNoteMediaStoragePath({
      userId: params.userId,
      lectureId: params.lectureId,
      mediaId,
      mimeType: image.mimeType,
    });
    const originalFileName = `document-image-${String(index + 1).padStart(2, "0")}-${image.fileName}`;

    const uploadResult = await service.storage.from(STORAGE_BUCKET).upload(storagePath, image.bytes, {
      contentType: image.mimeType,
      upsert: true,
    });

    if (uploadResult.error) {
      console.warn("Document image upload failed.", uploadResult.error);
      continue;
    }

    const insertResult = await service
      .from("lecture_note_media")
      .insert({
        id: mediaId,
        lecture_id: params.lectureId,
        user_id: params.userId,
        storage_path: storagePath,
        mime_type: image.mimeType,
        byte_size: image.bytes.length,
        original_file_name: originalFileName,
      } as never);

    if (insertResult.error) {
      console.warn("Document image media row insert failed.", insertResult.error);
      await service.storage.from(STORAGE_BUCKET).remove([storagePath]);
      continue;
    }

    storedImages.push({
      mediaId,
      storagePath,
      mimeType: image.mimeType,
      byteSize: image.bytes.length,
      originalFileName,
      width: image.width,
      height: image.height,
      sourcePartLabel: image.sourcePartLabel,
      sourcePageNumber: image.sourcePageNumber,
      contextText: image.contextText,
      description: image.description,
    });
  }

  return storedImages;
}
