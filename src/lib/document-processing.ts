import "server-only";

import { STORAGE_BUCKET } from "@/lib/constants";
import {
  isPdfDocument,
  isPptxDocument,
} from "@/lib/document-files";
import {
  extractDocumentImages,
  storeDocumentImagesAsNoteMedia,
  type StoredDocumentNoteImage,
} from "@/lib/document-image-extraction";
import { LectureNoLongerExistsError } from "@/lib/lecture-processing-errors";
import { validateDocumentFileSignature } from "@/lib/file-validation";
import { isRecord } from "@/lib/lecture-source-metadata";
import {
  extractTextFromDocument,
  prepareLectureFromTextSource,
} from "@/lib/manual-lectures";
import {
  isCanonicalLectureDocumentStoragePath,
  normalizeUploadDocumentMimeType,
} from "@/lib/storage";
import { captureBackgroundError } from "@/lib/monitoring";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sourceLocaleMessage } from "@/lib/lecture-failure-text";

type StoredDocumentSource = {
  path: string;
  mimeType: string;
  fileName: string;
  size: number;
};

export type StoredDocumentProcessingResult = {
  needsNotesGeneration: boolean;
};

function buildDocumentImageContext(image: StoredDocumentNoteImage) {
  const details = [
    image.description,
    image.contextText ? `Nearby document text: ${image.contextText}` : null,
  ].filter(Boolean);

  if (details.length === 0) {
    return null;
  }

  return `Embedded document visual from ${image.sourcePartLabel}: ${details.join(" ")}`;
}

function addDocumentImageContextToBlocks(params: {
  blocks: Array<{ label: string | null; pageNumber: number | null; text: string }>;
  documentImages: StoredDocumentNoteImage[];
}) {
  if (params.documentImages.length === 0) {
    return params.blocks;
  }

  const unmatchedContext: string[] = [];
  const contextByPage = new Map<number, string[]>();

  for (const image of params.documentImages) {
    const context = buildDocumentImageContext(image);

    if (!context) {
      continue;
    }

    if (image.sourcePageNumber != null) {
      contextByPage.set(image.sourcePageNumber, [
        ...(contextByPage.get(image.sourcePageNumber) ?? []),
        context,
      ]);
    } else {
      unmatchedContext.push(context);
    }
  }

  return params.blocks.map((block, index) => {
    const visualContexts = [
      ...(block.pageNumber != null ? (contextByPage.get(block.pageNumber) ?? []) : []),
      ...(index === 0 ? unmatchedContext : []),
    ];

    if (visualContexts.length === 0) {
      return block;
    }

    return {
      ...block,
      text: `${block.text}\n\n${visualContexts.join("\n")}`,
    };
  });
}

function parsePendingDocument(value: unknown): StoredDocumentSource | null {
  if (!isRecord(value)) {
    return null;
  }

  const path = typeof value.path === "string" ? value.path : null;
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : null;
  const fileName = typeof value.fileName === "string" ? value.fileName : null;
  const size = typeof value.size === "number" ? value.size : null;

  if (!path || !mimeType || !fileName || size == null) {
    return null;
  }

  return { path, mimeType, fileName, size };
}

async function downloadStoredDocument(document: StoredDocumentSource) {
  const storage = createSupabaseServiceRoleClient().storage.from(STORAGE_BUCKET);
  const { data: blob, error } = await storage.download(document.path);

  if (error || !blob) {
    throw new Error(error?.message ?? sourceLocaleMessage("pipeline.documentUnreadable"));
  }

  const mimeType = normalizeUploadDocumentMimeType({
    mimeType: document.mimeType,
    fileName: document.fileName,
  });

  return new File([await blob.arrayBuffer()], document.fileName, {
    type: mimeType,
  });
}

export async function processStoredDocumentLecture(params: {
  lectureId: string;
}): Promise<StoredDocumentProcessingResult> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id, user_id, language_hint, processing_metadata")
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
    language_hint: string | null;
    processing_metadata: unknown;
  };
  const metadata = isRecord(lectureRow.processing_metadata)
    ? lectureRow.processing_metadata
    : {};
  const pendingDocument = parsePendingDocument(metadata.pendingDocument);

  if (!pendingDocument) {
    throw new Error("Ni dokumenta za obdelavo.");
  }

  if (
    !isCanonicalLectureDocumentStoragePath({
      path: pendingDocument.path,
      userId: lectureRow.user_id,
      lectureId: lectureRow.id,
    })
  ) {
    throw new Error("Neveljavna pot do dokumenta.");
  }

  const { error: statusError } = await supabase
    .from("lectures")
    .update(
      {
        status: "queued",
        error_message: null,
        processing_metadata: {
          ...metadata,
          processing: {
            stage: "extracting_document_text",
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

  const file = await downloadStoredDocument(pendingDocument);
  const validatedDocument = await validateDocumentFileSignature(file);

  if (!validatedDocument.ok) {
    throw new Error(validatedDocument.error);
  }

  const sourceType = isPdfDocument(file)
    ? "pdf"
    : isPptxDocument(file)
      ? "presentation"
      : "text";
  const extracted = await extractTextFromDocument(file);
  const { error: imageStatusError } = await supabase
    .from("lectures")
    .update(
      {
        status: "queued",
        error_message: null,
        processing_metadata: {
          ...metadata,
          pendingDocument,
          processing: {
            stage: "checking_document_images",
            updatedAt: new Date().toISOString(),
            errorMessage: null,
          },
        },
      } as never,
    )
    .eq("id", lectureRow.id)
    .eq("user_id", lectureRow.user_id);

  if (imageStatusError) {
    throw new Error(imageStatusError.message);
  }

  // Pictures enrich the note; they never decide whether it exists. Storage talks to Supabase and
  // can fail on its own, so it is contained here as well as inside the extractor.
  let documentImages: StoredDocumentNoteImage[] = [];

  try {
    const extractedImages = await extractDocumentImages(file);
    documentImages = await storeDocumentImagesAsNoteMedia({
      lectureId: lectureRow.id,
      userId: lectureRow.user_id,
      images: extractedImages,
    });
  } catch (error) {
    console.warn("Storing document images failed; continuing without pictures.", error);
    captureBackgroundError(error, {
      operation: "document_image_storage",
      extra: { lectureId: lectureRow.id },
    });
  }
  const titleHint = extracted.title || pendingDocument.fileName.replace(/\.[^.]+$/i, "");
  const extractedPageBlocks = extracted.pages.map((page) => ({
    label: sourceType === "presentation" ? `Prosojnica ${page.pageNumber}` : `Stran ${page.pageNumber}`,
    pageNumber: page.pageNumber,
    text: page.text,
  }));
  const sourceBlocks = addDocumentImageContextToBlocks({
    blocks:
      extractedPageBlocks.length > 0
        ? extractedPageBlocks
        : [
            {
              label: titleHint,
              pageNumber: null,
              text: extracted.text,
            },
          ],
    documentImages,
  });

  await prepareLectureFromTextSource({
    lectureId: lectureRow.id,
    userId: lectureRow.user_id,
    sourceType,
    text: extracted.text,
    blocks: sourceBlocks,
    titleHint,
    languageHint: lectureRow.language_hint ?? "sl",
    modelMetadata: {
      importMode:
        sourceType === "pdf"
          ? "pdf"
          : sourceType === "presentation"
            ? "presentation"
            : "document",
      sourceFileName: pendingDocument.fileName,
      sourceDocumentUpload: pendingDocument,
      // The note row prints "PDF, 24 strani"; this is where that 24 comes from.
      sourcePageCount: extracted.pages.length || null,
      documentImages,
    },
  });

  return { needsNotesGeneration: true };
}
