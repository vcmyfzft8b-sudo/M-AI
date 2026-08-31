import { after, NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { MAX_DOCUMENT_BYTES, STORAGE_BUCKET } from "@/lib/constants";
import {
  isLegacyPowerPointDocument,
  isPdfDocument,
  isPptxDocument,
  isSupportedDocumentFile,
} from "@/lib/document-files";
import { validateDocumentFileSignature } from "@/lib/file-validation";
import { enqueueLectureDocumentProcessing } from "@/lib/jobs";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { NOTE_TTS_VOICES } from "@/lib/note-tts-settings";
import {
  buildValidationErrorResponse,
  parseFormDataRequest,
} from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  buildLectureDocumentStoragePath,
  normalizeUploadDocumentMimeType,
} from "@/lib/storage";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import {
  languageHintSchema,
  optionalDocumentLectureIdSchema,
  optionalOriginalFileNameSchema,
} from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

export const maxDuration = 300;
const PDF_UPLOAD_MAX_BYTES = MAX_DOCUMENT_BYTES + 256 * 1024;

const formBooleanSchema = z
  .union([z.boolean(), z.literal("true"), z.literal("false"), z.null()])
  .optional()
  .transform((value) => value === true || value === "true");
const formInitialAudioVoiceSchema = z
  .union([z.enum(NOTE_TTS_VOICES), z.null()])
  .optional()
  .transform((value) => value ?? undefined);

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const entitlement = await getUserEntitlementState(user.id);

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:pdf:post",
    rules: rateLimitPresets.expensiveCreate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedFormData = await parseFormDataRequest(request, {
    maxBytes: PDF_UPLOAD_MAX_BYTES,
  });

  if (!parsedFormData.success) {
    return parsedFormData.response;
  }

  const formData = parsedFormData.data;
  const parsedFields = z
    .object({
      lectureId: optionalDocumentLectureIdSchema,
      originalFileName: optionalOriginalFileNameSchema,
      // A missing field means "we do not know", not "Slovenian".
      languageHint: z
        .union([z.string(), z.null()])
        .transform((value) => (typeof value === "string" && value.trim() ? value : null))
        .pipe(languageHintSchema.nullable()),
      createInitialAudio: formBooleanSchema,
      initialAudioVoice: formInitialAudioVoiceSchema,
    })
    .safeParse({
      lectureId: formData.get("lectureId"),
      originalFileName: formData.get("originalFileName"),
      languageHint: formData.get("languageHint"),
      createInitialAudio: formData.get("createInitialAudio"),
      initialAudioVoice: formData.get("initialAudioVoice"),
    });
  const inputFile = formData.get("file");

  if (!parsedFields.success) {
    return await buildValidationErrorResponse(parsedFields.error);
  }

  const { lectureId, originalFileName, languageHint, createInitialAudio, initialAudioVoice } =
    parsedFields.data;

  if (!entitlement.hasPaidAccess && lectureId !== entitlement.trialLectureId) {
    return createBillingRequiredResponse(
      await tr("api.trialOnly.process"),
      "trial_exhausted",
    );
  }

  if (!(inputFile instanceof File)) {
    return NextResponse.json({ error: await tr("api.missingDocumentFile") }, { status: 400 });
  }

  if (isLegacyPowerPointDocument(inputFile)) {
    return NextResponse.json(
      {
        error: await tr("api.pptNotSupported"),
      },
      { status: 400 },
    );
  }

  if (!isSupportedDocumentFile(inputFile)) {
    return NextResponse.json(
      {
        error: await tr("file.unsupportedDocumentType"),
      },
      { status: 400 },
    );
  }

  const validatedDocument = await validateDocumentFileSignature(inputFile);

  if (!validatedDocument.ok) {
    return NextResponse.json({ error: validatedDocument.error }, { status: 400 });
  }

  try {
    const sourceFileName = originalFileName || inputFile.name;

    if (!lectureId) {
      return NextResponse.json({ error: await tr("api.missingLectureId") }, { status: 400 });
    }

    const { data: lecture, error: lectureError } = await supabase
      .from("lectures")
      .select("id")
      .eq("id", lectureId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (lectureError) {
      throw new Error(lectureError.message);
    }

    if (!lecture) {
      return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
    }

    const sourceType = isPdfDocument(inputFile)
      ? "pdf"
      : isPptxDocument(inputFile)
        ? "presentation"
        : "text";
    const mimeType = normalizeUploadDocumentMimeType({
      mimeType: inputFile.type || "application/octet-stream",
      fileName: sourceFileName,
    });
    const documentPath = buildLectureDocumentStoragePath({
      userId: user.id,
      lectureId,
      fileName: sourceFileName,
      mimeType,
    });
    const uploadResult = await createSupabaseServiceRoleClient()
      .storage
      .from(STORAGE_BUCKET)
      .upload(documentPath, inputFile, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadResult.error) {
      throw new Error(uploadResult.error.message);
    }

    const { error: updateError } = await supabase
      .from("lectures")
      .update(
        {
          source_type: sourceType,
          status: "queued",
          error_message: null,
          title: sourceFileName.replace(/\.[^.]+$/i, ""),
          language_hint: languageHint ?? null,
          processing_metadata: {
            createInitialAudio,
            initialAudioVoice: initialAudioVoice ?? null,
            pendingDocument: {
              path: documentPath,
              mimeType,
              fileName: sourceFileName,
              size: inputFile.size,
            },
            processing: {
              stage: "extracting_document_text",
              updatedAt: new Date().toISOString(),
              errorMessage: null,
            },
          },
        } as never,
      )
      .eq("id", lectureId)
      .eq("user_id", user.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    after(async () => {
      try {
        await enqueueLectureDocumentProcessing(lectureId);
      } catch (error) {
        await markLecturePipelineFailed({ lectureId, error });
      }
    });

    return NextResponse.json({ lectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : await tr("api.documentProcessFailed"),
      },
      { status: 500 },
    );
  }
}
