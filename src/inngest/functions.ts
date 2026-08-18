import { inngest } from "@/inngest/client";
import {
  getInvocationBudgetMs,
  runWithinInvocationBudget,
} from "@/lib/invocation-budget";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
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

export const processLectureFunction = inngest.createFunction(
  { id: "process-lecture" },
  { event: "lecture/process.requested" },
  async ({ event, step }) => {
    try {
      await step.run("transcribe-lecture", () =>
        withStepBudget(async () => {
          await transcribeLectureContent({
            lectureId: event.data.lectureId,
          });
        }),
      );

      await step.run("generate-lecture-notes", () =>
        withStepBudget(async () => {
          await generateLectureNotesFromStoredTranscript({
            lectureId: event.data.lectureId,
          });
        }),
      );
    } catch (error) {
      await step.run("mark-lecture-failed", async () => {
        await markLecturePipelineFailed({
          lectureId: event.data.lectureId,
          error,
        });
      });

      throw error;
    }
  },
);

export const processLectureNotesFunction = inngest.createFunction(
  { id: "process-lecture-notes" },
  { event: "lecture/notes.requested" },
  async ({ event, step }) => {
    try {
      await step.run("generate-lecture-notes", () =>
        withStepBudget(async () => {
          await generateLectureNotesFromStoredTranscript({
            lectureId: event.data.lectureId,
          });
        }),
      );
    } catch (error) {
      await step.run("mark-lecture-failed", async () => {
        await markLecturePipelineFailed({
          lectureId: event.data.lectureId,
          error,
        });
      });

      throw error;
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
