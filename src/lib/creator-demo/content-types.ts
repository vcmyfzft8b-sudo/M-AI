/**
 * The shape of the `/creator` demo's authored study material, one copy per
 * language in `./locales`. See `./content.ts` for how a language is chosen.
 */

export type DemoDifficulty = "easy" | "medium" | "hard";

export type DemoFlashcard = {
  front: string;
  back: string;
  hint?: string;
  difficulty: DemoDifficulty;
  sectionIdx: number;
};

export type DemoQuizQuestion = {
  prompt: string;
  options: [string, string, string, string];
  correctOptionIdx: number;
  explanation: string;
  difficulty: DemoDifficulty;
};

export type DemoPracticeQuestion = {
  prompt: string;
  answerGuide: string;
  difficulty: DemoDifficulty;
  expectedAnswer: string;
  strengths: string;
  missingPoints: string;
};

export type DemoTranscriptSegment = {
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  text: string;
};

export type DemoSection = {
  title: string;
  sourceLabel: string;
};

/**
 * A figure inside the note. `afterText` is a distinctive fragment of the block
 * the image sits under — resolved to a real block id at build time, so edits to
 * the markdown can't silently detach an image.
 */
export type DemoNoteImage = {
  /**
   * Path under `public/creator-demo/`. Slovenian figures sit at the root; a
   * translated figure sits in its language's folder (`en/elasticnost.svg`).
   */
  file: string;
  fileName: string;
  alt: string;
  afterText: string;
  widthPercent?: number;
};

export type DemoNotePack = {
  key: string;
  title: string;
  sourceType: "audio" | "pdf" | "text" | "link" | "presentation";
  durationSeconds: number | null;
  /** Documents print a page count on the note row, the way the design does. */
  pageCount?: number;
  summary: string;
  keyTopics: string[];
  notesMd: string;
  images: DemoNoteImage[];
  sections: DemoSection[];
  flashcards: DemoFlashcard[];
  quiz: DemoQuizQuestion[];
  practice: DemoPracticeQuestion[];
  transcript: DemoTranscriptSegment[];
  chatAnswers: string[];
};

export type DemoLiveHighlightColor = "green" | "purple";

/**
 * Everything the demo shows that is written in a language: a translation is a
 * whole one of these, so nothing can be left in Slovenian by omission.
 *
 * A translation keeps the structure of the Slovenian source exactly — the same
 * packs with the same keys in the same order, the same number of sections,
 * cards, questions and chat answers, the same `sectionIdx` values — because ids,
 * folders and study progress are keyed by position. `tests/creator-demo-locales.test.mjs`
 * holds every language to that.
 */
export type DemoLocaleContent = {
  packs: DemoNotePack[];
  /** Seeded folder names, by the folder ids in `DEMO_SEED_FOLDERS`. */
  folderNames: Record<string, string>;
  /**
   * The figures the `/creator/college` live write-up drops in, in note order.
   * `anchor` must occur in the record pack's markdown, and the figure lands at
   * the end of that paragraph.
   */
  liveFigures: Array<{ file: string; fileName: string; alt: string; anchor: string }>;
  /** Phrases the live write-up highlights; each must occur exactly once in the record pack. */
  liveHighlights: Array<{ phrase: string; color: DemoLiveHighlightColor }>;
  /** The demo podcast episode's script. */
  podcastTurns: Array<{ speaker: "a" | "b"; text: string }>;
};
