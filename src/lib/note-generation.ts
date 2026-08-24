import "server-only";

import type { GenerationCallContext } from "@/lib/generation/llm";
import {
  generateNotesFromSource,
  NOTES_PIPELINE_VERSION,
  type GeneratedNotes,
} from "@/lib/generation/notes";
import type { GenerationSegment } from "@/lib/generation/source";

export { countWords } from "@/lib/generation/util";

export type NoteGenerationOptions = {
  sourceLabel: string;
  pipelineName: string;
  sourceType: "audio" | "document";
  outputLanguage?: string | null;
  sourceTitleHint?: string;
  context?: GenerationCallContext;
};

export async function generateNotesFromTranscript(
  segments: GenerationSegment[],
  options: NoteGenerationOptions,
): Promise<GeneratedNotes> {
  const notes = await generateNotesFromSource({
    segments,
    sourceType: options.sourceType,
    outputLanguage: options.outputLanguage,
    sourceTitleHint: options.sourceTitleHint,
    context: options.context,
  });

  return {
    ...notes,
    modelMetadata: {
      ...notes.modelMetadata,
      pipeline: NOTES_PIPELINE_VERSION,
      entryPipeline: options.pipelineName,
      sourceLabel: options.sourceLabel,
    },
  };
}
