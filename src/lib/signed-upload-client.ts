"use client";

import { STORAGE_BUCKET } from "@/lib/constants";
import { getPublicEnv } from "@/lib/public-env";
import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  SignedUploadError,
  abortError,
  runWithUploadRetries,
} from "@/lib/upload-retry-policy";

/**
 * Putting one file on a signed storage URL, and not giving up the first time a phone blinks.
 *
 * Three things happen in order, and only the last is allowed to fail the upload:
 *
 *  1. The Supabase client's own `uploadToSignedUrl`.
 *  2. The same bytes as a raw PUT. This is the older of the two paths, and it exists because iOS
 *     Safari fails the client's `File` body outright often enough to be worth a second shape —
 *     the audio uploader has done this since long before there was a retry loop around it.
 *  3. Both of the above again, for as long as the failure still looks like the network rather
 *     than the request. `upload-retry-policy.ts` owns that judgement.
 */

type BrowserSupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;

export { isRetryableUploadFailure } from "@/lib/upload-retry-policy";

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw abortError();
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

  /*
   * Carried as a status, not just a sentence, so the retry policy can tell a storage service
   * having a bad minute from a token it will refuse just as firmly next time.
   */
  throw new SignedUploadError(
    payload?.message ??
      payload?.error ??
      (fallbackText.trim().length > 0 ? fallbackText.trim().slice(0, 240) : null) ??
      `Upload failed with status ${response.status}.`,
    response.status,
  );
}

/** One pass over both shapes: the client's own upload, then the same bytes as a raw PUT. */
async function attemptUpload(params: {
  supabase: BrowserSupabaseClient;
  path: string;
  token: string;
  file: Blob;
  contentType: string;
  signal?: AbortSignal;
}) {
  assertNotAborted(params.signal);

  try {
    const uploadResult = await params.supabase.storage
      .from(STORAGE_BUCKET)
      .uploadToSignedUrl(params.path, params.token, params.file, {
        contentType: params.contentType,
        upsert: true,
      });

    if (!uploadResult.error) {
      return;
    }
  } catch (error) {
    if (params.signal?.aborted) {
      throw error;
    }
  }

  assertNotAborted(params.signal);
  const bytes = await params.file.arrayBuffer();
  assertNotAborted(params.signal);

  await uploadRawBytesToSignedUrl({
    path: params.path,
    token: params.token,
    bytes,
    contentType: params.contentType,
    signal: params.signal,
  });
}

export async function uploadToSignedUrlWithRetry(params: {
  supabase: BrowserSupabaseClient;
  path: string;
  token: string;
  file: Blob;
  contentType: string;
  signal?: AbortSignal;
  attempts?: number;
  onRetry?: (attempt: number, attempts: number) => void;
}) {
  await runWithUploadRetries({
    attempt: () => attemptUpload(params),
    attempts: params.attempts,
    signal: params.signal,
    onRetry: params.onRetry,
  });
}
