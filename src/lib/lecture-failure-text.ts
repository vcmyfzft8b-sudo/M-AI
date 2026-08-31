import "server-only";

import { SOURCE_LOCALE } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/messages";
import { createTranslator } from "@/lib/i18n/translate";
import { LECTURE_FAILURE_MESSAGE_KEYS } from "@/lib/lecture-failure-codes";
import { ExpectedLectureInputError } from "@/lib/lecture-processing-errors";

/**
 * The pipeline's own failures, raised by code rather than by sentence.
 *
 * A pipeline run has no reader and no request: it happens in the background,
 * possibly hours before anybody opens the note, so it cannot know which of five
 * languages to write in. What it can do is record *which* failure happened. The
 * screens resolve that code into the reader's language at render time
 * (`lectureFailureMessage`).
 *
 * The row still gets a written message, in the source language, for three
 * readers who are not the learner: the triage automation, Sentry, and anyone
 * reading the table directly. It is also the fallback the UI falls back to for
 * rows written before the codes existed.
 */
const sourceTranslate = createTranslator(SOURCE_LOCALE, [getMessages(SOURCE_LOCALE)]);

/**
 * A message in the source language, for text that is written by a background run and read by
 * our own tooling rather than by a learner — a row's `error_message`, a log line, a Sentry
 * title. Anything a learner actually reads goes through their own translator instead.
 */
export function sourceLocaleMessage(key: Parameters<typeof sourceTranslate>[0]) {
  return sourceTranslate(key);
}

export function sourceLocaleFailureMessage(code: string) {
  const key = LECTURE_FAILURE_MESSAGE_KEYS[code];

  return key ? sourceTranslate(key) : code;
}

/** An expected-input failure, with its stored message derived from its code. */
export function expectedInputFailure(code: string) {
  return new ExpectedLectureInputError(sourceLocaleFailureMessage(code), code);
}
