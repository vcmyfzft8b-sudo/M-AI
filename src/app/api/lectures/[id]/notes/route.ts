import { NextResponse } from "next/server";
import { z } from "zod";

import type { Json } from "@/lib/database.types";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import {
  collectNoteEditorMediaIds,
  getEditableNotesMetadata,
  noteEditorDocumentToMarkdown,
  noteEditorDocumentToPlainText,
  validateNoteEditorDocument,
} from "@/lib/note-editor";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const UPDATE_NOTES_MAX_BYTES = 950 * 1024;

const updateNotesSchema = z.object({
  document: z.unknown(),
  revision: z.number().int().nonnegative(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonRecord(value: Json | null | undefined): Record<string, Json> {
  return isRecord(value) ? (value as Record<string, Json>) : {};
}

function isEditableNotesSchemaError(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  const message = error.message ?? "";
  return (
    error.code === "PGRST204" ||
    message.includes("editable_notes_") ||
    message.includes("lecture_note_media")
  );
}

function getMetadataRevision(modelMetadata: Json | null | undefined) {
  const revision = getEditableNotesMetadata({ model_metadata: modelMetadata ?? {} }).revision;
  return typeof revision === "number" && Number.isInteger(revision) ? revision : 0;
}

function withEditableNotesMetadata({
  modelMetadata,
  document,
  markdown,
  plainText,
  revision,
  updatedAt,
}: {
  modelMetadata: Json | null | undefined;
  document: Json;
  markdown: string;
  plainText: string;
  revision: number;
  updatedAt: string;
}) {
  const metadata = toJsonRecord(modelMetadata);

  return {
    ...metadata,
    editableNotes: {
      ...(isRecord(metadata.editableNotes) ? metadata.editableNotes : {}),
      doc: document,
      markdown,
      plainText,
      revision,
      updatedAt,
    },
  } satisfies Json;
}

export async function PATCH(
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
    route: "api:lectures:notes:patch",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID zapiska." }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, updateNotesSchema, {
    maxBytes: UPDATE_NOTES_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
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
      { error: "Zapisek lahko urejaš, ko je obdelava končana." },
      { status: 409 },
    );
  }

  const validated = validateNoteEditorDocument(parsed.data.document);

  if (!validated.success) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const service = createSupabaseServiceRoleClient();
  const artifactResult = await service
    .from("lecture_artifacts")
    .select("lecture_id, editable_notes_revision, model_metadata")
    .eq("lecture_id", id)
    .single();

  let useEditableNotesColumns = true;
  let currentRevision = 0;
  let currentModelMetadata: Json | null = null;

  if (artifactResult.error) {
    if (!isEditableNotesSchemaError(artifactResult.error)) {
      return NextResponse.json({ error: artifactResult.error.message }, { status: 500 });
    }

    const fallbackArtifactResult = await service
      .from("lecture_artifacts")
      .select("lecture_id, model_metadata")
      .eq("lecture_id", id)
      .single();

    if (fallbackArtifactResult.error) {
      return NextResponse.json({ error: fallbackArtifactResult.error.message }, { status: 500 });
    }

    useEditableNotesColumns = false;
    currentModelMetadata = (fallbackArtifactResult.data as { model_metadata?: Json | null })
      .model_metadata ?? null;
    currentRevision = getMetadataRevision(currentModelMetadata);
  } else {
    const artifact = artifactResult.data as {
      editable_notes_revision?: number;
      model_metadata?: Json | null;
    } | null;

    currentModelMetadata = artifact?.model_metadata ?? null;
    currentRevision =
      typeof artifact?.editable_notes_revision === "number"
        ? artifact.editable_notes_revision
        : getMetadataRevision(currentModelMetadata);
  }

  if (currentRevision !== parsed.data.revision) {
    return NextResponse.json(
      {
        error: "Zapisek je bil spremenjen drugje. Osveži stran in poskusi znova.",
        code: "revision_conflict",
        revision: currentRevision,
      },
      { status: 409 },
    );
  }

  const mediaIds = collectNoteEditorMediaIds(validated.document);

  if (mediaIds.length > 0) {
    const { data: mediaRows, error: mediaError } = await service
      .from("lecture_note_media")
      .select("id")
      .eq("lecture_id", id)
      .eq("user_id", user.id)
      .in("id", mediaIds);

    if (mediaError) {
      return NextResponse.json({ error: mediaError.message }, { status: 500 });
    }

    const ownedMediaIds = new Set(
      ((mediaRows ?? []) as Array<{ id: string }>).map((row) => row.id),
    );
    const hasUnownedMedia = mediaIds.some((mediaId) => !ownedMediaIds.has(mediaId));

    if (hasUnownedMedia) {
      return NextResponse.json(
        { error: "Zapisek vsebuje sliko, ki ne pripada temu zapisku." },
        { status: 400 },
      );
    }
  }

  const nextRevision = currentRevision + 1;
  const now = new Date().toISOString();
  const markdown = noteEditorDocumentToMarkdown(validated.document);
  const plainText = noteEditorDocumentToPlainText(validated.document);

  if (!useEditableNotesColumns) {
    const { data: updatedFallback, error: updateFallbackError } = await service
      .from("lecture_artifacts")
      .update(
        {
          model_metadata: withEditableNotesMetadata({
            modelMetadata: currentModelMetadata,
            document: validated.document as unknown as Json,
            markdown,
            plainText,
            revision: nextRevision,
            updatedAt: now,
          }),
        } as never,
      )
      .eq("lecture_id", id)
      .select("model_metadata")
      .maybeSingle();

    if (updateFallbackError) {
      return NextResponse.json({ error: updateFallbackError.message }, { status: 500 });
    }

    if (!updatedFallback) {
      return NextResponse.json(
        {
          error: "Zapisek je bil spremenjen drugje. Osveži stran in poskusi znova.",
          code: "revision_conflict",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      revision: nextRevision,
      updatedAt: now,
      markdown,
    });
  }

  const { data: updated, error: updateError } = await service
    .from("lecture_artifacts")
    .update(
      {
        editable_notes_doc: validated.document,
        editable_notes_md: markdown,
        editable_notes_plain: plainText,
        editable_notes_revision: nextRevision,
        editable_notes_updated_at: now,
      } as never,
    )
    .eq("lecture_id", id)
    .eq("editable_notes_revision", currentRevision)
    .select("editable_notes_revision, editable_notes_updated_at, editable_notes_md")
    .maybeSingle();

  if (updateError && isEditableNotesSchemaError(updateError)) {
    const { data: updatedFallback, error: updateFallbackError } = await service
      .from("lecture_artifacts")
      .update(
        {
          model_metadata: withEditableNotesMetadata({
            modelMetadata: currentModelMetadata,
            document: validated.document as unknown as Json,
            markdown,
            plainText,
            revision: nextRevision,
            updatedAt: now,
          }),
        } as never,
      )
      .eq("lecture_id", id)
      .select("model_metadata")
      .maybeSingle();

    if (updateFallbackError) {
      return NextResponse.json({ error: updateFallbackError.message }, { status: 500 });
    }

    if (!updatedFallback) {
      return NextResponse.json(
        {
          error: "Zapisek je bil spremenjen drugje. Osveži stran in poskusi znova.",
          code: "revision_conflict",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      revision: nextRevision,
      updatedAt: now,
      markdown,
    });
  }

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      {
        error: "Zapisek je bil spremenjen drugje. Osveži stran in poskusi znova.",
        code: "revision_conflict",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    revision: nextRevision,
    updatedAt: now,
    markdown,
  });
}
