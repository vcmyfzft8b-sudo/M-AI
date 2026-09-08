import "server-only";

import { MAX_SCAN_IMAGE_BYTES, STORAGE_BUCKET } from "@/lib/constants";
import { LectureNoLongerExistsError } from "@/lib/lecture-processing-errors";
import { extractTextFromImage, prepareLectureFromTextSource } from "@/lib/manual-lectures";
import {
  isCanonicalLectureScanImageStoragePath,
  isSupportedScanImageMimeType,
  normalizeUploadScanImageMimeType,
} from "@/lib/storage";
import { isTransientStorageDownloadError } from "@/lib/storage-download-errors";
import {
  NoReadableScanTextError,
  type ScanOcrImageDiagnostics,
} from "@/lib/scan-ocr-errors";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sourceLocaleMessage } from "@/lib/lecture-failure-text";

const SCAN_OCR_CONCURRENCY = 3;
const SCAN_STORAGE_DOWNLOAD_MAX_ATTEMPTS = 3;
const SCAN_STORAGE_DOWNLOAD_RETRY_DELAYS_MS = [500, 1500] as const;

type StoredScanImage = {
  index: number;
  path: string;
  mimeType: string;
  fileName?: string | null;
  size: number;
};

export type StoredScanProcessingResult = {
  needsNotesGeneration: boolean;
};

type ExtractedScanBlock = {
  label: string;
  pageNumber: number;
  text: string;
};

type ScanImageProcessingResult = {
  block: ExtractedScanBlock | null;
  skippedImages: ScanOcrImageDiagnostics[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildScanOcrDiagnostics(params: {
  imageCount: number;
  readableImageCount: number;
  skippedImages: ScanOcrImageDiagnostics[];
}) {
  return {
    imageCount: params.imageCount,
    images: params.skippedImages,
    readableImageCount: params.readableImageCount,
    skippedImageCount: params.skippedImages.length,
  };
}

function parsePendingScanImages(value: unknown): StoredScanImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const index = typeof item.index === "number" ? item.index : null;
    const path = typeof item.path === "string" ? item.path : null;
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : null;
    const fileName = typeof item.fileName === "string" ? item.fileName : null;
    const size = typeof item.size === "number" ? item.size : null;

    if (index == null || !path || !mimeType || size == null) {
      return [];
    }

    return [{ index, path, mimeType, fileName, size }];
  });
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(values.length);
  const failures: unknown[] = [];
  let nextIndex = 0;

  // Workers settle instead of rejecting. Promise.all resolves on the first rejection
  // and leaves any later one unhandled, which takes down the whole invocation.
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length && failures.length === 0) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await mapper(values[currentIndex], currentIndex);
      } catch (error) {
        failures.push(error);
        return;
      }
    }
  });

  await Promise.all(workers);

  if (failures.length > 0) {
    throw failures[0];
  }

  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function downloadStoredScanImage(image: StoredScanImage) {
  const normalizedMimeType = normalizeUploadScanImageMimeType({
    mimeType: image.mimeType,
    fileName: image.fileName,
  });
  const storage = createSupabaseServiceRoleClient().storage.from(STORAGE_BUCKET);
  let lastDownloadError: unknown = null;

  for (let attempt = 1; attempt <= SCAN_STORAGE_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    const { data: blob, error } = await storage.download(image.path);

    if (!error && blob) {
      if (blob.size <= 0 || blob.size > MAX_SCAN_IMAGE_BYTES) {
        throw new Error("Slika za skeniranje je prevelika ali prazna.");
      }

      return new File([blob], image.fileName || `photo-${image.index + 1}`, {
        type: normalizedMimeType,
      });
    }

    const returnedNoBlob = !error && !blob;
    lastDownloadError = error ?? new Error("Shramba ni vrnila fotografije.");

    if (
      attempt >= SCAN_STORAGE_DOWNLOAD_MAX_ATTEMPTS ||
      (!returnedNoBlob && !isTransientStorageDownloadError(lastDownloadError))
    ) {
      break;
    }

    await sleep(SCAN_STORAGE_DOWNLOAD_RETRY_DELAYS_MS[attempt - 1] ?? 1500);
  }

  // error_message is shown to the user, so keep it Slovenian rather than forwarding
  // Supabase's English text. The original error rides along for Sentry.
  throw new Error(sourceLocaleMessage("pipeline.scanUnreadable"), { cause: lastDownloadError });
}

export async function processStoredScanLecture(
  params: { lectureId: string },
): Promise<StoredScanProcessingResult> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id, user_id, source_type, title, language_hint, processing_metadata")
    .eq("id", params.lectureId)
    .maybeSingle();

  if (lectureError) {
    throw lectureError;
  }

  // The learner deleted the lecture while this stage was still queued behind it. `.single()` used
  // to report that as PostgREST's "Cannot coerce the result to a single JSON object", which said
  // nothing about what had happened and reached Sentry as an unexplained defect.
  if (!lecture) {
    throw new LectureNoLongerExistsError(params.lectureId);
  }

  const lectureRow = lecture as {
    id: string;
    user_id: string;
    source_type: string | null;
    title: string | null;
    language_hint: string | null;
    processing_metadata: unknown;
  };
  const metadata = isRecord(lectureRow.processing_metadata)
    ? lectureRow.processing_metadata
    : {};
  const manualImport = isRecord(metadata.manualImport) ? metadata.manualImport : null;
  const images = parsePendingScanImages(metadata.pendingScanImages).sort(
    (left, right) => left.index - right.index,
  );
  const pastedText =
    typeof metadata.pendingScanText === "string" ? metadata.pendingScanText.trim() : "";

  if (images.length === 0) {
    const manualImportModelMetadata = isRecord(manualImport?.modelMetadata)
      ? manualImport.modelMetadata
      : null;
    const hasPreparedScanImport =
      manualImportModelMetadata?.importMode === "scan" &&
      typeof manualImport?.text === "string" &&
      manualImport.text.trim().length > 0;

    if (hasPreparedScanImport) {
      const { data: artifact, error: artifactError } = await supabase
        .from("lecture_artifacts")
        .select("lecture_id")
        .eq("lecture_id", lectureRow.id)
        .maybeSingle();

      if (artifactError) {
        throw new Error(artifactError.message);
      }

      if (artifact) {
        const { error: updateError } = await supabase
          .from("lectures")
          .update(
            {
              status: "ready",
              error_message: null,
              processing_metadata: {
                ...metadata,
                processing: {
                  stage: "ready",
                  updatedAt: new Date().toISOString(),
                  errorMessage: null,
                },
              },
            } as never,
          )
          .eq("id", lectureRow.id)
          .eq("user_id", lectureRow.user_id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        return { needsNotesGeneration: false };
      }

      return { needsNotesGeneration: true };
    }

    throw new Error("Ni fotografij za obdelavo.");
  }

  for (const image of images) {
    if (
      !isSupportedScanImageMimeType(image.mimeType, image.fileName) ||
      !isCanonicalLectureScanImageStoragePath({
        path: image.path,
        userId: lectureRow.user_id,
        lectureId: lectureRow.id,
      })
    ) {
      throw new Error("Neveljavna pot ali format fotografije.");
    }
  }

  const sourceFileNames = images.map((image) => image.fileName || `photo-${image.index + 1}`);
  const titleHint =
    images.length === 1
      ? sourceFileNames[0].replace(/\.[^.]+$/i, "")
      : `${images.length} fotografij`;

  const { error: statusError } = await supabase
    .from("lectures")
    .update(
      {
        status: "queued",
        error_message: null,
        title: titleHint,
        processing_metadata: {
          ...metadata,
          processing: {
            stage: "extracting_scan_text",
            updatedAt: new Date().toISOString(),
            errorMessage: null,
          },
        },
      } as never,
    )
    .eq("id", lectureRow.id)
    .eq("user_id", lectureRow.user_id);

  if (statusError) {
    throw new Error(statusError.message);
  }

  const processedImages = await mapWithConcurrency(
    images,
    SCAN_OCR_CONCURRENCY,
    async (image): Promise<ScanImageProcessingResult> => {
      const file = await downloadStoredScanImage(image);
      let extracted: Awaited<ReturnType<typeof extractTextFromImage>>;

      try {
        extracted = await extractTextFromImage(file, {
          userId: lectureRow.user_id,
          lectureId: lectureRow.id,
          imageIndex: image.index,
        });
      } catch (error) {
        if (error instanceof NoReadableScanTextError) {
          return {
            block: null,
            skippedImages: error.diagnostics.images,
          };
        }

        throw error;
      }

      const text = extracted.text.trim();
      if (!text) {
        return {
          block: null,
          skippedImages: [
            {
              attempts: [],
              fileName: image.fileName || `photo-${image.index + 1}`,
              imageIndex: image.index,
              mimeType: image.mimeType,
              sizeBytes: image.size,
            },
          ],
        };
      }

      return {
        block: {
          label: image.fileName || `photo-${image.index + 1}`,
          pageNumber: image.index + 1,
          text,
        },
        skippedImages: [],
      };
    },
  );
  const extractedBlocks = processedImages.flatMap((result) =>
    result.block ? [result.block] : [],
  );
  const skippedImages = processedImages.flatMap((result) => result.skippedImages);

  if (extractedBlocks.length === 0 && !pastedText) {
    throw new NoReadableScanTextError(
      buildScanOcrDiagnostics({
        imageCount: images.length,
        readableImageCount: 0,
        skippedImages,
      }),
    );
  }

  const blocks = pastedText
    ? [
        ...extractedBlocks,
        {
          label: "Prilepljeno besedilo",
          pageNumber: extractedBlocks.length + 1,
          text: pastedText,
        },
      ]
    : extractedBlocks;

  await prepareLectureFromTextSource({
    lectureId: lectureRow.id,
    userId: lectureRow.user_id,
    sourceType: "text",
    text: blocks.map((block) => block.text).join("\n\n"),
    blocks,
    titleHint,
    languageHint: lectureRow.language_hint ?? undefined,
    modelMetadata: {
      importMode: "scan",
      sourceFileNames,
      sourceImageUploads: images.map((image) => ({
        index: image.index,
        path: image.path,
        fileName: image.fileName,
        mimeType: image.mimeType,
        size: image.size,
      })),
      ocr: buildScanOcrDiagnostics({
        imageCount: images.length,
        readableImageCount: extractedBlocks.length,
        skippedImages,
      }),
    },
  });

  return { needsNotesGeneration: true };
}
