import "server-only";

import { getServerEnv } from "@/lib/server-env";

/**
 * Every model call in the generation pipelines is tagged with one of these stages. The stage
 * both resolves the model to use and labels the row in `ai_usage_events`, so cost per pipeline
 * step is visible in the admin dashboard.
 */
export type GenerationStage =
  | "note_map"
  | "note_write"
  | "study_extract"
  | "study_merge"
  | "study_plan"
  | "flashcard_write"
  | "quiz_write"
  | "practice_write"
  | "practice_grade"
  | "practice_grade_photo";

// Note writing is the one stage where prose quality dominates extraction accuracy, and the one
// stage benchmarked to be worth a stronger model. Everything else runs on the fast text model.
const NOTE_WRITE_DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function resolveGenerationModel(stage: GenerationStage) {
  const env = getServerEnv();
  const override = process.env[`GENERATION_MODEL_${stage.toUpperCase()}`];

  if (override && override.trim().length > 0) {
    return override.trim();
  }

  if (stage === "note_write") {
    return process.env.GEMINI_NOTE_MODEL?.trim() || NOTE_WRITE_DEFAULT_MODEL;
  }

  return env.GEMINI_TEXT_MODEL;
}
