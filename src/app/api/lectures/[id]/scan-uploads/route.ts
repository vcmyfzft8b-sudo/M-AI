import { assertStorageOwnerActive } from "@/lib/mobile/storage-owner";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canAccessLectureContent, createBillingRequiredResponse } from "@/lib/billing";
import { MAX_SCAN_IMAGE_BYTES, MAX_SCAN_IMAGE_COUNT, STORAGE_BUCKET } from "@/lib/constants";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { captureRouteError } from "@/lib/monitoring";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  buildLectureScanImageStoragePath,
  isSupportedScanImageMimeType,
  normalizeUploadScanImageMimeType,
} from "@/lib/storage";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import {
  createSanitizedStringSchema,
  optionalUploadFileNameSchema,
  routeIdParamSchema,
} from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const PREPARE_SCAN_UPLOADS_MAX_BYTES = 32 * 1024;
const SIGNED_UPLOAD_MAX_ATTEMPTS = 3;
const SIGNED_UPLOAD_RETRY_DELAYS_MS = [300, 1000] as const;

const scanUploadFileSchema = z.object({
  index: z.number().int().min(0).max(MAX_SCAN_IMAGE_COUNT - 1),
  mimeType: createSanitizedStringSchema({ minLength: 1, maxLength: 120 }),
  fileName: optionalUploadFileNameSchema,
  size: z.number().int().positive().max(MAX_SCAN_IMAGE_BYTES),
});

const prepareScanUploadsSchema = z.object({
  files: z.array(scanUploadFileSchema).min(1).max(MAX_SCAN_IMAGE_COUNT),
});

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getStorageErrorMessage(error: unknown) {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return null;
}

function getStorageErrorStatus(error: unknown) {
  if (!isRecord(error)) {
    return null;
  }

  const status = error.status ?? error.statusCode ?? error.code;

  if (typeof status === "number") {
    return status;
  }

  if (typeof status === "string") {
    const parsedStatus = Number.parseInt(status, 10);
    return Number.isFinite(parsedStatus) ? parsedStatus : null;
  }

  return null;
}

function isTransientStorageError(error: unknown) {
  const status = getStorageErrorStatus(error);

  if (status != null) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  const message = getStorageErrorMessage(error)?.toLowerCase() ?? "";

  return [
    "bad gateway",
    "connection",
    "econnreset",
    "fetch failed",
    "gateway",
    "network",
    "service unavailable",
    "timeout",
    "temporarily",
    "upstream",
  ].some((fragment) => message.includes(fragment));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:scan-uploads:post",
    rules: rateLimitPresets.chunkUpload,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canAccessLectureContent(user.id, id);

  if (!access.allowed) {
    return createBillingRequiredResponse(
      await tr("api.paidRequired.upload"),
      access.code,
    );
  }

  const parsed = await parseJsonRequest(request, prepareScanUploadsSchema, {
    maxBytes: PREPARE_SCAN_UPLOADS_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  if (
    parsed.data.files.some(
      (file) => !isSupportedScanImageMimeType(file.mimeType, file.fileName),
    )
  ) {
    return NextResponse.json(
      { error: await tr("api.unsupportedPhotoFormat") },
      { status: 400 },
    );
  }

  const fileIndexes = new Set(parsed.data.files.map((file) => file.index));

  if (fileIndexes.size !== parsed.data.files.length) {
    return NextResponse.json(
      { error: await tr("api.duplicatePhotos") },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceRoleClient();
  const storage = service.storage.from(STORAGE_BUCKET);
  async function createSignedScanUploadUrl(path: string) {
    let attempts = 0;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= SIGNED_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      await assertStorageOwnerActive(user!.id);
      const { data: signedUpload, error } = await storage.createSignedUploadUrl(path, {
        upsert: true,
      });

      if (!error && signedUpload?.token) {
        return {
          attempts,
          error: null,
          signedUpload,
        };
      }

      lastError = error ?? new Error("Supabase did not return a signed upload token.");

      if (attempt >= SIGNED_UPLOAD_MAX_ATTEMPTS || !isTransientStorageError(lastError)) {
        break;
      }

      await sleep(SIGNED_UPLOAD_RETRY_DELAYS_MS[attempt - 1] ?? 1000);
    }

    return {
      attempts,
      error: lastError ?? new Error("Supabase did not return a signed upload token."),
      signedUpload: null,
    };
  }

  const manifests = parsed.data.files.map((file) => {
    const mimeType = normalizeUploadScanImageMimeType({
      mimeType: file.mimeType,
      fileName: file.fileName,
    });

    return {
      index: file.index,
      fileName: file.fileName ?? `photo-${file.index + 1}`,
      mimeType,
      size: file.size,
      path: buildLectureScanImageStoragePath({
        userId: user.id,
        lectureId: id,
        index: file.index,
        mimeType,
      }),
    };
  });

  const uploads = [];

  for (const manifest of manifests) {
    const { attempts, error, signedUpload } = await createSignedScanUploadUrl(manifest.path);

    if (error || !signedUpload) {
      const isTransient = isTransientStorageError(error);

      captureRouteError(
        error,
        {
          route: "/api/lectures/[id]/scan-uploads",
          operation: "createSignedUploadUrl",
          request,
          userId: user.id,
          lectureId: id,
          extra: {
            bucket: STORAGE_BUCKET,
            fileIndex: manifest.index,
            fileSize: manifest.size,
            mimeType: manifest.mimeType,
            attempts,
            storageStatus: getStorageErrorStatus(error),
            transientStorageError: isTransient,
            hasSignedUpload: Boolean(signedUpload),
          },
        },
      );

      return NextResponse.json(
        {
          error: isTransient
            ? await tr("api.storageBusy")
            : getStorageErrorMessage(error) ?? await tr("api.photoUploadPrepFailed"),
        },
        {
          status: isTransient ? 503 : 500,
          headers: isTransient ? { "Retry-After": "2" } : undefined,
        },
      );
    }

    uploads.push({
      index: manifest.index,
      path: manifest.path,
      token: signedUpload.token,
    });
  }

  const nextProcessingMetadata = {
    ...(lecture.processing_metadata && typeof lecture.processing_metadata === "object"
      ? lecture.processing_metadata
      : {}),
    pendingScanImages: manifests,
  };

  const { error: updateError } = await supabase
    .from("lectures")
    .update(
      {
        processing_metadata: nextProcessingMetadata,
      } as never,
    )
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateError) {
    captureRouteError(updateError, {
      route: "/api/lectures/[id]/scan-uploads",
      operation: "updateProcessingMetadata",
      request,
      userId: user.id,
      lectureId: id,
      extra: {
        pendingScanImageCount: manifests.length,
      },
    });

    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  return NextResponse.json({
    uploads,
  });
}
