import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { PartMediaResolutionLevel } from "@google/genai";

import { isWorkAbortedError } from "@/lib/abort-context";
import { resolveMinimalThinkingConfig } from "@/lib/ai/gemini-models";
import JSZip from "jszip";
import mammoth from "mammoth";

import { toUserFacingAiErrorMessage } from "@/lib/ai/errors";
import {
  GeminiEmptyTextOutputError,
  generateTextWithGeminiFile,
} from "@/lib/ai/gemini";
import {
  sanitizeJsonForDatabase,
  stripUnstorableCharacters,
} from "@/lib/database-text";
import {
  isDocxDocument,
  isHtmlDocument,
  isPdfDocument,
  isPlainTextDocument,
  isPptxDocument,
  isRtfDocument,
} from "@/lib/document-files";
import {
  attachDocumentImagesToNotes,
  getStoredDocumentImagesFromMetadata,
} from "@/lib/document-note-media";
import { captureBackgroundError } from "@/lib/monitoring";
import { generateNotesFromTranscript } from "@/lib/note-generation";
import { withNoteEnrichmentStage } from "@/lib/note-enrichment-status";
import {
  NoReadableScanTextError,
  type ScanOcrAttemptDiagnostics,
} from "@/lib/scan-ocr-errors";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  markInitialNoteAudioPreparing,
  prepareInitialNoteTtsChunksSafely,
} from "@/lib/note-tts";
import { type NoteTtsVoice } from "@/lib/note-tts-settings";
import {
  buildSyntheticTranscriptFromTextSource,
  estimateTextSourceDurationSeconds,
  type StructuredSourceBlock,
} from "@/lib/text-source-processing";
import { createEmbeddings as createAiEmbeddings } from "@/lib/ai/embeddings";
import {
  condenseSourceMaterial,
  MAX_RAW_SOURCE_TEXT_CHARS,
  PIPELINE_SOURCE_TEXT_TARGET_CHARS,
} from "@/lib/source-condensation";
import { createAiChunkSelector } from "@/lib/source-condensation-ai";
import {
  isUnsupportedVideoContentType,
  getUnsupportedVideoLinkMessage,
  isReadableLinkContentType,
} from "@/lib/link-source-validation";
import {
  ExpectedLectureInputError,
  isExpectedLectureInputError,
} from "@/lib/lecture-processing-errors";
import {
  describeHostResolutionFailure,
  describeLinkFetchFailure,
} from "@/lib/link-fetch-errors";
import {
  LINK_LOGIN_WALL_CODE,
  LINK_LOGIN_WALL_MESSAGE,
  isLoginWallUrl,
  looksLikeLoginPage,
} from "@/lib/link-login-walls";
import { serializeVector } from "@/lib/utils";

const MAX_LINK_FETCH_REDIRECTS = 3;
/**
 * A ceiling on how much markup we are willing to pull down, not a judgement about the page.
 *
 * The old limit was 1 MB of raw HTML, which rejected ordinary encyclopaedia and documentation
 * pages: their markup runs to several megabytes while the readable article underneath is a few
 * tens of kilobytes, and it gets capped at MAX_LINK_READABLE_TEXT_CHARS regardless. Measuring the
 * markup was measuring the wrong thing.
 */
const MAX_LINK_FETCH_BYTES = 8_000_000;
// A long page is no longer sliced to a fixed excerpt: anything up to the raw compression ceiling
// is kept and the source-condensation pass decides what the pipeline sees. The byte cap above is
// the only remaining bound on the download itself.
const MAX_LINK_READABLE_TEXT_CHARS = MAX_RAW_SOURCE_TEXT_CHARS;
const LINK_FETCH_TIMEOUT_MS = 10_000;
const TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE = 25;
const OCR_PRIMARY_MAX_OUTPUT_TOKENS = 3500;
const OCR_RESCUE_MAX_OUTPUT_TOKENS = 6000;
const PDF_FALLBACK_MAX_OUTPUT_TOKENS = 12000;
const OCR_MIN_ACCEPTED_TEXT_CHARS = 120;
// Thinking suppression is version-specific (3.5+ rejects thinkingBudget with a bare 400), so
// the config is resolved from the model right before each call instead of being a constant.
const OCR_FAILURE_PATTERNS = [
  /\b(can(?:not|'t)\s+(?:read|extract|see)|unable\s+to\s+(?:read|extract|see))\b/i,
  /\b(no|without)\s+(?:readable\s+)?text\b/i,
  /\bimage\s+(?:is\s+)?(?:blank|too\s+blurry|illegible)\b/i,
  /\bnot\s+enough\s+readable\s+text\b/i,
  /\bni\s+(?:berljivega\s+)?besedila\b/i,
  /\bne\s+morem\s+(?:prebrati|razbrati)\b/i,
];

type TranscriptSegmentInsertRow = {
  lecture_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_label: string | null;
  text: string;
  embedding: string | null;
};

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 240);
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim().slice(0, 240);
  }

  return "Unknown OCR error.";
}

export type ImageOcrContext = {
  userId?: string | null;
  lectureId?: string | null;
  imageIndex?: number | null;
};

let pdfJsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null =
  null;

let pdfWorkerPromise: Promise<void> | null = null;

/**
 * Imports a module with Node's own resolver, invisibly to webpack. Bundled by webpack, evaluating
 * pdf.worker.mjs throws "Object.defineProperty called on non-object" (its module wrapper clashes
 * with the interop shim), which killed every server-side PDF extraction in dev. The same modules
 * load cleanly when Node resolves them natively, and outputFileTracingIncludes already ships them
 * unbundled next to the standalone build. The Function constructor keeps the import() out of
 * webpack's static analysis; the specifiers are the two fixed pdfjs paths below, never user input.
 */
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<Record<string, unknown>>;

async function ensurePdfJsNodeRuntime() {
  const pdfGlobal = globalThis as {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
    pdfjsWorker?: {
      WorkerMessageHandler?: {
        setup: (...args: unknown[]) => void;
      };
    };
    self?: unknown;
  };

  pdfGlobal.self ??= globalThis;

  if (!pdfGlobal.DOMMatrix || !pdfGlobal.ImageData || !pdfGlobal.Path2D) {
    const canvas = await import("@napi-rs/canvas");
    pdfGlobal.DOMMatrix ??= canvas.DOMMatrix;
    pdfGlobal.ImageData ??= canvas.ImageData;
    pdfGlobal.Path2D ??= canvas.Path2D;
  }

  if (!pdfGlobal.pdfjsWorker?.WorkerMessageHandler) {
    pdfWorkerPromise ??= nativeImport("pdfjs-dist/legacy/build/pdf.worker.mjs")
      .then((worker) => {
        pdfGlobal.pdfjsWorker = {
          WorkerMessageHandler: (worker as { WorkerMessageHandler: { setup: (...args: unknown[]) => void } })
            .WorkerMessageHandler,
        };
      })
      .catch((error) => {
        pdfWorkerPromise = null;
        throw error;
      });

    await pdfWorkerPromise;
  }
}

export async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = ensurePdfJsNodeRuntime().then(
      () =>
        nativeImport("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<
          typeof import("pdfjs-dist/legacy/build/pdf.mjs")
        >,
    ).catch((error) => {
      pdfJsPromise = null;
      throw error;
    });
  }

  return pdfJsPromise;
}

function isPdfTextItem(
  item: unknown,
): item is {
  str: string;
  hasEOL?: boolean;
} {
  return typeof item === "object" && item !== null && "str" in item;
}

function normalizeWhitespace(value: string) {
  return stripUnstorableCharacters(value)
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOcrPlainText(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  const textMatch = normalized.match(/(?:^|\n)TEXT:\s*\n([\s\S]*)$/i);

  return normalizeWhitespace(textMatch?.[1] ?? normalized.replace(/^TITLE:\s*.+$/im, ""));
}

function hasFailurePhrase(text: string) {
  return OCR_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isAcceptableImageOcrText(text: string) {
  const normalized = normalizeWhitespace(text);

  if (normalized.length < OCR_MIN_ACCEPTED_TEXT_CHARS || hasFailurePhrase(normalized)) {
    return false;
  }

  const compact = normalized.replace(/\s/g, "");

  if (!compact) {
    return false;
  }

  const readableCharacters = Array.from(compact).filter((character) =>
    /[\p{L}\p{N}=+\-*/^.,;:()[\]{}<>%$#@]/u.test(character),
  ).length;

  return readableCharacters / compact.length >= 0.45;
}

function deriveImageTitle(file: File, text: string) {
  const filenameTitle = file.name.replace(/\.[^.]+$/i, "").trim();
  const firstHeading = normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.replace(/^[-*#\d.)\s]+/, "").trim())
    .find(
      (line) =>
        line.length >= 4 &&
        line.length <= 80 &&
        /\p{L}/u.test(line) &&
        !hasFailurePhrase(line),
    );

  return firstHeading || filenameTitle || "Image";
}

function buildImageOcrUsageContext(params: {
  context?: ImageOcrContext;
  stage: string;
  file: File;
}) {
  return {
    stage: params.stage,
    userId: params.context?.userId ?? null,
    lectureId: params.context?.lectureId ?? null,
    metadata: {
      imageIndex: params.context?.imageIndex ?? null,
      lectureId: params.context?.lectureId ?? null,
      fileMimeType: params.file.type || "application/octet-stream",
      fileSize: params.file.size,
    },
  };
}

function buildScanOcrImageDiagnostics(params: {
  attempts: ScanOcrAttemptDiagnostics[];
  context?: ImageOcrContext;
  file: File;
}) {
  return {
    attempts: params.attempts,
    fileName: params.file.name,
    imageIndex: params.context?.imageIndex ?? null,
    mimeType: params.file.type || "application/octet-stream",
    sizeBytes: params.file.size,
  };
}

function buildNoReadableImageTextError(params: {
  attempts: ScanOcrAttemptDiagnostics[];
  context?: ImageOcrContext;
  file: File;
}) {
  return new NoReadableScanTextError({
    imageCount: 1,
    images: [
      buildScanOcrImageDiagnostics({
        attempts: params.attempts,
        context: params.context,
        file: params.file,
      }),
    ],
    readableImageCount: 0,
    skippedImageCount: 1,
  });
}

async function insertTranscriptSegmentsInBatches(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  transcriptRows: TranscriptSegmentInsertRow[],
) {
  for (
    let start = 0;
    start < transcriptRows.length;
    start += TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE
  ) {
    const batch = transcriptRows.slice(start, start + TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE);
    const { error } = await supabase.from("transcript_segments").insert(batch as never);

    if (error) {
      throw error;
    }
  }
}

function rtfToText(rtf: string) {
  return normalizeWhitespace(
    rtf
      .replace(/\\'[0-9a-fA-F]{2}/g, " ")
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\tab/g, " ")
      .replace(/\\[a-z]+-?\d* ?/gi, " ")
      .replace(/[{}]/g, " ")
      .replace(/\s+/g, " "),
  );
}

function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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

function extractPptxXmlText(xml: string) {
  const textRuns = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter(Boolean);

  return normalizeWhitespace(textRuns.join(" "));
}

function getPptxPartNumber(path: string) {
  return Number.parseInt(path.match(/(\d+)\.xml$/)?.[1] ?? "0", 10);
}

function getSortedPptxParts(zip: JSZip, pattern: RegExp) {
  const parts: string[] = [];

  zip.forEach((path, file) => {
    if (!file.dir && pattern.test(path)) {
      parts.push(path);
    }
  });

  return parts.sort((left, right) => getPptxPartNumber(left) - getPptxPartNumber(right));
}

function countWords(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function shouldUsePptxVisualExtraction(params: {
  slideCount: number;
  mediaCount: number;
  slides: Array<{ text: string }>;
}) {
  if (params.slideCount === 0 || params.mediaCount === 0) {
    return false;
  }

  const totalWords = params.slides.reduce((sum, slide) => sum + countWords(slide.text), 0);
  const averageWordsPerSlide = totalWords / Math.max(params.slideCount, 1);
  const weakSlideCount = params.slides.filter((slide) => countWords(slide.text) < 18).length;
  const weakSlideRatio = weakSlideCount / Math.max(params.slideCount, 1);

  return (
    totalWords < 120 ||
    averageWordsPerSlide < 30 ||
    weakSlideRatio >= 0.35 ||
    params.mediaCount >= Math.ceil(params.slideCount / 2)
  );
}

function mergePptxVisualSlides(params: {
  extractedSlides: Array<{ pageNumber: number; text: string }>;
  visualSlides: Array<{ slideNumber: number; text: string }>;
}) {
  const extractedBySlide = new Map(
    params.extractedSlides.map((slide) => [slide.pageNumber, slide.text]),
  );
  const visualBySlide = new Map(
    params.visualSlides.map((slide) => [slide.slideNumber, normalizeWhitespace(slide.text)]),
  );
  const slideNumbers = Array.from(
    new Set([...extractedBySlide.keys(), ...visualBySlide.keys()]),
  ).sort((left, right) => left - right);

  return slideNumbers.flatMap((slideNumber) => {
    const extractedText = extractedBySlide.get(slideNumber) ?? "";
    const visualText = visualBySlide.get(slideNumber) ?? "";
    const text = extractedText
      ? [extractedText, visualText ? `Visual context: ${visualText}` : ""]
          .filter(Boolean)
          .join("\n")
      : visualText;
    const normalized = normalizeWhitespace(text);

    return normalized
      ? [
          {
            pageNumber: slideNumber,
            text: normalized,
          },
        ]
      : [];
  });
}

// Gemini's file API refuses the PPTX MIME type outright ("Unsupported MIME type",
// INVALID_ARGUMENT), so uploading the deck itself never worked — every visual pass fell back to
// editable text and an image-only deck died as "source too short". The slide images inside the
// zip ARE accepted, so the visual pass reads those instead, one call per image, mapped back to
// slides through each slide's relationship part.
const PPTX_IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
/** Icons and bullets are smaller than this; slide screenshots and figures are bigger. */
const MIN_PPTX_VISION_IMAGE_BYTES = 8 * 1024;
/**
 * Memory ceilings for the decompression pass. The 4 MB upload cap bounds the *zip*, not what it
 * inflates to — flat bitmap data deflates 100-1000x, so a hostile or merely screenshot-heavy
 * deck could otherwise expand to hundreds of megabytes of simultaneous Uint8Arrays inside an
 * invocation that also holds the zip tree and the extracted text.
 */
const MAX_PPTX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PPTX_VISION_TOTAL_BYTES = 64 * 1024 * 1024;
/** Cost ceiling: one cheap vision call per image, never more than this many per deck. */
const MAX_PPTX_VISION_IMAGES = 24;
const PPTX_VISION_IMAGE_MAX_OUTPUT_TOKENS = 2000;
const PPTX_VISION_CONCURRENCY = 3;
const PPTX_VISION_NO_CONTENT_MARKER = "NO_STUDY_CONTENT";

async function extractVisualTextFromPptxSlideImages(
  zip: JSZip,
  slidePaths: string[],
): Promise<Array<{ slideNumber: number; text: string }>> {
  const env = getServerEnv();
  const candidates: Array<{ slideNumber: number; mediaPath: string; bytes: Uint8Array }> = [];
  // Deduped across the whole deck, not per slide: a template background referenced by every
  // slide would otherwise be inflated once per slide, held in N copies, and — being each slide's
  // largest image — fill all vision slots with the same decorative picture.
  const seenMediaPaths = new Set<string>();
  let inflatedBytes = 0;

  for (const slidePath of slidePaths) {
    const slideNumber = getPptxPartNumber(slidePath);
    const relsPath = slidePath.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const relsXml = await zip.file(relsPath)?.async("string");

    if (!relsXml) {
      continue;
    }

    const mediaPaths = Array.from(relsXml.matchAll(/Target="\.\.\/(media\/[^"]+)"/g), (match) =>
      `ppt/${match[1]}`,
    );

    for (const mediaPath of new Set(mediaPaths)) {
      if (seenMediaPaths.has(mediaPath)) {
        continue;
      }

      seenMediaPaths.add(mediaPath);

      const extension = mediaPath.split(".").pop()?.toLowerCase() ?? "";

      if (!PPTX_IMAGE_MIME_BY_EXTENSION[extension]) {
        continue;
      }

      if (inflatedBytes >= MAX_PPTX_VISION_TOTAL_BYTES) {
        continue;
      }

      const bytes = await zip.file(mediaPath)?.async("uint8array");

      if (
        bytes &&
        bytes.byteLength >= MIN_PPTX_VISION_IMAGE_BYTES &&
        bytes.byteLength <= MAX_PPTX_VISION_IMAGE_BYTES
      ) {
        inflatedBytes += bytes.byteLength;
        candidates.push({ slideNumber, mediaPath, bytes });
      }
    }
  }

  // Round-robin by per-slide size rank: every slide gets its largest image looked at before any
  // slide gets a second one, so the cap cannot starve the tail of a long deck.
  const bySlide = new Map<number, typeof candidates>();

  for (const candidate of candidates) {
    const list = bySlide.get(candidate.slideNumber) ?? [];
    list.push(candidate);
    bySlide.set(candidate.slideNumber, list);
  }

  for (const list of bySlide.values()) {
    list.sort((left, right) => right.bytes.byteLength - left.bytes.byteLength);
  }

  const selected: typeof candidates = [];

  for (let rank = 0; selected.length < MAX_PPTX_VISION_IMAGES; rank += 1) {
    const atRank = Array.from(bySlide.values(), (list) => list[rank]).filter(Boolean);

    if (atRank.length === 0) {
      break;
    }

    selected.push(...atRank.slice(0, MAX_PPTX_VISION_IMAGES - selected.length));
  }

  const instructions = `This image is embedded in a lecture slide. Extract its full study-relevant content: transcribe visible text, labels, captions and table contents exactly, and describe diagram relationships, arrows, sequences and comparisons concisely. Preserve the source language; do not translate or summarize away detail. Return only the extracted content as plain text. If the image is purely decorative with no study-relevant content, return exactly: ${PPTX_VISION_NO_CONTENT_MARKER}`;

  const results = new Array<{ slideNumber: number; text: string } | null>(selected.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(PPTX_VISION_CONCURRENCY, selected.length) },
    async () => {
      while (cursor < selected.length) {
        const index = cursor;
        cursor += 1;
        const candidate = selected[index];
        const extension = candidate.mediaPath.split(".").pop()?.toLowerCase() ?? "png";

        try {
          const text = await generateTextWithGeminiFile({
            instructions,
            file: new File([Buffer.from(candidate.bytes)], candidate.mediaPath.split("/").pop() ?? "slide-image", {
              type: PPTX_IMAGE_MIME_BY_EXTENSION[extension],
            }),
            model: env.GEMINI_OCR_MODEL,
            maxOutputTokens: PPTX_VISION_IMAGE_MAX_OUTPUT_TOKENS,
            maxAttempts: 1,
            thinkingConfig: resolveMinimalThinkingConfig(env.GEMINI_OCR_MODEL),
            mediaResolution: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
            // Up to 24 vision calls per deck; without a stage they land as anonymous
            // gemini_text_file rows and the meter cannot name one of the larger intake costs.
            usageContext: { stage: "pptx_vision" },
          });
          const cleaned = normalizeWhitespace(text);

          results[index] =
            cleaned && !cleaned.includes(PPTX_VISION_NO_CONTENT_MARKER)
              ? { slideNumber: candidate.slideNumber, text: cleaned }
              : null;
        } catch (error) {
          // One unreadable image must not sink the deck; the merge simply sees less.
          results[index] = null;
          captureBackgroundError(error, {
            operation: "pptx_slide_image_extraction",
            extra: { mediaPath: candidate.mediaPath, byteLength: candidate.bytes.byteLength },
          });
        }
      }
    },
  );

  await Promise.all(workers);

  const textsBySlide = new Map<number, string[]>();

  for (const result of results) {
    if (result) {
      const list = textsBySlide.get(result.slideNumber) ?? [];
      list.push(result.text);
      textsBySlide.set(result.slideNumber, list);
    }
  }

  return Array.from(textsBySlide.entries(), ([slideNumber, texts]) => ({
    slideNumber,
    text: texts.join("\n"),
  }));
}

async function extractTextFromPptx(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slidePaths = getSortedPptxParts(zip, /^ppt\/slides\/slide\d+\.xml$/);
  const notePaths = getSortedPptxParts(zip, /^ppt\/notesSlides\/notesSlide\d+\.xml$/);
  const mediaPaths = getSortedPptxParts(zip, /^ppt\/media\/.+/);
  const notesBySlideNumber = new Map<number, string>();

  await Promise.all(
    notePaths.map(async (path) => {
      const noteXml = await zip.file(path)?.async("string");
      const noteText = noteXml ? extractPptxXmlText(noteXml) : "";

      if (noteText) {
        notesBySlideNumber.set(getPptxPartNumber(path), noteText);
      }
    }),
  );

  const slides = (
    await Promise.all(
      slidePaths.map(async (path) => {
        const slideNumber = getPptxPartNumber(path);
        const slideXml = await zip.file(path)?.async("string");
        const slideText = slideXml ? extractPptxXmlText(slideXml) : "";
        const noteText = notesBySlideNumber.get(slideNumber);
        const text = [slideText, noteText ? `Speaker notes: ${noteText}` : ""]
          .filter(Boolean)
          .join("\n");

        return {
          pageNumber: slideNumber,
          text: normalizeWhitespace(text),
        };
      }),
    )
  ).filter((slide) => slide.text.length > 0);
  const slideCount = slidePaths.length;
  const shouldUseVisualExtraction = shouldUsePptxVisualExtraction({
    slideCount,
    mediaCount: mediaPaths.length,
    slides,
  });
  let mergedSlides = slides;

  if (shouldUseVisualExtraction) {
    try {
      const visualSlides = await extractVisualTextFromPptxSlideImages(zip, slidePaths);
      mergedSlides = mergePptxVisualSlides({
        extractedSlides: slides,
        visualSlides,
      });
    } catch (error) {
      console.warn("PPTX visual extraction failed; using editable slide text only.", error);
      captureBackgroundError(error, {
        operation: "pptx_visual_extraction",
        extra: { slideCount, mediaCount: mediaPaths.length, fileSize: file.size },
      });
    }
  }

  const text = normalizeWhitespace(
    mergedSlides
      .map((slide) => `Slide ${slide.pageNumber}\n${slide.text}`)
      .join("\n\n"),
  );
  const title =
    mergedSlides[0]?.text
      .split(/[.!?\n]/)
      .map((line) => line.trim())
      .find((line) => line.length >= 4 && line.length <= 120) ||
    file.name.replace(/\.pptx$/i, "") ||
    "PowerPoint presentation";

  return {
    title,
    text,
    pages: mergedSlides,
  };
}

async function createEmbeddings(texts: string[]) {
  return createAiEmbeddings(texts);
}

function extractTitle(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function extractMetaDescription(html: string) {
  const metaMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  return metaMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, codepoint: string) => {
      const value = Number(codepoint);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => {
      const value = Number.parseInt(codepoint, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    });
}

function extractPageMainHtml(html: string) {
  const wikipediaContentStart = html.search(/<div\b[^>]+id=["']mw-content-text["'][^>]*>/i);

  if (wikipediaContentStart >= 0) {
    const rest = html.slice(wikipediaContentStart);
    const endCandidates = [
      rest.search(/<div\b[^>]+id=["']catlinks["'][^>]*>/i),
      rest.search(/<div\b[^>]+class=["'][^"']*\bprintfooter\b[^"']*["'][^>]*>/i),
      rest.search(/<footer\b/i),
    ].filter((index) => index > 0);
    const end = endCandidates.length > 0 ? Math.min(...endCandidates) : rest.length;

    return rest.slice(0, end);
  }

  const articleMatch = html.match(/<article\b[\s\S]*?<\/article>/i);

  if (articleMatch?.[0]) {
    return articleMatch[0];
  }

  const mainMatch = html.match(/<main\b[\s\S]*?<\/main>/i);

  if (mainMatch?.[0]) {
    return mainMatch[0];
  }

  const roleMainMatch = html.match(/<[^>]+\brole=["']main["'][^>]*>[\s\S]*?<\/[^>]+>/i);

  return roleMainMatch?.[0] ?? html;
}

function stripNoisyHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<button[\s\S]*?<\/button>/gi, " ")
    .replace(/<select[\s\S]*?<\/select>/gi, " ")
    .replace(
      /<table\b[^>]*(?:class|id)=["'][^"']*(?:infobox|navbox|metadata|sidebar|ambox|vertical-navbox)[^"']*["'][\s\S]*?<\/table>/gi,
      " ",
    )
    .replace(
      /<(?:div|section|ul|ol)\b[^>]*(?:class|id)=["'][^"']*(?:toc|reference|references|reflist|mw-editsection|mw-empty-elt|noprint|hatnote|portal|printfooter|catlinks|vector-page-toolbar)[^"']*["'][\s\S]*?<\/(?:div|section|ul|ol)>/gi,
      " ",
    )
    .replace(/<sup\b[^>]*(?:class|id)=["'][^"']*(?:reference|mw-ref)[^"']*["'][\s\S]*?<\/sup>/gi, " ");
}

function isNoisyReadableLine(line: string) {
  const normalized = line.trim();
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return true;
  }

  if (/^\[\s*\d+\s*\]$/.test(normalized) || /^\d+$/.test(normalized)) {
    return true;
  }

  if (/^\{\{[^}]+}}$/.test(normalized)) {
    return true;
  }

  return [
    "pojdi na vsebino",
    "glavni meni",
    "navigacija",
    "iskanje",
    "išči",
    "videz",
    "ustvari račun",
    "prijava",
    "osebna orodja",
    "orodja",
    "dejanja",
    "splošno",
    "tiskanje/izvoz",
    "v drugih projektih",
    "uredi povezave",
    "preberi",
    "uredi stran",
    "uredi kodo",
    "zgodovina",
    "vklopi kazalo vsebine",
    "iz wikipedije, proste enciklopedije",
  ].includes(lower);
}

function cleanReadableWebpageText(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isNoisyReadableLine(line));
  const cleanedLines: string[] = [];

  for (const line of lines) {
    if (line === cleanedLines[cleanedLines.length - 1]) {
      continue;
    }

    cleanedLines.push(line);
  }

  return normalizeWhitespace(cleanedLines.join("\n\n"));
}

function htmlToText(html: string) {
  return normalizeWhitespace(
    stripNoisyHtml(extractPageMainHtml(html))
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " "),
  );
}

function parseIpv4Address(value: string) {
  const octets = value.split(".").map((part) => Number(part));

  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return octets.reduce((accumulator, octet) => (accumulator << 8) + octet, 0) >>> 0;
}

function isIpv4InCidr(value: number, base: string, bits: number) {
  const baseAddress = parseIpv4Address(base);

  if (baseAddress == null) {
    return true;
  }

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;

  return (value & mask) === (baseAddress & mask);
}

function isDisallowedIpv4Address(value: string) {
  const address = parseIpv4Address(value);

  if (address == null) {
    return true;
  }

  const disallowedRanges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return disallowedRanges.some(([base, bits]) => isIpv4InCidr(address, base, bits));
}

function expandIpv6(value: string) {
  if (!value.includes("::")) {
    return value.split(":");
  }

  const [left, right] = value.split("::");
  const leftParts = left.length > 0 ? left.split(":") : [];
  const rightParts = right.length > 0 ? right.split(":") : [];
  const missingGroups = 8 - (leftParts.length + rightParts.length);

  return [
    ...leftParts,
    ...Array.from({ length: Math.max(missingGroups, 0) }, () => "0"),
    ...rightParts,
  ];
}

function isDisallowedIpv6Address(value: string) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized.includes(".")) {
    if (!normalized.startsWith("::ffff:")) {
      return true;
    }

    const mappedIpv4 = normalized.split(":").pop();
    return !mappedIpv4 || isDisallowedIpv4Address(mappedIpv4);
  }

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const groups = expandIpv6(normalized).map((part) => part.padStart(4, "0"));
  const firstGroup = Number.parseInt(groups[0] ?? "0", 16);
  const secondGroup = Number.parseInt(groups[1] ?? "0", 16);

  if (!Number.isFinite(firstGroup) || !Number.isFinite(secondGroup)) {
    return true;
  }

  const isIpv4Mapped =
    groups.slice(0, 5).every((part) => part === "0000") && groups[5] === "ffff";

  if (isIpv4Mapped) {
    const high = Number.parseInt(groups[6] ?? "0", 16);
    const low = Number.parseInt(groups[7] ?? "0", 16);

    if (!Number.isFinite(high) || !Number.isFinite(low)) {
      return true;
    }

    return isDisallowedIpv4Address(
      `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`,
    );
  }

  if ((firstGroup & 0xe000) !== 0x2000) {
    return true;
  }

  return (
    (firstGroup === 0x2001 && (secondGroup & 0xfe00) === 0x0000) ||
    (firstGroup === 0x2001 && secondGroup === 0x0db8) ||
    firstGroup === 0x2002
  );
}

function isDisallowedIpAddress(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);

  if (version === 4) {
    return isDisallowedIpv4Address(normalized);
  }

  if (version === 6) {
    return isDisallowedIpv6Address(normalized);
  }

  return true;
}

// The guard runs before the fetch, so a resolver rejection here never reaches the
// classifier in `fetchReadableWebpageResponse` and would otherwise page us as an
// unexpected error for what is only an unresolvable hostname in the user's link.
async function resolveHostAddresses(hostname: string) {
  try {
    return await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const resolutionFailure = describeHostResolutionFailure(error);

    if (resolutionFailure) {
      throw new ExpectedLectureInputError(
        resolutionFailure.message,
        resolutionFailure.code,
      );
    }

    throw error;
  }
}

async function assertPublicHostname(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname.endsWith(".local")
  ) {
    throw new ExpectedLectureInputError(
      "Private network addresses are not allowed.",
      "private_network_link",
    );
  }

  if (isIP(normalizedHostname) !== 0) {
    if (isDisallowedIpAddress(normalizedHostname)) {
      throw new ExpectedLectureInputError(
        "Private network addresses are not allowed.",
        "private_network_link",
      );
    }

    return;
  }

  const addresses = await resolveHostAddresses(normalizedHostname);

  if (
    addresses.length === 0 ||
    addresses.some((entry) => isDisallowedIpAddress(entry.address))
  ) {
    throw new ExpectedLectureInputError(
      "Private network addresses are not allowed.",
      "private_network_link",
    );
  }
}

function resolveRedirectUrl(baseUrl: URL, location: string) {
  try {
    return new URL(location, baseUrl);
  } catch {
    throw new ExpectedLectureInputError(
      "The link returned an invalid redirect.",
      "invalid_link_redirect",
    );
  }
}

/**
 * Reads at most maxBytes of the response and returns what it got.
 *
 * A page bigger than the ceiling is truncated rather than refused: the readable-text extractor
 * copes with a partial document, article text sits near the top of the markup, and the extracted
 * text is capped anyway. Refusing outright turned "this page is long" into "we cannot read this
 * page", which is a worse answer and, for a learner pasting a Wikipedia link, a wrong one.
 */
async function readResponseBodyWithLimit(response: Response, maxBytes: number) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      body += decoder.decode(value, { stream: true });

      if (totalBytes >= maxBytes) {
        await reader.cancel();
        break;
      }
    }

    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return body;
}

async function fetchReadableWebpageResponse(
  targetUrl: URL,
  redirectCount = 0,
  sawLoginWall = false,
): Promise<{
  url: URL;
  response: Response;
  sawLoginWall: boolean;
}> {
  if (redirectCount > MAX_LINK_FETCH_REDIRECTS) {
    throw new ExpectedLectureInputError(
      "Too many redirects. Use the final page URL directly.",
      "too_many_link_redirects",
    );
  }

  await assertPublicHostname(targetUrl.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MemoAI/1.0; +https://memoai.eu)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        throw new ExpectedLectureInputError(
          "The link returned an invalid redirect.",
          "invalid_link_redirect",
        );
      }

      const nextUrl = resolveRedirectUrl(targetUrl, location);

      if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
        throw new ExpectedLectureInputError(
          "Only http and https links are supported.",
          "unsupported_link_protocol",
        );
      }

      // Note where the chain went, but keep following it. A sign-in wall only ever
      // rewords a failure further down; deciding here would let a false positive turn a
      // page we can actually read into an error.
      return fetchReadableWebpageResponse(
        nextUrl,
        redirectCount + 1,
        sawLoginWall || isLoginWallUrl(nextUrl),
      );
    }

    return {
      url: targetUrl,
      response,
      sawLoginWall,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ExpectedLectureInputError(
        "The link took too long to respond.",
        "link_timeout",
      );
    }

    if (!isExpectedLectureInputError(error)) {
      const fetchFailure = describeLinkFetchFailure(error);

      if (fetchFailure) {
        throw new ExpectedLectureInputError(fetchFailure.message, fetchFailure.code);
      }
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchReadableWebpage(params: { url: string }) {
  const targetUrl = new URL(params.url);
  const { url, response, sawLoginWall } = await fetchReadableWebpageResponse(targetUrl);
  // The URL the learner pasted can be the sign-in endpoint itself, with no redirect to
  // give it away, so weigh that in alongside where the redirects led.
  const behindLogin = sawLoginWall || isLoginWallUrl(url);

  if (!response.ok) {
    if (behindLogin || response.status === 401 || response.status === 403) {
      throw new ExpectedLectureInputError(LINK_LOGIN_WALL_MESSAGE, LINK_LOGIN_WALL_CODE);
    }

    throw new ExpectedLectureInputError(
      "The link could not be loaded.",
      "link_not_loadable",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (isUnsupportedVideoContentType(contentType)) {
    throw new ExpectedLectureInputError(
      getUnsupportedVideoLinkMessage(),
      "unsupported_video_link",
    );
  }

  if (!isReadableLinkContentType(contentType)) {
    throw new ExpectedLectureInputError(
      "Only standard web pages are supported for link summaries.",
      "unsupported_link_content_type",
    );
  }

  const html = await readResponseBodyWithLimit(response, MAX_LINK_FETCH_BYTES);
  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const text = cleanReadableWebpageText(decodeBasicHtmlEntities(htmlToText(html)));
  const composed = normalizeWhitespace(
    [title, description, text].filter(Boolean).join("\n\n"),
  );

  if (composed.length < 200) {
    // A sign-in form reliably lands here rather than in the `!response.ok` branch above:
    // the site serves it as a perfectly healthy 200, and it reads as thin only because
    // `stripNoisyHtml` drops the `<form>` that holds all of its text. Say what actually
    // blocked us, so the learner is pointed at signing in rather than at retry.
    if (behindLogin || looksLikeLoginPage(html)) {
      throw new ExpectedLectureInputError(LINK_LOGIN_WALL_MESSAGE, LINK_LOGIN_WALL_CODE);
    }

    throw new ExpectedLectureInputError(
      "This page does not contain enough readable text to summarize.",
      "link_not_enough_text",
    );
  }

  return {
    finalUrl: url.toString(),
    html,
    title,
    text: composed.slice(0, MAX_LINK_READABLE_TEXT_CHARS),
  };
}

export async function extractTextFromPdf(file: File) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: fileBytes,
      useWorkerFetch: false,
      useWasm: false,
      isEvalSupported: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });

    try {
      const document = await loadingTask.promise;

      try {
        const [metadata, pageTexts] = await Promise.all([
          document.getMetadata().catch(() => null),
          Promise.all(
            Array.from({ length: document.numPages }, async (_, pageIndex) => {
              const page = await document.getPage(pageIndex + 1);

              try {
                const textContent = await page.getTextContent();
                const pageText = textContent.items.reduce<string[]>(
                  (accumulator, item) => {
                    if (!isPdfTextItem(item)) {
                      return accumulator;
                    }

                    const value = item.str.trim();

                    if (!value) {
                      return accumulator;
                    }

                    accumulator.push(item.hasEOL ? `${value}\n` : value);

                    return accumulator;
                  },
                  [],
                );

                return {
                  pageNumber: pageIndex + 1,
                  text: normalizeWhitespace(pageText.join(" ")),
                };
              } finally {
                page.cleanup();
              }
            }),
          ),
        ]);

        const parsedText = normalizeWhitespace(
          pageTexts.map((page) => page.text).filter(Boolean).join("\n\n"),
        );
        const metadataTitle =
          (typeof metadata?.info === "object" &&
          metadata.info !== null &&
          "Title" in metadata.info &&
          typeof metadata.info.Title === "string"
            ? metadata.info.Title.replace(/\s+/g, " ").trim()
            : "") ||
          file.name.replace(/\.pdf$/i, "");

        if (parsedText.split(/\s+/).filter(Boolean).length >= 40) {
          return {
            title: metadataTitle || "PDF document",
            text: parsedText,
            pages: pageTexts.filter((page) => page.text.length > 0),
          };
        }
      } finally {
        await document.cleanup();
        await document.destroy();
      }
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    console.info("PDF.js extraction failed, falling back to Gemini file extraction.", {
      message: toSafeErrorMessage(error),
    });
  }

  const fallbackInstructions =
    "Extract as much readable text from this PDF as possible into plain text. Do not summarize. Preserve the source language, preserve examples and important details, and ignore repeated headers, footers, and page numbers when possible. Return only the extracted document text. Do not include JSON, markdown fences, commentary, or confidence notes.";
  const env = getServerEnv();
  let fallbackText: string;

  try {
    // A PDF with no readable text layer is OCR work, not text work: the OCR benchmark
    // (scripts/ocr-eval.mjs) disqualified the cheap text model on exactly this input.
    fallbackText = await generateTextWithGeminiFile({
      instructions: `${fallbackInstructions}\n\nExtract the document text as faithfully and completely as possible so it can be turned into detailed study notes and flashcards.`,
      file,
      model: env.GEMINI_OCR_MODEL,
      thinkingConfig: resolveMinimalThinkingConfig(env.GEMINI_OCR_MODEL),
      maxOutputTokens: PDF_FALLBACK_MAX_OUTPUT_TOKENS,
    });
  } catch (error) {
    // Both readers have now given up on this file: PDF.js found no usable text layer, and the
    // Gemini fallback answered with nothing four times over on an escalating token budget. That
    // is a PDF with no readable text in it -- a scan of photographs, a diagram-only deck -- which
    // is the learner's file to fix and not a defect, so say so in a way they can act on instead of
    // failing the lecture with "Model returned empty text output." and paging us about it.
    if (error instanceof GeminiEmptyTextOutputError) {
      throw new ExpectedLectureInputError(
        "V tem PDF-ju ni bilo mogoče najti berljivega besedila. Če gre za skeniran dokument, strani naloži kot fotografije, da jih lahko preberemo.",
        "pdf_no_text",
      );
    }

    throw error;
  }

  return {
    title: file.name.replace(/\.pdf$/i, "") || "PDF document",
    text: normalizeWhitespace(fallbackText),
    pages: [],
  };
}

export async function extractTextFromDocument(file: File) {
  if (isPdfDocument(file)) {
    return extractTextFromPdf(file);
  }

  if (isPlainTextDocument(file)) {
    const text = normalizeWhitespace(await file.text());
    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "Text document",
      text,
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isHtmlDocument(file)) {
    const html = await file.text();
    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "HTML document",
      text: htmlToText(html),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isRtfDocument(file)) {
    const rtf = await file.text();
    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "RTF dokument",
      text: rtfToText(rtf),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isDocxDocument(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await mammoth.extractRawText({ buffer });

    return {
      title: file.name.replace(/\.[^.]+$/i, "") || "Word dokument",
      text: normalizeWhitespace(extracted.value),
      pages: [] as Array<{ pageNumber: number; text: string }>,
    };
  }

  if (isPptxDocument(file)) {
    return extractTextFromPptx(file);
  }

  throw new Error("Nepodprta vrsta dokumenta. Uporabi PDF, TXT, Markdown, HTML, RTF, DOCX ali PPTX.");
}

export async function extractTextFromImage(file: File, context?: ImageOcrContext) {
  const env = getServerEnv();
  const instructions =
    "Extract all readable text from this photo of notes or printed material. The source is likely Slovenian, so preserve Slovenian characters such as č, š, and ž. Do not translate and do not summarize. Preserve the original language, headings, bullet points, equations, labels, line breaks, and important details. Ignore decorative background elements. If handwriting is uncertain, make the best faithful reading instead of inventing content. Return only the extracted text. Do not include JSON, markdown fences, commentary, or confidence notes.";
  const attempts: ScanOcrAttemptDiagnostics[] = [];

  let primaryError: unknown = null;

  try {
    const primaryText = await generateTextWithGeminiFile({
      instructions,
      file,
      model: env.GEMINI_OCR_MODEL,
      maxOutputTokens: OCR_PRIMARY_MAX_OUTPUT_TOKENS,
      maxAttempts: 1,
      thinkingConfig: resolveMinimalThinkingConfig(env.GEMINI_OCR_MODEL),
      mediaResolution: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
      usageContext: buildImageOcrUsageContext({
        context,
        stage: "ocr_primary",
        file,
      }),
    });
    const text = normalizeOcrPlainText(primaryText);
    const acceptable = isAcceptableImageOcrText(text);
    attempts.push({
      acceptable,
      errorMessage: null,
      maxOutputTokens: OCR_PRIMARY_MAX_OUTPUT_TOKENS,
      mediaResolution: "medium",
      model: env.GEMINI_OCR_MODEL,
      outputLength: text.length,
      stage: "ocr_primary",
    });

    if (acceptable) {
      return {
        title: deriveImageTitle(file, text),
        text,
      };
    }
  } catch (error) {
    primaryError = error;
    attempts.push({
      acceptable: error instanceof GeminiEmptyTextOutputError ? false : null,
      errorMessage: toSafeErrorMessage(error),
      maxOutputTokens: OCR_PRIMARY_MAX_OUTPUT_TOKENS,
      mediaResolution: "medium",
      model: env.GEMINI_OCR_MODEL,
      outputLength: error instanceof GeminiEmptyTextOutputError ? 0 : null,
      stage: "ocr_primary",
    });
  }

  try {
    const rescueText = await generateTextWithGeminiFile({
      instructions,
      file,
      model: env.GEMINI_OCR_RESCUE_MODEL,
      maxOutputTokens: OCR_RESCUE_MAX_OUTPUT_TOKENS,
      maxAttempts: 1,
      thinkingConfig: resolveMinimalThinkingConfig(env.GEMINI_OCR_RESCUE_MODEL),
      mediaResolution: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
      usageContext: buildImageOcrUsageContext({
        context,
        stage: "ocr_rescue",
        file,
      }),
    });
    const text = normalizeOcrPlainText(rescueText);
    const acceptable = isAcceptableImageOcrText(text);
    attempts.push({
      acceptable,
      errorMessage: null,
      maxOutputTokens: OCR_RESCUE_MAX_OUTPUT_TOKENS,
      mediaResolution: "high",
      model: env.GEMINI_OCR_RESCUE_MODEL,
      outputLength: text.length,
      stage: "ocr_rescue",
    });

    if (!acceptable) {
      throw buildNoReadableImageTextError({
        attempts,
        context,
        file,
      });
    }

    return {
      title: deriveImageTitle(file, text),
      text,
    };
  } catch (error) {
    if (error instanceof NoReadableScanTextError) {
      throw error;
    }

    // A budget abort must keep its identity: rewrapping it would report a fabricated provider
    // outage and let downstream abort handling treat the cancelled run as a retryable failure.
    if (isWorkAbortedError(error) || isWorkAbortedError(primaryError)) {
      throw error;
    }

    if (error instanceof GeminiEmptyTextOutputError) {
      attempts.push({
        acceptable: false,
        errorMessage: toSafeErrorMessage(error),
        maxOutputTokens: OCR_RESCUE_MAX_OUTPUT_TOKENS,
        mediaResolution: "high",
        model: env.GEMINI_OCR_RESCUE_MODEL,
        outputLength: 0,
        stage: "ocr_rescue",
      });

      throw buildNoReadableImageTextError({
        attempts,
        context,
        file,
      });
    }

    throw new Error(toUserFacingAiErrorMessage(primaryError ?? error));
  }
}

async function updateLectureEnrichmentProcessingStage(params: {
  lectureId: string;
  stage: "checking_document_images";
  title?: string | null;
  durationSeconds?: number | null;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("lectures")
    .select("processing_metadata")
    .eq("id", params.lectureId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = data as { processing_metadata: unknown } | null;
  const metadata = isPlainRecord(row?.processing_metadata) ? row.processing_metadata : {};

  const { error: updateError } = await supabase
    .from("lectures")
    .update(
      {
        status: "generating_notes",
        title: params.title,
        duration_seconds: params.durationSeconds,
        error_message: null,
        processing_metadata: {
          ...metadata,
          processing: {
            stage: params.stage,
            updatedAt: new Date().toISOString(),
            errorMessage: null,
          },
        },
      } as never,
    )
    .eq("id", params.lectureId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

type FittedSourceText = {
  text: string;
  blocks?: StructuredSourceBlock[];
  sourceCompression: Record<string, unknown> | null;
};

/**
 * Every text source passes through here on its way into the pipeline. Sources that fit are
 * returned untouched; oversized ones are compressed down to what the note pipeline can process
 * in one step, instead of being rejected with "split it into smaller parts" as before. Only
 * material beyond the raw ceiling — several times a full textbook — is still refused.
 */
async function fitSourceTextToPipeline(params: {
  cleanedText: string;
  blocks?: StructuredSourceBlock[];
  userId?: string;
  lectureId?: string | null;
}): Promise<FittedSourceText> {
  // Blocks are what the pipeline actually reads when they exist, and they are not always the same
  // size as the plain text beside them: a document import appends each picture's description to
  // the block it came from, so the blocks can carry more than `text` does. Measuring the smaller
  // of the two would wave a source through that is over capacity once the blocks are used.
  const blocksChars = params.blocks?.reduce((sum, block) => sum + block.text.length, 0) ?? 0;
  const sourceChars = Math.max(params.cleanedText.length, blocksChars);

  if (sourceChars <= PIPELINE_SOURCE_TEXT_TARGET_CHARS) {
    return { text: params.cleanedText, blocks: params.blocks, sourceCompression: null };
  }

  if (sourceChars > MAX_RAW_SOURCE_TEXT_CHARS) {
    throw new ExpectedLectureInputError(
      "This source is too large to process even with compression. Please split it into a few parts and try again.",
      "source_too_large",
    );
  }

  const condensed = await condenseSourceMaterial({
    text: params.cleanedText,
    blocks: params.blocks,
    targetChars: PIPELINE_SOURCE_TEXT_TARGET_CHARS,
    selector: createAiChunkSelector({
      stage: "source_condense",
      userId: params.userId ?? null,
      lectureId: params.lectureId ?? null,
    }),
  });

  const text = normalizeWhitespace(condensed.text);
  // The selection budgets already keep the result under target; this guard exists because the
  // note pipeline's step budget is sized to this number and must never see more.
  const withinTarget = text.length <= PIPELINE_SOURCE_TEXT_TARGET_CHARS;
  const boundedText = withinTarget ? text : text.slice(0, PIPELINE_SOURCE_TEXT_TARGET_CHARS);

  return {
    text: boundedText,
    // A sliced text no longer lines up with the condensed blocks, so structure is dropped with it.
    blocks: withinTarget ? (condensed.blocks ?? undefined) : undefined,
    sourceCompression: {
      ...condensed.meta,
      compressedAt: new Date().toISOString(),
    },
  };
}

export async function createLectureFromTextSource(params: {
  userId: string;
  sourceType: string;
  text: string;
  blocks?: StructuredSourceBlock[];
  languageHint?: string;
  titleHint?: string;
  modelMetadata?: Record<string, unknown>;
  lectureId?: string;
  createInitialAudio?: boolean;
  initialAudioVoice?: NoteTtsVoice;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const cleanedText = normalizeWhitespace(params.text);

  if (cleanedText.length < 120) {
    throw new ExpectedLectureInputError(
      "Please provide a bit more source material before creating notes.",
      "source_too_short",
    );
  }

  const fitted = await fitSourceTextToPipeline({
    cleanedText,
    blocks: params.blocks,
    userId: params.userId,
    lectureId: params.lectureId ?? null,
  });
  const sourceText = fitted.text;
  const sourceBlocks = fitted.blocks;

  const durationSeconds = estimateTextSourceDurationSeconds(sourceText);
  let lectureId: string | null = null;

  async function requireActiveLecture(targetLectureId: string) {
    const { data: lecture, error } = await supabase
      .from("lectures")
      .select("id")
      .eq("id", targetLectureId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!lecture) {
      throw new Error("Lecture was cancelled.");
    }
  }

  try {
    if (params.lectureId) {
      lectureId = params.lectureId;
      await requireActiveLecture(lectureId);
      const { error: lectureUpdateError } = await supabase
        .from("lectures")
        .update(
          {
            source_type: params.sourceType,
            status: "generating_notes",
            language_hint: params.languageHint ?? "sl",
            duration_seconds: durationSeconds,
            error_message: null,
            title: params.titleHint ?? null,
            processing_metadata: {
              createInitialAudio: params.createInitialAudio === true,
              initialAudioVoice: params.initialAudioVoice ?? null,
              manualImport: {
                sourceType: params.sourceType,
                titleHint: params.titleHint ?? null,
                modelMetadata: params.modelMetadata ?? {},
                text: sourceText,
                blocks: sourceBlocks ?? null,
                sourceCompression: fitted.sourceCompression,
              },
            },
          } as never,
        )
        .eq("id", lectureId)
        .eq("user_id", params.userId);

      if (lectureUpdateError) {
        throw new Error(lectureUpdateError.message);
      }
    } else {
      const { data: lecture, error: lectureError } = await supabase
        .from("lectures")
        .insert(
          {
            user_id: params.userId,
            source_type: params.sourceType,
            status: "generating_notes",
            language_hint: params.languageHint ?? "sl",
            duration_seconds: durationSeconds,
            title: params.titleHint ?? null,
            processing_metadata: {
              createInitialAudio: params.createInitialAudio === true,
              initialAudioVoice: params.initialAudioVoice ?? null,
              manualImport: {
                sourceType: params.sourceType,
                titleHint: params.titleHint ?? null,
                modelMetadata: params.modelMetadata ?? {},
                text: sourceText,
                blocks: sourceBlocks ?? null,
                sourceCompression: fitted.sourceCompression,
              },
            },
          } as never,
        )
        .select("id")
        .single();

      if (lectureError || !lecture) {
        throw new Error(lectureError?.message ?? "Zapiska ni bilo mogoče ustvariti.");
      }

      lectureId = (lecture as { id: string }).id;
    }
    const transcript = buildSyntheticTranscriptFromTextSource({
      text: sourceText,
      blocks: sourceBlocks,
      sourceType: params.sourceType,
    });

    if (transcript.length === 0) {
      throw new Error("The source did not contain enough text to process.");
    }

    if (!lectureId) {
      throw new Error("Zapiska ni bilo mogoče ustvariti.");
    }

    const activeLectureId = lectureId;
    const embeddings = await createEmbeddings(transcript.map((segment) => segment.text));

    await requireActiveLecture(activeLectureId);

    await supabase.from("transcript_segments").delete().eq("lecture_id", activeLectureId);

    const transcriptRows = transcript.map((segment, index) => ({
      lecture_id: activeLectureId,
      idx: segment.idx,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      speaker_label: segment.speakerLabel,
      text: segment.text,
      embedding: embeddings[index] ? serializeVector(embeddings[index]) : null,
    }));

    await insertTranscriptSegmentsInBatches(supabase, transcriptRows);

    const notes = await generateNotesFromTranscript(transcript, {
      sourceLabel: "uploaded documents and text sources",
      pipelineName: "document-to-notes-v2",
      sourceType: "document",
      outputLanguage: params.languageHint,
      sourceTitleHint: params.titleHint,
      usageContext: { lectureId: activeLectureId, userId: params.userId },
    });

    await requireActiveLecture(lectureId);

    const baseModelMetadata = {
      ...notes.modelMetadata,
      ...params.modelMetadata,
    };

    const { error: artifactError } = await supabase
      .from("lecture_artifacts")
      .upsert(
        {
          lecture_id: lectureId,
          summary: notes.summary,
          key_topics: notes.keyTopics,
          structured_notes_md: notes.structuredNotesMd,
          model_metadata: withNoteEnrichmentStage(baseModelMetadata, "checking_document_images"),
        } as never,
        {
          onConflict: "lecture_id",
        },
      );

    if (artifactError) {
      throw new Error(artifactError.message);
    }

    await updateLectureEnrichmentProcessingStage({
      lectureId,
      stage: "checking_document_images",
      title: notes.title,
      durationSeconds,
    });

    const documentImages = getStoredDocumentImagesFromMetadata(params.modelMetadata ?? {});

    if (documentImages.length > 0) {
      // The note is already saved by this point; a picture that cannot find its paragraph must
      // not take the finished text down with it.
      try {
        await attachDocumentImagesToNotes({
          lectureId,
          structuredNotesMd: notes.structuredNotesMd,
          documentImages,
        });
      } catch (error) {
        console.warn("Placing document images failed; the note keeps its text.", error);
        captureBackgroundError(error, {
          operation: "document_image_placement",
          extra: { lectureId },
        });
      }
    }

    const { error: enrichmentCompleteError } = await supabase
      .from("lecture_artifacts")
      .update({
        model_metadata: withNoteEnrichmentStage(baseModelMetadata, "complete"),
      } as never)
      .eq("lecture_id", lectureId);

    if (enrichmentCompleteError) {
      throw new Error(enrichmentCompleteError.message);
    }

    if (params.createInitialAudio === true) {
      await markInitialNoteAudioPreparing({
        lectureId,
        processingMetadata: {
          createInitialAudio: params.createInitialAudio === true,
          initialAudioVoice: params.initialAudioVoice ?? null,
          manualImport: {
            sourceType: params.sourceType,
            titleHint: params.titleHint ?? null,
            modelMetadata: params.modelMetadata ?? {},
            text: cleanedText,
            blocks: params.blocks ?? null,
          },
        },
      });
      await prepareInitialNoteTtsChunksSafely({
        userId: params.userId,
        lectureId,
        content: notes.structuredNotesMd,
        title: notes.title,
        languageHint: params.languageHint ?? "sl",
        voice: params.initialAudioVoice,
      });
    }

    const { data: updatedLecture, error: updateError } = await supabase
      .from("lectures")
      .update(
        {
          title: notes.title,
          status: "ready",
          error_message: null,
          duration_seconds: durationSeconds,
        } as never,
      )
      .eq("id", lectureId)
      .select("id")
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updatedLecture) {
      await requireActiveLecture(lectureId);
    }

    return lectureId;
  } catch (error) {
    if (lectureId) {
      const { data: lecture } = await supabase
        .from("lectures")
        .select("id")
        .eq("id", lectureId)
        .maybeSingle();

      if (lecture) {
        await supabase
          .from("lectures")
          .update(
            {
              status: "failed",
              error_message: toUserFacingAiErrorMessage(error),
            } as never,
          )
          .eq("id", lectureId);
      }
    }

    throw error;
  }
}

export async function prepareLectureFromTextSource(params: {
  userId: string;
  sourceType: string;
  text: string;
  blocks?: StructuredSourceBlock[];
  languageHint?: string;
  titleHint?: string;
  modelMetadata?: Record<string, unknown>;
  lectureId?: string;
  createInitialAudio?: boolean;
  initialAudioVoice?: NoteTtsVoice;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const cleanedText = normalizeWhitespace(params.text);

  if (cleanedText.length < 120) {
    throw new ExpectedLectureInputError(
      "Please provide a bit more source material before creating notes.",
      "source_too_short",
    );
  }

  const fitted = await fitSourceTextToPipeline({
    cleanedText,
    blocks: params.blocks,
    userId: params.userId,
    lectureId: params.lectureId ?? null,
  });

  const durationSeconds = estimateTextSourceDurationSeconds(fitted.text);
  const titleHint = params.titleHint == null ? null : stripUnstorableCharacters(params.titleHint);
  // Blocks, the title hint and model metadata reach us straight from the extractor, so clean
  // the whole payload here rather than trusting every producer to have done it.
  const processingMetadata = sanitizeJsonForDatabase({
    createInitialAudio: params.createInitialAudio === true,
    initialAudioVoice: params.initialAudioVoice ?? null,
    manualImport: {
      sourceType: params.sourceType,
      titleHint,
      modelMetadata: params.modelMetadata ?? {},
      text: fitted.text,
      blocks: fitted.blocks ?? null,
      sourceCompression: fitted.sourceCompression,
    },
    processing: {
      stage: "queued",
      updatedAt: new Date().toISOString(),
      errorMessage: null,
    },
  });

  if (params.lectureId) {
    const { data: lecture, error } = await supabase
      .from("lectures")
      .update(
        {
          source_type: params.sourceType,
          status: "queued",
          language_hint: params.languageHint ?? "sl",
          duration_seconds: durationSeconds,
          error_message: null,
          title: titleHint,
          processing_metadata: processingMetadata,
        } as never,
      )
      .eq("id", params.lectureId)
      .eq("user_id", params.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!lecture) {
      throw new Error("Lecture was cancelled.");
    }

    const [{ error: transcriptDeleteError }, { error: artifactDeleteError }] = await Promise.all([
      supabase.from("transcript_segments").delete().eq("lecture_id", params.lectureId),
      supabase.from("lecture_artifacts").delete().eq("lecture_id", params.lectureId),
    ]);

    if (transcriptDeleteError) {
      throw new Error(transcriptDeleteError.message);
    }

    if (artifactDeleteError) {
      throw new Error(artifactDeleteError.message);
    }

    return params.lectureId;
  }

  const { data: lecture, error } = await supabase
    .from("lectures")
    .insert(
      {
        user_id: params.userId,
        source_type: params.sourceType,
        status: "queued",
        language_hint: params.languageHint ?? "sl",
        duration_seconds: durationSeconds,
        title: titleHint,
        processing_metadata: processingMetadata,
      } as never,
    )
    .select("id")
    .single();

  if (error || !lecture) {
    throw new Error(error?.message ?? "Zapiska ni bilo mogoče ustvariti.");
  }

  return (lecture as { id: string }).id;
}
