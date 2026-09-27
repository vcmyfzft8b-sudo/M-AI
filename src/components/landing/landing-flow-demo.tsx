"use client";

import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Component } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { NOTE_STUDY_TABS } from "@/lib/note-tabs";
import type { Locale } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

import { LandingAppScope } from "./app/landing-app-scope";
import { landingNoteMeta, landingNoteTitleMeta } from "./app/landing-note-meta";
import { LandingFlashcardsScreen } from "./app/landing-flashcards-screen";
import { LandingMindmapScreen } from "./app/landing-mindmap-screen";
import { LandingPalaceScreen } from "./app/landing-palace-screen";
import { LandingPodcastScreen } from "./app/landing-podcast-screen";
import { LandingQuizScreen } from "./app/landing-quiz-screen";
import { LandingSpeedReadScreen } from "./app/landing-speed-read-screen";
import { LandingTestScreen } from "./app/landing-test-screen";
import { LandingSampleNote } from "./landing-sample-note";
import { LandingScaledFrame } from "./landing-scaled-frame";
import { LandingTutorDemo } from "./landing-tutor-demo";
import type { SourceDetail, SourceKind } from "./memo-app-preview-data";

/*
 * The interface around the demo is translated; the material inside it is not.
 * File names, note titles, the note itself and the flashcards, quiz and test
 * questions all stand in for the learner's own coursework, which stays in the
 * language it was written in whatever the interface is set to. Same boundary
 * as memo-app-preview-data.ts — see the note at the top of that file.
 *
 * Each step's card is the app itself, not a drawing of it: the home screen's
 * drop zone and note rows, the note tab's rendered note, and the note's pill
 * row over the real study screens (`./app/`), each drawn at phone width and
 * scaled into the card by `LandingScaledFrame`.
 */

/*
 * The note's study pills: the app's own row (`NOTE_TABS`), minus the note it hangs
 * off and the transcript, which is the source rather than something to revise with.
 */
const STUDY_TABS = NOTE_STUDY_TABS;

type StudyTabId = (typeof STUDY_TABS)[number]["id"];

/* The card opens on the flashcards, the pill most people reach for first. */
const FIRST_STUDY_TAB: StudyTabId = "flashcards";

/* The width the app screens inside the cards are laid out at: a phone's. */
const SCREEN_WIDTH = 390;

type FlowSource = {
  id: string;
  icon: string;
  kind: string;
  kindColor: string;
  label: string;
  sub: (t: Translate<MessageKey>) => string;
  noteTitleKey: MessageKey;
  /** The note it becomes, as the library row and the note's title line describe it. */
  note: { source: SourceKind; detail: SourceDetail };
};

const FLOW_SOURCES: FlowSource[] = [
  {
    id: "audio",
    icon: "🎙️",
    kind: "mp3",
    // Deeper than the brand orange, which only reached 3:1 on the white chip.
    kindColor: "#b4431d",
    label: "predavanje-4.mp3",
    sub: (t) => `${t("flowDemo.kindAudio")} · 48:12`,
    noteTitleKey: "flowDemo.noteTitle.audio",
    note: { source: "audio", detail: { minutes: 48 } },
  },
  {
    id: "pdf",
    icon: "📄",
    kind: "pdf",
    kindColor: "#d0342c",
    label: "skripta-IS.pdf",
    sub: (t) => `${t("flowDemo.kindPdf")} · ${t("flowDemo.pages", { count: 24 })}`,
    noteTitleKey: "flowDemo.noteTitle.pdf",
    note: { source: "pdf", detail: { pages: 24 } },
  },
  {
    id: "doc",
    icon: "📝",
    kind: "docx",
    kindColor: "#2b579a",
    label: "seminarska-erp.docx",
    sub: (t) => `${t("flowDemo.kindWord")} · ${t("flowDemo.pages", { count: 12 })}`,
    noteTitleKey: "flowDemo.noteTitle.doc",
    /* A Word file is imported as a document, which the app files and labels as a PDF. */
    note: { source: "pdf", detail: { pages: 12 } },
  },
];

const PAST_NOTES: Array<{
  icon: string;
  titleKey: MessageKey;
  note: { source: SourceKind; detail: SourceDetail; daysAgo: number };
}> = [
  {
    icon: "🎙️",
    titleKey: "flowDemo.past.lecture3",
    note: { source: "audio", detail: { minutes: 52 }, daysAgo: 1 },
  },
  {
    icon: "📄",
    titleKey: "flowDemo.past.script2",
    note: { source: "pdf", detail: { pages: 18 }, daysAgo: 3 },
  },
  {
    icon: "📝",
    titleKey: "flowDemo.past.seminar",
    note: { source: "pdf", detail: { pages: 9 }, daysAgo: 7 },
  },
  {
    icon: "🎙️",
    titleKey: "flowDemo.past.lecture2",
    note: { source: "audio", detail: { minutes: 1 * 60 + 5 }, daysAgo: 8 },
  },
];

// Chip geometry lives in landing.css so it can shrink to fit three across
// on narrow screens; only the drag state stays inline here.
const CHIP_BASE: CSSProperties = {
  transition: "transform 220ms cubic-bezier(0.34,1.3,0.5,1), opacity 220ms ease",
};

const STATUS_BASE: CSSProperties = {
  margin: 0,
  /* Fixed, not a minimum: an empty status sat at the minimum while one with
     text rendered a couple of pixels taller, and the card above it — the
     row that flexes — absorbed the difference every time the wording
     changed. */
  height: "1.4rem",
  lineHeight: "1.4rem",
  fontSize: "0.88rem",
  fontWeight: 500,
  transition: "color 300ms ease, opacity 300ms ease",
};

/* Must track landing.css: the grid goes three-across at min-width 806px.
   Below that the steps wrap, so they need the per-step scroll gating. */
const STEPS_SIDE_BY_SIDE = 806;

const STEP_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

/* How much of a step must be on screen before it animates. A card taller than
   the viewport can never show a large fraction of itself, so the bar drops to
   what that step can actually reach — otherwise the story waits on a ratio
   that will never arrive and freezes. */
function stepGate(el: Element): number {
  const height = el.getBoundingClientRect().height;
  if (height <= 0) return 0.5;
  return Math.min(0.5, (window.innerHeight * 0.6) / height);
}

function visibleRatio(el: Element): number {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  const shown = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return Math.max(0, shown) / rect.height;
}

/* A step that has been on screen this long counts as read even if it never
   cleared the gate. */
const STEP_STALL_MS = 2500;

/* Absolute backstop, timed from the moment the story starts. Whatever went
   wrong — an observer that never reported, a scroll that outran it — the
   remaining steps play rather than leaving the demo frozen half-finished,
   which reads as a broken product. */
const STEP_SAFETY_MS = 15_000;

/* How much of the opening drag's length to keep when the reader has already
   scrolled past the first step. Short enough not to delay the card in front
   of them, long enough to still read as a drag rather than a cut. The flick
   figure is for someone throwing the page past the section — barely a blink,
   but the file is still seen to move. */
const DRAG_HURRY = 0.4;
const DRAG_FLICK = 0.16;

/* Scroll speed at which an arrival counts as a flick rather than a brisk
   read. Well above HURRIED_PX_PER_S below, which only shortens the note. */
const FLICK_PX_PER_S = 3000;

/* Longest gap between two scroll samples that still says something about
   speed. Above it the page was idle, not moving slowly. */
const SCROLL_SAMPLE_MAX_GAP_MS = 400;

/* How far below the fold a step starts animating, in viewport heights. One
   screen of warning is enough for the note to be written by the time a reader
   scrolling at a normal pace actually gets to it. Stacked layouts only —
   wide ones play the whole timeline at once. */
const STEP_LOOKAHEAD = 1;

/* When the note is written out, line by line. */
const NOTE_SCHEDULE = [180, 620, 1040, 1400, 1720, 2020, 2320];
const NOTE_SCHEDULE_END = 2480;

/* Above this scroll speed the reader is moving through the page rather than
   reading it, and the unhurried timeline above would still be filling in the
   note well after they have gone past. */
const HURRIED_PX_PER_S = 1200;
const HURRIED_SCALE = 0.35;

type FlowGhost = {
  icon: string;
  label: string;
  left: number;
  top: number;
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
};

type FlowDemoProps = {
  storyAutoplay?: boolean;
  /** Injected by the wrapper below, because a class cannot call a hook. */
  t: Translate<MessageKey>;
  locale: Locale;
};

type FlowDemoState = {
  flowStage: number;
  noteStep: number;
  flowOver: boolean;
  flowLabel: string | null;
  flowSource: FlowSource | null;
  flowGhost: FlowGhost | null;
  flowDrag: string | null;
  sTab: StudyTabId;
  /* Bumped when a new source restarts the story, so every study screen starts over. */
  studyRun: number;
  touchGhost: { icon: string; label: string; x: number; y: number } | null;
};

class LandingFlowDemoView extends Component<FlowDemoProps, FlowDemoState> {
  state: FlowDemoState = {
    flowStage: 0,
    noteStep: 0,
    flowOver: false,
    flowLabel: null,
    flowSource: null,
    flowGhost: null,
    flowDrag: null,
    sTab: FIRST_STUDY_TAB,
    studyRun: 0,
    touchGhost: null,
  };

  private flowWrap: HTMLDivElement | null = null;
  private flowTile: HTMLDivElement | null = null;
  private flowChipEls: Array<HTMLDivElement | null> = [];
  private flowObserver: IntersectionObserver | null = null;
  private flowTimers: number[] = [];
  private flowUserActed = false;
  private flowStarted = false;
  private tabRow: HTMLDivElement | null = null;
  private tabEls: Partial<Record<StudyTabId, HTMLButtonElement | null>> = {};
  private touchDrag: { chip: FlowSource; startX: number; startY: number; moved: boolean } | null = null;
  private suppressChipClick = false;
  private stepEls: Array<HTMLElement | null> = [];
  private stepObserver: IntersectionObserver | null = null;
  private stepVisible: Record<number, boolean> = {};
  /* Latched once a step comes within a screen of the fold — what starts its
     animation. stepVisible stays the stricter "on screen now" test. */
  private stepReached: Record<number, boolean> = {};
  private stepOnScreen: Record<number, boolean> = {};
  private stallTimer: number | undefined;
  private safetyTimer: number | undefined;
  private measureFrame: number | undefined;
  /* Set synchronously when the opening drag is scheduled. state.flowGhost
     cannot do this job: a scroll fires several measure() passes in a row, and
     one of them lands before the ghost's setState has committed — which used
     to clear the drag's own timer and skip it. */
  private dragging = false;
  /* The reader arrived below the first step. The opening drag still plays,
     but compressed, and the card in front of them reveals quickly — they are
     already looking at it and should not wait out an intro they scrolled
     past. */
  private hurried = false;
  /* Captured once, when the catch-up fires. Reading it live would let the
     duration change mid-flight as the scroll decays, which the ghost's own
     CSS transition would then re-time under itself. */
  private hurryScale = 1;
  private lastScrollY = 0;
  private lastScrollAt = 0;
  private scrollSpeed = 0;
  private advancing = false;

  componentDidMount() {
    this.setupFlow();
    this.setupStepObserver();
    // Observers are a notification, not the source of truth — see measure().
    window.addEventListener("scroll", this.onViewportChange, { passive: true });
    window.addEventListener("resize", this.onViewportChange, { passive: true });
    document.addEventListener("visibilitychange", this.onViewportChange);
    this.measure();
  }

  componentWillUnmount() {
    this.clearFlowTimers();
    window.clearTimeout(this.stallTimer);
    window.clearTimeout(this.safetyTimer);
    window.clearTimeout(this.measureFrame);
    if (this.flowObserver) this.flowObserver.disconnect();
    if (this.stepObserver) this.stepObserver.disconnect();
    window.removeEventListener("scroll", this.onViewportChange);
    window.removeEventListener("resize", this.onViewportChange);
    document.removeEventListener("visibilitychange", this.onViewportChange);
    window.removeEventListener("pointermove", this.onChipPointerMove);
    window.removeEventListener("pointerup", this.onChipPointerUp);
    window.removeEventListener("pointercancel", this.onChipPointerUp);
  }

  /* Throttled on a timer rather than requestAnimationFrame: frames stop on a
     hidden page, which is one of the cases this fallback exists to cover. */
  onViewportChange = () => {
    if (this.measureFrame !== undefined) return;
    this.measureFrame = window.setTimeout(() => {
      this.measureFrame = undefined;
      this.measure();
    }, 120);
  };

  /* Measures the steps directly instead of trusting IntersectionObserver
     entries. A backgrounded tab delivers no entries at all, and a fast scroll
     can skip the ratios the gates want, either of which used to leave the
     story stuck on step 1 for the rest of the visit. The observers and the
     scroll listener now only say "look again"; this decides. */
  /* Recent scroll speed in px/s, smoothed so one jumpy sample cannot decide
     the pacing on its own. */
  trackScroll() {
    const now = Date.now();
    const y = window.scrollY;
    if (this.lastScrollAt) {
      const dt = now - this.lastScrollAt;
      /* A gap this long means the page sat still and has just started moving
         again — dividing the whole jump by that idle time reports a fling as
         a crawl. The distance is real but its duration is unknown, so this
         sample only seeds the baseline and the next one measures. */
      if (dt > SCROLL_SAMPLE_MAX_GAP_MS) {
        this.scrollSpeed = 0;
      } else if (dt > 0) {
        const speed = (Math.abs(y - this.lastScrollY) / dt) * 1000;
        this.scrollSpeed = this.scrollSpeed * 0.4 + speed * 0.6;
      }
    }
    this.lastScrollY = y;
    this.lastScrollAt = now;
  }

  /* How much to compress the step timeline. A reader moving fast gets the
     short version — the point is that they see the note appear, not that
     they watch it being typed. */
  paceScale(): number {
    return this.scrollSpeed > HURRIED_PX_PER_S ? HURRIED_SCALE : 1;
  }

  measure() {
    this.trackScroll();
    if (!this.isCompact()) {
      this.maybeStart();
      return;
    }
    const lookahead = window.innerHeight * STEP_LOOKAHEAD;
    this.stepEls.forEach((el) => {
      if (!el) return;
      const step = Number(el.getAttribute("data-flow-step"));
      const ratio = visibleRatio(el);
      const rect = el.getBoundingClientRect();
      this.stepOnScreen[step] = ratio > 0;
      this.stepVisible[step] = ratio >= stepGate(el);
      /* Animating starts while the card is still below the fold, so it has
         played by the time the reader reaches it — a card that begins blank
         when it comes into view reads as broken. Kept separate from
         stepVisible, which still means "actually on screen" and decides which
         card the reader is looking at. */
      this.stepReached[step] =
        this.stepReached[step] || rect.top < window.innerHeight + lookahead;
    });
    this.maybeAdvance();
  }

  /* Wide layouts play the whole timeline at once, so the trigger is the grid
     rather than any single step. */
  maybeStart() {
    if (this.flowStarted || this.flowUserActed || !this.flowWrap) return;
    const rect = this.flowWrap.getBoundingClientRect();
    // A grid taller than the viewport can never reach full visibility.
    const needed = rect.height > window.innerHeight * 0.9 ? 0.6 : 0.9;
    if (visibleRatio(this.flowWrap) < needed) return;
    this.flowObserver?.disconnect();
    this.flowObserver = null;
    this.beginStory(400, false);
  }

  // Stacked layouts show one step at a time, so each step waits for its own
  // card to be on screen — otherwise steps 2 and 3 animate out of sight and
  // are already finished by the time the user scrolls to them.
  setupStepObserver() {
    if (!this.isCompact() || !("IntersectionObserver" in window)) return;
    this.stepObserver = new IntersectionObserver(() => this.measure(), {
      threshold: STEP_THRESHOLDS,
    });
    this.stepEls.forEach((el) => el && this.stepObserver?.observe(el));
  }

  /* The step the reader is actually looking at. */
  furthestVisible(): number {
    if (this.stepVisible[3]) return 3;
    if (this.stepVisible[2]) return 2;
    if (this.stepVisible[1]) return 1;
    return 0;
  }

  /* A quick scroll can land the reader on a step the story has not reached —
     they skimmed past the earlier cards, which on a stacked layout is one
     flick. Everything before the card in front of them completes at once, so
     it is live the moment they arrive instead of showing an empty card while
     the steps they already scrolled past play out in order. */
  catchUpTo(step: number): boolean {
    const stage = this.state.flowStage;
    const ahead = (step === 3 && stage < 2) || (step === 2 && stage < 1);
    if (!ahead) return false;

    /* The source being dragged into the first step is the demo's opening
       move — it explains what the three steps are about. It plays once even
       for a reader who arrived further down the section, rather than the file
       simply being there already. */
    if (!this.flowStarted) {
      this.beginStory(0, true);
      return true;
    }
    // Let that drag finish before anything skips ahead of it.
    if (this.dragging) return true;

    this.clearFlowTimers();
    this.clearStall();
    this.flowStarted = true;
    this.advancing = false;
    /* Pace follows what the reader is doing now, not how they entered the
       section — someone who read the first step and then flicked wants the
       card in front of them straight away. */
    if (this.scrollSpeed > HURRIED_PX_PER_S) {
      this.hurried = true;
      this.hurryScale = this.scrollSpeed > FLICK_PX_PER_S ? DRAG_FLICK : DRAG_HURRY;
    }
    const source = this.state.flowSource ?? FLOW_SOURCES[0];
    this.setState(
      {
        // Landing on step 3 means the note is old news; on step 2 the source
        // is in and the writing starts straight away.
        flowStage: step === 3 ? 3 : 1,
        noteStep: step === 3 ? 7 : 0,
        flowSource: source,
        flowLabel: source.label,
        flowGhost: null,
        flowOver: false,
      },
      () => this.maybeAdvance(),
    );
    return true;
  }

  maybeAdvance() {
    if (!this.isCompact()) return;
    /* A reader moving fast can overtake the note being written: they are
       already at the study card while step two is still filling in. That
       catch-up interrupts the run in progress, which a reader who is actually
       reading must not have done to them — hence the speed test. */
    const mayInterrupt = !this.advancing || this.scrollSpeed > HURRIED_PX_PER_S;
    if (!this.flowUserActed && mayInterrupt && this.catchUpTo(this.furthestVisible())) return;
    if (this.advancing) return;
    const stage = this.state.flowStage;
    // Step 1 on screen: drop the file into the card and start the story.
    /* Step one is the exception to the look-ahead: its animation is the
       source being dragged into the card, which is the thing worth seeing.
       Starting that a screen early would have it finished before the reader
       arrives, so it waits until the card is actually in front of them. */
    if (stage === 0 && this.stepVisible[1] && !this.flowStarted && !this.flowUserActed) {
      this.beginStory(400, false);
      return;
    }
    if (stage === 0) {
      this.armStall(1);
      return;
    }
    if (stage === 1 && this.stepReached[2]) {
      this.clearStall();
      this.advancing = true;
      const scale = this.paceScale();
      NOTE_SCHEDULE.forEach((ms, i) =>
        this.flowLater(() => this.setState({ noteStep: i + 1 }), ms * scale),
      );
      this.flowLater(() => {
        this.advancing = false;
        this.setState({ flowStage: 2 }, () => this.maybeAdvance());
      }, NOTE_SCHEDULE_END * scale);
      return;
    }
    if (stage === 1) {
      this.armStall(2);
      return;
    }
    if (stage === 2 && this.stepReached[3]) {
      this.clearStall();
      this.flowLater(() => this.setState({ flowStage: 3 }), 400 * this.paceScale());
      return;
    }
    if (stage === 2) this.armStall(3);
  }

  /* The gate above can miss — a step wider than it is tall, an observer that
     stops reporting mid-scroll — and the story would then sit unfinished for
     the rest of the visit. Once the step has been on screen for a while,
     treat it as seen and carry on. */
  armStall(step: number) {
    if (this.stallTimer !== undefined || !this.stepOnScreen[step] || this.flowUserActed) return;
    this.stallTimer = window.setTimeout(() => {
      this.stallTimer = undefined;
      if (!this.stepOnScreen[step]) return;
      this.stepVisible[step] = true;
      this.stepReached[step] = true;
      this.maybeAdvance();
    }, STEP_STALL_MS);
  }

  clearStall() {
    window.clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
  }

  /* Runs once the story has started. If it has not reached the end by then,
     every remaining step is treated as seen and the timeline finishes on its
     own — the visitor gets a complete demo instead of a frozen one. */
  armSafety() {
    if (this.safetyTimer !== undefined) return;
    this.safetyTimer = window.setTimeout(() => {
      this.safetyTimer = undefined;
      if (this.flowUserActed || this.advancing || this.state.flowStage >= 3) return;
      this.stepVisible = { 1: true, 2: true, 3: true };
      this.stepReached = { 1: true, 2: true, 3: true };
      this.maybeAdvance();
    }, STEP_SAFETY_MS);
  }

  clearFlowTimers() {
    this.flowTimers.forEach((id) => window.clearTimeout(id));
    this.flowTimers = [];
  }

  flowLater(fn: () => void, ms: number) {
    this.flowTimers.push(window.setTimeout(fn, ms));
  }

  // Below the three-across breakpoint the steps wrap onto separate rows, so a
  // single timeline would animate steps the reader cannot see yet; there each
  // step waits for its own card. Must stay in step with landing.css — while
  // this read 900px, the 806–899px band drew all three side by side and still
  // waited for a scroll that never came, freezing the story on step 1.
  isCompact() {
    return typeof window !== "undefined" && window.innerWidth < STEPS_SIDE_BY_SIDE;
  }

  setupFlow() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || this.props.storyAutoplay === false || !("IntersectionObserver" in window)) {
      this.flowUserActed = true;
      return;
    }
    // The story plays once, and only after the steps are properly on screen —
    // never while they are half out of view, and never on a loop.
    this.flowObserver = new IntersectionObserver(() => this.maybeStart(), {
      threshold: [0.25, 0.5, 0.6, 0.75, 0.9, 1],
    });
    if (this.isCompact()) {
      this.flowObserver.disconnect();
      this.flowObserver = null;
      return;
    }
    if (this.flowWrap) this.flowObserver.observe(this.flowWrap);
  }

  runFlow(source: FlowSource, byUser: boolean) {
    this.clearFlowTimers();
    // The opening drag is over by the time a source actually lands.
    this.dragging = false;
    if (byUser) this.flowUserActed = true;
    // A new source restarts the whole story, study material included, so the
    // deck animates in from the first card again.
    this.setState((p) => ({
      flowStage: 1,
      flowOver: false,
      flowLabel: source.label,
      flowSource: source,
      flowGhost: null,
      flowDrag: null,
      noteStep: 0,
      sTab: FIRST_STUDY_TAB,
      studyRun: p.studyRun + 1,
    }));
    // The row starts at its first pill again, as the app's does on a fresh note.
    this.tabRow?.scrollTo({ left: 0 });
    if (this.isCompact()) {
      this.advancing = false;
      // Re-measure rather than reuse: the reader may have scrolled on to the
      // next step while the source was animating into the first one.
      window.setTimeout(() => this.measure(), 0);
      return;
    }
    [180, 620, 1040, 1400, 1720, 2020, 2320].forEach((ms, i) =>
      this.flowLater(() => this.setState({ noteStep: i + 1 }), ms),
    );
    this.flowLater(() => this.setState({ flowStage: 2 }), 2480);
    this.flowLater(() => this.setState({ flowStage: 3 }), 3100);
  }

  /* The drag runs at full length for a reader working down the section, and
     compressed for one who has already scrolled past the first step — it
     still reads as the file being carried in, without holding up the card
     they are actually looking at. */
  dragScale() {
    return this.hurried ? this.hurryScale : 1;
  }

  /* Single entry point for starting the story, so the drag is paced the same
     way however the reader got here. `arrivedBelow` means they are already
     looking at a later step; otherwise the pace comes from how fast they were
     moving when the first step came into view — a fling past the section
     compresses just as much as skipping it outright. */
  beginStory(delayMs: number, arrivedBelow: boolean) {
    this.clearStall();
    this.flowStarted = true;
    this.dragging = true;
    this.hurried = arrivedBelow || this.scrollSpeed > HURRIED_PX_PER_S;
    this.hurryScale = !this.hurried
      ? 1
      : this.scrollSpeed > FLICK_PX_PER_S
        ? DRAG_FLICK
        : DRAG_HURRY;
    this.armSafety();
    this.flowLater(() => this.autoFlow(), delayMs * this.dragScale());
  }

  autoFlow() {
    if (this.flowUserActed) return;
    // The story runs once, so it always demonstrates the first source.
    const i = 0;
    const src = FLOW_SOURCES[i];
    const chip = this.flowChipEls[i];
    if (!this.flowWrap || !chip || !this.flowTile) {
      this.runFlow(src, false);
      return;
    }
    const drag = this.dragScale();
    const wr = this.flowWrap.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    const tr = this.flowTile.getBoundingClientRect();
    this.setState({
      flowGhost: {
        icon: src.icon,
        label: src.label,
        left: cr.left - wr.left,
        top: cr.top - wr.top,
        dx: 0,
        dy: 0,
        scale: 1,
        opacity: 0,
      },
    });
    this.flowLater(
      () =>
        this.setState((s) => (s.flowGhost ? { flowGhost: { ...s.flowGhost, opacity: 1 } } : null)),
      70 * drag,
    );
    this.flowLater(
      () =>
        this.setState((s) =>
          s.flowGhost
            ? {
                flowGhost: {
                  ...s.flowGhost,
                  dx: tr.left + tr.width / 2 - (cr.left + cr.width / 2),
                  dy: tr.top + tr.height / 2 - (cr.top + cr.height / 2),
                  scale: 0.68,
                },
              }
            : null,
        ),
      260 * drag,
    );
    this.flowLater(() => this.setState({ flowOver: true }), 860 * drag);
    this.flowLater(
      () =>
        this.setState((s) =>
          s.flowGhost ? { flowGhost: { ...s.flowGhost, opacity: 0, scale: 0.4 } } : null,
        ),
      1020 * drag,
    );
    this.flowLater(() => {
      this.setState({ flowGhost: null });
      this.runFlow(src, false);
    }, 1180 * drag);
  }

  studyTouch() {
    if (this.flowUserActed && this.state.flowStage >= 3) return;
    this.flowUserActed = true;
    this.clearFlowTimers();
    const src = this.state.flowSource || FLOW_SOURCES[0];
    this.setState({
      flowStage: 3,
      flowSource: src,
      flowLabel: src.label,
      flowGhost: null,
      flowOver: false,
      flowDrag: null,
    });
  }

  // Touch devices never fire HTML5 drag events, so dragging a source onto the
  // first step is driven by pointer events instead.
  onChipPointerDown = (chip: FlowSource, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    this.touchDrag = { chip, startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener("pointermove", this.onChipPointerMove, { passive: false });
    window.addEventListener("pointerup", this.onChipPointerUp);
    window.addEventListener("pointercancel", this.onChipPointerUp);
  };

  private pointerOverTile(x: number, y: number) {
    if (!this.flowTile) return false;
    const r = this.flowTile.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  onChipPointerMove = (e: PointerEvent) => {
    const drag = this.touchDrag;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      this.flowUserActed = true;
      this.clearFlowTimers();
      this.setState({ flowDrag: drag.chip.id, flowStage: 0, flowLabel: null, flowGhost: null });
    }
    // Keep the page still while the finger is carrying a source.
    if (e.cancelable) e.preventDefault();
    const wrap = this.flowWrap?.getBoundingClientRect();
    if (!wrap) return;
    const over = this.pointerOverTile(e.clientX, e.clientY);
    this.setState({
      touchGhost: { icon: drag.chip.icon, label: drag.chip.label, x: e.clientX - wrap.left, y: e.clientY - wrap.top },
      flowOver: over,
    });
  };

  onChipPointerUp = (e: PointerEvent) => {
    const drag = this.touchDrag;
    window.removeEventListener("pointermove", this.onChipPointerMove);
    window.removeEventListener("pointerup", this.onChipPointerUp);
    window.removeEventListener("pointercancel", this.onChipPointerUp);
    this.touchDrag = null;
    if (!drag || !drag.moved) return;
    // A drag must not also register as a tap on the chip.
    this.suppressChipClick = true;
    const dropped = this.pointerOverTile(e.clientX, e.clientY);
    this.setState({ touchGhost: null, flowDrag: null, flowOver: false });
    if (dropped) this.runFlow(drag.chip, true);
  };

  onFlowDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!this.state.flowOver) this.setState({ flowOver: true });
  };

  onFlowDragLeave = () => this.setState({ flowOver: false });

  onFlowDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
    const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
    const src =
      FLOW_SOURCES.find((s) => s.id === id) ||
      (file
        ? { ...FLOW_SOURCES[0], id: "file", icon: "📄", label: file.name }
        : FLOW_SOURCES[0]);
    this.runFlow(src, true);
  };

  selectTab(id: StudyTabId) {
    this.studyTouch();
    this.setState({ sTab: id });
    this.scrollTabIntoView(id);
  }

  /* The pill row scrolls itself to the pill that was chosen, as the app's does.
     The row is scrolled, never the page: scrollIntoView would drag the whole
     landing along with it. */
  scrollTabIntoView(id: StudyTabId) {
    const row = this.tabRow;
    const pill = this.tabEls[id];
    if (!row || !pill) return;
    const left = pill.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }

  nodeStyle(doneAt: number, options?: { pulse?: boolean; over?: boolean }): CSSProperties {
    const s = this.state;
    const done = s.flowStage >= doneAt;
    const over = Boolean(options?.over && s.flowOver);
    return {
      display: "block",
      width: "0.85rem",
      height: "0.85rem",
      borderRadius: "50%",
      background: done ? "var(--l-flow)" : "var(--l-page)",
      border: over || done ? "1px solid var(--l-flow)" : "1px solid var(--l-line)",
      boxShadow: over ? "0 0 0 10px var(--l-flow-soft)" : "none",
      transform: over ? "scale(1.5)" : done ? "scale(1.15)" : "scale(1)",
      animation:
        options?.pulse && s.flowStage === 0 && !s.flowOver
          ? "memo-node-pulse 2.4s ease-out infinite"
          : "none",
      cursor: options?.pulse ? "pointer" : undefined,
      transition: "transform 320ms cubic-bezier(0.34,1.4,0.5,1), background 300ms ease, box-shadow 260ms ease",
    };
  }

  /* The shell each step's card shares: the landing's card, the app's page inside it. */
  renderScreen(children: ReactNode, fade = true) {
    return (
      <LandingAppScope className={`landing-v2-flow-screen ${fade ? "landing-v2-flow-fade" : ""}`.trim()}>
        <LandingScaledFrame fill width={SCREEN_WIDTH}>
          {children}
        </LandingScaledFrame>
      </LandingAppScope>
    );
  }

  renderStepHead(step: 1 | 2 | 3, titleKey: MessageKey) {
    return (
      <>
        <span style={this.nodeStyle(step === 2 ? 1 : step, step === 1 ? { pulse: true, over: true } : undefined)} />
        <h3 style={{ margin: "0.35rem 0 0", color: "var(--l-label)", fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.25 }}>
          {this.props.t(titleKey)}
        </h3>
      </>
    );
  }

  /*
   * Step one is the home screen: the capture sheet's drop zone over the library,
   * where the dropped source lands as a new note row that is still being written.
   */
  renderStep1() {
    const s = this.state;
    const stage = s.flowStage;
    const { t, locale } = this.props;
    const source = s.flowSource;

    return (
      <article
        data-scroll-reveal=""
        data-flow-step="1"
        ref={(el) => {
          this.stepEls[0] = el;
        }}
        className="landing-v2-flow-step"
      >
        {this.renderStepHead(1, "flowDemo.step1Title")}
        <div
          ref={(el) => {
            this.flowTile = el;
          }}
          onDragOver={this.onFlowDragOver}
          onDragLeave={this.onFlowDragLeave}
          onDrop={this.onFlowDrop}
          onClick={() => this.runFlow(FLOW_SOURCES[0], true)}
          className="landing-v2-flow-card is-target"
          data-over={s.flowOver ? "true" : "false"}
        >
          {this.renderScreen(
            <div className="landing-v2-flow-pad">
              <div className="memo-dropzone">
                <Msym name="cloud_upload" className="memo-dropzone-icon" />
                <span className="memo-dropzone-lead">{t("capture.pickFile")}</span>
                <span className="memo-dropzone-title">{t("flowDemo.dropSubtitle")}</span>
                <span className="memo-dropzone-hint">
                  {t("capture.dropHint", { action: t("capture.pickFile") })}
                </span>
              </div>
              <div className="memo-note-list">
                {stage >= 1 && source ? (
                  <div key={`${source.id}-${s.studyRun}`} className="memo-note-row landing-v2-flow-new-row">
                    <span className="memo-note-emoji">
                      <Emoji symbol={source.icon} size="1.3rem" />
                    </span>
                    <span className="memo-note-copy">
                      <span className="memo-note-title">{t(source.noteTitleKey)}</span>
                      <span className="memo-note-meta">
                        {landingNoteMeta(t, locale, { ...source.note, writing: stage === 1 })}
                      </span>
                    </span>
                    <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
                  </div>
                ) : null}
                {PAST_NOTES.map((row) => (
                  <div key={row.titleKey} className="memo-note-row">
                    <span className="memo-note-emoji">
                      <Emoji symbol={row.icon} size="1.3rem" />
                    </span>
                    <span className="memo-note-copy">
                      <span className="memo-note-title">{t(row.titleKey)}</span>
                      <span className="memo-note-meta">{landingNoteMeta(t, locale, row.note)}</span>
                    </span>
                    <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
                  </div>
                ))}
              </div>
            </div>,
          )}
        </div>
        <p style={{ ...STATUS_BASE, color: stage >= 2 ? "var(--l-label)" : "var(--l-second)" }}>
          {stage === 0
            ? t("flowDemo.statusDragOrClick")
            : stage === 1
              ? t("flowDemo.statusTranscribing")
              : t("flowDemo.statusSourceAdded")}
        </p>
      </article>
    );
  }

  /* Step two is the note tab: the note the source became, written out block by block. */
  renderStep2() {
    const s = this.state;
    const stage = s.flowStage;
    const { t, locale } = this.props;
    const source = s.flowSource ?? FLOW_SOURCES[0];
    const written = stage >= 2 ? 7 : stage === 1 ? s.noteStep : 0;

    return (
      <article
        data-scroll-reveal=""
        data-flow-step="2"
        ref={(el) => {
          this.stepEls[1] = el;
        }}
        className="landing-v2-flow-step"
      >
        {this.renderStepHead(2, "flowDemo.step2Title")}
        <div className="landing-v2-flow-card">
          {this.renderScreen(
            <div className="landing-v2-flow-pad">
              <LandingSampleNote
                t={t}
                emoji={source.icon}
                title={t(source.noteTitleKey)}
                meta={landingNoteTitleMeta(t, locale, source.note)}
                written={written}
              />
            </div>,
          )}
        </div>
        <p style={{ ...STATUS_BASE, color: stage >= 2 ? "var(--l-label)" : "var(--l-second)" }}>
          {stage >= 2 ? t("flowDemo.statusNotesReady") : stage === 1 ? t("flowDemo.statusWritingNotes") : ""}
        </p>
      </article>
    );
  }

  /* The body under the chosen pill: the app's own screen for it. */
  renderStudyScreen() {
    const s = this.state;
    const autoplay = s.flowStage >= 3;
    const key = `${s.sTab}-${s.studyRun}`;

    switch (s.sTab) {
      case "tutor":
        return <LandingTutorDemo key={key} />;
      case "flashcards":
        return <LandingFlashcardsScreen key={key} autoplay={autoplay} />;
      case "podcast":
        return (
          <LandingPodcastScreen
            key={key}
            autoplay={autoplay}
            title={this.props.t((s.flowSource ?? FLOW_SOURCES[0]).noteTitleKey)}
          />
        );
      case "quiz":
        return <LandingQuizScreen key={key} autoplay={autoplay} />;
      case "mindmap":
        return <LandingMindmapScreen key={key} autoplay={autoplay} />;
      case "palace":
        return <LandingPalaceScreen key={key} autoplay={autoplay} />;
      case "test":
        return <LandingTestScreen key={key} autoplay={autoplay} />;
      case "speed":
        return <LandingSpeedReadScreen key={key} autoplay={autoplay} />;
    }
  }

  /*
   * Step three is the note's study side: the app's pill row, every study pill in
   * the app's order and scrollable as it is there, over the screen of the one
   * chosen.
   */
  renderStep3() {
    const s = this.state;
    const stage = s.flowStage;
    const t = this.props.t;
    const done3 = stage >= 3;

    const bodyStyle: CSSProperties = {
      opacity: done3 ? 1 : 0,
      transform: done3 ? "translateY(0)" : "translateY(8px)",
      pointerEvents: done3 ? "auto" : "none",
      /* A reader who scrolled straight to this card is looking at it now, so
         it resolves in a beat rather than easing in behind them — and the
         harder they flicked, the less of that beat is left. Floored so the
         fastest arrival still fades rather than popping. */
      transition: `opacity ${Math.max(140, Math.round(520 * this.dragScale()))}ms ease, transform ${Math.max(160, Math.round(620 * this.dragScale()))}ms cubic-bezier(0.22,1,0.36,1)`,
    };

    return (
      <article
        data-scroll-reveal=""
        data-flow-step="3"
        ref={(el) => {
          this.stepEls[2] = el;
        }}
        className="landing-v2-flow-step"
      >
        {this.renderStepHead(3, "flowDemo.step3Title")}
        <div className="landing-v2-flow-card">
          {this.renderScreen(
            <div className="landing-v2-flow-study" style={bodyStyle}>
              <div className="landing-v2-flow-pills">
                <div
                  className="memo-tabs memo-chiprow"
                  data-overflow="true"
                  ref={(el) => {
                    this.tabRow = el;
                  }}
                >
                  {STUDY_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      ref={(el) => {
                        this.tabEls[tab.id] = el;
                      }}
                      onClick={() => this.selectTab(tab.id)}
                      className={`memo-tab ${s.sTab === tab.id ? "active" : ""}`.trim()}
                      style={{ "--tab-tint": tab.tint } as CSSProperties}
                      aria-current={s.sTab === tab.id ? "page" : undefined}
                    >
                      <Msym name={tab.icon} size="1.2rem" fill={false} weight={500} />
                      <span>{t(tab.labelKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="landing-v2-flow-study-body" data-note-tab={s.sTab}>
                {this.renderStudyScreen()}
              </div>
            </div>,
            false,
          )}
        </div>
        <p style={{ ...STATUS_BASE, color: done3 ? "var(--l-label)" : "var(--l-second)" }}>
          {done3 ? t("flowDemo.statusMaterialReady") : stage === 2 ? t("flowDemo.statusBuildingMaterial") : ""}
        </p>
      </article>
    );
  }

  render() {
    const s = this.state;
    const ghost = s.flowGhost;
    const tilePct = s.flowStage >= 3 ? 1 : s.flowStage >= 1 ? 0.5 : 0;

    return (
      <div
        ref={(el) => {
          this.flowWrap = el;
          if (el && this.flowObserver && !this.flowStarted) this.flowObserver.observe(el);
        }}
        style={{ position: "relative" }}
      >
        <div style={{ display: "grid", justifyItems: "center", gap: "1.2rem", marginBottom: "3rem" }}>
          <span style={{ color: "var(--l-second)", fontSize: "0.92rem" }}>
            {this.props.t("flowDemo.dragSourceToStep")}
          </span>
          <div className="landing-v2-flow-chips">
            {FLOW_SOURCES.map((chip, i) => (
              <div
                key={chip.id}
                draggable
                ref={(el) => {
                  this.flowChipEls[i] = el;
                }}
                onDragStart={(e) => {
                  this.flowUserActed = true;
                  this.clearFlowTimers();
                  if (e.dataTransfer) {
                    e.dataTransfer.setData("text/plain", chip.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }
                  this.setState({ flowDrag: chip.id, flowStage: 0, flowLabel: null, flowGhost: null });
                }}
                onDragEnd={() => this.setState({ flowDrag: null, flowOver: false })}
                onPointerDown={(e) => this.onChipPointerDown(chip, e)}
                onClick={() => {
                  if (this.suppressChipClick) {
                    this.suppressChipClick = false;
                    return;
                  }
                  this.runFlow(chip, true);
                }}
                className="landing-v2-flow-chip"
                style={{
                  ...CHIP_BASE,
                  opacity: s.flowDrag === chip.id ? 0.35 : 1,
                  transform: s.flowDrag === chip.id ? "scale(0.95)" : "scale(1)",
                }}
              >
                <span className="landing-v2-flow-chip-icon">
                  <span className="landing-v2-flow-chip-fold" />
                  <span className="landing-v2-flow-chip-kind" style={{ color: chip.kindColor }}>
                    {chip.kind}
                  </span>
                </span>
                <span className="landing-v2-flow-chip-name">{chip.label}</span>
                <span className="landing-v2-flow-chip-sub">{chip.sub(this.props.t)}</span>
              </div>
            ))}
          </div>
        </div>

        {ghost ? (
          <div
            aria-hidden="true"
            className="landing-v2-flow-chip"
            style={{
              ...CHIP_BASE,
              position: "absolute",
              zIndex: 6,
              pointerEvents: "none",
              cursor: "default",
              left: `${ghost.left}px`,
              top: `${ghost.top}px`,
              opacity: ghost.opacity,
              transform: `translate3d(${ghost.dx}px,${ghost.dy}px,0) scale(${ghost.scale})`,
              // Must track the drag's own timings above, or a compressed run
              // would unmount the ghost before it arrives at the card.
              transition: `transform ${Math.round(700 * this.dragScale())}ms cubic-bezier(0.4,0,0.2,1), opacity ${Math.round(240 * this.dragScale())}ms ease`,
              willChange: "transform",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                width: "36px",
                height: "36px",
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                background: "var(--l-line)",
                fontSize: "15px",
              }}
            >
              {ghost.icon}
            </span>
            <span style={{ fontSize: "14.7px", fontWeight: 500, color: "var(--l-label)" }}>{ghost.label}</span>
          </div>
        ) : null}

        {s.touchGhost ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              zIndex: 7,
              left: `${s.touchGhost.x}px`,
              top: `${s.touchGhost.y}px`,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 0.7rem",
              borderRadius: "999px",
              border: "1px solid var(--l-line)",
              background: "var(--l-surface)",
              boxShadow: "var(--l-shadow), 0 12px 28px rgba(0,0,0,0.28)",
              pointerEvents: "none",
              transform: "translate3d(-50%, -50%, 0) scale(0.95)",
              willChange: "transform",
            }}
          >
            <span style={{ fontSize: "15px" }}>{s.touchGhost.icon}</span>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--l-label)", whiteSpace: "nowrap" }}>
              {s.touchGhost.label}
            </span>
          </div>
        ) : null}

        <div className="landing-v2-flow-grid">
          <div
            aria-hidden="true"
            style={{ position: "absolute", top: "0.44rem", left: "16%", right: "16%", height: "1px", background: "var(--l-line)" }}
          />
          <div aria-hidden="true" className="landing-v2-flow-fill" style={{ width: `${68 * tilePct}%` }} />

          {this.renderStep1()}
          {this.renderStep2()}
          {this.renderStep3()}
        </div>
      </div>
    );
  }
}

export function LandingFlowDemo(props: Omit<FlowDemoProps, "t" | "locale">) {
  const { t, locale } = useTranslations();
  return <LandingFlowDemoView {...props} t={t} locale={locale} />;
}
