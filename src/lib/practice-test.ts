import "server-only";

import { z } from "zod";

import type {
  FlashcardDifficulty,
  LectureArtifactRow,
  LecturePracticeTestAssetRow,
  LectureRow,
  PracticeTestAttemptAnswerRow,
  PracticeTestAttemptRow,
  PracticeTestQuestionRow,
  TranscriptSegmentRow,
} from "@/lib/database.types";
import { generateStructuredObject } from "@/lib/ai/json";
import { generateStructuredObjectWithGeminiFile } from "@/lib/ai/gemini";
import { resolveMinimalThinkingConfig } from "@/lib/ai/gemini-models";
import { TRANSCRIPT_SEGMENT_CONTENT_SELECT } from "@/lib/database-selects";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { createCoveragePlan } from "@/lib/study-coverage";
import {
  buildItemPlans,
  extractStudyItems,
  generateItemPracticeDrafts,
  resolveStudyPipelineMode,
  STUDY_BATCH_CACHE_STAGES,
} from "@/lib/study-items";
import { isWorkAbortedError } from "@/lib/abort-context";
import { clearGenerationCache } from "@/lib/notes/generation-cache";
import {
  buildPracticeGradingInstructions,
  practiceGradingSchema,
  reportStudyCoverage,
} from "@/lib/notes/study-prompts";
import { isHighQualityStudyPrompt } from "@/lib/study-quality";
import {
  clampQuestionScore,
  isGradableAnswerGuide,
  isSurrenderAnswer,
  parseMarkingPoints,
  PRACTICE_QUESTION_MAX_SCORE,
  reconcilePointMarks,
  scoreFromRubric,
  summariseAttemptScores,
  truncateAnswerForGrading,
  type PointMark,
} from "@/lib/practice-test-scoring";
import {
  bankCoverageRatio,
  selectAttemptQuestions,
  shouldRebuildQuestionBank,
  shuffle,
  usableBankQuestions,
} from "@/lib/practice-test-selection";
import type { CoverageConcept, CoverageUnitPlan, SourceUnit } from "@/lib/study-models";
import { buildSourceUnits } from "@/lib/study-source-units";
import type {
  PracticeTestAttemptAnswer,
  PracticeTestAttemptWithAnswers,
  PracticeTestHistoryEntry,
  PracticeTestHistorySummary,
} from "@/lib/types";
import { getAiProvider, getServerEnv } from "@/lib/server-env";

// Raised 3 -> 6 with the 2026-08-28 GLM switch (~3x slower per call; batches independent).
const PRACTICE_TEST_CONCURRENCY = 6;
/**
 * v3 rebuilds a stored bank the first time a learner starts a test on it. v2 banks predate the
 * quality gate on the marking scheme and carry no importance rating, so a test drawn from one
 * cannot prefer the material that matters or promise that every question in it is markable.
 */
const PRACTICE_TEST_GENERATION_VERSION = "practice-test-v3";
const PRACTICE_TEST_GENERATION_ATTEMPTS = 3;
const RAW_GENERATED_PROMPT_MAX_LENGTH = 1200;
const RAW_GENERATED_ANSWER_GUIDE_MAX_LENGTH = 6000;
const PRACTICE_PROMPT_MAX_LENGTH = 220;
const PRACTICE_ANSWER_GUIDE_MAX_LENGTH = 1000;

type PracticeTestQuestionDraft = {
  prompt: string;
  answerGuide: string;
  difficulty: FlashcardDifficulty;
  conceptKey: string;
  sourceUnitIdx: number;
  sourceLocator: string | null;
  /** 1-5, how central the material behind this question is. */
  importance: number;
};

type AttemptQuestionMetadata = {
  questionIds: string[];
  attemptNumber: number;
  bankVersion: string;
  generationVersion: string;
};

const practiceQuestionSchema = z.object({
  prompt: z.string().min(12).max(RAW_GENERATED_PROMPT_MAX_LENGTH),
  answerGuide: z.string().min(30).max(RAW_GENERATED_ANSWER_GUIDE_MAX_LENGTH),
  difficulty: z.string().min(3).max(40),
  conceptKey: z.string().min(1).max(120),
});

const practiceQuestionBatchSchema = z.object({
  questions: z.array(practiceQuestionSchema).min(0).max(16),
});

/**
 * The photo grader still asks for a number: a photographed answer is read by the OCR model in one
 * call, and splitting that into a marking pass would mean reading the handwriting twice.
 */
const photoGradingSchema = z.object({
  score: z.number().int().min(0).max(5),
  expectedAnswer: z.string().min(1),
  rationale: z.string().min(1),
  strengths: z.string(),
  missingPoints: z.string(),
  confidence: z.string(),
});

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown practice test error.";
}

export function describePracticeTestError(error: unknown) {
  return toErrorMessage(error);
}

function toMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeDifficulty(value: string): FlashcardDifficulty {
  const normalized = value.trim().toLowerCase();

  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized;
  }

  if (normalized === "simple" || normalized === "basic") {
    return "easy";
  }

  if (normalized === "advanced" || normalized === "challenging") {
    return "hard";
  }

  return "medium";
}

function importanceFromQualityScore(qualityScore: number) {
  return Math.max(1, Math.min(5, Math.round(qualityScore / 2)));
}

function normalizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trim();
}

/**
 * The same, except that the line breaks survive: an answer guide is a list of marking points, one
 * per line, and collapsing it to a single line collapses the marking scheme with it — every
 * question in a legacy bank would be marked all-or-nothing off one point.
 */
function normalizeGuideText(value: string, maxLength: number) {
  const normalized = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trim();
}

function dedupeQuestions(questions: PracticeTestQuestionDraft[]) {
  const seen = new Set<string>();
  const output: PracticeTestQuestionDraft[] = [];

  for (const question of questions) {
    const key = `${question.conceptKey}::${question.prompt.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(question);
  }

  return output;
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);

  return results;
}

async function setPracticeTestAssetStatus(params: {
  lectureId: string;
  status: LecturePracticeTestAssetRow["status"];
  errorMessage?: string | null;
  modelMetadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const payload = {
    lecture_id: params.lectureId,
    status: params.status,
    error_message: params.errorMessage ?? null,
    model_metadata: params.modelMetadata ?? {},
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("lecture_practice_test_assets")
    .upsert(payload as never, { onConflict: "lecture_id" });

  if (error) {
    throw error;
  }
}

// Generation normally records its own failure from the catch in generateLecturePracticeTest, but a
// generation killed by the platform timeout never gets there and leaves the asset on "generating"
// — a status the workspace polls forever, waiting for a bank nothing is still building. The caller
// that saw the deadline records it instead. Scoped to a bank that is still in flight so a
// generation that finished in the meantime keeps its own state.
export async function markStalledPracticeTestGenerationFailed(params: {
  lectureId: string;
  errorMessage: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("lecture_practice_test_assets")
    .update({
      status: "failed",
      error_message: params.errorMessage,
    } as never)
    .eq("lecture_id", params.lectureId)
    .in("status", ["queued", "generating"]);

  if (error) {
    throw error;
  }
}

/**
 * The same trap the attempt route hit, one route along: grading a full test is a dozen model
 * calls, and an invocation the platform kills takes `submitPracticeTestAttempt`'s own catch with
 * it — leaving the attempt on "submitted", a state the workspace shows as neither a test to sit
 * nor a result to read. The caller that saw the deadline records the failure while there is still
 * an invocation alive to do it, so the learner gets a sentence and a way forward.
 */
export async function markStalledPracticeTestAttemptFailed(params: {
  attemptId: string;
  errorMessage: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: attempt } = (await supabase
    .from("practice_test_attempts")
    .select("model_metadata")
    .eq("id", params.attemptId)
    .maybeSingle()) as { data: Pick<PracticeTestAttemptRow, "model_metadata"> | null };

  const { error } = await supabase
    .from("practice_test_attempts")
    .update({
      status: "failed",
      // Merged, not replaced: the question ids and attempt number in here are what the history
      // and the next test's sampler read.
      model_metadata: {
        ...toMetadataRecord(attempt?.model_metadata),
        gradingError: params.errorMessage,
      },
    } as never)
    .eq("id", params.attemptId)
    // Scoped to an attempt still in flight, so a grading run that finished in the meantime keeps
    // its result.
    .in("status", ["in_progress", "submitted"]);

  if (error) {
    throw error;
  }
}

export async function queueLecturePracticeTestGeneration(lectureId: string) {
  await setPracticeTestAssetStatus({
    lectureId,
    status: "queued",
    errorMessage: null,
    modelMetadata: {},
  });
}

function parseAttemptQuestionMetadata(value: unknown): AttemptQuestionMetadata | null {
  const record = toMetadataRecord(value);
  const questionIds = Array.isArray(record.questionIds)
    ? record.questionIds.filter((item): item is string => typeof item === "string")
    : [];
  const attemptNumber =
    typeof record.attemptNumber === "number" && Number.isInteger(record.attemptNumber)
      ? record.attemptNumber
      : null;
  const bankVersion = typeof record.bankVersion === "string" ? record.bankVersion : null;
  const generationVersion =
    typeof record.generationVersion === "string"
      ? record.generationVersion
      : PRACTICE_TEST_GENERATION_VERSION;

  if (!attemptNumber || !bankVersion) {
    return null;
  }

  return {
    questionIds,
    attemptNumber,
    bankVersion,
    generationVersion,
  };
}

async function generateQuestionsForUnit(params: {
  title: string | null;
  summary: string;
  keyTopics: string[];
  unit: SourceUnit;
  concepts: CoverageConcept[];
  contextUnits: SourceUnit[];
  outputLanguage?: string | null;
  repairOnly?: boolean;
}) {
  const targetCount = Math.min(
    Math.max(
      params.concepts.reduce(
        (total, concept) => total + Math.min(Math.max(concept.recommendedCardCount, 1), 2),
        0,
      ),
      1,
    ),
    8,
  );
  const languageInstruction = buildGeneratedContentLanguageInstruction();
  const requestedConceptKeys = new Set(params.concepts.map((concept) => concept.conceptKey));
  const conceptByKey = new Map(params.concepts.map((concept) => [concept.conceptKey, concept]));
  let generatedQuestions: PracticeTestQuestionDraft[] = [];

  for (
    let attemptIndex = 0;
    attemptIndex < PRACTICE_TEST_GENERATION_ATTEMPTS &&
    (attemptIndex === 0 || (targetCount > 0 && generatedQuestions.length === 0));
    attemptIndex += 1
  ) {
    const retryInstruction =
      attemptIndex === 0
        ? ""
        : "\nPrevious output included prompts that depended on missing context. Regenerate only standalone prompts with all needed context inside the question itself.";
    const batch = await generateStructuredObject({
      schema: practiceQuestionBatchSchema,
      stage: "study_items",
      maxOutputTokens: Math.max(2200, targetCount * 600),
      instructions: `${languageInstruction}
${params.repairOnly ? "Repair missing practice-test coverage." : "Generate source-grounded open-ended practice-test questions."}
Use only the supplied source material.
Return at most ${targetCount} questions for this unit. The requested count is a maximum, not a quota.
Each question must be free-response and must feel like a realistic written school test prompt.
Do not use multiple-choice options.
Spread questions across the requested concepts when high-quality prompts are supported, and avoid duplicates.
Prefer prompts that require recall, explanation, listing, comparison, process description, or short synthesis grounded in the source.
Keep prompts specific and answerable from the source material.
Each question must test exactly one fact, definition, mechanism, comparison, sequence, formula, category, or cause-effect relationship.
Every question must be fully self-contained so a student can solve it without seeing the original lecture, notes, table, diagram, or example.
Do not refer to "the lecture", "the notes", "the table above", "the example shown", or any missing context outside the prompt itself.
If a question depends on source-specific data, definitions, categories, scenarios, or examples, include that context directly in the prompt.
Do not mention the source, material, lecture, notes, illustration, figure, table, graph, diagram, or example in the wording of the question.
Write prompts as direct knowledge questions that can be answered from memory after studying the topic.${retryInstruction}
answerGuide is the marking scheme, and it is marked point by point: write one marking point per line, each line starting with "- ", each stating a specific claim, value or step an answer must contain. Two to four points for most questions; one only when the answer really is a single value or name. Never a point that repeats another, and never a point your question does not ask for. Keep the whole answerGuide under 900 characters.
Skip a requested concept if the only possible prompt would be vague, source-dependent, visual-only, caption-like, or created only to fill the count.
Use the provided conceptKey exactly.
Do not invent facts beyond the source.
Return fewer than ${targetCount} questions, or zero questions, when fewer high-quality questions are supported.`,
      input: JSON.stringify(
        {
          title: params.title,
          summary: params.summary,
          keyTopics: params.keyTopics,
          repairOnly: Boolean(params.repairOnly),
          unit: {
            unitIndex: params.unit.unitIndex,
            sectionTitle: params.unit.sectionTitle,
            locatorLabel: params.unit.locatorLabel,
            sourceType: params.unit.sourceType,
            text: params.unit.text,
          },
          concepts: params.concepts.map((concept) => ({
            ...concept,
            recommendedQuestionCount: Math.min(Math.max(concept.recommendedCardCount, 1), 2),
          })),
          contextUnits: params.contextUnits.map((unit) => ({
            unitIndex: unit.unitIndex,
            locatorLabel: unit.locatorLabel,
            text: unit.text,
          })),
        },
        null,
        2,
      ),
    });

    generatedQuestions = dedupeQuestions([
      ...generatedQuestions,
      ...batch.questions
        .filter((question) => requestedConceptKeys.has(question.conceptKey))
        .map((question) => ({
          prompt: normalizeText(question.prompt, PRACTICE_PROMPT_MAX_LENGTH),
          answerGuide: normalizeGuideText(
            question.answerGuide,
            PRACTICE_ANSWER_GUIDE_MAX_LENGTH,
          ),
          difficulty: normalizeDifficulty(question.difficulty),
          conceptKey: question.conceptKey,
          sourceUnitIdx: params.unit.unitIndex,
          sourceLocator: params.unit.locatorLabel,
          // The legacy planner rates a concept 0-10; the bank stores the same 1-5 scale the item
          // pipeline uses, so selection reads one number whichever path built the question.
          importance: importanceFromQualityScore(
            conceptByKey.get(question.conceptKey)?.qualityScore ?? 6,
          ),
        }))
        .filter(
          (question) =>
            isHighQualityStudyPrompt(question.prompt) &&
            isGradableAnswerGuide(question.answerGuide),
        ),
    ]);
  }

  return generatedQuestions;
}

function findMissingConcepts(params: {
  plans: CoverageUnitPlan[];
  questions: PracticeTestQuestionDraft[];
}) {
  const questionCountsByConcept = new Map<string, number>();

  for (const question of params.questions) {
    questionCountsByConcept.set(
      question.conceptKey,
      (questionCountsByConcept.get(question.conceptKey) ?? 0) + 1,
    );
  }

  const missingConceptsByUnit = new Map<number, CoverageConcept[]>();

  for (const plan of params.plans) {
    const missingConcepts = plan.concepts.filter(
      (concept) => (questionCountsByConcept.get(concept.conceptKey) ?? 0) < 1,
    );

    if (missingConcepts.length > 0) {
      missingConceptsByUnit.set(plan.unitIndex, missingConcepts);
    }
  }

  return missingConceptsByUnit;
}

async function generatePracticeQuestionBank(params: {
  lecture: LectureRow;
  artifact: LectureArtifactRow;
  transcript: TranscriptSegmentRow[];
}) {
  const { units } = buildSourceUnits({
    lecture: params.lecture,
    transcript: params.transcript,
  });

  if (resolveStudyPipelineMode() === "items") {
    const items = await extractStudyItems({
      units,
      sourceType: params.lecture.source_type === "audio" ? "audio" : "document",
      outputLanguage: params.lecture.language_hint,
      usageContext: { lectureId: params.lecture.id, userId: params.lecture.user_id },
      artifactModelMetadata: params.artifact.model_metadata,
    });
    const { drafts, uncoveredItemIds } = await generateItemPracticeDrafts({
      items,
      units,
      outputLanguage: params.lecture.language_hint,
      usageContext: { lectureId: params.lecture.id, userId: params.lecture.user_id },
    });
    /*
     * Whether the bank covers the material is the whole promise of the feature, and it was
     * measured nowhere: `uncoveredItemIds` was returned and dropped on the floor. Recorded on the
     * asset, a bank with a hole in it is something that can be found by looking rather than by a
     * learner noticing a topic never came up.
     */
    const coverage = reportStudyCoverage({
      items,
      coveredItemIds: items
        .filter((item) => !uncoveredItemIds.includes(item.id))
        .map((item) => item.id),
    });
    // The whole bank is kept: attempts sample from it, and the item list is already the
    // "what must be examinable" boundary, so a 40-question cap would reintroduce the hard
    // limit the item pipeline removes.
    const questions = dedupeQuestions(drafts).sort((left, right) => {
      if (left.sourceUnitIdx !== right.sourceUnitIdx) {
        return left.sourceUnitIdx - right.sourceUnitIdx;
      }

      return left.prompt.localeCompare(right.prompt);
    });

    return {
      units,
      plannedCoverage: buildItemPlans(items, units),
      questions,
      coverage: {
        itemCount: items.length,
        requiredItemCount: coverage.requiredItemCount,
        coveredItemCount: coverage.coveredItemCount,
        ratio: Number(coverage.coverage.toFixed(3)),
        uncoveredImportantCount: coverage.uncoveredImportantItems.length,
      },
    };
  }

  const plannedCoverage = await createCoveragePlan({
    title: params.lecture.title,
    summary: params.artifact.summary,
    keyTopics: params.artifact.key_topics,
    units,
  });
  const planByUnit = new Map(plannedCoverage.map((plan) => [plan.unitIndex, plan]));

  let generatedQuestions = (
    await mapWithConcurrency(units, PRACTICE_TEST_CONCURRENCY, async (unit, index) => {
      const plan = planByUnit.get(unit.unitIndex);
      if (!plan || plan.concepts.length === 0) {
        return [];
      }

      return generateQuestionsForUnit({
        title: params.lecture.title,
        summary: params.artifact.summary,
        keyTopics: params.artifact.key_topics,
        unit,
        concepts: plan.concepts,
        contextUnits: units.slice(Math.max(0, index - 1), Math.min(units.length, index + 2)),
        outputLanguage: params.lecture.language_hint,
      });
    })
  ).flat();

  const missingConceptsByUnit = findMissingConcepts({
    plans: plannedCoverage,
    questions: generatedQuestions,
  });

  if (missingConceptsByUnit.size > 0) {
    const repairedQuestions = (
      await mapWithConcurrency(
        [...missingConceptsByUnit.entries()],
        PRACTICE_TEST_CONCURRENCY,
        async ([unitIndex, concepts]) => {
          const unit = units.find((candidate) => candidate.unitIndex === unitIndex);
          if (!unit) {
            return [];
          }

          return generateQuestionsForUnit({
            title: params.lecture.title,
            summary: params.artifact.summary,
            keyTopics: params.artifact.key_topics,
            unit,
            concepts,
            contextUnits: units.slice(Math.max(0, unitIndex - 1), Math.min(units.length, unitIndex + 2)),
            outputLanguage: params.lecture.language_hint,
            repairOnly: true,
          });
        },
      )
    ).flat();

    generatedQuestions = dedupeQuestions([...generatedQuestions, ...repairedQuestions]);
  }

  const targetBankSize = Math.max(
    18,
    Math.min(
      40,
      plannedCoverage.reduce((total, plan) => total + plan.concepts.length, 0),
    ),
  );

  const sortedQuestions = shuffle([...generatedQuestions]).sort((left, right) => {
    if (left.sourceUnitIdx !== right.sourceUnitIdx) {
      return left.sourceUnitIdx - right.sourceUnitIdx;
    }

    return left.prompt.localeCompare(right.prompt);
  });

  const questions = sortedQuestions.slice(
    0,
    Math.max(5, Math.min(targetBankSize, sortedQuestions.length)),
  );
  const plannedConceptKeys = new Set(
    plannedCoverage.flatMap((plan) => plan.concepts.map((concept) => concept.conceptKey)),
  );
  const coveredConceptKeys = new Set(questions.map((question) => question.conceptKey));

  return {
    units,
    plannedCoverage,
    questions,
    coverage: {
      itemCount: plannedConceptKeys.size,
      requiredItemCount: plannedConceptKeys.size,
      coveredItemCount: coveredConceptKeys.size,
      ratio:
        plannedConceptKeys.size === 0
          ? 1
          : Number((coveredConceptKeys.size / plannedConceptKeys.size).toFixed(3)),
      uncoveredImportantCount: [...plannedConceptKeys].filter((key) => !coveredConceptKeys.has(key))
        .length,
    },
  };
}

export async function generateLecturePracticeTest(params: {
  lectureId: string;
  regenerate?: boolean;
}) {
  const supabase = createSupabaseServiceRoleClient();

  await setPracticeTestAssetStatus({
    lectureId: params.lectureId,
    status: "generating",
    modelMetadata: {
      stage: "generating_question_bank",
      pipeline: PRACTICE_TEST_GENERATION_VERSION,
      regenerate: Boolean(params.regenerate),
    },
  });

  try {
    const [
      { data: lecture, error: lectureError },
      { data: artifact, error: artifactError },
      { data: transcript, error: transcriptError },
    ] = await Promise.all([
      supabase.from("lectures").select("*").eq("id", params.lectureId).single(),
      supabase.from("lecture_artifacts").select("*").eq("lecture_id", params.lectureId).single(),
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
    const artifactRow = artifact as LectureArtifactRow;
    const transcriptRows = (transcript ?? []) as TranscriptSegmentRow[];

    if (lectureRow.status !== "ready") {
      throw new Error("Practice tests are available after note processing finishes.");
    }

    if (transcriptRows.length === 0) {
      throw new Error("The lecture transcript is empty.");
    }

    const coverage = await generatePracticeQuestionBank({
      lecture: lectureRow,
      artifact: artifactRow,
      transcript: transcriptRows,
    });
    const bankVersion = new Date().toISOString();

    const { error: deleteQuestionsError } = await supabase
      .from("practice_test_questions")
      .delete()
      .eq("lecture_id", params.lectureId);

    if (deleteQuestionsError) {
      throw deleteQuestionsError;
    }

    const questionsToInsert = coverage.questions.map((question, index) => ({
      lecture_id: params.lectureId,
      idx: index,
      prompt: question.prompt,
      answer_guide: question.answerGuide,
      difficulty: question.difficulty,
      source_locator: question.sourceLocator,
      source_unit_idx: question.sourceUnitIdx,
      concept_key: question.conceptKey,
      importance: question.importance,
      created_at: new Date().toISOString(),
    }));

    if (questionsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("practice_test_questions")
        .insert(questionsToInsert as never);

      if (insertError) {
        throw insertError;
      }
    }

    // The bank is published; clearing the batch checkpoints keeps the cache table holding only
    // in-flight work and keeps a learner's "regenerate" fresh.
    await clearGenerationCache(params.lectureId, STUDY_BATCH_CACHE_STAGES.practice);

    await setPracticeTestAssetStatus({
      lectureId: params.lectureId,
      status: "ready",
      modelMetadata: {
        stage: "ready",
        pipeline: PRACTICE_TEST_GENERATION_VERSION,
        questionCount: questionsToInsert.length,
        sourceUnitCount: coverage.units.length,
        plannedConceptCount: coverage.plannedCoverage.reduce(
          (total, plan) => total + plan.concepts.length,
          0,
        ),
        materialCoverage: coverage.coverage,
        bankVersion,
      },
    });
  } catch (error) {
    await setPracticeTestAssetStatus({
      lectureId: params.lectureId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      modelMetadata: {
        stage: "failed",
        pipeline: PRACTICE_TEST_GENERATION_VERSION,
        regenerate: Boolean(params.regenerate),
      },
    });

    throw error;
  }
}

function getQuestionIdsFromAttempt(attempt: PracticeTestAttemptRow) {
  return parseAttemptQuestionMetadata(attempt.model_metadata)?.questionIds ?? [];
}

function getAttemptNumber(attempt: PracticeTestAttemptRow) {
  return parseAttemptQuestionMetadata(attempt.model_metadata)?.attemptNumber ?? 0;
}

function getBankVersionFromAsset(asset: LecturePracticeTestAssetRow | null) {
  if (
    asset?.model_metadata &&
    typeof asset.model_metadata === "object" &&
    !Array.isArray(asset.model_metadata) &&
    "bankVersion" in asset.model_metadata &&
    typeof asset.model_metadata.bankVersion === "string"
  ) {
    return asset.model_metadata.bankVersion;
  }

  return asset?.updated_at ?? new Date().toISOString();
}

function getAttemptsForBank(params: {
  attempts: PracticeTestAttemptRow[];
  bankVersion: string;
}) {
  return params.attempts.filter(
    (attempt) => parseAttemptQuestionMetadata(attempt.model_metadata)?.bankVersion === params.bankVersion,
  );
}

export async function createPracticeTestAttempt(params: {
  lectureId: string;
  userId: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const loadAttemptInputs = async () => {
    const [
      { data: asset, error: assetError },
      { data: questions, error: questionsError },
      { data: attempts, error: attemptsError },
    ] = await Promise.all([
      supabase
        .from("lecture_practice_test_assets")
        .select("*")
        .eq("lecture_id", params.lectureId)
        .maybeSingle(),
      supabase
        .from("practice_test_questions")
        .select("*")
        .eq("lecture_id", params.lectureId)
        .order("idx", { ascending: true }),
      supabase
        .from("practice_test_attempts")
        .select("*")
        .eq("lecture_id", params.lectureId)
        .eq("user_id", params.userId)
        .order("created_at", { ascending: true }),
    ]);

    if (assetError) {
      throw assetError;
    }

    if (questionsError) {
      throw questionsError;
    }

    if (attemptsError) {
      throw attemptsError;
    }

    return {
      asset: asset as LecturePracticeTestAssetRow | null,
      questions: (questions ?? []) as PracticeTestQuestionRow[],
      attempts: (attempts ?? []) as PracticeTestAttemptRow[],
    };
  };

  let { asset: assetRow, questions: questionRows, attempts: previousAttempts } =
    await loadAttemptInputs();

  const assetMetadata = toMetadataRecord(assetRow?.model_metadata);
  /*
   * One rebuild decision, taken once. The old code took two: a "does the stored bank look wrong"
   * check and, right after it, a "has the learner already seen enough of it" check that rebuilt
   * the entire bank as soon as the unused questions no longer filled one test. That second rule
   * put a full generation run in front of roughly every third attempt, and — because a single
   * prompt failing the quality gate satisfied the first rule — a bank containing one bad question
   * was rebuilt on every single start, forever, however good the other thirty-nine were.
   */
  const builtByCurrentPipeline = assetMetadata.pipeline === PRACTICE_TEST_GENERATION_VERSION;
  const needsBankBuild =
    !assetRow ||
    assetRow.status !== "ready" ||
    shouldRebuildQuestionBank({ questions: questionRows, builtByCurrentPipeline });

  if (needsBankBuild) {
    await generateLecturePracticeTest({
      lectureId: params.lectureId,
      regenerate: Boolean(assetRow),
    });
    ({ asset: assetRow, questions: questionRows, attempts: previousAttempts } =
      await loadAttemptInputs());
  }

  if (!assetRow || assetRow.status !== "ready" || questionRows.length === 0) {
    throw new Error("A practice test could not be prepared right now.");
  }

  const bankVersion = getBankVersionFromAsset(assetRow);
  const activeAttemptIds = previousAttempts
    .filter((attempt) => attempt.status === "in_progress" || attempt.status === "submitted")
    .map((attempt) => attempt.id);

  if (activeAttemptIds.length > 0) {
    const { error: closeAttemptsError } = await supabase
      .from("practice_test_attempts")
      .update({ status: "failed" } as never)
      .in("id", activeAttemptIds);

    if (closeAttemptsError) {
      throw closeAttemptsError;
    }
  }

  // Only the attempts sat on this bank say anything about what the learner has already seen:
  // after a rebuild the ids point at questions that no longer exist.
  const previousAttemptQuestionIds = getAttemptsForBank({
    attempts: previousAttempts,
    bankVersion,
  }).map((attempt) => getQuestionIdsFromAttempt(attempt));
  const usableQuestionCount = usableBankQuestions(questionRows).length;
  const selection = selectAttemptQuestions({
    questions: questionRows,
    previousAttemptQuestionIds,
  });
  const selectedQuestions = selection.questions;

  if (selectedQuestions.length === 0) {
    throw new Error("A practice test could not be prepared right now.");
  }

  const attemptId = crypto.randomUUID();
  const attemptNumber = previousAttempts.length + 1;

  const metadata = {
    questionIds: selectedQuestions.map((question) => question.id),
    attemptNumber,
    bankVersion,
    generationVersion: PRACTICE_TEST_GENERATION_VERSION,
    // Recorded so a bank that keeps re-asking the same questions, or one a learner never gets
    // through, shows up in the data rather than only as an impression.
    bankSize: questionRows.length,
    usableBankSize: usableQuestionCount,
    bankCoverage: Number(
      bankCoverageRatio({ questions: questionRows, previousAttemptQuestionIds }).toFixed(3),
    ),
    previousOverlapRatio: Number(selection.previousOverlapRatio.toFixed(3)),
  };

  const { error: insertAttemptError } = await supabase.from("practice_test_attempts").insert(
    {
      id: attemptId,
      lecture_id: params.lectureId,
      user_id: params.userId,
      status: "in_progress",
      question_count: selectedQuestions.length,
      model_metadata: metadata,
    } as never,
  );

  if (insertAttemptError) {
    throw insertAttemptError;
  }

  const { error: insertAnswersError } = await supabase
    .from("practice_test_attempt_answers")
    .insert(
      selectedQuestions.map((question, index) => ({
        attempt_id: attemptId,
        practice_test_question_id: question.id,
        idx: index,
        question_prompt: question.prompt,
        answer_guide_snapshot: question.answer_guide,
        difficulty_snapshot: question.difficulty,
        source_locator_snapshot: question.source_locator,
      })) as never,
    );

  if (insertAnswersError) {
    throw insertAnswersError;
  }

  return {
    id: attemptId,
    attemptNumber,
    questions: selectedQuestions,
  };
}

export type MarkedAnswer = {
  score: number;
  expectedAnswer: string;
  rationale: string;
  strengths: string;
  missingPoints: string;
  confidence: string;
  markingPoints: string[];
  pointMarks: PointMark[];
  criticalError: boolean;
};

/** Free text from a model is clamped here rather than by the wire schema. */
function clampFeedback(value: string, maxLength: number, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return fallback;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength).trim()}…`;
}

/**
 * How confident the mark is, from the marking itself rather than from asking the model how sure
 * it feels — a self-reported confidence is the least reliable field a grader returns. A scheme
 * marked cleanly one way or the other is a confident mark; one that came out half-partial is the
 * borderline answer a learner is most likely to want to argue about.
 */
function gradingConfidence(marks: PointMark[]) {
  if (marks.length === 0) {
    return "low";
  }

  const partialShare = marks.filter((mark) => mark === "partial").length / marks.length;

  return partialShare >= 0.5 ? "medium" : "high";
}

/**
 * Marks one answer against its scheme.
 *
 * The model is asked which marking points the answer contains; the score is computed from that
 * (`scoreFromRubric`). Nothing the model says about the mark itself is trusted as the mark.
 */
async function markAnswer(params: {
  prompt: string;
  answerGuide: string;
  typedAnswer: string;
}): Promise<MarkedAnswer> {
  const markingPoints = parseMarkingPoints(params.answerGuide);
  const marked = await generateStructuredObject({
    schema: practiceGradingSchema,
    stage: "study_items",
    maxOutputTokens: 1600,
    instructions: buildPracticeGradingInstructions(),
    input: JSON.stringify(
      {
        question: params.prompt,
        markingPoints: markingPoints.map((point, index) => ({ pointIndex: index, point })),
        // Fenced and named as the work being marked, so a "give me full marks" written into the
        // answer reads as part of the answer rather than as part of the task.
        studentAnswer: `<student-answer>\n${truncateAnswerForGrading(params.typedAnswer)}\n</student-answer>`,
      },
      null,
      2,
    ),
  });

  const pointMarks = reconcilePointMarks({
    pointCount: markingPoints.length,
    marks: marked.pointMarks,
  });
  const grade = scoreFromRubric({
    marks: pointMarks,
    criticalError: marked.criticalError,
    offTopic: marked.offTopic,
  });

  return {
    score: grade.score,
    expectedAnswer: clampFeedback(marked.expectedAnswer, 1200, params.answerGuide),
    rationale: clampFeedback(marked.rationale, 900, ""),
    strengths: clampFeedback(marked.strengths, 900, ""),
    missingPoints: clampFeedback(marked.missingPoints, 900, ""),
    confidence: gradingConfidence(pointMarks),
    markingPoints,
    pointMarks,
    criticalError: marked.criticalError,
  };
}

/**
 * One retry, then the answer is left unmarked.
 *
 * The old code let a single failed grading call reject out of the whole submission: the attempt
 * went to "failed" and every answer the learner had written was gone, because one call out of
 * twelve came back malformed. An answer that cannot be marked is now recorded as unmarked and
 * left out of the total (`summariseAttemptScores`), which is honest about what happened and
 * costs the learner nothing.
 */
async function markAnswerWithRetry(params: {
  prompt: string;
  answerGuide: string;
  typedAnswer: string;
}): Promise<MarkedAnswer | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await markAnswer(params);
    } catch (error) {
      if (isWorkAbortedError(error)) {
        throw error;
      }

      if (attempt === 1) {
        return null;
      }
    }
  }

  return null;
}

function resolveAttemptQuestion(
  answer:
    | (PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null })
    | PracticeTestAttemptAnswerRow,
): PracticeTestQuestionRow | null {
  const linkedQuestion =
    "practice_test_questions" in answer ? answer.practice_test_questions : null;

  if (linkedQuestion) {
    return linkedQuestion;
  }

  if (!answer.question_prompt || !answer.answer_guide_snapshot || !answer.difficulty_snapshot) {
    return null;
  }

  return {
    id: answer.practice_test_question_id ?? `snapshot-${answer.id}`,
    lecture_id: "",
    idx: answer.idx,
    prompt: answer.question_prompt,
    answer_guide: answer.answer_guide_snapshot,
    difficulty:
      answer.difficulty_snapshot === "easy" ||
      answer.difficulty_snapshot === "medium" ||
      answer.difficulty_snapshot === "hard"
        ? answer.difficulty_snapshot
        : "medium",
    source_locator: answer.source_locator_snapshot,
    source_unit_idx: null,
    concept_key: null,
    importance: null,
    created_at: answer.created_at,
  };
}

export async function submitPracticeTestAttempt(params: {
  lectureId: string;
  userId: string;
  attemptId: string;
  answers: Array<{
    answerId: string;
    typedAnswer: string;
    declaredUnknown: boolean;
  }>;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: attempt, error: attemptError } = await supabase
    .from("practice_test_attempts")
    .select("*")
    .eq("id", params.attemptId)
    .eq("lecture_id", params.lectureId)
    .eq("user_id", params.userId)
    .single();

  if (attemptError) {
    throw attemptError;
  }

  const attemptRow = attempt as PracticeTestAttemptRow;

  const { data: storedAnswers, error: answersError } = await supabase
    .from("practice_test_attempt_answers")
    .select("*, practice_test_questions(*)")
    .eq("attempt_id", params.attemptId)
    .order("idx", { ascending: true });

  if (answersError) {
    throw answersError;
  }

  const answerRows = (storedAnswers ?? []) as Array<
    PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
  >;

  if (answerRows.length === 0) {
    throw new Error(
      "This practice-test attempt no longer has question data. Start a new practice test.",
    );
  }

  /*
   * "?" is not an answer, and neither is "ne vem" typed into the box instead of ticking the
   * checkbox. Both were being sent to the grader, which cost a call to reach the zero the string
   * already announced — and occasionally found a marking point inside a question mark. They are
   * folded into the same "I don't know" the checkbox produces, which is also what the learner
   * meant.
   */
  const inputByAnswerId = new Map(
    params.answers.map((answer) => [
      answer.answerId,
      {
        ...answer,
        typedAnswer: answer.typedAnswer.trim(),
        declaredUnknown: answer.declaredUnknown || isSurrenderAnswer(answer.typedAnswer),
      },
    ]),
  );

  for (const answer of answerRows) {
    const input = inputByAnswerId.get(answer.id);

    if (!input || (!input.declaredUnknown && input.typedAnswer.length === 0)) {
      throw new Error("Every practice-test question needs an answer or 'I don't know'.");
    }
  }

  const { error: updateInputError } = await supabase
    .from("practice_test_attempt_answers")
    .upsert(
      answerRows.map((answer) => {
        const input = inputByAnswerId.get(answer.id)!;
        return {
          id: answer.id,
          attempt_id: answer.attempt_id,
          practice_test_question_id: answer.practice_test_question_id,
          idx: answer.idx,
          typed_answer: input.typedAnswer || null,
          photo_path: null,
          photo_mime_type: null,
          declared_unknown: input.declaredUnknown,
        };
      }) as never,
      { onConflict: "id" },
    );

  if (updateInputError) {
    throw updateInputError;
  }

  await supabase
    .from("practice_test_attempts")
    .update({ status: "submitted" } as never)
    .eq("id", params.attemptId);

  try {
    const gradedAnswers = await mapWithConcurrency(
      answerRows,
      PRACTICE_TEST_CONCURRENCY,
      async (answer) => {
        const input = inputByAnswerId.get(answer.id)!;
        const question = resolveAttemptQuestion(answer);

        if (!question) {
          throw new Error("Practice-test question not found.");
        }

        const base = {
          id: answer.id,
          attempt_id: answer.attempt_id,
          practice_test_question_id: answer.practice_test_question_id,
          idx: answer.idx,
          question_prompt: answer.question_prompt,
          answer_guide_snapshot: answer.answer_guide_snapshot,
          difficulty_snapshot: answer.difficulty_snapshot,
          source_locator_snapshot: answer.source_locator_snapshot,
          // What a full answer needed to say, for the learner to read afterwards. It is the
          // generated marking scheme, so it is already in the language of the material.
          expected_answer: question.answer_guide,
        };

        if (input.declaredUnknown) {
          /*
           * No feedback text is stored for a skipped question. The three sentences that used to
           * live here were written in English and rendered straight into a Slovene, Croatian,
           * Bosnian or Serbian interface; the screen now writes them itself from
           * `declared_unknown`, in the reader's own language.
           */
          return {
            ...base,
            score: 0,
            grading_rationale: null,
            strengths: null,
            missing_points: null,
            grading_confidence: "high",
          };
        }

        const marked = await markAnswerWithRetry({
          prompt: question.prompt,
          answerGuide: question.answer_guide,
          typedAnswer: input.typedAnswer,
        });

        if (!marked) {
          return {
            ...base,
            score: null,
            grading_rationale: null,
            strengths: null,
            missing_points: null,
            grading_confidence: "unmarked",
          };
        }

        return {
          ...base,
          score: clampQuestionScore(marked.score),
          expected_answer: marked.expectedAnswer,
          grading_rationale: marked.rationale || null,
          strengths: marked.strengths || null,
          missing_points: marked.missingPoints || null,
          grading_confidence: marked.confidence,
        };
      },
    );

    const summary = summariseAttemptScores(gradedAnswers.map((answer) => answer.score));

    // Every answer failing to mark is an outage, not a result. Recording a zero-question test as
    // "graded" would show the learner a 0% they never earned.
    if (summary.gradedCount === 0) {
      throw new Error("The test could not be graded right now.");
    }

    const { error: updateGradesError } = await supabase
      .from("practice_test_attempt_answers")
      .upsert(gradedAnswers as never, {
        onConflict: "id",
      });

    if (updateGradesError) {
      throw updateGradesError;
    }

    const { error: updateAttemptError } = await supabase
      .from("practice_test_attempts")
      .update(
        {
          status: "graded",
          total_score: summary.totalScore,
          max_score: summary.maxScore,
          percentage: summary.percentage,
          graded_at: new Date().toISOString(),
          model_metadata: {
            ...toMetadataRecord(attemptRow.model_metadata),
            gradedAnswerCount: summary.gradedCount,
            unmarkedAnswerCount: summary.ungradedCount,
            questionMaxScore: PRACTICE_QUESTION_MAX_SCORE,
          },
        } as never,
      )
      .eq("id", params.attemptId);

    if (updateAttemptError) {
      throw updateAttemptError;
    }

    return {
      totalScore: summary.totalScore,
      maxScore: summary.maxScore,
      percentage: summary.percentage,
      unmarkedAnswerCount: summary.ungradedCount,
    };
  } catch (error) {
    await supabase
      .from("practice_test_attempts")
      .update(
        {
          status: "failed",
          model_metadata: {
            ...toMetadataRecord(attemptRow.model_metadata),
            gradingError: toErrorMessage(error),
          },
        } as never,
      )
      .eq("id", params.attemptId);

    throw error;
  }
}

export async function getPracticeTestAttemptForUser(params: {
  lectureId: string;
  attemptId: string;
  userId: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const { data: attempt, error: attemptError } = await supabase
    .from("practice_test_attempts")
    .select("*")
    .eq("id", params.attemptId)
    .eq("lecture_id", params.lectureId)
    .eq("user_id", params.userId)
    .single();

  if (attemptError) {
    throw attemptError;
  }

  const { data: answers, error: answersError } = await supabase
    .from("practice_test_attempt_answers")
    .select("*, practice_test_questions(*)")
    .eq("attempt_id", params.attemptId)
    .order("idx", { ascending: true });

  if (answersError) {
    throw answersError;
  }

  return mapAttemptWithAnswers(
    attempt as PracticeTestAttemptRow,
    (answers ?? []) as Array<
      PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
    >,
  );
}

export async function mapAttemptWithAnswers(
  attempt: PracticeTestAttemptRow,
  answers: Array<
    PracticeTestAttemptAnswerRow & { practice_test_questions: PracticeTestQuestionRow | null }
  >,
): Promise<PracticeTestAttemptWithAnswers> {
  const mappedAnswers: PracticeTestAttemptAnswer[] = [];

  for (const answer of answers) {
    const question = resolveAttemptQuestion(answer);
    mappedAnswers.push({
      ...answer,
      question,
    });
  }

  return {
    ...attempt,
    answers: mappedAnswers,
  };
}

export function buildPracticeTestHistorySummary(
  attempts: PracticeTestAttemptWithAnswers[],
): PracticeTestHistorySummary {
  const gradedAttempts = attempts.filter(
    (attempt) =>
      attempt.status === "graded" &&
      typeof attempt.percentage === "number" &&
      typeof attempt.total_score === "number" &&
      typeof attempt.max_score === "number",
  );

  const scoresByAttempt: PracticeTestHistoryEntry[] = gradedAttempts.map((attempt) => ({
    attemptId: attempt.id,
    attemptNumber: getAttemptNumber(attempt),
    createdAt: attempt.created_at,
    percentage: attempt.percentage ?? 0,
    totalScore: attempt.total_score ?? 0,
    maxScore: attempt.max_score ?? 0,
  }));

  if (scoresByAttempt.length === 0) {
    return {
      attemptCount: 0,
      averagePercentage: null,
      bestPercentage: null,
      lowestPercentage: null,
      latestPercentage: null,
      scoresByAttempt: [],
    };
  }

  const percentages = scoresByAttempt.map((entry) => entry.percentage);

  return {
    attemptCount: scoresByAttempt.length,
    averagePercentage:
      Number((percentages.reduce((total, value) => total + value, 0) / percentages.length).toFixed(2)),
    bestPercentage: Math.max(...percentages),
    lowestPercentage: Math.min(...percentages),
    latestPercentage: scoresByAttempt[scoresByAttempt.length - 1]?.percentage ?? null,
    scoresByAttempt,
  };
}

export async function gradePracticeTestPhotoWithGemini(params: {
  file: File;
  prompt: string;
  answerGuide: string;
}) {
  const env = getServerEnv();
  // Reading a photographed handwritten answer is OCR work: the text model scored 73-81% on
  // handwriting in the OCR benchmark, which is not a model to grade a student with.
  return generateStructuredObjectWithGeminiFile({
    schema: photoGradingSchema,
    instructions: `Grade the student's handwritten or photographed answer to the prompt.
Question: ${params.prompt}
Answer guide: ${params.answerGuide}
Use the same 0-5 integer rubric as a school practice test.`,
    file: params.file,
    model: env.GEMINI_OCR_MODEL,
    thinkingConfig: resolveMinimalThinkingConfig(env.GEMINI_OCR_MODEL),
    maxOutputTokens: 1600,
  });
}

export function getPreferredPracticeTestProviderMode() {
  return getAiProvider();
}
