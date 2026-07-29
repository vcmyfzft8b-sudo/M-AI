import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "@/lib/api-auth";
import { canAccessLectureContent, createBillingRequiredResponse } from "@/lib/billing";
import { MAX_SCAN_IMAGE_BYTES, STORAGE_BUCKET } from "@/lib/constants";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  buildLectureNoteMediaStoragePath,
  inferScanImageMimeTypeFromFile,
  isSupportedScanImageMimeType,
} from "@/lib/storage";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const NOTE_MEDIA_UPLOAD_MAX_BYTES = 16 * 1024;

const createNoteMediaUploadSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120),
  byteSize: z.number().int().min(1).max(MAX_SCAN_IMAGE_BYTES),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getApiUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:note-media-uploads:post",
    rules: rateLimitPresets.upload,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, createNoteMediaUploadSchema, {
    maxBytes: NOTE_MEDIA_UPLOAD_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const access = await canAccessLectureContent(user.id, id);

  if (!access.allowed) {
    return createBillingRequiredResponse(
      "Za urejanje tega zapiska je potreben plačljiv paket.",
      access.code,
    );
  }

  const mimeType = inferScanImageMimeTypeFromFile({
    mimeType: parsed.data.mimeType,
    fileName: parsed.data.fileName,
  });

  if (!isSupportedScanImageMimeType(mimeType, parsed.data.fileName)) {
    return NextResponse.json(
      { error: "Podprte so fotografije JPG, PNG, WebP, HEIC ali HEIF." },
      { status: 400 },
    );
  }

  const mediaId = crypto.randomUUID();
  const path = buildLectureNoteMediaStoragePath({
    userId: user.id,
    lectureId: id,
    mediaId,
    mimeType,
  });
  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.token) {
    return NextResponse.json(
      { error: error?.message ?? "Nalaganja fotografije ni bilo mogoče pripraviti." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    mediaId,
    path,
    token: data.token,
    mimeType,
    maxBytes: MAX_SCAN_IMAGE_BYTES,
  });
}
