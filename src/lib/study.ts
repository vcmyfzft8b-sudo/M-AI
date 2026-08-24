import "server-only";

import type {
  Citation,
  FlashcardRow,
  LectureArtifactRow,
  LectureRow,
  LectureStudyAssetRow,
  LectureStudySectionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import { TRANSCRIPT_SEGMENT_CONTENT_SELECT } from "@/lib/database-selects";
import { writeFlashcards, MAX_FLASHCARDS, STUDY_PIPELINE_VERSION } from "@/lib/generation/flashcards";
import {
  extractLearningPoints,
  planStudySections,
  type LearningPoint,
} from "@/lib/generation/learning-points";
import {
  buildSegmentsByIdx,
  buildSourceDocument,
  buildUnitCitation,
} from "@/lib/generation/source";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: string; details?: string | null; hint?: string | null };
    const parts = [candidate.message, candidate.details, candidate.hint].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown flashcard generation error.";
}

async function setStudyAssetStatus(params: {
  lectureId: string;
  status: LectureStudyAssetRow["status"];
  errorMessage?: string | null;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();

  const { error } = await supabase.from("lecture_study_assets").upsert(
    {
      lecture_id: params.lectureId,
      status: params.status,
      error_message: params.errorMessage ?? null,
      model_metadata: params.modelMetadata ?? {},
      generated_at: new Date().toISOString(),
    } as never,
    { onConflict: "lecture_id" },
  );

  if (error) {
    throw error;
  }
}

async function fetchExistingDeck(lectureId: string) {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: flashcards, error: flashcardsError }, { data: sections, error: sectionsError }] =
    await Promise.all([
      supabase
        .from("flashcards")
        .select("*")
        .eq("lecture_id", lectureId)
        .order("idx", { ascending: true }),
      supabase
        .from("lecture_study_sections")
        .select("*")
        .eq("lecture_id", lectureId)
        .order("idx", { ascending: true }),
    ]);

  if (flashcardsError) {
    throw flashcardsError;
  }

  if (sectionsError) {
    throw sectionsError;
  }

  return {
    flashcards: (flashcards ?? []) as FlashcardRow[],
    sections: (sections ?? []) as LectureStudySectionRow[],
  };
}

async function restorePreviousDeck(params: {
  lectureId: string;
  previousSections: LectureStudySectionRow[];
  previousFlashcards: FlashcardRow[];
}) {
  const supabase = createSupabaseServiceRoleClient();

  await supabase.from("flashcards").delete().eq("lecture_id", params.lectureId);
  await supabase.from("lecture_study_sections").delete().eq("lecture_id", params.lectureId);

  if (params.previousSections.length > 0) {
    await supabase
      .from("lecture_study_sections")
      .insert(params.previousSections.map((section) => ({ ...section })) as never);
  }

  if (params.previousFlashcards.length > 0) {
    await supabase
      .from("flashcards")
      .insert(params.previousFlashcards.map((flashcard) => ({ ...flashcard })) as never);
  }
}

function buildPointCitations(
  point: LearningPoint,
  segmentsByIdx: ReturnType<typeof buildSegmentsByIdx>,
): Citation[] {
  const citations: Citation[] = [];

  for (const unit of point.units.slice(0, 2)) {
    const citation = buildUnitCitation(unit, segmentsByIdx);

    if (citation) {
      citations.push(citation);
    }
  }

  return citations;
}

export async function generateLectureFlashcards(params: { lectureId: string }) {
  const supabase = createSupabaseServiceRoleClient();

  await setStudyAssetStatus({
    lectureId: params.lectureId,
    status: "generating",
    modelMetadata: { stage: "building_sections", pipeline: STUDY_PIPELINE_VERSION },
  });

  try {
    const [
      { data: lecture, error: lectureError },
      { data: artifact, error: artifactError },
      { data: transcript, error: transcriptError },
    ] = await Promise.all([
      supabase.from("lectures").select("*").eq("id", params.lectureId).single(),
      supabase
        .from("lecture_artifacts")
        .select("*")
        .eq("lecture_id", params.lectureId)
        .maybeSingle(),
      supabase
        .from("transcript_segments")
        .select(TRANSCRIPT_SEGMENT_CONTENT_SELECT)
        .eq("lecture_id", params.lectureId)
        .order("idx", { ascending: true }),
    ]);

    if (lectureError) {
      throw lectureError;
    }

    if (artifactError) {
      throw artifactError;
    }

    if (transcriptError) {
      throw transcriptError;
    }

    const lectureRow = lecture as LectureRow;
    const artifactRow = (artifact as LectureArtifactRow | null) ?? null;
    const segments = ((transcript ?? []) as TranscriptSegmentRow[]).map((segment) => ({
      idx: segment.idx,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      speakerLabel: segment.speaker_label,
      text: segment.text,
    }));

    if (segments.length === 0) {
      throw new Error("The lecture transcript is empty.");
    }

    const sourceType = lectureRow.source_type === "audio" ? "audio" : "document";
    const source = buildSourceDocument(segments, sourceType);
    const segmentsByIdx = buildSegmentsByIdx(segments);
    const notesTitle = lectureRow.title ?? artifactRow?.summary?.slice(0, 80) ?? null;
    const context = { lectureId: lectureRow.id, userId: lectureRow.user_id };

    const points = await extractLearningPoints({
      source,
      notesTitle,
      languageCode: lectureRow.language_hint,
      context,
    });

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "planning_coverage",
        pipeline: STUDY_PIPELINE_VERSION,
        learningPointCount: points.length,
      },
    });

    const sectionPlans = await planStudySections({
      points,
      notesTitle,
      languageCode: lectureRow.language_hint,
      context,
    });

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "generating_cards",
        pipeline: STUDY_PIPELINE_VERSION,
        learningPointCount: points.length,
        sectionCount: sectionPlans.length,
      },
    });

    let deck = await writeFlashcards({
      sections: sectionPlans,
      notesTitle,
      languageCode: lectureRow.language_hint,
      context,
    });

    // Cap the deck by shedding the least important cards first, never core ones.
    const totalCards = deck.reduce((total, entry) => total + entry.cards.length, 0);

    if (totalCards > MAX_FLASHCARDS) {
      let excess = totalCards - MAX_FLASHCARDS;

      for (const importance of ["detail", "supporting"] as const) {
        if (excess <= 0) {
          break;
        }

        for (const entry of [...deck].reverse()) {
          if (excess <= 0) {
            break;
          }

          const kept = [] as typeof entry.cards;
          for (const card of entry.cards) {
            if (excess > 0 && card.point.importance === importance) {
              excess -= 1;
            } else {
              kept.push(card);
            }
          }
          entry.cards = kept;
        }
      }

      deck = deck.filter((entry) => entry.cards.length > 0);
    }

    if (deck.length === 0) {
      throw new Error("Flashcard generation produced no cards.");
    }

    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "generating",
      modelMetadata: {
        stage: "publishing_deck",
        pipeline: STUDY_PIPELINE_VERSION,
      },
    });

    const previous = await fetchExistingDeck(params.lectureId);

    await supabase.from("flashcards").delete().eq("lecture_id", params.lectureId);
    await supabase.from("lecture_study_sections").delete().eq("lecture_id", params.lectureId);

    try {
      const importanceRank = { core: 0, supporting: 1, detail: 2 } as const;
      let cardIdx = 0;

      for (const [sectionIdx, entry] of deck.entries()) {
        const sectionUnits = entry.section.points.flatMap((point) => point.units);
        const unitStartIdx = Math.min(...sectionUnits.map((unit) => unit.segStartIdx));
        const unitEndIdx = Math.max(...sectionUnits.map((unit) => unit.segEndIdx));
        const startMs = Math.min(...sectionUnits.map((unit) => unit.startMs));
        const endMs = Math.max(...sectionUnits.map((unit) => unit.endMs));
        const firstUnit = sectionUnits.reduce((first, unit) =>
          unit.unitId < first.unitId ? unit : first,
        );
        const lastUnit = sectionUnits.reduce((last, unit) =>
          unit.unitId > last.unitId ? unit : last,
        );

        const { data: insertedSection, error: sectionError } = await supabase
          .from("lecture_study_sections")
          .insert({
            lecture_id: params.lectureId,
            idx: sectionIdx,
            title: entry.section.title,
            source_label:
              sourceType === "audio"
                ? `${firstUnit.locatorLabel.split("–")[0]}–${lastUnit.locatorLabel.split("–").at(-1)}`
                : `${firstUnit.locatorLabel}–${lastUnit.locatorLabel}`,
            source_start_ms: sourceType === "audio" ? startMs : null,
            source_end_ms: sourceType === "audio" ? endMs : null,
            source_page_start: null,
            source_page_end: null,
            unit_start_idx: unitStartIdx,
            unit_end_idx: unitEndIdx,
            card_count: entry.cards.length,
          } as never)
          .select("id")
          .single();

        if (sectionError) {
          throw sectionError;
        }

        const sectionId = (insertedSection as { id: string }).id;
        const cardsToInsert = entry.cards.map((card) => {
          const primaryUnit = card.point.units[0];

          return {
            lecture_id: params.lectureId,
            idx: cardIdx++,
            front: card.front,
            back: card.back,
            hint: card.hint,
            citations_json: buildPointCitations(card.point, segmentsByIdx),
            difficulty: card.difficulty,
            section_id: sectionId,
            source_unit_idx: primaryUnit?.unitId ?? 0,
            card_kind: card.kind,
            concept_key: card.point.conceptKey,
            source_type: lectureRow.source_type,
            source_locator: primaryUnit?.locatorLabel ?? null,
            coverage_rank: importanceRank[card.point.importance],
          };
        });

        const { error: cardsError } = await supabase
          .from("flashcards")
          .insert(cardsToInsert as never);

        if (cardsError) {
          throw cardsError;
        }
      }

      await setStudyAssetStatus({
        lectureId: params.lectureId,
        status: "ready",
        modelMetadata: {
          stage: "ready",
          pipeline: STUDY_PIPELINE_VERSION,
          cardCount: cardIdx,
          sectionCount: deck.length,
          learningPointCount: points.length,
        },
      });

      return { cardCount: cardIdx, sectionCount: deck.length };
    } catch (error) {
      await restorePreviousDeck({
        lectureId: params.lectureId,
        previousSections: previous.sections,
        previousFlashcards: previous.flashcards,
      });
      throw error;
    }
  } catch (error) {
    await setStudyAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: { stage: "failed", pipeline: STUDY_PIPELINE_VERSION },
    });

    throw error;
  }
}
