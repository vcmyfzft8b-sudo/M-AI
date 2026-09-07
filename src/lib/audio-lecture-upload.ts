"use client";

import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import {
  shouldUseClientAudioChunking,
  type AudioChunkManifest,
} from "@/lib/audio-processing";
import {
  createAudioProcessingChunks,
  normalizeRecordedAudioForUpload,
} from "@/lib/audio-processing-client";
import { parseApiResponse } from "@/lib/billing-client";
import {
  isRetryableUploadFailure,
  uploadToSignedUrlWithRetry,
} from "@/lib/signed-upload-client";
import { normalizeUploadAudioMimeType } from "@/lib/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { CreateLectureResponse } from "@/lib/types";

type UploadStage =
  | "creating"
  | "uploading-original"
  | "preparing-chunks"
  | "uploading-chunks"
  | "finalizing";

type ChunkUploadResponse = {
  uploads: Array<{
    index: number;
    path: string;
    token: string;
  }>;
};

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Upload was aborted.", "AbortError");
  }
}

export async function createAudioLectureWithProcessingChunks(params: {
  file: File;
  durationSeconds: number;
  normalizeBeforeUpload?: boolean;
  onStageChange?: (stage: UploadStage, message: string) => void;
  onLectureCreated?: (lectureId: string) => void;
  signal?: AbortSignal;
  /**
   * The caller's translator. This runs in the browser but outside React, so
   * the stage captions and failure messages it produces have to be handed a
   * way to speak the reader's language.
   */
  t: Translate<MessageKey>;
}) {
  let uploadFile = params.file;

  if (params.normalizeBeforeUpload) {
    assertNotAborted(params.signal);
    params.onStageChange?.("preparing-chunks", params.t("audio.upload.normalising"));

    const normalizedRecording = await normalizeRecordedAudioForUpload({
      file: params.file,
      signal: params.signal,
    });
    uploadFile = normalizedRecording.file;
  }

  const normalizedMimeType = normalizeUploadAudioMimeType({
    mimeType: uploadFile.type || "application/octet-stream",
    fileName: uploadFile.name,
  });
  const supabase = createSupabaseBrowserClient();

  assertNotAborted(params.signal);
  params.onStageChange?.("creating", params.t("capture.busy.preparing"));

  /*
   * Deliberately not abortable, unlike every other request here.
   *
   * The row is inserted by the time the server starts writing the response, so aborting this one
   * does not un-create the lecture — it only throws away the id, and an id nobody holds is a row
   * nobody can delete. That is where the untitled `upload_incomplete` notes at the top of a
   * learner's library came from: cancel during the create, and the draft outlives the modal that
   * made it. Letting it finish costs a moment on a request that carries no file, and the
   * `assertNotAborted` below still stops us the instant it returns.
   */
  const createResponse = await fetch("/api/lectures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mimeType: normalizedMimeType,
      fileName: uploadFile.name,
      size: uploadFile.size,
      durationSeconds: Math.max(params.durationSeconds, 1),
    }),
  });

  const createData = await parseApiResponse<CreateLectureResponse>(createResponse, params.t);

  params.onLectureCreated?.(createData.lectureId);

  assertNotAborted(params.signal);
  params.onStageChange?.("uploading-original", params.t("capture.busy.uploadingAudio"));

  await uploadAudioFileToSignedUrl({
    t: params.t,
    supabase,
    path: createData.path,
    token: createData.token,
    file: uploadFile,
    contentType: normalizedMimeType,
    signal: params.signal,
    onRetry: (attempt, attempts) =>
      params.onStageChange?.(
        "uploading-original",
        params.t("capture.busy.retryingUpload", { attempt, total: attempts }),
      ),
  });

  const shouldChunk = shouldUseClientAudioChunking({
    sizeBytes: uploadFile.size,
    durationSeconds: params.durationSeconds,
  });

  if (shouldChunk) {
    try {
      assertNotAborted(params.signal);
      params.onStageChange?.("preparing-chunks", params.t("audio.upload.preparingChunks"));

      const chunks = await createAudioProcessingChunks({
        file: uploadFile,
        durationSeconds: params.durationSeconds,
        signal: params.signal,
        onProgress: (message) => params.onStageChange?.("preparing-chunks", message),
      });

      const manifestResponse = await fetch(`/api/lectures/${createData.lectureId}/chunks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: params.signal,
        body: JSON.stringify({
          chunks: chunks.map((chunk) => ({
            index: chunk.index,
            mimeType: chunk.mimeType,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
          })),
        }),
      });

      const manifestData = await parseApiResponse<ChunkUploadResponse>(manifestResponse, params.t);

      const uploadsByIndex = new Map(
        manifestData.uploads.map((upload) => [upload.index, upload] as const),
      );

      for (const [position, chunk] of chunks.entries()) {
        assertNotAborted(params.signal);
        params.onStageChange?.(
          "uploading-chunks",
          params.t("audio.upload.uploadingChunk", {
            index: position + 1,
            total: chunks.length,
          }),
        );

        const uploadTarget = uploadsByIndex.get(chunk.index);

        if (!uploadTarget) {
          throw new Error(`Missing upload target for chunk ${chunk.index}.`);
        }

        await uploadAudioFileToSignedUrl({
          t: params.t,
          supabase,
          path: uploadTarget.path,
          token: uploadTarget.token,
          file: chunk.file,
          contentType: chunk.mimeType,
          signal: params.signal,
          onRetry: (attempt, attempts) =>
            params.onStageChange?.(
              "uploading-chunks",
              params.t("capture.busy.retryingUpload", { attempt, total: attempts }),
            ),
        });
      }
    } catch (chunkError) {
      if (params.signal?.aborted) {
        throw chunkError;
      }

      console.warn("Client audio chunking failed; falling back to original upload.", chunkError);
    }
  }

  assertNotAborted(params.signal);
  params.onStageChange?.("finalizing", params.t("audio.upload.finalizing"));

  const finalizeResponse = await fetch(`/api/lectures/${createData.lectureId}/finalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify({
      path: createData.path,
    }),
  });

  await parseApiResponse(finalizeResponse, params.t);

  return {
    lectureId: createData.lectureId,
    path: createData.path,
  };
}

/**
 * The message a failed upload leaves the learner with.
 *
 * A retryable failure has already been retried by the time it reaches here — the connection
 * never came back — so "check your connection and try again" is still the right advice. Anything
 * else is a verdict on the file itself, and its own message says more than ours would.
 */
function createUploadError(error: unknown, t: Translate<MessageKey>) {
  if (isRetryableUploadFailure(error)) {
    return new Error(t("audio.upload.failedRetry"));
  }

  const message = (error as { message?: string } | null)?.message;

  return new Error(message ?? t("audio.upload.failed"));
}

async function uploadAudioFileToSignedUrl(params: {
  t: Translate<MessageKey>;
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
  path: string;
  token: string;
  file: File;
  contentType: string;
  signal?: AbortSignal;
  onRetry?: (attempt: number, attempts: number) => void;
}) {
  try {
    await uploadToSignedUrlWithRetry({
      supabase: params.supabase,
      path: params.path,
      token: params.token,
      file: params.file,
      contentType: params.contentType,
      signal: params.signal,
      onRetry: params.onRetry,
    });
  } catch (error) {
    if (params.signal?.aborted) {
      throw error;
    }

    throw createUploadError(error, params.t);
  }
}

export function parseAudioChunkPaths(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const chunk = item as AudioChunkManifest;
    return typeof chunk?.path === "string" ? [chunk.path] : [];
  });
}
