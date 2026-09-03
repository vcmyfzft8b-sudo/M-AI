import type { CSSProperties } from "react";

import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

export type SourceKind = "audio" | "pdf" | "text" | "link";
export type NoteStatus = "uploading" | "queued" | "transcribing" | "generating_notes" | "ready" | "failed";

export type PreviewNote = {
  id: string;
  emoji: string;
  title: string;
  /*
   * Which sample lecture this note is. Carried on the row rather than guessed
   * from the title, which used to be matched against Slovenian words and could
   * not survive the title being translated.
   */
  theme: NoteThemeKey;
  source: SourceKind;
  /**
   * An ISO date, formatted per locale by the replica exactly as the real
   * library formats a note's — a written-out date would be Slovenian in every
   * language, and the date column is chrome, not the learner's material.
   */
  date: string;
  status: NoteStatus;
};

export type PreviewFolder = {
  id: string;
  name: string;
  icon: string;
  noteIds: string[];
};

export type CaptureMode = "record" | "upload" | "file" | "link";

/*
 * The replica's chrome is translated; the study material inside it is not.
 * Every label, caption and status below carries a message key. The flashcards,
 * quiz questions, transcript and note bodies further down stay in Slovenian:
 * they stand in for the learner's own coursework, which is in whatever language
 * it was written in however the interface is set.
 */

/* The create sheet's four rows, as `createOptions` lists them. */
export const CREATE_OPTIONS: Array<{ id: CaptureMode; emoji: string; labelKey: MessageKey }> = [
  { id: "record", emoji: "🎙️", labelKey: "preview.create.record" },
  { id: "upload", emoji: "🔊", labelKey: "preview.create.upload" },
  { id: "file", emoji: "📚", labelKey: "preview.create.file" },
  { id: "link", emoji: "🔗", labelKey: "preview.create.link" },
];

/*
 * The capture screen each option opens, from the design's own `CAPTURE` table.
 * `noteTitle` is the title the finished note takes, as `addNote` sets it.
 */
export const CAPTURE: Record<
  CaptureMode,
  {
    titleKey: MessageKey;
    ctaKey: MessageKey;
    emoji: string;
    source: SourceKind;
    placeholderKey?: MessageKey;
    /* The literal placeholder, for the one that is a URL in every language. */
    placeholder?: string;
    noteTitleKey: MessageKey;
    /* The demo already has something to work with, so the capture screen opens
       on a chosen file rather than an empty picker: this is what it shows. */
    pickedName?: string;
    pickedMeta?: string;
    pickedMetaKey?: MessageKey;
    pickedText?: string;
  }
> = {
  record: {
    titleKey: "preview.create.record",
    ctaKey: "preview.capture.stopAndCreate",
    emoji: "🎙️",
    source: "audio",
    noteTitleKey: "preview.noteTitle.record",
  },
  upload: {
    titleKey: "preview.create.upload",
    ctaKey: "preview.capture.create",
    emoji: "🔊",
    placeholderKey: "capture.audioFormats",
    source: "audio",
    noteTitleKey: "preview.noteTitle.upload",
    pickedName: "Predavanje-IS-4.m4a",
    pickedMeta: "51,2 MB • 47:38",
  },
  file: {
    titleKey: "preview.create.file",
    ctaKey: "preview.capture.create",
    emoji: "📚",
    placeholderKey: "preview.capture.fileFormats",
    source: "pdf",
    noteTitleKey: "preview.noteTitle.file",
    pickedName: "Poslovni-IS-skripta.pdf",
    pickedMetaKey: "preview.sheet.pageCount",
  },
  link: {
    titleKey: "preview.create.link",
    ctaKey: "preview.capture.create",
    emoji: "🔗",
    placeholder: "https://…",
    source: "link",
    noteTitleKey: "preview.noteTitle.link",
    pickedText: "https://www.finance.si/erp-sistemi-v-praksi",
  },
};

/* The help centre's three groups, exactly as the design's `helpSections` list
   them. The rows lead somewhere in the real app; here they are the design's
   own inert rows. */
export const HELP_SECTIONS: Array<{ titleKey: MessageKey; itemKeys: MessageKey[] }> = [
  {
    titleKey: "help.category.common",
    itemKeys: [
      "preview.help.familyTitle",
      "preview.help.giftTitle",
      "preview.help.languageTitle",
      "preview.help.featureTitle",
    ],
  },
  {
    titleKey: "help.category.recording",
    itemKeys: ["preview.help.videoTitle", "preview.help.audioTitle", "preview.help.transcriptTitle"],
  },
  {
    titleKey: "help.category.account",
    itemKeys: [
      "preview.help.redeemTitle",
      "landing.footer.privacy",
      "landing.footer.refunds",
      "landing.footer.terms",
    ],
  },
];

export const THEME_OPTIONS = [
  { value: "system", labelKey: "settings.theme.system", icon: "💻" },
  { value: "light", labelKey: "settings.theme.light", icon: "☀️" },
  { value: "dark", labelKey: "settings.theme.dark", icon: "🌙" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey; icon: string }>;

export type PreviewTheme = (typeof THEME_OPTIONS)[number]["value"];

/*
 * The mockup's palette: the `.phone` token block from the redesign's phone
 * artboard, verbatim. The names keep an `--m-` prefix because the mockup
 * renders inside the landing page, where `--surface` and friends already belong
 * to something else. `landing.css` states the same pair for the system theme;
 * these are what the in-mockup theme switch writes inline.
 */
export const LIGHT_TOKENS: Record<string, string> = {
  "--m-bg": "#f1f1f5",
  "--m-surface": "#ffffff",
  "--m-label": "#000000",
  "--m-second": "#8e8e95",
  "--m-tile": "rgba(0,0,0,0.05)",
  "--m-field": "rgba(0,0,0,0.07)",
  "--m-line": "rgba(0,0,0,0.09)",
  "--m-shadow": "0 2px 10px rgba(0,0,0,0.05)",
  "--m-shadow-lg": "0 -12px 40px rgba(0,0,0,0.18)",
  "--m-promo": "#5b21e0",
  "--m-scrim": "rgba(0,0,0,0.28)",
  "--m-focus-ring": "rgba(0,0,0,0.22)",
  "--m-head-hl": "color-mix(in srgb, #2563eb 24%, transparent)",
  "--m-callout-definition-line": "color-mix(in srgb, #2563eb 20%, var(--m-line))",
  "--m-callout-definition-bg": "color-mix(in srgb, #dbeafe 44%, var(--m-surface))",
  "--m-callout-example-line": "color-mix(in srgb, #16a34a 20%, var(--m-line))",
  "--m-callout-example-bg": "color-mix(in srgb, #dcfce7 40%, var(--m-surface))",
  "--m-callout-mistake-line": "color-mix(in srgb, #dc2626 20%, var(--m-line))",
  "--m-callout-mistake-bg": "color-mix(in srgb, #fee2e2 38%, var(--m-surface))",
  "--m-callout-takeaway-line": "color-mix(in srgb, #f59e0b 22%, var(--m-line))",
  "--m-callout-takeaway-bg": "color-mix(in srgb, #fef3c7 44%, var(--m-surface))",
  "--m-drag-easy-bg": "rgba(230,246,234,0.9)",
  "--m-drag-easy-ink": "#16a34a",
  "--m-drag-again-bg": "rgba(253,233,230,0.9)",
  "--m-drag-again-ink": "#dc2626",
  "--m-exit-easy-bg": "#e6f6ea",
  "--m-exit-easy-line": "#67d48a",
  "--m-exit-again-bg": "#fde9e6",
  "--m-exit-again-line": "#f28b82",
};

export const DARK_TOKENS: Record<string, string> = {
  "--m-bg": "#000000",
  "--m-surface": "#1c1c1e",
  "--m-label": "#ffffff",
  "--m-second": "#8e8e95",
  "--m-tile": "rgba(255,255,255,0.09)",
  "--m-field": "rgba(255,255,255,0.12)",
  "--m-line": "rgba(255,255,255,0.14)",
  "--m-shadow": "0 2px 10px rgba(0,0,0,0.5)",
  "--m-shadow-lg": "0 -12px 40px rgba(0,0,0,0.75)",
  "--m-promo": "#b18bff",
  "--m-scrim": "rgba(0,0,0,0.5)",
  "--m-focus-ring": "rgba(255,255,255,0.28)",
  "--m-head-hl": "color-mix(in srgb, #2563eb 42%, transparent)",
  "--m-callout-definition-line": "color-mix(in srgb, #2563eb 28%, var(--m-line))",
  "--m-callout-definition-bg": "color-mix(in srgb, #1d4ed8 22%, var(--m-surface))",
  "--m-callout-example-line": "color-mix(in srgb, #16a34a 28%, var(--m-line))",
  "--m-callout-example-bg": "color-mix(in srgb, #15803d 22%, var(--m-surface))",
  "--m-callout-mistake-line": "color-mix(in srgb, #dc2626 28%, var(--m-line))",
  "--m-callout-mistake-bg": "color-mix(in srgb, #b91c1c 20%, var(--m-surface))",
  "--m-callout-takeaway-line": "color-mix(in srgb, #f59e0b 30%, var(--m-line))",
  "--m-callout-takeaway-bg": "color-mix(in srgb, #b45309 22%, var(--m-surface))",
  "--m-drag-easy-bg": "color-mix(in srgb, var(--m-surface) 78%, #32d74b)",
  "--m-drag-easy-ink": "#32d74b",
  "--m-drag-again-bg": "color-mix(in srgb, var(--m-surface) 78%, #ff453a)",
  "--m-drag-again-ink": "#ff453a",
  "--m-exit-easy-bg": "color-mix(in srgb, var(--m-surface) 82%, #32d74b)",
  "--m-exit-easy-line": "color-mix(in srgb, #32d74b 45%, rgba(255,255,255,0.25))",
  "--m-exit-again-bg": "color-mix(in srgb, var(--m-surface) 82%, #ff453a)",
  "--m-exit-again-line": "color-mix(in srgb, #ff453a 45%, rgba(255,255,255,0.25))",
};

export const TABS = [
  { id: "notes", labelKey: "note.tab.notes", icon: "description", tint: "#f45f5a" },
  /*
   * The spoken walkthrough, second because it is the other way to take in the
   * note itself rather than a fourth kind of study material — you read it, or
   * you have it explained. The app's own row is ordered the same way.
   */
  { id: "tutor", labelKey: "note.tab.tutor", icon: "graphic_eq", tint: "oklch(0.66 0.15 50)" },
  { id: "flashcards", labelKey: "note.tab.flashcards", icon: "style", tint: "oklch(0.66 0.15 295)" },
  { id: "quiz", labelKey: "note.tab.quiz", icon: "quiz", tint: "oklch(0.66 0.15 340)" },
  { id: "test", labelKey: "note.tab.test", icon: "assignment", tint: "oklch(0.66 0.15 150)" },
  { id: "transcript", labelKey: "note.tab.transcript", icon: "text_snippet", tint: "oklch(0.66 0.15 250)" },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: string; tint: string }>;

export type NoteTab = (typeof TABS)[number]["id"];

/** What the phone's nav bar names each screen behind the note. */
export const SUB_SCREEN_TITLE_KEYS: Record<NoteTab, MessageKey | null> = {
  notes: null,
  tutor: "tutor.subScreenTitle",
  flashcards: "note.tab.flashcards",
  quiz: "note.tab.quiz",
  test: "preview.subScreen.test",
  transcript: "note.tab.transcript",
};

export type NoteThemeKey = "is" | "micro" | "anatomy" | "stats";

export type ChatMessage = { role: "assistant" | "user"; text: string };

export type ThemeStudy = {
  cards: Array<{ front: string; back: string }>;
  practice: Array<{ id: string; prompt: string }>;
  quiz: Array<{ question: string; options: string[]; correct: number; explanation: string }>;
  transcript: Array<{ time: string; text: string }>;
  chat: ChatMessage[];
  chatReply: string;
};

/*
 * The same shape, by key. The demo lecture is the first thing a visitor reads,
 * so it is written in their language like everything else around it — the
 * boundary that keeps a *learner's own* material in its original language
 * applies inside the app, not to the marketing page's sample.
 */
export type ThemeStudyKeys = {
  cards: Array<{ frontKey: MessageKey; backKey: MessageKey }>;
  practice: Array<{ id: string; promptKey: MessageKey }>;
  quiz: Array<{
    questionKey: MessageKey;
    optionKeys: MessageKey[];
    correct: number;
    explanationKey: MessageKey;
  }>;
  transcript: Array<{ time: string; textKey: MessageKey }>;
  chat: Array<{ role: ChatMessage["role"]; textKey: MessageKey }>;
  chatReplyKey: MessageKey;
};

const TIMES_IS = ["00:12", "04:38", "11:05", "23:41"].map(String);
const TIMES_MICRO = ["00:20", "06:14", "14:52", "27:09"].map(String);
const TIMES_ANATOMY = ["00:15", "05:47", "13:22", "25:36"].map(String);
const TIMES_STATS = ["00:18", "07:42", "15:10", "26:55"].map(String);
const CORRECT_IS_1 = 0;
const CORRECT_IS_2 = 1;
const CORRECT_MICRO_1 = 0;
const CORRECT_MICRO_2 = 0;
const CORRECT_ANATOMY_1 = 0;
const CORRECT_ANATOMY_2 = 2;
const CORRECT_STATS_1 = 0;
const CORRECT_STATS_2 = 1;

export const THEME_STUDY_KEYS: Record<NoteThemeKey, ThemeStudyKeys> = {
  is: {
    cards: [
      { frontKey: "pv.is.card1F", backKey: "pv.is.card1B" },
      { frontKey: "pv.is.card2F", backKey: "pv.is.card2B" },
      { frontKey: "pv.is.card3F", backKey: "pv.is.card3B" },
    ],
    practice: [
      { id: "p1", promptKey: "pv.is.practice1" },
      { id: "p2", promptKey: "pv.is.practice2" },
    ],
    quiz: [
      {
        questionKey: "pv.is.quiz1Q",
        optionKeys: ["pv.is.quiz1O1", "pv.is.quiz1O2", "pv.is.quiz1O3", "pv.is.quiz1O4"],
        correct: CORRECT_IS_1,
        explanationKey: "pv.is.quiz1E",
      },
      {
        questionKey: "pv.is.quiz2Q",
        optionKeys: ["pv.is.quiz2O1", "pv.is.quiz2O2", "pv.is.quiz2O3", "pv.is.quiz2O4"],
        correct: CORRECT_IS_2,
        explanationKey: "pv.is.quiz2E",
      },
    ],
    transcript: [
      { time: TIMES_IS[0], textKey: "pv.is.tr1" },
      { time: TIMES_IS[1], textKey: "pv.is.tr2" },
      { time: TIMES_IS[2], textKey: "pv.is.tr3" },
      { time: TIMES_IS[3], textKey: "pv.is.tr4" },
    ],
    chat: [
      { role: "assistant", textKey: "preview.chatGreeting" },
      { role: "user", textKey: "pv.is.chatQ" },
      { role: "assistant", textKey: "pv.is.chatA" },
    ],
    chatReplyKey: "pv.is.chatReply",
  },
  micro: {
    cards: [
      { frontKey: "pv.micro.card1F", backKey: "pv.micro.card1B" },
      { frontKey: "pv.micro.card2F", backKey: "pv.micro.card2B" },
      { frontKey: "pv.micro.card3F", backKey: "pv.micro.card3B" },
    ],
    practice: [
      { id: "p1", promptKey: "pv.micro.practice1" },
      { id: "p2", promptKey: "pv.micro.practice2" },
    ],
    quiz: [
      {
        questionKey: "pv.micro.quiz1Q",
        optionKeys: ["pv.micro.quiz1O1", "pv.micro.quiz1O2", "pv.micro.quiz1O3", "pv.micro.quiz1O4"],
        correct: CORRECT_MICRO_1,
        explanationKey: "pv.micro.quiz1E",
      },
      {
        questionKey: "pv.micro.quiz2Q",
        optionKeys: ["pv.micro.quiz2O1", "pv.micro.quiz2O2", "pv.micro.quiz2O3", "pv.micro.quiz2O4"],
        correct: CORRECT_MICRO_2,
        explanationKey: "pv.micro.quiz2E",
      },
    ],
    transcript: [
      { time: TIMES_MICRO[0], textKey: "pv.micro.tr1" },
      { time: TIMES_MICRO[1], textKey: "pv.micro.tr2" },
      { time: TIMES_MICRO[2], textKey: "pv.micro.tr3" },
      { time: TIMES_MICRO[3], textKey: "pv.micro.tr4" },
    ],
    chat: [
      { role: "assistant", textKey: "preview.chatGreeting" },
      { role: "user", textKey: "pv.micro.chatQ" },
      { role: "assistant", textKey: "pv.micro.chatA" },
    ],
    chatReplyKey: "pv.micro.chatReply",
  },
  anatomy: {
    cards: [
      { frontKey: "pv.anatomy.card1F", backKey: "pv.anatomy.card1B" },
      { frontKey: "pv.anatomy.card2F", backKey: "pv.anatomy.card2B" },
      { frontKey: "pv.anatomy.card3F", backKey: "pv.anatomy.card3B" },
    ],
    practice: [
      { id: "p1", promptKey: "pv.anatomy.practice1" },
      { id: "p2", promptKey: "pv.anatomy.practice2" },
    ],
    quiz: [
      {
        questionKey: "pv.anatomy.quiz1Q",
        optionKeys: ["pv.anatomy.quiz1O1", "pv.anatomy.quiz1O2", "pv.anatomy.quiz1O3", "pv.anatomy.quiz1O4"],
        correct: CORRECT_ANATOMY_1,
        explanationKey: "pv.anatomy.quiz1E",
      },
      {
        questionKey: "pv.anatomy.quiz2Q",
        optionKeys: ["pv.anatomy.quiz2O1", "pv.anatomy.quiz2O2", "pv.anatomy.quiz2O3", "pv.anatomy.quiz2O4"],
        correct: CORRECT_ANATOMY_2,
        explanationKey: "pv.anatomy.quiz2E",
      },
    ],
    transcript: [
      { time: TIMES_ANATOMY[0], textKey: "pv.anatomy.tr1" },
      { time: TIMES_ANATOMY[1], textKey: "pv.anatomy.tr2" },
      { time: TIMES_ANATOMY[2], textKey: "pv.anatomy.tr3" },
      { time: TIMES_ANATOMY[3], textKey: "pv.anatomy.tr4" },
    ],
    chat: [
      { role: "assistant", textKey: "preview.chatGreeting" },
      { role: "user", textKey: "pv.anatomy.chatQ" },
      { role: "assistant", textKey: "pv.anatomy.chatA" },
    ],
    chatReplyKey: "pv.anatomy.chatReply",
  },
  stats: {
    cards: [
      { frontKey: "pv.stats.card1F", backKey: "pv.stats.card1B" },
      { frontKey: "pv.stats.card2F", backKey: "pv.stats.card2B" },
      { frontKey: "pv.stats.card3F", backKey: "pv.stats.card3B" },
    ],
    practice: [
      { id: "p1", promptKey: "pv.stats.practice1" },
      { id: "p2", promptKey: "pv.stats.practice2" },
    ],
    quiz: [
      {
        questionKey: "pv.stats.quiz1Q",
        optionKeys: ["pv.stats.quiz1O1", "pv.stats.quiz1O2", "pv.stats.quiz1O3", "pv.stats.quiz1O4"],
        correct: CORRECT_STATS_1,
        explanationKey: "pv.stats.quiz1E",
      },
      {
        questionKey: "pv.stats.quiz2Q",
        optionKeys: ["pv.stats.quiz2O1", "pv.stats.quiz2O2", "pv.stats.quiz2O3", "pv.stats.quiz2O4"],
        correct: CORRECT_STATS_2,
        explanationKey: "pv.stats.quiz2E",
      },
    ],
    transcript: [
      { time: TIMES_STATS[0], textKey: "pv.stats.tr1" },
      { time: TIMES_STATS[1], textKey: "pv.stats.tr2" },
      { time: TIMES_STATS[2], textKey: "pv.stats.tr3" },
      { time: TIMES_STATS[3], textKey: "pv.stats.tr4" },
    ],
    chat: [
      { role: "assistant", textKey: "preview.chatGreeting" },
      { role: "user", textKey: "pv.stats.chatQ" },
      { role: "assistant", textKey: "pv.stats.chatA" },
    ],
    chatReplyKey: "pv.stats.chatReply",
  },
};

/*
 * A note body, in the blocks the design's own renderer takes: a highlighted
 * heading, bulleted lines, plain lines and the four callouts. `blockStyle`
 * below is the artboard's function, transcribed.
 */
export type NoteBlockKind =
  | "h2"
  | "li"
  | "p"
  | "callout-definition"
  | "callout-example"
  | "callout-common_mistake"
  | "callout-key_takeaway";

export type NoteBlock = { text: string; kind: NoteBlockKind };

/*
 * The left rule stays one colour in both themes; the fill and the hairline
 * change with it, so each callout reads as a tint of its own colour rather
 * than a washed-out block on a dark page. The pairs live in landing.css.
 */
const CALLOUTS: Record<string, { edge: string; token: string }> = {
  definition: { edge: "#2563eb", token: "definition" },
  example: { edge: "#16a34a", token: "example" },
  common_mistake: { edge: "#dc2626", token: "mistake" },
  key_takeaway: { edge: "#f59e0b", token: "takeaway" },
};

export function blockStyle(kind: NoteBlockKind): CSSProperties {
  if (kind === "h2") {
    return {
      display: "inline-block",
      margin: "30.4px 0 11.2px",
      padding: "1.6px 5.12px",
      borderRadius: "6.72px",
      background: "var(--m-head-hl)",
      color: "var(--m-label)",
      fontSize: "21.12px",
      fontWeight: 800,
      letterSpacing: "-0.035em",
    };
  }
  if (kind.startsWith("callout-")) {
    const c = CALLOUTS[kind.slice(8)] ?? CALLOUTS.definition;
    return {
      margin: "16px 0",
      padding: "13.6px 16px 13.6px 18.4px",
      borderRadius: "14px",
      border: `1px solid var(--m-callout-${c.token}-line)`,
      borderLeft: `4px solid ${c.edge}`,
      background: `var(--m-callout-${c.token}-bg)`,
      fontSize: "16.96px",
      lineHeight: 1.82,
      letterSpacing: "-0.015em",
    };
  }
  return {
    position: "relative",
    margin: "0 0 8.8px",
    paddingLeft: "16.8px",
    fontSize: "16.96px",
    lineHeight: 1.82,
    letterSpacing: "-0.015em",
  };
}

export type NoteBlockKeys = { textKey: MessageKey; kind: NoteBlockKind };

export const NOTE_BODY_KEYS: Record<NoteThemeKey, NoteBlockKeys[]> = {
  is: [
    { kind: "h2", textKey: "pv.body.overview" },
    { kind: "p", textKey: "pv.is.body1" },
    { kind: "callout-definition", textKey: "pv.is.bodyDef" },
    { kind: "h2", textKey: "pv.body.keyTerms" },
    { kind: "li", textKey: "pv.is.bodyLi1" },
    { kind: "li", textKey: "pv.is.bodyLi2" },
    { kind: "li", textKey: "pv.is.bodyLi3" },
    { kind: "callout-common_mistake", textKey: "pv.is.bodyMistake" },
    { kind: "h2", textKey: "pv.body.forExam" },
    { kind: "callout-key_takeaway", textKey: "pv.is.bodyKey" },
    { kind: "li", textKey: "pv.is.bodyLast" },
  ],
  micro: [
    { kind: "h2", textKey: "pv.body.overview" },
    { kind: "p", textKey: "pv.micro.body1" },
    { kind: "callout-definition", textKey: "pv.micro.bodyDef" },
    { kind: "h2", textKey: "pv.body.keyTerms" },
    { kind: "li", textKey: "pv.micro.bodyLi1" },
    { kind: "li", textKey: "pv.micro.bodyLi2" },
    { kind: "li", textKey: "pv.micro.bodyLi3" },
    { kind: "callout-common_mistake", textKey: "pv.micro.bodyMistake" },
    { kind: "h2", textKey: "pv.body.forExam" },
    { kind: "callout-key_takeaway", textKey: "pv.micro.bodyKey" },
    { kind: "li", textKey: "pv.micro.bodyLast" },
  ],
  anatomy: [
    { kind: "h2", textKey: "pv.body.overview" },
    { kind: "p", textKey: "pv.anatomy.body1" },
    { kind: "callout-definition", textKey: "pv.anatomy.bodyDef" },
    { kind: "h2", textKey: "pv.body.keyTerms" },
    { kind: "li", textKey: "pv.anatomy.bodyLi1" },
    { kind: "li", textKey: "pv.anatomy.bodyLi2" },
    { kind: "li", textKey: "pv.anatomy.bodyLi3" },
    { kind: "callout-common_mistake", textKey: "pv.anatomy.bodyMistake" },
    { kind: "h2", textKey: "pv.body.forExam" },
    { kind: "callout-key_takeaway", textKey: "pv.anatomy.bodyKey" },
    { kind: "li", textKey: "pv.anatomy.bodyLast" },
  ],
  stats: [
    { kind: "h2", textKey: "pv.body.overview" },
    { kind: "p", textKey: "pv.stats.body1" },
    { kind: "callout-definition", textKey: "pv.stats.bodyDef" },
    { kind: "h2", textKey: "pv.body.keyTerms" },
    { kind: "li", textKey: "pv.stats.bodyLi1" },
    { kind: "li", textKey: "pv.stats.bodyLi2" },
    { kind: "li", textKey: "pv.stats.bodyLi3" },
    { kind: "callout-common_mistake", textKey: "pv.stats.bodyMistake" },
    { kind: "h2", textKey: "pv.body.forExam" },
    { kind: "callout-key_takeaway", textKey: "pv.stats.bodyKey" },
    { kind: "li", textKey: "pv.stats.bodyLast" },
  ],
};

/*
 * Read-aloud highlighting, matching `.note-read-word` in globals.css exactly:
 * a pale wash behind everything already spoken, a solid marker with a thin ring
 * on the word being read, and its own dark pair for each. The span wraps the
 * word alone — the spaces between words sit outside it, which is what keeps the
 * marks as tight word-shaped chips instead of one ragged band.
 */
const READ_HL = {
  readBg: "#ffedd5",
  readColor: "#7c2d12",
  currentBg: "#fb923c",
  currentColor: "#431407",
  currentRing: "rgba(251, 146, 60, 0.28)",
  darkReadBg: "rgba(251, 146, 60, 0.22)",
  darkReadColor: "#fed7aa",
  darkCurrentBg: "#c2410c",
  darkCurrentColor: "#fff7ed",
  darkCurrentRing: "rgba(251, 146, 60, 0.36)",
};

export type BodyWord = { index: number; text: string };
export type BodyLine = { kind: NoteBlockKind; words: BodyWord[] };

/** Splits a body into words carrying one running index, as the design does. */
export function tokenizeBody(blocks: NoteBlock[]): BodyLine[] {
  let index = 0;
  return blocks.map((block) => ({
    kind: block.kind,
    words: block.text
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => ({ index: index++, text })),
  }));
}

export function readWordStyle(state: "cur" | "read" | "", dark: boolean): CSSProperties {
  const base: CSSProperties = {
    borderRadius: "4.48px",
    padding: "0.48px 1.6px",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
    transition: "background-color 0.12s ease, box-shadow 0.12s ease, color 0.12s ease",
  };
  if (state === "read") {
    return {
      ...base,
      background: dark ? READ_HL.darkReadBg : READ_HL.readBg,
      color: dark ? READ_HL.darkReadColor : READ_HL.readColor,
    };
  }
  if (state === "cur") {
    return {
      ...base,
      background: dark ? READ_HL.darkCurrentBg : READ_HL.currentBg,
      color: dark ? READ_HL.darkCurrentColor : READ_HL.currentColor,
      boxShadow: `0 0 0 1.76px ${dark ? READ_HL.darkCurrentRing : READ_HL.currentRing}`,
    };
  }
  return base;
}

/**
 * "Today" for a note the visitor makes during the tour. A literal rather than
 * `new Date()`, so the server's first render and the client's hydration agree;
 * the sample library is dated around it.
 */
export const PREVIEW_TODAY = "2026-08-29";

export const INITIAL_NOTE_SEEDS: Array<{
  id: string;
  emoji: string;
  titleKey: MessageKey;
  theme: NoteThemeKey;
  source: SourceKind;
  date: string;
  status: NoteStatus;
}> = [
  { id: "n1", emoji: "📊", titleKey: "pv.note1Title", theme: "is", source: "audio", date: "2026-08-28", status: "ready" },
  { id: "n2", emoji: "📈", titleKey: "pv.note2Title", theme: "micro", source: "pdf", date: "2026-08-27", status: "ready" },
  { id: "n3", emoji: "🧠", titleKey: "pv.note3Title", theme: "anatomy", source: "audio", date: "2026-08-26", status: "ready" },
  { id: "n4", emoji: "⚖️", titleKey: "pv.note4Title", theme: "is", source: "link", date: "2026-08-24", status: "ready" },
  { id: "n5", emoji: "🎲", titleKey: "pv.note5Title", theme: "stats", source: "text", date: "2026-08-20", status: "ready" },
];

export function initialNotes(t: Translate<MessageKey>): PreviewNote[] {
  return INITIAL_NOTE_SEEDS.map((seed) => ({
    id: seed.id,
    emoji: seed.emoji,
    title: t(seed.titleKey),
    theme: seed.theme,
    source: seed.source,
    date: seed.date,
    status: seed.status,
  }));
}

export function initialFolders(t: Translate<MessageKey>): PreviewFolder[] {
  return [
    { id: "f1", name: t("pv.folderLectures"), icon: "📘", noteIds: ["n1", "n3"] },
    { id: "f2", name: t("pv.folderExams"), icon: "🎓", noteIds: ["n2", "n4", "n5"] },
  ];
}

export const SOURCE_LABEL_KEYS: Record<SourceKind, MessageKey> = {
  audio: "source.audio",
  pdf: "source.pdf",
  text: "source.text",
  link: "source.link",
};

/** The percentage a results screen reports, clamped and rounded. */
export function completionPct(done: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}


/** The reader's-language view of a theme's study material. */
export function resolveThemeStudy(theme: NoteThemeKey, t: Translate<MessageKey>): ThemeStudy {
  const keys = THEME_STUDY_KEYS[theme];

  return {
    cards: keys.cards.map((card) => ({ front: t(card.frontKey), back: t(card.backKey) })),
    practice: keys.practice.map((item) => ({ id: item.id, prompt: t(item.promptKey) })),
    quiz: keys.quiz.map((question) => ({
      question: t(question.questionKey),
      options: question.optionKeys.map((key) => t(key)),
      correct: question.correct,
      explanation: t(question.explanationKey),
    })),
    transcript: keys.transcript.map((line) => ({ time: line.time, text: t(line.textKey) })),
    chat: keys.chat.map((message) => ({ role: message.role, text: t(message.textKey) })),
    chatReply: t(keys.chatReplyKey),
  };
}

export function resolveNoteBody(theme: NoteThemeKey, t: Translate<MessageKey>): NoteBlock[] {
  return NOTE_BODY_KEYS[theme].map((block) => ({ kind: block.kind, text: t(block.textKey) }));
}
