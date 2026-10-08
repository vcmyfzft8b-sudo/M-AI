import { getMessages } from "@/lib/i18n/messages";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

/*
 * The oral quiz's chrome, in every language at once.
 *
 * The screen plays in the language picked on it, not the app's, so its strings cannot come
 * from the page's own catalogue. The server hands over just these few, for all five
 * languages, rather than the client loading five whole catalogues.
 */
const KEYS = [
  "product",
  "tagline",
  "lockIn",
  "eyebrow",
  "start",
  "startHint",
  "speaking",
  "listening",
  "again",
  "streak",
] as const;

export type OralQuizCopy = Record<(typeof KEYS)[number], string>;

export function getOralQuizCopy(): Record<Locale, OralQuizCopy> {
  return Object.fromEntries(
    LOCALES.map((locale) => {
      const messages = getMessages(locale);

      return [locale, Object.fromEntries(KEYS.map((key) => [key, String(messages[`ugcQuiz.${key}`])]))];
    }),
  ) as Record<Locale, OralQuizCopy>;
}
