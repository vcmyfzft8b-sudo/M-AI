import { inngest } from "@/inngest/client";
import {
  getInvocationBudgetMs,
  runWithinInvocationBudget,
} from "@/lib/invocation-budget";
import { isExpectedLectureInputFailure } from "@/lib/lecture-processing-errors";
import { captureRouteError } from "@/lib/monitoring";
import { isLectureGenerationBudgetExceededError } from "@/lib/notes/generation-guard";
import type { NotesGenerationPhase } from "@/lib/note-generation";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
  runLectureStage,
  transcribeLectureContent,
} from "@/lib/pipeline";
import { generateLecturePracticeTest } from "@/lib/practice-test";
import { generateLectureQuiz } from "@/lib/quiz";
import { generateLectureFlashcards } from "@/lib/study";

// Inngest executes a step by calling POST /api/inngest, so a step gets exactly one Vercel
// invocation and dies with it. When the work outlives `maxDuration` the platform kills the
// invocation mid-step: nothing rejects, none of the catches below run, the lecture keeps its
// in-progress status forever, and Inngest — which received no response at all — retries the same
// doomed five minutes of work. That is what four `/api/inngest` timeouts in twenty-five minutes
// look like from the platform log, and none of them carry a lecture id.
//
// Stopping short of the platform limit turns the kill into an ordinary rejection while the
// function is still alive to record it.
// Must match `maxDuration` in src/app/api/inngest/route.ts; tests/inngest-step-budget.test.mjs
// fails if the two drift apart.
const INNGEST_MAX_DURATION_SECONDS = 300;
// Ends up verbatim in the lecture's error_message, so keep it about what the user can do. Which
// step ran out of time is in the Sentry event markLecturePipelineFailed sends.
const STEP_BUDGET_MESSAGE = "Obdelava je trajala predolgo in se je ustavila. Poskusi znova.";

// The clock starts when the step body does. Inngest runs one step per invocation and replays the
// steps before it from memoized results, so the request handling ahead of this costs a fraction of
// a second — comfortably inside the margin the budget holds back.
function withStepBudget<T>(run: () => Promise<T>) {
  return runWithinInvocationBudget({
    run,
    budgetMs: getInvocationBudgetMs({
      maxDurationSeconds: INNGEST_MAX_DURATION_SECONDS,
      elapsedMs: 0,
    }),
    deadlineMessage: STEP_BUDGET_MESSAGE,
  });
}

/**
 * Runs the notes stage and classifies the generation guard's refusal on the throwing side of the
 * step, per docs/lecture-pipeline-inngest.md: across the step boundary the error class is
 * flattened to a bare StepError, so the refusal must be recorded on the lecture *here* — where
 * the object is still itself — and reported as a completed step, not a failed one. Letting it
 * fail the step would buy four retried refusals and then an unclassifiable error in the
 * function body's catch.
 */
/**
 * Warms the note pipeline's checkpoints up to one phase, inside its own step budget, and never
 * fails its step. These steps exist because the default writer is ~3-5x slower than the Gemini it
 * replaced: extract, outline and write no longer reliably share one 300s invocation on a large
 * source. Splitting them gives each phase a fresh budget, and the checkpoint cache makes the
 * hand-off free — the next step replays everything already done in seconds.
 *
 * Swallowing errors here is deliberate, not optimistic: a warm-up is pure cache warming, so any
 * real failure — bad source, guard refusal, provider outage — will surface again in the
 * authoritative generate-lecture-notes step, which owns failure classification. Letting a warm-up
 * fail its step would buy four Inngest retries of a step whose work the next step redoes anyway.
 */
async function warmNotesPhase(lectureId: string, stopAfter: NotesGenerationPhase) {
  try {
    await withStepBudget(() =>
      generateLectureNotesFromStoredTranscript({ lectureId, stopAfter }),
    );
  } catch (error) {
    console.warn(`Notes ${stopAfter} warm-up did not finish; the next step continues from its checkpoints.`, {
      lectureId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { warmed: stopAfter };
}

async function runNotesStageWithGuard(lectureId: string) {
  try {
    await generateLectureNotesFromStoredTranscript({ lectureId });

    return { completed: true };
  } catch (error) {
    if (isLectureGenerationBudgetExceededError(error)) {
      await markLecturePipelineFailed({ lectureId, error });

      return { completed: false };
    }

    throw error;
  }
}

export const processLectureFunction = inngest.createFunction(
  { id: "process-lecture" },
  { event: "lecture/process.requested" },
  async ({ event, step }) => {
    try {
      const transcription = await step.run("transcribe-lecture", () =>
        withStepBudget(() =>
          runLectureStage({
            lectureId: event.data.lectureId,
            run: () =>
              transcribeLectureContent({
                lectureId: event.data.lectureId,
              }),
          }),
        ),
      );

      // A recording with no speech in it is not a failed step: runLectureStage has already marked
      // the lecture failed with the message the learner needs, and there is no transcript for the
      // notes to be generated from.
      //
      // Compared against `false` rather than tested for truthiness because a run that was already
      // in flight when this shipped replays its memoized `transcribe-lecture` output, and the step
      // returned nothing before this change -- Inngest stores that as `null` (`undefinedToNull` in
      // components/execution/v1.ts). Reading `.completed` off it would throw, burying a lecture
      // whose transcript is fine. An older run has no `completed` to read, and its notes still
      // need generating, so it falls through here exactly as it used to.
      if (transcription?.completed === false) {
        return;
      }

      await step.run("warm-notes-extraction", () =>
        warmNotesPhase(event.data.lectureId, "note_extract"),
      );
      await step.run("warm-notes-outline", () =>
        warmNotesPhase(event.data.lectureId, "note_outline"),
      );

      // This step returned nothing before the generation guard shipped, so an in-flight run
      // replays its memoized output as `null` — read with optional chaining on purpose.
      const generation = await step.run("generate-lecture-notes", () =>
        withStepBudget(() => runNotesStageWithGuard(event.data.lectureId)),
      );

      if (generation?.completed === false) {
        return;
      }
    } catch (error) {
      const outcome = await step.run("mark-lecture-failed", () =>
        markLecturePipelineFailed({
          lectureId: event.data.lectureId,
          error,
        }),
      );

      // The budget can also run out after the notes are finished, while the optional initial note
      // audio is still being prepared. markLecturePipelineFailed reports that by leaving the
      // lecture ready and returning `recorded: false`; failing the step then would make Inngest
      // regenerate the finished notes from scratch four more times. It returns the same when the
      // learner deleted the lecture mid-run, where the four retries would each fail on the row
      // that is no longer there — and when it handed the overrun to an automatic retry, where the
      // lecture is back to "queued" with a fresh run already enqueued and nothing was recorded to
      // rethrow about.
      if (outcome.recorded) {
        throw error;
      }
    }
  },
);

export const processLectureNotesFunction = inngest.createFunction(
  { id: "process-lecture-notes" },
  { event: "lecture/notes.requested" },
  async ({ event, step }) => {
    try {
      await step.run("warm-notes-extraction", () =>
        warmNotesPhase(event.data.lectureId, "note_extract"),
      );
      await step.run("warm-notes-outline", () =>
        warmNotesPhase(event.data.lectureId, "note_outline"),
      );

      // Same replay contract as above: older runs memoized `null` for this step.
      const generation = await step.run("generate-lecture-notes", () =>
        withStepBudget(() => runNotesStageWithGuard(event.data.lectureId)),
      );

      if (generation?.completed === false) {
        return;
      }
    } catch (error) {
      const outcome = await step.run("mark-lecture-failed", () =>
        markLecturePipelineFailed({
          lectureId: event.data.lectureId,
          error,
        }),
      );

      if (outcome.recorded) {
        throw error;
      }
    }
  },
);

export const processLectureStudyFunction = inngest.createFunction(
  { id: "process-lecture-study" },
  { event: "lecture/study.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture-study", async () => {
      try {
        await withStepBudget(() =>
          generateLectureFlashcards({
            lectureId: event.data.lectureId,
          }),
        );
      } catch (error) {
        // The step swallows the failure on purpose (the deck status carries it to the learner),
        // but swallowed must not mean invisible: the team hears about it too. Expected input
        // failures stay out of Sentry — this catch is on the throwing side of the step, so the
        // predicate still sees the real error class.
        if (!isExpectedLectureInputFailure(error)) {
          captureRouteError(error, {
            route: "inngest:process-lecture-study",
            operation: "generateLectureFlashcards",
            lectureId: event.data.lectureId,
          });
        }

        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown flashcard generation error.",
        };
      }

      return { ok: true };
    });
  },
);

export const processLectureQuizFunction = inngest.createFunction(
  { id: "process-lecture-quiz" },
  { event: "lecture/quiz.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture-quiz", async () => {
      try {
        await withStepBudget(() =>
          generateLectureQuiz({
            lectureId: event.data.lectureId,
          }),
        );
      } catch (error) {
        if (!isExpectedLectureInputFailure(error)) {
          captureRouteError(error, {
            route: "inngest:process-lecture-quiz",
            operation: "generateLectureQuiz",
            lectureId: event.data.lectureId,
          });
        }

        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown quiz generation error.",
        };
      }

      return { ok: true };
    });
  },
);

export const processLecturePracticeTestFunction = inngest.createFunction(
  { id: "process-lecture-practice-test" },
  { event: "lecture/practice-test.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture-practice-test", async () => {
      try {
        await withStepBudget(() =>
          generateLecturePracticeTest({
            lectureId: event.data.lectureId,
            regenerate: Boolean(event.data.regenerate),
          }),
        );
      } catch (error) {
        if (!isExpectedLectureInputFailure(error)) {
          captureRouteError(error, {
            route: "inngest:process-lecture-practice-test",
            operation: "generateLecturePracticeTest",
            lectureId: event.data.lectureId,
          });
        }

        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "Unknown practice-test generation error.",
        };
      }

      return { ok: true };
    });
  },
);
