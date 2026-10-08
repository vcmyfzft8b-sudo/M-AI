"use client";

/*
 * Memo himself is drawn by `onboarding-mascot.tsx`; the one image left here is
 * the brand lockup in the desktop aside, a small PNG sized by its box.
 */
/* eslint-disable @next/next/no-img-element */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Nunito } from "next/font/google";
import { useRouter } from "next/navigation";

import { mapAppHrefForClient } from "@/lib/creator-demo/paths";

import { useTranslations } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/locales";
import { LandingTutorDemo } from "@/components/landing/landing-tutor-demo";
import {
  MascotFigure,
  MascotPedestal,
  MascotSparkles,
  MascotThought,
  SpeechBubble,
  useMascot,
} from "@/components/onboarding-mascot";
import type { ProfileRow } from "@/lib/database.types";
import {
  STUDY_HOUR_DEFAULT,
  STUDY_HOUR_MAX,
  STUDY_HOUR_MIN,
  studyHourLabel,
  studySky,
  thinkIcons,
} from "@/lib/onboarding-mascot";
import {
  AUDIENCE_OPTIONS,
  CLASS_FOCUS_OPTIONS,
  DAILY_GOAL_OPTIONS,
  ELEMENTARY_SCHOOL_OPTIONS,
  FEATURE_OPTIONS,
  HIGH_SCHOOL_OPTIONS,
  MOTIVATION_OPTIONS,
  ROLE_OPTIONS,
  SCHOOL_OPTIONS,
  SOURCE_OPTIONS,
  SUBJECT_OPTIONS,
  UNIVERSITY_SCHOOL_OPTIONS,
  getOnboardingYearOptions,
  gradeBounds,
  mapEducationLevel,
  usesTenPointGrades,
  type GradeScale,
} from "@/lib/onboarding-options";

/**
 * The interactive onboarding.
 *
 * A port of the design canvas the flow was redrawn in ("Onboarding Redesign
 * v2"), kept deliberately close to it: every measurement, easing curve and
 * animation below is the one the artboard carries, which is why the styling is
 * inline rather than in a stylesheet — a number here can be diffed against the
 * design file line for line. Only what an inline style cannot express lives in
 * `onboarding.css`: the tokens, the keyframes, and the hover/active rules the
 * canvas wrote as `style-hover` / `style-active`.
 *
 * v2 puts Memo on every screen. On the welcome, loading and last screens he is
 * the hero; everywhere else he stands beside a speech bubble that carries the
 * step's question, typed out as he says it, and he reacts to what the learner
 * does — a hop for a pick, a cheer for a right answer, a droop for a miss.
 *
 * What is deliberately NOT the design's own is anything it duplicated from the
 * app: the option lists come from `onboarding-options.ts`, the wording from the
 * message catalogues, and the tutor step mounts the real walkthrough.
 */

const NUNITO = Nunito({ subsets: ["latin", "latin-ext"], display: "swap" });

/** The accent the design ships with: the head of the app's own coral. */
const ACCENT = "#ff6d68";

/** Above this the aside with the running summary appears beside the question. */
const WIDE_QUERY = "(min-width: 980px)";

/** Below this the proof list drops its last two rows and the reviews drop to one. */
const ROOMY_QUERY = "(min-height: 760px)";

const CALM_QUERY = "(prefers-reduced-motion: reduce)";

type OnboardingForm = {
  heardFrom: string;
  audience: string;
  role: string;
  schoolLevel: string;
  schoolYear: string;
  subject: string;
  motivation: string;
  feature: string;
  classFocus: string;
  dailyGoal: string;
  currentAverageGrade: number;
  targetGrade: number;
  studyHour: number;
};

type StepKind =
  | "welcome"
  | "q"
  | "grade"
  | "proof"
  | "source"
  | "flash"
  | "quiz"
  | "test"
  | "tutor"
  | "ask"
  | "time"
  | "testimonial"
  | "chart"
  | "loading"
  | "done";

type Step = {
  id: string;
  kind: StepKind;
  key?: keyof OnboardingForm;
  qk?: CopyKey;
  sk?: CopyKey;
  cols?: string;
  when?: "student" | "uni";
};

/*
 * The two long lists — ten fields of study, twelve tools — are laid out by the
 * design as `repeat(auto-fit, minmax(11rem, 1fr))`. On a phone that floor is
 * wider than half the column, so auto-fit gives up and stacks all twelve in one
 * column. Capping the floor at just under half the container keeps the
 * design's own track width wherever it fits and goes two-up where it does not.
 */
const WRAPPING_COLUMNS = "repeat(auto-fit, minmax(min(11rem, 47%), 1fr))";

/*
 * How much of a tile the icon, the gap and the padding are allowed to take.
 *
 * A one-per-row step has a whole screen width to spend, and the design's
 * numbers are right for it. The two steps that go multi-column do not: on a
 * 390px phone each tile is 174px wide, and the design's 0.95rem padding, 2.5rem
 * icon and 0.8rem gap leave the label 92px — narrower than the single word
 * "Personalizacija". Trimming the chrome gives the label 120px, which is enough
 * for the longest word in any of the five languages to sit on a line of its own.
 */
const OPTION_CHROME = {
  single: { padding: "0.95rem", icon: "clamp(1.55rem, 4.6vh, 2.5rem)", gap: "0.8rem" },
  columns: { padding: "0.6rem", icon: "clamp(1.4rem, 4vh, 1.75rem)", gap: "0.4rem" },
} as const;

/*
 * The smallest a two-column label may be shrunk to so its longest word fits on
 * one line (see `columnLabelPx`). Below this the word breaks instead, which
 * `overflowWrap: "anywhere"` still allows as the last resort.
 */
const COLUMN_LABEL_FLOOR_PX = 12;

/** The two-column label's own size, `clamp(0.86rem, 2.1vh, 0.98rem)`, in px. */
function columnLabelBasePx() {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  return Math.min(0.98 * rem, Math.max(0.86 * rem, 0.021 * window.innerHeight));
}

const STEPS: readonly Step[] = [
  { id: "welcome", kind: "welcome" },
  { id: "heardFrom", kind: "q", key: "heardFrom", qk: "qHeard", sk: "subHeard", cols: "1fr" },
  { id: "audience", kind: "q", key: "audience", qk: "qAudience", sk: "subAudience", cols: "1fr" },
  { id: "role", kind: "q", key: "role", qk: "qRole", sk: "subRole", cols: "1fr" },
  { id: "schoolLevel", kind: "q", key: "schoolLevel", qk: "qSchool", sk: "subSchool", cols: "1fr", when: "student" },
  { id: "schoolYear", kind: "q", key: "schoolYear", qk: "qYear", cols: "repeat(auto-fit, minmax(9rem, 1fr))", when: "student" },
  { id: "subject", kind: "q", key: "subject", qk: "qSubject", sk: "subSubject", cols: WRAPPING_COLUMNS, when: "uni" },
  { id: "motivation", kind: "q", key: "motivation", qk: "qMotivation", cols: "1fr" },
  { id: "proof", kind: "proof" },
  { id: "currentAverageGrade", kind: "grade", key: "currentAverageGrade", qk: "qGradeNow", sk: "qGradeNowSub", when: "student" },
  { id: "targetGrade", kind: "grade", key: "targetGrade", qk: "qGradeTarget", sk: "subTarget", when: "student" },
  { id: "feature", kind: "q", key: "feature", qk: "qFeature", sk: "subFeature", cols: WRAPPING_COLUMNS },
  { id: "trySource", kind: "source", qk: "srcTitle", sk: "srcSub" },
  { id: "tryFlashcard", kind: "flash", qk: "flashTitle", sk: "flashSub" },
  { id: "tryQuiz", kind: "quiz", qk: "quizTitle", sk: "quizSub" },
  { id: "tryTest", kind: "test", qk: "testTitle", sk: "testSub" },
  { id: "tryTutor", kind: "tutor", qk: "tutorTitle", sk: "tutorSub" },
  { id: "askAnything", kind: "ask", qk: "askTitle" },
  { id: "classFocus", kind: "q", key: "classFocus", qk: "qFocus", sk: "subFocus", cols: "1fr" },
  { id: "dailyGoal", kind: "q", key: "dailyGoal", qk: "qGoal", sk: "subGoal", cols: "1fr" },
  { id: "studyTime", kind: "time", qk: "timeTitle", sk: "timeSub" },
  { id: "testimonial", kind: "testimonial" },
  { id: "progress", kind: "chart", when: "student" },
  { id: "personalizing", kind: "loading" },
  { id: "done", kind: "done" },
];

/** The three screens where Memo is the whole picture rather than a companion. */
function isHeroKind(kind: StepKind) {
  return kind === "welcome" || kind === "loading" || kind === "done";
}

/**
 * The three answers the redesign asks for with a brand mark rather than an
 * emoji, drawn exactly as the design file draws them.
 */
const BRAND_MARKS: Record<string, { vb: string; d: string; fill: string; stroke: string }> = {
  instagram: {
    vb: "0 0 24 24",
    d: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z M17.5 6.51h.01",
    fill: "none",
    stroke: "currentColor",
  },
  tiktok: {
    vb: "0 0 24 24",
    d: "M14.8 3.2c.2 1.4.8 2.6 1.8 3.5 1 .9 2.2 1.4 3.6 1.5v3.2c-2.1 0-3.9-.7-5.4-2v6.1c0 3.2-2.3 5.4-5.5 5.4-1.7 0-3.1-.5-4.1-1.5-1.1-1-1.6-2.2-1.6-3.8 0-1.5.5-2.7 1.6-3.7 1-1 2.4-1.5 4-1.5.4 0 .8 0 1.2.1v3.4c-.4-.2-.8-.3-1.3-.3-1.2 0-2 .8-2 1.9s.8 1.9 2.1 1.9c1.4 0 2.2-.8 2.2-2.3V3.2h3.4Z",
    fill: "currentColor",
    stroke: "none",
  },
  chatgpt: {
    vb: "0 0 20 20",
    d: "M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z",
    fill: "currentColor",
    stroke: "none",
  },
};

/** The three cards the flashcard step deals, and the deck it starts from. */
const CARDS = [
  { q: "flashQ1", a: "flashA1" },
  { q: "flashQ2", a: "flashA2" },
  { q: "flashQ3", a: "flashA3" },
] as const satisfies readonly { q: CopyKey; a: CopyKey }[];

const START_QUEUE = [0, 1, 2];

/** The four things the source step offers to turn into a note. */
const DEMO_FILES = [
  { v: "audio", name: "lecture-04.m4a", ext: "M4A", meta: "srcFileAudio", i: "🎙️", tint: "rgba(255,109,104,0.16)" },
  { v: "pdf", name: "mitosis-slides.pdf", ext: "PDF", meta: "srcFilePdf", i: "📄", tint: "rgba(98,170,255,0.18)" },
  { v: "photo", name: "notebook-page.jpg", ext: "JPG", meta: "srcFilePhoto", i: "📷", tint: "rgba(255,204,77,0.22)" },
  { v: "link", name: "khan-mitosis", ext: "URL", meta: "srcFileLink", i: "🔗", tint: "rgba(98,214,118,0.2)" },
] as const satisfies readonly { v: string; name: string; ext: string; meta: CopyKey; i: string; tint: string }[];

/** What a source turns into, each ticking off as the bar passes its mark. */
const SOURCE_OUTPUTS = [
  { icon: "📝", label: "rowNotes", at: 30 },
  { icon: "🃏", label: "rowQuizCards", at: 55 },
  { icon: "✅", label: "rowTests", at: 80 },
  { icon: "📻", label: "rowPodcast", at: 100 },
] as const satisfies readonly { icon: string; label: CopyKey; at: number }[];

const QUIZ_OPTIONS = [
  { v: "prophase", l: "quizOptA" },
  { v: "metaphase", l: "quizOptB" },
  { v: "anaphase", l: "quizOptC" },
  { v: "telophase", l: "quizOptD" },
] as const satisfies readonly { v: string; l: CopyKey }[];

/** The "most opened this week" list on the proof step; the last two only on a tall screen. */
const PROOF_ROWS = [
  { icon: "🃏", label: "rowQuizCards", pct: 91, opacity: 1 },
  { icon: "✅", label: "rowTests", pct: 83, opacity: 0.9 },
  { icon: "🎙️", label: "rowTutor", pct: 74, opacity: 0.8 },
  { icon: "📻", label: "rowPodcast", pct: 66, opacity: 0.7 },
  { icon: "🏛️", label: "rowPalace", pct: 58, opacity: 0.6 },
  { icon: "📝", label: "rowNotes", pct: 42, opacity: 0.5 },
  { icon: "⚡", label: "rowSpeed", pct: 29, opacity: 0.42 },
] as const satisfies readonly { icon: string; label: CopyKey; pct: number; opacity: number }[];

/** The example questions on the "ask me anything" step, each in its own colour. */
const ASK_QUESTIONS = ["askQ1", "askQ2", "askQ3", "askQ4", "askQ5", "askQ6"] as const satisfies readonly CopyKey[];
const ASK_HUES = ["#9b7bff", "#d9a93a", "#6f8fb3", "#e0705f", "#5fae6f", "#e09a4f"];

const REVIEWS = {
  student: [
    { name: "Ana K.", age: 21, q: "reviewQuote1", meta: "reviewMeta1", role: "university_student" },
    { name: "Luka M.", age: 17, q: "reviewQuote2", meta: "reviewMeta2", role: "high_school_student" },
    { name: "Nika P.", age: 12, q: "reviewQuote3", meta: "reviewMeta3", role: "elementary_student" },
  ],
  other: [
    { name: "Marko Z.", age: 34, q: "reviewQuote4", meta: "reviewMeta4", role: "working_professional" },
    { name: "Sara B.", age: 41, q: "reviewQuote5", meta: "reviewMeta5", role: "parent" },
    { name: "Peter H.", age: 38, q: "reviewQuote6", meta: "reviewMeta6", role: "teacher" },
  ],
} as const;

/** The four fields whose reviewer adds a line about their own subject. */
const SUBJECT_LINES: Record<string, MessageKey> = {
  computer_science: "onboarding.subjectLine.computerScience",
  health_medicine: "onboarding.subjectLine.healthMedicine",
  maths: "onboarding.subjectLine.maths",
  law_criminal_justice: "onboarding.subjectLine.law",
};

/** Twelve stars over the night sky, and twelve rays round the sun. */
const SKY_STARS = [
  [10, 16, 4], [22, 30, 3], [34, 12, 3], [48, 26, 4], [62, 14, 3], [74, 32, 3],
  [86, 18, 4], [16, 50, 3], [56, 44, 3], [92, 46, 4], [40, 58, 3], [70, 60, 3],
] as const;
const SUN_RAYS = Array.from({ length: 12 }, (_, k) => k * 30);
const SKY_CLOUDS = [
  { left: "16%", top: "28%", width: "16%", drift: "24s", delay: "-5s", scale: 1 },
  { left: "64%", top: "58%", width: "20%", drift: "32s", delay: "-19s", scale: 0.85 },
  { left: "32%", top: "78%", width: "12%", drift: "28s", delay: "-12s", scale: 0.7 },
] as const;

function isStudentRole(role: string) {
  return (
    role === "elementary_student" ||
    role === "high_school_student" ||
    role === "university_student"
  );
}

function getSchoolOptionsForRole(role: string) {
  if (role === "elementary_student") {
    return ELEMENTARY_SCHOOL_OPTIONS;
  }

  if (role === "high_school_student") {
    return HIGH_SCHOOL_OPTIONS;
  }

  if (role === "university_student") {
    return UNIVERSITY_SCHOOL_OPTIONS;
  }

  return SCHOOL_OPTIONS;
}

/**
 * The survey is global in English and local in the four home markets, so the
 * decimal separator follows the selected locale rather than being hardcoded.
 */
function formatGrade(value: number, locale: Locale) {
  return new Intl.NumberFormat(LOCALE_INTL_TAG[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function findLabel(
  options: readonly { value: string; labelKey: MessageKey }[],
  value: string,
  t: Translate<MessageKey>,
) {
  const option = options.find((candidate) => candidate.value === value);

  return option ? t(option.labelKey) : value;
}

/** The accent, as `rgba()` — the selection tint and every glow are mixed from it. */
function accentRgba(alpha: number) {
  const hex = ACCENT.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);

  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Every string the flow says, by the short name the design file gave it.
 * They live on `onboarding.<name>` in the catalogues; keeping the short name
 * here is what lets the markup below stay line-for-line with the design.
 */
const COPY_KEYS = [
  "welcomeTitle", "welcomeSub", "ctaStart", "ctaDone", "footDone", "footLoading",
  "subHeard", "subAudience", "subRole", "subSchool", "subSubject", "subFeature",
  "subFocus", "subGoal", "subTarget", "proofSub", "proofHeader", "proofLive",
  "proofRating", "rowQuizCards", "rowTests", "rowTutor", "rowPodcast",
  "rowPalace", "rowNotes", "rowSpeed", "srcTitle", "srcSub",
  "srcStage1", "srcStage2", "srcStage3", "srcStage4", "srcNoteTitle",
  "flashTitle", "flashSub", "flashHintBack",
  "quizTitle", "quizSub", "quizMeta", "quizQ", "quizRight", "quizWrong", "quizExplain",
  "testTitle", "testSub", "testMeta", "testQ", "testPlaceholder", "testGrade", "testMarked", "testFeedback",
  "tutorTitle", "tutorSub",
  "chartKicker", "chartIn12", "chartNow", "chart6", "chart12",
  "reviewStudents", "reviewOthers", "loadTitle", "loadReady",
  "loadRow1", "loadRow2", "loadRow3", "doneTitle", "doneSub", "qHeard",
  "qAudience", "qRole", "qSchool", "qYear", "qSubject",
  "qMotivation", "qFeature", "qFocus", "qGoal", "qGradeNow", "qGradeNowSub",
  "qGradeTarget", "proofTitle", "chartTitle", "chartWith", "chartAlone",
  "ctaContinue", "asideTitle", "asideFoot", "dropIdle", "dropOver", "srcTapHint",
  "reviewQuote1", "reviewQuote2", "reviewQuote3", "reviewMeta1", "reviewMeta2", "reviewMeta3",
  "reviewQuote4", "reviewQuote5", "reviewQuote6", "reviewMeta4", "reviewMeta5", "reviewMeta6",
  "loadWorking", "sumYouAre", "sumYear", "sumField",
  "sumGoal", "sumFirst", "sumDaily", "flashQ1", "flashA1", "flashQ2",
  "flashA2", "flashQ3", "flashA3", "srcFileAudio", "srcFilePdf", "srcFilePhoto",
  "srcFileLink", "quizOptA", "quizOptB", "quizOptC", "quizOptD", "chartAria",
  "askTitle", "askQ1", "askQ2", "askQ3", "askQ4", "askQ5", "askQ6", "timeTitle", "timeSub",
] as const;

type CopyKey = (typeof COPY_KEYS)[number];
type Copy = Record<CopyKey, string>;

type FlowState = {
  stepId: string;
  fade: number;
  shift: number;
  wide: boolean;
  roomy: boolean;
  calm: boolean;
  pct: number;
  flipped: boolean;
  quizPick: string;
  source: string;
  srcPct: number;
  fileDrag: { v: string; x: number; y: number } | null;
  over: boolean;
  cardPos: number;
  dragX: number;
  dragging: boolean;
  exitDir: number;
  exitQ: string;
  exitDx: number;
  exitToken: number;
  queue: number[];
  answers: Record<number, "easy" | "again">;
  testText: string;
  testGraded: boolean;
  gradeScale: number;
  /** How many characters of Memo's line are typed out. */
  tw: number;
  /** Which icon his thought cloud is showing. */
  thinkTick: number;
  form: OnboardingForm;
};

const INITIAL_STATE: FlowState = {
  stepId: "welcome",
  fade: 1,
  shift: 0,
  wide: false,
  roomy: true,
  calm: false,
  pct: 0,
  flipped: false,
  quizPick: "",
  source: "",
  srcPct: 0,
  fileDrag: null,
  over: false,
  cardPos: 0,
  dragX: 0,
  dragging: false,
  exitDir: 0,
  exitQ: "",
  exitDx: 0,
  exitToken: 0,
  queue: START_QUEUE,
  answers: {},
  testText: "",
  testGraded: false,
  gradeScale: 1,
  tw: 0,
  thinkTick: 0,
  form: {
    heardFrom: "",
    audience: "",
    role: "",
    schoolLevel: "",
    schoolYear: "",
    subject: "",
    motivation: "",
    feature: "",
    classFocus: "",
    dailyGoal: "",
    currentAverageGrade: 3.5,
    targetGrade: 4.5,
    studyHour: STUDY_HOUR_DEFAULT,
  },
};

/** The subtitle under Memo's bubble, centred on every step that has one. */
const SUBTITLE: CSSProperties = { margin: "0 0 clamp(0.6rem, 1.8vh, 1.15rem)", textAlign: "center", fontSize: "clamp(0.9rem, 2vh, 1rem)", fontWeight: "700", lineHeight: "1.45", color: "var(--muted)" };

/** The 3D chip: a 2px ring and a lip of the same colour under it. */
const CHIP: CSSProperties = { boxSizing: "border-box", border: "2px solid var(--chip-ring)", background: "var(--chip)" };

export function OnboardingFlow({
  profile,
  demo = false,
  anonymous = false,
  backHref,
}: {
  profile?: ProfileRow | null;
  /** The `/creator` copy: the same screens, with nothing written and nowhere to go. */
  demo?: boolean;
  /**
   * The survey is being answered before there is an account.
   *
   * Identical screens — that is the point, and why this is a flag rather than
   * a second component: the answers go to the open endpoint instead of the
   * profile, and the last button opens sign-in instead of the upgrade screen.
   */
  anonymous?: boolean;
  /**
   * Where the back arrow goes from the very first step.
   *
   * Only the landing page, and only on the web: someone who pressed "Try it
   * for €0" to get here has to be able to change their mind. Decided by the
   * server rather than sniffed here, because the app has no landing page to
   * return to — the wrapper rewrites `/` back to this very screen, so an arrow
   * pointing there would be a loop.
   */
  backHref?: string;
}) {
  const { locale, t } = useTranslations();
  const router = useRouter();

  const [state, setState] = useState<FlowState>(() => ({
    ...INITIAL_STATE,
    form: {
      ...INITIAL_STATE.form,
      currentAverageGrade:
        Number.parseFloat(profile?.current_average_grade?.replace(",", ".") ?? "") || 3.5,
      targetGrade: Number.parseFloat(profile?.target_grade?.replace(",", ".") ?? "") || 4.5,
    },
  }));
  /**
   * The last button has been pressed and the next screen is on its way.
   *
   * Navigation here is a route change plus a refresh, which on a cold cache is
   * long enough for a second press to land — and long enough for the button to
   * look broken if it says nothing. It is never unset: the only way out of
   * this screen is away from it.
   */
  const [finishing, setFinishing] = useState(false);
  const [gradeTouched, setGradeTouched] = useState({
    currentAverageGrade: false,
    targetGrade: false,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  /*
   * The two-column steps' label size when the default is too big for a word.
   *
   * On a 360px phone a two-up tile leaves its label about 100px, and v2's
   * heavier type puts some single words past that — Croatian "Personalizacija"
   * broke as "Personalizacij / a". Hyphenation is not there in every language
   * on every browser, so the labels are measured instead: every label on the
   * step shrinks together, just enough for its longest word to fit, and only
   * when one does not.
   */
  const [columnLabelPx, setColumnLabelPx] = useState<number | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const timers = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const intervals = useRef<Record<string, ReturnType<typeof setInterval> | undefined>>({});
  const raf = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dropEl = useRef<HTMLDivElement | null>(null);
  const mainEl = useRef<HTMLElement | null>(null);
  const fitEl = useRef<HTMLDivElement | null>(null);
  const optionGridEl = useRef<HTMLDivElement | null>(null);
  const gazeEl = useRef<HTMLDivElement | null>(null);
  const heroTiltEl = useRef<HTMLDivElement | null>(null);
  const bubbleEl = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ width: 353, from: 0, moved: false, lastDx: 0 });
  const fileDrag = useRef({ startX: 0, startY: 0, moved: false });
  const saving = useRef(false);
  const saved = useRef(false);
  /** Which way the last step change went, for Memo's hop or boing. */
  const direction = useRef(1);
  /** Whether the small Memo has already dropped in beside the bubble. */
  const riderShown = useRef(false);
  const tilt = useRef({ target: [0, 0], current: [0, 0], frame: 0 });
  const gazeFrame = useRef(0);
  const lastPointer = useRef<[number, number] | null>(null);
  const hourMoved = useRef(0);

  const scope = useCallback(() => rootRef.current, []);
  const mascot = useMascot({ accent: ACCENT, calm: state.calm, scope });
  const { move, burst, blink, stopGroove } = mascot;

  const patch = useCallback((next: Partial<FlowState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const clearTimer = (name: string) => {
    if (timers.current[name] !== undefined) {
      clearTimeout(timers.current[name]);
      timers.current[name] = undefined;
    }
  };

  const clearLoop = (name: string) => {
    if (intervals.current[name] !== undefined) {
      clearInterval(intervals.current[name]);
      intervals.current[name] = undefined;
    }
  };

  const c = useMemo(() => {
    const out = {} as Copy;
    for (const key of COPY_KEYS) {
      out[key] = t(`onboarding.${key}` as MessageKey);
    }

    return out;
  }, [t]);

  const form = state.form;
  const student = isStudentRole(form.role);

  /**
   * The steps this answer set actually walks through. Recomputed rather than
   * stored, so changing a role part-way back through the flow re-cuts the path
   * under the current step instead of leaving a step that no longer applies.
   */
  const path = useMemo(() => {
    const isStudent = isStudentRole(form.role);
    const uni = form.role === "university_student";

    return STEPS.filter((s) =>
      s.when === "student" ? isStudent : s.when === "uni" ? uni : true,
    );
  }, [form.role]);

  const index = Math.max(0, path.findIndex((s) => s.id === state.stepId));
  const step = path[index] ?? path[0];
  const kind = step.kind;
  const hero = isHeroKind(kind);

  /*
   * The bar is read against the whole flow, not against the path the current
   * answers cut out of it, so it only ever moves forward and always ends full.
   * A branch that skips steps shows up as a longer jump.
   */
  const shownIndex = Math.max(0, STEPS.findIndex((s) => s.id === state.stepId));

  const optionsFor = useCallback(
    (target: Step) => {
      if (target.key === "schoolLevel") {
        return getSchoolOptionsForRole(form.role);
      }

      if (target.key === "schoolYear") {
        return getOnboardingYearOptions(locale, form.role, form.schoolLevel);
      }

      switch (target.key) {
        case "heardFrom":
          return SOURCE_OPTIONS;
        case "audience":
          return AUDIENCE_OPTIONS;
        case "role":
          return ROLE_OPTIONS;
        case "subject":
          return SUBJECT_OPTIONS;
        case "motivation":
          return MOTIVATION_OPTIONS;
        case "feature":
          return FEATURE_OPTIONS;
        case "classFocus":
          return CLASS_FOCUS_OPTIONS;
        case "dailyGoal":
          return DAILY_GOAL_OPTIONS;
        default:
          return [];
      }
    },
    [form.role, form.schoolLevel, locale],
  );

  /** What gets written to the profile, once, when the loader starts. */
  const submit = useCallback(async () => {
    if (demo || saving.current || saved.current) {
      return;
    }

    saving.current = true;
    setSaveError(null);

    const current = stateRef.current.form;
    const answered = (key: keyof OnboardingForm) =>
      (current[key] as string) ? (current[key] as string) : null;
    const gradeScale: GradeScale = usesTenPointGrades(current.schoolLevel) ? 10 : 5;
    const subjectLabel = isStudentRole(current.role)
      ? findLabel(SUBJECT_OPTIONS, current.subject, t).toLowerCase()
      : findLabel(ROLE_OPTIONS, current.role, t).toLowerCase();

    try {
      const response = await fetch(anonymous ? "/api/onboarding/anonymous" : "/api/profile/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          educationLevel: mapEducationLevel(current.schoolLevel),
          currentAverageGrade: formatGrade(current.currentAverageGrade, locale),
          targetGrade: formatGrade(current.targetGrade, locale),
          studyGoal: [
            `${findLabel(MOTIVATION_OPTIONS, current.motivation || "improve_marks", t)}.`,
            `${findLabel(FEATURE_OPTIONS, current.feature || "quizzes", t)}.`,
            `${subjectLabel}.`,
            `${findLabel(CLASS_FOCUS_OPTIONS, current.classFocus || "general_help", t)}.`,
            `${findLabel(DAILY_GOAL_OPTIONS, current.dailyGoal || "regular", t)}.`,
          ]
            .join(" ")
            .slice(0, 240),
          // A step the path skipped, or one still ahead, stays null rather than
          // reporting the value the form was seeded with.
          answers: {
            heardFrom: answered("heardFrom"),
            audience: answered("audience"),
            role: answered("role"),
            schoolLevel: answered("schoolLevel"),
            schoolYear: answered("schoolYear"),
            subject: answered("subject"),
            motivation: answered("motivation"),
            feature: answered("feature"),
            classFocus: answered("classFocus"),
            dailyGoal: answered("dailyGoal"),
            currentAverageGrade: gradeTouched.currentAverageGrade
              ? current.currentAverageGrade
              : null,
            targetGrade: gradeTouched.targetGrade ? current.targetGrade : null,
            gradeScale:
              gradeTouched.currentAverageGrade || gradeTouched.targetGrade ? gradeScale : null,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(t("onboarding.error.saveFailed"));
      }

      saved.current = true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("onboarding.error.saveFailed"));
    } finally {
      saving.current = false;
    }
  }, [anonymous, demo, gradeTouched, locale, t]);

  /*
   * The last screen is reached when two things have both happened: the ring has
   * filled and sat for the design's 900ms beat, and the answers are on the
   * server. Either can finish first, so whichever finishes last is the one
   * that moves the flow on.
   */
  const loaderSettled = useRef(false);

  const finishLoading = useCallback(() => {
    if (!loaderSettled.current || !(saved.current || demo)) {
      return;
    }

    if (stateRef.current.stepId === "personalizing") {
      goRef.current(1);
    }
  }, [demo]);

  const finishLoadingRef = useRef(finishLoading);
  finishLoadingRef.current = finishLoading;

  const runLoader = useCallback(() => {
    clearLoop("load");
    loaderSettled.current = false;
    patch({ pct: 0 });
    void submit().then(() => finishLoadingRef.current());

    intervals.current.load = setInterval(() => {
      const next = Math.min(100, stateRef.current.pct + Math.round(3 + Math.random() * 7));
      patch({ pct: next });

      if (next >= 100) {
        clearLoop("load");
        clearTimer("loadDone");
        move("loader", "cheer");
        burst("loader", "sparkle");
        timers.current.loadDone = setTimeout(() => {
          loaderSettled.current = true;
          finishLoadingRef.current();
        }, 900);
      }
    }, 190);
  }, [burst, move, patch, submit]);

  /** `go` is called from timers and from the keyboard, so it lives on a ref too. */
  const goRef = useRef<(delta: number) => void>(() => {});

  const go = useCallback(
    (delta: number) => {
      const current = stateRef.current;
      const list = STEPS.filter((s) =>
        s.when === "student"
          ? isStudentRole(current.form.role)
          : s.when === "uni"
            ? current.form.role === "university_student"
            : true,
      );
      const from = Math.max(0, list.findIndex((s) => s.id === current.stepId));
      let target = Math.min(list.length - 1, Math.max(0, from + delta));

      // Going back never lands on the loader: it would re-run and re-save.
      if (delta < 0) {
        while (target > 0 && list[target].kind === "loading") {
          target -= 1;
        }
      }

      if (target === from) {
        return;
      }

      const to = list[target];
      direction.current = delta;
      clearTimer("go");
      clearTimer("reveal");
      clearTimer("srcDone");
      clearTimer("deckNext");
      clearLoop("load");
      clearTimer("loadDone");
      patch({ fade: 0, shift: delta > 0 ? 20 : -20 });

      timers.current.go = setTimeout(() => {
        setState((s) => ({ ...s, stepId: to.id, fade: 0, shift: delta > 0 ? -20 : 20 }));
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() =>
          requestAnimationFrame(() => patch({ fade: 1, shift: 0 })),
        );
        // A tab that never paints skips the frames above; this brings the new
        // step in anyway rather than leaving it faded out.
        clearTimer("reveal");
        timers.current.reveal = setTimeout(() => patch({ fade: 1, shift: 0 }), 60);

        if (to.kind === "loading") {
          runLoader();
        }
      }, 190);
    },
    [patch, runLoader],
  );

  goRef.current = go;

  /*
   * A pick, then Continue. v2 no longer jumps ahead the moment an option is
   * tapped: Memo answers the tap himself — a hop, eyes squeezed happy, a few
   * stars — and the learner moves on when they are ready.
   */
  const select = useCallback(
    (key: keyof OnboardingForm, value: string) => {
      setState((current) => {
        const next = { ...current.form, [key]: value };

        if (key === "schoolLevel") {
          const bounds = gradeBounds(value);
          next.currentAverageGrade = bounds.current;
          next.targetGrade = bounds.target;
        }

        // A different role means a different school and year list, so the two
        // answers under it are dropped rather than left pointing at options
        // the new role never shows.
        if (key === "role") {
          next.schoolLevel = "";
          next.schoolYear = "";
        }

        return { ...current, form: next };
      });

      if (key === "role" || key === "schoolLevel") {
        setGradeTouched({ currentAverageGrade: false, targetGrade: false });
      }

      move("rider", "hop");
      blink("happy");
      burst("rider", "sparkle");
    },
    [blink, burst, move],
  );

  const nudge = useCallback(
    (key: "currentAverageGrade" | "targetGrade", step: number) => {
      setGradeTouched((current) => ({ ...current, [key]: true }));
      setState((current) => {
        const { min, max, step: size } = gradeBounds(current.form.schoolLevel);
        const raw = current.form[key] + step * size;
        const value = Math.round(Math.min(max, Math.max(min, raw)) * 10) / 10;

        return { ...current, form: { ...current.form, [key]: value }, gradeScale: 1.14 };
      });
      clearTimer("grade");
      timers.current.grade = setTimeout(() => patch({ gradeScale: 1 }), 170);
      move("rider", "boing");
    },
    [move, patch],
  );

  const pickSource = useCallback(
    (v: string) => {
      if (stateRef.current.source) {
        return;
      }

      patch({ source: v, srcPct: 0 });
      move("rider", "munch", 9);
      clearLoop("src");
      intervals.current.src = setInterval(() => {
        const next = Math.min(100, stateRef.current.srcPct + Math.round(4 + Math.random() * 9));
        patch({ srcPct: next });

        if (next >= 100) {
          clearLoop("src");
          move("rider", "cheer");
          burst("rider", "sparkle");
          clearTimer("srcDone");
          timers.current.srcDone = setTimeout(() => {
            if (stateRef.current.stepId === "trySource" && stateRef.current.source) {
              goRef.current(1);
            }
          }, 700);
        }
      }, 130);
    },
    [burst, move, patch],
  );

  /**
   * The card throw, with the app's own numbers: 120px of travel is a full
   * verdict, the tilt tops out at 8 degrees, and the release threshold scales
   * with the card between 88 and 150px so it feels the same at any size.
   *
   * v2 has no results screen: the last card goes straight on to the next step.
   */
  const swipeCard = useCallback((answer: "easy" | "again") => {
    const current = stateRef.current;

    if (current.exitDir) {
      return;
    }

    if (Math.abs(drag.current.lastDx) < 5) {
      drag.current.lastDx = drag.current.width * 0.34 * (answer === "easy" ? 1 : -1);
    }

    const pos = current.cardPos;
    const queue = current.queue;
    const last = pos + 1 >= queue.length;
    const card = CARDS[queue[Math.min(pos, queue.length - 1)]];
    const hadMiss = Object.values(current.answers).includes("again");

    // The answer is recorded and the deck advances in the same commit that
    // starts the exit, so the card under the finger is already the next
    // question while a clone carries the old one off.
    patch({
      answers: { ...current.answers, [pos]: answer },
      dragging: false,
      dragX: 0,
      flipped: false,
      cardPos: last ? pos : pos + 1,
      exitDir: answer === "easy" ? 1 : -1,
      exitQ: card ? card.q : "",
      exitDx: drag.current.lastDx,
      exitToken: current.exitToken + 1,
    });
    drag.current.lastDx = 0;

    clearTimer("exit");
    timers.current.exit = setTimeout(() => patch({ exitDir: 0 }), 185);

    if (last) {
      clearTimer("deckNext");
      timers.current.deckNext = setTimeout(() => {
        if (stateRef.current.stepId === "tryFlashcard") {
          goRef.current(1);
        }
      }, 520);
    }

    if (answer === "easy" && last && !hadMiss) {
      move("rider", "cheer");
      burst("rider", "confetti");
    } else if (answer === "easy") {
      move("rider", "hop");
      burst("rider", "sparkle");
    } else {
      move("rider", "sad");
    }
  }, [burst, move, patch]);

  const cardDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (stateRef.current.exitDir) {
        return;
      }

      drag.current.width = event.currentTarget.getBoundingClientRect().width || 353;
      drag.current.from = event.clientX;
      drag.current.moved = false;

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is a nicety; the window listeners still finish the drag.
      }

      patch({ dragging: true, dragX: 0 });
    },
    [patch],
  );

  const cardMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!stateRef.current.dragging) {
        return;
      }

      const dx = event.clientX - drag.current.from;

      if (Math.abs(dx) > 8) {
        drag.current.moved = true;
      }

      patch({ dragX: dx });
    },
    [patch],
  );

  const cardUp = useCallback(() => {
    const current = stateRef.current;

    if (!current.dragging) {
      return;
    }

    const dx = current.dragX;
    drag.current.lastDx =
      Math.abs(dx) > 4 ? dx : drag.current.width * 0.34 * (dx < 0 ? -1 : 1);
    const trigger = Math.min(150, Math.max(88, drag.current.width * 0.28));

    if (Math.abs(dx) >= trigger) {
      swipeCard(dx > 0 ? "easy" : "again");
      return;
    }

    patch({ dragging: false, dragX: 0 });

    if (!drag.current.moved) {
      patch({ flipped: !current.flipped });
    }
  }, [patch, swipeCard]);

  const fileDown = useCallback(
    (v: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (stateRef.current.source) {
        return;
      }

      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      fileDrag.current = { startX: event.clientX, startY: event.clientY, moved: false };

      const inDrop = (x: number, y: number) => {
        const box = dropEl.current?.getBoundingClientRect();

        return Boolean(box && x > box.left && x < box.right && y > box.top && y < box.bottom);
      };

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - fileDrag.current.startX;
        const dy = moveEvent.clientY - fileDrag.current.startY;

        if (!fileDrag.current.moved && Math.abs(dx) + Math.abs(dy) < 6) {
          return;
        }

        fileDrag.current.moved = true;
        patch({
          fileDrag: { v, x: moveEvent.clientX, y: moveEvent.clientY },
          over: inDrop(moveEvent.clientX, moveEvent.clientY),
        });
      };

      const up = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);

        const inside = inDrop(upEvent.clientX, upEvent.clientY);
        const moved = fileDrag.current.moved;
        patch({ fileDrag: null, over: false });

        // A tap counts as a pick, and so does a drag that ends on the target;
        // a drag that ends anywhere else puts the file back.
        if (!moved || inside) {
          pickSource(v);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [patch, pickSource],
  );

  /* The tutor talking or listening sets Memo swaying along; anything else stops him. */
  const onTutorPhase = useCallback(
    (phase: string) => {
      if (phase === "speaking" || phase === "listening") {
        if (!mascot.grooving()) {
          move("rider", "groove", Infinity);
        }
      } else {
        stopGroove();
      }
    },
    [mascot, move, stopGroove],
  );

  const qBlocked = kind === "q" && !form[step.key as keyof OnboardingForm];

  const ctaDisabled = (() => {
    if (kind === "loading") {
      return !saveError;
    }

    return qBlocked;
  })();

  useEffect(() => {
    const wide = window.matchMedia(WIDE_QUERY);
    const roomy = window.matchMedia(ROOMY_QUERY);
    const calm = window.matchMedia(CALM_QUERY);
    const sync = () => patch({ wide: wide.matches, roomy: roomy.matches, calm: calm.matches });

    sync();
    wide.addEventListener("change", sync);
    roomy.addEventListener("change", sync);
    calm.addEventListener("change", sync);

    return () => {
      wide.removeEventListener("change", sync);
      roomy.removeEventListener("change", sync);
      calm.removeEventListener("change", sync);
    };
  }, [patch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      // The practice-test step has a real textarea in it, and the study-time
      // step a slider: Enter and the arrows belong to them there.
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) {
        return;
      }

      const current = stateRef.current;
      const list = STEPS.filter((s) =>
        s.when === "student"
          ? isStudentRole(current.form.role)
          : s.when === "uni"
            ? current.form.role === "university_student"
            : true,
      );
      const active = list[Math.max(0, list.findIndex((s) => s.id === current.stepId))];

      if (event.key === "ArrowRight" || event.key === "Enter") {
        // Every step has the button now, questions included — it waits for a
        // pick there — so the keyboard presses it rather than moving the step.
        if (ctaRef.current.enabled) {
          ctaRef.current.press();
        }

        return;
      }

      if (event.key === "ArrowLeft") {
        goRef.current(-1);
        return;
      }

      if (/^[1-9]$/.test(event.key) && active.kind === "q") {
        const picked = optionsFor(active)[Number(event.key) - 1];

        if (picked) {
          select(active.key!, picked.value);
        }
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [optionsFor, select]);

  useEffect(() => {
    const runningTimers = timers.current;
    const runningLoops = intervals.current;
    const runningTilt = tilt.current;

    return () => {
      Object.values(runningTimers).forEach((id) => id !== undefined && clearTimeout(id));
      Object.values(runningLoops).forEach((id) => id !== undefined && clearInterval(id));
      cancelAnimationFrame(raf.current);
      cancelAnimationFrame(runningTilt.frame);
      cancelAnimationFrame(gazeFrame.current);
    };
  }, []);

  /*
   * Arriving on a step: Memo drops in the first time he appears beside a
   * bubble and hops (or, going back, boings) every time after; the bubble
   * springs in; he blinks once he has landed. The hero screens animate their
   * own bigger Memo instead.
   */
  useEffect(() => {
    const current = STEPS.find((s) => s.id === state.stepId);

    if (!current) {
      return;
    }

    if (current.id === "tryFlashcard") {
      clearTimer("deckNext");
      patch({ queue: START_QUEUE, cardPos: 0, answers: {}, flipped: false, dragX: 0, dragging: false, exitDir: 0 });
    }

    stopGroove();
    clearTimer("landBlink");
    timers.current.landBlink = setTimeout(() => blink("single"), 720);

    if (current.kind === "welcome") {
      riderShown.current = false;
      move("hero", "dropIn");
      clearTimer("hero");
      timers.current.hero = setTimeout(() => move("hero", "wave"), 1000);
      return;
    }

    if (current.kind === "done") {
      riderShown.current = false;
      move("done", "dropIn");
      clearTimer("hero");
      timers.current.hero = setTimeout(() => {
        move("done", "cheer");
        burst("done", "confetti");
      }, 860);
      return;
    }

    if (current.kind === "loading") {
      riderShown.current = false;
      return;
    }

    if (!riderShown.current) {
      riderShown.current = true;
      move("rider", "dropIn");
    } else {
      move("rider", direction.current < 0 ? "boing" : "hop");
    }

    if (bubbleEl.current?.animate && !stateRef.current.calm) {
      bubbleEl.current.animate(
        [
          { opacity: 0, transform: "translateX(-10px) scale(0.92)", easing: "cubic-bezier(0.22,1,0.36,1)" },
          { offset: 0.6, opacity: 1, transform: "translateX(2px) scale(1.02)", easing: "cubic-bezier(0.45,0,0.55,1)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 460 },
      );
    }
    // Only a change of step is an arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stepId]);

  /** What Memo says on this step — the question itself lives in his bubble. */
  const bubbleText = (() => {
    if (kind === "welcome") return c.welcomeTitle;
    if (kind === "loading") return state.pct >= 100 ? c.loadReady : c.loadTitle;
    if (kind === "done") return c.doneTitle;
    if (kind === "proof") return c.proofTitle;
    if (kind === "chart") return c.chartTitle;
    if (kind === "testimonial") return student ? c.reviewStudents : c.reviewOthers;

    return step.qk ? c[step.qk] : "";
  })();

  /*
   * The bubble types itself out while Memo talks along — a munch per syllable
   * or so. A new step waits for the step to settle first (longer on the hero
   * screens, whose bubble springs in late); a new line on the same step, like
   * the loader's "ready", starts at once.
   */
  const typedStep = useRef<string | null>(null);

  useEffect(() => {
    clearLoop("type");
    clearTimer("type");

    const total = bubbleText.length;
    const sameStep = typedStep.current === state.stepId;
    typedStep.current = state.stepId;

    if (state.calm) {
      patch({ tw: total });
      return;
    }

    patch({ tw: 0 });
    const delay = sameStep ? 0 : kind === "welcome" ? 700 : hero ? 420 : 160;

    timers.current.type = setTimeout(() => {
      const who = kind === "welcome" ? "hero" : kind === "done" ? "done" : kind === "loading" ? "loader" : "rider";
      move(who, "munch", Math.max(2, Math.round(total / 9)));
      intervals.current.type = setInterval(() => {
        const next = Math.min(total, stateRef.current.tw + 2);
        patch({ tw: next });

        if (next >= total) {
          clearLoop("type");
        }
      }, 24);
    }, delay);
    // The line and the step are what restart the typing; the rest is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbleText, state.stepId, state.calm]);

  /* What Memo is turning over in his thought cloud, cycled with a pop. */
  const thinking = thinkIcons(state.stepId, form.studyHour);
  const thinkIcon = thinking.length ? thinking[state.thinkTick % thinking.length] : "";

  useEffect(() => {
    const id = setInterval(() => {
      if (!thinkIcons(stateRef.current.stepId, stateRef.current.form.studyHour).length) {
        return;
      }

      setState((current) => ({ ...current, thinkTick: current.thinkTick + 1 }));
    }, 1700);

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (state.thinkTick === 0 || state.calm) {
      return;
    }

    rootRef.current?.querySelectorAll<HTMLElement>("[data-memo-think]").forEach((element) =>
      element.animate(
        [
          { transform: "scale(0.3) rotate(-20deg)", opacity: 0, easing: "cubic-bezier(0.22,1,0.36,1)" },
          { offset: 0.6, transform: "scale(1.15) rotate(6deg)", opacity: 1 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 420 },
      ),
    );
  }, [state.thinkTick, state.calm]);

  /*
   * He leans toward whatever you are pointing at — a companion watching along —
   * and on the welcome screen the big Memo tilts after the pointer in 3D.
   */
  useEffect(() => {
    const tiltStep = () => {
      const element = heroTiltEl.current;
      const { target, current } = tilt.current;
      current[0] += (target[0] - current[0]) * 0.085;
      current[1] += (target[1] - current[1]) * 0.085;

      if (element) {
        element.style.transform =
          `translate3d(${(current[0] * 10).toFixed(2)}px,${(current[1] * 6).toFixed(2)}px,0) rotateY(${(current[0] * 16).toFixed(2)}deg) ` +
          `rotateX(${(-current[1] * 12).toFixed(2)}deg) rotate(${(current[0] * 5).toFixed(2)}deg)`;
      }

      tilt.current.frame =
        element && (Math.abs(target[0] - current[0]) > 0.0015 || Math.abs(target[1] - current[1]) > 0.0015)
          ? requestAnimationFrame(tiltStep)
          : 0;
    };

    const gazeStep = () => {
      gazeFrame.current = 0;
      const element = gazeEl.current;
      const pointer = lastPointer.current;

      if (!element || !pointer || stateRef.current.calm) {
        return;
      }

      const box = element.getBoundingClientRect();
      const dx = Math.max(-1, Math.min(1, (pointer[0] - (box.left + box.width / 2)) / 420));
      const below = pointer[1] > box.bottom ? 1 : 0;
      element.style.transform = `rotate(${(dx * 9).toFixed(2)}deg) translateX(${(dx * 2).toFixed(1)}px) scale(${1 + below * 0.02})`;
    };

    const onPointer = (event: PointerEvent) => {
      lastPointer.current = [event.clientX, event.clientY];

      if (!gazeFrame.current) {
        gazeFrame.current = requestAnimationFrame(gazeStep);
      }

      const element = heroTiltEl.current;

      if (!element || stateRef.current.calm) {
        return;
      }

      const box = element.getBoundingClientRect();
      tilt.current.target = [
        Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2))),
        Math.max(-1, Math.min(1, (event.clientY - (box.top + box.height / 2)) / (window.innerHeight / 2))),
      ];

      if (!tilt.current.frame) {
        tilt.current.frame = requestAnimationFrame(tiltStep);
      }
    };

    const onOut = (event: MouseEvent) => {
      if (event.relatedTarget) {
        return;
      }

      tilt.current.target = [0, 0];

      if (gazeEl.current) {
        gazeEl.current.style.transform = "rotate(0deg)";
      }

      if (!tilt.current.frame) {
        tilt.current.frame = requestAnimationFrame(tiltStep);
      }
    };

    window.addEventListener("pointermove", onPointer);
    window.addEventListener("mouseout", onOut);

    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("mouseout", onOut);
    };
  }, []);

  const columnStep = step.cols === WRAPPING_COLUMNS;

  useEffect(() => {
    if (!columnStep) {
      setColumnLabelPx(null);
      return;
    }

    let cancelled = false;

    const measure = () => {
      const grid = optionGridEl.current;
      const labels = grid ? Array.from(grid.querySelectorAll<HTMLElement>("[data-option-label]")) : [];
      const context = document.createElement("canvas").getContext("2d");

      if (cancelled || !labels.length || !context) {
        return;
      }

      const base = columnLabelBasePx();
      context.font = `800 ${base}px ${getComputedStyle(labels[0]).fontFamily}`;
      let ratio = 1;

      for (const label of labels) {
        const room = label.clientWidth;

        for (const word of (label.textContent ?? "").split(/\s+/)) {
          const width = context.measureText(word).width;

          if (room > 0 && width > room) {
            ratio = Math.min(ratio, room / width);
          }
        }
      }

      // A hair under the exact fit, for the rounding between canvas and layout.
      setColumnLabelPx(ratio < 1 ? Math.max(COLUMN_LABEL_FLOOR_PX, Math.floor(base * ratio * 0.98 * 10) / 10) : null);
    };

    // The label font has to be loaded for its widths to be the real ones.
    void document.fonts.ready.then(() => requestAnimationFrame(measure));
    window.addEventListener("resize", measure);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
    };
  }, [columnStep, state.stepId, locale]);

  /*
   * No step scrolls: when a step is taller than the room between the header
   * and Continue, scale its contents down while preserving the column width.
   * Compensating the layout width also lets long answers wrap less, so the
   * role choices and answered quiz keep the same side insets as Continue.
   */
  useEffect(() => {
    const main = mainEl.current;
    const fit = fitEl.current;

    if (!main || !fit || typeof ResizeObserver === "undefined") {
      return;
    }

    const measure = () => {
      const style = getComputedStyle(main);
      const width = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (!width) return;

      fit.style.width = `${width}px`;
      const room = main.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (!fit.offsetHeight || !room) return;

      let scale = 1;
      if (fit.offsetHeight > room) {
        // Width changes wrapping, so measure the fit rather than applying the
        // original height ratio and narrowing every card on taller steps.
        let low = 0.55;
        let high = 1;
        for (let pass = 0; pass < 10; pass += 1) {
          const candidate = (low + high) / 2;
          fit.style.width = `${width / candidate}px`;
          if (fit.offsetHeight * candidate <= room) low = candidate;
          else high = candidate;
        }
        scale = low;
      }

      fit.style.width = `${width / scale}px`;
      fit.style.transform = scale < 1 ? `scale(${scale})` : "";
    };

    const observer = new ResizeObserver(measure);
    observer.observe(main);
    observer.observe(fit);
    measure();

    return () => observer.disconnect();
  }, []);

  /*
   * What the call to action does, named rather than written into the view, so
   * that the keyboard can press the button rather than approximate it.
   */
  const pressCta = () => {
    if (kind === "done") {
      finish();
      return;
    }

    // The one place the CTA is not "onward": a save that failed leaves the
    // loader parked with this button offering another go at it.
    if (kind === "loading") {
      setSaveError(null);
      runLoader();
      return;
    }

    go(1);
  };

  const ctaRef = useRef<{ press: () => void; enabled: boolean }>({
    press: pressCta,
    enabled: false,
  });

  const soft = accentRgba(0.16);

  const options = (kind === "q" ? optionsFor(step) : []).map((option, optionIndex) => {
    const on = form[step.key as keyof OnboardingForm] === option.value;
    const mark = BRAND_MARKS[option.icon];

    return {
      value: option.value,
      label: t(option.labelKey),
      desc: "descriptionKey" in option && option.descriptionKey ? t(option.descriptionKey) : "",
      icon: mark ? "" : option.icon,
      vb: mark ? mark.vb : "",
      d: mark ? mark.d : "",
      svgFill: mark ? mark.fill : "none",
      svgStroke: mark ? mark.stroke : "none",
      hasMark: Boolean(mark),
      noMark: !mark,
      selected: on,
      bg: on ? soft : "var(--chip)",
      ring: on ? ACCENT : "var(--chip-ring)",
      depth: on ? "2px" : "4px",
      lift: on ? "2px" : "0px",
      delay: `${40 + optionIndex * 55}ms`,
      onSelect: () => select(step.key as keyof OnboardingForm, option.value),
    };
  });

  const loaderRows = [
    { label: c.loadRow1, at: 20, from: 0 },
    { label: c.loadRow2, at: 55, from: 20 },
    { label: c.loadRow3, at: 90, from: 55 },
  ].map((row) => {
    const done = state.pct >= row.at;
    const active = !done && state.pct >= row.from;

    return {
      label: row.label,
      opacity: done ? 1 : active ? 0.85 : 0.3,
      dot: done ? "#62d676" : "transparent",
      ring: done ? "0" : "1.5px solid var(--line)",
      mark: done ? "✓" : "",
      color: done || active ? "var(--text)" : "var(--muted)",
    };
  });

  const yearOptions = getOnboardingYearOptions(locale, form.role, form.schoolLevel);
  const summary = [
    { key: "role", icon: "🎓", label: c.sumYouAre, value: findLabel(ROLE_OPTIONS, form.role, t) },
    { key: "schoolYear", icon: "📅", label: c.sumYear, value: findLabel(yearOptions, form.schoolYear, t) },
    { key: "subject", icon: "🔬", label: c.sumField, value: findLabel(SUBJECT_OPTIONS, form.subject, t) },
    { key: "motivation", icon: "🎯", label: c.sumGoal, value: findLabel(MOTIVATION_OPTIONS, form.motivation, t) },
    { key: "feature", icon: "✨", label: c.sumFirst, value: findLabel(FEATURE_OPTIONS, form.feature, t) },
    { key: "dailyGoal", icon: "⏱️", label: c.sumDaily, value: findLabel(DAILY_GOAL_OPTIONS, form.dailyGoal, t) },
  ].filter((row) => form[row.key as keyof OnboardingForm]);

  const gradeKey = (kind === "grade" ? step.key : "targetGrade") as
    | "currentAverageGrade"
    | "targetGrade";
  const gradeValue = form[gradeKey];
  const { min: gradeMin, max: gradeMax } = gradeBounds(form.schoolLevel);

  const chart = (() => {
    const from = form.currentAverageGrade;
    const to = Math.max(form.targetGrade, from + 0.2);
    const x0 = 34;
    const x1 = 300;
    const yTop = 30;
    const yBase = 128;
    const at = (progress: number, value: number): [number, number] => {
      const x = x0 + (x1 - x0) * progress;
      const y = yBase - ((value - from) / (to - from)) * (yBase - yTop);

      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    };
    /*
     * An S-curve, not a straight climb: slow while the habit forms, steep once
     * revision compounds, easing off as it approaches the target. The wobble is
     * deterministic (a fixed sine, not random) so the line is the same on every
     * render but still reads like real marks rather than a formula.
     */
    const ease = (p: number) => {
      const s = 1 / (1 + Math.exp(-9.5 * (p - 0.46)));
      const s0 = 1 / (1 + Math.exp(-9.5 * -0.46));
      const s1 = 1 / (1 + Math.exp(-9.5 * 0.54));

      return (s - s0) / (s1 - s0);
    };
    const steps = Array.from({ length: 41 }, (_, k) => k / 40);
    const memo = steps.map((p) => {
      const wobble = p === 0 || p === 1 ? 0 : Math.sin(p * 17.5) * 0.016 + Math.sin(p * 6.1) * 0.01;

      return at(p, from + (to - from) * Math.min(1, Math.max(0, ease(p) + wobble)));
    });
    const own = steps.map((p) => {
      const wobble = p === 0 ? 0 : Math.sin(p * 13.3) * 0.014;

      return at(p, from + (to - from) * (0.19 * p + wobble));
    });
    /* Catmull-Rom through the samples, emitted as cubic béziers. */
    const smooth = (list: [number, number][]) => {
      let d = `M ${list[0][0]} ${list[0][1]}`;

      for (let k = 0; k < list.length - 1; k += 1) {
        const p0 = list[k - 1] || list[k];
        const p1 = list[k];
        const p2 = list[k + 1];
        const p3 = list[k + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;

        d += ` C ${Math.round(c1x * 10) / 10} ${Math.round(c1y * 10) / 10}, ${
          Math.round(c2x * 10) / 10
        } ${Math.round(c2y * 10) / 10}, ${p2[0]} ${p2[1]}`;
      }

      return d;
    };
    const last = memo[memo.length - 1];

    return {
      current: from.toFixed(1),
      target: to.toFixed(1),
      line: smooth(memo),
      own: smooth(own),
      area: `${smooth(memo)} L ${x1} ${yBase} L ${x0} ${yBase} Z`,
      dotX: last[0],
      dotY: last[1],
    };
  })();

  const queue = state.queue;
  const activeCard = CARDS[queue[Math.min(state.cardPos, queue.length - 1)]] ?? CARDS[0];
  const nextCard = CARDS[queue[state.cardPos + 1]] ?? CARDS[(queue[state.cardPos] + 1) % CARDS.length];

  const chrome = step.cols === WRAPPING_COLUMNS ? OPTION_CHROME.columns : OPTION_CHROME.single;

  const showCta = kind !== "loading" || Boolean(saveError);

  const ctaLabels: Partial<Record<StepKind, string>> = {
    welcome: c.ctaStart,
    proof: c.ctaContinue,
    testimonial: c.ctaContinue,
    chart: c.ctaContinue,
    done: c.ctaDone,
  };

  /*
   * The last screen's button.
   *
   * Onboarding and the upgrade screen are two halves of `/app/start`: the answers
   * are already saved by the time this screen is reached, so the page reloads
   * onto the half that comes next. `mapAppHrefForClient` is what makes the demo
   * walk the same journey.
   *
   * Answered anonymously, the same button opens sign-in instead. `/app/start`
   * is still where it ends up, and the answers are waiting there, claimed out
   * of the cookie by the time the page decides which half to show.
   */
  const finish = () => {
    if (finishing) return;
    setFinishing(true);
    router.push(anonymous ? "/auth/continue" : mapAppHrefForClient("/app/start"));
    router.refresh();
  };

  ctaRef.current = { press: pressCta, enabled: showCta && !ctaDisabled && !finishing };

  const sky = studySky(form.studyHour);
  const right = state.quizPick === "metaphase";
  const fullMarks = state.testText.toLowerCase().includes("metaphase");
  const sourceFile = DEMO_FILES.find((file) => file.v === state.source) ?? DEMO_FILES[0];
  const srcDone = state.srcPct >= 100;

  const v = {
    accent: ACCENT,
    c,
    wide: state.wide,
    roomy: state.roomy,
    fade: state.fade,
    shift: state.shift,
    hero,
    progressPct: Math.round((shownIndex / (STEPS.length - 1)) * 100),
    bubbleText,
    tw: Math.min(state.tw, bubbleText.length),
    subtitle: step.sk ? c[step.sk] : "",
    gridCols: step.cols || "1fr",
    optionPad: chrome.padding,
    optionIcon: chrome.icon,
    optionGap: chrome.gap,
    /*
     * Two-up, a tile has no width to spare for the tick beside its label — it
     * broke a ten-letter label across two lines — so there it sits on the corner as a
     * badge, and the label is a step smaller.
     */
    optionColumns: step.cols === WRAPPING_COLUMNS,
    columnLabelSize: columnLabelPx ? `${columnLabelPx}px` : "clamp(0.86rem, 2.1vh, 0.98rem)",
    options,
    summary,
    isWelcome: kind === "welcome",
    isQuestion: kind === "q",
    isGrade: kind === "grade",
    isProof: kind === "proof",
    isTestimonial: kind === "testimonial",
    isChart: kind === "chart",
    isLoading: kind === "loading",
    isDone: kind === "done",
    isFlash: kind === "flash",
    isSource: kind === "source",
    isTest: kind === "test",
    isQuiz: kind === "quiz",
    isTutor: kind === "tutor",
    isAsk: kind === "ask",
    isTime: kind === "time",
    thinkIcon,
    sparkleOn:
      kind === "proof" ||
      kind === "testimonial" ||
      kind === "chart" ||
      (kind === "quiz" && right),

    flipDeg: state.flipped ? "180deg" : "0deg",
    flipEase: state.exitDir ? "none" : "transform 0.36s cubic-bezier(0.22,1,0.36,1)",

    reviewList: (() => {
      const bucket = student ? REVIEWS.student : REVIEWS.other;
      const ordered = [
        ...bucket.filter((r) => r.role === form.role),
        ...bucket.filter((r) => r.role !== form.role),
      ];
      const line = SUBJECT_LINES[form.subject];

      return ordered.slice(0, state.roomy ? 3 : 1).map((r, k) => ({
        name: r.name,
        initials: r.name.slice(0, 1),
        age: r.age,
        meta: c[r.meta],
        quote: k === 0 && line ? `${c[r.q]} ${t(line)}` : c[r.q],
        rule: k === 0 ? "transparent" : "var(--line-soft)",
      }));
    })(),

    proofRows: PROOF_ROWS.slice(0, state.roomy ? PROOF_ROWS.length : 5).map((row, k) => ({
      ...row,
      label: c[row.label],
      strong: k === 0,
      rule: k === 0 ? undefined : "1px solid var(--line-soft)",
      delay: `${70 + k * 70}ms`,
      barDelay: `${240 + k * 70}ms`,
    })),

    quizOptions: QUIZ_OPTIONS.map((option, k) => {
      const isRight = option.v === "metaphase";
      const chosen = state.quizPick === option.v;
      const revealed = Boolean(state.quizPick);
      const good = revealed && isRight;
      const bad = revealed && chosen && !isRight;

      return {
        value: option.v,
        label: c[option.l],
        letter: ["A", "B", "C", "D"][k],
        bg: good ? "rgba(34,197,94,0.10)" : bad ? "rgba(255,59,48,0.08)" : "var(--sunken)",
        ring: good ? "#22c55e" : bad ? "#ff3b30" : "var(--chip-ring)",
        color: good ? "#22c55e" : bad ? "#ff3b30" : "var(--text)",
        badgeBg: good ? "#22c55e" : bad ? "#ff3b30" : "var(--line-soft)",
        badgeColor: good || bad ? "#ffffff" : "var(--muted)",
        lip: good ? "#17924a" : bad ? "#c8261c" : "var(--chip-ring)",
        anim: bad
          ? "memo-shake 460ms ease-out both"
          : good
            ? "memo-pop 380ms cubic-bezier(0.22,1,0.36,1) both"
            : `memo-rise 440ms cubic-bezier(0.22,1,0.36,1) ${60 + k * 60}ms both`,
        onPick: () => {
          if (stateRef.current.quizPick) {
            return;
          }

          patch({ quizPick: option.v });

          if (isRight) {
            move("rider", "cheer");
            burst("rider", "sparkle");
          } else {
            move("rider", "shake");
          }
        },
      };
    }),
    quizAnswered: Boolean(state.quizPick),
    quizVerdict: right ? c.quizRight : c.quizWrong,
    quizVerdictBg: right ? "#22c55e" : "#ff3b30",

    files: DEMO_FILES.map((file, k) => ({
      v: file.v,
      name: file.name,
      ext: file.ext,
      meta: c[file.meta],
      icon: file.i,
      tint: file.tint,
      lifted: state.fileDrag && state.fileDrag.v === file.v ? 0.35 : 1,
      delay: `${60 + k * 70}ms`,
      onDown: (event: ReactPointerEvent<HTMLDivElement>) => fileDown(file.v, event),
    })),
    fileDragging: Boolean(state.fileDrag),
    ghostX: state.fileDrag ? state.fileDrag.x : 0,
    ghostY: state.fileDrag ? state.fileDrag.y : 0,
    dragName: state.fileDrag ? DEMO_FILES.find((f) => f.v === state.fileDrag?.v)?.name ?? "" : "",
    dragIcon: state.fileDrag ? DEMO_FILES.find((f) => f.v === state.fileDrag?.v)?.i ?? "" : "",
    dropBg: state.over ? accentRgba(0.12) : "transparent",
    dropRing: state.over ? ACCENT : "var(--line)",
    dropScale: state.over ? 1.008 : 1,
    dropLabel: state.over ? c.dropOver : c.dropIdle,
    sourceIdle: !state.source,
    srcWorking: Boolean(state.source),
    srcBusy: Boolean(state.source) && !srcDone,
    srcPct: state.srcPct,
    srcCardRing: srcDone ? "#22c55e" : "var(--chip-ring)",
    srcIconBg: srcDone ? "rgba(34,197,94,0.16)" : sourceFile.tint,
    srcCardIcon: srcDone ? "✓" : sourceFile.i,
    srcCardTitle: srcDone ? c.srcNoteTitle : sourceFile.name,
    srcCardSub: srcDone
      ? c.srcStage4
      : state.srcPct < 35
        ? c.srcStage1
        : state.srcPct < 70
          ? c.srcStage2
          : c.srcStage3,
    srcPctLabel: srcDone ? "✓" : `${state.srcPct}%`,
    srcOutputs: SOURCE_OUTPUTS.map((output) => {
      const done = state.srcPct >= output.at;

      return {
        icon: output.icon,
        label: c[output.label],
        opacity: done ? 1 : 0.5,
        scale: done ? 1 : 0.96,
        dot: done ? "#22c55e" : "transparent",
        ring: done ? "0" : "2px solid var(--chip-ring)",
        spinTop: done ? "transparent" : ACCENT,
        spin: done ? "memo-pop 360ms cubic-bezier(0.22,1,0.36,1) both" : "memo-spin 0.8s linear infinite",
        mark: done ? "✓" : "",
      };
    }),

    testText: state.testText,
    onTestType: (event: { target: { value: string } }) => patch({ testText: event.target.value }),
    testGraded: state.testGraded,
    testUngraded: !state.testGraded,
    gradeTest: () => {
      patch({ testGraded: true });

      if (fullMarks) {
        move("rider", "cheer");
        burst("rider", "confetti");
      } else {
        move("rider", "hop");
      }
    },
    cannotGrade: state.testText.trim().length <= 2,
    gradeOpacity: state.testText.trim().length <= 2 ? 0.45 : 1,
    testScore: fullMarks ? "4 / 4" : "3 / 4",
    testScoreBg: fullMarks ? "#22c55e" : "#ffcc4d",

    cardQ: c[activeCard.q],
    cardA: c[activeCard.a],
    nextQ: c[nextCard.q],
    knownCount: Object.values(state.answers).filter((a) => a === "easy").length,
    againCount: Object.values(state.answers).filter((a) => a === "again").length,
    cardShift: state.dragging ? state.dragX : 0,
    cardLift: (state.dragging ? -Math.abs(state.dragX) : 0) * 0.04,
    cardTilt: Math.max(-8, Math.min(8, ((state.dragging ? state.dragX : 0) / 120) * 8)),
    exitActive: Boolean(state.exitDir),
    exitToken: state.exitToken,
    /* exitX/exitY/exitRot, exactly as the app derives them. */
    exitShift: `${((state.exitDx / drag.current.width) * 100).toFixed(2)}%`,
    exitLift: `${(((-Math.abs(state.exitDx) * 0.04) / 416) * 100).toFixed(2)}%`,
    exitTilt: `${Math.max(-8, Math.min(8, (state.exitDx / 120) * 8)).toFixed(2)}deg`,
    exitBg: state.exitDir > 0 ? "rgba(34,197,94,0.16)" : "rgba(255,59,48,0.16)",
    exitLine: state.exitDir > 0 ? "rgba(34,197,94,0.55)" : "rgba(255,59,48,0.55)",
    exitAnim: `memo-card-exit-${state.exitDir > 0 ? "right" : "left"} 0.185s cubic-bezier(0.22,0.61,0.36,1) forwards`,
    exitMark: state.exitDir > 0 ? "✅" : "❌",
    nextLift: (14 - Math.min(14, Math.abs(state.dragging ? state.dragX : 0) * 0.12)).toFixed(1),
    nextScale: (0.955 + Math.min(0.045, Math.abs(state.dragging ? state.dragX : 0) * 0.0004)).toFixed(3),
    nextEase: state.dragging || state.exitDir ? "none" : "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
    /*
     * Live under the finger, the app's spring on a short release, and no
     * transition at all on the frame the deck advances — otherwise the new
     * card slides in from where the old one was thrown.
     */
    dragEase: state.dragging || state.exitDir ? "none" : "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
    verdictOpacity:
      (state.dragging || state.exitDir) && Math.abs(state.dragX) > 4
        ? Math.min(1, Math.abs(state.dragX) / 120)
        : 0,
    verdictMark: state.dragX < 0 ? "❌" : "✅",
    verdictBg: state.dragX < 0 ? "rgba(255,59,48,0.16)" : "rgba(34,197,94,0.16)",
    cardDown,
    cardMove,
    cardUp,
    swipeAgain: () => swipeCard("again"),
    swipeEasy: () => swipeCard("easy"),

    gradeValue: gradeValue.toFixed(1),
    gradePct: Math.round(((gradeValue - gradeMin) / (gradeMax - gradeMin)) * 100),
    gradeMin: gradeMin.toFixed(1),
    gradeMax: gradeMax.toFixed(1),
    gradeScale: state.gradeScale,
    gradeUp: () => nudge(gradeKey, 1),
    gradeDown: () => nudge(gradeKey, -1),

    chartTarget: chart.target,
    chartCurrent: chart.current,
    chartLine: chart.line,
    chartOwn: chart.own,
    chartArea: chart.area,
    chartDotX: chart.dotX,
    chartDotY: chart.dotY,

    askBubbles: ASK_QUESTIONS.map((key, k) => {
      const hue = ASK_HUES[k % ASK_HUES.length];
      const left = k % 2 === 0;

      return {
        key,
        text: c[key],
        side: left ? "flex-start" : "flex-end",
        bg: `color-mix(in oklch, ${hue} 22%, var(--bg))`,
        ring: `color-mix(in oklch, ${hue} 58%, var(--bg))`,
        ink: `color-mix(in oklch, ${hue} 62%, var(--text))`,
        tailL: left ? "1.4rem" : "auto",
        tailR: left ? "auto" : "1.4rem",
        origin: left ? "1.4rem 100%" : "calc(100% - 1.4rem) 100%",
        delay: `${320 + k * 150}ms`,
        floatDelay: `${(-k * 0.7).toFixed(1)}s`,
      };
    }),
    onAsk: () => {
      move("rider", "hop");
      burst("rider", "sparkle");
    },

    sky,
    studyHour: form.studyHour,
    hourLabel: studyHourLabel(form.studyHour, locale),
    onHour: (event: { target: { value: string } }) => {
      const hour = Number(event.target.value);

      if (hour === stateRef.current.form.studyHour) {
        return;
      }

      setState((current) => ({ ...current, form: { ...current.form, studyHour: hour } }));
      const now = Date.now();

      if (now - hourMoved.current > 140) {
        hourMoved.current = now;
        move("rider", "boing");
      }
    },

    ringOffset: 100 - state.pct,
    loadingStage: state.pct >= 100 ? c.loadReady : c.loadWorking.replace("{n}", String(state.pct)),
    loadingRows: loaderRows,

    tapRider: () => {
      move("rider", "jelly");
      burst("rider", "sparkle");
    },
    tapHero: () => {
      move("hero", "jelly");
      burst("hero", "sparkle");
    },
    tapDone: () => {
      move("done", "cheer");
      burst("done", "confetti");
    },

    next: pressCta,
    back: () => { if (index === 0) { if (backHref) router.push(backHref); return; } go(-1); },
    backDisabled: index === 0 && !backHref,
    backState: index === 0 && !backHref ? "off" : "on",
    showCta,
    ctaLabel: kind === "loading" ? t("common.retry") : ctaLabels[kind] ?? c.ctaContinue,
    ctaDisabled,
    finishing,
    /* A question with nothing picked shows its button dimmed, waiting. */
    ctaBg: qBlocked ? `color-mix(in oklch, ${ACCENT} 34%, var(--bg))` : ACCENT,
    ctaColor: qBlocked ? "var(--cta-off-ink)" : "#ffffff",
    ctaLip: qBlocked ? `color-mix(in oklch, ${ACCENT} 22%, var(--bg))` : `color-mix(in oklch, ${ACCENT} 62%, #000000)`,
    footNote:
      kind === "loading" ? saveError ?? c.footLoading : kind === "done" ? c.footDone : "",
  };

  return (
    <div ref={rootRef} className="memo-onboarding-v2 memo-onboarding-keyboard">
      <div style={{ position: "relative", height: "100%", minHeight: "100%", maxHeight: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)", overflow: "hidden", boxSizing: "border-box", background: "var(--bg)", color: "var(--text)", fontFamily: `${NUNITO.style.fontFamily}, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`, WebkitFontSmoothing: "antialiased" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: "-10%", gridArea: "1 / 1 / 3 / 2", pointerEvents: "none", backgroundImage: "radial-gradient(58% 44% at 18% 10%, var(--mesh-lift) 0%, transparent 68%), radial-gradient(48% 38% at 84% 20%, var(--mesh-sink) 0%, transparent 64%), radial-gradient(54% 40% at 32% 44%, var(--mesh-lift) 0%, transparent 66%), radial-gradient(64% 46% at 90% 60%, var(--mesh-sink) 0%, transparent 62%), radial-gradient(50% 42% at 8% 76%, var(--mesh-lift) 0%, transparent 66%), radial-gradient(60% 44% at 64% 94%, var(--mesh-sink) 0%, transparent 64%)", opacity: "var(--mesh-opacity, 1)", animation: "memo-aurora 40s ease-in-out infinite" }}></div>
      <header style={{ position: "relative", zIndex: "5", gridRow: "1", display: "flex", alignItems: "center", gap: "0.85rem", padding: "max(0.7rem, env(safe-area-inset-top)) clamp(1rem, 4vw, 2rem) clamp(0.5rem, 1.4vh, 0.9rem)" }}>
      <button type="button" onClick={v.back} aria-label={t("onboarding.previousStep")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.4rem", height: "2.4rem", flex: "0 0 auto", padding: "0", border: "0", borderRadius: "999px", background: "var(--line-soft)", color: "var(--text)", fontSize: "1.35rem", lineHeight: "1", cursor: "pointer", transition: "transform 160ms cubic-bezier(0.2,0.8,0.2,1), background-color 160ms ease, opacity 200ms ease", visibility: v.backState === "off" ? "hidden" : undefined }} data-back={v.backState} disabled={v.backDisabled} className="memo-ob-fx-1"><span aria-hidden="true" style={{ display: "block", width: "0.55rem", height: "0.55rem", marginLeft: "0.16rem", borderLeft: "2px solid currentColor", borderBottom: "2px solid currentColor", borderRadius: "1px", transform: "rotate(45deg)" }}></span></button>
      <div style={{ position: "relative", flex: "1 1 auto", minWidth: "0", height: "1rem" }}>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.progressPct} aria-label={t("onboarding.progressLabel")} style={{ height: "100%", borderRadius: "999px", background: "var(--ob-bar-track)", overflow: "hidden" }}>
      <div style={{ minWidth: "1rem", height: "100%", borderRadius: "999px", transition: "width 620ms cubic-bezier(0.22,1,0.36,1)", position: "relative", overflow: "hidden", width: `${v.progressPct}%`, background: v.accent }}>
      <div aria-hidden="true" style={{ position: "absolute", left: "0.45rem", right: "0.45rem", top: "0.2rem", height: "0.22rem", borderRadius: "999px", background: "rgba(255,255,255,0.38)" }}></div>
      <div aria-hidden="true" style={{ position: "absolute", inset: "0", width: "40%", background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.4), rgba(255,255,255,0))", animation: "memo-shimmer 2.4s ease-in-out infinite" }}></div>
      </div>
      </div>
      </div>
      </header>
      <div style={{ position: "relative", zIndex: "2", gridRow: "2", minHeight: "0", overflow: "visible", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(1.5rem, 5vw, 4rem)", padding: "clamp(0.4rem, 1.4vh, 1.6rem) clamp(1rem, 4vw, 2rem) clamp(5.6rem, 14vh, 6.8rem)" }}>
      {v.wide ? (<>
      <aside style={{ flex: "0 1 22rem", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.6rem", paddingRight: "1rem" }}>
      <img src="/memo-lockup.png" alt="Memo AI" style={{ width: "8.5rem", height: "auto", display: "block" }} />
      <p style={{ margin: "0", fontSize: "clamp(1.6rem, 2.4vw, 2.15rem)", fontWeight: "800", lineHeight: "1.1", letterSpacing: "-0.02em", textWrap: "pretty" }}>{v.c.asideTitle}</p>
      <div style={{ display: "grid", gap: "0.55rem" }}>
      {v.summary.map((row) => (<Fragment key={row.key}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.7rem 0.85rem", borderRadius: "0.95rem", background: "var(--line-soft)", boxShadow: "inset 0 0 0 1px var(--line)", animation: "memo-rise 320ms cubic-bezier(0.2,0.85,0.2,1) both" }}>
      <span style={{ width: "1.6rem", textAlign: "center", fontSize: "1rem" }}>{row.icon}</span>
      <span style={{ flex: "1 1 auto", minWidth: "0", fontSize: "0.82rem", fontWeight: "650", color: "var(--muted)" }}>{row.label}</span>
      <span style={{ fontSize: "0.86rem", fontWeight: "750", color: "var(--text)", textAlign: "right" }}>{row.value}</span>
      </div>
      </Fragment>))}
      </div>
      <p style={{ margin: "0", fontSize: "0.82rem", fontWeight: "600", lineHeight: "1.5", color: "var(--muted-2)" }}>{v.c.asideFoot}</p>
      </aside>
      </>) : null}
      {/* Wider than the column by the room a hop or a glow needs, and pulled back by the same, so nothing it draws is clipped at its edge. */}
      <main ref={mainEl} style={{ alignSelf: v.isTime ? "stretch" : undefined, flex: "1 1 30rem", maxWidth: "calc(34rem + 1.6rem)", width: "calc(100% + 1.6rem)", margin: "-3.6rem -0.8rem 0", padding: "3.6rem 0.8rem 0.6rem", minHeight: "0", maxHeight: "calc(100% + 3.6rem)", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: v.hero ? "safe center" : "flex-start", overflowY: "visible", overscrollBehavior: "contain", scrollPaddingBlock: "0.75rem", scrollbarWidth: "none" }}>
      <div ref={fitEl} style={{ alignSelf: "center", display: "flex", flexDirection: "column", flexShrink: v.isTime ? "1" : "0", flexGrow: v.isTime ? "1" : "0", minHeight: v.isTime ? "0" : undefined, transformOrigin: "50% 0" }}>
      {!v.hero ? (<>
      <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.8rem, 3.4vw, 1.3rem)", margin: "clamp(1.4rem, 3.4vh, 2.2rem) 0 clamp(1rem, 3vh, 1.8rem)", flexShrink: "0" }}>
      <div style={{ position: "relative", zIndex: "3", flex: "0 0 auto", width: "clamp(4.8rem, 21vw, 6.4rem)", paddingBottom: "0.5rem" }}>
      <MascotPedestal />
      {v.sparkleOn ? <MascotSparkles /> : null}
      <div ref={mascot.refs.riderBurst} aria-hidden="true" style={{ position: "absolute", left: "50%", top: "30%", width: "0", height: "0", zIndex: "3", pointerEvents: "none" }}></div>
      <div ref={gazeEl} style={{ position: "relative", width: "84%", margin: "0 auto", transformOrigin: "50% 100%", transition: "transform 520ms cubic-bezier(0.22,1,0.36,1)" }}>
      <div ref={mascot.refs.rider} onClick={v.tapRider} aria-hidden="true" style={{ position: "relative", aspectRatio: "320 / 288", transformOrigin: "50% 100%", cursor: "pointer" }}>
      {v.thinkIcon ? <MascotThought icon={v.thinkIcon} offset="0.5rem" /> : null}
      <div style={{ position: "absolute", inset: "0", transformOrigin: "50% 96%", animation: "memo-breathe 3s ease-in-out infinite" }}>
      <MascotFigure />
      </div>
      </div>
      </div>
      </div>
      <SpeechBubble text={v.bubbleText} typed={v.tw} tail="left" bubbleRef={(element) => { bubbleEl.current = element; }} style={{ zIndex: 1, flex: "1 1 auto", minWidth: "0", padding: "clamp(0.8rem, 2.2vh, 1.15rem) clamp(1rem, 3.4vw, 1.4rem)", transformOrigin: "0 50%" }} textStyle={{ fontSize: "clamp(1.05rem, min(4.6vw, 3vh), 1.45rem)", lineHeight: "1.38", textWrap: "pretty" }} />
      </div>
      </>) : null}
      <div style={{ minHeight: "0", flexShrink: v.isTime ? "1" : "0", flexGrow: v.isTime ? "1" : "0", transition: "opacity 200ms ease, transform 260ms cubic-bezier(0.2,0.85,0.2,1)", opacity: v.fade, transform: `translate3d(${v.shift}px, 0, 0)` }}>
      {v.isWelcome ? (<>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "1.1rem", paddingTop: "1.4rem" }}>
      <SpeechBubble text={v.bubbleText} typed={v.tw} tail="down" style={{ maxWidth: "min(26rem, 100%)", margin: "0 0 0.6rem", padding: "clamp(0.85rem, 2.2vh, 1.1rem) clamp(1.1rem, 4vw, 1.5rem)", animation: "memo-bubble-down 560ms cubic-bezier(0.22,1,0.36,1) 500ms both" }} textStyle={{ fontSize: "clamp(1.2rem, min(5.4vw, 3.4vh), 1.65rem)", lineHeight: "1.3", textWrap: "balance" }} />
      <div style={{ position: "relative", width: "clamp(6.5rem, min(38vw, 21vh), 12rem)", aspectRatio: "320 / 288", perspective: "700px", marginBottom: "1.2rem" }}>
      <MascotPedestal hero />
      <MascotSparkles />
      <div ref={mascot.refs.heroBurst} aria-hidden="true" style={{ position: "absolute", left: "50%", top: "46%", width: "0", height: "0", zIndex: "2", pointerEvents: "none" }}></div>
      <div ref={heroTiltEl} style={{ position: "absolute", inset: "0", willChange: "transform" }}>
      <div ref={mascot.refs.setHero} onClick={v.tapHero} aria-hidden="true" style={{ position: "absolute", inset: "0", transformOrigin: "50% 92%", cursor: "pointer" }}>
      <div style={{ position: "absolute", inset: "0", animation: "memo-bob 5s ease-in-out infinite" }}>
      <div style={{ position: "absolute", inset: "0", transformOrigin: "50% 94%", animation: "memo-breathe 3.4s ease-in-out infinite" }}>
      <MascotFigure lash={3} priority />
      </div>
      </div>
      </div>
      </div>
      </div>
      <p style={{ margin: "0", maxWidth: "26rem", fontSize: "clamp(1rem, 3.6vw, 1.12rem)", fontWeight: "600", lineHeight: "1.45", color: "var(--muted)", textWrap: "pretty" }}>{v.c.welcomeSub}</p>
      </div>
      </>) : null}
      {v.isQuestion ? (<>
      <div>
      {v.subtitle ? <p style={SUBTITLE}>{v.subtitle}</p> : null}
      <div ref={optionGridEl} style={{ display: "grid", gap: "clamp(0.35rem, 1.1vh, 0.6rem)", gridTemplateColumns: v.gridCols }}>
      {v.options.map((item) => (<Fragment key={item.value}>
      <button type="button" onClick={item.onSelect} aria-pressed={item.selected} style={{ position: "relative", display: "flex", alignItems: "center", gap: v.optionGap, width: "100%", minHeight: "clamp(3rem, 7.6vh, 4.2rem)", padding: `clamp(0.45rem, 1.3vh, 0.85rem) ${v.optionPad}`, boxSizing: "border-box", border: `2px solid ${item.ring}`, borderRadius: "1.15rem", color: "var(--text)", textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: item.bg, boxShadow: `0 ${item.depth} 0 ${item.ring}`, transform: `translateY(${item.lift})`, transition: "transform 140ms cubic-bezier(0.2,0.85,0.2,1), background-color 180ms ease, box-shadow 140ms ease, border-color 180ms ease", animation: `memo-rise 440ms cubic-bezier(0.22,1,0.36,1) ${item.delay} both` }} className="memo-ob-press">
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: v.optionIcon, height: v.optionIcon, flex: "0 0 auto", borderRadius: "0.8rem", background: "var(--tile)", color: "var(--text)", fontSize: "clamp(0.95rem, 2.3vh, 1.2rem)", lineHeight: "1" }}>
      {item.noMark ? (<>{item.icon}</>) : null}
      {item.hasMark ? (<>
      <svg viewBox={item.vb} aria-hidden="true" style={{ width: "64%", height: "64%", display: "block" }}><path d={item.d} fill={item.svgFill} stroke={item.svgStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </>) : null}
      </span>
      <span style={{ flex: "1 1 auto", minWidth: "0", display: "grid", gap: "0.15rem", overflowWrap: "anywhere" }}>
      <span data-option-label="" style={{ fontSize: v.optionColumns ? v.columnLabelSize : "clamp(0.95rem, 2.3vh, 1.08rem)", fontWeight: "800", lineHeight: "1.2" }}>{item.label}</span>
      {item.desc ? (<>
      <span style={{ fontSize: "clamp(0.7rem, 1.7vh, 0.82rem)", fontWeight: "600", lineHeight: "1.3", color: "var(--muted)" }}>{item.desc}</span>
      </>) : null}
      </span>
      {item.selected ? (<>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.5rem", height: "1.5rem", flex: "0 0 auto", borderRadius: "999px", color: "#000000", fontSize: "0.8rem", fontWeight: "900", animation: "memo-pop 320ms cubic-bezier(0.2,0.9,0.2,1) both", background: v.accent, ...(v.optionColumns ? { position: "absolute", top: "-0.55rem", right: "-0.55rem", boxShadow: "0 0 0 3px var(--bg)" } : null) }}>✓</span>
      </>) : null}
      </button>
      </Fragment>))}
      </div>
      </div>
      </>) : null}
      {v.isGrade ? (<>
      <div>
      <p style={{ ...SUBTITLE, margin: "0 0 clamp(0.7rem, 2vh, 1.4rem)" }}>{v.subtitle}</p>
      <div style={{ display: "grid", gap: "1.4rem", padding: "0.4rem 0.2rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
      <button type="button" onClick={v.gradeDown} aria-label={t("onboarding.lowerGrade")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "3.1rem", height: "3.1rem", flex: "0 0 auto", padding: "0", border: "0", borderRadius: "999px", background: "var(--tile)", color: "var(--text)", fontSize: "1.5rem", fontWeight: "700", lineHeight: "1", cursor: "pointer", fontFamily: "inherit", transition: "transform 150ms cubic-bezier(0.2,0.85,0.2,1), background-color 160ms ease" }} className="memo-ob-fx-3"><span aria-hidden="true" style={{ display: "block", width: "0.95rem", height: "0.14rem", borderRadius: "2px", background: "currentColor" }}></span></button>
      <span style={{ fontSize: "clamp(3rem, 13vw, 4.4rem)", fontWeight: "850", letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", lineHeight: "1", transition: "transform 220ms cubic-bezier(0.2,1.4,0.3,1), color 200ms ease", transform: `scale(${v.gradeScale})`, color: v.accent }}>{v.gradeValue}</span>
      <button type="button" onClick={v.gradeUp} aria-label={t("onboarding.raiseGrade")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "3.1rem", height: "3.1rem", flex: "0 0 auto", padding: "0", border: "0", borderRadius: "999px", background: "var(--tile)", color: "var(--text)", fontSize: "1.4rem", fontWeight: "700", lineHeight: "1", cursor: "pointer", fontFamily: "inherit", transition: "transform 150ms cubic-bezier(0.2,0.85,0.2,1), background-color 160ms ease" }} className="memo-ob-fx-3"><span aria-hidden="true" style={{ position: "relative", display: "block", width: "0.95rem", height: "0.95rem" }}><span style={{ position: "absolute", top: "50%", left: "0", width: "100%", height: "0.14rem", marginTop: "-0.07rem", borderRadius: "2px", background: "currentColor" }}></span><span style={{ position: "absolute", left: "50%", top: "0", height: "100%", width: "0.14rem", marginLeft: "-0.07rem", borderRadius: "2px", background: "currentColor" }}></span></span></button>
      </div>
      <div>
      <div style={{ height: "0.55rem", borderRadius: "999px", background: "var(--tile)", overflow: "hidden" }}>
      <div style={{ height: "100%", borderRadius: "999px", transition: "width 260ms cubic-bezier(0.2,0.85,0.2,1)", width: `${v.gradePct}%`, background: v.accent }}></div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.78rem", fontWeight: "700", color: "var(--muted-2)" }}>
      <span>{v.gradeMin}</span>
      <span>{v.gradeMax}</span>
      </div>
      </div>
      </div>
      </div>
      </>) : null}
      {v.isProof ? (<>
      <div>
      <p style={SUBTITLE}>{v.c.proofSub}</p>
      <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0 0.15rem clamp(0.45rem, 1.3vh, 0.7rem)" }}>
      <span style={{ fontSize: "0.7rem", fontWeight: "850", letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted-2)" }}>{v.c.proofHeader}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", fontWeight: "750", color: "var(--muted)" }}><span aria-hidden="true" style={{ width: "0.42rem", height: "0.42rem", borderRadius: "999px", background: "#62d676", boxShadow: "0 0 0 3px rgba(98,214,118,0.18)" }}></span>{v.c.proofLive}</span>
      </div>
      <div style={{ display: "grid" }}>
      {v.proofRows.map((row) => (<Fragment key={row.icon}>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", borderTop: row.rule, animation: `memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) ${row.delay} both` }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>{row.icon}</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: row.strong ? "800" : "700", color: "var(--text)" }}>{row.label}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: row.strong ? "var(--text)" : "var(--muted)" }}>{row.pct}%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: `${row.pct}%`, height: "100%", borderRadius: "999px", opacity: row.opacity, transformOrigin: "left", animation: `memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) ${row.barDelay} both`, background: v.accent }}></span>
      </span>
      </div>
      </Fragment>))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "clamp(0.55rem, 1.5vh, 0.9rem) 0.15rem 0", borderTop: "1px solid var(--line-soft)", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 620ms both" }}>
      <span aria-hidden="true" style={{ display: "flex", gap: "0.08rem", fontSize: "0.86rem", color: "#ffcc4d" }}><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></span>
      <span style={{ fontSize: "0.84rem", fontWeight: "800", color: "var(--text)" }}>4.9</span>
      <span style={{ fontSize: "0.84rem", fontWeight: "650", color: "var(--muted)" }}>{v.c.proofRating}</span>
      </div>
      </div>
      </div>
      </>) : null}
      {v.isTestimonial ? (<>
      <div>
      <div style={{ display: "grid" }}>
      {v.reviewList.map((rev) => (<Fragment key={rev.name}>
      <figure style={{ margin: "0", padding: "clamp(0.45rem, 1.5vh, 1.05rem) 0.15rem", borderTop: `1px solid ${rev.rule}`, animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) both" }}>
      <div aria-label={t("onboarding.testimonial.stars")} style={{ display: "flex", gap: "0.14rem" }}>{[0, 1, 2, 3, 4].map((star) => <span key={star} aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.1rem", height: "1.1rem", borderRadius: "3px", background: "#00b67a", color: "#ffffff", fontSize: "0.68rem", lineHeight: "1" }}>★</span>)}</div>
      <blockquote style={{ margin: "clamp(0.3rem, 1vh, 0.6rem) 0 clamp(0.35rem, 1.1vh, 0.7rem)", fontSize: "clamp(0.9rem, min(3.6vw, 2.1vh), 1.02rem)", fontWeight: "600", lineHeight: "1.5", textWrap: "pretty" }}>{rev.quote}</blockquote>
      <figcaption style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.85rem", height: "1.85rem", flex: "0 0 auto", borderRadius: "999px", background: "var(--sunken)", color: "var(--text)", fontSize: "0.76rem", fontWeight: "800" }}>{rev.initials}</span>
      <span style={{ fontSize: "0.84rem", fontWeight: "750" }}>{rev.name}, {rev.age}</span>
      <span style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--muted)" }}>· {rev.meta}</span>
      </figcaption>
      </figure>
      </Fragment>))}
      </div>
      </div>
      </>) : null}
      {v.isChart ? (<>
      <div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "clamp(0.6rem, 2vh, 1.2rem)", padding: "0.2rem 0.1rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
      <div style={{ display: "grid", gap: "0.2rem" }}>
      <span style={{ fontSize: "0.72rem", fontWeight: "800", letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted-2)" }}>{v.c.chartKicker}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
      <span style={{ fontSize: "2.1rem", fontWeight: "850", letterSpacing: "-0.035em", lineHeight: "1", fontVariantNumeric: "tabular-nums", color: v.accent }}>{v.chartTarget}</span>
      <span style={{ fontSize: "0.84rem", fontWeight: "700", color: "var(--muted)" }}>{v.c.chartIn12}</span>
      </span>
      </div>
      </div>
      <div style={{ position: "relative", width: "100%" }}>
      <svg viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet" role="img" aria-label={v.c.chartAria} style={{ display: "block", width: "100%", height: "auto", maxHeight: "min(38vh, 17rem)", overflow: "visible" }}>
      <defs>
      <linearGradient id="memo-area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopOpacity="0.42" stopColor={v.accent} />
      <stop offset="100%" stopOpacity="0" stopColor={v.accent} />
      </linearGradient>
      <linearGradient id="memo-area-x" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
      <stop offset="12%" stopColor="#ffffff" stopOpacity="1" />
      <stop offset="80%" stopColor="#ffffff" stopOpacity="1" />
      <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <mask id="memo-area-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="140">
      <rect x="34" y="0" width="266" height="140" fill="url(#memo-area-x)" />
      </mask>
      </defs>
      <line x1="34" y1="30" x2="300" y2="30" stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="3 5" />
      <line x1="34" y1="79" x2="300" y2="79" stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="3 5" />
      <line x1="34" y1="128" x2="300" y2="128" stroke="var(--line)" strokeWidth="1" />
      <path d={v.chartArea} fill="url(#memo-area)" mask="url(#memo-area-fade)" style={{ animation: "memo-rise 700ms ease-out 700ms both" }} />
      <path d={v.chartOwn} fill="none" stroke="#4f4d57" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="620" strokeDasharray="620" style={{ animation: "memo-draw 1200ms cubic-bezier(0.33,0,0.2,1) 200ms both" }} />
      <path d={v.chartLine} fill="none" stroke={v.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength="620" strokeDasharray="620" style={{ filter: "drop-shadow(0 3px 5px var(--memo-shadow))", animation: "memo-draw 1700ms cubic-bezier(0.32,0.02,0.18,1) 320ms both" }} />
      <circle cx={v.chartDotX} cy={v.chartDotY} r="11" fill={v.accent} opacity="0.22" style={{ transformBox: "fill-box", transformOrigin: "center", animation: "memo-pop 500ms cubic-bezier(0.2,0.9,0.2,1) 1550ms both" }} />
      <circle cx={v.chartDotX} cy={v.chartDotY} r="5.5" fill={v.accent} stroke="var(--bg)" strokeWidth="2.5" style={{ transformBox: "fill-box", transformOrigin: "center", animation: "memo-pop 460ms cubic-bezier(0.2,0.9,0.2,1) 1600ms both" }} />
      </svg>
      <span style={{ position: "absolute", left: "0", top: "calc(21.4% - 0.45rem)", fontSize: "0.72rem", fontWeight: "750", color: "var(--muted)" }}>{v.chartTarget}</span>
      <span style={{ position: "absolute", left: "0", bottom: "1.9rem", fontSize: "0.72rem", fontWeight: "750", color: "var(--muted-2)" }}>{v.chartCurrent}</span>
      </div>
      <div style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: "0.5rem", padding: "0 0.1rem", fontSize: "0.74rem", fontWeight: "750", color: "var(--muted-2)" }}>
      <span>{v.c.chartNow}</span>
      <span>{v.c.chart6}</span>
      <span>{v.c.chart12}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1.1rem", paddingTop: "0.15rem", fontSize: "0.8rem", fontWeight: "700" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", color: "var(--text)" }}><span aria-hidden="true" style={{ width: "1.1rem", height: "0.28rem", borderRadius: "999px", background: v.accent }}></span>{v.c.chartWith}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", color: "var(--muted)" }}><span aria-hidden="true" style={{ width: "1.1rem", height: "0.22rem", borderRadius: "999px", background: "#4f4d57" }}></span>{v.c.chartAlone}</span>
      </div>
      </div>
      </div>
      </>) : null}
      {v.isSource ? (<>
      <div>
      <p style={SUBTITLE}>{v.subtitle}</p>
      {v.sourceIdle ? (<>
      <div style={{ padding: "0.25rem 0.35rem 0.15rem" }}>
      <div style={{ display: "grid", gap: "clamp(0.4rem, 1.1vh, 0.6rem)", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      {v.files.map((file) => (<Fragment key={file.v}>
      <div onPointerDown={file.onDown} role="button" tabIndex={0} style={{ ...CHIP, display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.75rem 0.85rem", borderRadius: "18px", boxShadow: "0 4px 0 var(--chip-ring)", cursor: "grab", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", transition: "opacity 160ms ease, transform 160ms cubic-bezier(0.2,0.85,0.2,1), background 160ms ease", opacity: file.lifted, animation: `memo-rise 440ms cubic-bezier(0.22,1,0.36,1) ${file.delay} both` }} className="memo-ob-press">
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.2rem", height: "2.2rem", flex: "0 0 auto", borderRadius: "12px", background: file.tint, fontSize: "1.15rem", lineHeight: "1" }}>{file.icon}</span>
      <span style={{ display: "grid", gap: "0.1rem", minWidth: "0" }}>
      <span style={{ fontSize: "0.88rem", fontWeight: "750", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</span>
      <span style={{ fontSize: "0.72rem", fontWeight: "600", color: "var(--muted)" }}>{file.meta}</span>
      </span>
      <span className="memo-ob-file-ext" aria-hidden="true" style={{ marginLeft: "auto", flex: "0 0 auto", padding: "0.16rem 0.36rem", borderRadius: "6px", background: "var(--line-soft)", fontSize: "0.62rem", fontWeight: "800", letterSpacing: "0.04em", color: "var(--muted)" }}>{file.ext}</span>
      </div>
      </Fragment>))}
      </div>
      <div ref={dropEl} style={{ display: "grid", placeItems: "center", gap: "0.35rem", margin: "clamp(0.6rem, 1.8vh, 1rem) 0.35rem 0.5rem", padding: "clamp(0.9rem, 3.4vh, 1.8rem) clamp(1.2rem, 4vw, 2.2rem)", borderWidth: "2.5px", borderStyle: "dashed", borderRadius: "22px", textAlign: "center", animation: "memo-drop-glow 2.4s ease-in-out infinite", transition: "background 160ms ease, border-color 160ms ease, transform 160ms cubic-bezier(0.2,0.85,0.2,1)", background: v.dropBg, borderColor: v.dropRing, transform: `scale(${v.dropScale})` }}>
      <span aria-hidden="true" style={{ fontSize: "1.9rem", lineHeight: "1", color: v.accent, animation: "memo-nudge-y 1.4s ease-in-out infinite" }}>⤓</span>
      <span style={{ fontSize: "1.08rem", fontWeight: "800", color: "var(--text)" }}>{v.dropLabel}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "700", color: "var(--muted-2)" }}>{v.c.srcTapHint}</span>
      </div>
      </div>
      </>) : null}
      {v.srcWorking ? (<>
      <div style={{ display: "grid", gap: "0.75rem", padding: "0.2rem 0 0.6rem" }}>
      <div style={{ ...CHIP, display: "grid", gap: "0.75rem", padding: "0.85rem 0.95rem 0.95rem", borderRadius: "20px", borderColor: v.srcCardRing, boxShadow: `0 4px 0 ${v.srcCardRing}`, transition: "border-color 400ms ease, box-shadow 400ms ease", animation: "memo-pop 420ms cubic-bezier(0.22,1,0.36,1) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.6rem", height: "2.6rem", flex: "0 0 auto", borderRadius: "13px", background: v.srcIconBg, color: "#22c55e", fontSize: "1.2rem", fontWeight: "900", lineHeight: "1", transition: "background 400ms ease" }}>{v.srcCardIcon}</span>
      <span style={{ display: "grid", gap: "0.12rem", minWidth: "0", flex: "1 1 auto" }}>
      <span style={{ fontSize: "1.02rem", fontWeight: "900", lineHeight: "1.25", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.srcCardTitle}</span>
      <span style={{ fontSize: "0.82rem", fontWeight: "700", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.srcCardSub}</span>
      </span>
      {v.srcBusy ? <span style={{ flex: "0 0 auto", fontSize: "0.95rem", fontWeight: "900", fontVariantNumeric: "tabular-nums", color: v.accent }}>{v.srcPctLabel}</span> : null}
      </div>
      {v.srcBusy ? (<>
      <div style={{ height: "0.4rem", borderRadius: "999px", background: "var(--ob-bar-track)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${v.srcPct}%`, borderRadius: "999px", background: v.accent, transition: "width 160ms linear" }}></div>
      </div>
      </>) : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
      {v.srcOutputs.map((output) => (<Fragment key={output.icon}>
      <div style={{ ...CHIP, display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.7rem 0.8rem", borderRadius: "16px", boxShadow: "0 4px 0 var(--chip-ring)", opacity: output.opacity, transform: `scale(${output.scale})`, transition: "opacity 300ms ease, transform 360ms cubic-bezier(0.34,1.56,0.64,1)" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2rem", height: "2rem", flex: "0 0 auto", borderRadius: "10px", background: "var(--ob-bar-track)", fontSize: "1rem", lineHeight: "1" }}>{output.icon}</span>
      <span style={{ flex: "1 1 auto", minWidth: "0", fontSize: "0.9rem", fontWeight: "800", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{output.label}</span>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.25rem", height: "1.25rem", flex: "0 0 auto", boxSizing: "border-box", borderRadius: "999px", border: output.ring, borderTopColor: output.spinTop, background: output.dot, color: "#ffffff", fontSize: "0.68rem", fontWeight: "900", animation: output.spin }}>{output.mark}</span>
      </div>
      </Fragment>))}
      </div>
      </div>
      </>) : null}
      </div>
      </>) : null}
      {v.isFlash ? (<>
      <div>
      <p style={SUBTITLE}>{v.subtitle}</p>
      <div>
      <div style={{ position: "relative", perspective: "1400px", touchAction: "pan-y" }}>
      <div aria-hidden="true" style={{ ...CHIP, position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(1.2rem, 4vh, 2rem) 1.7rem", borderRadius: "26px", boxShadow: "0 6px 0 var(--chip-ring)", pointerEvents: "none", transition: v.nextEase, transform: `translateY(${v.nextLift}px) scale(${v.nextScale})` }}>
      <span style={{ fontSize: "clamp(0.95rem, 2.6vh, 1.3rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.32", textAlign: "center", textWrap: "pretty", opacity: "0.5" }}>{v.nextQ}</span>
      </div>
      <div onPointerDown={v.cardDown} onPointerMove={v.cardMove} onPointerUp={v.cardUp} onPointerCancel={v.cardUp} role="button" tabIndex={0} style={{ position: "relative", zIndex: "2", minHeight: "clamp(10.5rem, 30vh, 17rem)", cursor: "grab", touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none", willChange: "transform", perspective: "1400px", transformStyle: "preserve-3d", transition: v.dragEase, transform: `translate3d(${v.cardShift}px, ${v.cardLift}px, 0) rotate(${v.cardTilt}deg)` }}>
      <div style={{ position: "absolute", inset: "0", transformStyle: "preserve-3d", transition: v.flipEase, transform: `rotateY(${v.flipDeg})` }}>
      <div style={{ ...CHIP, position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.7rem", padding: "clamp(1.2rem, 4vh, 2rem) 1.7rem", borderRadius: "26px", color: "var(--text)", boxShadow: "0 6px 0 var(--chip-ring), var(--shadow)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "translateZ(1px)" }}>
      <span style={{ fontSize: "clamp(1rem, 2.8vh, 1.35rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.32", textAlign: "center", textWrap: "pretty" }}>{v.cardQ}</span>
      </div>
      <div style={{ ...CHIP, position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.7rem", padding: "clamp(1.2rem, 4vh, 2rem) 1.7rem", borderRadius: "26px", color: "var(--text)", boxShadow: "0 6px 0 var(--chip-ring), var(--shadow)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg) translateZ(1px)" }}>
      <span style={{ fontSize: "clamp(0.95rem, 2.6vh, 1.25rem)", fontWeight: "700", letterSpacing: "-0.025em", lineHeight: "1.42", textAlign: "center", textWrap: "pretty" }}>{v.cardA}</span>
      <span style={{ color: "var(--muted)", fontSize: "clamp(0.85rem, 2.1vh, 1.05rem)", letterSpacing: "-0.02em" }}>{v.c.flashHintBack}</span>
      </div>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "26px", fontSize: "2.2rem", pointerEvents: "none", transition: "opacity 0.12s linear, background-color 0.12s ease", opacity: v.verdictOpacity, background: v.verdictBg }}>{v.verdictMark}</div>
      </div>
      {v.exitActive ? (<>
      <div key={v.exitToken} aria-hidden="true" style={{ position: "absolute", inset: "0", zIndex: "3", display: "grid", placeItems: "center", borderRadius: "26px", fontSize: "2.25rem", pointerEvents: "none", animation: v.exitAnim, background: v.exitBg, boxShadow: `inset 0 0 0 1.5px ${v.exitLine}`, "--ex": v.exitShift, "--ey": v.exitLift, "--er": v.exitTilt } as CSSProperties}>{v.exitMark}</div>
      </>) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.9rem", marginTop: "clamp(1.6rem, 3.6vh, 2.2rem)" }}>
      <button type="button" onClick={v.swipeAgain} aria-label={t("study.cards.didntKnow")} style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", minHeight: "3.4rem", padding: "0 1.5rem", border: "2px solid rgba(255,59,48,0.35)", borderRadius: "999px", background: "rgba(255,59,48,0.12)", color: "#ff3b30", boxShadow: "0 4px 0 rgba(255,59,48,0.35)", fontFamily: "inherit", fontSize: "1.12rem", fontWeight: "900", lineHeight: "1", cursor: "pointer", transition: "transform 160ms cubic-bezier(0.2,0.85,0.2,1)" }} className="memo-ob-press">✕ <span style={{ fontVariantNumeric: "tabular-nums" }}>{v.againCount}</span></button>
      <button type="button" onClick={v.swipeEasy} aria-label={t("study.cards.knew")} style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", minHeight: "3.4rem", padding: "0 1.5rem", border: "2px solid rgba(34,197,94,0.38)", borderRadius: "999px", background: "rgba(34,197,94,0.12)", color: "#1fb257", boxShadow: "0 4px 0 rgba(34,197,94,0.38)", fontFamily: "inherit", fontSize: "1.12rem", fontWeight: "900", lineHeight: "1", cursor: "pointer", transition: "transform 160ms cubic-bezier(0.2,0.85,0.2,1)" }} className="memo-ob-press"><span style={{ fontVariantNumeric: "tabular-nums" }}>{v.knownCount}</span> ✓</button>
      </div>
      </div>
      </div>
      </>) : null}
      {v.isQuiz ? (<>
      <div>
      <p style={SUBTITLE}>{v.subtitle}</p>
      <div style={{ ...CHIP, padding: "clamp(1rem, 2.8vh, 1.6rem) clamp(1.1rem, 3vw, 1.7rem) clamp(0.9rem, 2.6vh, 1.5rem)", borderRadius: "24px", boxShadow: "0 5px 0 var(--chip-ring)" }}>
      <span style={{ display: "block", color: "var(--muted)", fontSize: "clamp(0.86rem, 2vh, 0.98rem)", fontWeight: "600", letterSpacing: "-0.015em" }}>{v.c.quizMeta}</span>
      <p style={{ margin: "0.5rem 0 clamp(0.7rem, 2vh, 1.2rem)", fontSize: "clamp(1.02rem, 2.8vh, 1.3rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.3", textWrap: "pretty" }}>{v.c.quizQ}</p>
      <div style={{ display: "grid", gap: "clamp(0.4rem, 1.2vh, 0.7rem)" }}>
      {v.quizOptions.map((opt) => (<Fragment key={opt.value}>
      <button type="button" onClick={opt.onPick} style={{ display: "flex", alignItems: "center", gap: "0.9rem", width: "100%", minHeight: "clamp(3rem, 7.4vh, 4.4rem)", padding: "0 1.1rem", boxSizing: "border-box", borderRadius: "18px", cursor: "pointer", fontFamily: "inherit", fontSize: "clamp(0.95rem, 2.3vh, 1.08rem)", fontWeight: "600", letterSpacing: "-0.02em", textAlign: "left", border: "2px solid transparent", transition: "background 0.18s ease, color 0.18s ease, border-color 0.18s ease", background: opt.bg, borderColor: opt.ring, color: opt.color, boxShadow: `0 4px 0 ${opt.lip}`, animation: opt.anim }} className="memo-ob-press">
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.1rem", height: "2.1rem", flex: "0 0 auto", borderRadius: "999px", fontSize: "0.98rem", fontWeight: "750", transition: "background 0.18s ease", background: opt.badgeBg, color: opt.badgeColor }}>{opt.letter}</span>
      <span style={{ flex: "1 1 auto", minWidth: "0" }}>{opt.label}</span>
      </button>
      </Fragment>))}
      </div>
      {v.quizAnswered ? (<>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.8rem", marginTop: "clamp(0.7rem, 2vh, 1.4rem)", paddingTop: "clamp(0.7rem, 2vh, 1.4rem)", borderTop: "1px solid var(--line)", animation: "memo-pop 0.24s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
      <span style={{ padding: "0.3rem 0.65rem", borderRadius: "999px", fontSize: "0.82rem", fontWeight: "800", color: "#ffffff", background: v.quizVerdictBg }}>{v.quizVerdict}</span>
      <span style={{ flex: "1 1 12rem", minWidth: "0", fontSize: "clamp(0.85rem, 2vh, 0.95rem)", fontWeight: "650", lineHeight: "1.4", color: "var(--muted)" }}>{v.c.quizExplain}</span>
      </div>
      </>) : null}
      </div>
      </div>
      </>) : null}
      {v.isTest ? (<>
      <div>
      <p style={SUBTITLE}>{v.subtitle}</p>
      <div style={{ ...CHIP, padding: "clamp(0.95rem, 2.8vh, 1.5rem) clamp(1.1rem, 3vw, 1.6rem)", borderRadius: "24px", boxShadow: "0 5px 0 var(--chip-ring)" }}>
      <span style={{ display: "block", color: "var(--muted)", fontSize: "clamp(0.84rem, 2vh, 0.96rem)", fontWeight: "600" }}>{v.c.testMeta}</span>
      <p style={{ margin: "0.45rem 0 clamp(0.6rem, 1.8vh, 1rem)", fontSize: "clamp(1rem, 2.6vh, 1.22rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.3", textWrap: "pretty" }}>{v.c.testQ}</p>
      <textarea value={v.testText} onChange={v.onTestType} placeholder={v.c.testPlaceholder} rows={3} style={{ width: "100%", boxSizing: "border-box", padding: "0.85rem 0.95rem", border: "2px solid var(--chip-ring)", borderRadius: "18px", background: "var(--bubble)", color: "var(--text)", fontFamily: "inherit", fontSize: "clamp(0.9rem, 2.2vh, 1rem)", fontWeight: "600", lineHeight: "1.5", resize: "none", outline: "none" }} />
      {v.testUngraded ? (<>
      <button type="button" onClick={v.gradeTest} disabled={v.cannotGrade} style={{ marginTop: "0.75rem", width: "100%", minHeight: "3.3rem", border: "0", borderRadius: "999px", fontFamily: "inherit", fontSize: "1.05rem", fontWeight: "900", letterSpacing: "0.03em", cursor: "pointer", boxShadow: `0 4px 0 color-mix(in oklch, ${v.accent} 62%, #000000)`, transition: "opacity 200ms ease, transform 170ms cubic-bezier(0.2,0.85,0.2,1)", background: v.accent, color: "#000000", opacity: v.gradeOpacity }} className="memo-ob-fx-6">{v.c.testGrade}</button>
      </>) : null}
      {v.testGraded ? (<>
      <div style={{ display: "grid", gap: "0.55rem", marginTop: "clamp(0.7rem, 2vh, 1.1rem)", paddingTop: "clamp(0.7rem, 2vh, 1.1rem)", borderTop: "1px solid var(--line)", animation: "memo-pop 0.24s cubic-bezier(0.22,1,0.36,1) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
      <span style={{ padding: "0.3rem 0.65rem", borderRadius: "999px", fontSize: "0.82rem", fontWeight: "850", color: "#000000", background: v.testScoreBg }}>{v.testScore}</span>
      <span style={{ fontSize: "0.9rem", fontWeight: "800" }}>{v.c.testMarked}</span>
      </div>
      <span style={{ fontSize: "clamp(0.85rem, 2vh, 0.95rem)", fontWeight: "650", lineHeight: "1.45", color: "var(--muted)" }}>{v.c.testFeedback}</span>
      </div>
      </>) : null}
      </div>
      </div>
      </>) : null}
      {v.isTutor ? (<>
      <div>
      <p style={SUBTITLE}>{v.subtitle}</p>
      {/* Inside the app, so it follows the app's saved appearance, not the OS alone. */}
      <LandingTutorDemo theme="app" onPhaseChange={onTutorPhase} />
      </div>
      </>) : null}
      {v.isAsk ? (<>
      <div style={{ display: "grid", gap: "clamp(0.6rem, 1.7vh, 0.95rem)", padding: "0.2rem 0 0.8rem" }}>
      {v.askBubbles.map((q) => (<Fragment key={q.key}>
      <div style={{ display: "flex", justifyContent: q.side, animation: `memo-drift 4.2s ease-in-out ${q.floatDelay} infinite` }}>
      <button type="button" onClick={v.onAsk} style={{ position: "relative", maxWidth: "86%", padding: "0.75rem 1.15rem", boxSizing: "border-box", border: `2px solid ${q.ring}`, borderRadius: "1.25rem", background: q.bg, color: q.ink, fontFamily: "inherit", fontSize: "clamp(0.98rem, 2.3vh, 1.1rem)", fontWeight: "800", lineHeight: "1.35", textAlign: "left", cursor: "pointer", transformOrigin: q.origin, animation: `memo-bubble-down 540ms cubic-bezier(0.22,1,0.36,1) ${q.delay} both` }} className="memo-ob-fx-9">
      <span aria-hidden="true" style={{ position: "absolute", bottom: "-0.56rem", left: q.tailL, right: q.tailR, width: "0.95rem", height: "0.95rem", boxSizing: "border-box", background: q.bg, borderRight: `2px solid ${q.ring}`, borderBottom: `2px solid ${q.ring}`, borderBottomRightRadius: "3px", transform: "rotate(45deg)" }}></span>
      <span style={{ position: "relative" }}>{q.text}</span>
      </button>
      </div>
      </Fragment>))}
      </div>
      </>) : null}
      {v.isTime ? (<>
      <div className="memo-ob-time">
      <p style={{ ...SUBTITLE, margin: "0 0 0.4rem" }}>{v.subtitle}</p>
      <div className="memo-ob-time-sky" style={{ background: v.sky.skyBg, transition: "background 800ms ease" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: "0", opacity: v.sky.starOpacity, transition: "opacity 800ms ease" }}>
      {SKY_STARS.map(([left, top, size], k) => <span key={k} style={{ position: "absolute", left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size}px`, borderRadius: "50%", background: "#ffffff", animation: `memo-twinkle 2.6s ease-in-out ${(k * 0.31).toFixed(2)}s infinite` }}></span>)}
      </div>
      <div className="memo-ob-time-orb" aria-hidden="true" style={{ position: "absolute", left: `clamp(0.9em, ${v.sky.orbX}%, calc(100% - 0.9em))`, top: `clamp(0.9em, ${50 + (v.sky.orbY - 36) * 0.3}%, calc(100% - 0.9em))`, width: "1em", aspectRatio: "1", transform: "translate(-50%, -50%)", transition: "left 560ms cubic-bezier(0.22,1,0.36,1), top 560ms cubic-bezier(0.22,1,0.36,1)" }}>
      <div style={{ position: "absolute", inset: "0", opacity: v.sky.rayOpacity, transition: "opacity 600ms ease", animation: "memo-spin 28s linear infinite" }}>
      {SUN_RAYS.map((deg, k) => <span key={deg} style={{ position: "absolute", left: "50%", top: "50%", width: "0.22rem", height: k % 2 === 0 ? "0.18em" : "0.11em", marginLeft: "-0.11rem", borderRadius: "999px", background: "#ffc83d", transform: `rotate(${deg}deg) translateY(${k % 2 === 0 ? "-0.7em" : "-0.6em"})` }}></span>)}
      </div>
      <div style={{ position: "absolute", inset: "0", borderRadius: "50%", background: v.sky.orbFill, boxShadow: v.sky.orbGlow, transition: "background 800ms ease, box-shadow 800ms ease" }}></div>
      </div>
      {SKY_CLOUDS.map((cloud) => (<Fragment key={cloud.top}>
      <div aria-hidden="true" style={{ position: "absolute", left: cloud.left, top: cloud.top, width: cloud.width, aspectRatio: "1.9", animation: `memo-ob-cloud-drift ${cloud.drift} linear ${cloud.delay} infinite` }}>
      <div style={{ position: "absolute", inset: "0", transform: `scale(${cloud.scale})`, filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.12))" }}>
      <span style={{ position: "absolute", left: "0", right: "0", bottom: "0", height: "50%", borderRadius: "999px", background: v.sky.cloudFill, transition: "background 700ms ease" }}></span>
      <span style={{ position: "absolute", left: "14%", bottom: "22%", width: "42%", aspectRatio: "1", borderRadius: "50%", background: v.sky.cloudFill, transition: "background 700ms ease" }}></span>
      <span style={{ position: "absolute", left: "40%", bottom: "12%", width: "50%", aspectRatio: "1", borderRadius: "50%", background: v.sky.cloudShade, transition: "background 700ms ease" }}></span>
      <span style={{ position: "absolute", left: "46%", bottom: "18%", width: "44%", aspectRatio: "1", borderRadius: "50%", background: v.sky.cloudFill, transition: "background 700ms ease" }}></span>
      </div>
      </div>
      </Fragment>))}
      </div>
      <div style={{ position: "relative", margin: "0.4rem 0 0.4rem", padding: "3.1rem 0 0.2rem" }}>
      <div style={{ ...CHIP, position: "relative", height: "1.15rem", margin: "0 0.2rem", borderRadius: "999px" }}>
      <div style={{ position: "absolute", top: "0", bottom: "0", left: "1rem", right: "1rem" }}>
      <div aria-hidden="true" style={{ position: "absolute", bottom: "calc(100% + 1.3rem)", left: `clamp(1.6rem, ${v.sky.hourPct}%, calc(100% - 1.6rem))`, transform: "translateX(-50%)", padding: "0.4rem 0.9rem", boxSizing: "border-box", border: "2px solid var(--chip-ring)", borderRadius: "0.95rem", background: "var(--bubble)", fontSize: "1.05rem", fontWeight: "900", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <span style={{ position: "absolute", left: "50%", bottom: "-0.5rem", width: "0.8rem", height: "0.8rem", marginLeft: "-0.4rem", boxSizing: "border-box", background: "var(--bubble)", borderRight: "2px solid var(--chip-ring)", borderBottom: "2px solid var(--chip-ring)", borderBottomRightRadius: "3px", transform: "rotate(45deg)" }}></span>
      <span style={{ position: "relative" }}>{v.hourLabel}</span>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", top: "50%", left: `${v.sky.hourPct}%`, width: "2.4rem", height: "2.4rem", boxSizing: "border-box", transform: "translate(-50%, -50%)", borderRadius: "50%", background: "var(--bg)", border: `3px solid ${v.accent}`, boxShadow: `0 3px 0 var(--chip-ring), 0 0 0 6px color-mix(in oklch, ${v.accent} 16%, transparent)` }}></div>
      </div>
      </div>
      <input type="range" min={STUDY_HOUR_MIN} max={STUDY_HOUR_MAX} step={1} value={v.studyHour} onChange={v.onHour} aria-label={v.c.timeTitle} aria-valuetext={v.hourLabel} style={{ position: "absolute", left: "0", right: "0", bottom: "-0.9rem", width: "100%", height: "3.2rem", margin: "0", opacity: "0", cursor: "grab" }} />
      </div>
      </div>
      </>) : null}
      {v.isLoading ? (<>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "clamp(0.5rem, 1.6vh, 1rem)", paddingTop: "0.6rem" }}>
      <SpeechBubble text={v.bubbleText} typed={v.tw} tail="down" style={{ maxWidth: "min(26rem, 100%)", margin: "0 0 0.6rem", padding: "clamp(0.85rem, 2.2vh, 1.1rem) clamp(1.1rem, 4vw, 1.5rem)", animation: "memo-bubble-down 560ms cubic-bezier(0.22,1,0.36,1) 150ms both" }} textStyle={{ fontSize: "clamp(1.2rem, min(5.4vw, 3.4vh), 1.65rem)", lineHeight: "1.3", textWrap: "balance" }} />
      <div style={{ position: "relative", flex: "0 0 auto", display: "grid", placeItems: "center", width: "min(9rem, 22vh)", height: "min(9rem, 22vh)", aspectRatio: "1" }}>
      <svg viewBox="0 0 100 100" aria-hidden="true" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
      <circle cx="50" cy="50" r="45" fill="none" stroke="var(--line-soft)" strokeWidth="3" />
      <circle cx="50" cy="50" r="45" fill="none" stroke={v.accent} strokeWidth="3" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={v.ringOffset} style={{ transition: "stroke-dashoffset 200ms linear" }} />
      </svg>
      <div ref={mascot.refs.loader} style={{ position: "relative", width: "58%", aspectRatio: "320 / 288", transformOrigin: "50% 92%" }}>
      {v.thinkIcon ? <MascotThought icon={v.thinkIcon} offset="0rem" scale={0.9} /> : null}
      <MascotSparkles />
      <div ref={mascot.refs.loaderBurst} aria-hidden="true" style={{ position: "absolute", left: "50%", top: "45%", width: "0", height: "0", pointerEvents: "none" }}></div>
      <div style={{ position: "absolute", inset: "0", animation: "memo-bob 4.2s ease-in-out infinite" }}>
      <MascotFigure priority />
      </div>
      </div>
      </div>
      <p style={{ margin: "0", fontSize: "clamp(0.86rem, 2.1vh, 0.98rem)", fontWeight: "600", color: "var(--muted)" }}>{v.loadingStage}</p>
      <div style={{ display: "grid", gap: "clamp(0.3rem, 1vh, 0.5rem)", width: "100%", maxWidth: "19rem", textAlign: "left" }}>
      {v.loadingRows.map((row) => (<Fragment key={row.label}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.15rem 0.1rem", transition: "opacity 300ms ease", opacity: row.opacity }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.25rem", height: "1.25rem", flex: "0 0 auto", borderRadius: "999px", fontSize: "0.68rem", fontWeight: "900", lineHeight: "1", color: "var(--on-ink)", transition: "background 300ms ease", background: row.dot, border: row.ring }}>{row.mark}</span>
      <span style={{ fontSize: "clamp(0.88rem, 2.1vh, 0.98rem)", fontWeight: "700", color: row.color }}>{row.label}</span>
      </div>
      </Fragment>))}
      </div>
      </div>
      </>) : null}
      {v.isDone ? (<>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "1rem", paddingTop: "1.2rem" }}>
      <SpeechBubble text={v.bubbleText} typed={v.tw} tail="down" style={{ maxWidth: "min(26rem, 100%)", margin: "0 0 0.6rem", padding: "clamp(0.85rem, 2.2vh, 1.1rem) clamp(1.1rem, 4vw, 1.5rem)", animation: "memo-bubble-down 560ms cubic-bezier(0.22,1,0.36,1) 300ms both" }} textStyle={{ fontSize: "clamp(1.2rem, min(5.4vw, 3.4vh), 1.65rem)", lineHeight: "1.3", textWrap: "balance" }} />
      <div style={{ position: "relative", width: "clamp(6.5rem, 20vh, 10rem)", aspectRatio: "320 / 288", marginBottom: "1.2rem" }}>
      <MascotPedestal hero />
      <MascotSparkles />
      <div ref={mascot.refs.doneBurst} aria-hidden="true" style={{ position: "absolute", left: "50%", top: "40%", width: "0", height: "0", zIndex: "2", pointerEvents: "none" }}></div>
      <div ref={mascot.refs.setDone} onClick={v.tapDone} aria-hidden="true" style={{ position: "absolute", inset: "0", transformOrigin: "50% 92%", cursor: "pointer" }}>
      <div style={{ position: "absolute", inset: "0", transformOrigin: "50% 94%", animation: "memo-breathe 3s ease-in-out infinite" }}>
      <MascotFigure lash={3} />
      </div>
      </div>
      <span aria-hidden="true" style={{ position: "absolute", right: "-6%", bottom: "0", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.2rem", height: "2.2rem", borderRadius: "999px", fontSize: "1.05rem", fontWeight: "900", color: "#000000", background: "#62d676", boxShadow: "0 0 0 3px var(--bg)", animation: "memo-pop 460ms cubic-bezier(0.2,0.9,0.2,1) 900ms both" }}>✓</span>
      </div>
      <p style={{ margin: "0", maxWidth: "24rem", fontSize: "1rem", fontWeight: "600", lineHeight: "1.45", color: "var(--muted)" }}>{v.c.doneSub}</p>
      </div>
      </>) : null}
      </div>
      </div>
      </main>
      <footer className="memo-onboarding-keyboard-footer" style={{ position: "fixed", left: "0", right: "0", zIndex: "6", boxSizing: "border-box", background: "linear-gradient(to top, var(--bg) 62%, transparent)", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.55rem", paddingTop: "clamp(0.7rem, 1.8vh, 1.1rem)", paddingInline: "clamp(1rem, 4vw, 2rem)" }}>
      {v.showCta ? (<>
      <button type="button" onClick={v.next} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", width: "100%", maxWidth: "34rem", minHeight: "clamp(3.1rem, 7.4vh, 3.6rem)", border: "0", borderRadius: "999px", fontFamily: "inherit", fontSize: "clamp(1rem, 2.3vh, 1.12rem)", fontWeight: "900", letterSpacing: "0.06em", cursor: v.ctaDisabled ? "default" : "pointer", background: v.ctaBg, color: v.ctaColor, boxShadow: `0 5px 0 ${v.ctaLip}`, transform: "translateY(0)", transition: "transform 120ms cubic-bezier(0.2,0.85,0.2,1), box-shadow 120ms ease, background-color 220ms ease, color 220ms ease" }} disabled={v.ctaDisabled || v.finishing} aria-busy={v.finishing} className="memo-ob-press-cta">{v.finishing ? <span aria-hidden="true" className="memo-spin" style={{ width: "1.05rem", height: "1.05rem", flex: "0 0 auto", boxSizing: "border-box", borderRadius: "999px", border: "2px solid currentColor", borderTopColor: "transparent" }} /> : null}<span className="memo-ob-cta-label">{v.ctaLabel}</span></button>
      </>) : null}
      <span style={{ fontSize: "0.76rem", fontWeight: "650", color: "var(--muted-2)", textAlign: "center" }}>{v.footNote}</span>
      </footer>
      {v.fileDragging ? (<>
      <div aria-hidden="true" style={{ position: "fixed", zIndex: "9", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.7rem", borderRadius: "14px", background: "var(--tile-hi)", boxShadow: "var(--shadow-lg)", pointerEvents: "none", transform: "translate3d(-50%, -50%, 0) rotate(-3deg)", left: `${v.ghostX}px`, top: `${v.ghostY}px` }}>
      <span style={{ fontSize: "1rem", lineHeight: "1" }}>{v.dragIcon}</span>
      <span style={{ fontSize: "0.84rem", fontWeight: "750", color: "var(--text)" }}>{v.dragName}</span>
      </div>
      </>) : null}
      </div>
      </div>
    </div>
  );
}
