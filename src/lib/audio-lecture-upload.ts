"use client";

import { STORAGE_BUCKET } from "@/lib/constants";
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
import { getPublicEnv } from "@/lib/public-env";
import { normalizeUploadAudioMimeType } from "@/lib/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { CreateLectureResponse } from "@/lib/types";
import type { NoteTtsVoice } from "@/lib/note-tts-settings";

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
  createInitialAudio?: boolean;
  initialAudioVoice?: NoteTtsVoice;
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

  const createResponse = await fetch("/api/lectures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify({
      mimeType: normalizedMimeType,
      fileName: uploadFile.name,
      size: uploadFile.size,
      durationSeconds: Math.max(params.durationSeconds, 1),
      createInitialAudio: params.createInitialAudio === true,
      initialAudioVoice: params.initialAudioVoice,
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

function shouldRetryWithRawBody(error: { message?: string; name?: string }) {
  const message = `${error.name ?? ""} ${error.message ?? ""}`.toLowerCase();

  return (
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network")
  );
}

function createUploadError(error: { message?: string; name?: string }, t: Translate<MessageKey>) {
  if (shouldRetryWithRawBody(error)) {
    return new Error(t("audio.upload.failedRetry"));
  }

  return new Error(error.message ?? t("audio.upload.failed"));
}

async function readUploadBytes(file: File, t: Translate<MessageKey>) {
  try {
    return await file.arrayBuffer();
  } catch (error) {
    throw createUploadError(error instanceof Error ? error : {}, t);
  }
}

function buildSignedUploadUrl(params: { path: string; token: string }) {
  const { supabaseUrl } = getPublicEnv();

  if (!supabaseUrl) {
    throw new Error("Missing Supabase public environment variables.");
  }

  const encodedPath = params.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = new URL(
    `/storage/v1/object/upload/sign/${STORAGE_BUCKET}/${encodedPath}`,
    supabaseUrl,
  );
  url.searchParams.set("token", params.token);
  return url.toString();
}

async function uploadRawBytesToSignedUrl(params: {
  path: string;
  token: string;
  bytes: ArrayBuffer;
  contentType: string;
  signal?: AbortSignal;
}) {
  const response = await fetch(
    buildSignedUploadUrl({
      path: params.path,
      token: params.token,
    }),
    {
      method: "PUT",
      headers: {
        "cache-control": "max-age=3600",
        "content-type": params.contentType,
      },
      body: params.bytes,
      signal: params.signal,
    },
  );

  if (response.ok) {
    return;
  }

  const clonedResponse = response.clone();
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;
  const fallbackText = await clonedResponse.text().catch(() => "");
  throw new Error(
    payload?.message ??
      payload?.error ??
      (fallbackText.trim().length > 0 ? fallbackText.trim().slice(0, 240) : null) ??
      `Upload failed with status ${response.status}.`,
  );
}

async function uploadAudioFileToSignedUrl(params: {
  t: Translate<MessageKey>;
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
  path: string;
  token: string;
  file: File;
  contentType: string;
  signal?: AbortSignal;
}) {
  const upload = async (body: File | ArrayBuffer) =>
    params.supabase.storage
      .from(STORAGE_BUCKET)
      .uploadToSignedUrl(params.path, params.token, body, {
        contentType: params.contentType,
        upsert: true,
      });

  assertNotAborted(params.signal);

  try {
    const uploadResult = await upload(params.file);

    if (!uploadResult.error) {
      return;
    }
  } catch (error) {
    if (params.signal?.aborted) {
      throw error;
    }
  }

  assertNotAborted(params.signal);
  const fileBytes = await readUploadBytes(params.file, params.t);
  assertNotAborted(params.signal);

  try {
    await uploadRawBytesToSignedUrl({
      path: params.path,
      token: params.token,
      bytes: fileBytes,
      contentType: params.contentType,
      signal: params.signal,
    });
  } catch (error) {
    throw createUploadError(error instanceof Error ? error : {}, params.t);
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
