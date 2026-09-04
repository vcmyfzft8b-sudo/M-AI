"use client";

/*
 * The interactive phone mockup in the landing hero.
 *
 * It is a transcription of the redesign's own phone artboard —
 * `MemoMobile.dc.html`, the 390×844 document bundled inside
 * "Memo AI Desktop Redesign (standalone).html" — rather than a sketch of it:
 * the tokens, the sizes, the Material Symbols and the screen structure are the
 * artboard's, so what the hero shows is the app people actually get. It is
 * written as a self-contained component (its own `--m-` tokens, inline styles)
 * because it renders inside the landing page, which has a palette of its own
 * and must not load the app's stylesheet.
 *
 * It runs a guided tour on its own; any user interaction stops the tour and
 * hands the phone over.
 */

import Image from "next/image";

import { useTranslations } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Locale } from "@/lib/i18n/locales";
import type { Translate } from "@/lib/i18n/translate";
import { formatCalendarDate } from "@/lib/utils";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Component } from "react";

import { Emoji, Msym } from "@/components/msym";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, SEO_BRAND_NAME } from "@/lib/brand";

import { LandingStudyResult } from "./landing-study-result";
import { LandingTutorDemo } from "./landing-tutor-demo";
import { PREVIEW_STOP_TOUR_EVENT, PREVIEW_TOUR_STOPPED_EVENT } from "./memo-app-preview-events";

import {
  blockStyle,
  completionPct,
  type BodyLine,
  CAPTURE,
  type CaptureMode,
  type ChatMessage,
  CREATE_OPTIONS,
  DARK_TOKENS,
  initialFolders,
  HELP_SECTIONS,
  initialNotes,
  LIGHT_TOKENS,
  resolveNoteBody,
  type NoteBlock,
  type NoteTab,
  type PreviewFolder,
  type PreviewNote,
  type PreviewTheme,
  readWordStyle,
  PREVIEW_TODAY,
  SOURCE_LABEL_KEYS,
  SUB_SCREEN_TITLE_KEYS,
  TABS,
  THEME_OPTIONS,
  resolveThemeStudy,
  tokenizeBody,
} from "./memo-app-preview-data";

/* The artboard is 390×844 with a 48px corner; every number below is its own,
   converted from rem at the 16px root it is drawn against. */
const PHONE_W = 390;
const PHONE_H = 844;
const STATUS_H = 54;
/* The screen plus the bezel and the case around it — what actually has to fit. */
const FRAME_W = PHONE_W + 24 + 7;
const FRAME_H = PHONE_H + 24 + 7;

/*
 * The attempts the demo learner already has behind them. The app's results
 * screen reports a submitted test against its own history — an average, a best
 * and a worst — and a demo with no history would show that panel empty.
 */
const PREVIEW_TEST_HISTORY = [64, 82];

/* The flashcard's own box, and the throw distance the design tunes against. */
const CARD_W = 353;
const CARD_H = 416;
const CARD_DRAG_TRIGGER = 120;

type TapState = { x: number; y: number; n: number } | null;
type CursorState = { x: number; y: number; press: boolean; seen: boolean; drag?: boolean } | null;

type Screen = "home" | "note" | "sub" | "capture";
type Sheet = "create" | "folders" | "newFolder" | "actions" | "rename" | "delete" | "settings" | "support" | "chat";

type PreviewProps = {
  autoTour?: boolean;
  /**
   * The translator, as a prop rather than a hook: this is a class component,
   * and the wrapper at the foot of the file is what reads the context. Only
   * the replica's own chrome goes through it — the study material it displays
   * stays in the language it was written in, as `memo-app-preview-data.ts`
   * explains.
   */
  t: Translate<MessageKey>;
  /** For `Intl`, which the replica's date column goes through as the app does. */
  locale: Locale;
};

type PreviewState = {
  scale: number;
  measured: boolean;
  screen: Screen;
  sheet: Sheet | null;
  sheetClosing: boolean;
  noteId: string | null;
  notes: PreviewNote[];
  query: string;
  captureMode: CaptureMode;
  captureText: string;
  recordSeconds: number;
  tab: NoteTab;
  cardPos: number;
  cardFlipped: boolean;
  cardAnswers: Record<number, "easy" | "again">;
  cardsDone: boolean;
  /*
   * A round of study is a queue and a cycle number, exactly as the app runs it:
   * the first round is every card and every question, and "repeat the ones you
   * missed" starts a second round over just those. Null is the full set, which
   * keeps the queue out of the way until somebody actually misses something.
   */
  reviewQueue: number[] | null;
  cardCycle: number;
  quizNo: number;
  quizPick: number | null;
  quizQueue: number[] | null;
  quizCycle: number;
  quizMissed: number[];
  quizDone: boolean;
  testNo: number;
  testAnswers: Record<number, string>;
  testFocused: boolean;
  testDone: boolean;
  cardDragX: number;
  cardDragging: boolean;
  cardExit: "easy" | "again" | null;
  exitX: number;
  exitY: number;
  exitRot: number;
  /* Bumped per swipe so the clone remounts and its animation replays — two
     swipes the same way would otherwise reuse a finished animation. */
  exitToken: number;
  tap: TapState;
  cursor: CursorState;
  reading: boolean;
  readPaused: boolean;
  readWord: number;
  headP: number;
  swipeId: string | null;
  swipeX: number;
  swipeDragging: boolean;
  folderId: string | null;
  folders: PreviewFolder[];
  targetId: string | null;
  renameValue: string;
  newFolderName: string;
  theme: PreviewTheme;
  dragKey: string | null;
  dragOffset: number;
  chatDraft: string;
  chat: ChatMessage[];
};

/* ── Shared pieces of the artboard ────────────────────────────── */

/* `.scroll` masks: the home list fades in from under the floating top bar. */
const HOME_SCROLL_MASK = "linear-gradient(to bottom, transparent 0, transparent 33.6px, #000 62.4px)";
/* The chip rows fade out at their right edge instead of being cut. */
const CHIPROW_MASK = "linear-gradient(90deg, #000 0, #000 calc(100% - 35.2px), transparent 100%)";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/* The round white control: back, actions, settings, close. */
function roundBtn(size: number): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${size}px`,
    height: `${size}px`,
    flex: "0 0 auto",
    padding: 0,
    border: 0,
    borderRadius: "999px",
    background: "var(--m-surface)",
    color: "var(--m-label)",
    boxShadow: "var(--m-shadow)",
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

/* The tile circle a sheet's close button sits on. */
function tileBtn(size: number): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${size}px`,
    height: `${size}px`,
    flex: "0 0 auto",
    padding: 0,
    border: 0,
    borderRadius: "999px",
    background: "var(--m-tile)",
    color: "var(--m-label)",
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

/* The coral commit: "Nov zapisek", "Ustvari zapisek", "Nova mapa". */
function coralPill(extra?: CSSProperties): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    height: "56.8px",
    border: 0,
    borderRadius: "999px",
    background: "linear-gradient(135deg, #ff6d68, #f45f5a)",
    color: "#ffffff",
    boxShadow: "0 12px 24px rgba(244,95,90,0.24)",
    fontFamily: "inherit",
    fontSize: "17.92px",
    fontWeight: 700,
    cursor: "pointer",
    ...extra,
  };
}

/* The tile-grey secondary: every "Prekliči". */
function ghostPill(height: number): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    height: `${height}px`,
    border: 0,
    borderRadius: "999px",
    background: "var(--m-tile)",
    color: "var(--m-label)",
    fontFamily: "inherit",
    fontSize: "16.32px",
    fontWeight: 650,
    cursor: "pointer",
  };
}

/* `.memo-sheet-option`, `.memo-folder-row`, the settings rows: one surface. */
const SURFACE_CARD: CSSProperties = {
  borderRadius: "20px",
  background: "var(--m-surface)",
  boxShadow: "var(--m-shadow)",
  overflow: "hidden",
};

/* The grabber every bottom sheet carries. */
const GRAB = (
  <div
    data-sheet-handle
    aria-hidden="true"
    style={{
      width: "41.6px",
      height: "5.12px",
      margin: "0 auto 14.4px",
      borderRadius: "999px",
      background: "var(--m-second)",
      opacity: 0.5,
      cursor: "grab",
    }}
  />
);

/* The wider grab zone the full-height sheets use. */
const GRAB_WIDE = (
  <div
    data-sheet-handle
    aria-hidden="true"
    style={{ width: "54.4px", height: "25.6px", margin: "6.4px auto -6.4px", padding: "9.6px 0", cursor: "grab" }}
  >
    <span
      style={{
        display: "block",
        width: "41.6px",
        height: "5.12px",
        margin: "0 auto",
        borderRadius: "999px",
        background: "var(--m-second)",
        opacity: 0.5,
      }}
    />
  </div>
);

/* A sheet's centred title with its close at the right edge. */
function sheetTitle(
  title: string,
  closeLabel: string,
  onClose: () => void,
  marginBottom = 17.6,
): ReactNode {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: `${marginBottom}px` }}>
      <span style={{ fontSize: "20px", fontWeight: 750, letterSpacing: "-0.03em" }}>{title}</span>
      <button type="button" aria-label={closeLabel} onClick={onClose} style={{ ...tileBtn(46.4), position: "absolute", right: 0 }}>
        <Msym name="close" size="23.2px" fill={false} weight={500} />
      </button>
    </div>
  );
}

/* A grouped card's hairline: transparent above the first row. */
function divider(first: boolean, dark: boolean): string {
  if (first) return "transparent";
  return dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)";
}

class MemoAppPreviewView extends Component<PreviewProps, PreviewState> {
  /*
   * Built in the constructor rather than as a field initialiser: the sample
   * library is in the reader's language, and the translator arrives as a prop.
   */
  state: PreviewState;

  constructor(props: PreviewProps) {
    super(props);
    this.state = {
      scale: 0.82,
      measured: false,
      screen: "home",
      sheet: null,
      sheetClosing: false,
      noteId: null,
      notes: initialNotes(props.t),
      query: "",
      captureMode: "upload",
      captureText: "",
      recordSeconds: 0,
      tab: "notes",
      cardPos: 0,
      cardFlipped: false,
      cardAnswers: {},
      cardsDone: false,
      reviewQueue: null,
      cardCycle: 1,
      quizNo: 1,
      quizPick: null,
      quizQueue: null,
      quizCycle: 1,
      quizMissed: [],
      quizDone: false,
      testNo: 1,
      testAnswers: {},
      testFocused: false,
      testDone: false,
      cardDragX: 0,
      cardDragging: false,
      cardExit: null,
      exitX: 0,
      exitY: 0,
      exitRot: 0,
      exitToken: 0,
      tap: null,
      cursor: null,
      reading: false,
      readPaused: false,
      readWord: 0,
      headP: 0,
      swipeId: null,
      swipeX: 0,
      swipeDragging: false,
      folderId: null,
      folders: initialFolders(props.t),
      targetId: null,
      renameValue: "",
      newFolderName: "",
      theme: "system",
      dragKey: null,
      dragOffset: 0,
      chatDraft: "",
      chat: [],
    };
  }

  private mount: HTMLDivElement | null = null;
  private stage: HTMLDivElement | null = null;
  private timers: number[] = [];
  private tourTimers: number[] = [];
  private touring = false;
  private stopTour: (() => void) | null = null;
  private readTimer: number | null = null;
  private cardTourRaf: number | null = null;
  private cardRaf: number | null = null;
  private dragMoved = false;
  private dragId = -1;
  private dragStart = 0;
  private dragWidth = CARD_W;
  private cardExitTimer: number | null = null;
  private suppressTap = false;
  private resizeObserver: ResizeObserver | null = null;
  private viewObserver: IntersectionObserver | null = null;
  private tourStarted = false;
  private tourDismissed = false;
  private onResize: (() => void) | null = null;
  private onStopRequest: (() => void) | null = null;
  private closeTimer: number | null = null;
  private tabsRow: HTMLDivElement | null = null;
  private centredTab: string | null = null;

  componentDidMount() {
    this.measure();
    this.onResize = () => this.measure();
    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined" && this.mount) {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this.mount);
      if (this.mount.parentElement) this.resizeObserver.observe(this.mount.parentElement);
    }
    if (typeof IntersectionObserver !== "undefined" && this.mount) {
      this.viewObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting || this.tourStarted) return;
            this.tourStarted = true;
            this.startAutoTour();
          });
        },
        { threshold: 0.25 },
      );
      this.viewObserver.observe(this.mount);
    }
    this.onStopRequest = () => this.dismissTour();
    window.addEventListener(PREVIEW_STOP_TOUR_EVENT, this.onStopRequest);
  }

  componentDidUpdate() {
    this.centreActiveTab();
  }

  componentWillUnmount() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.tourTimers.forEach((id) => window.clearTimeout(id));
    if (this.readTimer) window.clearInterval(this.readTimer);
    if (this.cardTourRaf) window.cancelAnimationFrame(this.cardTourRaf);
    if (this.cardRaf) window.cancelAnimationFrame(this.cardRaf);
    if (this.closeTimer) window.clearTimeout(this.closeTimer);
    if (this.cardExitTimer) window.clearTimeout(this.cardExitTimer);
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    if (this.onStopRequest) window.removeEventListener(PREVIEW_STOP_TOUR_EVENT, this.onStopRequest);
    this.resizeObserver?.disconnect();
    this.viewObserver?.disconnect();
    this.detachTourListeners();
  }

  /* Hand the mockup over to the visitor. Safe to call before the tour has
     started, so the callout can dismiss it at any point. */
  dismissTour() {
    this.tourDismissed = true;
    this.tourStarted = true;
    if (this.stopTour) {
      this.stopTour();
      return;
    }
    window.dispatchEvent(new Event(PREVIEW_TOUR_STOPPED_EVENT));
  }

  measure() {
    if (!this.mount) return;
    // Walk up past any shrink-to-fit box (whose width the phone itself sets)
    // to the first ancestor that actually constrains it.
    let node: HTMLElement | null = this.mount;
    let available = 0;
    for (let i = 0; i < 4 && node; i += 1) {
      available = Math.max(available, node.clientWidth || 0);
      node = node.parentElement;
    }
    if (available < 120) return;
    // Cap the scale by the viewport so the whole mockup stays visible.
    const stacked = window.innerWidth < 800;
    // Narrow screens keep side breathing room.
    const widthCap = stacked ? (window.innerWidth * 0.68) / FRAME_W : 0.82;
    // Fit the phone (plus nav and callout) in the viewport only on the
    // side-by-side hero. On phones innerHeight changes as the browser chrome
    // collapses, which would resize the mockup mid-scroll.
    const heightCap = stacked ? 0.82 : (window.innerHeight - 250) / FRAME_H;
    const maxScale = Math.max(0.42, Math.min(0.82, widthCap, heightCap));
    const raw = Math.max(0.42, Math.min(maxScale, (available - 6) / FRAME_W));
    // Quantize so sub-pixel container changes cannot nudge the size.
    const next = Math.round(raw * 200) / 200;
    if (!this.state.measured || Math.abs(next - this.state.scale) > 0.001) {
      this.setState({ scale: next, measured: true });
    }
  }

  startAutoTour() {
    if (this.props.autoTour === false || !this.mount || this.tourDismissed || this.touring) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.touring = true;
    // Clear rather than drop: an already-scheduled script would otherwise keep
    // firing alongside the new one, and the two would fight over the screen.
    this.tourTimers.forEach((id) => window.clearTimeout(id));
    this.tourTimers = [];
    this.stopTour = () => {
      if (!this.touring) return;
      this.touring = false;
      this.tourDismissed = true;
      this.tourTimers.forEach((id) => window.clearTimeout(id));
      this.tourTimers = [];
      if (this.cardTourRaf) {
        window.cancelAnimationFrame(this.cardTourRaf);
        this.cardTourRaf = null;
      }
      // Freeze in place: stop advancing, keep the current screen and highlight.
      if (this.readTimer) {
        window.clearInterval(this.readTimer);
        this.readTimer = null;
      }
      this.setState((c) => ({
        tap: null,
        cursor: null,
        cardDragging: false,
        readPaused: c.reading || c.readPaused,
        reading: false,
      }));
      window.dispatchEvent(new Event(PREVIEW_TOUR_STOPPED_EVENT));
    };
    (["pointerdown", "wheel", "keydown", "touchstart"] as const).forEach((type) =>
      this.mount?.addEventListener(type, this.stopTour as EventListener, { passive: true }),
    );

    this.runTourScript();
  }

  detachTourListeners() {
    if (!this.stopTour || !this.mount) return;
    (["pointerdown", "wheel", "keydown", "touchstart"] as const).forEach((type) =>
      this.mount?.removeEventListener(type, this.stopTour as EventListener),
    );
  }

  /*
   * The stage is drawn at 1:1 and scaled down as a whole, so a pointer delta —
   * which arrives in screen pixels — has to be divided by that scale before it
   * is used as a translate inside the stage. Without this the card trails the
   * finger by the scale factor, which reads as drag lag.
   */
  toStage(px: number): number {
    return px / (this.state.scale || 1);
  }

  appMain(): HTMLElement | null {
    return this.stage ? this.stage.querySelector("[data-app-main]") : null;
  }

  later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  /* ── The tour's own pointer ───────────────────────────────── */

  tapAt(selector: string, index: number) {
    if (!this.touring || !this.stage) return;
    const nodes = this.stage.querySelectorAll(selector);
    const node = nodes[index || 0];
    if (!node) return;
    const stageRect = this.stage.getBoundingClientRect();
    const scale = stageRect.width / (this.stage.offsetWidth || stageRect.width);
    const rect = node.getBoundingClientRect();
    const x = (rect.left + rect.width / 2 - stageRect.left) / scale;
    const y = (rect.top + rect.height / 2 - stageRect.top) / scale;
    const first = !this.state.cursor;
    this.setState((c) => ({ cursor: { x, y, press: false, seen: Boolean(c.cursor) } }));
    const land = first ? 60 : 520;
    this.tourTimers.push(
      window.setTimeout(() => {
        this.setState((c) => ({
          tap: { x, y, n: ((c.tap && c.tap.n) || 0) + 1 },
          cursor: c.cursor ? { ...c.cursor, press: true } : c.cursor,
        }));
      }, land),
    );
    this.tourTimers.push(window.setTimeout(() => this.setState({ tap: null }), land + 640));
  }

  scrollIntoTour(selector: string, index: number) {
    if (!this.touring || !this.stage) return;
    const main = this.appMain();
    const el = this.stage.querySelectorAll(selector)[index || 0];
    if (!main || !el) return;
    const r = el.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    const top = main.scrollTop + (r.top - mr.top) - (main.clientHeight - r.height) / 2;
    main.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  tapThen(selector: string, index: number, fn: () => void) {
    const first = !this.state.cursor;
    this.tapAt(selector, index);
    this.tourTimers.push(
      window.setTimeout(() => {
        if (this.touring) fn();
      }, (first ? 60 : 520) + 150),
    );
  }

  /* ── The tour's script ────────────────────────────────────── */

  runTourScript() {
    const step = (ms: number, fn: () => void) => {
      this.tourTimers.push(
        window.setTimeout(() => {
          if (this.touring) fn();
        }, ms),
      );
    };

    let at = 0;
    const doAt = (ms: number, fn: () => void) => {
      at += ms;
      step(at, fn);
    };

    const tourNoteId = "tour-note";

    doAt(1300, () => this.tapThen('[data-tap="create"]', 0, () => this.setState({ sheet: "create" })));
    doAt(1900, () =>
      this.tapThen('[data-tap="create-option"]', 1, () =>
        this.setState({ sheet: null, screen: "capture", captureMode: "upload", captureText: CAPTURE.upload.pickedText ?? "" }),
      ),
    );
    doAt(2100, () =>
      this.tapThen('[data-tap="capture-cta"]', 0, () =>
        this.setState((s) => ({
          screen: "home",
          notes: [
            {
              id: tourNoteId,
              emoji: "🔊",
              theme: "is",
              title: this.props.t(CAPTURE.upload.noteTitleKey),
              source: "audio",
              date: PREVIEW_TODAY,
              status: "queued",
            },
            ...s.notes,
          ],
        })),
      ),
    );
    doAt(2000, () => this.updateStatus(tourNoteId, "transcribing"));
    doAt(2800, () => this.updateStatus(tourNoteId, "generating_notes"));
    doAt(2600, () => this.updateStatus(tourNoteId, "ready"));
    doAt(1600, () =>
      this.tapThen('[data-tap="note"]', 0, () =>
        this.setState({ screen: "note", noteId: tourNoteId, tab: "notes", readWord: 0, readPaused: false }),
      ),
    );

    /* The listen pill: the dock opens into its player and reads the note. */
    doAt(1600, () => this.tapThen('[data-tap="listen"]', 0, () => this.toggleRead()));
    doAt(11000, () => {
      if (this.state.reading) this.toggleRead();
      this.setState({ reading: false, readPaused: false, readWord: 0 });
    });

    /*
     * The tutor: open it, start the walkthrough, let it get through a turn and
     * the question the learner cuts in with, then leave. The replica keeps its
     * own state, so the tour presses its button rather than driving it — a
     * synthetic click, which the tour's own pointerdown listeners ignore.
     */
    doAt(1200, () => this.tapThen('[data-tap="tab"]', 1, () => this.selectTab("tutor")));
    doAt(1800, () =>
      this.tapThen('[data-tap="tutor-start"]', 0, () =>
        this.stage?.querySelector<HTMLButtonElement>('[data-tap="tutor-start"]')?.click(),
      ),
    );
    doAt(15500, () => {});

    /* Flashcards: flip, then swipe the card away — twice known, once not. */
    doAt(900, () => this.tapThen('[data-tap="tab"]', 2, () => this.selectTab("flashcards")));
    for (let c = 0; c < 3; c += 1) {
      const easy = c !== 1;
      doAt(1800, () => this.tapThen('[data-tap="card"]', 0, () => this.flipCard()));
      doAt(2000, () => this.animateCardDrag(easy ? 1 : -1, 460));
      doAt(1300, () => {});
    }

    /* Kviz: answer each question correctly, so it advances on its own. */
    doAt(2200, () => this.tapThen('[data-tap="tab"]', 3, () => this.selectTab("quiz")));
    for (let q = 0; q < 2; q += 1) {
      doAt(2000, () => {
        const { correct } = this.quizQuestion();
        this.tapThen('[data-tap="quiz-opt"]', correct, () => this.pickQuiz(correct));
      });
      doAt(1400, () => {});
    }

    /* Test: type an answer, then move on. */
    doAt(2200, () => this.tapThen('[data-tap="tab"]', 4, () => this.selectTab("test")));
    const answer = this.props.t("pv.tourAnswer");
    /*
     * Tap into the answer box, and only start writing once the press has
     * actually landed. The pointer takes ~520ms to travel and `tapThen` runs
     * its callback 150ms after that, so the wait here has to clear ~670ms —
     * typing sooner filled a field the cursor had not reached yet.
     */
    doAt(900, () => this.tapThen('[data-tap="answer"]', 0, () => this.setState({ testFocused: true })));
    doAt(900, () => {});
    for (let i = 1; i <= answer.length; i += 2) {
      const chunk = answer.slice(0, i);
      const pause = /[ ,.]/.test(answer[i - 1] || "") ? 110 : 42;
      doAt(pause, () => this.setState((c) => ({ testAnswers: { ...c.testAnswers, [c.testNo]: chunk } })));
    }
    doAt(1000, () => this.tapThen('[data-tap="test-next"]', 0, () => this.nextTest()));
    doAt(2600, () => {});

    /* Back out to the library, then start over. */
    doAt(1200, () => this.tapThen('[data-tap="sub-back"]', 0, () => this.setState({ screen: "note", tab: "notes" })));
    doAt(1400, () => this.tapThen('[data-tap="note-back"]', 0, () => this.setState({ screen: "home" })));
    doAt(2400, () => {
      this.setState({
        screen: "home",
        sheet: null,
        noteId: null,
        notes: initialNotes(this.props.t),
        tab: "notes",
        ...this.studyReset(),
        readWord: 0,
        reading: false,
        readPaused: false,
        tap: null,
        captureText: "",
      });
      this.tourTimers.forEach((id) => window.clearTimeout(id));
      this.tourTimers = [];
      this.tourTimers.push(
        window.setTimeout(() => {
          if (this.touring) this.runTourScript();
        }, 1400),
      );
    });
  }

  /* ── Gestures ─────────────────────────────────────────────── */

  /* A note row slides left to reveal Uredi / Izbriši behind it. */
  startRowSwipe(event: ReactPointerEvent, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startOffset = this.state.swipeId === id ? this.state.swipeX : 0;
    let dragging = false;
    this.suppressTap = false;

    const move = (e: PointerEvent) => {
      const dx = this.toStage(e.clientX - startX);
      const dy = this.toStage(e.clientY - startY);
      if (!dragging && (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy))) return;
      dragging = true;
      this.suppressTap = true;
      this.setState({ swipeId: id, swipeX: Math.min(0, Math.max(-144, startOffset + dx)), swipeDragging: true });
    };

    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!dragging) {
        if (this.state.swipeId === id && this.state.swipeX < 0) {
          this.suppressTap = true;
          this.setState({ swipeId: null, swipeX: 0, swipeDragging: false });
        }
        return;
      }
      const open = this.state.swipeX < -72;
      this.setState({ swipeId: open ? id : null, swipeX: open ? -144 : 0, swipeDragging: false });
      this.later(() => {
        this.suppressTap = false;
      }, 60);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  /*
   * The collapsing home header, the way the app does it: `headP` runs 0 → 1
   * over the first 80px of scroll and the title fades out. The search field
   * does not fold — it scrolls away at full size. The range is fixed rather
   * than derived from the scroll height, which would feed the collapse back
   * into the scroll metrics.
   *
   * The header does not snap to either end of the range either, for the same
   * reason the app does not: writing `scrollTop` once the finger is gone reads
   * as the list lurching on its own a beat after you let go.
   */
  onHomeScroll = (event: { currentTarget: HTMLDivElement }) => {
    const el = event.currentTarget;
    const p = Math.max(0, Math.min(1, el.scrollTop / 80));
    if (Math.abs(p - this.state.headP) > 0.01) this.setState({ headP: p });
  };

  /* Every bottom sheet tracks the finger and dismisses past 110px. */
  sheetDragStart(event: ReactPointerEvent, key: string, close: () => void) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    const handle = target instanceof Element ? target.closest("[data-sheet-handle]") : null;
    const interactive = target instanceof Element ? target.closest("button, a, input, textarea, select, label") : null;
    if (interactive && !handle) return;

    const startY = event.clientY;
    let offset = 0;

    const move = (e: PointerEvent) => {
      offset = Math.max(0, this.toStage(e.clientY - startY));
      this.setState({ dragKey: key, dragOffset: offset });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (offset > 110) {
        this.setState({ dragKey: null, dragOffset: 0 });
        close();
        return;
      }
      this.setState({ dragKey: null, dragOffset: 0 });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  /* The sheet shells: `sheetStyle` and `fullSheetStyle` from the artboard. */
  sheetProps(key: string, close: () => void, extra?: CSSProperties) {
    const dragging = this.state.dragKey === key;
    const offset = dragging ? this.state.dragOffset : 0;
    const closing = this.state.sheetClosing;
    return {
      onPointerDown: (event: ReactPointerEvent) => this.sheetDragStart(event, key, close),
      style: {
        position: "absolute",
        inset: "auto 0 0 0",
        zIndex: 6,
        padding: "9.6px 18.4px 32px",
        maxHeight: `${PHONE_H - STATUS_H}px`,
        overflowY: "auto",
        borderRadius: "34px 34px 0 0",
        background: "var(--m-bg)",
        boxShadow: "var(--m-shadow-lg)",
        touchAction: "none",
        ...(closing
          ? {
              transform: "translateY(105%)",
              opacity: 0.85,
              transition: "transform 0.26s cubic-bezier(0.4,0,0.9,0.4), opacity 0.22s ease",
            }
          : {
              transform: offset ? `translateY(${offset}px)` : "translateY(0)",
              transition: dragging ? "none" : "transform 0.42s cubic-bezier(0.32,1.3,0.5,1)",
              animation: "memo-sheet-up 0.34s cubic-bezier(0.22,1,0.36,1)",
            }),
        ...extra,
      } as CSSProperties,
    };
  }

  fullSheetProps(key: string, close: () => void, surface: boolean) {
    const dragging = this.state.dragKey === key;
    const offset = dragging ? this.state.dragOffset : 0;
    const closing = this.state.sheetClosing;
    return {
      onPointerDown: (event: ReactPointerEvent) => this.sheetDragStart(event, key, close),
      style: {
        position: "absolute",
        inset: `${STATUS_H}px 0 0 0`,
        zIndex: 7,
        display: "flex",
        flexDirection: "column",
        borderRadius: "34px 34px 0 0",
        background: surface ? "var(--m-surface)" : "var(--m-bg)",
        boxShadow: "var(--m-shadow-lg)",
        overflow: "hidden",
        touchAction: "pan-y",
        ...(closing
          ? {
              transform: "translateY(105%)",
              opacity: 0.9,
              transition: "transform 0.26s cubic-bezier(0.4,0,0.9,0.4), opacity 0.22s ease",
            }
          : {
              transform: offset ? `translateY(${offset}px)` : "translateY(0)",
              transition: dragging ? "none" : "transform 0.42s cubic-bezier(0.32,1.3,0.5,1)",
              animation: "memo-sheet-up 0.36s cubic-bezier(0.22,1,0.36,1)",
            }),
      } as CSSProperties,
    };
  }

  /* ── Note, study and reading state ────────────────────────── */

  activeNote(): PreviewNote | undefined {
    return this.state.notes.find((n) => n.id === this.state.noteId) ?? this.state.notes[0];
  }

  studyData() {
    return resolveThemeStudy(this.activeNote()?.theme ?? "is", this.props.t);
  }

  noteBlocks(): NoteBlock[] {
    return resolveNoteBody(this.activeNote()?.theme ?? "is", this.props.t);
  }

  bodyLines(): BodyLine[] {
    return tokenizeBody(this.noteBlocks());
  }

  isDark(): boolean {
    if (this.state.theme === "dark") return true;
    if (this.state.theme === "light") return false;
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /* Every study screen back at its first round, first item, nothing answered. */
  studyReset() {
    return {
      quizNo: 1,
      quizPick: null,
      quizQueue: null,
      quizCycle: 1,
      quizMissed: [],
      quizDone: false,
      cardPos: 0,
      cardFlipped: false,
      cardAnswers: {},
      cardsDone: false,
      cardExit: null,
      reviewQueue: null,
      cardCycle: 1,
      testNo: 1,
      testDone: false,
      testAnswers: {},
      testFocused: false,
    } satisfies Partial<PreviewState>;
  }

  /* The tab pills. Zapiski is the note screen; the rest are their own. */
  selectTab(tab: NoteTab) {
    if (tab === "notes") {
      this.setState({ tab: "notes", screen: "note" });
      return;
    }
    this.setState({ tab, screen: "sub", ...this.studyReset() });
  }

  toggleRead() {
    if (this.state.reading) {
      if (this.readTimer) window.clearInterval(this.readTimer);
      this.readTimer = null;
      this.setState({ reading: false, readPaused: true });
      return;
    }

    const total = this.bodyLines().reduce((n, line) => n + line.words.length, 0);
    this.setState((c) => ({
      reading: true,
      readPaused: false,
      readWord: (c.readWord || 0) >= total - 1 ? 0 : c.readWord || 0,
    }));
    if (this.readTimer) window.clearInterval(this.readTimer);
    this.readTimer = window.setInterval(() => {
      this.setState((c) => {
        const next = (c.readWord || 0) + 1;
        if (next >= total) {
          if (this.readTimer) window.clearInterval(this.readTimer);
          this.readTimer = null;
          return { reading: false, readPaused: true, readWord: total - 1 };
        }
        return { readWord: next } as Pick<PreviewState, "readWord">;
      });
    }, 420);
  }

  stopRead() {
    if (this.readTimer) window.clearInterval(this.readTimer);
    this.readTimer = null;
    this.setState({ reading: false, readPaused: false, readWord: 0 });
  }

  /* ── Flashcards ───────────────────────────────────────────── */

  /* The cards this round asks about: everything, or just the ones missed last. */
  cardQueue(): number[] {
    return this.state.reviewQueue ?? this.studyData().cards.map((_, i) => i);
  }

  /* The same, for the quiz. `quizNo` is a position in here, not in the set. */
  quizQueue(): number[] {
    return this.state.quizQueue ?? this.studyData().quiz.map((_, i) => i);
  }

  /* The question the quiz is on. */
  quizQuestion() {
    const queue = this.quizQueue();
    return this.studyData().quiz[queue[Math.min(this.state.quizNo, queue.length) - 1]];
  }

  flipCard() {
    if (this.dragMoved || this.state.cardExit) return;
    this.setState((c) => ({ cardFlipped: !c.cardFlipped }));
  }

  /*
   * The swipe, as the app plays it: the answer is recorded and the deck moves
   * on in the same commit that starts the exit, so the card under the finger is
   * already the next question while a blank clone carries the old one off from
   * exactly where it was let go. Advancing afterwards instead would park the
   * old card back at centre for the length of the animation, which is what made
   * the release read as a stutter.
   */
  swipeCard(answer: "easy" | "again", releaseDx?: number) {
    if (this.state.cardExit) return;
    const dx = releaseDx === undefined ? this.state.cardDragX : releaseDx;
    const width = this.dragWidth || CARD_W;
    const queue = this.cardQueue();
    this.setState((c) => {
      const last = c.cardPos >= queue.length - 1;
      return {
        cardAnswers: { ...c.cardAnswers, [queue[c.cardPos]]: answer },
        cardExit: answer,
        // Percentages, so the clone's keyframes stay resolution-independent.
        exitX: (dx / width) * 100,
        exitY: ((-Math.abs(dx) * 0.04) / CARD_H) * 100,
        exitRot: Math.max(-8, Math.min(8, (dx / CARD_DRAG_TRIGGER) * 8)),
        exitToken: c.exitToken + 1,
        cardFlipped: false,
        cardDragX: 0,
        cardDragging: false,
        cardsDone: last,
        cardPos: last ? c.cardPos : c.cardPos + 1,
      };
    });
    if (this.cardExitTimer) window.clearTimeout(this.cardExitTimer);
    this.cardExitTimer = window.setTimeout(() => this.setState({ cardExit: null }), 200);
  }

  onCardDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (this.state.cardExit) return;
    this.dragId = event.pointerId;
    this.dragMoved = false;
    this.dragStart = event.clientX;
    // Unscaled, so the trigger below is in the same units as the drag.
    this.dragWidth = event.currentTarget.offsetWidth || CARD_W;
    // Capture, so a finger that leaves the card still steers it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not every pointer can be captured; the drag still works without it */
    }
    this.setState({ cardDragging: true, cardDragX: 0 });
  };

  onCardMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!this.state.cardDragging || this.dragId !== event.pointerId) return;
    const dx = this.toStage(event.clientX - this.dragStart);
    if (Math.abs(dx) > 8) this.dragMoved = true;
    this.setState({ cardDragX: dx });
  };

  onCardUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!this.state.cardDragging) return;
    const dx = this.state.cardDragX;
    // Scales with the card, within bounds, so the throw feels the same at any size.
    const trigger = Math.min(150, Math.max(88, (this.dragWidth || CARD_W) * 0.28));
    this.setState({ cardDragging: false, cardDragX: 0 });
    if (Math.abs(dx) >= trigger) {
      this.swipeCard(dx > 0 ? "easy" : "again", dx);
      return;
    }
    // Release the capture so a tap still reaches the face and flips it.
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* nothing was captured */
    }
    this.later(() => {
      this.dragMoved = false;
    }, 80);
  };

  onCardCancel = () => this.setState({ cardDragging: false, cardDragX: 0 });

  /* The tour swipes a card the way a thumb would, then lets go. */
  animateCardDrag(dir: number, duration: number) {
    if (this.cardTourRaf) window.cancelAnimationFrame(this.cardTourRaf);
    const startedAt = performance.now();
    const reach = 190;
    let base: { x: number; y: number } | null = null;
    if (this.stage) {
      const node = this.stage.querySelector('[data-tap="card"]');
      if (node) {
        const stageRect = this.stage.getBoundingClientRect();
        const scale = stageRect.width / (this.stage.offsetWidth || stageRect.width);
        const rect = node.getBoundingClientRect();
        base = {
          x: (rect.left + rect.width / 2 - stageRect.left) / scale,
          y: (rect.top + rect.height / 2 - stageRect.top) / scale,
        };
      }
    }
    const tick = (now: number) => {
      if (!this.touring) return;
      const t = Math.min(1, (now - startedAt) / duration);
      // Ease-in-out with a small hesitation, like a real thumb.
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const wobble = Math.sin(t * Math.PI * 2) * 5 * (1 - t);
      const dx = dir * (e * reach + wobble);
      this.setState((c) => ({
        cardDragging: true,
        cardDragX: dx,
        cursor: base ? { x: base.x + dx, y: base.y - Math.abs(dx) * 0.04, press: true, seen: true, drag: true } : c.cursor,
      }));
      if (t < 1) {
        this.cardTourRaf = window.requestAnimationFrame(tick);
        return;
      }
      this.cardTourRaf = null;
      this.swipeCard(dir > 0 ? "easy" : "again", dir * reach);
    };
    this.cardTourRaf = window.requestAnimationFrame(tick);
  }

  /* ── Kviz and test ────────────────────────────────────────── */

  pickQuiz(index: number) {
    if (this.state.quizPick !== null) return;
    const queue = this.quizQueue();
    const questionId = queue[this.state.quizNo - 1];
    const correct = index === this.quizQuestion().correct;
    this.setState((c) => ({
      quizPick: index,
      quizMissed: correct ? c.quizMissed : [...c.quizMissed, questionId],
    }));
    // Correct answers move on by themselves; a miss stops at the sheet.
    if (correct) this.later(() => this.nextQuiz(), 780);
  }

  nextQuiz() {
    const total = this.quizQueue().length;
    this.setState((c) =>
      c.quizNo >= total ? { quizDone: true, quizNo: c.quizNo, quizPick: null } : { quizDone: false, quizNo: c.quizNo + 1, quizPick: null },
    );
  }

  nextTest() {
    const total = this.studyData().practice.length;
    this.setState((c) =>
      c.testNo >= total
        ? { testDone: true, testNo: c.testNo, testFocused: false }
        : { testDone: false, testNo: c.testNo + 1, testFocused: false },
    );
  }

  /* ── Library actions ──────────────────────────────────────── */

  updateStatus(id: string, status: PreviewNote["status"]) {
    this.setState((s) => ({ notes: s.notes.map((note) => (note.id === id ? { ...note, status } : note)) }));
  }

  addNote() {
    const spec = CAPTURE[this.state.captureMode];
    const id = `n${Date.now()}`;
    this.setState((s) => ({
      screen: "home",
      captureText: "",
      notes: [
        {
          id,
          emoji: spec.emoji,
          title: this.props.t(spec.noteTitleKey),
          theme: "is",
          source: spec.source,
          date: PREVIEW_TODAY,
          status: "queued",
        },
        ...s.notes,
      ],
    }));
    this.later(() => this.updateStatus(id, "transcribing"), 1400);
    this.later(() => this.updateStatus(id, "generating_notes"), 3200);
    this.later(() => this.updateStatus(id, "ready"), 5200);
  }

  saveRename() {
    const title = this.state.renameValue.trim();
    if (!title) return;
    this.setState((c) => ({
      notes: c.notes.map((note) => (note.id === c.targetId ? { ...note, title } : note)),
      sheet: null,
      targetId: null,
      renameValue: "",
    }));
  }

  sendChat() {
    const text = this.state.chatDraft.trim();
    if (!text) return;
    this.setState((s) => ({ chatDraft: "", chat: [...s.chat, { role: "user", text }] }));
    this.later(() => {
      this.setState((s) => ({ chat: [...s.chat, { role: "assistant", text: this.studyData().chatReply }] }));
    }, 900);
  }

  /* ── Screens ──────────────────────────────────────────────── */

  /* The phone's own status bar, above every screen. */
  renderStatusBar() {
    return (
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: `${STATUS_H}px`,
          padding: "0 32px 0 35.2px",
          fontSize: "16.32px",
          fontWeight: 650,
          letterSpacing: "-0.02em",
          flex: "0 0 auto",
        }}
      >
        <span>12:45</span>
        <span style={{ display: "flex", alignItems: "center", gap: "6.4px" }}>
          <Msym name="signal_cellular_alt" size="16.8px" />
          <Msym name="wifi" size="16.8px" />
          <Msym name="battery_full" size="18.4px" />
        </span>
      </div>
    );
  }

  renderHome(visible: PreviewNote[]) {
    const s = this.state;
    const folderLabel = s.folders.find((f) => f.id === s.folderId)?.name ?? this.props.t("folders.allNotes");
    const headP = s.headP;

    return (
      <div style={{ position: "absolute", inset: `${STATUS_H}px 0 0 0`, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            position: "absolute",
            top: "8px",
            left: "18.4px",
            right: "18.4px",
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pointerEvents: "none",
          }}
        >
          {/* Above the fold and inside a transformed, masked box, where a lazy
              image is not reliably triggered — so it is fetched eagerly. */}
          <Image
            src={BRAND_LOCKUP_SRC}
            alt={SEO_BRAND_NAME}
            width={BRAND_LOCKUP_WIDTH}
            height={BRAND_LOCKUP_HEIGHT}
            priority
            style={{ position: "relative", zIndex: 1, height: "49.6px", width: "auto", objectFit: "contain" }}
          />
          <button
            type="button"
            aria-label={this.props.t("nav.settings")}
            data-tap="settings"
            onClick={() => this.setState({ sheet: "settings" })}
            style={{ ...roundBtn(49.6), position: "relative", zIndex: 1, pointerEvents: "auto" }}
          >
            <Msym name="settings" size="25.6px" fill={false} weight={500} />
          </button>
        </div>

        <div
          data-app-main
          onScroll={this.onHomeScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "64px 0 192px",
            maskImage: HOME_SCROLL_MASK,
            WebkitMaskImage: HOME_SCROLL_MASK,
          }}
        >
          {/* The title fades away over the first 80px of scroll — see
              `onHomeScroll`. Both it and the search field scroll with the list
              rather than being pinned, so the scroll metrics never change under
              the fade, and the opaque folder bar below passes over them. */}
          <h1
            style={{
              position: "relative",
              zIndex: 3,
              background: "var(--m-bg)",
              margin: "7.2px 18.4px 0",
              fontSize: "21.6px",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1.3,
              height: "33.6px",
              overflow: "hidden",
              opacity: clamp01(1 - headP * 1.9),
              transition: "opacity 0.1s linear",
            }}
          >
            {this.props.t("library.myNotes")}
          </h1>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "11.2px",
              margin: "12.8px 18.4px 0",
              padding: "0 16.8px",
              height: "44px",
              borderRadius: "999px",
              background: "var(--m-field)",
              overflow: "hidden",
              position: "relative",
              zIndex: 3,
            }}
          >
            <Msym
              name="search"
              size="20.8px"
              fill={false}
              weight={600}
              style={{ color: "var(--m-label)" }}
            />
            <input
              value={s.query}
              onChange={(e) => this.setState({ query: e.target.value })}
              placeholder={this.props.t("library.search.placeholderLong")}
              style={{
                width: "100%",
                minWidth: 0,
                border: 0,
                background: "transparent",
                outline: "none",
                color: "var(--m-label)",
                fontFamily: "inherit",
                fontSize: "16.32px",
                letterSpacing: "-0.02em",
              }}
            />
          </div>

          <div style={{ position: "relative", zIndex: 3, padding: "13.6px 18.4px 8.8px", background: "var(--m-bg)" }}>
            <button
              type="button"
              onClick={() => this.setState({ sheet: "folders" })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8.8px",
                height: "43.2px",
                padding: "0 14.4px 0 12px",
                border: 0,
                borderRadius: "999px",
                background: "var(--m-surface)",
                color: "var(--m-label)",
                boxShadow: "var(--m-shadow)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              <Emoji symbol="📁" size="17.6px" />
              <span style={{ fontSize: "16.32px", fontWeight: 700, letterSpacing: "-0.025em" }}>{folderLabel}</span>
              <Msym name="expand_more" size="19.2px" fill={false} weight={500} />
            </button>
          </div>

          <div style={{ padding: "0 18.4px" }}>
            <div style={{ display: "grid", gap: "11.2px" }}>
              {visible.map((note) => {
                const open = s.swipeId === note.id;
                const offset = open ? s.swipeX : 0;
                return (
                  <div key={note.id} style={{ position: "relative", borderRadius: "20px", animation: "memo-row-in 0.32s cubic-bezier(0.22,1,0.36,1) both" }}>
                    <div
                      role="link"
                      tabIndex={0}
                      data-tap="note"
                      onPointerDown={(event) => this.startRowSwipe(event, note.id)}
                      onClick={() => {
                        if (this.suppressTap) {
                          this.suppressTap = false;
                          return;
                        }
                        if (open) {
                          this.setState({ swipeId: null, swipeX: 0 });
                          return;
                        }
                        if (note.status !== "ready") return;
                        this.setState({ screen: "note", noteId: note.id, tab: "notes", readWord: 0, readPaused: false });
                      }}
                      style={{
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: "14.4px",
                        width: "100%",
                        padding: "15.2px 19.2px",
                        borderRadius: "20px",
                        background: "var(--m-surface)",
                        boxShadow: "var(--m-shadow)",
                        color: "var(--m-label)",
                        cursor: "grab",
                        userSelect: "none",
                        touchAction: "pan-y",
                        transform: `translateX(${offset}px)`,
                        transition: s.swipeDragging && open ? "none" : "transform 180ms cubic-bezier(0.22,1,0.36,1)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          width: "48px",
                          height: "48px",
                          flex: "0 0 auto",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "999px",
                          background: "var(--m-tile)",
                        }}
                      >
                        <Emoji symbol={note.emoji} size="21.6px" />
                      </span>
                      <span style={{ display: "grid", gap: "3.2px", minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: "17.28px", fontWeight: 650, letterSpacing: "-0.025em", lineHeight: 1.25 }}>
                          {note.title}
                        </span>
                        <span style={{ color: "var(--m-second)", fontSize: "14.72px", letterSpacing: "-0.015em" }}>
                          {note.status === "ready"
                            ? `${formatCalendarDate(note.date, this.props.locale)} • ${this.props.t(SOURCE_LABEL_KEYS[note.source])}`
                            : this.props.t("note.generating")}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={this.props.t("preview.noteActions")}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          this.suppressTap = false;
                          this.setState(
                            open
                              ? { swipeId: null, swipeX: 0, swipeDragging: false }
                              : { swipeId: note.id, swipeX: -144, swipeDragging: false },
                          );
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flex: "0 0 auto",
                          width: "32px",
                          height: "32px",
                          marginRight: "-5.6px",
                          padding: 0,
                          border: 0,
                          borderRadius: "999px",
                          background: "transparent",
                          color: "var(--m-second)",
                          cursor: "pointer",
                          opacity: open ? 0.9 : 0.55,
                          transition: "opacity 0.2s ease",
                        }}
                      >
                        <Msym name="chevron_right" size="20px" fill={false} weight={500} />
                      </button>
                    </div>

                    <div
                      style={{
                        position: "absolute",
                        inset: "0 0 0 auto",
                        zIndex: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: "5.6px",
                        width: "130.4px",
                        paddingLeft: "5.6px",
                        pointerEvents: open || offset < 0 ? "auto" : "none",
                      }}
                    >
                      <button
                        type="button"
                        aria-label={this.props.t("common.edit")}
                        onClick={() => this.setState({ sheet: "rename", targetId: note.id, renameValue: note.title, swipeId: null, swipeX: 0 })}
                        style={{
                          display: "grid",
                          alignContent: "center",
                          justifyItems: "center",
                          gap: "4.8px",
                          flex: "0 0 59.2px",
                          width: "59.2px",
                          padding: 0,
                          border: 0,
                          background: "transparent",
                          color: "var(--m-second)",
                          fontFamily: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "40px",
                            height: "40px",
                            borderRadius: "999px",
                            background: "var(--m-tile)",
                          }}
                        >
                          <Emoji symbol="✏️" size="17.6px" />
                        </span>
                        <span style={{ fontSize: "11.52px", fontWeight: 650 }}>{this.props.t("common.edit")}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={this.props.t("common.delete")}
                        onClick={() => this.setState({ sheet: "delete", targetId: note.id, swipeId: null, swipeX: 0 })}
                        style={{
                          display: "grid",
                          alignContent: "center",
                          justifyItems: "center",
                          gap: "4.8px",
                          flex: "0 0 59.2px",
                          width: "59.2px",
                          padding: 0,
                          border: 0,
                          background: "transparent",
                          color: "#ff3b30",
                          fontFamily: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "40px",
                            height: "40px",
                            borderRadius: "999px",
                            background: "rgba(255,59,48,0.12)",
                          }}
                        >
                          <Emoji symbol="🗑️" size="17.6px" />
                        </span>
                        <span style={{ fontSize: "11.52px", fontWeight: 650 }}>{this.props.t("common.delete")}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {visible.length === 0 ? (
              <div style={{ display: "grid", justifyItems: "center", gap: "8px", padding: "56px 16px" }}>
                <Emoji symbol="📝" size="32px" />
                <p style={{ margin: 0, fontSize: "16.8px", fontWeight: 650 }}>
                  {s.query ? this.props.t("library.empty.noMatchTitle") : this.props.t("preview.folderEmptyTitle")}
                </p>
                <p style={{ margin: 0, color: "var(--m-second)", fontSize: "15.2px", textAlign: "center" }}>
                  {s.query ? this.props.t("library.empty.noMatchBody") : this.props.t("preview.folderEmptyBody")}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            inset: "auto 18.4px 30.4px 18.4px",
            zIndex: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14.4px",
          }}
        >
          <button
            type="button"
            aria-label={this.props.t("chat.label")}
            onClick={() => this.setState({ sheet: "chat" })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56.8px",
              height: "56.8px",
              flex: "0 0 auto",
              padding: 0,
              border: "2px solid var(--m-line)",
              borderRadius: "999px",
              background: "var(--m-surface)",
              color: "var(--m-label)",
              boxShadow: "var(--m-shadow)",
              cursor: "pointer",
            }}
          >
            <Msym name="chat_bubble" size="25.6px" fill={false} weight={500} />
          </button>
          <button
            type="button"
            data-tap="create"
            onClick={() => this.setState({ sheet: "create" })}
            style={coralPill({
              flex: "0 0 auto",
              minWidth: "198.4px",
              padding: "0 20.8px",
              border: "2px solid rgba(0,0,0,0.2)",
              gap: "9.6px",
            })}
          >
            <Msym name="edit_square" size="22.4px" fill={false} weight={500} />
            <span style={{ fontSize: "17.92px", fontWeight: 650 }}>{this.props.t("library.newNote")}</span>
          </button>
        </div>
      </div>
    );
  }

  activeTabId(): NoteTab {
    return this.state.screen === "note" ? "notes" : this.state.tab;
  }

  /*
   * Bring the pill that is on into view, the way the design's `tabsRef` does:
   * centred where there is room, clamped to the ends. Only when the selection
   * actually changes, so a row the visitor has scrolled by hand stays put.
   */
  centreActiveTab() {
    const el = this.tabsRow;
    const active = this.activeTabId();
    if (!el || this.centredTab === active) return;
    this.centredTab = active;
    const on = el.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!on) return;
    const target = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
    const left = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
    if (Math.abs(el.scrollLeft - left) > 2) el.scrollTo({ left, behavior: "smooth" });
  }

  /* The chip row of note tabs, shared by the note and study screens. */
  renderTabs(margin: string, padding: string) {
    const active = this.activeTabId();
    return (
      <div
        ref={(node) => {
          this.tabsRow = node;
          if (node) this.centreActiveTab();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "9.6px",
          margin,
          padding,
          overflowX: "auto",
          scrollbarWidth: "none",
          scrollBehavior: "smooth",
          maskImage: CHIPROW_MASK,
          WebkitMaskImage: CHIPROW_MASK,
        }}
      >
        {TABS.map((tab) => {
          const on = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-tap="tab"
              data-tab={tab.id}
              onClick={() => this.selectTab(tab.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7.2px",
                flex: "0 0 auto",
                height: "35.2px",
                padding: "0 13.6px",
                border: 0,
                borderRadius: "999px",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "var(--m-label)",
                background: on ? `color-mix(in oklch, ${tab.tint} 16%, var(--m-surface))` : "var(--m-surface)",
                boxShadow: on ? `inset 0 0 0 1.5px ${tab.tint}` : "var(--m-shadow)",
                transition: "background 0.18s ease, transform 0.18s ease",
              }}
            >
              <Msym name={tab.icon} size="18.4px" fill={false} weight={500} style={{ color: tab.tint }} />
              <span style={{ fontSize: "15.2px", fontWeight: 750, letterSpacing: "-0.025em", whiteSpace: "nowrap" }}>
                {this.props.t(tab.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  /* The note itself: chrome, tabs, title, body, and the dock beneath. */
  renderNote() {
    const s = this.state;
    const note = this.activeNote();
    const lines = this.bodyLines();
    const reading = s.reading || s.readPaused;
    const dark = this.isDark();
    const total = lines.reduce((n, line) => n + line.words.length, 0);
    const elapsed = (() => {
      const seconds = Math.round((s.readWord / Math.max(1, total)) * 214);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    })();

    return (
      <div style={{ position: "absolute", inset: `${STATUS_H}px 0 0 0`, display: "flex", flexDirection: "column", background: "var(--m-bg)" }}>
        <div
          style={{
            position: "relative",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "8px 18.4px 11.2px",
          }}
        >
          <button type="button" aria-label={this.props.t("common.back")} data-tap="note-back" onClick={() => this.setState({ screen: "home" })} style={roundBtn(46.4)}>
            <Msym name="arrow_back" size="24px" fill={false} weight={500} />
          </button>
          <Emoji symbol={note?.emoji ?? "📝"} size="24px" />
          <button type="button" aria-label={this.props.t("note.actions")} onClick={() => this.setState({ sheet: "actions", targetId: note?.id ?? null })} style={roundBtn(46.4)}>
            <Msym name="more_horiz" size="21.6px" />
          </button>
        </div>

        <div data-app-main style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "3.2px 18.4px 112px" }}>
          {this.renderTabs("1.6px -18.4px 14.4px", "2.4px 18.4px 8px")}

          <h1 style={{ margin: "0 0 12px", fontSize: "26.4px", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.18 }}>
            {note?.title ?? ""}
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: "13.6px", marginBottom: "17.6px" }}>
            <span
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                color: "var(--m-second)",
                fontSize: "14.72px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {note ? `${formatCalendarDate(note.date, this.props.locale)} • ${this.props.t(SOURCE_LABEL_KEYS[note.source])}` : ""}
            </span>
          </div>

          <div style={{ marginTop: "25.6px", WebkitUserSelect: "text", userSelect: "text" }}>
            {lines.map((line, i) => (
              <div key={i} style={blockStyle(line.kind)}>
                {line.kind === "li" ? "•  " : null}
                {line.words.map((word, wi) => (
                  // The word alone carries the mark; the space after it stays
                  // outside, so a run of spoken words reads as word-shaped
                  // chips rather than one band with ragged ends.
                  <span key={word.index}>
                    {wi === 0 ? null : " "}
                    <span
                      style={readWordStyle(
                        reading ? (word.index === s.readWord ? "cur" : word.index < s.readWord ? "read" : "") : "",
                        dark,
                      )}
                    >
                      {word.text}
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* The dock: a listen pill that grows into a player, and the way into
            chat, trading the row's width between them. */}
        <div style={{ position: "absolute", inset: "auto 18.4px 25.6px 18.4px", zIndex: 4, display: "flex", alignItems: "center", gap: "11.2px" }}>
          <div
            style={{
              position: "relative",
              flex: "0 0 auto",
              height: "54.4px",
              borderRadius: "999px",
              background: "var(--m-surface)",
              boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
              width: reading ? "calc(100% - 65.6px)" : "54.4px",
              maxWidth: "calc(100% - 65.6px)",
              transition: "width 0.38s cubic-bezier(0.32,0.72,0,1)",
            }}
          >
            <button
              type="button"
              aria-label={this.props.t("readAloud.listen")}
              data-tap="listen"
              onClick={() => this.toggleRead()}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                border: 0,
                borderRadius: "999px",
                background: "transparent",
                color: "var(--m-label)",
                cursor: "pointer",
                opacity: reading ? 0 : 1,
                pointerEvents: reading ? "none" : "auto",
                transition: `opacity 0.2s ease ${reading ? "0s" : "0.1s"}`,
              }}
            >
              <Msym name="headphones" size="24.8px" fill={false} weight={500} />
            </button>

            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                gap: "4.8px",
                padding: "0 6.4px",
                opacity: reading ? 1 : 0,
                pointerEvents: reading ? "auto" : "none",
                transition: `opacity 0.2s ease ${reading ? "0.1s" : "0s"}`,
              }}
            >
              <button
                type="button"
                aria-label={this.props.t("preview.playReading")}
                onClick={() => this.toggleRead()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "41.6px",
                  height: "41.6px",
                  flex: "0 0 auto",
                  padding: 0,
                  border: 0,
                  borderRadius: "999px",
                  background: "var(--m-label)",
                  color: "var(--m-bg)",
                  cursor: "pointer",
                }}
              >
                <Msym name={s.reading ? "pause" : "play_arrow"} size="21.6px" />
              </button>
              <span style={{ display: "block", flex: 1, minWidth: 0, height: "3px", margin: "0 9.6px", borderRadius: "999px", background: "var(--m-field)" }}>
                <span
                  style={{
                    display: "block",
                    width: `${Math.round((s.readWord / Math.max(1, total)) * 100)}%`,
                    height: "100%",
                    borderRadius: "999px",
                    background: "var(--m-label)",
                    transition: "width 0.2s linear",
                  }}
                />
              </span>
              <span style={{ flex: "0 0 auto", color: "var(--m-second)", fontSize: "13.76px", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
                {elapsed}
              </span>
              <button
                type="button"
                aria-label={this.props.t("readAloud.speedGroup")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "41.6px",
                  height: "41.6px",
                  flex: "0 0 auto",
                  marginLeft: "8px",
                  padding: "0 7.2px",
                  border: 0,
                  borderRadius: "999px",
                  background: "var(--m-tile)",
                  color: "var(--m-label)",
                  fontFamily: "inherit",
                  fontSize: "15.04px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                1x
              </button>
              <button
                type="button"
                aria-label={this.props.t("readAloud.close")}
                onClick={() => this.stopRead()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "41.6px",
                  height: "41.6px",
                  flex: "0 0 auto",
                  padding: 0,
                  border: 0,
                  borderRadius: "999px",
                  background: "transparent",
                  color: "var(--m-second)",
                  cursor: "pointer",
                }}
              >
                <Msym name="close" size="19.2px" />
              </button>
            </div>
          </div>

          <button
            type="button"
            aria-label={this.props.t("chat.mobileBar")}
            onClick={() => this.setState({ sheet: "chat" })}
            style={{
              position: "relative",
              flex: "0 0 auto",
              marginLeft: "auto",
              height: "54.4px",
              padding: 0,
              border: 0,
              borderRadius: "999px",
              cursor: "pointer",
              overflow: "hidden",
              fontFamily: "inherit",
              textAlign: "left",
              color: "var(--m-second)",
              width: reading ? "54.4px" : "calc(100% - 65.6px)",
              background: reading ? "#17171a" : "var(--m-surface)",
              boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
              transition: "width 0.38s cubic-bezier(0.32,0.72,0,1), background 0.3s ease",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: "18.4px",
                right: "54.4px",
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "16.8px",
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                opacity: reading ? 0 : 1,
                transition: "opacity 0.18s ease",
              }}
            >
              {this.props.t("chat.mobileBar")}
            </span>
            <span
              style={{
                position: "absolute",
                top: "6.4px",
                right: "6.4px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "41.6px",
                height: "41.6px",
                borderRadius: "999px",
                background: "#17171a",
                color: "#fff",
              }}
            >
              <Msym name="mic" size="21.6px" style={{ position: "absolute", opacity: reading ? 0 : 1, transition: "opacity 0.2s ease" }} />
              <Msym
                name="chat_bubble"
                size="21.6px"
                style={{ position: "absolute", opacity: reading ? 1 : 0, transition: "opacity 0.2s ease" }}
              />
            </span>
          </button>
        </div>
      </div>
    );
  }

  /* Each study mode is its own screen, as the design draws it: the same
     chrome, its own title, and a chat bar along the bottom. */
  renderSub() {
    const s = this.state;
    const subScreenTitleKey = SUB_SCREEN_TITLE_KEYS[s.tab];
    const done =
      (s.tab === "flashcards" && s.cardsDone) ||
      (s.tab === "quiz" && s.quizDone) ||
      (s.tab === "test" && s.testDone);

    return (
      <div style={{ position: "absolute", inset: `${STATUS_H}px 0 0 0`, display: "flex", flexDirection: "column", background: "var(--m-bg)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "8px 18.4px 12.8px" }}>
          <button
            type="button"
            aria-label={this.props.t("common.back")}
            data-tap="sub-back"
            onClick={() => this.setState({ screen: "note", tab: "notes" })}
            style={roundBtn(46.4)}
          >
            <Msym name="arrow_back" size="24px" fill={false} weight={500} />
          </button>
          <span style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: "17.92px", fontWeight: 750, letterSpacing: "-0.03em" }}>
            {subScreenTitleKey ? this.props.t(subScreenTitleKey) : ""}
          </span>
          <button
            type="button"
            aria-label={this.props.t("note.actions")}
            onClick={() => this.setState({ sheet: "actions", targetId: this.activeNote()?.id ?? null })}
            style={roundBtn(46.4)}
          >
            <Msym name="more_horiz" size="21.6px" />
          </button>
        </div>

        {this.renderTabs("0 0 9.6px", "2.4px 18.4px 6.4px")}

        <div data-app-main style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18.4px 128px" }}>
          {s.tab === "tutor" ? this.renderTutor() : null}
          {done ? this.renderResults() : null}
          {!done && s.tab === "flashcards" ? this.renderCards() : null}
          {!done && s.tab === "quiz" ? this.renderQuiz() : null}
          {!done && s.tab === "test" ? this.renderTest() : null}
          {s.tab === "transcript" ? this.renderTranscript() : null}
        </div>

        {s.tab === "quiz" && s.quizPick !== null && s.quizPick !== this.quizQuestion().correct
          ? this.renderQuizMiss()
          : null}

        {/* Only the reading screens carry a chat bar; the design leaves the
            three study screens to their own controls. */}
        {s.tab === "transcript" ? (
        <div
          style={{
            position: "absolute",
            inset: "auto 18.4px 25.6px 18.4px",
            display: "flex",
            alignItems: "center",
            gap: "9.6px",
            height: "57.6px",
            padding: "0 9.6px 0 19.2px",
            borderRadius: "999px",
            background: "var(--m-field)",
          }}
        >
          <input
            readOnly
            placeholder={this.props.t("chat.title")}
            onFocus={() => this.setState({ sheet: "chat" })}
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              background: "transparent",
              outline: "none",
              color: "var(--m-label)",
              fontFamily: "inherit",
              fontSize: "16.8px",
              letterSpacing: "-0.02em",
            }}
          />
          <button
            type="button"
            aria-label={this.props.t("preview.dictate")}
            onClick={() => this.setState({ sheet: "chat" })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "43.2px",
              height: "43.2px",
              border: 0,
              borderRadius: "999px",
              background: "var(--m-surface)",
              color: "var(--m-label)",
              cursor: "pointer",
            }}
          >
            <Msym name="mic" size="21.6px" />
          </button>
        </div>
        ) : null}
      </div>
    );
  }

  renderCards() {
    const s = this.state;
    const cards = this.studyData().cards;
    const queue = this.cardQueue();
    const card = cards[queue[s.cardPos] ?? 0];
    const next = queue[s.cardPos + 1];
    const dragX = s.cardDragging ? s.cardDragX : 0;
    const progress = Math.min(1, Math.abs(dragX) / CARD_DRAG_TRIGGER);
    const dragRotation = Math.max(-8, Math.min(8, (dragX / CARD_DRAG_TRIGGER) * 8));
    /*
     * The verdict only exists once the card has actually travelled, exactly as
     * `flashcardDragDirection` does in the app. Deriving it from the sign alone
     * would call a resting card "easy" — `-0 >= 0` is true in JavaScript — so
     * the first frame of a leftward drag painted the green tick before flipping
     * to the red cross, and the overlay's colour transition stretched that into
     * a visible flash.
     */
    const dragVerdict = Math.abs(dragX) > 4 ? (dragX < 0 ? "again" : "easy") : null;
    const missed = Object.values(s.cardAnswers).filter((a) => a === "again").length;
    const known = Object.values(s.cardAnswers).filter((a) => a === "easy").length;
    const face: CSSProperties = {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "11.2px",
      minHeight: "416px",
      padding: "32px 27.2px",
      border: 0,
      borderRadius: "26px",
      cursor: "pointer",
      fontFamily: "inherit",
      color: "var(--m-label)",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
      background: "var(--m-surface)",
    };
    const navBtn = (enabled: boolean): CSSProperties => ({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "52.8px",
      height: "52.8px",
      flex: "0 0 auto",
      padding: 0,
      border: 0,
      borderRadius: "999px",
      background: "var(--m-tile)",
      color: "var(--m-label)",
      cursor: enabled ? "pointer" : "default",
      opacity: enabled ? 1 : 0.4,
    });
    const verdict = (again: boolean): CSSProperties => ({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "7.2px",
      minWidth: "86.4px",
      height: "52.8px",
      flex: "0 0 auto",
      padding: "0 17.6px",
      border: 0,
      borderRadius: "999px",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "16.8px",
      fontWeight: 750,
      background: again ? "rgba(244,95,90,0.14)" : "rgba(22,163,74,0.12)",
      color: again ? "#f45f5a" : "#16a34a",
    });

    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "16px" }}>
          <span style={{ fontSize: "22.4px", fontWeight: 800, letterSpacing: "-0.03em" }}>{this.props.t("study.cards.cardN", { index: s.cardPos + 1 })}</span>
          <span style={{ color: "var(--m-second)", fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            {this.props.t("study.cards.remaining", { count: queue.length - s.cardPos - 1 })}
          </span>
        </div>
        <div style={{ position: "relative", height: "16.8px", margin: "12.8px 0 0", borderRadius: "999px", background: "var(--m-field)" }}>
          <div
            style={{
              width: `${Math.round((s.cardPos / Math.max(1, queue.length)) * 100)}%`,
              height: "100%",
              borderRadius: "999px",
              background: "var(--m-label)",
              transition: "width 0.32s cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </div>

        <div style={{ position: "relative", marginTop: "67.2px" }}>
          {next !== undefined ? (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "11.2px",
                minHeight: "416px",
                padding: "32px 27.2px",
                borderRadius: "26px",
                background: "var(--m-surface)",
                boxShadow: "var(--m-shadow)",
                pointerEvents: "none",
                transform: `translateY(${(14 - Math.min(14, Math.abs(dragX) * 0.12)).toFixed(1)}px) scale(${(0.955 + Math.min(0.045, Math.abs(dragX) * 0.0004)).toFixed(3)})`,
                transition: s.cardDragging || s.cardExit ? "none" : "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              <span style={{ fontSize: "20.8px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.32, textAlign: "center", opacity: 0.5 }}>
                {cards[next].front}
              </span>
            </div>
          ) : null}

          <div style={{ position: "relative", zIndex: 2, perspective: "1400px" }}>
            <div
              data-tap="card"
              onPointerDown={this.onCardDown}
              onPointerMove={this.onCardMove}
              onPointerUp={this.onCardUp}
              onPointerCancel={this.onCardCancel}
              onClick={() => this.flipCard()}
              style={{
                position: "relative",
                touchAction: "pan-y",
                cursor: "grab",
                transform: `translate3d(${dragX.toFixed(1)}px, ${(-Math.abs(dragX) * 0.04).toFixed(1)}px, 0) rotate(${dragRotation.toFixed(2)}deg)`,
                transition: s.cardDragging || s.cardExit ? "none" : "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              <div
                style={{
                  position: "relative",
                  minHeight: "416px",
                  transformStyle: "preserve-3d",
                  transform: s.cardFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                  transition: s.cardExit ? "none" : "transform 0.36s cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                <div style={{ ...face, boxShadow: "var(--m-shadow)", transform: "translateZ(1px)" }}>
                  <span style={{ fontSize: "20.8px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.32, textAlign: "center" }}>
                    {card.front}
                  </span>
                  <span style={{ color: "var(--m-second)", fontSize: "19.2px", letterSpacing: "-0.02em" }}>{this.props.t("study.cards.flipMobile")}</span>
                </div>
                <div
                  style={{
                    ...face,
                    transform: "rotateY(180deg) translateZ(1px)",
                    boxShadow: "var(--m-shadow), inset 0 0 0 1px var(--m-line)",
                  }}
                >
                  <span style={{ fontSize: "19.52px", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.42, textAlign: "center" }}>
                    {card.back}
                  </span>
                  <span style={{ color: "var(--m-second)", fontSize: "19.2px", letterSpacing: "-0.02em" }}>{this.props.t("study.cards.flipMobile")}</span>
                </div>
              </div>
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "24px",
                  pointerEvents: "none",
                  transition: "opacity 0.12s linear, background-color 0.12s ease, color 0.12s ease",
                  opacity: s.cardDragging && dragVerdict ? progress : 0,
                  background:
                    dragVerdict === "again"
                      ? "var(--m-drag-again-bg)"
                      : dragVerdict === "easy"
                        ? "var(--m-drag-easy-bg)"
                        : "transparent",
                  color:
                    dragVerdict === "again"
                      ? "var(--m-drag-again-ink)"
                      : dragVerdict === "easy"
                        ? "var(--m-drag-easy-ink)"
                        : "transparent",
                }}
              >
                <Emoji symbol={dragVerdict === "again" ? "❌" : "✅"} size="36px" />
              </div>
            </div>

            {s.cardExit ? (
              <div
                key={s.exitToken}
                aria-hidden="true"
                style={{
                  ["--ex" as string]: `${s.exitX.toFixed(2)}%`,
                  ["--ey" as string]: `${s.exitY.toFixed(2)}%`,
                  ["--er" as string]: `${s.exitRot.toFixed(2)}deg`,
                  position: "absolute",
                  inset: 0,
                  zIndex: 3,
                  display: "grid",
                  placeItems: "center",
                  minHeight: "416px",
                  borderRadius: "26px",
                  pointerEvents: "none",
                  animation: `memo-card-exit-${s.cardExit === "again" ? "left" : "right"} 0.185s cubic-bezier(0.22,0.61,0.36,1) forwards`,
                  background: s.cardExit === "again" ? "var(--m-exit-again-bg)" : "var(--m-exit-easy-bg)",
                  boxShadow:
                    s.cardExit === "again"
                      ? "inset 0 0 0 1.5px var(--m-exit-again-line)"
                      : "inset 0 0 0 1.5px var(--m-exit-easy-line)",
                }}
              >
                <Emoji symbol={s.cardExit === "again" ? "❌" : "✅"} size="36px" />
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "9.6px", marginTop: "25.6px" }}>
          <button
            type="button"
            aria-label={this.props.t("study.cards.previous")}
            onClick={() => this.setState((c) => ({ cardPos: Math.max(0, c.cardPos - 1), cardFlipped: false }))}
            style={navBtn(s.cardPos > 0)}
          >
            <Msym name="arrow_back" size="22.4px" fill={false} weight={500} />
          </button>
          <button type="button" aria-label={this.props.t("preview.cards.again")} onClick={() => this.swipeCard("again")} style={verdict(true)}>
            <Msym name="close" size="22.4px" />
            <span>{missed}</span>
          </button>
          <button type="button" aria-label={this.props.t("preview.cards.know")} onClick={() => this.swipeCard("easy")} style={verdict(false)}>
            <span>{known}</span>
            <Msym name="check" size="22.4px" />
          </button>
          <button
            type="button"
            aria-label={this.props.t("study.cards.next")}
            onClick={() => this.setState((c) => ({ cardPos: Math.min(queue.length - 1, c.cardPos + 1), cardFlipped: false }))}
            style={navBtn(s.cardPos < queue.length - 1)}
          >
            <Msym name="arrow_forward" size="22.4px" fill={false} weight={500} />
          </button>
        </div>
      </div>
    );
  }

  renderQuiz() {
    const s = this.state;
    const total = this.quizQueue().length;
    const q = this.quizQuestion();
    const revealed = s.quizPick !== null;

    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "16px" }}>
          <span style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.03em" }}>{this.props.t("quiz.questionN", { index: s.quizNo })}</span>
          <span style={{ color: "var(--m-second)", fontSize: "15.68px", fontWeight: 650 }}>
            {s.quizNo} / {total}
          </span>
        </div>
        <div style={{ height: "12px", margin: "11.2px 0 22.4px", borderRadius: "999px", background: "var(--m-field)" }}>
          <div
            style={{
              width: `${Math.round((s.quizNo / total) * 100)}%`,
              height: "100%",
              borderRadius: "999px",
              background: "var(--m-label)",
              transition: "width 0.32s cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </div>
        <div style={{ animation: `memo-q-in-${s.quizNo % 2 ? "a" : "b"} 0.3s cubic-bezier(0.22,1,0.36,1) both` }}>
          <p style={{ margin: "0 0 20.8px", fontSize: "21.6px", fontWeight: 750, letterSpacing: "-0.03em", lineHeight: 1.3 }}>
            {q.question}
          </p>
          <div style={{ display: "grid", gap: "12px" }}>
            {q.options.map((label, index) => {
              const correct = index === q.correct;
              const picked = s.quizPick === index;
              const state = !revealed ? "idle" : correct ? "correct" : picked ? "wrong" : "idle";
              return (
                <button
                  key={label}
                  type="button"
                  data-tap="quiz-opt"
                  onClick={() => this.pickQuiz(index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12.8px",
                    width: "100%",
                    minHeight: "67.2px",
                    padding: "0 19.2px",
                    borderRadius: "18px",
                    cursor: revealed ? "default" : "pointer",
                    fontFamily: "inherit",
                    fontSize: "17.28px",
                    fontWeight: 650,
                    letterSpacing: "-0.02em",
                    transition: "background 0.18s ease, color 0.18s ease, border-color 0.18s ease",
                    ...(state === "correct"
                      ? { border: "1.5px solid #34c759", background: "rgba(52,199,89,0.14)", color: "#2aa34a" }
                      : state === "wrong"
                        ? { border: "1.5px solid #ff3b30", background: "rgba(255,59,48,0.14)", color: "#ff3b30" }
                        : { border: 0, background: "var(--m-surface)", color: "var(--m-label)", boxShadow: "var(--m-shadow)" }),
                  }}
                >
                  <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                  {state !== "idle" ? <Msym name={state === "correct" ? "check_circle" : "cancel"} size="22.4px" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* A miss stops the quiz at the design's sheet rather than moving on. */
  renderQuizMiss() {
    const q = this.quizQuestion();
    const button = (primary: boolean): CSSProperties => ({
      height: "54.4px",
      border: 0,
      borderRadius: "18px",
      background: primary ? "var(--m-label)" : "var(--m-tile)",
      color: primary ? "var(--m-bg)" : "var(--m-label)",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "17.28px",
      fontWeight: 700,
    });
    return (
      <div
        style={{
          position: "absolute",
          inset: "auto 0 0 0",
          zIndex: 6,
          padding: "19.2px 18.4px 32px",
          borderRadius: "30px 30px 0 0",
          background: "var(--m-surface)",
          boxShadow: "var(--m-shadow-lg)",
          animation: "memo-sheet-up 0.24s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12.8px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "41.6px",
              height: "41.6px",
              borderRadius: "999px",
              background: "rgba(255,59,48,0.16)",
              color: "#ff3b30",
            }}
          >
            <Msym name="cancel" size="21.6px" />
          </span>
          <span style={{ fontSize: "19.2px", fontWeight: 800, letterSpacing: "-0.03em", color: "#ff3b30" }}>{this.props.t("quiz.wrongTitle")}</span>
        </div>
        <p style={{ margin: "16px 0 19.2px", fontSize: "17.28px", fontWeight: 600 }}>
          {this.props.t("preview.correctAnswerValue", { answer: q.options[q.correct] })}
        </p>
        <div style={{ display: "grid", gap: "11.2px" }}>
          <button type="button" onClick={() => this.setState({ sheet: "chat" }, () => this.nextQuiz())} style={button(false)}>
            {this.props.t("quiz.reviewWhy")}
          </button>
          <button type="button" onClick={() => this.nextQuiz()} style={button(true)}>
            {this.props.t("quiz.understood")}
          </button>
        </div>
      </div>
    );
  }

  renderTest() {
    const s = this.state;
    const list = this.studyData().practice;
    const question = list[(s.testNo - 1) % list.length];
    const last = s.testNo >= list.length;

    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "16px" }}>
          <span style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.03em" }}>{this.props.t("quiz.questionN", { index: s.testNo })}</span>
          <span style={{ color: "var(--m-second)", fontSize: "15.68px", fontWeight: 650 }}>
            {s.testNo} / {list.length}
          </span>
        </div>
        <div style={{ height: "12px", margin: "11.2px 0 22.4px", borderRadius: "999px", background: "var(--m-field)" }}>
          <div
            style={{
              width: `${Math.round((s.testNo / list.length) * 100)}%`,
              height: "100%",
              borderRadius: "999px",
              background: "var(--m-label)",
              transition: "width 0.32s cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </div>
        <p style={{ margin: "0 0 19.2px", fontSize: "20.8px", fontWeight: 750, letterSpacing: "-0.03em", lineHeight: 1.32 }}>
          {question.prompt}
        </p>
        <textarea
          data-tap="answer"
          value={s.testAnswers[s.testNo] ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            this.setState((c) => ({ testAnswers: { ...c.testAnswers, [c.testNo]: value } }));
          }}
          placeholder={this.props.t("test.answerPlaceholder")}
          onFocus={() => this.setState({ testFocused: true })}
          onBlur={() => this.setState({ testFocused: false })}
          style={{
            width: "100%",
            height: "208px",
            padding: "17.6px 19.2px",
            border: 0,
            borderRadius: "22px",
            background: "var(--m-surface)",
            color: "var(--m-label)",
            boxShadow: s.testFocused
              ? "var(--m-shadow), inset 0 0 0 1.5px var(--m-focus-ring)"
              : "var(--m-shadow)",
            outline: "none",
            fontFamily: "inherit",
            fontSize: "16.8px",
            lineHeight: 1.5,
            resize: "none",
          }}
        />
        <div style={{ display: "flex", gap: "11.2px", marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => this.setState((c) => ({ testNo: Math.max(1, c.testNo - 1) }))}
            style={{
              flex: "1 1 0",
              height: "54.4px",
              border: 0,
              borderRadius: "999px",
              fontFamily: "inherit",
              fontSize: "16.8px",
              fontWeight: 700,
              background: "var(--m-tile)",
              color: s.testNo > 1 ? "var(--m-label)" : "var(--m-second)",
              cursor: s.testNo > 1 ? "pointer" : "default",
              opacity: s.testNo > 1 ? 1 : 0.5,
            }}
          >
            {this.props.t("common.back")}
          </button>
          <button
            type="button"
            data-tap="test-next"
            onClick={() => this.nextTest()}
            style={{
              flex: "1 1 0",
              height: "54.4px",
              border: 0,
              borderRadius: "999px",
              background: "var(--m-label)",
              color: "var(--m-bg)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "17.28px",
              fontWeight: 750,
            }}
          >
            {last ? this.props.t("preview.submitTest") : this.props.t("common.next")}
          </button>
        </div>
      </div>
    );
  }

  /* The transcript screen is the player and the text under it, as the design
     pairs them — the same screen the audio tab shows. */
  renderTranscript() {
    const round = (size: number): CSSProperties => ({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: `${size}px`,
      height: `${size}px`,
      border: 0,
      borderRadius: "999px",
      background: "var(--m-tile)",
      color: "var(--m-second)",
      cursor: "pointer",
    });

    return (
      <>
        <div style={{ padding: "21.6px 22.4px 24px", borderRadius: "26px", background: "var(--m-surface)", boxShadow: "var(--m-shadow)" }}>
          <div style={{ position: "relative", height: "6.4px", borderRadius: "999px", background: "var(--m-field)" }}>
            <div style={{ width: "18%", height: "100%", borderRadius: "999px", background: "var(--m-label)" }} />
            <span
              style={{
                position: "absolute",
                top: "50%",
                left: "18%",
                width: "13.6px",
                height: "13.6px",
                margin: "-6.8px 0 0 -6.8px",
                borderRadius: "999px",
                background: "var(--m-label)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "12.8px",
              color: "var(--m-second)",
              fontSize: "14.4px",
              fontWeight: 650,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>12:48</span>
            <span>{this.props.t("preview.durationHoursMinutes", { hours: 1, minutes: 12 })}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "21.6px", marginTop: "20px" }}>
            <button type="button" aria-label={this.props.t("preview.back10")} style={round(48)}>
              <Msym name="replay_10" size="24px" fill={false} weight={500} />
            </button>
            <button
              type="button"
              aria-label={this.props.t("preview.play")}
              style={{ ...round(67.2), background: "var(--m-label)", color: "var(--m-bg)" }}
            >
              <Msym name="play_arrow" size="32px" />
            </button>
            <button type="button" aria-label={this.props.t("preview.forward10")} style={round(48)}>
              <Msym name="forward_10" size="24px" fill={false} weight={500} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: "17.6px" }}>
            <button
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6.4px",
                height: "38.4px",
                padding: "0 15.2px",
                border: 0,
                borderRadius: "999px",
                background: "var(--m-tile)",
                color: "var(--m-label)",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "15.68px",
                fontWeight: 700,
              }}
            >
              <Msym name="speed" size="18.4px" fill={false} weight={500} />
              1x
            </button>
          </div>
        </div>

        <div style={{ paddingTop: "19.2px" }}>
          {this.studyData().transcript.map((line) => (
            <div key={line.time} style={blockStyle("li")}>
              {`•  ${line.time} — ${line.text}`}
            </div>
          ))}
        </div>
      </>
    );
  }

  /*
   * The spoken walkthrough. The same replica the rest of the page uses, handed
   * the mockup's own tokens so it is painted in the phone's palette rather than
   * the page's, and with its voice row bled out to the phone's gutter the way
   * the app bleeds it to the viewport.
   */
  renderTutor() {
    return (
      <LandingTutorDemo
        inset="phone"
        style={
          {
            "--lt-text": "var(--m-label)",
            "--lt-muted": "var(--m-second)",
            "--lt-tile": "var(--m-tile)",
            "--lt-line": "var(--m-line)",
            "--lt-surface": "var(--m-surface)",
            "--lt-ink": "var(--m-label)",
            "--lt-on-ink": "var(--m-bg)",
            /* The scroller already carries the screen's gutter. */
            padding: "0.5rem 0 1.5rem",
            /* What the note scroller leaves on the phone, which is what the app
               fills here — as a number, because the app measures it in `vh` and
               the mockup's screen is not the viewport. */
            minHeight: "34rem",
          } as CSSProperties
        }
      />
    );
  }

  /* The results screen's own buttons, which `.landing-result-actions` paints:
     the first is the filled one, anything after it the quiet tile. */
  resultAction(label: string, onClick: () => void) {
    return (
      <button type="button" onClick={onClick}>
        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
        <span>{label}</span>
      </button>
    );
  }

  /*
   * The results screen, which is the app's own — `StudyCompletionCard`, ported
   * for the page's palette in `landing-study-result.tsx`. Which round it reports,
   * what it calls the score and where the button leads are the app's rules too: a
   * clean round says the set is finished, anything missed turns into a second
   * round over just those, and a submitted test is reported against the attempts
   * before it.
   */
  renderResults() {
    const s = this.state;
    const t = this.props.t;
    const study = this.studyData();
    const tokens = {
      "--lr-text": "var(--m-label)",
      "--lr-muted": "var(--m-second)",
      "--lr-tile": "var(--m-tile)",
      "--lr-sunken": "var(--m-field)",
      "--lr-surface": "var(--m-surface)",
      "--lr-ink": "var(--m-label)",
      "--lr-on-ink": "var(--m-bg)",
    } as CSSProperties;

    if (s.tab === "flashcards") {
      const queue = this.cardQueue();
      const missed = queue.filter((id) => s.cardAnswers[id] === "again");
      const known = queue.length - missed.length;

      return (
        <LandingStudyResult
          style={tokens}
          eyebrow={missed.length === 0 ? t("study.completed") : t("study.roundCompleted", { cycle: s.cardCycle })}
          title={t(missed.length === 0 ? "study.cards.allDone" : "study.cards.repeatMissed")}
          percentage={missed.length === 0 ? 100 : completionPct(known, queue.length)}
          percentageLabel={t(missed.length === 0 ? "study.setCompleted" : "study.roundScore")}
          primaryMetric={{ label: t("study.correctThisRound"), value: `${known}/${queue.length}` }}
          actions={
            missed.length === 0
              ? this.resultAction(t("study.restartSet"), () =>
                  this.setState({ ...this.studyReset(), tab: "flashcards" }),
                )
              : this.resultAction(t("study.repeatMissedCards", { count: missed.length }), () =>
                  this.setState((c) => ({
                    reviewQueue: missed,
                    cardCycle: c.cardCycle + 1,
                    cardPos: 0,
                    cardFlipped: false,
                    cardAnswers: {},
                    cardsDone: false,
                    cardExit: null,
                  })),
                )
          }
        />
      );
    }

    if (s.tab === "quiz") {
      const queue = this.quizQueue();
      const missed = s.quizMissed;
      const correct = queue.length - missed.length;

      return (
        <LandingStudyResult
          style={tokens}
          eyebrow={missed.length === 0 ? t("study.completed") : t("study.roundCompleted", { cycle: s.quizCycle })}
          title={t(missed.length === 0 ? "quiz.allDone" : "quiz.repeatMissed")}
          percentage={missed.length === 0 ? 100 : completionPct(correct, queue.length)}
          percentageLabel={t(missed.length === 0 ? "study.setCompleted" : "study.roundScore")}
          primaryMetric={{
            label: t(missed.length === 0 ? "quiz.questionsDone" : "study.correctThisRound"),
            value:
              missed.length === 0
                ? `${study.quiz.length}/${study.quiz.length}`
                : `${correct}/${queue.length}`,
          }}
          actions={
            missed.length === 0
              ? this.resultAction(t("quiz.restart"), () => this.setState({ ...this.studyReset(), tab: "quiz" }))
              : this.resultAction(t("quiz.repeatMissedQuestions", { count: missed.length }), () =>
                  this.setState((c) => ({
                    quizQueue: missed,
                    quizCycle: c.quizCycle + 1,
                    quizNo: 1,
                    quizPick: null,
                    quizMissed: [],
                    quizDone: false,
                  })),
                )
          }
        />
      );
    }

    /*
     * A submitted test. There is nobody grading this one, so a question that was
     * written on scores its point and a skipped one does not — which is enough
     * for the screen to report a real number that follows what the visitor did.
     */
    const total = study.practice.length;
    const scored = Object.values(s.testAnswers).filter((answer) => answer.trim().length > 0).length;
    const percentage = completionPct(scored, total);
    const history = [...PREVIEW_TEST_HISTORY, percentage];
    const average = Math.round(history.reduce((sum, value) => sum + value, 0) / history.length);

    return (
      <LandingStudyResult
        style={tokens}
        eyebrow=""
        title=""
        subtitle={t("test.attemptN", { count: history.length })}
        percentage={percentage}
        percentageLabel={t("study.score")}
        primaryMetric={{ label: t("test.pointsScored"), value: `${scored}/${total}` }}
        secondaryMetrics={[
          { label: t("test.average"), value: `${average}%` },
          { label: t("test.best"), value: `${Math.max(...history)}%` },
          { label: t("test.lowest"), value: `${Math.min(...history)}%` },
          { label: t("test.attempts"), value: String(history.length) },
        ]}
        actions={this.resultAction(t("study.test.startNew"), () =>
          this.setState({ ...this.studyReset(), tab: "test" }),
        )}
      />
    );
  }

  /* The capture screen each create option opens. */
  renderCapture() {
    const s = this.state;
    const spec = CAPTURE[s.captureMode];
    const isRecord = s.captureMode === "record";
    const isFile = s.captureMode === "upload" || s.captureMode === "file";

    return (
      <div style={{ position: "absolute", inset: `${STATUS_H}px 0 0 0`, display: "flex", flexDirection: "column", background: "var(--m-bg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 18.4px 11.2px" }}>
          <span style={{ flex: 1, fontSize: "17.28px", fontWeight: 750, letterSpacing: "-0.03em" }}>{this.props.t(spec.titleKey)}</span>
          <button type="button" aria-label={this.props.t("common.close")} onClick={() => this.setState({ screen: "home" })} style={roundBtn(46.4)}>
            <Msym name="close" size="23.2px" fill={false} weight={500} />
          </button>
        </div>

        <div data-app-main style={{ flex: 1, display: "flex", flexDirection: "column", gap: "17.6px", padding: "16px 18.4px 32px" }}>
          {isRecord ? (
            <div style={{ display: "grid", justifyItems: "center", gap: "22.4px", padding: "56px 0 0" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "144px",
                  height: "144px",
                  borderRadius: "999px",
                  background: "rgba(244,95,90,0.14)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "102.4px",
                    height: "102.4px",
                    borderRadius: "999px",
                    background: "linear-gradient(135deg, #ff6d68, #f45f5a)",
                    color: "#fff",
                  }}
                >
                  <Msym name="mic" size="41.6px" />
                </div>
              </div>
              <span style={{ fontSize: "32px", fontWeight: 750, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>0:00</span>
              <span style={{ color: "var(--m-second)", fontSize: "16px" }}>{this.props.t("capture.recordActive")}</span>
            </div>
          ) : null}

          {/* The demo already has a file in hand, so the picker opens on it —
              the same box, with the chosen file in place of the invitation. */}
          {isFile ? (
            <div
              style={{
                display: "grid",
                justifyItems: "center",
                gap: "9.6px",
                padding: "48px 24px",
                border: "2px dashed var(--m-line)",
                borderRadius: "24px",
                background: "var(--m-surface)",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "67.2px",
                  height: "67.2px",
                  borderRadius: "999px",
                  background: "var(--m-tile)",
                }}
              >
                <Emoji symbol={spec.emoji} size="28.8px" />
              </span>
              <span style={{ fontSize: "17.28px", fontWeight: 700, letterSpacing: "-0.025em", textAlign: "center" }}>
                {spec.pickedName}
              </span>
              <span style={{ color: "var(--m-second)", fontSize: "15.2px", textAlign: "center" }}>{spec.pickedMeta}</span>
              <button
                type="button"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6.4px",
                  marginTop: "3.2px",
                  height: "38.4px",
                  padding: "0 15.2px",
                  border: 0,
                  borderRadius: "999px",
                  background: "var(--m-tile)",
                  color: "var(--m-label)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "15.68px",
                  fontWeight: 700,
                }}
              >
                <Msym name="cloud_upload" size="18.4px" fill={false} weight={500} />
                {this.props.t("preview.pickAnother")}
              </button>
            </div>
          ) : null}

          {s.captureMode === "link" ? (
            <textarea
              value={s.captureText}
              onChange={(e) => this.setState({ captureText: e.target.value })}
              placeholder={spec.placeholder}
              style={{
                width: "100%",
                height: "224px",
                padding: "17.6px 19.2px",
                border: 0,
                borderRadius: "22px",
                background: "var(--m-surface)",
                color: "var(--m-label)",
                boxShadow: "var(--m-shadow)",
                outline: "none",
                fontFamily: "inherit",
                fontSize: "16.8px",
                lineHeight: 1.5,
                resize: "none",
              }}
            />
          ) : null}

          <div style={{ marginTop: "auto", display: "grid", gap: "11.2px" }}>
            <button type="button" data-tap="capture-cta" onClick={() => this.addNote()} style={coralPill({ width: "100%" })}>
              {this.props.t(spec.ctaKey)}
            </button>
            <button type="button" onClick={() => this.setState({ screen: "home" })} style={ghostPill(48)}>
              {this.props.t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Sheets ───────────────────────────────────────────────── */

  /*
   * The design's dismissal: the sheet drops out of frame and dims slightly
   * before it is unmounted, rather than vanishing. `swapSheet` is the same
   * move with another sheet arriving in its place.
   */
  closeSheet = () => {
    if (!this.state.sheet || this.state.sheetClosing) return;
    this.setState({ sheetClosing: true });
    if (this.closeTimer) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.setState({ sheet: null, sheetClosing: false, dragKey: null, dragOffset: 0 });
    }, 260);
  };

  swapSheet = (next: Sheet) => {
    this.setState({ sheetClosing: true });
    if (this.closeTimer) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.setState({ sheet: next, sheetClosing: false, dragKey: null, dragOffset: 0 });
    }, 240);
  };

  renderScrim() {
    return (
      <button
        type="button"
        aria-label={this.props.t("common.close")}
        onClick={this.closeSheet}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 5,
          border: 0,
          padding: 0,
          cursor: "pointer",
          background: "var(--m-scrim)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          opacity: this.state.sheetClosing ? 0 : 1,
          transition: "opacity 0.26s ease",
          animation: this.state.sheetClosing ? undefined : "memo-fade-in 0.2s ease-out",
        }}
      />
    );
  }

  renderCreateSheet() {
    const sheet = this.sheetProps("create", this.closeSheet);
    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        {sheetTitle(this.props.t("library.newNote"), this.props.t("common.close"), this.closeSheet)}
        <div style={{ display: "grid", gap: "12.8px" }}>
          {CREATE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              data-tap="create-option"
              onClick={() =>
                this.setState({
                  sheet: null,
                  screen: "capture",
                  captureMode: option.id,
                  captureText: CAPTURE[option.id].pickedText ?? "",
                })
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16.8px",
                width: "100%",
                height: "73.6px",
                padding: "0 19.2px",
                border: 0,
                borderRadius: "20px",
                background: "var(--m-surface)",
                color: "var(--m-label)",
                boxShadow: "var(--m-shadow)",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: "48px",
                  height: "48px",
                  flex: "0 0 auto",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "999px",
                  background: "var(--m-tile)",
                }}
              >
                <Emoji symbol={option.emoji} size="21.6px" />
              </span>
              <span style={{ fontSize: "17.92px", fontWeight: 700, letterSpacing: "-0.025em" }}>{this.props.t(option.labelKey)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  renderFoldersSheet() {
    const s = this.state;
    const dark = this.isDark();
    const sheet = this.sheetProps("folders", this.closeSheet);
    const options: Array<{ id: string | null; name: string; icon: string }> = [
      { id: null, name: this.props.t("folders.allNotes"), icon: "🗂️" },
      ...s.folders.map((f) => ({ id: f.id, name: f.name, icon: f.icon })),
    ];
    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        {sheetTitle(this.props.t("folders.title"), this.props.t("common.close"), this.closeSheet, 16)}
        <div style={SURFACE_CARD}>
          {options.map((folder, i) => (
            <div key={folder.id ?? "all"} style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${divider(i === 0, dark)}` }}>
              <button
                type="button"
                onClick={() => this.setState({ folderId: folder.id, sheet: null })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14.4px",
                  flex: 1,
                  minWidth: 0,
                  height: "64px",
                  padding: "0 9.6px 0 19.2px",
                  border: 0,
                  background: "transparent",
                  color: "var(--m-label)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <Emoji symbol={folder.icon} size="19.2px" />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "17.28px",
                    fontWeight: 650,
                    letterSpacing: "-0.025em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {folder.name}
                </span>
                {s.folderId === folder.id ? <Msym name="check" size="21.6px" fill={false} weight={500} /> : null}
              </button>
              {folder.id ? (
                <button
                  type="button"
                  aria-label={this.props.t("preview.folderOptions")}
                  onClick={() =>
                    this.setState((c) => ({
                      folders: c.folders.filter((f) => f.id !== folder.id),
                      folderId: c.folderId === folder.id ? null : c.folderId,
                    }))
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "48px",
                    height: "64px",
                    flex: "0 0 auto",
                    padding: 0,
                    border: 0,
                    background: "transparent",
                    color: "var(--m-second)",
                    cursor: "pointer",
                  }}
                >
                  <Msym name="more_horiz" size="24px" fill={false} weight={500} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "22.4px" }}>
          <button
            type="button"
            onClick={() => {
              this.setState({ newFolderName: "" });
              this.swapSheet("newFolder");
            }}
            style={coralPill({
              minWidth: "200px",
              height: "57.6px",
              padding: "0 32px",
              fontSize: "18.4px",
              letterSpacing: "-0.02em",
              boxShadow: "0 12px 26px rgba(244,95,90,0.28)",
            })}
          >
            {this.props.t("folders.new")}
          </button>
        </div>
      </div>
    );
  }

  renderNewFolderSheet() {
    const s = this.state;
    const sheet = this.sheetProps("newFolder", this.closeSheet);
    const create = () => {
      const name = s.newFolderName.trim();
      if (!name) return;
      this.setState((c) => ({
        folders: c.folders.concat({ id: `f${Date.now()}`, name, icon: "📁", noteIds: [] }),
        newFolderName: "",
      }));
      this.swapSheet("folders");
    };
    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20.8px" }}>
          <span style={{ fontSize: "20px", fontWeight: 750, letterSpacing: "-0.03em" }}>{this.props.t("folders.new")}</span>
          <button
            type="button"
            onClick={create}
            style={{
              position: "absolute",
              right: 0,
              height: "40px",
              padding: "0 16px",
              border: 0,
              borderRadius: "999px",
              background: "transparent",
              color: "var(--m-label)",
              fontFamily: "inherit",
              fontSize: "16.32px",
              fontWeight: 700,
              opacity: s.newFolderName.trim() ? 1 : 0.4,
              cursor: "pointer",
            }}
          >
            {this.props.t("common.done")}
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "22.4px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "96px",
              height: "96px",
              borderRadius: "999px",
              background: "var(--m-tile)",
            }}
          >
            <Emoji symbol="📁" size="41.6px" />
          </span>
        </div>
        <input
          value={s.newFolderName}
          onChange={(e) => this.setState({ newFolderName: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          placeholder={this.props.t("folders.name")}
          maxLength={32}
          style={{
            width: "100%",
            height: "57.6px",
            padding: "0 19.2px",
            border: 0,
            borderRadius: "999px",
            background: "var(--m-field)",
            color: "var(--m-label)",
            outline: "none",
            fontFamily: "inherit",
            fontSize: "17.28px",
            fontWeight: 600,
          }}
        />
        <p style={{ margin: "14.4px 0 0", textAlign: "center", color: "var(--m-second)", fontSize: "15.2px" }}>
          {this.props.t("folders.hintMobile")}
        </p>
      </div>
    );
  }

  renderActionsSheet() {
    const s = this.state;
    const sheet = this.sheetProps("actions", this.closeSheet);
    const note = s.notes.find((n) => n.id === s.targetId);
    const row = (danger: boolean): CSSProperties => ({
      display: "flex",
      alignItems: "center",
      gap: "14.4px",
      height: "62.4px",
      padding: "0 19.2px",
      border: 0,
      borderRadius: "20px",
      background: "var(--m-surface)",
      color: danger ? "#ff3b30" : "var(--m-label)",
      boxShadow: "var(--m-shadow)",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "17.28px",
      fontWeight: 650,
    });
    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <p style={{ margin: "0 0 14.4px", textAlign: "center", color: "var(--m-second)", fontSize: "15.68px" }}>{note?.title ?? ""}</p>
        <div style={{ display: "grid", gap: "11.2px" }}>
          <button
            type="button"
            onClick={() => {
              this.setState({ renameValue: note?.title ?? "" });
              this.swapSheet("rename");
            }}
            style={row(false)}
          >
            <Msym name="edit" size="22.4px" />
            {this.props.t("common.rename")}
          </button>
          <button type="button" onClick={() => this.swapSheet("delete")} style={row(true)}>
            <Msym name="delete" size="22.4px" />
            {this.props.t("common.delete")}
          </button>
          <button type="button" onClick={this.closeSheet} style={{ ...ghostPill(56), borderRadius: "20px" }}>
            {this.props.t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  renderRenameSheet() {
    const s = this.state;
    const sheet = this.sheetProps("rename", this.closeSheet);
    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <span style={{ display: "block", marginBottom: "14.4px", textAlign: "center", fontSize: "20px", fontWeight: 750, letterSpacing: "-0.03em" }}>
          {this.props.t("library.rename.title")}
        </span>
        <input
          value={s.renameValue}
          onChange={(e) => this.setState({ renameValue: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") this.saveRename();
          }}
          placeholder={this.props.t("library.rename.placeholder")}
          style={{
            width: "100%",
            height: "54.4px",
            padding: "0 17.6px",
            border: 0,
            borderRadius: "18px",
            background: "var(--m-surface)",
            color: "var(--m-label)",
            boxShadow: "var(--m-shadow)",
            outline: "none",
            fontFamily: "inherit",
            fontSize: "17.28px",
          }}
        />
        <div style={{ display: "grid", gap: "11.2px", marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => this.saveRename()}
            style={coralPill({ width: "100%", height: "54.4px", boxShadow: "none", fontSize: "17.28px" })}
          >
            {this.props.t("library.rename.save")}
          </button>
          <button type="button" onClick={this.closeSheet} style={ghostPill(49.6)}>
            {this.props.t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  renderDeleteSheet() {
    const s = this.state;
    const sheet = this.sheetProps("delete", this.closeSheet);
    const note = s.notes.find((n) => n.id === s.targetId);
    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <span style={{ display: "block", marginBottom: "8px", textAlign: "center", fontSize: "20px", fontWeight: 750, letterSpacing: "-0.03em" }}>
          {this.props.t("library.delete.title")}
        </span>
        <p style={{ margin: "0 0 17.6px", textAlign: "center", color: "var(--m-second)", fontSize: "16px", lineHeight: 1.4 }}>
          {this.props.t("preview.deleteBody", { title: note?.title ?? "" })}
        </p>
        <div style={{ display: "grid", gap: "11.2px" }}>
          <button
            type="button"
            onClick={() =>
              this.setState((c) => ({ notes: c.notes.filter((n) => n.id !== c.targetId), sheet: null, targetId: null }))
            }
            style={{
              height: "54.4px",
              border: 0,
              borderRadius: "999px",
              background: "#ff3b30",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "17.28px",
              fontWeight: 700,
            }}
          >
            {this.props.t("library.delete.title")}
          </button>
          <button type="button" onClick={this.closeSheet} style={ghostPill(49.6)}>
            {this.props.t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  /* Settings is a full-height sheet, as the design lays it out. */
  renderSettingsSheet() {
    const s = this.state;
    const dark = this.isDark();
    const sheet = this.fullSheetProps("settings", this.closeSheet, false);
    const heading: CSSProperties = { margin: "24px 0 11.2px", fontSize: "20px", fontWeight: 750, letterSpacing: "-0.03em" };
    const eyebrow: CSSProperties = {
      margin: 0,
      color: "var(--m-second)",
      fontSize: "11.52px",
      fontWeight: 700,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
    };
    const accountItems = [
      { id: "redeem", emoji: "🎟️", label: this.props.t("settings.rows.redeem") },
      { id: "privacy", emoji: "🔒", label: this.props.t("settings.rows.privacy") },
      { id: "share", emoji: "📤", label: this.props.t("common.share") },
      { id: "feature", emoji: "💡", label: this.props.t("settings.rows.feature") },
    ];

    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB_WIDE}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "14.4px 18.4px 0" }}>
          <button type="button" aria-label={this.props.t("common.close")} onClick={this.closeSheet} style={roundBtn(46.4)}>
            <Msym name="close" size="23.2px" fill={false} weight={500} />
          </button>
        </div>
        <h1 style={{ margin: "5.6px 18.4px 0", fontSize: "28px", fontWeight: 800, letterSpacing: "-0.04em" }}>{this.props.t("nav.settings")}</h1>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18.4px 40px" }}>
          <h2 style={{ ...heading, marginTop: 0 }}>{this.props.t("settings.theme.heading")}</h2>
          <div style={{ display: "flex", gap: "6.4px", padding: "5.6px", borderRadius: "999px", background: "var(--m-field)" }}>
            {THEME_OPTIONS.map((option) => {
              const on = s.theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => this.setState({ theme: option.value })}
                  style={{
                    flex: 1,
                    height: "44.8px",
                    border: 0,
                    borderRadius: "999px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "16px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    background: on ? "var(--m-surface)" : "transparent",
                    color: on ? "var(--m-label)" : "var(--m-second)",
                    boxShadow: on ? "var(--m-shadow)" : "none",
                    transform: on ? "scale(1)" : "scale(0.97)",
                    transition: "background 0.24s cubic-bezier(0.22,1,0.36,1), color 0.2s ease, transform 0.16s cubic-bezier(0.22,1,0.36,1)",
                  }}
                >
                  {this.props.t(option.labelKey)}
                </button>
              );
            })}
          </div>

          <h2 style={heading}>{this.props.t("settings.subscription.heading")}</h2>
          <div style={{ padding: "17.6px 19.2px", borderRadius: "20px", background: "var(--m-surface)", boxShadow: "var(--m-shadow)" }}>
            <p style={eyebrow}>{this.props.t("settings.plan.eyebrow")}</p>
            <p style={{ margin: "4.8px 0 2.4px", fontSize: "18.4px", fontWeight: 750, letterSpacing: "-0.03em" }}>{this.props.t("preview.planMonthly")}</p>
            <p style={{ margin: "0 0 14.4px", color: "var(--m-second)", fontSize: "15.2px" }}>{this.props.t("preview.planUntil")}</p>
            <button type="button" style={coralPill({ width: "100%", height: "52.8px", fontSize: "16.8px", fontWeight: 750, boxShadow: "0 10px 22px rgba(244,95,90,0.24)" })}>
              <Emoji symbol="✨" size="16px" />
              {this.props.t("preview.managePlan")}
            </button>
          </div>

          <h2 style={heading}>{this.props.t("settings.account.heading")}</h2>
          <div style={{ padding: "17.6px 19.2px", borderRadius: "20px", background: "var(--m-surface)", boxShadow: "var(--m-shadow)" }}>
            <p style={eyebrow}>{this.props.t("settings.account.signedIn")}</p>
            <p style={{ margin: "4.8px 0 14.4px", fontSize: "16.8px", fontWeight: 650, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis" }}>
              ana.kovac@student.uni-lj.si
            </p>
            <button type="button" onClick={this.closeSheet} style={ghostPill(48)}>
              {this.props.t("settings.signOut")}
            </button>
          </div>

          <div style={{ ...SURFACE_CARD, marginTop: "12.8px" }}>
            {accountItems.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => this.swapSheet("support")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14.4px",
                  width: "100%",
                  height: "67.2px",
                  padding: "0 19.2px",
                  border: 0,
                  borderTop: `1px solid ${divider(i === 0, dark)}`,
                  background: "transparent",
                  color: "var(--m-label)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    width: "43.2px",
                    height: "43.2px",
                    flex: "0 0 auto",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "999px",
                    background: "var(--m-tile)",
                  }}
                >
                  <Emoji symbol={item.emoji} size="20px" />
                </span>
                <span style={{ flex: 1, fontSize: "17.6px", fontWeight: 650, letterSpacing: "-0.025em" }}>{item.label}</span>
                <Msym name="chevron_right" size="23.2px" fill={false} weight={400} style={{ color: "var(--m-second)" }} />
              </button>
            ))}
          </div>

          <h2 style={heading}>{this.props.t("nav.help")}</h2>
          <div style={{ borderRadius: "20px", background: "var(--m-surface)", boxShadow: "var(--m-shadow)" }}>
            <button
              type="button"
              onClick={() => this.swapSheet("support")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14.4px",
                width: "100%",
                height: "67.2px",
                padding: "0 19.2px",
                border: 0,
                background: "transparent",
                color: "var(--m-label)",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: "43.2px",
                  height: "43.2px",
                  flex: "0 0 auto",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "999px",
                  background: "var(--m-tile)",
                }}
              >
                <Msym name="help" size="21.6px" />
              </span>
              <span style={{ flex: 1, fontSize: "17.6px", fontWeight: 650, letterSpacing: "-0.025em" }}>{this.props.t("settings.rows.help")}</span>
              <Msym name="chevron_right" size="23.2px" fill={false} weight={400} style={{ color: "var(--m-second)" }} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  renderSupportSheet() {
    const dark = this.isDark();
    const sheet = this.fullSheetProps("support", this.closeSheet, false);
    return (
      <div onPointerDown={sheet.onPointerDown} style={{ ...sheet.style, zIndex: 8 }}>
        {GRAB_WIDE}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 18.4px 0" }}>
          <h1 style={{ margin: 0, fontSize: "25.6px", fontWeight: 800, letterSpacing: "-0.04em" }}>{this.props.t("nav.help")}</h1>
          <button type="button" aria-label={this.props.t("common.back")} onClick={() => this.swapSheet("settings")} style={roundBtn(46.4)}>
            <Msym name="arrow_back" size="24px" fill={false} weight={500} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18.4px 40px" }}>
          <div
            style={{
              display: "grid",
              gap: "6.4px",
              marginBottom: "22.4px",
              padding: "17.6px 19.2px",
              borderRadius: "20px",
              background: "var(--m-surface)",
              boxShadow: "var(--m-shadow)",
            }}
          >
            <p style={{ margin: 0, fontSize: "16.32px", letterSpacing: "-0.015em" }}>{this.props.t("preview.support.greeting")}</p>
            <p style={{ margin: 0, fontSize: "16.32px", letterSpacing: "-0.015em" }}>{this.props.t("preview.support.checkSources")}</p>
          </div>
          {HELP_SECTIONS.map((section) => (
            <div key={section.titleKey} style={{ marginBottom: "22.4px" }}>
              <h2 style={{ margin: "0 0 11.2px", fontSize: "19.2px", fontWeight: 750, letterSpacing: "-0.03em" }}>
                {this.props.t(section.titleKey)}
              </h2>
              <div style={SURFACE_CARD}>
                {section.itemKeys.map((item, i) => (
                  <button
                    key={item}
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14.4px",
                      width: "100%",
                      minHeight: "62.4px",
                      padding: "9.6px 19.2px",
                      border: 0,
                      borderTop: `1px solid ${divider(i === 0, dark)}`,
                      background: "transparent",
                      color: "var(--m-label)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ flex: 1, fontSize: "16.8px", fontWeight: 600, letterSpacing: "-0.02em" }}>{item}</span>
                    <Msym name="chevron_right" size="22.4px" fill={false} weight={400} style={{ color: "var(--m-second)" }} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  renderChatSheet() {
    const s = this.state;
    const noteScoped = s.screen === "note" || s.screen === "sub";
    const sheet = this.fullSheetProps("chat", this.closeSheet, true);
    /* Inside a note the chat is pinned to it; from the library it opens on the
       design's default scope, the recent notes. */
    const scope = noteScoped ? (this.activeNote()?.title ?? this.props.t("preview.thisNote")) : this.props.t("library.myNotes");
    const scopeTitle = noteScoped ? scope : this.props.t("libraryChat.scope.recent");

    return (
      <div onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB_WIDE}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "8.8px 18.4px 9.6px" }}>
          <button
            type="button"
            aria-label={this.props.t("libraryChat.newChat")}
            onClick={() => this.setState({ chat: [], chatDraft: "" })}
            style={{ ...tileBtn(46.4), position: "absolute", left: "18.4px" }}
          >
            <Msym name="edit_square" size="23.2px" fill={false} weight={500} />
          </button>
          <span style={{ display: "grid", justifyItems: "center", gap: "1.6px", maxWidth: "calc(100% - 128px)", minWidth: 0 }}>
            <span style={{ fontSize: "18.88px", fontWeight: 750, letterSpacing: "-0.03em" }}>{this.props.t("libraryChat.chattingWith")}</span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5.6px",
                maxWidth: "100%",
                minWidth: 0,
                color: "var(--m-second)",
                fontSize: "15.2px",
                letterSpacing: "-0.02em",
              }}
            >
              <Emoji symbol="📌" size="13.6px" />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scopeTitle}</span>
            </span>
          </span>
          <button type="button" aria-label={this.props.t("common.close")} onClick={this.closeSheet} style={{ ...tileBtn(46.4), position: "absolute", right: "18.4px" }}>
            <Msym name="close" size="23.2px" fill={false} weight={500} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: "14.4px",
            overflowY: "auto",
            padding: "16px 18.4px",
          }}
        >
          <p
            style={{
              margin: 0,
              paddingLeft: "14.4px",
              borderLeft: "3px solid var(--m-promo)",
              fontSize: "16.32px",
              lineHeight: 1.42,
              letterSpacing: "-0.02em",
            }}
          >
            {this.props.t("libraryChat.introMobileWithNotes")}
          </p>
          {s.chat.map((message, i) => (
            <div
              key={i}
              style={
                message.role === "user"
                  ? {
                      alignSelf: "flex-end",
                      maxWidth: "78%",
                      padding: "11.2px 16px",
                      borderRadius: "20px 20px 6px 20px",
                      background: "linear-gradient(135deg, #ff6d68, #f45f5a)",
                      color: "#ffffff",
                      fontSize: "16.32px",
                      lineHeight: 1.4,
                      whiteSpace: "pre-wrap",
                    }
                  : {
                      alignSelf: "flex-start",
                      maxWidth: "82%",
                      padding: "11.2px 16px",
                      borderRadius: "20px 20px 20px 6px",
                      background: "var(--m-tile)",
                      color: "var(--m-label)",
                      fontSize: "16.32px",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }
              }
            >
              {message.text}
            </div>
          ))}
        </div>

        <div style={{ position: "relative", padding: "0 18.4px 25.6px" }}>
          <div style={{ display: "grid", gap: "8.8px", padding: "12px", borderRadius: "22px", background: "var(--m-field)" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6.4px",
                justifySelf: "start",
                flex: "0 0 auto",
                whiteSpace: "nowrap",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                height: "38.4px",
                padding: "0 12px",
                border: "1px solid var(--m-line)",
                borderRadius: "999px",
                background: "var(--m-surface)",
                color: "var(--m-label)",
              }}
            >
              <span style={{ fontSize: "16.32px", fontWeight: 700, letterSpacing: "-0.025em" }}>{scope}</span>
              {noteScoped ? null : (
                <>
                  <span style={{ color: "var(--m-second)", fontSize: "16.32px", letterSpacing: "-0.02em" }}>{this.props.t("preview.recent")}</span>
                  <Msym name="expand_more" size="18.4px" fill={false} weight={500} />
                </>
              )}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "9.6px" }}>
              <input
                value={s.chatDraft}
                onChange={(e) => this.setState({ chatDraft: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    this.sendChat();
                  }
                }}
                placeholder={this.props.t("libraryChat.askAboutNotes")}
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  padding: "0 5.6px",
                  border: 0,
                  background: "transparent",
                  outline: "none",
                  color: "var(--m-label)",
                  fontFamily: "inherit",
                  fontSize: "17.28px",
                  letterSpacing: "-0.02em",
                }}
              />
              <button
                type="button"
                aria-label={this.props.t("libraryChat.send")}
                onClick={() => this.sendChat()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "48px",
                  height: "48px",
                  flex: "0 0 auto",
                  padding: 0,
                  border: 0,
                  borderRadius: "999px",
                  cursor: "pointer",
                  transition: "background 0.18s ease, color 0.18s ease",
                  background: s.chatDraft.trim() ? "linear-gradient(135deg, #ff6d68, #f45f5a)" : "var(--m-tile)",
                  color: s.chatDraft.trim() ? "#ffffff" : "var(--m-second)",
                }}
              >
                <Msym name="arrow_upward" size="24px" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Root ─────────────────────────────────────────────────── */

  render() {
    const s = this.state;
    const k = s.scale;
    const radius = 48 * k;
    const search = s.query.trim().toLowerCase();
    const folder = s.folders.find((f) => f.id === s.folderId) ?? null;
    const visible = s.notes.filter((note) => {
      if (folder && folder.noteIds.indexOf(note.id) === -1) return false;
      if (!search) return true;
      return note.title.toLowerCase().includes(search) || this.props.t(SOURCE_LABEL_KEYS[note.source]).toLowerCase().includes(search);
    });

    const rootStyle: CSSProperties = {
      display: "flex",
      justifyContent: "center",
      // Without this the frame stretches to fill the reserved height and the
      // body grows taller than the screen it wraps.
      alignItems: "flex-start",
      width: "100%",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Segoe UI', sans-serif",
      WebkitFontSmoothing: "antialiased",
      // The server cannot know the viewport, so the mockup stays hidden until
      // it has been measured — otherwise it would paint at the default scale
      // and visibly shrink once the client measures it. The reserved height
      // (see landing.css) is dropped once the real size is known.
      opacity: s.measured ? 1 : 0,
      minHeight: s.measured ? 0 : undefined,
      transition: "opacity 200ms ease",
    };
    if (s.theme === "light") Object.assign(rootStyle, LIGHT_TOKENS);
    if (s.theme === "dark") Object.assign(rootStyle, DARK_TOKENS);

    /* A full-height sheet covers the status bar; a bottom one does not. */
    const sheetIsFull = s.sheet === "settings" || s.sheet === "support" || s.sheet === "chat";

    return (
      <div
        data-memo-app
        className="landing-v2-phone-host"
        ref={(node) => {
          this.mount = node;
          if (node) this.measure();
        }}
        style={rootStyle}
      >
        <div
          style={{
            position: "relative",
            padding: `${Math.max(2, Math.round(3.5 * k))}px`,
            borderRadius: `${radius + Math.round(15.5 * k)}px`,
            background:
              "linear-gradient(145deg, #4a4a50 0%, #1b1b1f 18%, #6a6a72 34%, #17171a 62%, #55555c 82%, #202024 100%)",
            boxShadow: "var(--phone-shadow)",
          }}
        >
          <span aria-hidden="true" style={{ position: "absolute", left: "-2px", top: "15.5%", width: "3.5px", height: "3.6%", borderRadius: "2px 0 0 2px", background: "linear-gradient(90deg, #131316, #3d3d44)" }} />
          <span aria-hidden="true" style={{ position: "absolute", left: "-2.5px", top: "23%", width: "4px", height: "7%", borderRadius: "2px 0 0 2px", background: "linear-gradient(90deg, #131316, #3d3d44)" }} />
          <span aria-hidden="true" style={{ position: "absolute", left: "-2.5px", top: "32.5%", width: "4px", height: "7%", borderRadius: "2px 0 0 2px", background: "linear-gradient(90deg, #131316, #3d3d44)" }} />
          <span aria-hidden="true" style={{ position: "absolute", right: "-2.5px", top: "27%", width: "4px", height: "10.5%", borderRadius: "0 2px 2px 0", background: "linear-gradient(270deg, #131316, #3d3d44)" }} />
          <div
            style={{
              position: "relative",
              padding: `${Math.round(12 * k)}px`,
              borderRadius: `${radius + Math.round(12 * k)}px`,
              background: "#000000",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
            }}
          >
            <div
              style={{
                position: "relative",
                width: `${Math.round(PHONE_W * k)}px`,
                height: `${Math.round(PHONE_H * k)}px`,
                overflow: "hidden",
                borderRadius: `${radius}px`,
                background: "var(--m-bg)",
                color: "var(--m-label)",
              }}
            >
              <div
                ref={(node) => {
                  this.stage = node;
                }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: `${PHONE_W}px`,
                  height: `${PHONE_H}px`,
                  transform: `scale(${k})`,
                  transformOrigin: "top left",
                  background: "var(--m-bg)",
                  color: "var(--m-label)",
                  // The artboard is drawn against a UA default line box; the
                  // landing page's own 1.5 would retune every row's height.
                  lineHeight: "normal",
                  overflow: "hidden",
                }}
              >
                {this.renderStatusBar()}

                {s.screen === "home" ? this.renderHome(visible) : null}
                {s.screen === "note" ? this.renderNote() : null}
                {s.screen === "sub" ? this.renderSub() : null}
                {s.screen === "capture" ? this.renderCapture() : null}

                {s.sheet && !sheetIsFull ? this.renderScrim() : null}
                {s.sheet === "create" ? this.renderCreateSheet() : null}
                {s.sheet === "folders" ? this.renderFoldersSheet() : null}
                {s.sheet === "newFolder" ? this.renderNewFolderSheet() : null}
                {s.sheet === "actions" ? this.renderActionsSheet() : null}
                {s.sheet === "rename" ? this.renderRenameSheet() : null}
                {s.sheet === "delete" ? this.renderDeleteSheet() : null}
                {s.sheet === "settings" ? this.renderSettingsSheet() : null}
                {s.sheet === "support" ? this.renderSupportSheet() : null}
                {s.sheet === "chat" ? this.renderChatSheet() : null}

                {/* The tour's own pointer, drawn over everything it touches. */}
                {s.tap ? (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: `${s.tap.x}px`,
                      top: `${s.tap.y}px`,
                      zIndex: 400,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "44px",
                      height: "44px",
                      borderRadius: "999px",
                      border: "1px solid rgba(255,255,255,0.45)",
                      background: "rgba(255,255,255,0.06)",
                      pointerEvents: "none",
                      transform: "translate3d(-50%,-50%,0)",
                      animation: `${s.tap.n % 2 ? "memo-tap-b" : "memo-tap-a"} 520ms ease-out forwards`,
                    }}
                  >
                    <span style={{ width: "10px", height: "10px", borderRadius: "999px", background: "rgba(255,255,255,0.35)" }} />
                  </span>
                ) : null}
                {s.cursor ? (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: `${s.cursor.x}px`,
                      top: `${s.cursor.y}px`,
                      zIndex: 420,
                      pointerEvents: "none",
                      marginLeft: s.cursor.press ? "-9px" : "-2px",
                      marginTop: s.cursor.press ? "-3px" : "-2px",
                      opacity: 1,
                      transition:
                        (s.cursor.seen && !s.cursor.drag
                          ? "left 520ms cubic-bezier(0.28,0.78,0.16,1), top 520ms cubic-bezier(0.28,0.78,0.16,1), "
                          : "") + "opacity 240ms ease",
                    }}
                  >
                    {s.cursor.press ? (
                      <svg width="26" height="30" viewBox="0 0 26 30" style={{ display: "block", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.5))" }}>
                        <path
                          d="M8.2 13.4 V4.3 a2.1 2.1 0 0 1 4.2 0 v7.4 v-1.6 a1.9 1.9 0 0 1 3.8 0 v1.9 v-1.1 a1.9 1.9 0 0 1 3.8 0 v1.7 v-0.6 a1.8 1.8 0 0 1 3.6 0 v6.4 c0 5.2 -3.2 8.6 -8.4 8.6 c-4.1 0 -6.2 -1.5 -8 -4.6 l-3.4 -5.8 a2 2 0 0 1 3.2 -2.4 Z"
                          fill="#ffffff"
                          stroke="#111114"
                          strokeWidth="1.4"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg width="19" height="26" viewBox="0 0 19 26" style={{ display: "block", filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.45))" }}>
                        <path
                          d="M1.5 1.2 L1.5 21.6 L6.6 16.7 L9.9 24.3 L13.2 22.9 L10 15.5 L17 15.3 Z"
                          fill="#ffffff"
                          stroke="#111114"
                          strokeWidth="1.3"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                ) : null}

                {/* The Dynamic Island and the home indicator, as the frame draws them. */}
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: "12px",
                    left: "50%",
                    zIndex: 200,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    width: "125px",
                    height: "36px",
                    paddingRight: "11px",
                    borderRadius: "999px",
                    background: "#000",
                    transform: "translateX(-50%)",
                    boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.06)",
                  }}
                >
                  <span
                    style={{
                      width: "11px",
                      height: "11px",
                      borderRadius: "999px",
                      background: "radial-gradient(circle at 32% 30%, #2c3446 0%, #10131c 55%, #05070c 100%)",
                      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
                    }}
                  />
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "8px",
                    zIndex: 200,
                    width: "140px",
                    height: "5px",
                    borderRadius: "999px",
                    background: "var(--m-label)",
                    opacity: 0.35,
                    transform: "translateX(-50%)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * The preview as the page uses it.
 *
 * `MemoAppPreviewView` is a class — it drives a scripted tour through
 * `setState` and needs the instance — so the translator is read here and handed
 * down as a prop rather than pulled from a hook inside it.
 */
export function MemoAppPreview(props: Omit<PreviewProps, "t" | "locale">) {
  const { t, locale } = useTranslations();

  /*
   * Keyed by locale so a language change remounts it. The sample library lives
   * in state and is built once in the constructor, so without this the replica
   * kept the titles of whichever language it was first rendered in while every
   * label around them switched — Croatian chrome over English note titles.
   * Restarting the demo in the new language is the right outcome anyway.
   */
  return <MemoAppPreviewView key={locale} {...props} t={t} locale={locale} />;
}
