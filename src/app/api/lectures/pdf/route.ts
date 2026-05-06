import { after, NextResponse } from "next/server";
import { z } from "zod";

import { createBillingRequiredResponse, getUserEntitlementState } from "@/lib/billing";
import { MAX_DOCUMENT_BYTES } from "@/lib/constants";
import {
  isLegacyPowerPointDocument,
  isPdfDocument,
  isPptxDocument,
  isSupportedDocumentFile,
} from "@/lib/document-files";
import { validateDocumentFileSignature } from "@/lib/file-validation";
import { enqueueLectureNotesGeneration } from "@/lib/jobs";
import {
  extractTextFromDocument,
  prepareLectureFromTextSource,
} from "@/lib/manual-lectures";
import { markLecturePipelineFailed } from "@/lib/pipeline";
import { parseFormDataRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  languageHintSchema,
  optionalDocumentLectureIdSchema,
  optionalOriginalFileNameSchema,
} from "@/lib/validation";

export const maxDuration = 300;
const PDF_UPLOAD_MAX_BYTES = MAX_DOCUMENT_BYTES + 256 * 1024;

function buildDocumentProcessingMetadata(params: {
  sourceType: "pdf" | "presentation" | "text";
  sourceFileName: string;
  languageHint: string;
}) {
  return {
    documentImport: {
      sourceType: params.sourceType,
      sourceFileName: params.sourceFileName,
      languageHint: params.languageHint,
      status: "extracting_text",
    },
    processing: {
      stage: "extracting_text",
      updatedAt: new Date().toISOString(),
      errorMessage: null,
    },
  };
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
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
      languageHint: z
        .union([z.string(), z.null()])
        .transform((value) => (typeof value === "string" ? value : "sl"))
        .pipe(languageHintSchema),
    })
    .safeParse({
      lectureId: formData.get("lectureId"),
      originalFileName: formData.get("originalFileName"),
      languageHint: formData.get("languageHint"),
    });
  const inputFile = formData.get("file");

  if (!parsedFields.success) {
    return NextResponse.json({ error: parsedFields.error.flatten() }, { status: 400 });
  }

  const { lectureId, originalFileName, languageHint } = parsedFields.data;

  if (!entitlement.hasPaidAccess && lectureId !== entitlement.trialLectureId) {
    return createBillingRequiredResponse(
      "Brez plačljivega paketa lahko obdelaš samo svoje brezplačno poskusno gradivo.",
      "trial_exhausted",
    );
  }

  if (!(inputFile instanceof File)) {
    return NextResponse.json({ error: "Manjka datoteka dokumenta." }, { status: 400 });
  }

  if (isLegacyPowerPointDocument(inputFile)) {
    return NextResponse.json(
      {
        error: "Stare PowerPoint datoteke .ppt še niso podprte. Shrani jo kot .pptx ali PDF in poskusi znova.",
      },
      { status: 400 },
    );
  }

  if (!isSupportedDocumentFile(inputFile)) {
    return NextResponse.json(
      {
        error: "Nepodprta vrsta dokumenta. Uporabi PDF, TXT, Markdown, HTML, RTF, DOCX ali PPTX.",
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

    if (lectureId) {
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
        return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
      }
    }

    const sourceType = isPdfDocument(inputFile)
      ? "pdf"
      : isPptxDocument(inputFile)
        ? "presentation"
        : "text";
    let nextLectureId = lectureId;
    const titleHint = sourceFileName.replace(/\.[^.]+$/i, "");
    const processingMetadata = buildDocumentProcessingMetadata({
      sourceType,
      sourceFileName,
      languageHint,
    });
    const queuedFileBytes = Buffer.from(await inputFile.arrayBuffer());

    if (!nextLectureId) {
      const { data: lecture, error: createError } = await supabase
        .from("lectures")
        .insert(
          {
            user_id: user.id,
            source_type: sourceType,
            access_tier: entitlement.hasPaidAccess ? "paid" : "trial",
            status: "queued",
            language_hint: languageHint,
            title: titleHint,
            error_message: null,
            processing_metadata: processingMetadata,
          } as never,
        )
        .select("id")
        .single();

      if (createError || !lecture) {
        throw new Error(createError?.message ?? "Zapiska ni bilo mogoče ustvariti.");
      }

      nextLectureId = (lecture as { id: string }).id;
    } else {
      const { error: updateError } = await supabase
        .from("lectures")
        .update(
          {
            source_type: sourceType,
            status: "queued",
            language_hint: languageHint,
            title: titleHint,
            error_message: null,
            processing_metadata: processingMetadata,
          } as never,
        )
        .eq("id", nextLectureId)
        .eq("user_id", user.id);

      if (updateError) {
        throw new Error(updateError.message);
      }
    }

    const queuedLectureId = nextLectureId;
    after(async () => {
      try {
        const queuedFile = new File([queuedFileBytes], inputFile.name || sourceFileName, {
          type: inputFile.type,
          lastModified: inputFile.lastModified,
        });
        const extracted = await extractTextFromDocument(queuedFile);
        const lectureInput = {
          userId: user.id,
          sourceType,
          text: extracted.text,
          blocks: extracted.pages.map((page) => ({
            label: sourceType === "presentation" ? `Prosojnica ${page.pageNumber}` : `Stran ${page.pageNumber}`,
            pageNumber: page.pageNumber,
            text: page.text,
          })),
          titleHint: extracted.title || titleHint,
          languageHint,
          modelMetadata: {
            importMode:
              sourceType === "pdf"
                ? "pdf"
                : sourceType === "presentation"
                  ? "presentation"
                  : "document",
            sourceFileName,
          },
          lectureId: queuedLectureId,
        };

        await prepareLectureFromTextSource(lectureInput);
        await enqueueLectureNotesGeneration(queuedLectureId);
      } catch (error) {
        await markLecturePipelineFailed({ lectureId: queuedLectureId, error });
      }
    });

    return NextResponse.json({ lectureId: nextLectureId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Dokumenta ni bilo mogoče obdelati.",
      },
      { status: 500 },
    );
  }
}
