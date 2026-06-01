import "server-only";

import {
  getInitialNoteAudioVoice,
  isRecord,
  shouldCreateInitialNoteAudio,
} from "@/lib/lecture-source-metadata";
import {
  extractWebpageImages,
  storeDocumentImagesAsNoteMedia,
} from "@/lib/document-image-extraction";
import {
  fetchReadableWebpage,
  prepareLectureFromTextSource,
} from "@/lib/manual-lectures";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type StoredLinkProcessingResult = {
  needsNotesGeneration: boolean;
};

function parsePendingLinkUrl(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function processStoredLinkLecture(params: {
  lectureId: string;
}): Promise<StoredLinkProcessingResult> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id, user_id, language_hint, processing_metadata")
    .eq("id", params.lectureId)
    .single();

  if (lectureError || !lecture) {
    throw new Error(lectureError?.message ?? "Zapiska ni bilo mogoče najti.");
  }

  const lectureRow = lecture as {
    id: string;
    user_id: string;
    language_hint: string | null;
    processing_metadata: unknown;
  };
  const metadata = isRecord(lectureRow.processing_metadata)
    ? lectureRow.processing_metadata
    : {};
  const pendingLinkUrl = parsePendingLinkUrl(metadata.pendingLinkUrl);

  if (!pendingLinkUrl) {
    throw new Error("Ni povezave za obdelavo.");
  }

  const { error: statusError } = await supabase
    .from("lectures")
    .update(
      {
        status: "queued",
        error_message: null,
        processing_metadata: {
          ...metadata,
          processing: {
            stage: "reading_link",
            updatedAt: new Date().toISOString(),
            errorMessage: null,
          },
        },
      } as never,
    )
    .eq("id", lectureRow.id)
    .eq("user_id", lectureRow.user_id);

  if (statusError) {
    throw new Error(statusError.message);
  }

  const webpage = await fetchReadableWebpage({
    url: pendingLinkUrl,
  });
  const extractedImages = await extractWebpageImages({
    html: webpage.html,
    pageUrl: webpage.finalUrl,
    pageTitle: webpage.title,
  });
  const documentImages = await storeDocumentImagesAsNoteMedia({
    lectureId: lectureRow.id,
    userId: lectureRow.user_id,
    images: extractedImages,
  });

  await prepareLectureFromTextSource({
    lectureId: lectureRow.id,
    userId: lectureRow.user_id,
    sourceType: "link",
    text: webpage.text,
    titleHint: webpage.title,
    languageHint: lectureRow.language_hint ?? "sl",
    createInitialAudio: shouldCreateInitialNoteAudio(metadata),
    initialAudioVoice: getInitialNoteAudioVoice(metadata),
    modelMetadata: {
      importMode: "link",
      sourceUrl: pendingLinkUrl,
      documentImages,
    },
  });

  return { needsNotesGeneration: true };
}
