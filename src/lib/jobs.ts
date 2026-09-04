import "server-only";

import { inngest } from "@/inngest/client";
import { processStoredDocumentLecture } from "@/lib/document-processing";
import { processStoredLinkLecture } from "@/lib/link-processing";
import {
  generateLectureNotesFromStoredTranscript,
  markLecturePipelineFailed,
  runLecturePipeline,
} from "@/lib/pipeline";
import { generateLecturePracticeTest } from "@/lib/practice-test";
import { generateLectureQuiz } from "@/lib/quiz";
import { processStoredScanLecture } from "@/lib/scan-processing";
import { getServerEnv } from "@/lib/server-env";
import { generateLectureFlashcards } from "@/lib/study";
import { warmTutorPlan } from "@/lib/tutor-plan";

export type LectureProcessingStage = "transcribe" | "generate_notes";

const INTERNAL_LECTURE_PROCESSING_PATH = "/api/internal/lectures/process";
const INTERNAL_LECTURE_SCAN_PATH = "/api/internal/lectures/scan";
const INTERNAL_LECTURE_DOCUMENT_PATH = "/api/internal/lectures/document";
const INTERNAL_LECTURE_LINK_PATH = "/api/internal/lectures/link";
const INTERNAL_LECTURE_PRACTICE_TEST_PATH = "/api/internal/lectures/practice-test";
const INTERNAL_LECTURE_STUDY_PATH = "/api/internal/lectures/study";
const INTERNAL_LECTURE_QUIZ_PATH = "/api/internal/lectures/quiz";
const INTERNAL_LECTURE_TUTOR_PLAN_PATH = "/api/internal/lectures/tutor-plan";

function hasInngestJobCredentials(env: ReturnType<typeof getServerEnv>) {
  return Boolean(env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY);
}

function shouldUseHostedInngestJobs(env: ReturnType<typeof getServerEnv>) {
  return (
    hasInngestJobCredentials(env) &&
    (process.env.VERCEL_ENV === "production" || process.env.USE_INNGEST_JOBS === "true")
  );
}

function buildInternalJobHeaders(env: ReturnType<typeof getServerEnv>) {
  return {
    "content-type": "application/json",
    "x-internal-job-secret": env.INTERNAL_JOB_SECRET ?? "",
    ...(env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : {}),
  };
}

function getInternalJobBaseUrl(publicSiteUrl?: string) {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (process.env.NODE_ENV === "development") {
    return `http://localhost:${process.env.PORT ?? "3000"}`;
  }

  return publicSiteUrl;
}

export async function enqueueLectureProcessingStage(params: {
  lectureId: string;
  stage: LectureProcessingStage;
}) {
  const env = getServerEnv();
  const internalJobBaseUrl = getInternalJobBaseUrl(env.NEXT_PUBLIC_SITE_URL);

  if (!internalJobBaseUrl || !env.INTERNAL_JOB_SECRET) {
    return false;
  }

  const response = await fetch(
    new URL(INTERNAL_LECTURE_PROCESSING_PATH, internalJobBaseUrl),
    {
      method: "POST",
      headers: buildInternalJobHeaders(env),
      body: JSON.stringify(params),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let message = `Lecture processing stage ${params.stage} could not be started (${response.status}).`;

    try {
      const data = (await response.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      // Ignore JSON parse errors for non-JSON responses.
    }

    throw new Error(message);
  }

  return true;
}

async function tryEnqueueLectureProcessingStage(params: {
  lectureId: string;
  stage: LectureProcessingStage;
}) {
  try {
    return await enqueueLectureProcessingStage(params);
  } catch (error) {
    console.error("Lecture processing stage could not be started", {
      lectureId: params.lectureId,
      stage: params.stage,
      error,
    });
    return false;
  }
}

async function enqueueInternalLectureJob(params: {
  lectureId: string;
  path: string;
  regenerate?: boolean;
}) {
  const env = getServerEnv();
  const internalJobBaseUrl = getInternalJobBaseUrl(env.NEXT_PUBLIC_SITE_URL);

  if (!internalJobBaseUrl || !env.INTERNAL_JOB_SECRET) {
    return false;
  }

  const response = await fetch(new URL(params.path, internalJobBaseUrl), {
    method: "POST",
    headers: buildInternalJobHeaders(env),
    body: JSON.stringify({
      lectureId: params.lectureId,
      ...(typeof params.regenerate === "boolean" ? { regenerate: params.regenerate } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Lecture background job could not be started for ${params.path} (${response.status}).`;

    try {
      const data = (await response.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      // Ignore non-JSON responses.
    }

    throw new Error(message);
  }

  return true;
}

async function tryEnqueueInternalLectureJob(params: {
  lectureId: string;
  path: string;
  regenerate?: boolean;
}) {
  try {
    return await enqueueInternalLectureJob(params);
  } catch (error) {
    console.error("Lecture background job could not be started", {
      lectureId: params.lectureId,
      path: params.path,
      regenerate: params.regenerate,
      error,
    });
    return false;
  }
}

export async function enqueueLectureProcessing(lectureId: string) {
  const env = getServerEnv();

  if (shouldUseHostedInngestJobs(env)) {
    await inngest.send({
      name: "lecture/process.requested",
      data: { lectureId },
    });
    return;
  }

  if (await tryEnqueueLectureProcessingStage({ lectureId, stage: "transcribe" })) {
    return;
  }

  await runLecturePipeline({ lectureId }).catch(() => {
    // Errors are persisted on the lecture row by the pipeline.
  });
}

export async function enqueueLectureNotesGeneration(lectureId: string) {
  const env = getServerEnv();

  if (shouldUseHostedInngestJobs(env)) {
    await inngest.send({
      name: "lecture/notes.requested",
      data: { lectureId },
    });
    return;
  }

  if (await tryEnqueueLectureProcessingStage({ lectureId, stage: "generate_notes" })) {
    return;
  }

  await generateLectureNotesFromStoredTranscript({ lectureId }).catch(async (error) => {
    await markLecturePipelineFailed({ lectureId, error });
  });
}

export async function enqueueLectureScanProcessing(lectureId: string) {
  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_SCAN_PATH,
    })
  ) {
    return;
  }

  try {
    const result = await processStoredScanLecture({ lectureId });

    if (result.needsNotesGeneration) {
      await enqueueLectureNotesGeneration(lectureId);
    }
  } catch (error) {
    await markLecturePipelineFailed({ lectureId, error });
  }
}

export async function enqueueLectureDocumentProcessing(lectureId: string) {
  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_DOCUMENT_PATH,
    })
  ) {
    return;
  }

  try {
    const result = await processStoredDocumentLecture({ lectureId });

    if (result.needsNotesGeneration) {
      await enqueueLectureNotesGeneration(lectureId);
    }
  } catch (error) {
    await markLecturePipelineFailed({ lectureId, error });
  }
}

export async function enqueueLectureLinkProcessing(lectureId: string) {
  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_LINK_PATH,
    })
  ) {
    return;
  }

  try {
    const result = await processStoredLinkLecture({ lectureId });

    if (result.needsNotesGeneration) {
      await enqueueLectureNotesGeneration(lectureId);
    }
  } catch (error) {
    await markLecturePipelineFailed({ lectureId, error });
  }
}

export async function enqueueLectureStudyGeneration(lectureId: string) {
  const env = getServerEnv();

  if (shouldUseHostedInngestJobs(env)) {
    await inngest.send({
      name: "lecture/study.requested",
      data: { lectureId },
    });
    return;
  }

  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_STUDY_PATH,
    })
  ) {
    return;
  }

  await generateLectureFlashcards({ lectureId }).catch((error) => {
    console.error("Lecture study generation failed", { lectureId, error });
  });
}

/**
 * Works out the voice tutor's running order once the note exists, so a learner who starts a
 * session never waits for it.
 *
 * Unlike study items and quizzes, which are generated the first time somebody opens their
 * screen, this cannot be lazy: the plan takes 19 to 51 seconds on the model that plans it well,
 * and the moment it is wanted is the moment the learner has already pressed start. Every failure
 * path here is silent on purpose — the plan regenerates on demand exactly as it did before, so
 * the worst case is the wait this exists to remove rather than a session that will not start.
 */
export async function enqueueLectureTutorPlanGeneration(lectureId: string) {
  const env = getServerEnv();

  if (shouldUseHostedInngestJobs(env)) {
    await inngest.send({
      name: "lecture/tutor-plan.requested",
      data: { lectureId },
    });
    return;
  }

  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_TUTOR_PLAN_PATH,
    })
  ) {
    return;
  }

  await warmTutorPlan(lectureId).catch((error) => {
    console.error("Tutor plan warm-up failed", { lectureId, error });
  });
}

export async function enqueueLectureQuizGeneration(lectureId: string) {
  const env = getServerEnv();

  if (shouldUseHostedInngestJobs(env)) {
    await inngest.send({
      name: "lecture/quiz.requested",
      data: { lectureId },
    });
    return;
  }

  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_QUIZ_PATH,
    })
  ) {
    return;
  }

  await generateLectureQuiz({ lectureId }).catch((error) => {
    console.error("Lecture quiz generation failed", { lectureId, error });
  });
}

export async function enqueueLecturePracticeTestGeneration(
  lectureId: string,
  regenerate = false,
) {
  const env = getServerEnv();

  if (shouldUseHostedInngestJobs(env)) {
    await inngest.send({
      name: "lecture/practice-test.requested",
      data: { lectureId, regenerate },
    });
    return;
  }

  if (
    await tryEnqueueInternalLectureJob({
      lectureId,
      path: INTERNAL_LECTURE_PRACTICE_TEST_PATH,
      regenerate,
    })
  ) {
    return;
  }

  await generateLecturePracticeTest({ lectureId, regenerate }).catch((error) => {
    console.error("Lecture practice-test generation failed", { lectureId, regenerate, error });
  });
}
