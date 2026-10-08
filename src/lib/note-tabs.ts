import type { MessageKey } from "@/lib/i18n/messages/keys";

/*
 * The note screen's pill row, in one place for everywhere that draws it: the app's
 * note screen (lecture-workspace.tsx) and the landing page's demos of it (the hero
 * phone, "How it works" and the feature list). Adding, removing, reordering or
 * restyling a tab here changes all of them at once — see docs/landing-page-sync.md.
 */

/** The study materials a pill opens inside the note's study view. */
export type NoteTabStudyView = "flashcards" | "quiz" | "practice_test";

/**
 * The redesign's pill row. Study is three peers rather than one tab with an
 * inner switch, and chat has left the row entirely — it is the side panel on
 * desktop and the bar at the foot of the note on the phone.
 *
 * Each pill carries its own tint, which the active state mixes into its
 * background and border.
 */
export const NOTE_TABS = [
  { id: "notes", view: null, labelKey: "note.tab.notes", icon: "description", tint: "#f45f5a" },
  /*
   * The spoken walkthrough, second because it is the other way to take in the note
   * itself rather than a fourth kind of study material — you read it, or you have it
   * explained. The three practice screens follow.
   */
  {
    id: "tutor",
    view: null,
    labelKey: "note.tab.tutor",
    icon: "graphic_eq",
    tint: "oklch(0.66 0.15 50)",
  },
  {
    id: "flashcards",
    view: "flashcards",
    labelKey: "note.tab.flashcards",
    icon: "style",
    tint: "oklch(0.66 0.15 295)",
  },
  /*
   * The episode, after the cards: it is the third way of taking in the note itself — read it, have it
   * explained, or listen to it argued — and it belongs beside the walkthrough rather than among
   * the practice screens, which are about testing yourself rather than about taking it in.
   */
  {
    id: "podcast",
    view: null,
    labelKey: "note.tab.podcast",
    icon: "podcasts",
    tint: "oklch(0.66 0.15 20)",
  },
  { id: "quiz", view: "quiz", labelKey: "note.tab.quiz", icon: "quiz", tint: "oklch(0.66 0.15 340)" },
  /*
   * Last of the revision pills and immediately before the test, because that is the order the
   * work is done in: cards, then questions, then the map you check the whole shape against —
   * and then you sit the test.
   */
  {
    id: "mindmap",
    view: null,
    labelKey: "note.tab.mindmap",
    icon: "account_tree",
    tint: "oklch(0.66 0.15 200)",
  },
  /*
   * The same material again, walked through rather than read: it sits with the
   * revision pills, after the map you check the shape against and before the
   * test you sit at the end.
   */
  {
    id: "palace",
    view: null,
    labelKey: "note.tab.palace",
    icon: "explore",
    tint: "oklch(0.66 0.15 100)",
  },
  {
    id: "test",
    view: "practice_test",
    labelKey: "note.tab.test",
    icon: "assignment",
    tint: "oklch(0.66 0.15 150)",
  },
  /*
   * Where the practice leads: a dated exam, planned day by day from this note
   * (and any others it covers), with how close the learner is to their grade.
   * Right after the test, which is the closest thing to it.
   */
  {
    id: "exam",
    view: null,
    labelKey: "note.tab.exam",
    icon: "event",
    tint: "oklch(0.66 0.15 230)",
  },
  /*
   * Another way through the note itself — one word at a time, held still, for a
   * reader who wants the whole thing at pace rather than explained. It sits at
   * the end of the row rather than beside the walkthrough: the three practice
   * screens are what the row is mostly reached for, and a fourth pill between
   * them and the note pushed them along by one.
   */
  {
    id: "speed",
    view: null,
    labelKey: "note.tab.speed",
    icon: "bolt",
    tint: "oklch(0.66 0.15 275)",
  },
  {
    id: "transcript",
    view: null,
    labelKey: "note.tab.transcript",
    icon: "text_snippet",
    tint: "oklch(0.66 0.15 250)",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  view: NoteTabStudyView | null;
  labelKey: MessageKey;
  icon: string;
  tint: string;
}>;

export type NoteTabId = (typeof NOTE_TABS)[number]["id"];

/** The pills that are ways to study the note, as the landing's "How it works" shows them. */
export const NOTE_STUDY_TABS = NOTE_TABS.filter(
  (tab) => tab.id !== "notes" && tab.id !== "transcript",
);
