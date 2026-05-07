import { inngest } from "@/inngest/client";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
  transcribeLectureContent,
} from "@/lib/pipeline";
import { generateLecturePracticeTest } from "@/lib/practice-test";
import { generateLectureQuiz } from "@/lib/quiz";
import { generateLectureFlashcards } from "@/lib/study";

export const processLectureFunction = inngest.createFunction(
  { id: "process-lecture" },
  { event: "lecture/process.requested" },
  async ({ event, step }) => {
    try {
      await step.run("transcribe-lecture", async () => {
        await transcribeLectureContent({
          lectureId: event.data.lectureId,
        });
      });

      await step.run("generate-lecture-notes", async () => {
        await generateLectureNotesFromStoredTranscript({
          lectureId: event.data.lectureId,
        });
      });
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
      await step.run("generate-lecture-notes", async () => {
        await generateLectureNotesFromStoredTranscript({
          lectureId: event.data.lectureId,
        });
      });
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
      await generateLectureFlashcards({
        lectureId: event.data.lectureId,
      });
    });
  },
);

export const processLectureQuizFunction = inngest.createFunction(
  { id: "process-lecture-quiz" },
  { event: "lecture/quiz.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture-quiz", async () => {
      await generateLectureQuiz({
        lectureId: event.data.lectureId,
      });
    });
  },
);

export const processLecturePracticeTestFunction = inngest.createFunction(
  { id: "process-lecture-practice-test" },
  { event: "lecture/practice-test.requested" },
  async ({ event, step }) => {
    await step.run("process-lecture-practice-test", async () => {
      await generateLecturePracticeTest({
        lectureId: event.data.lectureId,
        regenerate: Boolean(event.data.regenerate),
      });
    });
  },
);
