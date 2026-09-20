"use client";

/*
 * The three images here are the brand mascot and lockup, sized with `clamp()`
 * against the viewport rather than at fixed intrinsic dimensions. `next/image`
 * wants the dimensions up front and would either pin them or need `fill` and a
 * positioned wrapper around each — both of which change the layout the design
 * specifies. They are small PNGs already in `public/`, so the plain tag stays.
 */
/* eslint-disable @next/next/no-img-element */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";

import { mapAppHrefForClient } from "@/lib/creator-demo/paths";

import { useTranslations } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/locales";
import { LandingTutorDemo } from "@/components/landing/landing-tutor-demo";
import type { ProfileRow } from "@/lib/database.types";
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
 * A port of the design canvas the flow was redrawn in, kept deliberately close
 * to it: every measurement, easing curve and animation below is the one the
 * artboard carries, which is why the styling is inline rather than in a
 * stylesheet — a number here can be diffed against the design file line for
 * line. Only the two things an inline style cannot express live in
 * `onboarding.css`: the keyframes, and the hover/active rules the canvas wrote
 * as `style-hover` / `style-active`.
 *
 * What is deliberately NOT the design's own is anything it duplicated from the
 * app: the option lists come from `onboarding-options.ts`, the wording from the
 * message catalogues, and the tutor's voices and their hues from the real
 * tutor. The design file had its own copies of all three, and one of them —
 * the feature list — had drifted out of order, so every label on that step
 * named the option above it.
 */

/** The accent the design ships with: the head of the app's own coral. */
const ACCENT = "#ff6d68";

/** Above this the aside with the running summary appears beside the question. */
const WIDE_QUERY = "(min-width: 980px)";

/** Below this the proof list drops its last two rows and the reviews drop to one. */
const ROOMY_QUERY = "(min-height: 760px)";

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
 * column, and the list runs off the bottom of a screen that cannot scroll: 62px
 * of the subject step and 217px of the feature step were simply unreachable at
 * 375x812. Capping the floor at just under half the container keeps the design's
 * own track width wherever it fits and goes two-up where it does not.
 */
const WRAPPING_COLUMNS = "repeat(auto-fit, minmax(min(11rem, 47%), 1fr))";

/*
 * How much of a tile the icon, the gap and the padding are allowed to take.
 *
 * A one-per-row step has a whole screen width to spend, and the design's
 * numbers are right for it. The two steps that go multi-column do not: on a
 * 390px phone each tile is 174px wide, and the design's 0.95rem padding, 2.5rem
 * icon and 0.8rem gap leave the label 92px — narrower than the single word
 * "Personalizacija", which is 118px, so the word had nowhere to go but out
 * through the side of its own tile. Trimming the chrome gives the label 120px,
 * which is enough for the longest word in any of the five languages to sit on a
 * line of its own.
 */
const OPTION_CHROME = {
  single: { padding: "0.95rem", icon: "clamp(1.55rem, 4.6vh, 2.5rem)", gap: "0.8rem" },
  columns: { padding: "0.6rem", icon: "clamp(1.4rem, 4vh, 1.75rem)", gap: "0.4rem" },
} as const;

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
  { id: "classFocus", kind: "q", key: "classFocus", qk: "qFocus", sk: "subFocus", cols: "1fr" },
  { id: "dailyGoal", kind: "q", key: "dailyGoal", qk: "qGoal", sk: "subGoal", cols: "1fr" },
  { id: "testimonial", kind: "testimonial" },
  { id: "progress", kind: "chart", when: "student" },
  { id: "personalizing", kind: "loading" },
  { id: "done", kind: "done" },
];

/**
 * The three answers the redesign asks for with a brand mark rather than an
 * emoji, drawn exactly as the design file draws them — the Instagram glyph in
 * particular is a stroked outline there, not the filled lucide one the old
 * survey used.
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
  { v: "audio", name: "lecture-04.m4a", ext: "M4A", meta: "srcFileAudio", i: "🎙️" },
  { v: "pdf", name: "mitosis-slides.pdf", ext: "PDF", meta: "srcFilePdf", i: "📄" },
  { v: "photo", name: "notebook-page.jpg", ext: "JPG", meta: "srcFilePhoto", i: "📷" },
  { v: "link", name: "khan-mitosis", ext: "URL", meta: "srcFileLink", i: "🔗" },
] as const satisfies readonly { v: string; name: string; ext: string; meta: CopyKey; i: string }[];

const QUIZ_OPTIONS = [
  { v: "prophase", l: "quizOptA" },
  { v: "metaphase", l: "quizOptB" },
  { v: "anaphase", l: "quizOptC" },
  { v: "telophase", l: "quizOptD" },
] as const satisfies readonly { v: string; l: CopyKey }[];

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
  "proofTop", "proofRating", "rowQuizCards", "rowTests", "rowTutor", "rowPodcast",
  "rowPalace", "rowNotes", "rowSpeed", "srcTitle", "srcSub", "srcAudio",
  "srcPdf", "srcPhoto", "srcLink", "srcStage1", "srcStage2", "srcStage3",
  "srcStage4", "srcNoteTitle", "srcNoteMeta", "flashTitle", "flashSub", "flashHint",
  "flashHintBack", "deckDone", "ofWord", "quizTitle", "quizSub", "quizMeta",
  "quizQ", "quizRight", "quizWrong", "quizExplain", "testTitle", "testSub",
  "testMeta", "testQ", "testPlaceholder", "testGrade", "testMarked", "testFeedback",
  "tutorTitle", "tutorSub", "tutorListen", "tutorSpeaking", "tutorReplay", "tutorScript",
  "chartKicker", "chartIn12", "chartNow", "chart6", "chart12", "chartFoot",
  "reviewStudents", "reviewOthers", "reviewVerified", "yearsOld", "loadTitle", "loadReady",
  "loadRow1", "loadRow2", "loadRow3", "doneTitle", "doneSub", "qHeard",
  "qAudience", "qRole", "qSchool", "qYear", "qYearElem", "qSubject",
  "qMotivation", "qFeature", "qFocus", "qGoal", "qGradeNow", "qGradeNowSub",
  "qGradeTarget", "proofTitle", "chartTitle", "chartSub", "chartWith", "chartAlone",
  "ctaContinue", "asideTitle", "asideFoot", "dropIdle", "dropOver", "srcTapHint",
  "tutorSlowerLabel", "tutorNormalLabel", "tutorAgainLabel", "deckCompleted", "deckRoundCompleted", "deckAllDone",
  "deckRepeatMissed", "deckSetCompleted", "deckRoundScore", "deckCorrect", "deckRestart", "deckRepeatBtn",
  "reviewQuote1", "reviewQuote2", "reviewQuote3", "reviewMeta1", "reviewMeta2", "reviewMeta3",
  "reviewQuote4", "reviewQuote5", "reviewQuote6", "reviewMeta4", "reviewMeta5", "reviewMeta6",
  "tutorStart", "tutorStop", "loadWorking", "sumYouAre", "sumYear", "sumField",
  "sumGoal", "sumFirst", "sumDaily", "flashQ1", "flashA1", "flashQ2",
  "flashA2", "flashQ3", "flashA3", "srcFileAudio", "srcFilePdf", "srcFilePhoto",
  "srcFileLink", "quizOptA", "quizOptB", "quizOptC", "quizOptD", "srcBody", "chartAria",
] as const;

type CopyKey = (typeof COPY_KEYS)[number];
type Copy = Record<CopyKey, string>;

type FlowState = {
  stepId: string;
  fade: number;
  shift: number;
  wide: boolean;
  roomy: boolean;
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
  cycle: number;
  queue: number[];
  answers: Record<number, "easy" | "again">;
  testText: string;
  testGraded: boolean;
  gradeScale: number;
  form: OnboardingForm;
};

const INITIAL_STATE: FlowState = {
  stepId: "welcome",
  fade: 1,
  shift: 0,
  wide: false,
  roomy: true,
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
  cycle: 1,
  queue: START_QUEUE,
  answers: {},
  testText: "",
  testGraded: false,
  gradeScale: 1,
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
  },
};

export function OnboardingFlow({
  profile,
  demo = false,
  anonymous = false,
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
  const [gradeTouched, setGradeTouched] = useState({
    currentAverageGrade: false,
    targetGrade: false,
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const timers = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const intervals = useRef<Record<string, ReturnType<typeof setInterval> | undefined>>({});
  const raf = useRef(0);
  const dropEl = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ width: 353, from: 0, moved: false, lastDx: 0 });
  const fileDrag = useRef({ startX: 0, startY: 0, moved: false });
  const saving = useRef(false);
  const saved = useRef(false);

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

  /*
   * The bar is read against the whole flow, not against the path the current
   * answers cut out of it.
   *
   * Measuring the cut path is what the design does, and it means the bar
   * jumps backwards: the first screen sizes itself against the 17 steps
   * someone who is not a student walks, because no role has been picked yet,
   * and then restates itself against 23 the moment a student picks one.
   * Against the whole flow the bar only ever moves forward, and always ends
   * full. A branch that skips steps shows up as a longer jump, which is what
   * skipping questions should look like.
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
   * server. Either can finish first — the ring takes two to four seconds and a
   * save on a bad connection can take longer — so whichever finishes last is
   * the one that moves the flow on. Asking once, at the end of the beat,
   * stranded anyone whose save had not come back yet on a screen that says
   * "your plan is ready" and carries no button at all.
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
      setState((current) => {
        const next = Math.min(100, current.pct + Math.round(3 + Math.random() * 7));

        if (next >= 100) {
          clearLoop("load");
          clearTimer("loadDone");
          timers.current.loadDone = setTimeout(() => {
            loaderSettled.current = true;
            finishLoadingRef.current();
          }, 900);
        }

        return { ...current, pct: next };
      });
    }, 190);
  }, [patch, submit]);

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
      clearTimer("go");
      clearTimer("select");
      clearTimer("reveal");
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

      clearTimer("select");
      timers.current.select = setTimeout(() => goRef.current(1), 300);
    },
    [],
  );

  const nudge = useCallback(
    (key: "currentAverageGrade" | "targetGrade", direction: number) => {
      setGradeTouched((current) => ({ ...current, [key]: true }));
      setState((current) => {
        const { min, max, step: size } = gradeBounds(current.form.schoolLevel);
        const raw = current.form[key] + direction * size;
        const value = Math.round(Math.min(max, Math.max(min, raw)) * 10) / 10;

        return { ...current, form: { ...current.form, [key]: value }, gradeScale: 1.14 };
      });
      clearTimer("grade");
      timers.current.grade = setTimeout(() => patch({ gradeScale: 1 }), 170);
    },
    [patch],
  );

  const pickSource = useCallback(
    (v: string) => {
      if (stateRef.current.source) {
        return;
      }

      patch({ source: v, srcPct: 0 });
      clearLoop("src");
      intervals.current.src = setInterval(() => {
        setState((current) => {
          const next = Math.min(100, current.srcPct + Math.round(4 + Math.random() * 9));

          if (next >= 100) {
            clearLoop("src");
            clearTimer("srcDone");
            timers.current.srcDone = setTimeout(() => {
              if (stateRef.current.stepId === "trySource" && stateRef.current.source) {
                goRef.current(1);
              }
            }, 700);
          }

          return { ...current, srcPct: next };
        });
      }, 130);
    },
    [patch],
  );

  /**
   * The card throw, with the app's own numbers: 120px of travel is a full
   * verdict, the tilt tops out at 8 degrees, and the release threshold scales
   * with the card between 88 and 150px so it feels the same at any size.
   */
  const swipeCard = useCallback((answer: "easy" | "again") => {
    setState((current) => {
      if (current.exitDir) {
        return current;
      }

      if (Math.abs(drag.current.lastDx) < 5) {
        drag.current.lastDx = drag.current.width * 0.34 * (answer === "easy" ? 1 : -1);
      }

      const pos = current.cardPos;
      const card = CARDS[current.queue[Math.min(pos, current.queue.length - 1)]];

      // The answer is recorded and the deck advances in the same commit that
      // starts the exit, so the card under the finger is already the next
      // question while a clone carries the old one off.
      return {
        ...current,
        answers: { ...current.answers, [pos]: answer },
        dragging: false,
        dragX: 0,
        flipped: false,
        cardPos: Math.min(current.queue.length, pos + 1),
        exitDir: answer === "easy" ? 1 : -1,
        exitQ: card ? card.q : "",
        exitDx: drag.current.lastDx,
        exitToken: current.exitToken + 1,
      };
    });

    clearTimer("exit");
    timers.current.exit = setTimeout(() => patch({ exitDir: 0 }), 185);
  }, [patch]);

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

      const move = (moveEvent: PointerEvent) => {
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
        window.removeEventListener("pointermove", move);
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

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [patch, pickSource],
  );

  const ctaDisabled = (() => {
    if (kind === "loading") {
      return !saveError;
    }

    if (kind === "source" || kind !== "q") {
      return false;
    }

    return !form[step.key as keyof OnboardingForm];
  })();

  useEffect(() => {
    const wide = window.matchMedia(WIDE_QUERY);
    const roomy = window.matchMedia(ROOMY_QUERY);
    const sync = () => patch({ wide: wide.matches, roomy: roomy.matches });

    sync();
    wide.addEventListener("change", sync);
    roomy.addEventListener("change", sync);

    return () => {
      wide.removeEventListener("change", sync);
      roomy.removeEventListener("change", sync);
    };
  }, [patch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      // The practice-test step has a real textarea in it, and Enter there is a
      // new line rather than a request for the next screen.
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
        // A question step has no button — picking an option is what advances it
        // — so Enter goes on to the next step once one has been picked.
        if (active.kind === "q") {
          if (current.form[active.key!]) {
            goRef.current(1);
          }

          return;
        }

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

    return () => {
      Object.values(runningTimers).forEach((id) => id !== undefined && clearTimeout(id));
      Object.values(runningLoops).forEach((id) => id !== undefined && clearInterval(id));
      cancelAnimationFrame(raf.current);
    };
  }, []);

  /*
   * What the call to action does, named rather than written into the view, so
   * that the keyboard can press the button rather than approximate it.
   *
   * Approximating it was wrong in both directions: Enter used to advance a step
   * directly, which does nothing at all on the last screen — there is no step
   * after it, so the one button in the flow that leaves it was the one button
   * the keyboard could not press — and it was also refused on the loading step,
   * where the button, when it is there at all, is the retry after a failed save.
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

  const soft = accentRgba(0.14);

  const options = (kind === "q" ? optionsFor(step) : []).map((option) => {
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
      bg: on ? soft : "var(--surface)",
      glow: on
        ? `inset 0 0 0 1.5px ${ACCENT}, var(--shadow)`
        : "inset 0 0 0 1px var(--line)",
      lift: on ? "-2px" : "0px",
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
    const x1 = 312;
    const yTop = 24;
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
  const missed = queue.map((_, k) => k).filter((k) => state.answers[k] === "again");
  const deckKnown = queue.length - missed.length;
  const deckPct = missed.length === 0 ? 100 : Math.round((deckKnown / queue.length) * 100);
  const activeCard = CARDS[queue[Math.min(state.cardPos, queue.length - 1)]] ?? CARDS[0];
  const nextCard = CARDS[queue[state.cardPos + 1]];

  const chrome = step.cols === WRAPPING_COLUMNS ? OPTION_CHROME.columns : OPTION_CHROME.single;

  const showCta = (kind !== "loading" || Boolean(saveError)) && kind !== "q";

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
   * walk the same journey — it rewrites the destination to `/creator/start`,
   * where the same upgrade screen is mounted against demo props.
   *
   * Answered anonymously, the same button opens sign-in instead. `/app/start`
   * is still where it ends up — that is where `/auth/continue` sends everyone —
   * and the answers are waiting there, claimed out of the cookie by the time
   * the page decides which half to show.
   */
  const finish = () => {
    router.push(anonymous ? "/auth/continue" : mapAppHrefForClient("/app/start"));
    router.refresh();
  };

  ctaRef.current = { press: pressCta, enabled: showCta && !ctaDisabled };

  const v = {
    accent: ACCENT,
    c,
    wide: state.wide,
    roomy: state.roomy,
    fade: state.fade,
    shift: state.shift,
    progressPct: Math.round((shownIndex / (STEPS.length - 1)) * 100),
    title: step.qk ? c[step.qk] : "",
    subtitle: step.sk ? c[step.sk] : "",
    gridCols: step.cols || "1fr",
    optionPad: chrome.padding,
    optionIcon: chrome.icon,
    optionGap: chrome.gap,
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

    flipped: state.flipped,
    flipDeg: state.flipped ? "180deg" : "0deg",
    flipEase: state.exitDir ? "none" : "transform 0.36s cubic-bezier(0.22,1,0.36,1)",

    reviewTitle: student ? c.reviewStudents : c.reviewOthers,
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

    quizOptions: QUIZ_OPTIONS.map((option, k) => {
      const right = option.v === "metaphase";
      const chosen = state.quizPick === option.v;
      const revealed = Boolean(state.quizPick);
      const good = revealed && right;
      const bad = revealed && chosen && !right;

      return {
        value: option.v,
        label: c[option.l],
        letter: ["A", "B", "C", "D"][k],
        bg: good ? "rgba(34,197,94,0.10)" : bad ? "rgba(255,59,48,0.08)" : "var(--sunken)",
        ring: good ? "#22c55e" : bad ? "#ff3b30" : "transparent",
        color: good ? "#22c55e" : bad ? "#ff3b30" : "var(--text)",
        badgeBg: good ? "#22c55e" : bad ? "#ff3b30" : "var(--line-soft)",
        badgeColor: good || bad ? "#ffffff" : "var(--muted)",
        onPick: () => {
          if (stateRef.current.quizPick) {
            return;
          }

          patch({ quizPick: option.v });
        },
      };
    }),
    quizAnswered: Boolean(state.quizPick),
    quizVerdict: state.quizPick === "metaphase" ? c.quizRight : c.quizWrong,
    quizVerdictBg: state.quizPick === "metaphase" ? "#22c55e" : "#ff3b30",

    files: DEMO_FILES.map((file) => ({
      name: file.name,
      ext: file.ext,
      meta: c[file.meta],
      icon: file.i,
      lifted: state.fileDrag && state.fileDrag.v === file.v ? 0.35 : 1,
      onDown: (event: ReactPointerEvent<HTMLDivElement>) => fileDown(file.v, event),
    })),
    fileDragging: Boolean(state.fileDrag),
    ghostX: state.fileDrag ? state.fileDrag.x : 0,
    ghostY: state.fileDrag ? state.fileDrag.y : 0,
    dragName: state.fileDrag
      ? DEMO_FILES.find((f) => f.v === state.fileDrag?.v)?.name ?? ""
      : "",
    dragIcon: state.fileDrag ? DEMO_FILES.find((f) => f.v === state.fileDrag?.v)?.i ?? "" : "",
    dropRef: dropEl,
    dropBg: state.over ? accentRgba(0.12) : "transparent",
    dropRing: state.over ? ACCENT : "var(--line)",
    dropScale: state.over ? 1.008 : 1,
    dropLabel: state.over ? c.dropOver : c.dropIdle,
    sourceIdle: !state.source,
    srcWorking: Boolean(state.source),
    srcPct: state.srcPct,
    srcStage:
      state.srcPct < 35
        ? c.srcStage1
        : state.srcPct < 70
          ? c.srcStage2
          : state.srcPct < 100
            ? c.srcStage3
            : c.srcStage4,
    srcBody: c.srcBody,

    testText: state.testText,
    onTestType: (event: { target: { value: string } }) => patch({ testText: event.target.value }),
    testGraded: state.testGraded,
    testUngraded: !state.testGraded,
    gradeTest: () => patch({ testGraded: true }),
    cannotGrade: state.testText.trim().length <= 2,
    gradeOpacity: state.testText.trim().length <= 2 ? 0.45 : 1,
    testScore: state.testText.toLowerCase().includes("metaphase") ? "4 / 4" : "3 / 4",
    testScoreBg: state.testText.toLowerCase().includes("metaphase") ? "#22c55e" : "#ffcc4d",

    cardQ: c[activeCard.q],
    cardA: c[activeCard.a],
    hasNext: state.cardPos + 1 < queue.length,
    nextQ: nextCard ? c[nextCard.q] : "",
    cardCounter: `${Math.min(state.cardPos + 1, queue.length)} ${c.ofWord} ${queue.length}`,
    cardsLeft: state.cardPos < queue.length,
    cardsDone: state.cardPos >= queue.length,
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

    deckEmoji: deckPct >= 70 ? "🎉" : "💪",
    deckTint: deckPct >= 70 ? "#2aa34a" : "#f45f5a",
    deckTintSoft: deckPct >= 70 ? "rgba(42,163,74,0.18)" : "rgba(244,95,90,0.18)",
    deckPct,
    deckEyebrow: missed.length === 0 ? c.deckCompleted : c.deckRoundCompleted.replace("{n}", String(state.cycle)),
    deckTitle: missed.length === 0 ? c.deckAllDone : c.deckRepeatMissed,
    deckScoreLabel: missed.length === 0 ? c.deckSetCompleted : c.deckRoundScore,
    deckRatio: `${deckKnown}/${queue.length}`,
    deckActionLabel: missed.length === 0 ? c.deckRestart : c.deckRepeatBtn.replace("{n}", String(missed.length)),
    deckAction: () =>
      setState((current) => ({
        ...current,
        /* A clean round restarts the set; anything missed becomes the next round. */
        queue: missed.length === 0 ? START_QUEUE : missed.map((k) => queue[k]),
        cardPos: 0,
        answers: {},
        flipped: false,
        dragX: 0,
        exitDir: 0,
        cycle: missed.length === 0 ? 1 : current.cycle + 1,
      })),

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

    loadingTitle: state.pct >= 100 ? c.loadReady : c.loadTitle,
    ringOffset: 100 - state.pct,
    loadingStage: state.pct >= 100 ? c.loadReady : c.loadWorking.replace("{n}", String(state.pct)),
    loadingRows: loaderRows,

    next: pressCta,
    back: () => go(-1),
    backDisabled: index === 0,
    backState: index === 0 ? "off" : "on",
    /* Single-select steps advance on tap, so a Continue button would be a
       second control for something already done. Only the steps with nothing
       to pick keep one. */
    showCta,
    ctaLabel: kind === "loading" ? t("common.retry") : ctaLabels[kind] ?? c.ctaContinue,
    ctaDisabled,
    ctaOpacity: ctaDisabled ? 0.45 : 1,
    ctaBg: "var(--ink)",
    ctaColor: "var(--on-ink)",
    ctaGlow: "var(--shadow)",
    footNote:
      kind === "loading" ? saveError ?? c.footLoading : kind === "done" ? c.footDone : "",
  };

  return (
    <div className="memo-onboarding-v2">
      <div style={{ position: "relative", height: "100%", minHeight: "100%", maxHeight: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)", overflow: "hidden", boxSizing: "border-box", background: "var(--bg)", color: "var(--text)", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Segoe UI', sans-serif", WebkitFontSmoothing: "antialiased" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: "-10%", gridArea: "1 / 1 / 3 / 2", pointerEvents: "none", backgroundImage: "radial-gradient(58% 44% at 18% 10%, var(--mesh-lift) 0%, transparent 68%), radial-gradient(48% 38% at 84% 20%, var(--mesh-sink) 0%, transparent 64%), radial-gradient(54% 40% at 32% 44%, var(--mesh-lift) 0%, transparent 66%), radial-gradient(64% 46% at 90% 60%, var(--mesh-sink) 0%, transparent 62%), radial-gradient(50% 42% at 8% 76%, var(--mesh-lift) 0%, transparent 66%), radial-gradient(60% 44% at 64% 94%, var(--mesh-sink) 0%, transparent 64%)", opacity: "var(--mesh-opacity, 1)", animation: "memo-aurora 40s ease-in-out infinite" }}></div>
      <header style={{ position: "relative", zIndex: "2", gridRow: "1", display: "flex", alignItems: "center", gap: "0.85rem", padding: "max(0.7rem, env(safe-area-inset-top)) clamp(1rem, 4vw, 2rem) clamp(0.5rem, 1.4vh, 0.9rem)" }}>
      <button type="button" onClick={v.back} aria-label={t("onboarding.previousStep")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.4rem", height: "2.4rem", flex: "0 0 auto", padding: "0", border: "0", borderRadius: "999px", background: "var(--line-soft)", color: "var(--text)", fontSize: "1.35rem", lineHeight: "1", cursor: "pointer", transition: "transform 160ms cubic-bezier(0.2,0.8,0.2,1), background-color 160ms ease, opacity 200ms ease" }} data-back={v.backState} disabled={v.backDisabled} className="memo-ob-fx-1"><span aria-hidden="true" style={{ display: "block", width: "0.55rem", height: "0.55rem", marginLeft: "0.16rem", borderLeft: "2px solid currentColor", borderBottom: "2px solid currentColor", borderRadius: "1px", transform: "rotate(45deg)" }}></span></button>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.progressPct} aria-label={t("onboarding.progressLabel")} style={{ flex: "1 1 auto", minWidth: "0", height: "0.4rem", borderRadius: "999px", background: "var(--track)", overflow: "hidden" }}>
      <div style={{ height: "100%", borderRadius: "999px", transition: "width 480ms cubic-bezier(0.2,0.85,0.2,1)", position: "relative", overflow: "hidden", width: `${v.progressPct}%`, background: v.accent }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: "0", width: "40%", background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.55), rgba(255,255,255,0))", animation: "memo-shimmer 2.4s ease-in-out infinite" }}></div>
      </div>
      </div>
      </header>
      <div style={{ position: "relative", zIndex: "2", gridRow: "2", minHeight: "0", overflow: "hidden", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(1.5rem, 5vw, 4rem)", padding: "clamp(0.4rem, 1.4vh, 1.6rem) clamp(1rem, 4vw, 2rem) clamp(4.4rem, 12vh, 5.6rem)" }}>
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
      <main style={{ flex: "1 1 30rem", maxWidth: "34rem", width: "100%", minHeight: "0", maxHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ minHeight: "0", maxHeight: "100%", transition: "opacity 200ms ease, transform 260ms cubic-bezier(0.2,0.85,0.2,1)", opacity: v.fade, transform: `translate3d(${v.shift}px, 0, 0)` }}>
      {v.isWelcome ? (<>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "1.1rem", paddingTop: "1.4rem" }}>
      <img src="/memo-mascot.png" alt="" fetchPriority="high" decoding="sync" style={{ width: "clamp(5.5rem, min(34vw, 19vh), 12rem)", maxHeight: "24vh", height: "auto", objectFit: "contain", display: "block", animation: "memo-bob 5s ease-in-out infinite", filter: "drop-shadow(0 22px 40px rgba(0,0,0,0.35))" }} />
      <h1 style={{ margin: "0", fontSize: "clamp(2rem, 7vw, 3rem)", fontWeight: "850", lineHeight: "1.05", letterSpacing: "-0.03em", textWrap: "pretty" }}>{v.c.welcomeTitle}</h1>
      <p style={{ margin: "0", maxWidth: "26rem", fontSize: "clamp(1rem, 3.6vw, 1.12rem)", fontWeight: "600", lineHeight: "1.45", color: "var(--muted)", textWrap: "pretty" }}>{v.c.welcomeSub}</p>
      </div>
      </>) : null}
      {v.isQuestion ? (<>
      <div>
      <h1 style={{ margin: "0 0 clamp(0.2rem, 0.6vh, 0.4rem)", fontSize: "clamp(1.15rem, min(5.6vw, 4.4vh), 2.15rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.025em", textWrap: "pretty" }}>{v.title}</h1>
      <p style={{ margin: "0 0 clamp(0.4rem, 1.6vh, 1.15rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", lineHeight: "1.45", color: "var(--muted)" }}>{v.subtitle}</p>
      <div style={{ display: "grid", gap: "clamp(0.35rem, 1.1vh, 0.6rem)", gridTemplateColumns: v.gridCols }}>
      {v.options.map((item) => (<Fragment key={item.value}>
      <button type="button" onClick={item.onSelect} aria-pressed={item.selected} style={{ display: "flex", alignItems: "center", gap: v.optionGap, width: "100%", minHeight: "clamp(2.35rem, 7vh, 3.9rem)", padding: `clamp(0.3rem, 1.2vh, 0.8rem) ${v.optionPad}`, border: "0", borderRadius: "clamp(0.85rem, 2.4vh, 1.15rem)", color: "var(--text)", textAlign: "left", cursor: "pointer", fontFamily: "inherit", transition: "transform 180ms cubic-bezier(0.2,0.85,0.2,1), background-color 200ms ease, box-shadow 240ms ease", background: item.bg, boxShadow: item.glow, transform: `translateY(${item.lift})` }} className="memo-ob-fx-2">
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: v.optionIcon, height: v.optionIcon, flex: "0 0 auto", borderRadius: "0.8rem", background: "var(--tile)", color: "var(--text)", fontSize: "clamp(0.95rem, 2.3vh, 1.2rem)", lineHeight: "1" }}>
      {item.noMark ? (<>{item.icon}</>) : null}
      {item.hasMark ? (<>
      <svg viewBox={item.vb} aria-hidden="true" style={{ width: "64%", height: "64%", display: "block" }}><path d={item.d} fill={item.svgFill} stroke={item.svgStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </>) : null}
      </span>
      <span style={{ flex: "1 1 auto", minWidth: "0", display: "grid", gap: "0.15rem", overflowWrap: "anywhere" }}>
      <span style={{ fontSize: "clamp(0.88rem, 2.2vh, 1rem)", fontWeight: "750", lineHeight: "1.2" }}>{item.label}</span>
      {item.desc ? (<>
      <span style={{ fontSize: "clamp(0.7rem, 1.7vh, 0.82rem)", fontWeight: "600", lineHeight: "1.3", color: "var(--muted)" }}>{item.desc}</span>
      </>) : null}
      </span>
      {item.selected ? (<>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.5rem", height: "1.5rem", flex: "0 0 auto", borderRadius: "999px", color: "#000000", fontSize: "0.8rem", fontWeight: "900", animation: "memo-pop 320ms cubic-bezier(0.2,0.9,0.2,1) both", background: v.accent }}>✓</span>
      </>) : null}
      </button>
      </Fragment>))}
      </div>
      </div>
      </>) : null}
      {v.isGrade ? (<>
      <div>
      <h1 style={{ margin: "0 0 clamp(0.2rem, 0.6vh, 0.4rem)", fontSize: "clamp(1.15rem, min(5.6vw, 4.4vh), 2.15rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.025em", textWrap: "pretty" }}>{v.title}</h1>
      <p style={{ margin: "0 0 clamp(0.7rem, 2vh, 1.4rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", color: "var(--muted)" }}>{v.subtitle}</p>
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
      <h1 style={{ margin: "0 0 0.4rem", fontSize: "clamp(1.3rem, min(6vw, 4.6vh), 2.2rem)", fontWeight: "850", lineHeight: "1.08", letterSpacing: "-0.025em" }}>{v.c.proofTitle}</h1>
      <p style={{ margin: "0 0 clamp(0.4rem, 1.6vh, 1.15rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", color: "var(--muted)" }}>{v.c.proofSub}</p>
      <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0 0.15rem clamp(0.45rem, 1.3vh, 0.7rem)" }}>
      <span style={{ fontSize: "0.7rem", fontWeight: "850", letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--muted-2)" }}>{v.c.proofHeader}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", fontWeight: "750", color: "var(--muted)" }}><span aria-hidden="true" style={{ width: "0.42rem", height: "0.42rem", borderRadius: "999px", background: "#62d676", boxShadow: "0 0 0 3px rgba(98,214,118,0.18)" }}></span>{v.c.proofLive}</span>
      </div>
      <div style={{ display: "grid" }}>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 70ms both" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>🃏</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: "800", color: "var(--text)" }}>{v.c.rowQuizCards}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>91%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: "91%", height: "100%", borderRadius: "999px", opacity: "1", transformOrigin: "left", animation: "memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) 240ms both", background: v.accent }}></span>
      </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", borderTop: "1px solid var(--line-soft)", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 140ms both" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>✅</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: "700", color: "var(--text)" }}>{v.c.rowTests}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>83%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: "83%", height: "100%", borderRadius: "999px", opacity: "0.9", transformOrigin: "left", animation: "memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) 310ms both", background: v.accent }}></span>
      </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", borderTop: "1px solid var(--line-soft)", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 210ms both" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>🎙️</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: "700", color: "var(--text)" }}>{v.c.rowTutor}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>74%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: "74%", height: "100%", borderRadius: "999px", opacity: "0.8", transformOrigin: "left", animation: "memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) 380ms both", background: v.accent }}></span>
      </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", borderTop: "1px solid var(--line-soft)", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 280ms both" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>📻</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: "700", color: "var(--text)" }}>{v.c.rowPodcast}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>66%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: "66%", height: "100%", borderRadius: "999px", opacity: "0.7", transformOrigin: "left", animation: "memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) 450ms both", background: v.accent }}></span>
      </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", borderTop: "1px solid var(--line-soft)", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 350ms both" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>🏛️</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: "700", color: "var(--text)" }}>{v.c.rowPalace}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>58%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: "58%", height: "100%", borderRadius: "999px", opacity: "0.6", transformOrigin: "left", animation: "memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) 520ms both", background: v.accent }}></span>
      </span>
      </div>
      {v.roomy ? (<>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", borderTop: "1px solid var(--line-soft)", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 420ms both" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>📝</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: "700", color: "var(--text)" }}>{v.c.rowNotes}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>42%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: "42%", height: "100%", borderRadius: "999px", opacity: "0.5", transformOrigin: "left", animation: "memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) 590ms both", background: v.accent }}></span>
      </span>
      </div>
      </>) : null}
      {v.roomy ? (<>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(1.6rem, 3.9vh, 2.1rem) minmax(0, 1fr) auto", alignItems: "center", columnGap: "0.7rem", rowGap: "clamp(0.25rem, 0.7vh, 0.4rem)", padding: "clamp(0.3rem, 1vh, 0.62rem) 0.15rem", borderTop: "1px solid var(--line-soft)", animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) 490ms both" }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "clamp(1.6rem, 3.9vh, 2.1rem)", height: "clamp(1.6rem, 3.9vh, 2.1rem)", borderRadius: "0.62rem", background: "var(--tile)", fontSize: "clamp(0.85rem, 2vh, 1rem)", lineHeight: "1" }}>⚡</span>
      <span style={{ minWidth: "0", display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.95rem", fontWeight: "700", color: "var(--text)" }}>{v.c.rowSpeed}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: "850", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>29%</span>
      <span style={{ gridColumn: "2 / -1", height: "0.34rem", borderRadius: "999px", background: "var(--line-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", width: "29%", height: "100%", borderRadius: "999px", opacity: "0.42", transformOrigin: "left", animation: "memo-grow 950ms cubic-bezier(0.2,0.85,0.2,1) 660ms both", background: v.accent }}></span>
      </span>
      </div>
      </>) : null}
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
      <h1 style={{ margin: "0 0 1.2rem", fontSize: "clamp(1.3rem, min(6vw, 4.6vh), 2.2rem)", fontWeight: "850", lineHeight: "1.08", letterSpacing: "-0.025em" }}>{v.reviewTitle}</h1>
      <div style={{ display: "grid" }}>
      {v.reviewList.map((rev) => (<Fragment key={rev.name}>
      <figure style={{ margin: "0", padding: "clamp(0.45rem, 1.5vh, 1.05rem) 0.15rem", borderTop: `1px solid ${rev.rule}`, animation: "memo-rise 400ms cubic-bezier(0.2,0.85,0.2,1) both" }}>
      <div aria-label={t("onboarding.testimonial.stars")} style={{ display: "flex", gap: "0.14rem" }}><span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.1rem", height: "1.1rem", borderRadius: "3px", background: "#00b67a", color: "var(--text)", fontSize: "0.68rem", lineHeight: "1" }}>★</span><span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.1rem", height: "1.1rem", borderRadius: "3px", background: "#00b67a", color: "var(--text)", fontSize: "0.68rem", lineHeight: "1" }}>★</span><span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.1rem", height: "1.1rem", borderRadius: "3px", background: "#00b67a", color: "var(--text)", fontSize: "0.68rem", lineHeight: "1" }}>★</span><span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.1rem", height: "1.1rem", borderRadius: "3px", background: "#00b67a", color: "var(--text)", fontSize: "0.68rem", lineHeight: "1" }}>★</span><span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "1.1rem", height: "1.1rem", borderRadius: "3px", background: "#00b67a", color: "var(--text)", fontSize: "0.68rem", lineHeight: "1" }}>★</span></div>
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
      <h1 style={{ margin: "0 0 clamp(0.8rem, 2.2vh, 1.3rem)", fontSize: "clamp(1.3rem, min(6vw, 4.6vh), 2.2rem)", fontWeight: "850", lineHeight: "1.08", letterSpacing: "-0.025em" }}>{v.c.chartTitle}</h1>
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
      <svg viewBox="0 0 320 140" role="img" aria-label={v.c.chartAria} style={{ display: "block", width: "100%", height: "auto", maxHeight: "min(38vh, 17rem)", overflow: "visible" }}>
      <defs>
      <linearGradient id="memo-area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopOpacity="0.42" stopColor={v.accent} />
      <stop offset="100%" stopOpacity="0" stopColor={v.accent} />
      </linearGradient>
      </defs>
      <line x1="34" y1="24" x2="312" y2="24" stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="3 5" />
      <line x1="34" y1="76" x2="312" y2="76" stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="3 5" />
      <line x1="34" y1="128" x2="312" y2="128" stroke="var(--line)" strokeWidth="1" />
      <path d={v.chartArea} fill="url(#memo-area)" style={{ animation: "memo-rise 700ms ease-out 700ms both" }} />
      <path d={v.chartOwn} fill="none" stroke="#4f4d57" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="620" strokeDasharray="620" style={{ animation: "memo-draw 1200ms cubic-bezier(0.33,0,0.2,1) 200ms both" }} />
      <path d={v.chartLine} fill="none" stroke={v.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength="620" strokeDasharray="620" style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.5))", animation: "memo-draw 1700ms cubic-bezier(0.32,0.02,0.18,1) 320ms both" }} />
      <circle cx={v.chartDotX} cy={v.chartDotY} r="11" fill={v.accent} opacity="0.22" style={{ animation: "memo-pop 500ms cubic-bezier(0.2,0.9,0.2,1) 1550ms both" }} />
      <circle cx={v.chartDotX} cy={v.chartDotY} r="5.5" fill={v.accent} stroke="var(--bg)" strokeWidth="2.5" style={{ animation: "memo-pop 460ms cubic-bezier(0.2,0.9,0.2,1) 1600ms both" }} />
      </svg>
      <span style={{ position: "absolute", left: "0", top: "0.15rem", fontSize: "0.72rem", fontWeight: "750", color: "var(--muted)" }}>{v.chartTarget}</span>
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
      <h1 style={{ margin: "0 0 clamp(0.2rem, 0.6vh, 0.4rem)", fontSize: "clamp(1.15rem, min(5.6vw, 4.4vh), 2.15rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.025em" }}>{v.title}</h1>
      <p style={{ margin: "0 0 clamp(0.4rem, 1.6vh, 1.15rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", color: "var(--muted)" }}>{v.subtitle}</p>
      {v.sourceIdle ? (<>
      <div style={{ padding: "0.25rem 0.35rem 0.15rem" }}>
      <div style={{ display: "grid", gap: "clamp(0.4rem, 1.1vh, 0.6rem)", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      {v.files.map((file) => (<Fragment key={file.name}>
      <div onPointerDown={file.onDown} role="button" tabIndex={0} style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.65rem 0.8rem", border: "1px solid var(--line)", borderRadius: "16px", background: "var(--sunken)", cursor: "grab", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", transition: "opacity 160ms ease, transform 160ms cubic-bezier(0.2,0.85,0.2,1), background 160ms ease", opacity: file.lifted }} className="memo-ob-fx-4">
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.2rem", height: "2.2rem", flex: "0 0 auto", borderRadius: "12px", background: "rgba(130,148,218,0.13)", fontSize: "1.05rem", lineHeight: "1" }}>{file.icon}</span>
      <span style={{ display: "grid", gap: "0.1rem", minWidth: "0" }}>
      <span style={{ fontSize: "0.88rem", fontWeight: "750", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</span>
      <span style={{ fontSize: "0.72rem", fontWeight: "600", color: "var(--muted)" }}>{file.meta}</span>
      </span>
      <span className="memo-ob-file-ext" aria-hidden="true" style={{ marginLeft: "auto", flex: "0 0 auto", padding: "0.16rem 0.36rem", borderRadius: "6px", background: "var(--line-soft)", fontSize: "0.62rem", fontWeight: "800", letterSpacing: "0.04em", color: "var(--muted)" }}>{file.ext}</span>
      </div>
      </Fragment>))}
      </div>
      <div ref={v.dropRef} style={{ display: "grid", placeItems: "center", gap: "0.35rem", margin: "clamp(0.6rem, 1.8vh, 1rem) 0.35rem 0.5rem", padding: "clamp(0.9rem, 3.4vh, 1.8rem) clamp(1.2rem, 4vw, 2.2rem)", border: "1.5px dashed", borderRadius: "20px", textAlign: "center", transition: "background 160ms ease, border-color 160ms ease, transform 160ms cubic-bezier(0.2,0.85,0.2,1)", background: v.dropBg, borderColor: v.dropRing, transform: `scale(${v.dropScale})` }}>
      <span aria-hidden="true" style={{ fontSize: "1.7rem", lineHeight: "1", color: "var(--muted)" }}>⤓</span>
      <span style={{ fontSize: "1rem", fontWeight: "600", color: "var(--text)" }}>{v.dropLabel}</span>
      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.8rem", color: "var(--muted-2)" }}>{v.c.srcTapHint}</span>
      </div>
      </div>
      </>) : null}
      {v.srcWorking ? (<>
      <div style={{ display: "grid", gap: "clamp(0.9rem, 2.6vh, 1.6rem)", padding: "0.35rem 0.35rem 0.6rem" }}>
      <div style={{ display: "grid", gap: "0.4rem" }}>
      <p style={{ margin: "0", fontSize: "clamp(1.1rem, 3vh, 1.3rem)", fontWeight: "800", letterSpacing: "-0.03em" }}>{v.srcStage}</p>
      <p style={{ margin: "0", color: "var(--muted)", fontSize: "1rem", fontWeight: "500", lineHeight: "1.5" }}>{v.c.srcBody}</p>
      <div style={{ position: "relative", height: "0.6rem", marginTop: "0.7rem", overflow: "hidden", borderRadius: "999px", background: "var(--tile-hi)" }}>
      <span style={{ position: "absolute", inset: "0 auto 0 0", width: "38%", borderRadius: "inherit", background: "linear-gradient(135deg, #ff6d68, #f45f5a)", animation: "memo-gen-sweep 1.5s cubic-bezier(0.45, 0, 0.2, 1) infinite" }}></span>
      </div>
      </div>
      <div style={{ display: "grid", gap: "0.8rem" }}>
      <span aria-hidden="true" style={{ display: "block", width: "11rem", height: "1.32rem", borderRadius: "999px", background: "var(--sunken)", animation: "memo-skeleton 1.4s ease-in-out infinite" }}></span>
      <span aria-hidden="true" style={{ display: "block", width: "100%", height: "1.05rem", borderRadius: "999px", background: "var(--sunken)", animation: "memo-skeleton 1.4s ease-in-out 0.1s infinite" }}></span>
      <span aria-hidden="true" style={{ display: "block", width: "92%", height: "1.05rem", borderRadius: "999px", background: "var(--sunken)", animation: "memo-skeleton 1.4s ease-in-out 0.2s infinite" }}></span>
      <span aria-hidden="true" style={{ display: "block", width: "74%", height: "1.05rem", borderRadius: "999px", background: "var(--sunken)", animation: "memo-skeleton 1.4s ease-in-out 0.3s infinite" }}></span>
      </div>
      </div>
      </>) : null}
      </div>
      </>) : null}
      {v.isFlash ? (<>
      <div>
      <h1 style={{ margin: "0 0 clamp(0.2rem, 0.6vh, 0.4rem)", fontSize: "clamp(1.15rem, min(5.6vw, 4.4vh), 2.15rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.025em" }}>{v.title}</h1>
      <p style={{ margin: "0 0 clamp(0.4rem, 1.6vh, 1.15rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", color: "var(--muted)" }}>{v.subtitle}</p>
      {v.cardsLeft ? (<>
      <div>
      <div style={{ position: "relative", perspective: "1400px", touchAction: "pan-y" }}>
      {v.hasNext ? (<>
      <div aria-hidden="true" style={{ position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(1.2rem, 4vh, 2rem) 1.7rem", borderRadius: "26px", background: "var(--surface)", boxShadow: "var(--shadow)", pointerEvents: "none", transition: v.nextEase, transform: `translateY(${v.nextLift}px) scale(${v.nextScale})` }}>
      <span style={{ fontSize: "clamp(0.95rem, 2.6vh, 1.3rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.32", textAlign: "center", textWrap: "pretty", opacity: "0.5" }}>{v.nextQ}</span>
      </div>
      </>) : null}
      <div onPointerDown={v.cardDown} onPointerMove={v.cardMove} onPointerUp={v.cardUp} onPointerCancel={v.cardUp} role="button" tabIndex={0} style={{ position: "relative", zIndex: "2", minHeight: "clamp(10.5rem, 30vh, 17rem)", cursor: "grab", touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none", willChange: "transform", perspective: "1400px", transformStyle: "preserve-3d", transition: v.dragEase, transform: `translate3d(${v.cardShift}px, ${v.cardLift}px, 0) rotate(${v.cardTilt}deg)` }}>
      <div style={{ position: "absolute", inset: "0", transformStyle: "preserve-3d", transition: v.flipEase, transform: `rotateY(${v.flipDeg})` }}>
      <div style={{ position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.7rem", padding: "clamp(1.2rem, 4vh, 2rem) 1.7rem", borderRadius: "26px", color: "var(--text)", background: "var(--surface)", boxShadow: "var(--shadow-lg)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "translateZ(1px)" }}>
      <span style={{ fontSize: "0.8rem", fontWeight: "750", letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>{v.cardCounter}</span>
      <span style={{ fontSize: "clamp(1rem, 2.8vh, 1.35rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.32", textAlign: "center", textWrap: "pretty" }}>{v.cardQ}</span>
      <span style={{ color: "var(--muted)", fontSize: "clamp(0.85rem, 2.1vh, 1.05rem)", letterSpacing: "-0.02em" }}>{v.c.flashHint}</span>
      </div>
      <div style={{ position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.7rem", padding: "clamp(1.2rem, 4vh, 2rem) 1.7rem", borderRadius: "26px", color: "var(--text)", background: "var(--surface)", boxShadow: "var(--shadow), inset 0 0 0 1px var(--line)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg) translateZ(1px)" }}>
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", marginTop: "clamp(0.7rem, 2vh, 1.4rem)" }}>
      <button type="button" onClick={v.swipeAgain} aria-label={t("study.cards.didntKnow")} style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", minHeight: "3rem", padding: "0 1.15rem", border: "0", borderRadius: "999px", background: "rgba(255,59,48,0.14)", color: "#ff3b30", fontFamily: "inherit", fontSize: "1rem", fontWeight: "800", lineHeight: "1", cursor: "pointer", transition: "transform 160ms cubic-bezier(0.2,0.85,0.2,1)" }} className="memo-ob-fx-5">✕ <span style={{ fontVariantNumeric: "tabular-nums" }}>{v.againCount}</span></button>
      <button type="button" onClick={v.swipeEasy} aria-label={t("study.cards.knew")} style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", minHeight: "3rem", padding: "0 1.15rem", border: "0", borderRadius: "999px", background: "rgba(34,197,94,0.14)", color: "#22c55e", fontFamily: "inherit", fontSize: "1rem", fontWeight: "800", lineHeight: "1", cursor: "pointer", transition: "transform 160ms cubic-bezier(0.2,0.85,0.2,1)" }} className="memo-ob-fx-5"><span style={{ fontVariantNumeric: "tabular-nums" }}>{v.knownCount}</span> ✓</button>
      </div>
      </div>
      </>) : null}
      {v.cardsDone ? (<>
      <div style={{ display: "grid", justifyItems: "center", width: "100%", maxWidth: "30rem", margin: "0 auto", padding: "clamp(0.3rem, 1.2vh, 1.6rem) 0 0", boxSizing: "border-box", textAlign: "center", animation: "memo-pop 0.32s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
      <div style={{ position: "relative", display: "grid", placeItems: "center", width: "min(12rem, 24vh)", height: "min(12rem, 24vh)" }}>
      <div style={{ display: "grid", placeItems: "center", width: "78%", height: "78%", borderRadius: "999px", background: "var(--tile)" }}>
      <span aria-hidden="true" style={{ fontSize: "min(4.4rem, 11vh)", lineHeight: "1" }}>{v.deckEmoji}</span>
      </div>
      <span style={{ position: "absolute", top: "0.2rem", right: "0", padding: "clamp(0.25rem, 0.9vh, 0.45rem) clamp(0.5rem, 1.6vw, 0.8rem)", borderRadius: "0.875rem", transform: "rotate(-8deg)", whiteSpace: "nowrap", fontSize: "min(1.5rem, 3.8vh)", fontWeight: "850", letterSpacing: "-0.03em", background: v.deckTintSoft, color: v.deckTint, animation: "memo-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.12s both" }}>{v.deckPct} %</span>
      </div>
      <span style={{ marginTop: "clamp(0.4rem, 1.6vh, 1.2rem)", color: "var(--muted)", fontSize: "0.78rem", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase" }}>{v.deckEyebrow}</span>
      <span style={{ marginTop: "clamp(0.2rem, 0.7vh, 0.5rem)", fontSize: "min(1.75rem, 4.4vh)", fontWeight: "800", letterSpacing: "-0.04em", lineHeight: "1.15", textWrap: "pretty" }}>{v.deckTitle}</span>
      <span style={{ marginTop: "clamp(0.3rem, 1vh, 0.7rem)", color: "var(--muted)", fontSize: "min(1rem, 2.4vh)", fontWeight: "500" }}><span style={{ fontWeight: "800", color: v.deckTint }}>{v.deckPct} %</span> {v.deckScoreLabel}</span>
      <span style={{ marginTop: "0.25rem", color: "var(--muted)", fontSize: "min(1rem, 2.4vh)", fontWeight: "500" }}>{v.c.deckCorrect} <span style={{ fontWeight: "800", color: v.deckTint }}>{v.deckRatio}</span></span>
      <div style={{ display: "grid", gap: "0.7rem", width: "100%", marginTop: "clamp(0.5rem, 1.8vh, 1.6rem)" }}>
      <button type="button" onClick={v.deckAction} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", width: "100%", minHeight: "clamp(2.8rem, 7vh, 3.3rem)", padding: "0 1.4rem", border: "0", borderRadius: "999px", background: "var(--ink)", color: "var(--on-ink)", fontFamily: "inherit", fontSize: "clamp(0.96rem, 2.3vh, 1.08rem)", fontWeight: "750", lineHeight: "1", cursor: "pointer", transition: "transform 170ms cubic-bezier(0.2,0.85,0.2,1)" }} className="memo-ob-fx-6"><span aria-hidden="true" style={{ fontSize: "1.2rem" }}>↻</span>{v.deckActionLabel}</button>
      </div>
      </div>
      </>) : null}
      </div>
      </>) : null}
      {v.isQuiz ? (<>
      <div>
      <h1 style={{ margin: "0 0 clamp(0.2rem, 0.6vh, 0.4rem)", fontSize: "clamp(1.15rem, min(5.6vw, 4.4vh), 2.15rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.025em" }}>{v.title}</h1>
      <p style={{ margin: "0 0 clamp(0.4rem, 1.6vh, 1.15rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", color: "var(--muted)" }}>{v.subtitle}</p>
      <div style={{ padding: "clamp(1rem, 2.8vh, 1.6rem) clamp(1.1rem, 3vw, 1.7rem) clamp(0.9rem, 2.6vh, 1.5rem)", borderRadius: "24px", background: "var(--surface)", boxShadow: "var(--shadow)" }}>
      <span style={{ display: "block", color: "var(--muted)", fontSize: "clamp(0.86rem, 2vh, 0.98rem)", fontWeight: "600", letterSpacing: "-0.015em" }}>{v.c.quizMeta}</span>
      <p style={{ margin: "0.5rem 0 clamp(0.7rem, 2vh, 1.2rem)", fontSize: "clamp(1.02rem, 2.8vh, 1.3rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.3", textWrap: "pretty" }}>{v.c.quizQ}</p>
      <div style={{ display: "grid", gap: "clamp(0.4rem, 1.2vh, 0.7rem)" }}>
      {v.quizOptions.map((opt) => (<Fragment key={opt.value}>
      <button type="button" onClick={opt.onPick} style={{ display: "flex", alignItems: "center", gap: "0.9rem", width: "100%", minHeight: "clamp(3rem, 7.4vh, 4.4rem)", padding: "0 1.1rem", borderRadius: "18px", cursor: "pointer", fontFamily: "inherit", fontSize: "clamp(0.95rem, 2.3vh, 1.08rem)", fontWeight: "600", letterSpacing: "-0.02em", textAlign: "left", border: "1.5px solid transparent", transition: "background 0.18s ease, color 0.18s ease, border-color 0.18s ease", background: opt.bg, borderColor: opt.ring, color: opt.color }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2.1rem", height: "2.1rem", flex: "0 0 auto", borderRadius: "999px", fontSize: "0.98rem", fontWeight: "750", transition: "background 0.18s ease", background: opt.badgeBg, color: opt.badgeColor }}>{opt.letter}</span>
      <span style={{ flex: "1 1 auto", minWidth: "0" }}>{opt.label}</span>
      </button>
      </Fragment>))}
      </div>
      {v.quizAnswered ? (<>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.8rem", marginTop: "clamp(0.7rem, 2vh, 1.4rem)", paddingTop: "clamp(0.7rem, 2vh, 1.4rem)", borderTop: "1px solid var(--line)", animation: "memo-pop 0.24s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
      <span style={{ padding: "0.3rem 0.65rem", borderRadius: "999px", fontSize: "0.82rem", fontWeight: "800", color: "var(--text)", background: v.quizVerdictBg }}>{v.quizVerdict}</span>
      <span style={{ flex: "1 1 12rem", minWidth: "0", fontSize: "clamp(0.85rem, 2vh, 0.95rem)", fontWeight: "650", lineHeight: "1.4", color: "var(--muted)" }}>{v.c.quizExplain}</span>
      </div>
      </>) : null}
      </div>
      </div>
      </>) : null}
      {v.isTest ? (<>
      <div>
      <h1 style={{ margin: "0 0 clamp(0.2rem, 0.6vh, 0.4rem)", fontSize: "clamp(1.15rem, min(5.6vw, 4.4vh), 2.15rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.025em" }}>{v.title}</h1>
      <p style={{ margin: "0 0 clamp(0.4rem, 1.6vh, 1.15rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", color: "var(--muted)" }}>{v.subtitle}</p>
      <div style={{ padding: "clamp(0.95rem, 2.8vh, 1.5rem) clamp(1.1rem, 3vw, 1.6rem)", borderRadius: "24px", background: "var(--surface)", boxShadow: "var(--shadow)" }}>
      <span style={{ display: "block", color: "var(--muted)", fontSize: "clamp(0.84rem, 2vh, 0.96rem)", fontWeight: "600" }}>{v.c.testMeta}</span>
      <p style={{ margin: "0.45rem 0 clamp(0.6rem, 1.8vh, 1rem)", fontSize: "clamp(1rem, 2.6vh, 1.22rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.3", textWrap: "pretty" }}>{v.c.testQ}</p>
      <textarea value={v.testText} onChange={v.onTestType} placeholder={v.c.testPlaceholder} rows={3} style={{ width: "100%", boxSizing: "border-box", padding: "0.85rem 0.95rem", border: "1.5px solid var(--line)", borderRadius: "18px", background: "var(--sunken)", color: "var(--text)", fontFamily: "inherit", fontSize: "clamp(0.9rem, 2.2vh, 1rem)", fontWeight: "600", lineHeight: "1.5", resize: "none", outline: "none" }}></textarea>
      {v.testUngraded ? (<>
      <button type="button" onClick={v.gradeTest} disabled={v.cannotGrade} style={{ marginTop: "0.75rem", width: "100%", minHeight: "3rem", border: "0", borderRadius: "999px", fontFamily: "inherit", fontSize: "1rem", fontWeight: "800", cursor: "pointer", transition: "opacity 200ms ease, transform 170ms cubic-bezier(0.2,0.85,0.2,1)", background: v.accent, color: "#000000", opacity: v.gradeOpacity }} className="memo-ob-fx-6">{v.c.testGrade}</button>
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
      <h1 style={{ margin: "0 0 clamp(0.2rem, 0.6vh, 0.4rem)", fontSize: "clamp(1.15rem, min(5.6vw, 4.4vh), 2.15rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.025em" }}>{v.title}</h1>
      <p style={{ margin: "0 0 clamp(0.4rem, 1.6vh, 1.15rem)", fontSize: "clamp(0.84rem, 1.9vh, 0.96rem)", fontWeight: "600", color: "var(--muted)" }}>{v.subtitle}</p>
      <LandingTutorDemo />
      </div>
      </>) : null}
      {v.isLoading ? (<>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "clamp(0.5rem, 1.6vh, 1rem)", paddingTop: "0.6rem" }}>
      <div style={{ position: "relative", flex: "0 0 auto", display: "grid", placeItems: "center", width: "min(9rem, 22vh)", height: "min(9rem, 22vh)", aspectRatio: "1" }}>
      <svg viewBox="0 0 100 100" aria-hidden="true" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
      <circle cx="50" cy="50" r="45" fill="none" stroke="var(--line-soft)" strokeWidth="3" />
      <circle cx="50" cy="50" r="45" fill="none" stroke={v.accent} strokeWidth="3" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={v.ringOffset} style={{ transition: "stroke-dashoffset 200ms linear" }} />
      </svg>
      <img src="/memo-mascot.png" alt="" fetchPriority="high" decoding="sync" style={{ position: "relative", width: "58%", maxWidth: "58%", maxHeight: "58%", height: "auto", display: "block", animation: "memo-bob 4.2s ease-in-out infinite", filter: "drop-shadow(0 14px 26px rgba(0,0,0,0.35))" }} />
      </div>
      <h1 style={{ margin: "0", fontSize: "clamp(1.25rem, min(5.4vw, 4vh), 1.9rem)", fontWeight: "850", lineHeight: "1.1", letterSpacing: "-0.03em", textWrap: "pretty" }}>{v.loadingTitle}</h1>
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
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "4.6rem", height: "4.6rem", borderRadius: "999px", fontSize: "2rem", fontWeight: "900", color: "#000000", animation: "memo-pop 460ms cubic-bezier(0.2,0.9,0.2,1) both", background: "#62d676" }}>✓</span>
      <h1 style={{ margin: "0", fontSize: "clamp(1.4rem, min(6.5vw, 5vh), 2.4rem)", fontWeight: "850", lineHeight: "1.08", letterSpacing: "-0.025em" }}>{v.c.doneTitle}</h1>
      <p style={{ margin: "0", maxWidth: "24rem", fontSize: "1rem", fontWeight: "600", lineHeight: "1.45", color: "var(--muted)" }}>{v.c.doneSub}</p>
      </div>
      </>) : null}
      </div>
      </main>
      <footer style={{ position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "6", boxSizing: "border-box", background: "linear-gradient(to top, var(--bg) 62%, transparent)", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.55rem", padding: "clamp(0.5rem, 1.4vh, 0.9rem) clamp(1rem, 4vw, 2rem) max(0.8rem, env(safe-area-inset-bottom))" }}>
      {v.showCta ? (<>
      <button type="button" onClick={v.next} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", width: "100%", maxWidth: "34rem", minHeight: "clamp(2.9rem, 7vh, 3.5rem)", border: "0", borderRadius: "999px", fontFamily: "inherit", fontSize: "clamp(0.95rem, 2.2vh, 1.06rem)", fontWeight: "800", letterSpacing: "-0.01em", cursor: "pointer", transition: "transform 170ms cubic-bezier(0.2,0.85,0.2,1), opacity 200ms ease, box-shadow 240ms ease", background: v.ctaBg, color: v.ctaColor, boxShadow: v.ctaGlow, opacity: v.ctaOpacity }} disabled={v.ctaDisabled} className="memo-ob-fx-8">{v.ctaLabel}</button>
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
