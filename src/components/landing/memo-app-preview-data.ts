import type { MessageKey } from "@/lib/i18n/messages/keys";
import { NOTE_TABS, type NoteTabId } from "@/lib/note-tabs";
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
  /**
   * What the app prints after the source — "47 min" for a recording, "24
   * pages" for a document — as `getLectureSourceDetail` measures it. A link or
   * pasted text carries none.
   */
  detail?: SourceDetail;
};

export type SourceDetail = { minutes: number } | { pages: number };

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

/* The create sheet's four rows, as `MOBILE_CREATE_OPTIONS` in home-dashboard.tsx lists them. */
export const CREATE_OPTIONS: Array<{ id: CaptureMode; emoji: string; labelKey: MessageKey }> = [
  { id: "record", emoji: "🎙️", labelKey: "library.create.record" },
  { id: "upload", emoji: "🔊", labelKey: "library.quickAction.audio" },
  { id: "file", emoji: "📚", labelKey: "library.create.text" },
  { id: "link", emoji: "🔗", labelKey: "library.create.link" },
];

/*
 * The capture screen each option opens, titled as note-source-modal.tsx titles it.
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
    detail?: SourceDetail;
  }
> = {
  record: {
    titleKey: "library.quickAction.record",
    ctaKey: "capture.stopAndCreate",
    emoji: "🎙️",
    source: "audio",
    noteTitleKey: "preview.noteTitle.record",
    detail: { minutes: 1 },
  },
  upload: {
    titleKey: "library.quickAction.audio",
    ctaKey: "capture.createNote",
    emoji: "🔊",
    placeholderKey: "capture.audioFormats",
    source: "audio",
    noteTitleKey: "preview.noteTitle.upload",
    pickedName: "Predavanje-IS-4.m4a",
    /* The clock the app prints under a chosen recording (`formatTimestamp`). */
    pickedMeta: "47:38",
    detail: { minutes: 48 },
  },
  file: {
    titleKey: "capture.title.text",
    ctaKey: "capture.createNote",
    emoji: "📚",
    placeholderKey: "preview.capture.fileFormats",
    source: "pdf",
    noteTitleKey: "preview.noteTitle.file",
    pickedName: "Poslovni-IS-skripta.pdf",
    pickedMetaKey: "preview.sheet.pageCount",
    detail: { pages: 24 },
  },
  link: {
    titleKey: "library.quickAction.link",
    ctaKey: "capture.createNote",
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
 * The note's pill row is the app's own (`NOTE_TABS` in src/lib/note-tabs.ts), in its
 * order, with its icons and tints. The app drops Transcript from notes that have no
 * recording, and so does the replica (`showsTranscript`).
 */
export const TABS = NOTE_TABS;

export type NoteTab = NoteTabId;

/** What the phone's nav bar names each tab in place of the note's emoji (`SUB_SCREEN_TITLE_KEYS`). */
export const SUB_SCREEN_TITLE_KEYS: Record<NoteTab, MessageKey | null> = {
  notes: null,
  tutor: "tutor.subScreenTitle",
  flashcards: "note.tab.flashcards",
  podcast: "note.tab.podcast",
  quiz: "note.tab.quiz",
  mindmap: "note.tab.mindmap",
  palace: "palace.title",
  test: "note.subScreen.test",
  speed: "note.tab.speed",
  transcript: "note.tab.transcript",
};

/*
 * `TABS_WITHOUT_CHAT`: the tabs that are watched, listened to or played rather than
 * read, where the phone shows no chat bar at the foot.
 */
export const TABS_WITHOUT_CHAT: ReadonlySet<NoteTab> = new Set<NoteTab>([
  "mindmap",
  "palace",
  "tutor",
  "speed",
  "podcast",
]);

/* The practice screens the phone's dock gives an edit pill beside the chat bar. */
export const TABS_WITH_MANAGE_PILL: ReadonlySet<NoteTab> = new Set<NoteTab>(["flashcards", "quiz"]);

export type NoteThemeKey = "is" | "micro" | "anatomy" | "stats";

export type ChatMessage = { role: "assistant" | "user"; text: string };

export type ThemeStudy = {
  cards: Array<{ front: string; back: string }>;
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
 * A note body, in the blocks the app's markdown renders it as: a highlighted heading,
 * a list, a paragraph and the four callouts (`data-callout-kind`).
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
 * The callouts' left rule, which stays one colour in both appearances — the app's own
 * values from `.lecture-markdown blockquote[data-callout-kind]` in globals.css. The
 * fill and hairline change with the appearance and live in landing.css
 * (`--hero-callout-*`), keyed on the hero phone's own Appearance setting.
 */
export const CALLOUT_EDGE: Record<string, { edge: string; token: string }> = {
  definition: { edge: "#2563eb", token: "definition" },
  example: { edge: "#16a34a", token: "example" },
  common_mistake: { edge: "#dc2626", token: "mistake" },
  key_takeaway: { edge: "#f59e0b", token: "takeaway" },
};

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

export type BodyWord = { index: number; text: string };
export type BodyLine = { kind: NoteBlockKind; words: BodyWord[] };

/** Splits a body into words carrying one running index, as the read-aloud tokenizer does. */
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

/*
 * The same body as markdown, for the speed reader, which takes the note's own text
 * (`note-speed-reader.tsx` reads the markdown the notes tab renders).
 */
export function noteBodyMarkdown(blocks: NoteBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "h2") return `## ${block.text}`;
      if (block.kind === "li") return `- ${block.text}`;
      if (block.kind.startsWith("callout-")) return `> ${block.text}`;
      return block.text;
    })
    .join("\n\n");
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
  detail?: SourceDetail;
}> = [
  { id: "n1", emoji: "📊", titleKey: "pv.note1Title", theme: "is", source: "audio", date: "2026-08-28", status: "ready", detail: { minutes: 72 } },
  { id: "n2", emoji: "📈", titleKey: "pv.note2Title", theme: "micro", source: "pdf", date: "2026-08-27", status: "ready", detail: { pages: 24 } },
  { id: "n3", emoji: "🧠", titleKey: "pv.note3Title", theme: "anatomy", source: "audio", date: "2026-08-26", status: "ready", detail: { minutes: 47 } },
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
    detail: seed.detail,
  }));
}

export function initialFolders(t: Translate<MessageKey>): PreviewFolder[] {
  return [
    { id: "f1", name: t("pv.folderLectures"), icon: "📁", noteIds: ["n1", "n3"] },
    { id: "f2", name: t("pv.folderExams"), icon: "📁", noteIds: ["n2", "n4", "n5"] },
  ];
}

export const SOURCE_LABEL_KEYS: Record<SourceKind, MessageKey> = {
  audio: "source.audio",
  pdf: "source.pdf",
  text: "source.text",
  link: "source.link",
};

/**
 * "Audio, 47 min", "PDF, 24 pages", "Link": the source and what the app measured
 * of it, as `sourceMeta` in home-dashboard.tsx and `getLectureSourceDetail` print it.
 */
export function sourceMeta(note: Pick<PreviewNote, "source" | "detail">, t: Translate<MessageKey>): string {
  const label = t(SOURCE_LABEL_KEYS[note.source]);
  const detail = note.detail;
  if (!detail) return label;
  if ("pages" in detail) return `${label}, ${t("source.pages", { count: detail.pages })}`;
  const hours = Math.floor(detail.minutes / 60);
  const minutes = detail.minutes % 60;
  const time = !hours
    ? t("source.duration.minutes", { minutes: detail.minutes })
    : minutes
      ? t("source.duration.hoursMinutes", { hours, minutes })
      : t("source.duration.hours", { hours });
  return `${label}, ${time}`;
}

/* The study material, in the shapes the landing's app screens take. */
export function themeFlashcards(theme: NoteThemeKey, t: Translate<MessageKey>) {
  return THEME_STUDY_KEYS[theme].cards.map((card, index) => ({
    id: `${theme}-card-${index + 1}`,
    front: t(card.frontKey),
    back: t(card.backKey),
  }));
}

export function themeQuiz(theme: NoteThemeKey, t: Translate<MessageKey>) {
  return THEME_STUDY_KEYS[theme].quiz.map((question, index) => ({
    id: `${theme}-quiz-${index + 1}`,
    prompt: t(question.questionKey),
    options: question.optionKeys.map((key) => t(key)),
    correct_option_idx: question.correct,
  }));
}

/** The reader's-language view of a theme's study material. */
export function resolveThemeStudy(theme: NoteThemeKey, t: Translate<MessageKey>): ThemeStudy {
  const keys = THEME_STUDY_KEYS[theme];

  return {
    cards: keys.cards.map((card) => ({ front: t(card.frontKey), back: t(card.backKey) })),
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
