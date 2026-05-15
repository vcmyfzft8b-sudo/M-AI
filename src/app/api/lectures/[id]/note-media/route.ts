import { NextResponse } from "next/server";

import { STORAGE_BUCKET } from "@/lib/constants";
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
