import { NextResponse } from "next/server";

import { STORAGE_BUCKET } from "@/lib/constants";
import type { Json } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { noteEditorImageAttrs } from "@/lib/note-editor";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema, sanitizeUserInput } from "@/lib/validation";

const MAX_NOTE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 10 * 1024 * 1024;
const NOTE_IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonRecord(value: Json | null | undefined): Record<string, Json> {
  return isRecord(value) ? (value as Record<string, Json>) : {};
}

function isNoteMediaSchemaError(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  const message = error.message ?? "";
  return (
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    message.includes("lecture_note_media") ||
    message.includes("Could not find the table")
  );
}

async function saveFallbackMediaReference({
  service,
  lectureId,
  mediaId,
  storagePath,
  mimeType,
  byteSize,
  originalFileName,
}: {
  service: ReturnType<typeof createSupabaseServiceRoleClient>;
  lectureId: string;
  mediaId: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  originalFileName: string | null;
}) {
  const { data: artifact, error: artifactError } = await service
    .from("lecture_artifacts")
    .select("model_metadata")
    .eq("lecture_id", lectureId)
    .single();

  if (artifactError) {
    return { error: artifactError };
  }

  const modelMetadata = (artifact as { model_metadata?: Json | null } | null)?.model_metadata ?? {};
  const metadata = toJsonRecord(modelMetadata);
  const noteMedia = isRecord(metadata.editableNoteMedia)
    ? (metadata.editableNoteMedia as Record<string, Json>)
    : {};

  const nextMetadata = {
    ...metadata,
    editableNoteMedia: {
      ...noteMedia,
      [mediaId]: {
        storagePath,
        mimeType,
        byteSize,
        originalFileName,
        createdAt: new Date().toISOString(),
      },
    },
  } satisfies Json;

  const { error: updateError } = await service
    .from("lecture_artifacts")
    .update({ model_metadata: nextMetadata } as never)
    .eq("lecture_id", lectureId);

  return { error: updateError };
}

function getContentLength(request: Request) {
  const header = request.headers.get("content-length");

  if (!header) {
    return null;
  }

  const value = Number(header);
  return Number.isFinite(value) ? value : null;
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
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:note-media:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const contentLength = getContentLength(request);

  if (contentLength && contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ error: "Slika je prevelika." }, { status: 413 });
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

  if (lecture.status !== "ready") {
    return NextResponse.json(
      { error: "Slike lahko dodaš, ko je zapisek pripravljen." },
      { status: 409 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Manjka slika." }, { status: 400 });
  }

  const extension = NOTE_IMAGE_MIME_TO_EXTENSION[file.type];

  if (!extension) {
    return NextResponse.json(
      { error: "Podprte so samo JPG, PNG, WebP in GIF slike." },
      { status: 400 },
    );
  }

  if (file.size <= 0 || file.size > MAX_NOTE_IMAGE_BYTES) {
    return NextResponse.json({ error: "Slika je prevelika." }, { status: 413 });
  }

  const mediaId = crypto.randomUUID();
  const storagePath = `note-media/${user.id}/${id}/${mediaId}.${extension}`;
  const service = createSupabaseServiceRoleClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await service.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const originalFileName = file.name
    ? sanitizeUserInput(file.name, { collapseWhitespace: true }).slice(0, 255)
    : null;
  const { error: insertError } = await service
    .from("lecture_note_media")
    .insert({
      id: mediaId,
      lecture_id: id,
      user_id: user.id,
      storage_path: storagePath,
      mime_type: file.type,
      byte_size: file.size,
      original_file_name: originalFileName,
    } as never);

  if (insertError) {
    if (isNoteMediaSchemaError(insertError)) {
      const fallback = await saveFallbackMediaReference({
        service,
        lectureId: id,
        mediaId,
        storagePath,
        mimeType: file.type,
        byteSize: file.size,
        originalFileName,
      });

      if (!fallback.error) {
        return NextResponse.json({
          id: mediaId,
          ...noteEditorImageAttrs({
            lectureId: id,
            mediaId,
            alt: originalFileName,
          }),
        });
      }
    }

    await service.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    id: mediaId,
    ...noteEditorImageAttrs({
      lectureId: id,
      mediaId,
      alt: originalFileName,
    }),
  });
}
