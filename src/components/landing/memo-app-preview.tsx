"use client";

/*
 * The interactive phone mockup in the landing hero.
 *
 * It draws the app as a phone shows it (390×844), inside `LandingAppScope`, so it is
 * painted with the app's own tokens and — where a class renders the same at every
 * width — the app's own `.memo-*` classes. The note's study tabs are not drawn here at
 * all: they are the landing's shared app screens (`./app/landing-*-screen.tsx` and
 * `LandingTutorDemo`), the same components "How it works" and the feature list show.
 *
 * What is still transcribed is the phone chrome whose rules redesign.css only states
 * under `@media (max-width: 1099px)` — the library, the note's bars, the sheets, the
 * settings and help screens. The hero is a phone at every window width, and on a
 * desktop window those media rules never match, so their values are written out here
 * from the computed styles of `/creator` at 390×844. Keep them in step with the app;
 * docs/landing-page-sync.md has the checklist.
 *
 * It runs a guided tour on its own; any user interaction stops the tour and hands the
 * phone over.
 */

import Image from "next/image";

import { useTranslations } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";
import type { Translate } from "@/lib/i18n/translate";
import { formatCalendarDate } from "@/lib/utils";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Component } from "react";

import { Emoji, Msym } from "@/components/msym";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, SEO_BRAND_NAME } from "@/lib/brand";

import { LandingAppScope, type LandingAppTheme } from "./app/landing-app-scope";
import { LandingFlashcardsScreen } from "./app/landing-flashcards-screen";
import { LandingMindmapScreen } from "./app/landing-mindmap-screen";
import { LandingPalaceScreen } from "./app/landing-palace-screen";
import { LandingPodcastScreen } from "./app/landing-podcast-screen";
import { LandingQuizScreen } from "./app/landing-quiz-screen";
import { LandingExamScreen } from "./app/landing-exam-screen";
import { LandingSpeedReadScreen } from "./app/landing-speed-read-screen";
import { LandingTestScreen } from "./app/landing-test-screen";
import { LandingTutorDemo } from "./landing-tutor-demo";
import { PREVIEW_STOP_TOUR_EVENT, PREVIEW_TOUR_STOPPED_EVENT } from "./memo-app-preview-events";

import {
  type BodyLine,
  CALLOUT_EDGE,
  CAPTURE,
  type CaptureMode,
  type ChatMessage,
  CREATE_OPTIONS,
  HELP_SECTIONS,
  initialFolders,
  initialNotes,
  type NoteBlock,
  noteBodyMarkdown,
  type NoteTab,
  type PreviewFolder,
  type PreviewNote,
  type PreviewTheme,
  PREVIEW_TODAY,
  resolveNoteBody,
  resolveThemeStudy,
  sourceMeta,
  SUB_SCREEN_TITLE_KEYS,
  TABS,
  TABS_WITH_MANAGE_PILL,
  TABS_WITHOUT_CHAT,
  THEME_OPTIONS,
  themeFlashcards,
  themeQuiz,
  tokenizeBody,
} from "./memo-app-preview-data";

/* The phone is 390×844 with a 48px corner; every number below is the app's own at a
   16px root, converted from rem. */
const PHONE_W = 390;
const PHONE_H = 844;
const STATUS_H = 54;
/* The screen plus the bezel and the case around it — what actually has to fit. */
const FRAME_W = PHONE_W + 24 + 7;
const FRAME_H = PHONE_H + 24 + 7;

/* The phone gutter every screen uses (1.15rem). */
const GUTTER = 18.4;

type TapState = { x: number; y: number; n: number } | null;
type CursorState = { x: number; y: number; press: boolean; seen: boolean } | null;

type Screen = "home" | "note" | "capture" | "settings" | "support";
type Sheet = "create" | "folders" | "newFolder" | "actions" | "rename" | "delete" | "chat";

/* The tabs whose body is one of the landing's shared app screens. */
type StudyTab = Exclude<NoteTab, "notes" | "transcript">;

type PreviewProps = {
  autoTour?: boolean;
  /**
   * The translator, as a prop rather than a hook: this is a class component, and the
   * wrapper at the foot of the file is what reads the context.
   */
  t: Translate<MessageKey>;
  /** For `Intl`, which the date column goes through as the app does. */
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
  tab: NoteTab;
  /* The tab the tour opened and wants to play itself; null once the visitor has the phone. */
  autoplayTab: NoteTab | null;
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
  /* The library's conversation is not saved; the note's belongs to the note. */
  libraryChat: ChatMessage[];
  noteChat: ChatMessage[];
};

/* ── Shared pieces ────────────────────────────────────────────── */

/* `.memo-home-scroll` and `.memo-screen-scroll`: content fades in from under the floating bar. */
const HOME_SCROLL_MASK = "linear-gradient(to bottom, transparent 0, transparent 33.6px, #000 62.4px)";
/* `.memo-note-scroll`: the same, offset by the note's taller bar. */
const NOTE_SCROLL_MASK = "linear-gradient(to bottom, transparent 0, transparent 35.2px, #000 64px)";

/* Every button border in the app (`--btn-border-width` of `--btn-border`, or of
   `--btn-border-filled` on a colour fill). */
const BTN_BORDER = "var(--btn-border-width) solid var(--btn-border)";
const BTN_BORDER_FILLED = "var(--btn-border-width) solid var(--btn-border-filled)";
/* Floating chrome: the dock pill and the chat bar. */
const FLOATING_SHADOW = "inset 0 0 0 1px var(--line), 0 8px 22px rgba(0,0,0,0.16)";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/* The round white control: back, actions, settings, close (`.memo-m-navbtn`, `.memo-m-round`,
   `.memo-sheet-close`, `.memo-close-button`). */
function roundBtn(size: number): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${size}px`,
    height: `${size}px`,
    flex: "0 0 auto",
    padding: 0,
    border: BTN_BORDER,
    borderRadius: "999px",
    background: "var(--surface)",
    color: "var(--text)",
    boxShadow: "var(--shadow)",
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

/* The coral primary: "New note", "Create the note", "New folder", "Save". */
function coralPill(extra?: CSSProperties): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    height: "56.8px",
    border: BTN_BORDER_FILLED,
    borderRadius: "999px",
    background: "var(--coral)",
    color: "#fff",
    boxShadow: "var(--memo-coral-glow)",
    fontFamily: "inherit",
    fontSize: "17.92px",
    fontWeight: 700,
    cursor: "pointer",
    ...extra,
  };
}

/* The outlined secondary: every "Cancel", "Sign out" (`.memo-sheet-ghost`, `.ios-secondary-button`). */
function outlinePill(height: number, extra?: CSSProperties): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    height: `${height}px`,
    padding: "0 19.2px",
    border: BTN_BORDER,
    borderRadius: "999px",
    background: "var(--surface)",
    color: "var(--text)",
    boxShadow: "var(--shadow)",
    fontFamily: "inherit",
    fontSize: "16.32px",
    fontWeight: 650,
    cursor: "pointer",
    ...extra,
  };
}

/* A grouped card: the settings list, the folder list, the help groups. */
const SURFACE_CARD: CSSProperties = {
  borderRadius: "20px",
  background: "var(--surface)",
  boxShadow: "var(--shadow)",
  overflow: "hidden",
};

/* The eyebrow over a card's value (`.memo-eyebrow`, `.note-source-card-label`). */
const EYEBROW: CSSProperties = {
  display: "block",
  margin: 0,
  color: "var(--muted)",
  fontSize: "12.48px",
  fontWeight: 700,
  letterSpacing: "0.1em",
  lineHeight: 1.5,
  textTransform: "uppercase",
};

/* A grouped card's hairline, drawn above every row but the first. */
function rowRule(first: boolean): string {
  return first ? "0" : "1px solid var(--line)";
}

/* The grabber every bottom sheet carries (`.memo-grab`). */
const GRAB = (
  <div
    data-sheet-handle
    aria-hidden="true"
    style={{
      width: "41.6px",
      height: "5.12px",
      margin: "0 auto 14.4px",
      borderRadius: "999px",
      background: "var(--muted)",
      opacity: 0.5,
      cursor: "grab",
    }}
  />
);

/* The wider grab zone the full-height sheets use (`.memo-grab-wide`). */
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
        background: "var(--muted)",
        opacity: 0.5,
      }}
    />
  </div>
);

/* A sheet's centred title with its close at the right edge (`.memo-sheet-title`). */
function sheetTitle(
  title: string,
  closeLabel: string,
  onClose: () => void,
  marginBottom = 17.6,
  lineHeight: CSSProperties["lineHeight"] = 1.5,
): ReactNode {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: `${marginBottom}px` }}>
      <span style={{ fontSize: "20px", fontWeight: 750, letterSpacing: "-0.03em", lineHeight }}>{title}</span>
      <button type="button" aria-label={closeLabel} onClick={onClose} style={{ ...roundBtn(46.4), position: "absolute", right: 0 }}>
        <Msym name="close" size="23.2px" fill={false} weight={500} />
      </button>
    </div>
  );
}

/* A sheet's centred heading with no close (`.memo-sheet-heading`). */
const SHEET_HEADING: CSSProperties = {
  display: "block",
  margin: "0 0 14.4px",
  textAlign: "center",
  fontSize: "20px",
  fontWeight: 750,
  letterSpacing: "-0.03em",
};

/* The card-row copy on the settings screen (`.memo-card-row` on the phone). */
const CARD_ROW: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  marginTop: "13.6px",
  padding: "17.6px 19.2px",
  borderRadius: "20px",
  background: "var(--surface)",
  boxShadow: "var(--shadow)",
};

/* The mascot beside the tutor's side of a conversation (`.memo-avatar`). */
function mascot(size: number): ReactNode {
  return (
    <span className="memo-avatar" style={{ width: `${size}px`, height: `${size}px` }}>
      <Image src="/memo-mascot.png" alt="" width={320} height={288} />
    </span>
  );
}

class MemoAppPreviewView extends Component<PreviewProps, PreviewState> {
  /*
   * Built in the constructor rather than as a field initialiser: the sample library is
   * in the reader's language, and the translator arrives as a prop.
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
      tab: "notes",
      autoplayTab: null,
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
      libraryChat: [],
      noteChat: [],
    };
  }

  private mount: HTMLDivElement | null = null;
  private stage: HTMLDivElement | null = null;
  private timers: number[] = [];
  private tourTimers: number[] = [];
  private touring = false;
  private stopTour: (() => void) | null = null;
  private readTimer: number | null = null;
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
    if (this.closeTimer) window.clearTimeout(this.closeTimer);
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    if (this.onStopRequest) window.removeEventListener(PREVIEW_STOP_TOUR_EVENT, this.onStopRequest);
    this.resizeObserver?.disconnect();
    this.viewObserver?.disconnect();
    this.detachTourListeners();
  }

  /* Hand the mockup over to the visitor. Safe to call before the tour has started, so
     the callout can dismiss it at any point. */
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
      // Freeze in place: stop advancing, keep the current screen and highlight.
      if (this.readTimer) {
        window.clearInterval(this.readTimer);
        this.readTimer = null;
      }
      this.setState((c) => ({
        tap: null,
        cursor: null,
        // The tab's own walkthrough stops with the tour: the screen is the visitor's now.
        autoplayTab: null,
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
   * The stage is drawn at 1:1 and scaled down as a whole, so a pointer delta — which
   * arrives in screen pixels — has to be divided by that scale before it is used as a
   * translate inside the stage.
   */
  toStage(px: number): number {
    return px / (this.state.scale || 1);
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

  tapThen(selector: string, index: number, fn: () => void) {
    const first = !this.state.cursor;
    this.tapAt(selector, index);
    this.tourTimers.push(
      window.setTimeout(() => {
        if (this.touring) fn();
      }, (first ? 60 : 520) + 150),
    );
  }

  /* Bring a pill into view before the pointer reaches for it, the way a thumb scrolls
     the row first. */
  revealTab(tab: NoteTab) {
    const row = this.tabsRow;
    const pill = row?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!row || !pill) return;
    const target = pill.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, Math.min(target, row.scrollWidth - row.clientWidth)), behavior: "smooth" });
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

    /* Scroll the pill row to a tab, tap it, and let its own walkthrough play. */
    const openTab = (tab: NoteTab, dwell: number) => {
      doAt(900, () => this.revealTab(tab));
      doAt(700, () => this.tapThen(`[data-tab="${tab}"]`, 0, () => this.selectTab(tab, true)));
      doAt(dwell, () => {});
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
              detail: CAPTURE.upload.detail,
            },
            ...s.notes,
          ],
        })),
      ),
    );
    doAt(2000, () => this.updateStatus(tourNoteId, "transcribing"));
    doAt(2800, () => this.updateStatus(tourNoteId, "generating_notes"));
    doAt(2600, () => this.updateStatus(tourNoteId, "ready"));
    doAt(1600, () => this.tapThen('[data-tap="note"]', 0, () => this.openNote(tourNoteId)));

    /* The listen pill: the dock opens into its player and reads the note. */
    doAt(1600, () => this.tapThen('[data-tap="listen"]', 0, () => this.toggleRead()));
    doAt(9000, () => this.stopRead());

    /*
     * The tutor: open it and start the walkthrough, which plays silently — the button is
     * pressed with a synthetic click, which the tour's own pointerdown listeners ignore
     * and which `isTrusted` keeps from making a sound.
     */
    openTab("tutor", 1800);
    doAt(0, () =>
      this.tapThen(".memo-tutor-start", 0, () =>
        this.stage?.querySelector<HTMLButtonElement>(".memo-tutor-start")?.click(),
      ),
    );
    doAt(14000, () => {});

    /* Three of the study tabs, each playing its own walkthrough. */
    openTab("flashcards", 8200);
    openTab("mindmap", 8600);
    openTab("speed", 6400);

    /* Back out to the library, then start over. */
    doAt(1200, () => this.tapThen('[data-tap="note-back"]', 0, () => this.goHome()));
    doAt(2400, () => {
      this.setState({
        screen: "home",
        sheet: null,
        noteId: null,
        notes: initialNotes(this.props.t),
        tab: "notes",
        autoplayTab: null,
        readWord: 0,
        reading: false,
        readPaused: false,
        tap: null,
        captureText: "",
        noteChat: [],
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

  /* A note row slides left to reveal Edit / Delete behind it. */
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
   * The collapsing home header, the way the app does it: `headP` runs 0 → 1 over the
   * first 80px of scroll and the title fades out (`--memo-head-p`). The search field
   * does not fold — it scrolls away at full size.
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
      this.setState({ dragKey: null, dragOffset: 0 });
      if (offset > 110) close();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  /* A bottom sheet (`.memo-sheet` on the phone). */
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
        padding: `9.6px ${GUTTER}px 32px`,
        maxHeight: `${PHONE_H - STATUS_H}px`,
        overflowY: "auto",
        borderRadius: "34px 34px 0 0",
        background: "var(--bg)",
        boxShadow: "var(--shadow-lg)",
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

  /* A full-height sheet (`.memo-sheet-full.surface`), which stops under the status bar. */
  fullSheetProps(key: string, close: () => void) {
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
        background: "var(--surface)",
        boxShadow: "var(--shadow-lg)",
        overflow: "hidden",
        touchAction: "pan-y",
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
      } as CSSProperties,
    };
  }

  /* ── Note and reading state ───────────────────────────────── */

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

  /* The app shows Transcript only for a note made from a recording. */
  showsTranscript(note: PreviewNote | undefined): boolean {
    return note?.source === "audio";
  }

  appTheme(): LandingAppTheme {
    return this.state.theme === "system" ? "os" : this.state.theme;
  }

  openNote(id: string) {
    this.stopRead();
    this.setState({ screen: "note", noteId: id, tab: "notes", autoplayTab: null, readWord: 0, readPaused: false, noteChat: [] });
  }

  goHome() {
    this.stopRead();
    this.setState({ screen: "home", tab: "notes", autoplayTab: null });
  }

  /* The pills. Every tab is the same note screen with another body under the row. */
  selectTab(tab: NoteTab, autoplay = false) {
    if (tab !== "notes") this.stopRead();
    this.setState({ tab, screen: "note", autoplayTab: autoplay && this.touring ? tab : null });
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
          detail: spec.detail,
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

  /* Both conversations answer from the note's canned reply; nothing leaves the page. */
  sendChat(text: string) {
    const question = text.trim();
    if (!question) return;
    const key = this.state.screen === "note" ? "noteChat" : "libraryChat";
    this.setState((s) => ({ chatDraft: "", [key]: [...s[key], { role: "user", text: question }] }) as Pick<PreviewState, "chatDraft">);
    this.later(() => {
      this.setState(
        (s) => ({ [key]: [...s[key], { role: "assistant", text: this.studyData().chatReply }] }) as Pick<PreviewState, "libraryChat">,
      );
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

  /* The screen frame below the status bar (`.memo-home-screen` and friends). */
  screenFrame(children: ReactNode, extra?: CSSProperties) {
    return (
      <div
        style={{
          position: "absolute",
          inset: `${STATUS_H}px 0 0 0`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg)",
          animation: "memo-fade-in 0.18s ease-out",
          ...extra,
        }}
      >
        {children}
      </div>
    );
  }

  /* A floating bar over a screen's scroller: `.memo-m-topbar`, `.memo-settings-topbar`. */
  topBar(children: ReactNode, justify: CSSProperties["justifyContent"] = "space-between") {
    return (
      <div
        style={{
          position: "absolute",
          top: "8px",
          left: `${GUTTER}px`,
          right: `${GUTTER}px`,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: justify,
          gap: "12px",
          pointerEvents: "none",
        }}
      >
        {children}
      </div>
    );
  }

  noteMeta(note: PreviewNote): string {
    if (note.status !== "ready") return this.props.t("note.generating");
    return `${formatCalendarDate(note.date, this.props.locale)} • ${sourceMeta(note, this.props.t)}`;
  }

  renderHome(visible: PreviewNote[]) {
    const s = this.state;
    const t = this.props.t;
    const folderLabel = s.folders.find((f) => f.id === s.folderId)?.name ?? t("folders.allNotes");

    return this.screenFrame(
      <>
        {this.topBar(
          <>
            {/* Above the fold and inside a transformed, masked box, where a lazy image is
                not reliably triggered — so it is fetched eagerly. */}
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
              aria-label={t("nav.settings")}
              data-tap="settings"
              onClick={() => this.setState({ screen: "settings" })}
              style={{ ...roundBtn(49.6), position: "relative", zIndex: 1, pointerEvents: "auto" }}
            >
              <Msym name="settings" size="25.6px" fill={false} weight={500} />
            </button>
          </>,
        )}

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
          <h1
            style={{
              position: "relative",
              zIndex: 3,
              background: "var(--bg)",
              margin: `7.2px ${GUTTER}px 0`,
              fontSize: "21.6px",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1.3,
              height: "33.6px",
              overflow: "hidden",
              opacity: clamp01(1 - s.headP * 1.9),
              transition: "opacity 0.1s linear",
            }}
          >
            {t("library.myNotes")}
          </h1>

          <div
            style={{
              position: "relative",
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: "11.2px",
              height: "44px",
              margin: `12.8px ${GUTTER}px 0`,
              padding: "0 16.8px",
              borderRadius: "999px",
              background: "var(--field)",
              overflow: "hidden",
            }}
          >
            <Msym name="search" size="20.8px" fill={false} weight={600} style={{ color: "var(--text)" }} />
            <input
              value={s.query}
              onChange={(e) => this.setState({ query: e.target.value })}
              placeholder={t("library.search.placeholderLong")}
              aria-label={t("library.search.placeholder")}
              style={{
                width: "100%",
                minWidth: 0,
                border: 0,
                background: "transparent",
                outline: "none",
                color: "var(--text)",
                fontFamily: "inherit",
                fontSize: "16.32px",
                letterSpacing: "-0.02em",
              }}
            />
          </div>

          <div style={{ position: "relative", zIndex: 3, padding: `13.6px ${GUTTER}px 8.8px`, background: "var(--bg)" }}>
            <button
              type="button"
              data-tap="folders"
              onClick={() => this.setState({ sheet: "folders" })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8.8px",
                height: "43.2px",
                padding: "0 14.4px 0 12px",
                border: BTN_BORDER,
                borderRadius: "999px",
                background: "var(--surface)",
                color: "var(--text)",
                boxShadow: "var(--shadow)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              <Emoji symbol="📁" size="17.6px" />
              <span style={{ fontSize: "16.32px", fontWeight: 700, letterSpacing: "-0.025em", whiteSpace: "nowrap" }}>{folderLabel}</span>
              <Msym name="expand_more" size="19.2px" fill={false} weight={500} />
            </button>
          </div>

          <div style={{ padding: `0 ${GUTTER}px` }}>
            <div style={{ display: "grid", gap: "11.2px" }}>
              {visible.map((note) => this.renderNoteRow(note))}
            </div>

            {visible.length === 0 ? (
              <div style={{ display: "grid", justifyItems: "center", gap: "8px", padding: "56px 16px" }}>
                <Emoji symbol="📝" size="32px" />
                <p style={{ margin: 0, fontSize: "16.8px", fontWeight: 650 }}>
                  {s.query ? t("library.empty.noMatchTitle") : t("preview.folderEmptyTitle")}
                </p>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: "15.2px", textAlign: "center" }}>
                  {s.query ? t("library.empty.noMatchBody") : t("preview.folderEmptyBody")}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* `.memo-m-homebar`: the way into chat, and the one coral action. */}
        <div
          style={{
            position: "absolute",
            inset: `auto ${GUTTER}px 30.4px ${GUTTER}px`,
            zIndex: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14.4px",
          }}
        >
          <button
            type="button"
            aria-label={t("library.chatFab")}
            data-tap="library-chat"
            onClick={() => this.setState({ sheet: "chat" })}
            style={roundBtn(56.8)}
          >
            <Msym name="chat_bubble" size="25.6px" fill={false} weight={500} />
          </button>
          <button
            type="button"
            data-tap="create"
            onClick={() => this.setState({ sheet: "create" })}
            style={coralPill({ flex: "0 0 auto", minWidth: "198.4px", padding: "0 20.8px", gap: "9.6px" })}
          >
            <Msym name="edit_square" size="22.4px" fill={false} weight={500} />
            <span style={{ fontSize: "17.92px", fontWeight: 650 }}>{t("library.newNote")}</span>
          </button>
        </div>
      </>,
    );
  }

  /* One library row: `.memo-swipe-row`, which slides to uncover Edit and Delete. */
  renderNoteRow(note: PreviewNote) {
    const s = this.state;
    const t = this.props.t;
    const open = s.swipeId === note.id;
    const offset = open ? s.swipeX : 0;
    const action = (danger: boolean): CSSProperties => ({
      display: "grid",
      alignContent: "center",
      justifyItems: "center",
      gap: "4.8px",
      flex: "0 0 59.2px",
      width: "59.2px",
      padding: 0,
      border: 0,
      background: "transparent",
      color: danger ? "var(--danger)" : "var(--muted)",
      fontFamily: "inherit",
      fontSize: "11.52px",
      fontWeight: 650,
      cursor: "pointer",
    });
    const circle = (danger: boolean): CSSProperties => ({
      ...roundBtn(40),
      background: danger ? "var(--danger-tint)" : "var(--surface)",
    });

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
            this.openNote(note.id);
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
            background: "var(--surface)",
            boxShadow: "var(--shadow)",
            color: "var(--text)",
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
              background: "var(--tile)",
            }}
          >
            <Emoji symbol={note.emoji} size="21.6px" />
          </span>
          <span style={{ display: "grid", gap: "3.2px", minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: "17.28px", fontWeight: 650, letterSpacing: "-0.025em", lineHeight: 1.25 }}>{note.title}</span>
            <span
              style={{
                color: "var(--muted)",
                fontSize: "14.72px",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {this.noteMeta(note)}
            </span>
          </span>
          <button
            type="button"
            aria-label={t("library.row.actions", { title: note.title })}
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
              color: "var(--muted)",
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
            aria-label={t("library.row.rename", { title: note.title })}
            onClick={() => this.setState({ sheet: "rename", targetId: note.id, renameValue: note.title, swipeId: null, swipeX: 0 })}
            style={action(false)}
          >
            <span style={circle(false)}>
              <Emoji symbol="✏️" size="17.6px" />
            </span>
            <span>{t("common.edit")}</span>
          </button>
          <button
            type="button"
            aria-label={t("library.row.delete", { title: note.title })}
            onClick={() => this.setState({ sheet: "delete", targetId: note.id, swipeId: null, swipeX: 0 })}
            style={action(true)}
          >
            <span style={circle(true)}>
              <Emoji symbol="🗑️" size="17.6px" />
            </span>
            <span>{t("common.delete")}</span>
          </button>
        </div>
      </div>
    );
  }

  /*
   * Bring the pill that is on into view, the way the app's row follows its active tab:
   * centred where there is room, clamped to the ends. Only when the selection actually
   * changes, so a row the visitor has scrolled by hand stays put.
   */
  centreActiveTab() {
    const el = this.tabsRow;
    const active = this.state.screen === "note" ? this.state.tab : null;
    if (!el || !active || this.centredTab === active) return;
    this.centredTab = active;
    const on = el.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!on) return;
    const target = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
    const left = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
    if (Math.abs(el.scrollLeft - left) > 2) el.scrollTo({ left, behavior: "smooth" });
  }

  /*
   * The note's pill row: the app's own `.memo-tabs` / `.memo-tab`, with the phone's
   * height, padding and bleed restated because redesign.css keeps them in its phone
   * media block.
   */
  renderTabs(tabs: ReadonlyArray<(typeof TABS)[number]>, margin: string) {
    const active = this.state.tab;
    return (
      <div
        ref={(node) => {
          if (node !== this.tabsRow) this.centredTab = null;
          this.tabsRow = node;
          if (node) this.centreActiveTab();
        }}
        className="memo-tabs memo-chiprow"
        style={{ margin, padding: `2.4px ${GUTTER}px 8px`, gap: "9.6px", scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-tap="tab"
            data-tab={tab.id}
            className={`memo-tab ${active === tab.id ? "active" : ""}`.trim()}
            aria-current={active === tab.id ? "page" : undefined}
            onClick={() => this.selectTab(tab.id)}
            style={{ "--tab-tint": tab.tint, height: "44.8px", padding: "0 16px" } as CSSProperties}
          >
            <Msym name={tab.icon} size="1.2rem" fill={false} weight={500} />
            <span style={{ fontSize: "15.2px" }}>{this.props.t(tab.labelKey)}</span>
          </button>
        ))}
      </div>
    );
  }

  /*
   * The note screen (`.memo-note-screen`): the floating bar, the pill row and whichever
   * tab is on, with the dock over its foot. Every tab is the same screen in the app —
   * the bar names the tab instead of showing the note's emoji, and the title and date
   * belong to the notes tab only.
   */
  renderNote() {
    const s = this.state;
    const t = this.props.t;
    const note = this.activeNote();
    const tabs = TABS.filter((tab) => tab.id !== "transcript" || this.showsTranscript(note));
    const tab = s.tab;
    const titleKey = SUB_SCREEN_TITLE_KEYS[tab];
    const study = tab !== "notes" && tab !== "transcript";

    return this.screenFrame(
      <>
        {/* `.memo-m-navbar`: back, the note's emoji or the tab's name, and the actions. */}
        {this.topBar(
          <>
            <button
              type="button"
              aria-label={t("common.back")}
              data-tap="note-back"
              onClick={() => this.goHome()}
              style={{ ...roundBtn(46.4), pointerEvents: "auto" }}
            >
              <Msym name="arrow_back" size="24px" fill={false} weight={500} />
            </button>
            {titleKey ? (
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "center",
                  fontSize: "17.92px",
                  fontWeight: 750,
                  letterSpacing: "-0.03em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t(titleKey)}
              </span>
            ) : (
              <Emoji symbol={note?.emoji ?? "📝"} size="24px" />
            )}
            <button
              type="button"
              aria-label={t("note.actions")}
              onClick={() => this.setState({ sheet: "actions", targetId: note?.id ?? null })}
              style={{ ...roundBtn(46.4), pointerEvents: "auto" }}
            >
              <Msym name="more_horiz" size="21.6px" fill weight={500} />
            </button>
          </>,
        )}

        {study ? (
          /*
           * A study tab: the row stays put and the tab's own screen fills what is left —
           * each of them carries its own scroller, as the note's does in the app.
           */
          <>
            <div style={{ flex: "0 0 auto", paddingTop: "65.6px" }}>{this.renderTabs(tabs, "1.6px 0 10.4px")}</div>
            <div
              className={`landing-hero-tabbody ${this.dockFor(tab) ? "has-dock" : ""}`.trim()}
              data-note-tab={tab}
              style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
            >
              {this.renderStudyTab(tab as StudyTab)}
            </div>
          </>
        ) : (
          <div
            data-app-main
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: `65.6px ${GUTTER}px 112px`,
              maskImage: NOTE_SCROLL_MASK,
              WebkitMaskImage: NOTE_SCROLL_MASK,
            }}
          >
            {this.renderTabs(tabs, `1.6px -${GUTTER}px 14.4px`)}
            {tab === "notes" ? this.renderNotesTab(note) : this.renderTranscript()}
          </div>
        )}

        {this.renderDock()}
      </>,
    );
  }

  /*
   * What sits in the dock row on a tab: the listen pill, the edit pill, the chat bar —
   * or, on the podcast, the listening allowance on its own in the middle.
   */
  dockFor(tab: NoteTab): { pill: "listen" | "manage" | "usage" | null; chat: boolean } | null {
    const chat = !TABS_WITHOUT_CHAT.has(tab);
    const pill =
      tab === "notes" ? "listen" : TABS_WITH_MANAGE_PILL.has(tab) ? "manage" : tab === "podcast" ? "usage" : null;
    return chat || pill ? { pill, chat } : null;
  }

  /* The notes tab: title, source line, and the note in the app's markdown blocks. */
  renderNotesTab(note: PreviewNote | undefined) {
    const s = this.state;
    const lines = this.bodyLines();
    const reading = s.reading || s.readPaused;
    const meta = note
      ? `${formatCalendarDate(note.date, this.props.locale)}, ${sourceMeta(note, this.props.t)}`
      : "";

    /* Consecutive list items are one list, as markdown renders them. */
    const groups: Array<{ kind: "ul"; items: BodyLine[] } | BodyLine> = [];
    lines.forEach((line) => {
      const last = groups[groups.length - 1];
      if (line.kind === "li") {
        if (last && "items" in last) last.items.push(line);
        else groups.push({ kind: "ul", items: [line] });
        return;
      }
      groups.push(line);
    });

    const words = (line: BodyLine) =>
      line.words.map((word, wi) => {
        const state = reading ? (word.index === s.readWord ? " current" : word.index < s.readWord ? " read" : "") : "";
        return (
          <span key={word.index}>
            {wi === 0 ? null : <span> </span>}
            {/* The app's own read-aloud word (`.note-read-word`), coloured from the
                hero's `--note-read-*` values in landing.css. */}
            <span className={`note-read-word${state}`}>{word.text}</span>
          </span>
        );
      });

    const text: CSSProperties = { fontSize: "16.96px", lineHeight: 1.6 };

    return (
      <>
        <h1 style={{ margin: "0 0 12px", fontSize: "26.4px", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.18 }}>
          {note?.title ?? ""}
        </h1>
        <div
          style={{
            marginBottom: "17.6px",
            color: "var(--muted)",
            fontSize: "14.72px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {meta}
        </div>

        <div className="landing-hero-note" style={{ marginTop: "25.6px", WebkitUserSelect: "text", userSelect: "text" }}>
          {groups.map((group, gi) => {
            if ("items" in group) {
              return (
                <ul key={gi} style={{ display: "grid", gap: "8.8px", margin: "11.2px 0 16.8px", padding: 0, listStyle: "none" }}>
                  {group.items.map((item, ii) => (
                    <li key={ii} style={{ ...text, position: "relative", paddingLeft: "16.8px" }}>
                      <span aria-hidden="true" className="landing-hero-bullet">
                        •
                      </span>
                      {words(item)}
                    </li>
                  ))}
                </ul>
              );
            }
            if (group.kind === "h2") {
              return (
                <h2
                  key={gi}
                  style={{ margin: gi === 0 ? "0 0 11.2px" : "30.4px 0 11.2px", fontSize: "22.4px", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: "32px" }}
                >
                  <span className="landing-hero-heading-mark">{words(group)}</span>
                </h2>
              );
            }
            if (group.kind.startsWith("callout-")) {
              const callout = CALLOUT_EDGE[group.kind.slice(8)] ?? CALLOUT_EDGE.definition;
              return (
                <blockquote
                  key={gi}
                  style={{
                    margin: "16px 0",
                    padding: "13.6px 16px 13.6px 18.4px",
                    border: `1px solid var(--hero-callout-${callout.token}-line)`,
                    borderLeft: `4px solid ${callout.edge}`,
                    borderRadius: "14px",
                    background: `var(--hero-callout-${callout.token}-bg)`,
                    fontSize: "16.96px",
                    lineHeight: 1.82,
                  }}
                >
                  {words(group)}
                </blockquote>
              );
            }
            return (
              <p key={gi} style={{ ...text, margin: 0 }}>
                {words(group)}
              </p>
            );
          })}
        </div>
      </>
    );
  }

  /* The transcript tab: the recording's player above the text (`.memo-transcript`). */
  renderTranscript() {
    const t = this.props.t;
    return (
      <div className="memo-transcript">
        <div className="memo-player">
          <div className="memo-player-track">
            <div style={{ width: "27%" }} />
            <span className="memo-player-knob" style={{ left: "27%" }} />
          </div>
          <div className="memo-player-times">
            <span>12:48</span>
            <span>47:38</span>
          </div>
          <div className="memo-player-controls">
            {/* The phone's sizes: 3rem and 4.2rem. */}
            <button type="button" className="memo-player-skip" aria-label={t("recording.backSeconds", { seconds: 10 })} style={{ width: "48px", height: "48px" }}>
              <Msym name="replay_10" size="1.45rem" fill={false} weight={500} />
            </button>
            <button type="button" className="memo-player-play" aria-label={t("recording.play")} style={{ width: "67.2px", height: "67.2px" }}>
              <Msym name="play_arrow" size="2rem" fill />
            </button>
            <button type="button" className="memo-player-skip" aria-label={t("recording.forwardSeconds", { seconds: 10 })} style={{ width: "48px", height: "48px" }}>
              <Msym name="forward_10" size="1.45rem" fill={false} weight={500} />
            </button>
          </div>
          <div className="memo-player-rate-row">
            <button type="button" className="memo-player-rate" aria-label={t("recording.speed")}>
              <Msym name="speed" size="1.15rem" fill={false} weight={500} />
              1x
            </button>
          </div>
        </div>

        <div className="memo-transcript-rows">
          {this.studyData().transcript.map((line) => (
            <div key={line.time} className="memo-transcript-row">
              <span className="memo-transcript-time">{line.time}</span>
              <span className="memo-transcript-text">{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /*
   * A study tab's body: the landing's shared app screen, painted in the phone's own
   * Appearance, on the note's own material where the screen takes one. The tour hands
   * the tab it opens `autoplay`; the visitor's first touch ends it.
   */
  renderStudyTab(tab: StudyTab) {
    const s = this.state;
    const t = this.props.t;
    const note = this.activeNote();
    const theme = this.appTheme();
    const autoplay = s.autoplayTab === tab;
    const noteTheme = note?.theme ?? "is";
    const key = `${note?.id ?? "note"}-${tab}`;

    switch (tab) {
      case "tutor":
        return (
          <div key={key} style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, minHeight: 0, overflow: "hidden", padding: `13.6px ${GUTTER}px 0` }}>
            <LandingTutorDemo inset="phone" theme={theme} onOpenFlashcards={() => this.selectTab("flashcards")} />
          </div>
        );
      case "flashcards":
        return <LandingFlashcardsScreen key={key} theme={theme} autoplay={autoplay} content={themeFlashcards(noteTheme, t)} />;
      case "podcast":
        return <LandingPodcastScreen key={key} theme={theme} autoplay={autoplay} title={note?.title} />;
      case "quiz":
        return <LandingQuizScreen key={key} theme={theme} autoplay={autoplay} content={themeQuiz(noteTheme, t)} />;
      case "mindmap":
        return <LandingMindmapScreen key={key} theme={theme} autoplay={autoplay} />;
      case "palace":
        return (
          <LandingPalaceScreen
            key={key}
            theme={theme}
            autoplay={autoplay}
            cards={themeFlashcards(noteTheme, t)}
            quiz={themeQuiz(noteTheme, t)}
          />
        );
      case "test":
        return <LandingTestScreen key={key} theme={theme} autoplay={autoplay} />;
      case "exam":
        return <LandingExamScreen key={key} theme={theme} />;
      case "speed":
        return <LandingSpeedReadScreen key={key} theme={theme} autoplay={autoplay} markdown={noteBodyMarkdown(this.noteBlocks())} />;
    }
  }

  /*
   * The dock (`.memo-dock`): on the notes tab a listen pill that grows into the reader
   * and the way into chat, trading the row's width between them; on the practice tabs
   * the edit pill and the chat bar; on the watched and played tabs nothing.
   */
  renderDock() {
    const s = this.state;
    const t = this.props.t;
    const dock = this.dockFor(s.tab);
    if (!dock) return null;
    const reading = dock.pill === "listen" && (s.reading || s.readPaused);
    const lines = this.bodyLines();
    const total = lines.reduce((n, line) => n + line.words.length, 0);
    const seconds = Math.round((s.readWord / Math.max(1, total)) * 214);
    const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const round = (extra?: CSSProperties): CSSProperties => ({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "41.6px",
      height: "41.6px",
      flex: "0 0 auto",
      padding: 0,
      border: 0,
      borderRadius: "999px",
      cursor: "pointer",
      ...extra,
    });

    return (
      <div
        style={{
          position: "absolute",
          inset: `auto ${GUTTER}px 25.6px ${GUTTER}px`,
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: dock.pill === "usage" ? "center" : undefined,
          gap: "11.2px",
          height: "54.4px",
        }}
      >
        {/* The voice allowance (`VoiceUsageSheet`'s meter), at the phone's size. */}
        {dock.pill === "usage" ? (
          <span className="memo-tutor-usage-menu">
            <span className="memo-tutor-usage-trigger" style={{ height: "36.8px", padding: "0 12px", fontSize: "13.6px" }}>
              <span>100%</span>
            </span>
          </span>
        ) : null}

        {dock.pill === "listen" ? (
          <div
            style={{
              position: "relative",
              flex: "0 0 auto",
              height: "54.4px",
              borderRadius: "999px",
              background: "var(--surface)",
              boxShadow: FLOATING_SHADOW,
              width: reading ? "calc(100% - 65.6px)" : "54.4px",
              maxWidth: "calc(100% - 65.6px)",
              transition: "width 0.38s cubic-bezier(0.32,0.72,0,1)",
            }}
          >
            <button
              type="button"
              aria-label={t("readAloud.listen")}
              data-tap="listen"
              onClick={() => this.toggleRead()}
              style={{
                ...round({ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent", color: "var(--text)" }),
                opacity: reading ? 0 : 1,
                pointerEvents: reading ? "none" : "auto",
                transition: `opacity 0.2s ease ${reading ? "0s" : "0.1s"}`,
              }}
            >
              <Msym name="headphones" size="24.8px" fill={false} weight={500} />
            </button>

            {/* `.memo-dock-player`: play, progress, time, listening settings, close. */}
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
                aria-label={t(s.reading ? "readAloud.pause" : "readAloud.listen")}
                onClick={() => this.toggleRead()}
                style={round({ background: "var(--text)", color: "var(--bg)" })}
              >
                <Msym name={s.reading ? "pause" : "play_arrow"} size="21.6px" />
              </button>
              <span style={{ display: "block", flex: 1, minWidth: "32px", height: "3px", margin: "0 9.6px", borderRadius: "999px", background: "var(--field)" }}>
                <span
                  style={{
                    display: "block",
                    width: `${Math.round((s.readWord / Math.max(1, total)) * 100)}%`,
                    height: "100%",
                    borderRadius: "999px",
                    background: "var(--text)",
                    transition: "width 0.2s linear",
                  }}
                />
              </span>
              <span style={{ flex: "0 0 auto", margin: "0 4px", color: "var(--muted)", fontSize: "13.76px", fontWeight: 650, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {elapsed}
              </span>
              <button type="button" aria-label={t("readAloud.settings")} style={round({ background: "var(--tile)", color: "var(--text)" })}>
                <Msym name="tune" size="20px" fill={false} weight={500} />
              </button>
              <button type="button" aria-label={t("readAloud.close")} onClick={() => this.stopRead()} style={round({ background: "transparent", color: "var(--muted)" })}>
                <Msym name="close" size="23.2px" fill={false} weight={500} />
              </button>
            </div>
          </div>
        ) : null}

        {dock.pill === "manage" ? (
          <button
            type="button"
            aria-label={t(s.tab === "flashcards" ? "manager.editCards" : "manager.editQuiz")}
            style={roundBtn(54.4)}
          >
            <Msym name="edit_square" size="20.8px" fill={false} weight={500} />
          </button>
        ) : null}

        {dock.chat ? (
          <button
            type="button"
            aria-label={t("chat.mobileBar")}
            data-tap="chatbar"
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
              color: "var(--muted)",
              width: reading ? "54.4px" : dock.pill ? "calc(100% - 65.6px)" : "100%",
              /* The app's chat circle is this ink in both appearances. */
              background: reading ? "#17171a" : "var(--surface)",
              boxShadow: FLOATING_SHADOW,
              transition: "width 0.38s cubic-bezier(0.32,0.72,0,1), background 0.3s ease",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: `${GUTTER}px`,
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
              {t("chat.mobileBar")}
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
              <Msym name="chat_bubble" size="21.6px" style={{ position: "absolute", opacity: reading ? 1 : 0, transition: "opacity 0.2s ease" }} />
            </span>
          </button>
        ) : null}
      </div>
    );
  }

  /*
   * The capture screen each create option opens (note-source-modal.tsx, full screen on
   * the phone), already holding the file the demo picked.
   */
  renderCapture() {
    const s = this.state;
    const t = this.props.t;
    const spec = CAPTURE[s.captureMode];
    const isRecord = s.captureMode === "record";
    const isFile = s.captureMode === "upload" || s.captureMode === "file";

    return this.screenFrame(
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: `8px ${GUTTER}px 20px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", paddingBottom: "11.2px" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: "17.28px", fontWeight: 750, letterSpacing: "-0.03em" }}>{t(spec.titleKey)}</span>
          <button type="button" aria-label={t("common.close")} onClick={() => this.setState({ screen: "home" })} style={roundBtn(46.4)}>
            <Msym name="close" size="23.2px" fill={false} weight={500} />
          </button>
        </div>

        <div data-app-main style={{ display: "flex", flexDirection: "column", gap: "17.6px", flex: 1, minHeight: 0, marginTop: "12.8px", paddingTop: "16px" }}>
          {isRecord ? (
            <div style={{ display: "grid", justifyItems: "center", gap: "22.4px", padding: "40px 0 0" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "144px",
                  height: "144px",
                  borderRadius: "999px",
                  background: "color-mix(in srgb, var(--promo) 14%, transparent)",
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
                    background: "var(--coral)",
                    color: "#fff",
                  }}
                >
                  <Msym name="mic" size="41.6px" />
                </div>
              </div>
              <span style={{ fontSize: "32px", fontWeight: 750, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>0:00</span>
              <span style={{ color: "var(--muted)", fontSize: "16px" }}>{t("capture.recordActive")}</span>
            </div>
          ) : null}

          {/* `.note-source-prepared-card`: the source this screen is about, named. */}
          {isFile ? (
            <div style={{ padding: "19.2px", border: "1px solid var(--line)", borderRadius: "20px", background: "var(--bg)" }}>
              <p style={EYEBROW}>{t("capture.selectedFile")}</p>
              <p style={{ margin: 0, fontSize: "16.8px", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {spec.pickedName}
              </p>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: "13.6px", lineHeight: 1.3 }}>
                {spec.pickedMetaKey ? t(spec.pickedMetaKey) : spec.pickedMeta}
              </p>
            </div>
          ) : null}

          {s.captureMode === "link" ? (
            <textarea
              value={s.captureText}
              onChange={(e) => this.setState({ captureText: e.target.value })}
              placeholder={spec.placeholder}
              aria-label={t(spec.titleKey)}
              style={{
                width: "100%",
                height: "224px",
                padding: "17.6px 19.2px",
                border: 0,
                borderRadius: "22px",
                background: "var(--surface)",
                color: "var(--text)",
                boxShadow: "var(--shadow)",
                outline: "none",
                fontFamily: "inherit",
                fontSize: "16.8px",
                lineHeight: 1.5,
                resize: "none",
              }}
            />
          ) : null}

          {/* `.memo-modal-actions`: the primary above, the way out beneath it. */}
          <div style={{ marginTop: "auto", display: "grid", gap: "11.2px", paddingTop: "9.6px" }}>
            <button type="button" data-tap="capture-cta" onClick={() => this.addNote()} style={coralPill({ width: "100%" })}>
              {t(spec.ctaKey)}
            </button>
            <button type="button" onClick={() => this.setState({ screen: "home" })} style={outlinePill(48)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>,
    );
  }

  /* ── Settings and help ────────────────────────────────────── */

  /* A scrolling page under a floating control (`.memo-screen-scroll` > `.memo-page`). */
  pageScroller(children: ReactNode) {
    return (
      <div
        data-app-main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingTop: "64px",
          maskImage: HOME_SCROLL_MASK,
          WebkitMaskImage: HOME_SCROLL_MASK,
        }}
      >
        <div style={{ padding: `0 ${GUTTER}px 40px` }}>{children}</div>
      </div>
    );
  }

  /* A settings row (`.memo-settings-row` inside `.memo-settings-list`). */
  settingsRow(row: { id: string; title: string; detail?: string; emoji?: string; icon?: string; danger?: boolean; onClick?: () => void }, first: boolean) {
    return (
      <button
        key={row.id}
        type="button"
        onClick={row.onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14.4px",
          width: "100%",
          height: "67.2px",
          padding: "0 19.2px",
          border: 0,
          borderTop: rowRule(first),
          background: "transparent",
          color: "var(--text)",
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
            background: row.danger ? "var(--danger-tint)" : "var(--tile)",
          }}
        >
          {row.icon ? <Msym name={row.icon} size="21.6px" fill weight={500} /> : <Emoji symbol={row.emoji ?? ""} size="20px" />}
        </span>
        <span style={{ display: "grid", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: "17.6px", fontWeight: 650, letterSpacing: "-0.025em", color: row.danger ? "var(--danger)" : undefined }}>
            {row.title}
          </span>
          {row.detail ? <span style={{ color: "var(--muted)", fontSize: "15.2px" }}>{row.detail}</span> : null}
        </span>
        <Msym name="chevron_right" size="24px" fill={false} weight={400} style={{ color: "var(--muted)" }} />
      </button>
    );
  }

  /* Settings, as the phone draws `settings-screen.tsx`: a screen of its own with a close. */
  renderSettings() {
    const s = this.state;
    const t = this.props.t;
    const heading = (first: boolean): CSSProperties => ({
      margin: first ? "0 0 11.2px" : "24px 0 11.2px",
      fontSize: "20px",
      fontWeight: 750,
      letterSpacing: "-0.03em",
    });
    const rows = [
      { id: "language", icon: "language", title: t("settings.language.title"), detail: LOCALE_LABELS[this.props.locale] },
      { id: "analytics", emoji: "📊", title: t("settings.analytics.title"), detail: t("settings.analytics.off") },
      { id: "redeem", emoji: "🎟️", title: t("settings.rows.redeem") },
      { id: "privacy", emoji: "🔒", title: t("settings.rows.privacy") },
      { id: "share", emoji: "📤", title: t("settings.rows.share") },
      { id: "feature", emoji: "💡", title: t("settings.rows.feature") },
      { id: "delete", emoji: "🗑️", title: t("settings.delete.row"), danger: true },
    ];

    return this.screenFrame(
      <>
        {this.topBar(
          <button
            type="button"
            aria-label={t("common.close")}
            data-tap="settings-close"
            onClick={() => this.setState({ screen: "home" })}
            style={{ ...roundBtn(46.4), pointerEvents: "auto" }}
          >
            <Msym name="close" size="23.2px" fill={false} weight={500} />
          </button>,
          "flex-end",
        )}
        {this.pageScroller(
          <>
            <h1 style={{ margin: "0 0 19.2px", fontSize: "28px", fontWeight: 800, letterSpacing: "-0.04em" }}>{t("settings.title")}</h1>

            <h2 style={heading(true)}>{t("settings.theme.heading")}</h2>
            {/* `.memo-segment`, System first as the phone orders it. */}
            <div style={{ display: "flex", gap: "6.4px", padding: "5.6px", borderRadius: "999px", background: "var(--field)" }}>
              {THEME_OPTIONS.map((option) => {
                const on = s.theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => this.setState({ theme: option.value })}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: "44.8px",
                      padding: 0,
                      border: 0,
                      borderRadius: "999px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      background: on ? "var(--surface)" : "transparent",
                      color: on ? "var(--text)" : "var(--muted)",
                      boxShadow: on ? "var(--shadow)" : "none",
                      transition: "background 0.18s cubic-bezier(0.22,1,0.36,1), color 0.18s ease",
                    }}
                  >
                    {t(option.labelKey)}
                  </button>
                );
              })}
            </div>

            <h2 style={heading(false)}>{t("settings.subscription.heading")}</h2>
            <div style={CARD_ROW}>
              <span style={{ display: "grid", gap: "2.4px" }}>
                <span style={EYEBROW}>{t("settings.plan.eyebrow")}</span>
                <span style={{ fontSize: "17.28px", fontWeight: 700, letterSpacing: "-0.02em" }}>{t("preview.planMonthly")}</span>
                <span style={{ color: "var(--muted)", fontSize: "15.2px" }}>{t("preview.planUntil")}</span>
              </span>
              <button type="button" style={coralPill({ width: "100%", height: "52.8px", gap: "7.2px", padding: "0 19.2px", fontSize: "16.32px", fontWeight: 750 })}>
                <Emoji symbol="✨" size="16px" />
                <span>{t("preview.managePlan")}</span>
              </button>
            </div>
            <p style={{ margin: "11.2px 0 0 3.2px", color: "var(--muted)", fontSize: "15.2px" }}>
              {t("settings.finePrint.refundBefore")}
              <span style={{ color: "var(--text)", textDecoration: "underline" }}>{t("settings.finePrint.refundLink")}</span>.
            </p>

            <h2 style={heading(false)}>{t("settings.account.heading")}</h2>
            <div style={{ ...CARD_ROW, gap: 0 }}>
              <span style={EYEBROW}>{t("settings.account.signedIn")}</span>
              <span
                style={{
                  margin: "4.8px 0 14.4px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontSize: "16.8px",
                  fontWeight: 650,
                  letterSpacing: "-0.02em",
                }}
              >
                ana.kovac@student.uni-lj.si
              </span>
              <button type="button" style={outlinePill(48)}>
                {t("settings.signOut")}
              </button>
            </div>

            <div style={{ ...SURFACE_CARD, display: "grid", marginTop: "12.8px" }}>
              {rows.map((row, i) => this.settingsRow(row, i === 0))}
            </div>

            <h2 style={heading(false)}>{t("settings.help.heading")}</h2>
            <div style={{ ...SURFACE_CARD, display: "grid", marginTop: "12.8px" }}>
              {this.settingsRow(
                { id: "help", icon: "help", title: t("settings.rows.help"), onClick: () => this.setState({ screen: "support" }) },
                true,
              )}
            </div>
          </>,
        )}
      </>,
    );
  }

  /* The help centre, as `support-screen.tsx` draws it on the phone. */
  renderSupport() {
    const t = this.props.t;
    return this.screenFrame(
      <>
        {this.topBar(
          <button
            type="button"
            aria-label={t("common.back")}
            onClick={() => this.setState({ screen: "home" })}
            style={{ ...roundBtn(49.6), pointerEvents: "auto" }}
          >
            <Msym name="arrow_back" size="24px" fill={false} weight={500} />
          </button>,
          "flex-end",
        )}
        {this.pageScroller(
          <>
            <h1 style={{ margin: 0, fontSize: "25.6px", fontWeight: 800, letterSpacing: "-0.04em" }}>{t("help.title")}</h1>
            {HELP_SECTIONS.map((section) => (
              <div key={section.titleKey} style={{ marginTop: "32px" }}>
                <h2 style={{ margin: "0 0 13.6px", fontSize: "19.2px", fontWeight: 750, letterSpacing: "-0.03em" }}>{t(section.titleKey)}</h2>
                <div style={{ ...SURFACE_CARD, borderRadius: "22px" }}>
                  {section.itemKeys.map((item, i) => (
                    <button
                      key={item}
                      type="button"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                        width: "100%",
                        minHeight: "62.4px",
                        padding: "9.6px 19.2px",
                        border: 0,
                        borderTop: rowRule(i === 0),
                        background: "transparent",
                        color: "var(--text)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ flex: 1, fontSize: "16.8px", fontWeight: 600, letterSpacing: "-0.02em" }}>{t(item)}</span>
                      <Msym name="chevron_right" size="22.4px" fill={false} weight={400} style={{ color: "var(--muted-2)" }} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>,
        )}
      </>,
    );
  }

  /* ── Sheets ───────────────────────────────────────────────── */

  /*
   * The app's dismissal: the sheet drops out of frame and dims slightly before it is
   * unmounted, rather than vanishing. `swapSheet` is the same move with another sheet
   * arriving in its place.
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
          background: "var(--scrim)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          opacity: this.state.sheetClosing ? 0 : 1,
          transition: "opacity 0.26s ease",
          animation: this.state.sheetClosing ? undefined : "memo-fade-in 0.15s ease-out",
        }}
      />
    );
  }

  renderCreateSheet() {
    const t = this.props.t;
    const sheet = this.sheetProps("create", this.closeSheet);
    return (
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        {sheetTitle(t("library.newNote"), t("common.close"), this.closeSheet)}
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
                background: "var(--surface)",
                color: "var(--text)",
                boxShadow: "var(--shadow)",
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
                  background: "var(--tile)",
                }}
              >
                <Emoji symbol={option.emoji} size="21.6px" />
              </span>
              <span style={{ fontSize: "17.92px", fontWeight: 700, letterSpacing: "-0.025em" }}>{t(option.labelKey)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* The folder picker (`.library-folder-mobile-sheet`). */
  renderFoldersSheet() {
    const s = this.state;
    const t = this.props.t;
    const sheet = this.sheetProps("folders", this.closeSheet);
    const options: Array<{ id: string | null; name: string; icon: string }> = [
      { id: null, name: t("folders.allNotes"), icon: "📁" },
      ...s.folders.map((f) => ({ id: f.id, name: f.name, icon: f.icon })),
    ];
    return (
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        {sheetTitle(t("folders.title"), t("common.close"), this.closeSheet, 16, "normal")}
        <div style={SURFACE_CARD}>
          {options.map((folder, i) => (
            <div key={folder.id ?? "all"} style={{ display: "flex", alignItems: "center", gap: "12.8px", borderTop: rowRule(i === 0) }}>
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
                  color: "var(--text)",
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
                  aria-label={t("preview.folderOptions")}
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
                    color: "var(--muted)",
                    cursor: "pointer",
                  }}
                >
                  <Msym name="more_horiz" size="24px" fill={false} weight={500} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "22.4px", paddingBottom: "20px" }}>
          <button
            type="button"
            onClick={() => {
              this.setState({ newFolderName: "" });
              this.swapSheet("newFolder");
            }}
            style={coralPill({ minWidth: "200px", height: "57.6px", padding: "0 32px", fontSize: "18.4px", letterSpacing: "-0.02em" })}
          >
            {t("folders.new")}
          </button>
        </div>
      </div>
    );
  }

  renderNewFolderSheet() {
    const s = this.state;
    const t = this.props.t;
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
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "40px", marginBottom: "20.8px" }}>
          <span style={{ fontSize: "20px", fontWeight: 750, letterSpacing: "-0.03em" }}>{t("folders.new")}</span>
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
              color: "var(--text)",
              fontFamily: "inherit",
              fontSize: "16.32px",
              fontWeight: 700,
              opacity: s.newFolderName.trim() ? 1 : 0.4,
              cursor: "pointer",
            }}
          >
            {t("common.done")}
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
              background: "var(--tile)",
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
          placeholder={t("folders.name")}
          aria-label={t("folders.name")}
          maxLength={32}
          style={{
            width: "100%",
            height: "57.6px",
            padding: "0 19.2px",
            border: 0,
            borderRadius: "999px",
            background: "var(--field)",
            color: "var(--text)",
            outline: "none",
            fontFamily: "inherit",
            fontSize: "17.28px",
            fontWeight: 600,
          }}
        />
        <p style={{ margin: "14.4px 0 0", textAlign: "center", color: "var(--muted)", fontSize: "15.2px" }}>{t("folders.hintMobile")}</p>
      </div>
    );
  }

  /* The note's actions (`.memo-action-sheet`). */
  renderActionsSheet() {
    const s = this.state;
    const t = this.props.t;
    const sheet = this.sheetProps("actions", this.closeSheet);
    const note = s.notes.find((n) => n.id === s.targetId);
    const item = (danger: boolean): CSSProperties => ({
      display: "flex",
      alignItems: "center",
      gap: "14.4px",
      height: "62.4px",
      padding: "0 19.2px",
      border: BTN_BORDER,
      borderRadius: "20px",
      background: "var(--surface)",
      color: danger ? "var(--danger)" : "var(--text)",
      boxShadow: "var(--shadow)",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: "17.28px",
      fontWeight: 650,
      letterSpacing: "-0.025em",
    });
    return (
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <p style={{ margin: "0 0 14.4px", textAlign: "center", color: "var(--muted)", fontSize: "15.68px" }}>{note?.title ?? ""}</p>
        <div style={{ display: "grid", gap: "11.2px" }}>
          <button
            type="button"
            onClick={() => {
              this.setState({ renameValue: note?.title ?? "" });
              this.swapSheet("rename");
            }}
            style={item(false)}
          >
            <Msym name="edit" size="22.4px" fill weight={500} />
            {t("common.rename")}
          </button>
          <button type="button" onClick={() => this.swapSheet("delete")} style={item(true)}>
            <Msym name="delete" size="22.4px" fill weight={500} />
            {t("common.delete")}
          </button>
          <button type="button" onClick={this.closeSheet} style={outlinePill(56, { borderRadius: "20px", fontSize: "16.8px", letterSpacing: "-0.02em" })}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  /* Rename (`.memo-sheet.memo-dialog`). */
  renderRenameSheet() {
    const s = this.state;
    const t = this.props.t;
    const sheet = this.sheetProps("rename", this.closeSheet);
    return (
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <span style={SHEET_HEADING}>{t("library.rename.title")}</span>
        <input
          value={s.renameValue}
          onChange={(e) => this.setState({ renameValue: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") this.saveRename();
          }}
          placeholder={t("library.rename.placeholder")}
          aria-label={t("library.rename.placeholder")}
          style={{
            width: "100%",
            height: "57.6px",
            padding: "0 19.2px",
            border: 0,
            borderRadius: "999px",
            background: "var(--field)",
            color: "var(--text)",
            outline: "none",
            fontFamily: "inherit",
            fontSize: "17.28px",
            fontWeight: 600,
          }}
        />
        <div style={{ display: "grid", gap: "11.2px", marginTop: "16px" }}>
          <button type="button" onClick={() => this.saveRename()} style={coralPill({ width: "100%", height: "54.4px", fontSize: "17.28px" })}>
            {t("common.save")}
          </button>
          <button type="button" onClick={this.closeSheet} style={outlinePill(49.6)}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  /* Delete (`.memo-sheet.memo-dialog`). */
  renderDeleteSheet() {
    const s = this.state;
    const t = this.props.t;
    const sheet = this.sheetProps("delete", this.closeSheet);
    const note = s.notes.find((n) => n.id === s.targetId);
    return (
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB}
        <span style={SHEET_HEADING}>{t("library.delete.title")}</span>
        <p style={{ margin: "0 0 17.6px", textAlign: "center", color: "var(--muted)", fontSize: "16px", lineHeight: 1.4 }}>
          {t("library.delete.body", { title: note?.title ?? "" })}
        </p>
        <div style={{ display: "grid", gap: "11.2px", marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => this.setState((c) => ({ notes: c.notes.filter((n) => n.id !== c.targetId), sheet: null, targetId: null }))}
            style={coralPill({ width: "100%", height: "54.4px", fontSize: "17.28px", background: "var(--danger)", boxShadow: "none" })}
          >
            {t("library.delete.title")}
          </button>
          <button type="button" onClick={this.closeSheet} style={outlinePill(49.6)}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  /*
   * The two conversations. From the library it is `library-chat.tsx`'s phone sheet,
   * scoped to recent notes and not saved; from a note it is the note's own chat
   * (`lecture-workspace.tsx`), with its suggestions and composer.
   */
  renderChatSheet() {
    return this.state.screen === "note" ? this.renderNoteChatSheet() : this.renderLibraryChatSheet();
  }

  /* The send control: a microphone while the field is empty, then Send (`.memo-chat-send`). */
  renderSendButton(label: string) {
    const ready = Boolean(this.state.chatDraft.trim());
    return (
      <button
        type="button"
        aria-label={ready ? label : this.props.t("chat.dictate.start")}
        className={`memo-chat-send ${ready ? "ready" : "mic"}`}
        onClick={() => this.sendChat(this.state.chatDraft)}
      >
        <Msym name={ready ? "arrow_upward" : "mic"} size="1.5rem" />
      </button>
    );
  }

  renderChatInput(placeholder: string, extra?: CSSProperties) {
    return (
      <input
        value={this.state.chatDraft}
        onChange={(e) => this.setState({ chatDraft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.sendChat(this.state.chatDraft);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          border: 0,
          background: "transparent",
          outline: "none",
          color: "var(--text)",
          fontFamily: "inherit",
          letterSpacing: "-0.02em",
          ...extra,
        }}
      />
    );
  }

  /* The sheet's head: a title in the middle, round controls at the edges (`.memo-m-chat-head`). */
  chatHead(center: ReactNode, left?: ReactNode) {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: `8.8px ${GUTTER}px 9.6px` }}>
        {left}
        {center}
        <button
          type="button"
          aria-label={this.props.t("common.close")}
          onClick={this.closeSheet}
          style={{ ...roundBtn(46.4), position: "absolute", right: `${GUTTER}px` }}
        >
          <Msym name="close" size="23.2px" fill={false} weight={500} />
        </button>
      </div>
    );
  }

  renderLibraryChatSheet() {
    const s = this.state;
    const t = this.props.t;
    const sheet = this.fullSheetProps("chat", this.closeSheet);
    const scope = t("libraryChat.scope.recent");

    return (
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB_WIDE}
        {this.chatHead(
          <span style={{ display: "grid", justifyItems: "center", gap: "1.6px", maxWidth: "calc(100% - 128px)", minWidth: 0 }}>
            <span style={{ fontSize: "17.92px", fontWeight: 750, letterSpacing: "-0.03em" }}>{t("libraryChat.chattingWith")}</span>
            <span style={{ display: "flex", alignItems: "center", gap: "5.6px", maxWidth: "100%", minWidth: 0, color: "var(--muted)", fontSize: "15.2px", letterSpacing: "-0.02em" }}>
              <Emoji symbol="📌" size="13.6px" />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scope}</span>
            </span>
          </span>,
          <button
            type="button"
            aria-label={t("libraryChat.newChat")}
            onClick={() => this.setState({ libraryChat: [], chatDraft: "" })}
            style={{ ...roundBtn(46.4), position: "absolute", left: `${GUTTER}px` }}
          >
            <Msym name="edit_square" size="23.2px" fill={false} weight={500} />
          </button>,
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: "14.4px",
            overflowY: "auto",
            padding: `28.8px ${GUTTER}px 16px`,
          }}
        >
          <p style={{ margin: 0, paddingLeft: "14.4px", borderLeft: "3px solid var(--promo)", fontSize: "16.32px", lineHeight: 1.42, letterSpacing: "-0.02em" }}>
            {t("libraryChat.introMobileWithNotes")}
          </p>
          {s.libraryChat.map((message, i) =>
            message.role === "assistant" ? (
              <div key={i} className="memo-homechat-answer">
                {mascot(28.8)}
                <div style={{ fontSize: "16.8px" }}>{message.text}</div>
              </div>
            ) : (
              <div key={i} className="memo-homechat-question">
                <div style={{ maxWidth: "82%", borderRadius: "18px 18px 6px 18px", background: "var(--text)", color: "var(--bg)", fontSize: "16.8px" }}>
                  {message.text}
                </div>
              </div>
            ),
          )}
        </div>

        {/* `.memo-m-chat-composer`: the scope it answers from, then the field. */}
        <div style={{ padding: `0 ${GUTTER}px 25.6px` }}>
          <div style={{ display: "grid", gap: "8.8px", padding: "12px", borderRadius: "22px", background: "var(--field)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6.4px", height: "35.2px", padding: "0 9.6px", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}>
              <span style={{ fontWeight: 700, letterSpacing: "-0.025em" }}>{t("libraryChat.chattingWith")}</span>
              <span style={{ color: "var(--muted)" }}>{scope}</span>
              <Msym name="expand_more" size="18.4px" fill={false} weight={500} />
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "9.6px" }}>
              {this.renderChatInput(t("libraryChat.askAboutNotes"), { padding: "0 5.6px", fontSize: "17.28px" })}
              {this.renderSendButton(t("libraryChat.send"))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  renderNoteChatSheet() {
    const s = this.state;
    const t = this.props.t;
    const sheet = this.fullSheetProps("chat", this.closeSheet);
    const note = this.activeNote();
    const suggestions: MessageKey[] = [
      "chat.suggestion.summarize",
      "chat.suggestion.explain",
      "chat.suggestion.questions",
      "chat.suggestion.extend",
    ];

    return (
      <div role="dialog" aria-modal="true" onPointerDown={sheet.onPointerDown} style={sheet.style}>
        {GRAB_WIDE}
        {this.chatHead(<span style={{ fontSize: "17.92px", fontWeight: 750, letterSpacing: "-0.03em" }}>{t("chat.title")}</span>)}

        <div className="memo-chat-log" style={{ padding: `28.8px ${GUTTER}px 16px` }}>
          <div className="memo-chat-intro">
            {mascot(28.8)}
            <p>
              {t("chat.intro")}
              {this.showsTranscript(note) ? t("chat.introTranscript") : ""}
            </p>
          </div>
          {s.noteChat.map((message, i) =>
            message.role === "assistant" ? (
              <div key={i} className="memo-bubble-bot">
                <p style={{ margin: 0 }}>{message.text}</p>
              </div>
            ) : (
              <div key={i} className="memo-bubble-user">
                <p className="memo-bubble-copy" style={{ margin: 0 }}>
                  {message.text}
                </p>
              </div>
            ),
          )}
        </div>

        <div className="memo-chat-foot" style={{ padding: `0 ${GUTTER}px 25.6px` }}>
          {s.noteChat.length === 0 ? (
            <div className="memo-chip-row memo-chiprow" style={{ scrollbarWidth: "none" }}>
              {suggestions.map((key) => (
                <button key={key} type="button" className="memo-chip" onClick={() => this.sendChat(t(key))}>
                  {t(key)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="memo-chat-input">
            {this.renderChatInput(t("chat.placeholder"), { fontSize: "16.8px" })}
            {this.renderSendButton(t("chat.send"))}
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
      return note.title.toLowerCase().includes(search) || sourceMeta(note, this.props.t).toLowerCase().includes(search);
    });

    const rootStyle: CSSProperties = {
      display: "flex",
      justifyContent: "center",
      // Without this the frame stretches to fill the reserved height and the
      // body grows taller than the screen it wraps.
      alignItems: "flex-start",
      width: "100%",
      // The server cannot know the viewport, so the mockup stays hidden until
      // it has been measured — otherwise it would paint at the default scale
      // and visibly shrink once the client measures it. The reserved height
      // (see landing.css) is dropped once the real size is known.
      opacity: s.measured ? 1 : 0,
      minHeight: s.measured ? 0 : undefined,
      transition: "opacity 200ms ease",
    };

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
            {/* The screen: the app's token scope, in the phone's own Appearance. */}
            <LandingAppScope
              theme={this.appTheme()}
              className="landing-hero-app"
              style={{
                position: "relative",
                width: `${Math.round(PHONE_W * k)}px`,
                height: `${Math.round(PHONE_H * k)}px`,
                overflow: "hidden",
                borderRadius: `${radius}px`,
                background: "var(--bg)",
                color: "var(--text)",
                textAlign: "left",
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
                  background: "var(--bg)",
                  color: "var(--text)",
                  // The app's own line box: the body's 1.5, which every row inherits.
                  fontSize: "16px",
                  lineHeight: 1.5,
                  overflow: "hidden",
                }}
              >
                {this.renderStatusBar()}

                {s.screen === "home" ? this.renderHome(visible) : null}
                {s.screen === "note" ? this.renderNote() : null}
                {s.screen === "capture" ? this.renderCapture() : null}
                {s.screen === "settings" ? this.renderSettings() : null}
                {s.screen === "support" ? this.renderSupport() : null}

                {s.sheet ? this.renderScrim() : null}
                {s.sheet === "create" ? this.renderCreateSheet() : null}
                {s.sheet === "folders" ? this.renderFoldersSheet() : null}
                {s.sheet === "newFolder" ? this.renderNewFolderSheet() : null}
                {s.sheet === "actions" ? this.renderActionsSheet() : null}
                {s.sheet === "rename" ? this.renderRenameSheet() : null}
                {s.sheet === "delete" ? this.renderDeleteSheet() : null}
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
                        (s.cursor.seen
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
                    background: "var(--text)",
                    opacity: 0.35,
                    transform: "translateX(-50%)",
                  }}
                />
              </div>
            </LandingAppScope>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * The preview as the page uses it.
 *
 * `MemoAppPreviewView` is a class — it drives a scripted tour through `setState` and
 * needs the instance — so the translator is read here and handed down as a prop rather
 * than pulled from a hook inside it.
 */
export function MemoAppPreview(props: Omit<PreviewProps, "t" | "locale">) {
  const { t, locale } = useTranslations();

  /*
   * Keyed by locale so a language change remounts it. The sample library lives in state
   * and is built once in the constructor, so without this the replica kept the titles of
   * whichever language it was first rendered in while every label around them switched.
   */
  return <MemoAppPreviewView key={locale} {...props} t={t} locale={locale} />;
}
