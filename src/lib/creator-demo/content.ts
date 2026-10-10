/**
 * Static study material for the `/creator` demo. Nothing here is generated at
 * runtime: every note, flashcard, quiz question and practice question is
 * authored so UGC recordings always show the same polished content, with no
 * account, no upload and no AI call involved.
 *
 * The material exists once per app language (`./locales`), and the demo shows
 * the copy in the reader's locale — the same cookie-then-country-then-English
 * decision the rest of the app is rendered with — so a creator recording in
 * Serbia sees a Serbian app with Serbian notes, not a Serbian app wrapped
 * around Slovenian ones. Slovenian is the source the others are translated
 * from; `tests/creator-demo-locales.test.mjs` keeps them in step.
 *
 * The markdown follows the same "Structured Plus" shape, with the same section
 * headings, the real note generator produces for that language (see
 * `getStructuredPlusLabels`), so the demo renders identically to production
 * notes.
 */
import type { Locale } from "@/lib/i18n/locales";
import type { DemoLocaleContent, DemoNotePack } from "@/lib/creator-demo/content-types";
import { BS_DEMO_CONTENT } from "@/lib/creator-demo/locales/bs";
import { EN_DEMO_CONTENT } from "@/lib/creator-demo/locales/en";
import { HR_DEMO_CONTENT } from "@/lib/creator-demo/locales/hr";
import { SL_DEMO_CONTENT } from "@/lib/creator-demo/locales/sl";
import { SR_DEMO_CONTENT } from "@/lib/creator-demo/locales/sr";

export type * from "@/lib/creator-demo/content-types";

const DEMO_CONTENT: Record<Locale, DemoLocaleContent> = {
  sl: SL_DEMO_CONTENT,
  en: EN_DEMO_CONTENT,
  hr: HR_DEMO_CONTENT,
  bs: BS_DEMO_CONTENT,
  sr: SR_DEMO_CONTENT,
};

export function getDemoContent(locale: Locale): DemoLocaleContent {
  return DEMO_CONTENT[locale] ?? SL_DEMO_CONTENT;
}

export function getDemoNotePack(key: string, locale: Locale): DemoNotePack {
  const { packs } = getDemoContent(locale);
  return packs.find((pack) => pack.key === key) ?? packs[0];
}

/**
 * Notes the demo library starts with. `daysAgo` keeps the list dates looking
 * lived-in without ever depending on a build timestamp.
 */
export const DEMO_SEED_NOTES: Array<{
  id: string;
  packKey: string;
  daysAgo: number;
}> = [
  { id: "demo-note-mikroekonomija", packKey: "mikroekonomija", daysAgo: 1 },
  { id: "demo-note-anatomija", packKey: "anatomija", daysAgo: 3 },
  { id: "demo-note-erp", packKey: "erp", daysAgo: 6 },
  { id: "demo-note-zgodovina", packKey: "zgodovina", daysAgo: 11 },
];

/** Folders the demo library starts with; their names are in each language's `folderNames`. */
export const DEMO_SEED_FOLDERS: Array<{
  id: string;
  noteIds: string[];
}> = [
  {
    id: "demo-folder-izpiti",
    noteIds: ["demo-note-mikroekonomija", "demo-note-anatomija"],
  },
  {
    id: "demo-folder-seminarska",
    noteIds: ["demo-note-erp"],
  },
];

/**
 * Which pack a newly created demo note gets, by the source the creator picked.
 * Titles stay tied to the content so a recording never shows a note whose title
 * and body disagree.
 */
export const DEMO_CREATE_PACKS: Record<
  "record" | "upload" | "pdf" | "photo" | "link",
  string[]
> = {
  record: ["mikroekonomija"],
  upload: ["mikroekonomija"],
  pdf: ["anatomija"],
  photo: ["anatomija"],
  link: ["erp"],
};
