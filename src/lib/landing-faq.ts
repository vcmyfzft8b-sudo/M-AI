import type { MessageKey } from "@/lib/i18n/messages/keys";

/*
 * The five questions the landing page answers, and their answers.
 *
 * Plain data in a module of its own, because both consumers need the real
 * array: the accordion is a client component, and the page emits the same five
 * as `FAQPage` structured data from the server. Exporting the list from the
 * accordion itself does not work — a value imported across a "use client"
 * boundary reaches the server as a client reference, not as an array, and
 * `.map` on it throws at request time.
 *
 * One source either way: a question that appears in the markup and not in the
 * schema, or the reverse, is the kind of mismatch Google treats as spam.
 *
 * The language answer used to promise study material "in another language too",
 * which the app has not done since it started writing every note in the
 * language of the source it was given (see `buildGeneratedContentLanguageInstruction`
 * in src/lib/languages.ts). Translating that claim into four more languages
 * would have spread a promise the product does not keep, so the answer now
 * says what actually happens.
 */
export const FAQ_ROWS: Array<{ q: MessageKey; a: MessageKey }> = [
  { q: "landing.faq.processing.q", a: "landing.faq.processing.a" },
  { q: "landing.faq.formats.q", a: "landing.faq.formats.a" },
  { q: "landing.faq.language.q", a: "landing.faq.language.a" },
  { q: "landing.faq.recordings.q", a: "landing.faq.recordings.a" },
  { q: "landing.faq.price.q", a: "landing.faq.price.a" },
];
