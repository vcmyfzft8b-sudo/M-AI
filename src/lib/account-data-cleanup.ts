import "server-only";

import { parseAudioChunkManifest } from "@/lib/audio-processing";
import { STORAGE_BUCKET } from "@/lib/constants";
import { extractScanImageStoragePaths } from "@/lib/scan-image-uploads";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceRoleClient>;

type LectureStorageRow = {
  id: string;
  storage_path: string | null;
  processing_metadata: unknown;
};

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.filter((path) => path.length > 0)));
}

function getAudioChunkPaths(processingMetadata: unknown) {
  const metadata = processingMetadata && typeof processingMetadata === "object"
    ? (processingMetadata as Record<string, unknown>)
    : null;

  return parseAudioChunkManifest(metadata?.audioChunks ?? null).map((chunk) => chunk.path);
}

export async function collectLectureStorageObjectPaths(params: {
  service?: ServiceClient;
  userId: string;
  lectureIds?: string[];
}) {
  const service = params.service ?? createSupabaseServiceRoleClient();
  const lectureIds = uniquePaths(params.lectureIds ?? []);
  let lecturesQuery = service
    .from("lectures")
    .select("id, storage_path, processing_metadata")
    .eq("user_id", params.userId);

  if (lectureIds.length > 0) {
    lecturesQuery = lecturesQuery.in("id", lectureIds);
  }

  const { data: lectures, error: lecturesError } = await lecturesQuery;

  if (lecturesError) {
    throw lecturesError;
  }

  const lectureRows = (lectures ?? []) as LectureStorageRow[];
  const resolvedLectureIds = lectureRows.map((lecture) => lecture.id);
  const storagePaths = lectureRows.flatMap((lecture) => [
    ...(lecture.storage_path ? [lecture.storage_path] : []),
    ...getAudioChunkPaths(lecture.processing_metadata),
    ...extractScanImageStoragePaths(lecture.processing_metadata),
  ]);

  if (resolvedLectureIds.length === 0) {
    return {
      lectureIds: resolvedLectureIds,
      storagePaths: uniquePaths(storagePaths),
    };
  }

  const [{ data: noteMediaRows, error: noteMediaError }, { data: ttsRows, error: ttsError }] =
    await Promise.all([
      service
        .from("lecture_note_media")
        .select("storage_path")
        .eq("user_id", params.userId)
        .in("lecture_id", resolvedLectureIds),
      service
        .from("lecture_tts_chunks")
        .select("audio_storage_path")
        .in("lecture_id", resolvedLectureIds),
    ]);

  if (noteMediaError) {
    throw noteMediaError;
  }

  if (ttsError) {
    throw ttsError;
  }

  return {
    lectureIds: resolvedLectureIds,
    storagePaths: uniquePaths([
      ...storagePaths,
      ...((noteMediaRows ?? []) as Array<{ storage_path: string | null }>)
        .map((row) => row.storage_path)
        .filter((path): path is string => Boolean(path)),
      ...((ttsRows ?? []) as Array<{ audio_storage_path: string | null }>)
        .map((row) => row.audio_storage_path)
        .filter((path): path is string => Boolean(path)),
    ]),
  };
}

export async function removeLectureStorageObjects(params: {
  service?: ServiceClient;
  storagePaths: string[];
}) {
  const storagePaths = uniquePaths(params.storagePaths);

  if (storagePaths.length === 0) {
    return;
  }

  const service = params.service ?? createSupabaseServiceRoleClient();
  const { error } = await service.storage.from(STORAGE_BUCKET).remove(storagePaths);

  if (error) {
    throw error;
  }
}

export async function removeAccountResidualDatabaseRows(params: {
  service?: ServiceClient;
  userId: string;
  email?: string | null;
}) {
  const service = params.service ?? createSupabaseServiceRoleClient();
  const normalizedEmail = params.email?.trim().toLowerCase() ?? null;
  const deletions = [
    service.from("ai_usage_events").delete().eq("user_id", params.userId),
    service.from("api_rate_limits").delete().eq("rate_key", `user:${params.userId}`),
  ];

  if (normalizedEmail) {
    deletions.push(
      service.from("email_auth_requests" as never).delete().eq("email", normalizedEmail),
    );
  }

  const results = await Promise.all(deletions);
  const failedResult = results.find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }
}
