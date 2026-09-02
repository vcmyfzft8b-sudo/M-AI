import { NextResponse } from "next/server";
import { z } from "zod";

import { parseAudioChunkManifest } from "@/lib/audio-processing";
import {
  claimTrialLecture,
  createBillingRequiredResponse,
  getUserEntitlementState,
} from "@/lib/billing";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "@/lib/constants";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { extractScanImageStoragePaths } from "@/lib/scan-image-uploads";
import { noteTtsVoiceSchema } from "@/lib/note-tts-voice-schema";
import {
  buildLectureStoragePath,
  isSupportedAudioMimeType,
  normalizeUploadAudioMimeType,
} from "@/lib/storage";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { createSanitizedStringSchema, languageHintSchema, optionalUploadFileNameSchema } from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const CREATE_LECTURE_MAX_BYTES = 8 * 1024;
const DELETE_LECTURES_MAX_BYTES = 16 * 1024;

const createLectureSchema = z.object({
  mimeType: createSanitizedStringSchema({ minLength: 1, maxLength: 120 }),
  fileName: optionalUploadFileNameSchema,
  size: z.number().int().positive().max(MAX_AUDIO_BYTES),
  durationSeconds: z.number().positive().max(MAX_AUDIO_SECONDS),
  // Kept optional for clients that still send it — a retry replays the
  // language a lecture was already transcribed in. Nothing asks a user for
  // one any more, and a default here would assert Slovenian over every
  // source the pipeline is now meant to detect for itself.
  languageHint: languageHintSchema.optional(),
  createInitialAudio: z.boolean().optional().default(false),
  initialAudioVoice: noteTtsVoiceSchema.optional(),
});

const deleteLecturesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  if (!entitlement.canCreateNotes) {
    return createBillingRequiredResponse(
      await tr("api.trialExhausted"),
      "trial_exhausted",
    );
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:create:post",
    rules: rateLimitPresets.uploadCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, createLectureSchema, {
    maxBytes: CREATE_LECTURE_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const mimeType = normalizeUploadAudioMimeType({
    mimeType: parsed.data.mimeType,
    fileName: parsed.data.fileName,
  });

  if (!isSupportedAudioMimeType(mimeType, parsed.data.fileName)) {
    return NextResponse.json(
      { error: await tr("api.unsupportedAudio") },
      { status: 400 },
    );
  }

  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .insert(
      {
        user_id: user.id,
        source_type: "audio",
        access_tier: entitlement.hasPaidAccess ? "paid" : "trial",
        status: "uploading",
        language_hint: parsed.data.languageHint ?? null,
        duration_seconds: Math.round(parsed.data.durationSeconds),
        processing_metadata: {
          createInitialAudio: parsed.data.createInitialAudio,
          initialAudioVoice: parsed.data.initialAudioVoice ?? null,
        },
      } as never,
    )
    .select("id")
    .single();

  if (lectureError || !lecture) {
    return NextResponse.json(
      { error: lectureError?.message ?? await tr("api.noteCreateFailed") },
      { status: 500 },
    );
  }

  const createdLecture = lecture as { id: string };

  if (!entitlement.hasPaidAccess) {
    const trialClaim = await claimTrialLecture(user.id, createdLecture.id);

    if (!trialClaim.allowed) {
      await supabase.from("lectures").delete().eq("id", createdLecture.id).eq("user_id", user.id);
      return createBillingRequiredResponse(
        await tr("api.trialAlreadyUsed"),
        "trial_exhausted",
      );
    }

    if (trialClaim.mode === "paid") {
      await supabase
        .from("lectures")
        .update({ access_tier: "paid" } as never)
        .eq("id", createdLecture.id)
        .eq("user_id", user.id);
    }
  }

  const path = buildLectureStoragePath({
    userId: user.id,
    lectureId: createdLecture.id,
    mimeType,
  });

  const service = createSupabaseServiceRoleClient();
  const { data: signedUpload, error: signedError } = await service.storage
    .from("lecture-audio")
    .createSignedUploadUrl(path);

  if (signedError || !signedUpload?.token) {
    return NextResponse.json(
      { error: signedError?.message ?? await tr("api.uploadTargetFailed") },
      { status: 500 },
    );
  }

  return NextResponse.json({
    lectureId: createdLecture.id,
    path,
    token: signedUpload.token,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:delete",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, deleteLecturesSchema, {
    maxBytes: DELETE_LECTURES_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const { data: ownedLectures, error: ownedLecturesError } = await supabase
    .from("lectures")
    .select("id, storage_path, processing_metadata")
    .eq("user_id", user.id)
    .in("id", parsed.data.ids);

  if (ownedLecturesError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const ownedLectureRows = (ownedLectures ?? []) as Array<{
    id: string;
    storage_path: string | null;
    processing_metadata: unknown;
  }>;
  const lectureIds = ownedLectureRows.map((lecture) => lecture.id);

  if (lectureIds.length === 0) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const service = createSupabaseServiceRoleClient();
  const { data: noteMediaRows, error: noteMediaError } = await service
    .from("lecture_note_media")
    .select("storage_path")
    .eq("user_id", user.id)
    .in("lecture_id", lectureIds);

  if (noteMediaError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("lectures")
    .delete()
    .eq("user_id", user.id)
    .in("id", lectureIds);

  if (deleteError) {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const storagePaths = ownedLectureRows
    .map((lecture) => lecture.storage_path)
    .filter((path): path is string => Boolean(path));
  const chunkPaths = ownedLectureRows.flatMap((lecture) =>
    parseAudioChunkManifest(
      lecture.processing_metadata && typeof lecture.processing_metadata === "object"
        ? (lecture.processing_metadata as Record<string, unknown>).audioChunks
        : null,
    ).map((chunk) => chunk.path),
  );
  const scanImagePaths = ownedLectureRows.flatMap((lecture) =>
    extractScanImageStoragePaths(lecture.processing_metadata),
  );
  const noteMediaPaths = ((noteMediaRows ?? []) as Array<{ storage_path: string | null }>)
    .map((row) => row.storage_path)
    .filter((path): path is string => Boolean(path));

  if (
    storagePaths.length > 0 ||
    chunkPaths.length > 0 ||
    scanImagePaths.length > 0 ||
    noteMediaPaths.length > 0
  ) {
    await service
      .storage
      .from("lecture-audio")
      .remove([...storagePaths, ...chunkPaths, ...scanImagePaths, ...noteMediaPaths]);
  }

  return NextResponse.json({ ok: true, deletedCount: lectureIds.length });
}
