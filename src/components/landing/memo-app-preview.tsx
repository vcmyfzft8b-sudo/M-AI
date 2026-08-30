"use client";

/* Interactive phone mockup of the Memo AI app shown in the landing hero.
   Ported from the bundled design (self-running guided tour; any user
   interaction stops the tour and hands over control). */

import Image from "next/image";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Component } from "react";

import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, SEO_BRAND_NAME } from "@/lib/brand";

import { PREVIEW_STOP_TOUR_EVENT, PREVIEW_TOUR_STOPPED_EVENT } from "./memo-app-preview-events";

import {
  completionAction,
  completionBadge,
  completionPct,
  completionShell,
  DARK_TOKENS,
  FOLDERS,
  HELP_SECTIONS,
  INITIAL_NOTES,
  lectureSummary,
  LIGHT_TOKENS,
  NOTE_BODIES,
  noteTheme,
  type NoteTab,
  type PreviewFolder,
  type PreviewNote,
  type PreviewTheme,
  QUICK_ACTIONS,
  ringStyle,
  SEGMENT_BASE,
  segmentWords,
  type SegmentWord,
  SHEET_CONTENT,
  type SheetMode,
  SOURCE_META,
  SOURCE_MODES,
  SOURCE_VARIANTS,
  STATUS_LABELS,
  STUDY_MODES,
  type StudyMode,
  TABS,
  THEME_OPTIONS,
  THEME_STUDY,
  type ChatMessage,
} from "./memo-app-preview-data";

type TapState = { x: number; y: number; n: number } | null;
type CursorState = { x: number; y: number; press: boolean; seen: boolean; drag?: boolean } | null;

type PreviewProps = {
  autoTour?: boolean;
};

type PreviewState = {
  scale: number;
  measured: boolean;
  screen: "home" | "note" | "support" | "settings";
  noteId: string | null;
  notes: PreviewNote[];
  query: string;
  sheetMode: SheetMode | null;
  createMenuOpen: boolean;
  dockOpen: boolean;
  busyLabel: string | null;
  createAudio: boolean;
  tab: NoteTab;
  studyMode: StudyMode;
  cardIndex: number;
  flipped: boolean;
  quizIndex: number;
  quizPick: number | null;
  cardAnswers: Array<"easy" | "again" | undefined>;
  cardsDone: boolean;
  quizAnswers: number[];
  quizDone: boolean;
  cardDragX: number;
  cardDragY: number;
  cardDragActive: boolean;
  cardPhase: "idle" | "exit" | "enter";
  cardExitDir: number;
  flipPhase: "out" | "mid" | "in" | null;
  showHint: boolean;
  tap: TapState;
  cursor: CursorState;
  practiceAnswers: Record<string, string>;
  practiceUnknown: string[];
  testGraded: boolean;
  reading: boolean;
  readPaused: boolean;
  readWord: number;
  swipeId: string | null;
  swipeOffset: number;
  folderSheetOpen: boolean;
  folderId: string | null;
  theme: PreviewTheme;
  openHelp: string | null;
  dragKey: string | null;
  dragOffset: number;
  folders: PreviewFolder[];
  renameId: string | null;
  renameValue: string;
  deleteId: string | null;
  folderModal: "new" | "edit" | null;
  folderModalId: string | null;
  folderNameValue: string;
  folderPickIds: string[];
  chatInput: string;
  messages: ChatMessage[];
  sourceVariant: number;
  language: string;
};

/* Eased rather than linear, and fully clear ~26px before the element ends, so
   rows dissolve into the screen instead of meeting the bezel at a hard edge.
   The stops are in the mockup's own (unscaled) pixel space. */
const APP_MAIN_FEATHER = [
  "linear-gradient(to bottom",
  "transparent 0",
  "#000 18px",
  "#000 calc(100% - 172px)",
  "rgba(0, 0, 0, 0.78) calc(100% - 128px)",
  "rgba(0, 0, 0, 0.4) calc(100% - 86px)",
  "rgba(0, 0, 0, 0.12) calc(100% - 52px)",
  "transparent calc(100% - 26px))",
].join(", ");

const SHEET_BACKDROP: CSSProperties = {
  position: "absolute",
  inset: 0,
  border: 0,
  background: "rgba(0,0,0,0.45)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  cursor: "pointer",
};

const SHEET_HANDLE = (
  <span
    data-sheet-handle
    aria-hidden="true"
    style={{
      justifySelf: "center",
      alignSelf: "center",
      display: "flex",
      alignItems: "center",
      width: "24px",
      height: "13px",
      marginBottom: "-5.6px",
      cursor: "grab",
    }}
  >
    <span style={{ width: "100%", height: "2.6px", borderRadius: "999px", background: "rgba(134,134,139,0.36)" }} />
  </span>
);

function sheetCloseButton(onClose: () => void, label: string): ReactNode {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      style={{
        position: "absolute",
        top: "16px",
        right: "16px",
        zIndex: 5,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "44px",
        height: "44px",
        margin: 0,
        border: 0,
        borderRadius: "999px",
        background: "var(--m-muted)",
        color: "var(--m-label)",
        fontSize: "15px",
        lineHeight: 1,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "block", transform: "translateY(-0.5px)" }}>✕</span>
    </button>
  );
}

function sheetTitleRow(title: string, onClose: () => void, closeLabel: string): ReactNode {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) 44px", alignItems: "center", minHeight: "50px" }}>
      <h2
        style={{
          gridColumn: 2,
          margin: 0,
          textAlign: "center",
          fontSize: "19px",
          fontWeight: 650,
          letterSpacing: "-0.03em",
          color: "var(--m-label)",
        }}
      >
        {title}
      </h2>
      {sheetCloseButton(onClose, closeLabel)}
    </div>
  );
}

const MODAL_PRIMARY: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "48px",
  border: 0,
  borderRadius: "12px",
  background: "var(--m-tint)",
  color: "#fff",
  fontSize: "16px",
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

const MODAL_SECONDARY: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "48px",
  border: 0,
  borderRadius: "12px",
  background: "var(--m-muted)",
  color: "var(--m-tint)",
  fontSize: "16px",
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

const MODAL_INPUT: CSSProperties = {
  width: "100%",
  minHeight: "44px",
  padding: "8px 12px",
  border: 0,
  borderRadius: "10px",
  background: "var(--m-muted)",
  color: "var(--m-label)",
  fontSize: "16px",
  fontFamily: "inherit",
  outline: "none",
};

export class MemoAppPreview extends Component<PreviewProps, PreviewState> {
  state: PreviewState = {
    scale: 0.82,
    measured: false,
    screen: "home",
    noteId: null,
    notes: INITIAL_NOTES,
    query: "",
    sheetMode: null,
    createMenuOpen: false,
    dockOpen: false,
    busyLabel: null,
    createAudio: false,
    tab: "notes",
    studyMode: "flashcards",
    cardIndex: 0,
    flipped: false,
    quizIndex: 0,
    quizPick: null,
    cardAnswers: [],
    cardsDone: false,
    quizAnswers: [],
    quizDone: false,
    cardDragX: 0,
    cardDragY: 0,
    cardDragActive: false,
    cardPhase: "idle",
    cardExitDir: 1,
    flipPhase: null,
    showHint: false,
    tap: null,
    cursor: null,
    practiceAnswers: {},
    practiceUnknown: [],
    testGraded: false,
    reading: false,
    readPaused: false,
    readWord: 0,
    swipeId: null,
    swipeOffset: 0,
    folderSheetOpen: false,
    folderId: null,
    theme: "system",
    openHelp: null,
    dragKey: null,
    dragOffset: 0,
    folders: FOLDERS,
    renameId: null,
    renameValue: "",
    deleteId: null,
    folderModal: null,
    folderModalId: null,
    folderNameValue: "",
    folderPickIds: [],
    chatInput: "",
    messages: [],
    sourceVariant: 0,
    language: "sl",
  };

  private mount: HTMLDivElement | null = null;
  private stage: HTMLDivElement | null = null;
  private timers: number[] = [];
  private tourTimers: number[] = [];
  private touring = false;
  private stopTour: (() => void) | null = null;
  private tourLoop: number | undefined;
  private readTimer: number | null = null;
  private cardTourRaf: number | null = null;
  private cardRaf: number | null = null;
  private cardDragging = false;
  private flipping = false;
  private suppressClick = false;
  private resizeObserver: ResizeObserver | null = null;
  private viewObserver: IntersectionObserver | null = null;
  private tourStarted = false;
  private tourDismissed = false;
  private onResize: (() => void) | null = null;
  private onStopRequest: (() => void) | null = null;

  componentDidMount() {
    this.measure();
    // The hero callout sits outside this component, so it asks for the
    // handover by event rather than by reaching into the instance.
    this.onStopRequest = () => this.dismissTour();
    window.addEventListener(PREVIEW_STOP_TOUR_EVENT, this.onStopRequest);
    // Start the guided tour only once the mockup is actually in view —
    // on mobile it sits below the fold, so it should not play unseen.
    if (this.mount && typeof IntersectionObserver !== "undefined") {
      this.viewObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting || this.tourStarted) return;
            this.tourStarted = true;
            this.viewObserver?.disconnect();
            this.viewObserver = null;
            this.startAutoTour();
          });
        },
        { threshold: 0.35 },
      );
      this.viewObserver.observe(this.mount);
    } else {
      this.tourStarted = true;
      this.startAutoTour();
    }
    if (typeof ResizeObserver !== "undefined" && this.mount) {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this.mount);
    }
    this.onResize = () => this.measure();
    window.addEventListener("resize", this.onResize);
  }

  componentWillUnmount() {
    this.timers.forEach((id) => window.clearTimeout(id));
    if (this.readTimer) window.clearInterval(this.readTimer);
    window.clearInterval(this.tourLoop);
    this.tourTimers.forEach((id) => window.clearTimeout(id));
    if (this.cardTourRaf) window.cancelAnimationFrame(this.cardTourRaf);
    if (this.cardRaf) window.cancelAnimationFrame(this.cardRaf);
    this.detachTourListeners();
    this.viewObserver?.disconnect();
    this.resizeObserver?.disconnect();
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    if (this.onStopRequest) window.removeEventListener(PREVIEW_STOP_TOUR_EVENT, this.onStopRequest);
  }

  /* Hand the mockup over to the visitor. Safe to call before the tour has
     started (it sits behind an IntersectionObserver): the tour is then
     cancelled outright rather than stopped after the fact. */
  dismissTour() {
    if (this.tourDismissed) return;
    this.tourDismissed = true;
    this.tourStarted = true;
    this.viewObserver?.disconnect();
    this.viewObserver = null;
    if (this.stopTour) {
      this.stopTour();
    } else {
      window.dispatchEvent(new Event(PREVIEW_TOUR_STOPPED_EVENT));
    }
  }

  measure() {
    let node: HTMLElement | null = this.mount;
    let available = 0;
    // Walk up past any shrink-to-fit box (whose width the phone itself sets)
    // until an ancestor reports a width the content cannot influence.
    while (node && available < 120) {
      available = Math.max(available, node.clientWidth || 0);
      node = node.parentElement;
    }
    if (available < 120) return;
    // Cap the scale by the viewport so the whole mockup stays visible.
    const stacked = window.innerWidth < 800;
    // Narrow screens keep side breathing room.
    const widthCap = stacked ? (window.innerWidth * 0.68) / 415 : 0.82;
    // Fit the phone (plus nav and callout) in the viewport only on the
    // side-by-side hero. On phones innerHeight changes as the browser chrome
    // collapses, which would resize the mockup mid-scroll.
    const heightCap = stacked ? 0.82 : (window.innerHeight - 250) / 883;
    const maxScale = Math.max(0.42, Math.min(0.82, widthCap, heightCap));
    const raw = Math.max(0.42, Math.min(maxScale, (available - 6) / 415));
    // Quantize so sub-pixel container changes cannot nudge the size.
    const next = Math.round(raw * 200) / 200;
    if (!this.state.measured || Math.abs(next - this.state.scale) > 0.001) {
      this.setState({ scale: next, measured: true });
    }
  }

  startAutoTour() {
    if (this.props.autoTour === false || !this.mount || this.tourDismissed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.touring = true;
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
      window.clearInterval(this.tourLoop);
      this.tourLoop = undefined;
      // freeze in place: stop advancing, keep the current screen and highlight
      if (this.readTimer) {
        window.clearInterval(this.readTimer);
        this.readTimer = null;
      }
      this.setState((c) => ({
        showHint: false,
        tap: null,
        cursor: null,
        cardDragActive: false,
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

  runTourScript() {
    const step = (ms: number, fn: () => void) => {
      this.tourTimers.push(
        window.setTimeout(() => {
          if (this.touring) fn();
        }, ms),
      );
    };

    let at = 0;
    const wait = (ms: number) => {
      at += ms;
      return at;
    };
    const doAt = (ms: number, fn: () => void) => step(wait(ms), fn);

    const tourNoteId = "tour-note";

    doAt(1300, () => this.tapThen('[data-tap="create"]', 0, () => this.setState({ createMenuOpen: true })));
    doAt(1900, () => this.tapThen('[data-tap="quick"]', 1, () => this.openSheet("upload")));
    doAt(1500, () => this.tapThen('[data-tap="audio"]', 0, () => this.setState({ createAudio: true })));
    doAt(1700, () => this.tapThen('[data-tap="ustvari"]', 0, () => this.setState({ busyLabel: "Pripravljam..." })));
    doAt(1100, () => this.setState({ busyLabel: "Nalagam datoteko..." }));
    doAt(1600, () =>
      this.setState((s) => ({
        busyLabel: null,
        sheetMode: null,
        notes: [
          { id: tourNoteId, title: "Predavanje IS – 4. teden", source: "audio", date: "danes", status: "queued" },
          ...s.notes,
        ],
      })),
    );
    doAt(2000, () => this.updateStatus(tourNoteId, "transcribing"));
    doAt(2800, () => this.updateStatus(tourNoteId, "generating_notes"));
    doAt(3000, () => this.updateStatus(tourNoteId, "ready"));
    doAt(1600, () =>
      this.tapThen('[data-tap="note"]', 0, () =>
        this.setState({ screen: "note", noteId: tourNoteId, tab: "notes", readWord: 0, readPaused: false }),
      ),
    );
    doAt(1500, () => {
      this.toggleRead();
      this.setState({ showHint: true });
    });

    doAt(11000, () => {
      if (this.state.reading) this.toggleRead();
      this.tapThen('[data-tap="tab"]', 1, () =>
        this.setState({ showHint: false, tab: "study", studyMode: "flashcards", cardIndex: 0, flipped: false, cardAnswers: [], cardsDone: false }),
      );
    });

    const cardCount = 3;
    for (let c = 0; c < cardCount; c += 1) {
      const easy = c !== 1;
      doAt(1800, () => this.tapThen('[data-tap="card"]', 0, () => this.flipCard()));
      doAt(2000, () => this.animateCardDrag(easy ? 1 : -1, 460));
      doAt(1300, () => {});
    }

    doAt(2600, () =>
      this.tapThen('[data-tap="mode"]', 1, () =>
        this.setState({ tab: "study", studyMode: "quiz", quizIndex: 0, quizPick: null, quizAnswers: [], quizDone: false }),
      ),
    );
    const quizCount = 2;
    for (let q = 0; q < quizCount; q += 1) {
      doAt(600, () => {
        const main = this.appMain();
        if (main) main.scrollTo({ top: 0, behavior: "smooth" });
      });
      doAt(2000, () => {
        const list = this.studyData().quiz;
        const idx = this.state.quizIndex % list.length;
        this.tapThen('[data-tap="quiz-opt"]', list[idx].correct, () =>
          this.setState((c) => {
            const picks = (c.quizAnswers || []).slice();
            picks[idx] = list[idx].correct;
            return { quizPick: list[idx].correct, quizAnswers: picks };
          }),
        );
      });
      doAt(1200, () => this.scrollIntoTour('[data-tap="quiz-next"]', 0));
      doAt(2200, () => {
        this.tapThen('[data-tap="quiz-next"]', 0, () =>
          this.setState((c) =>
            q < quizCount - 1
              ? { quizIndex: c.quizIndex + 1, quizPick: null, quizDone: c.quizDone }
              : { quizIndex: c.quizIndex, quizPick: c.quizPick, quizDone: true },
          ),
        );
      });
    }

    doAt(3000, () =>
      this.tapThen('[data-tap="mode"]', 2, () =>
        this.setState({ studyMode: "practice_test", testGraded: false, practiceAnswers: {}, practiceUnknown: [] }),
      ),
    );
    const answers = [
      "Funkcijski IS pokrivajo en oddelek, integrirani pa povežejo vse oddelke v skupno bazo.",
      "Brez prenove procesov ERP le pospeši obstoječe napake, zato je prenova pogoj za uspeh.",
    ];
    answers.forEach((text, index) => {
      doAt(600, () => this.scrollIntoTour('[data-tap="answer"]', index));
      doAt(900, () => this.tapAt('[data-tap="answer"]', index));
      doAt(700, () => {});
      for (let i = 1; i <= text.length; i += 2) {
        const chunk = text.slice(0, i);
        const pause = /[ ,.]/.test(text[i - 1] || "") ? 120 : 46;
        doAt(pause, () => {
          const id = this.studyData().practice[index].id;
          this.setState((c) => ({ practiceAnswers: { ...c.practiceAnswers, [id]: chunk } }));
        });
      }
      doAt(900, () => {});
    });
    doAt(900, () => this.scrollIntoTour('[data-tap="submit"]', 0));
    doAt(1200, () => this.tapThen('[data-tap="submit"]', 0, () => this.setState({ testGraded: true })));
    doAt(900, () => this.scrollTourBottom());

    doAt(5200, () =>
      this.tapThen('[data-tap="tab"]', 0, () => {
        this.setState({ tab: "notes", readWord: 0, readPaused: false });
        const main = this.appMain();
        if (main) main.scrollTop = 0;
      }),
    );
    doAt(400, () => {
      const m = this.appMain();
      if (m) m.scrollTo({ top: 0, behavior: "smooth" });
    });
    doAt(1100, () => {
      this.toggleRead();
      this.setState({ showHint: true });
    });
    doAt(12000, () => {
      if (this.state.reading) this.toggleRead();
      this.setState({ showHint: false, tab: "notes", readWord: 0, readPaused: false });
    });
    doAt(1200, () => this.tapThen('[data-tap="dock"]', 0, () => this.setState({ dockOpen: true })));
    doAt(1200, () => this.tapThen('[data-tap="dock-item"]', 0, () => this.setState({ screen: "home", dockOpen: false })));
    doAt(2200, () => {
      this.setState({
        screen: "home",
        noteId: null,
        notes: INITIAL_NOTES,
        tab: "notes",
        studyMode: "flashcards",
        cardIndex: 0,
        flipped: false,
        cardAnswers: [],
        cardsDone: false,
        quizAnswers: [],
        quizDone: false,
        quizIndex: 0,
        quizPick: null,
        testGraded: false,
        practiceAnswers: {},
        practiceUnknown: [],
        readWord: 0,
        tap: null,
        busyLabel: null,
        sheetMode: null,
        createMenuOpen: false,
        dockOpen: false,
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

  detachTourListeners() {
    if (!this.stopTour || !this.mount) return;
    (["pointerdown", "wheel", "keydown", "touchstart"] as const).forEach((type) =>
      this.mount?.removeEventListener(type, this.stopTour as EventListener),
    );
  }

  appMain(): HTMLElement | null {
    return this.stage ? this.stage.querySelector("[data-app-main]") : null;
  }

  later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  startSwipe(event: ReactPointerEvent, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startOffset = this.state.swipeId === id ? this.state.swipeOffset : 0;
    let dragging = false;
    this.suppressClick = false;

    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy))) return;
      dragging = true;
      this.suppressClick = true;
      const offset = Math.min(0, Math.max(-144, startOffset + dx));
      this.setState({ swipeId: id, swipeOffset: offset });
    };

    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!dragging) {
        if (this.state.swipeId === id && this.state.swipeOffset < 0) {
          this.suppressClick = true;
          this.setState({ swipeId: null, swipeOffset: 0 });
        }
        return;
      }
      const open = this.state.swipeOffset < -72;
      this.setState({ swipeId: open ? id : null, swipeOffset: open ? -144 : 0 });
      this.later(() => {
        this.suppressClick = false;
      }, 60);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  sheetDragStart(event: ReactPointerEvent, key: string, close: () => void) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    const handle = target instanceof Element ? target.closest("[data-sheet-handle]") : null;
    const interactive = target instanceof Element ? target.closest("button, a, input, textarea, select, label") : null;
    if (interactive && !handle) return;

    const startY = event.clientY;
    let offset = 0;

    const move = (e: PointerEvent) => {
      offset = Math.max(0, e.clientY - startY);
      this.setState({ dragKey: key, dragOffset: offset });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (offset > 80) {
        this.setState({ dragKey: key, dragOffset: 900 });
        this.later(() => {
          this.setState({ dragKey: null, dragOffset: 0 });
          close();
        }, 180);
        return;
      }
      this.setState({ dragKey: null, dragOffset: 0 });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  sheet(key: string, close: () => void, extra?: CSSProperties) {
    const dragging = this.state.dragKey === key;
    const offset = dragging ? this.state.dragOffset : 0;
    return {
      onPointerDown: (event: ReactPointerEvent) => this.sheetDragStart(event, key, close),
      style: {
        position: "absolute",
        insetInline: 0,
        top: "75.2px",
        bottom: 0,
        display: "grid",
        gap: "16px",
        boxSizing: "border-box",
        padding: "11.2px 16px 20px",
        border: "1px solid var(--m-sep)",
        borderBottom: 0,
        borderRadius: "34px 34px 0 0",
        background: "var(--m-sheet)",
        boxShadow: "0 -18px 54px rgba(0,0,0,0.2)",
        animation: "memo-sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        overflow: "hidden",
        touchAction: "none",
        transform: offset ? `translateY(${offset}px)` : undefined,
        transition: dragging && offset < 900 ? "none" : "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        ...extra,
      } as CSSProperties,
    };
  }

  saveRename() {
    const title = this.state.renameValue.trim();
    if (!title) return;
    this.setState((c) => ({
      notes: c.notes.map((note) => (note.id === c.renameId ? { ...note, title } : note)),
      renameId: null,
      renameValue: "",
    }));
  }

  wordStyle(word: SegmentWord | { hl?: SegmentWord["hl"] }, spoken: boolean, reading: boolean, current: boolean): CSSProperties {
    let bg: string | null = null;
    if (word.hl === "orange") bg = "var(--m-hl-orange)";
    else if (word.hl === "deep") bg = "var(--m-hl-deep)";
    else if (word.hl === "blue") bg = "var(--m-hl-blue)";
    const isCurrent = reading && current;
    const isRead = reading && spoken && !current;
    const style: CSSProperties = {
      display: "inline",
      padding: bg ? "1.6px 5.1px" : "0.5px 1.6px",
      borderRadius: bg ? "6.7px" : "4.5px",
      background: isCurrent ? "var(--m-read-now)" : isRead ? "rgba(251,146,60,0.22)" : bg || "transparent",
      // Reading highlight keeps the normal text colour: black on light, white on dark.
      color: "var(--m-label)",
      boxShadow: isCurrent ? "0 0 0 1.8px rgba(251,146,60,0.36)" : "none",
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
      transition: "background-color 0.12s ease, box-shadow 0.12s ease, color 0.12s ease",
    };
    if (word.hl === "underline") {
      style.textDecoration = "underline";
      style.textDecorationColor = "#ff6b9a";
      style.textDecorationThickness = "2px";
      style.textUnderlineOffset = "3px";
    }
    return style;
  }

  activeNote(): PreviewNote | undefined {
    return this.state.notes.find((n) => n.id === this.state.noteId) ?? this.state.notes[0];
  }

  studyData() {
    return THEME_STUDY[noteTheme(this.activeNote()?.title)];
  }

  noteBody() {
    return NOTE_BODIES[noteTheme(this.activeNote()?.title)];
  }

  toggleRead() {
    if (this.state.reading) {
      // pause: keep the highlight exactly where it stopped
      if (this.readTimer) window.clearInterval(this.readTimer);
      this.readTimer = null;
      this.setState({ reading: false, readPaused: true });
      return;
    }

    const total = segmentWords(this.noteBody().overview).length;
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
        return { readWord: next } as Partial<PreviewState> as Pick<PreviewState, "readWord">;
      });
    }, 460);
  }

  cardNavStyle(enabled: boolean): CSSProperties {
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "46px",
      height: "46px",
      border: "1px solid var(--m-sep)",
      borderRadius: "999px",
      background: "var(--m-muted)",
      color: "var(--m-label)",
      fontSize: "16px",
      fontFamily: "inherit",
      opacity: enabled ? 1 : 0.4,
      cursor: enabled ? "pointer" : "default",
    };
  }

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

  scrollTourBottom() {
    if (!this.touring || !this.stage) return;
    const main = this.appMain();
    if (main) main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
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

  animateCardDrag(dir: number, duration: number) {
    if (this.cardTourRaf) window.cancelAnimationFrame(this.cardTourRaf);
    const startedAt = performance.now();
    const reach = 235;
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
      // ease-in-out with a small hesitation, like a real thumb
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const wobble = Math.sin(t * Math.PI * 2) * 5 * (1 - t);
      const dx = dir * (e * reach + wobble);
      const dy = e * 16;
      this.setState((c) => ({
        cardDragActive: true,
        cardDragX: dx,
        cardDragY: dy,
        cursor: base ? { x: base.x + dx, y: base.y + dy * 0.18, press: true, seen: true, drag: true } : c.cursor,
      }));
      if (t < 1) {
        this.cardTourRaf = window.requestAnimationFrame(tick);
        return;
      }
      this.cardTourRaf = null;
      this.commitSwipe(dir);
    };
    this.cardTourRaf = window.requestAnimationFrame(tick);
  }

  commitSwipe(dir: number) {
    this.cardDragging = true;
    this.setState({ cardPhase: "exit", cardExitDir: dir, cardDragActive: false, flipPhase: null });
    this.later(() => {
      this.gradeCard(dir > 0 ? "easy" : "again");
      // land the next card with no transition, then let it ease in
      this.setState({ cardPhase: "enter", cardDragX: 0, cardDragY: 0 });
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => this.setState({ cardPhase: "idle" })));
      this.later(() => {
        this.cardDragging = false;
      }, 60);
    }, 210);
  }

  flipCard() {
    if (this.cardDragging || this.flipping) return;
    this.flipping = true;
    this.setState({ flipPhase: "out" });
    this.later(() => {
      this.setState((c) => ({ flipped: !c.flipped, flipPhase: "mid" }));
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => this.setState({ flipPhase: "in" })));
      this.later(() => {
        this.setState({ flipPhase: null });
        this.flipping = false;
      }, 200);
    }, 150);
  }

  startCardDrag(event: ReactPointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dx = 0;
    let dy = 0;
    let dragging = false;

    const move = (e: PointerEvent) => {
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      if (!dragging && Math.abs(dx) < 8) return;
      dragging = true;
      this.cardDragging = true;
      if (this.cardRaf) return;
      this.cardRaf = window.requestAnimationFrame(() => {
        this.cardRaf = null;
        this.setState({ cardDragX: dx, cardDragY: dy, cardDragActive: true });
      });
    };

    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (this.cardRaf) {
        window.cancelAnimationFrame(this.cardRaf);
        this.cardRaf = null;
      }
      if (!dragging) return;
      if (Math.abs(dx) > 70) {
        this.commitSwipe(dx < 0 ? -1 : 1);
        return;
      }
      this.setState({ cardDragX: 0, cardDragY: 0, cardDragActive: false });
      this.later(() => {
        this.cardDragging = false;
      }, 60);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  gradeCard(answer: "easy" | "again") {
    this.setState((c) => {
      const answers = (c.cardAnswers || []).slice();
      const cards = this.studyData().cards;
      answers[c.cardIndex % cards.length] = answer;
      const complete = cards.every((_, i) => Boolean(answers[i]));
      return {
        cardAnswers: answers,
        cardsDone: complete,
        cardIndex: complete ? c.cardIndex : (c.cardIndex + 1) % cards.length,
        flipped: false,
      };
    });
  }

  segment(active: boolean): CSSProperties {
    return active
      ? { ...SEGMENT_BASE, background: "var(--m-surface)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
      : { ...SEGMENT_BASE, background: "transparent" };
  }

  openSheet(mode: SheetMode) {
    this.setState({ sheetMode: mode, createMenuOpen: false, busyLabel: null, sourceVariant: 0 });
  }

  create() {
    const mode = this.state.sheetMode;
    if (!mode) return;
    const base = SHEET_CONTENT[mode];
    const variants = SOURCE_VARIANTS[mode];
    const config = { ...base, ...variants[(this.state.sourceVariant || 0) % variants.length] };

    this.setState({ busyLabel: "Pripravljam..." });
    this.later(() => this.setState({ busyLabel: mode === "link" ? "Dodajam v vrsto..." : "Nalagam datoteko..." }), 700);
    this.later(() => {
      const id = `n${Date.now()}`;
      this.setState((s) => ({
        busyLabel: null,
        sheetMode: null,
        notes: [{ id, title: config.noteTitle, source: config.source, date: "danes", status: "queued" }, ...s.notes],
      }));
      this.later(() => this.updateStatus(id, "transcribing"), 1400);
      this.later(() => this.updateStatus(id, "generating_notes"), 3200);
      this.later(() => this.updateStatus(id, "ready"), 5200);
    }, 1900);
  }

  updateStatus(id: string, status: PreviewNote["status"]) {
    this.setState((s) => ({
      notes: s.notes.map((note) => (note.id === id ? { ...note, status } : note)),
    }));
  }

  sendChat() {
    const text = this.state.chatInput.trim();
    if (!text) return;
    this.setState((s) => ({
      chatInput: "",
      messages: [...(s.messages.length ? s.messages : this.studyData().chat), { role: "user", text }],
    }));
    this.later(() => {
      this.setState((s) => ({
        messages: [...s.messages, { role: "assistant", text: this.studyData().chatReply }],
      }));
    }, 900);
  }

  /* ── Screens ──────────────────────────────────────────────── */

  renderHome(filtered: PreviewNote[]) {
    const s = this.state;
    const activeFolder = s.folders.find((folder) => folder.id === s.folderId) ?? null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", paddingTop: "14.4px" }}>
        <section style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
          <h2 style={{ margin: "0 0 1.6px", fontSize: "15px", fontWeight: 650, letterSpacing: "-0.03em", color: "var(--m-label)" }}>
            Moji zapiski
          </h2>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "20px", width: "100%" }}>
            <button
              type="button"
              onClick={() => this.setState({ folderSheetOpen: true, swipeId: null, swipeOffset: 0, dockOpen: false })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                flexShrink: 0,
                maxWidth: "216px",
                minHeight: "32px",
                padding: "3px 11px 3px 10px",
                border: "1px solid var(--m-sep)",
                borderRadius: "999px",
                background: "var(--m-surface)",
                color: "var(--m-label)",
                boxShadow: "var(--m-shadow)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: "13px" }}>📁</span>
              <span
                style={{
                  maxWidth: "131px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "15.4px",
                  fontWeight: 650,
                  letterSpacing: "-0.03em",
                }}
              >
                {activeFolder ? activeFolder.name : "Vsi zapiski"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--m-second)" }}>▾</span>
            </button>
            <div
              style={{
                order: -1,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                minWidth: 0,
                minHeight: "37px",
                padding: "6px 12px",
                borderRadius: "10px",
                background: "var(--m-muted)",
              }}
            >
              <span style={{ fontSize: "15px" }}>🔎</span>
              <input
                value={s.query}
                onChange={(e) => this.setState({ query: e.target.value })}
                placeholder="Išči po naslovu"
                style={{
                  width: "100%",
                  minWidth: 0,
                  border: 0,
                  background: "transparent",
                  color: "var(--m-label)",
                  outline: "none",
                  fontSize: "16px",
                  fontFamily: "inherit",
                }}
              />
            </div>
          </div>

          {filtered.length > 0 ? (
            <div style={{ display: "grid", gap: "9.8px", minWidth: 0 }}>
              {filtered.map((note) => {
                const offset = s.swipeId === note.id ? s.swipeOffset : 0;
                const actionButtonStyle: CSSProperties = {
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "5.6px",
                  padding: 0,
                  border: 0,
                  background: "transparent",
                  fontFamily: "inherit",
                  pointerEvents: offset < 0 ? "auto" : "none",
                  cursor: "pointer",
                };
                return (
                  <div key={note.id} style={{ position: "relative", width: "100%", minWidth: 0, borderRadius: "18px", overflow: "visible" }}>
                    <div
                      style={{
                        position: "absolute",
                        inset: "0 0 0 auto",
                        zIndex: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "5.6px",
                        width: "130.4px",
                        padding: "0 5.6px 0 0",
                        pointerEvents: "none",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => this.setState({ swipeId: null, swipeOffset: 0, renameId: note.id, renameValue: note.title })}
                        aria-label="Uredi"
                        style={actionButtonStyle}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "46.4px",
                            height: "46.4px",
                            borderRadius: "999px",
                            border: "1px solid var(--m-sep)",
                            background: "var(--m-surface)",
                            color: "var(--m-label)",
                            fontSize: "17.6px",
                            boxShadow: "0 7.2px 16px rgba(0,0,0,0.24)",
                          }}
                        >
                          ✏️
                        </span>
                        <span style={{ color: "var(--m-second)", fontSize: "10.9px", fontWeight: 650, lineHeight: 1, textAlign: "center", whiteSpace: "nowrap" }}>
                          Uredi
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => this.setState({ swipeId: null, swipeOffset: 0, deleteId: note.id })}
                        aria-label="Izbriši"
                        style={actionButtonStyle}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "46.4px",
                            height: "46.4px",
                            borderRadius: "999px",
                            border: "1px solid var(--m-red)",
                            background: "var(--m-red)",
                            color: "#fff",
                            fontSize: "17.6px",
                            boxShadow: "0 8.8px 19.2px rgba(255,69,58,0.28)",
                          }}
                        >
                          🗑️
                        </span>
                        <span style={{ color: "var(--m-red)", fontSize: "10.9px", fontWeight: 650, lineHeight: 1, textAlign: "center", whiteSpace: "nowrap" }}>
                          Izbriši
                        </span>
                      </button>
                    </div>
                    <div
                      role="link"
                      tabIndex={0}
                      data-tap="note"
                      onPointerDown={(event) => this.startSwipe(event, note.id)}
                      onClick={() => {
                        if (this.suppressClick) {
                          this.suppressClick = false;
                          return;
                        }
                        if (note.status !== "ready") return;
                        this.setState({ screen: "note", noteId: note.id, tab: "notes", swipeId: null, swipeOffset: 0, dockOpen: false });
                      }}
                      style={{
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: "11.2px",
                        width: "100%",
                        minHeight: "97.3px",
                        padding: "18.1px 16px",
                        border: "1px solid var(--m-sep)",
                        borderRadius: "18px",
                        background: "var(--m-surface)",
                        boxShadow: "var(--m-shadow)",
                        transform: `translateX(${offset}px)`,
                        transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
                        touchAction: "pan-y",
                        userSelect: "none",
                        cursor: "pointer",
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
                          background: "var(--m-muted)",
                          fontSize: "15px",
                        }}
                      >
                        {SOURCE_META[note.source].icon}
                      </span>
                      <span style={{ display: "grid", gap: "4px", minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            fontSize: "14.7px",
                            fontWeight: 500,
                            color: "var(--m-label)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {note.title}
                        </span>
                        <span style={{ fontSize: "12.5px", lineHeight: 1.3, color: "var(--m-second)" }}>
                          {SOURCE_META[note.source].label} • {note.date}
                        </span>
                      </span>
                      {note.status !== "ready" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            flexShrink: 0,
                            minHeight: "24px",
                            padding: "0 9px",
                            borderRadius: "4px",
                            background: "var(--m-muted)",
                            color: "var(--m-second)",
                            fontSize: "11px",
                            fontWeight: 500,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                          }}
                        >
                          {STATUS_LABELS[note.status]}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                justifyItems: "center",
                gap: "6px",
                padding: "34px 18px",
                border: "1px solid var(--m-sep)",
                borderRadius: "18px",
                background: "var(--m-surface)",
                textAlign: "center",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: "44px",
                  height: "44px",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  background: "var(--m-muted)",
                  fontSize: "20px",
                }}
              >
                📝
              </span>
              <p style={{ margin: "6px 0 0", fontSize: "16px", color: "var(--m-label)" }}>Ni ujemajočih zapiskov</p>
              <p style={{ margin: 0, fontSize: "13.6px", color: "var(--m-second)" }}>
                Poskusi krajši iskalni izraz ali počisti iskanje.
              </p>
            </div>
          )}
        </section>
      </div>
    );
  }

  renderNotesTab() {
    const s = this.state;
    const themeKey = noteTheme(this.activeNote()?.title);
    const body = this.noteBody();
    const readShown = Boolean(s.reading || s.readPaused);
    const words = segmentWords(body.overview);

    const highlightHeading = (text: string): ReactNode => (
      <span
        style={{
          display: "inline",
          padding: "1.6px 5.1px",
          borderRadius: "6.7px",
          background: "color-mix(in srgb, #2563eb 24%, transparent)",
          color: "var(--m-label)",
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {text}
      </span>
    );

    const figure = (src: string, href: string, caption: string): ReactNode => (
      <figure
        style={{
          position: "relative",
          width: "100%",
          margin: "16px auto",
          border: "1px solid var(--m-sep)",
          borderRadius: "8px",
          overflow: "hidden",
          background: "var(--m-muted)",
        }}
      >
        <span style={{ position: "relative", display: "block", width: "100%", height: "208px", background: "#ffffff" }}>
          <Image
            src={src}
            alt=""
            fill
            loading="lazy"
            sizes="400px"
            style={{ objectFit: "contain", pointerEvents: "none" }}
          />
        </span>
        <figcaption
          style={{
            position: "absolute",
            left: "10.4px",
            bottom: "10.4px",
            display: "flex",
            alignItems: "center",
            gap: "12.8px",
            padding: "2.4px 6.4px",
            borderRadius: "6px",
            background: "rgba(255,255,255,0.88)",
            fontSize: "13.4px",
            color: "#4b5563",
            pointerEvents: "none",
          }}
        >
          <a href={href} target="_blank" rel="noreferrer" style={{ color: "inherit", pointerEvents: "auto" }}>
            {caption}
          </a>
        </figcaption>
      </figure>
    );

    return (
      <div style={{ position: "relative", padding: "17.6px", border: "1px solid var(--m-sep)", borderRadius: "18px", background: "var(--m-surface)", minWidth: 0 }}>
        <h2 style={{ margin: "0 0 11.2px", fontSize: "21.1px", fontWeight: 700, lineHeight: 1.35, color: "var(--m-label)" }}>
          {highlightHeading("Hiter pregled")}
        </h2>
        <p style={{ margin: 0, fontSize: "16.96px", lineHeight: 1.82, color: "var(--m-label)" }}>
          {words.map((w, i) => (
            <span key={i}>
              {w.space}
              <span style={this.wordStyle(w, readShown && i <= s.readWord, readShown, readShown && i === s.readWord)}>{w.text}</span>
            </span>
          ))}
        </p>
        {/* Mirrors the production key_takeaway callout (globals.css). */}
        <div
          style={{
            margin: "16px 0 0",
            padding: "13.6px 15.2px 13.6px 17px",
            border: "1px solid color-mix(in srgb, #f59e0b 22%, var(--m-sep))",
            borderLeft: "4px solid #f59e0b",
            borderRadius: "14px",
            background: "var(--m-callout)",
            fontSize: "16.96px",
            lineHeight: 1.82,
            color: "var(--m-label)",
          }}
        >
          {body.callout}
        </div>

        {themeKey === "is"
          ? figure(
              "/notes/is-pyramid.png",
              "https://commons.wikimedia.org/wiki/File:Four-Level-Pyramid-model.png",
              "Ravni informacijskih sistemov · Wikimedia Commons, CC BY-SA 3.0",
            )
          : null}
        {themeKey === "micro"
          ? figure(
              "/notes/micro-elasticity.png",
              "https://commons.wikimedia.org/wiki/File:Price_elasticity_of_demand.svg",
              "Krivulji ponudbe in povpraševanja · Wikimedia Commons, CC BY-SA 3.0",
            )
          : null}
        {themeKey === "anatomy"
          ? figure(
              "/notes/anatomy-neuron.png",
              "https://commons.wikimedia.org/wiki/File:Complete_neuron_cell_diagram_en.svg",
              "Zgradba nevrona · Wikimedia Commons, javna last",
            )
          : null}
        {themeKey === "stats"
          ? figure(
              "/notes/stats-p-value.png",
              "https://commons.wikimedia.org/wiki/File:P-value_in_statistical_significance_testing.svg",
              "P-vrednost pri testiranju značilnosti · Wikimedia Commons, CC BY-SA 4.0",
            )
          : null}

        <h3 style={{ margin: "30.4px 0 11.2px", fontSize: "18.24px", fontWeight: 700, lineHeight: 1.35, color: "var(--m-label)" }}>
          {highlightHeading("Ključne točke")}
        </h3>
        <ul style={{ display: "grid", gap: "8.8px", margin: "11.2px 0 16.8px", paddingLeft: 0, listStyle: "none" }}>
          {body.points.map((parts, pi) => (
            <li key={pi} style={{ position: "relative", paddingLeft: "16.8px", fontSize: "16.96px", lineHeight: 1.82, color: "var(--m-label)" }}>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "0.14em",
                  left: 0,
                  color: "color-mix(in srgb, var(--m-label) 72%, transparent)",
                  fontSize: "0.72em",
                  fontWeight: 850,
                  lineHeight: "inherit",
                }}
              >
                •
              </span>
              {parts.map((part, i) => (
                <span key={i}>
                  {i === 0 ? "" : " "}
                  <span style={this.wordStyle(part, false, false, false)}>{part.text}</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
        <h3 style={{ margin: "30.4px 0 11.2px", fontSize: "18.24px", fontWeight: 700, lineHeight: 1.35, color: "var(--m-label)" }}>
          {highlightHeading("Zakaj je to pomembno")}
        </h3>
        <p style={{ margin: 0, fontSize: "16.96px", lineHeight: 1.82, color: "var(--m-label)" }}>{body.why}</p>
        {themeKey === "is"
          ? figure(
              "/notes/is-erp-modules.png",
              "https://commons.wikimedia.org/wiki/File:ERP_modules.svg",
              "Moduli ERP · Wikimedia Commons, CC BY-SA 3.0",
            )
          : null}
        {themeKey === "micro"
          ? figure(
              "/notes/micro-inelastic-demand.png",
              "https://commons.wikimedia.org/wiki/File:InelasticDemand.svg",
              "Neelastično povpraševanje · Wikimedia Commons, CC BY-SA 4.0",
            )
          : null}
        {themeKey === "stats"
          ? figure(
              "/notes/stats-normal-distribution.png",
              "https://commons.wikimedia.org/wiki/File:Normal_Distribution_Sigma.svg",
              "Normalna porazdelitev in standardni odkloni · Wikimedia Commons, CC BY-SA 3.0",
            )
          : null}
        <div style={{ height: "54.4px" }} />
      </div>
    );
  }

  renderStudyTab() {
    const s = this.state;
    const study = this.studyData();
    const CARDS = study.cards;
    const QUIZ = study.quiz;
    const PRACTICE = study.practice;
    const card = CARDS[s.cardIndex % CARDS.length];
    const quiz = QUIZ[s.quizIndex % QUIZ.length];

    const cardPhase = s.cardPhase || "idle";
    const flipPhase = s.flipPhase || null;
    const cardX = cardPhase === "exit" ? (s.cardExitDir > 0 ? 620 : -620) : s.cardDragX || 0;
    const cardY = cardPhase === "enter" ? 12 : (s.cardDragY || 0) * 0.18;
    const flipDeg = flipPhase === "out" ? 84 : flipPhase === "mid" ? -84 : 0;
    const cardTransform =
      `translate3d(${cardX.toFixed(1)}px, ${cardY.toFixed(1)}px, 0)` +
      ` rotate(${(cardX / 24).toFixed(2)}deg)` +
      ` rotateY(${flipDeg}deg)` +
      ` scale(${cardPhase === "enter" ? 0.96 : 1})`;
    const cardTransition =
      s.cardDragActive || cardPhase === "enter" || flipPhase === "mid"
        ? "none"
        : cardPhase === "exit"
          ? "transform 210ms cubic-bezier(0.32, 0.72, 0.4, 1), opacity 190ms ease-out"
          : flipPhase === "out"
            ? "transform 150ms ease-in"
            : flipPhase === "in"
              ? "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)"
              : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease-out";

    const knownCount = s.cardAnswers.filter((a) => a === "easy").length;
    const missedCount = s.cardAnswers.filter((a) => a === "again").length;
    const cardsSummaryVisible = s.studyMode === "flashcards" && s.cardsDone;
    const cardsDeckVisible = s.studyMode === "flashcards" && !s.cardsDone;
    const quizCorrect = s.quizAnswers.filter((pick, i) => pick === QUIZ[i]?.correct).length;
    const quizSummaryVisible = s.studyMode === "quiz" && s.quizDone;
    const quizBoardVisible = s.studyMode === "quiz" && !s.quizDone;
    const quizAnswered = s.quizPick !== null;

    const ringInner = (
      <div
        style={{
          position: "absolute",
          inset: "7px",
          borderRadius: "50%",
          background: "linear-gradient(180deg, var(--m-surface), var(--m-muted))",
          boxShadow: "inset 0 0 0 1px var(--m-sep), 0 10px 24px rgba(0,0,0,0.08)",
        }}
      />
    );

    const summary = (opts: {
      badge: string;
      title: string;
      pct: number;
      pctLabel: string;
      metricLabel: string;
      metric: string;
      action: string;
      tap: string;
      onRestart: () => void;
    }) => (
      <div style={completionShell()}>
        <div style={{ display: "grid", gap: "8.8px", justifyItems: "center", textAlign: "center" }}>
          <span style={completionBadge()}>{opts.badge}</span>
          <div style={{ display: "grid", gap: "8.8px", justifyItems: "center", textAlign: "center" }}>
            <h3 style={{ margin: 0, fontSize: "16.5px", fontWeight: 720, letterSpacing: "-0.04em", color: "var(--m-label)", overflowWrap: "anywhere" }}>
              {opts.title}
            </h3>
          </div>
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: "10px" }}>
          <div style={ringStyle(opts.pct)}>
            {ringInner}
            <div style={{ position: "relative", zIndex: 1, display: "grid", gap: "1.9px", justifyItems: "center", textAlign: "center" }}>
              <strong style={{ fontSize: "23px", lineHeight: 1, letterSpacing: "-0.05em", color: "var(--m-label)" }}>{opts.pct}%</strong>
              <span
                style={{
                  maxWidth: "10ch",
                  fontSize: "9.6px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  lineHeight: 1.2,
                  textTransform: "uppercase",
                  color: "var(--m-second)",
                }}
              >
                {opts.pctLabel}
              </span>
            </div>
          </div>
          <div style={{ display: "grid", gap: "7px", justifyItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--m-second)" }}>
              {opts.metricLabel}
            </span>
            <strong style={{ fontSize: "25px", lineHeight: 1, letterSpacing: "-0.06em", color: "var(--m-label)", whiteSpace: "nowrap" }}>
              {opts.metric}
            </strong>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "5.8px", width: "100%" }}>
          <button type="button" data-tap={opts.tap} onClick={opts.onRestart} style={completionAction()}>
            <span style={{ fontSize: "12.8px" }}>🔄</span>
            {opts.action}
          </button>
        </div>
      </div>
    );

    return (
      <div style={{ display: "grid", gap: "14px", padding: "17.6px", border: "1px solid var(--m-sep)", borderRadius: "18px", background: "var(--m-surface)", minWidth: 0 }}>
        <div style={{ display: "inline-flex", width: "100%", padding: "2px", borderRadius: "8px", background: "var(--m-muted)" }}>
          {STUDY_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-tap="mode"
              onClick={() => this.setState({ studyMode: mode.id })}
              style={this.segment(s.studyMode === mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {cardsSummaryVisible
          ? summary({
              badge: missedCount === 0 ? "Zaključeno" : "Krog 1 zaključen",
              title: missedCount === 0 ? "Vse kartice so predelane" : "Ponovi kartice, ki si jih zgrešil",
              pct: completionPct(knownCount, CARDS.length),
              pctLabel: missedCount === 0 ? "Komplet opravljen" : "Rezultat kroga",
              metricLabel: "Pravilno v tem krogu",
              metric: `${knownCount} / ${CARDS.length}`,
              action:
                missedCount === 0
                  ? "Začni komplet znova"
                  : `Ponovi ${missedCount}${missedCount === 1 ? " zgrešeno kartico" : " zgrešene kartice"}`,
              tap: "restart-cards",
              onRestart: () => this.setState({ cardsDone: false, cardIndex: 0, flipped: false, cardAnswers: [] }),
            })
          : null}

        {cardsDeckVisible ? (
          <div style={{ display: "grid", gap: "14px", perspective: "1000px" }}>
            <button
              type="button"
              data-tap="card"
              onClick={() => this.flipCard()}
              onPointerDown={(event) => this.startCardDrag(event)}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                width: "100%",
                minHeight: "232px",
                padding: "18px",
                border: "1px solid var(--m-sep)",
                borderRadius: "20px",
                background: "var(--m-card-grad)",
                boxShadow: "var(--m-shadow)",
                fontFamily: "inherit",
                overflow: "hidden",
                touchAction: "pan-y",
                userSelect: "none",
                transform: cardTransform,
                opacity: cardPhase === "exit" || cardPhase === "enter" ? 0 : 1,
                willChange: "transform, opacity",
                transformStyle: "preserve-3d",
                backfaceVisibility: "hidden",
                transition: cardTransition,
                cursor: "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", width: "100%", fontSize: "12.5px", fontWeight: 700, color: "var(--m-second)" }}>
                <span>
                  {(s.cardIndex % CARDS.length) + 1} / {CARDS.length}
                </span>
                <span
                  style={{
                    color: s.cardAnswers[s.cardIndex % CARDS.length] === "again" ? "var(--m-red)" : "var(--m-green)",
                    fontSize: "12.5px",
                    fontWeight: 700,
                  }}
                >
                  {s.cardAnswers[s.cardIndex % CARDS.length] === "again"
                    ? "Nisem vedel"
                    : s.cardAnswers[s.cardIndex % CARDS.length] === "easy"
                      ? "Vedel sem"
                      : ""}
                </span>
              </span>
              <span
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  fontWeight: 600,
                  lineHeight: 1.4,
                  color: "var(--m-label)",
                  textAlign: "center",
                }}
              >
                {s.flipped ? card.back : card.front}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 650, color: "var(--m-second)" }}>
                {s.flipped ? "Nazaj na vprašanje" : "Pokaži odgovor"}
              </span>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "20px",
                  background:
                    cardX < 0
                      ? "color-mix(in srgb, var(--m-red) 22%, transparent)"
                      : "color-mix(in srgb, var(--m-green) 22%, transparent)",
                  fontSize: "36px",
                  opacity: cardPhase === "enter" ? 0 : Math.min(1, Math.abs(cardX) / 90),
                  pointerEvents: "none",
                  transition: s.cardDragActive ? "none" : "opacity 190ms ease",
                }}
              >
                {cardX < 0 ? "❌" : "✅"}
              </span>
            </button>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
              <button
                type="button"
                onClick={() => this.setState((c) => ({ cardIndex: Math.max(0, c.cardIndex - 1), flipped: false }))}
                aria-label="Prejšnja kartica"
                style={this.cardNavStyle(s.cardIndex > 0)}
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => this.gradeCard("again")}
                aria-label="Nisem vedel"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  minWidth: "74px",
                  minHeight: "46px",
                  padding: "0 14px",
                  border: "1px solid var(--m-red)",
                  borderRadius: "999px",
                  background: "var(--m-red-soft)",
                  color: "var(--m-red)",
                  fontSize: "15px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: "16px" }}>✕</span>
                <span>{missedCount}</span>
              </button>
              <button
                type="button"
                onClick={() => this.gradeCard("easy")}
                aria-label="Vedel sem"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  minWidth: "74px",
                  minHeight: "46px",
                  padding: "0 14px",
                  border: "1px solid var(--m-green)",
                  borderRadius: "999px",
                  background: "var(--m-green-soft)",
                  color: "var(--m-green)",
                  fontSize: "15px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <span>{knownCount}</span>
                <span style={{ fontSize: "16px" }}>✓</span>
              </button>
              <button
                type="button"
                onClick={() => this.setState((c) => ({ cardIndex: Math.min(CARDS.length - 1, c.cardIndex + 1), flipped: false }))}
                aria-label="Naslednja kartica"
                style={this.cardNavStyle(s.cardIndex < CARDS.length - 1)}
              >
                →
              </button>
            </div>
          </div>
        ) : null}

        {quizSummaryVisible
          ? summary({
              badge: quizCorrect === QUIZ.length ? "Zaključeno" : "Krog 1 zaključen",
              title: quizCorrect === QUIZ.length ? "Vsa vprašanja so predelana" : "Ponovi vprašanja, ki si jih zgrešil",
              pct: completionPct(quizCorrect, QUIZ.length),
              pctLabel: quizCorrect === QUIZ.length ? "Komplet opravljen" : "Rezultat kroga",
              metricLabel: quizCorrect === QUIZ.length ? "Predelana vprašanja" : "Pravilno v tem krogu",
              metric: `${quizCorrect} / ${QUIZ.length}`,
              action:
                quizCorrect === QUIZ.length
                  ? "Začni kviz znova"
                  : `Ponovi ${QUIZ.length - quizCorrect}${QUIZ.length - quizCorrect === 1 ? " zgrešeno vprašanje" : " zgrešeni vprašanji"}`,
              tap: "restart-quiz",
              onRestart: () => this.setState({ quizDone: false, quizIndex: 0, quizPick: null, quizAnswers: [] }),
            })
          : null}

        {quizBoardVisible ? (
          <div style={{ display: "grid", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12.8px", fontWeight: 700, color: "var(--m-second)" }}>
              <span>
                {(s.quizIndex % QUIZ.length) + 1} / {QUIZ.length}
              </span>
            </div>
            <div style={{ display: "grid", gap: "14px" }}>
              <p style={{ margin: 0, fontSize: "17.6px", fontWeight: 600, lineHeight: 1.35, color: "var(--m-label)" }}>{quiz.question}</p>
              <div style={{ display: "grid", gap: "9px" }}>
                {quiz.options.map((label, index) => {
                  const picked = s.quizPick === index;
                  const isCorrect = index === quiz.correct;
                  let background = "var(--m-surface)";
                  let color = "var(--m-label)";
                  let border = "1px solid var(--m-sep)";
                  if (quizAnswered && isCorrect) {
                    background = "var(--m-green-soft)";
                    color = "var(--m-green)";
                    border = "1px solid var(--m-green)";
                  } else if (quizAnswered && picked) {
                    background = "var(--m-red-soft)";
                    color = "var(--m-red)";
                    border = "1px solid var(--m-red)";
                  }
                  return (
                    <button
                      key={label}
                      type="button"
                      data-tap="quiz-opt"
                      onClick={() => {
                        if (this.state.quizPick === null) {
                          this.setState((c) => {
                            const picks = (c.quizAnswers || []).slice();
                            picks[c.quizIndex % QUIZ.length] = index;
                            return { quizPick: index, quizAnswers: picks };
                          });
                        }
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        width: "100%",
                        minHeight: "52px",
                        padding: "12px 14px",
                        border,
                        borderRadius: "14px",
                        background,
                        color,
                        fontSize: "15px",
                        fontWeight: 500,
                        fontFamily: "inherit",
                        cursor: quizAnswered ? "default" : "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "26px",
                          height: "26px",
                          flexShrink: 0,
                          borderRadius: "999px",
                          background: "var(--m-muted)",
                          color: "var(--m-second)",
                          fontSize: "12.5px",
                          fontWeight: 700,
                        }}
                      >
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: "15px", lineHeight: 1.4 }}>{label}</span>
                    </button>
                  );
                })}
              </div>
              {quizAnswered ? (
                <div style={{ display: "grid", gap: "6px", padding: "13px 15px", border: "1px solid var(--m-sep)", borderRadius: "14px", background: "var(--m-muted)" }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "14.5px",
                      fontWeight: 700,
                      color: s.quizPick === quiz.correct ? "var(--m-green)" : "var(--m-red)",
                    }}
                  >
                    {s.quizPick === quiz.correct ? "Pravilno" : "Napačno"}
                  </p>
                  <p style={{ margin: 0, fontSize: "14.2px", lineHeight: 1.5, color: "var(--m-second)" }}>{quiz.explanation}</p>
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <button
                type="button"
                onClick={() => this.setState((c) => ({ quizIndex: Math.max(0, c.quizIndex - 1), quizPick: null }))}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: 1,
                  minHeight: "46px",
                  border: "1px solid var(--m-sep)",
                  borderRadius: "14px",
                  background: "var(--m-muted)",
                  color: "var(--m-tint)",
                  fontSize: "15px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  opacity: s.quizIndex % QUIZ.length === 0 ? 0.5 : 1,
                  cursor: "pointer",
                }}
              >
                Nazaj
              </button>
              <button
                type="button"
                data-tap="quiz-next"
                onClick={() =>
                  this.setState((c) =>
                    c.quizIndex % QUIZ.length === QUIZ.length - 1
                      ? { quizIndex: c.quizIndex, quizPick: c.quizPick, quizDone: true }
                      : { quizIndex: c.quizIndex + 1, quizPick: null, quizDone: c.quizDone },
                  )
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: 1,
                  minHeight: "46px",
                  border: 0,
                  borderRadius: "14px",
                  background: "var(--m-tint)",
                  color: "#fff",
                  fontSize: "15px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  opacity: s.quizPick === null ? 0.5 : 1,
                  cursor: "pointer",
                }}
              >
                {s.quizIndex % QUIZ.length === QUIZ.length - 1 ? "Zaključi" : "Naprej"}
              </button>
            </div>
          </div>
        ) : null}

        {s.studyMode === "practice_test" ? (
          <div style={{ display: "grid", gap: "12px" }}>
            {!s.testGraded ? (
              <div style={{ display: "grid", gap: "12px" }}>
                {PRACTICE.map((question, index) => {
                  const unknown = s.practiceUnknown.indexOf(question.id) !== -1;
                  return (
                    <div key={question.id} style={{ display: "grid", gap: "10px", padding: "15px", border: "1px solid var(--m-sep)", borderRadius: "16px", background: "var(--m-muted)" }}>
                      <span style={{ fontSize: "12.5px", fontWeight: 700, letterSpacing: "0.04em", color: "var(--m-second)" }}>
                        Vprašanje {index + 1}
                      </span>
                      <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, lineHeight: 1.35, color: "var(--m-label)" }}>
                        {question.prompt}
                      </p>
                      <textarea
                        data-tap="answer"
                        value={s.practiceAnswers[question.id] || ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          this.setState((c) => ({ practiceAnswers: { ...c.practiceAnswers, [question.id]: value } }));
                        }}
                        placeholder="Sem napiši svoj odgovor..."
                        style={{
                          width: "100%",
                          minHeight: "104px",
                          padding: "12px",
                          border: 0,
                          borderRadius: "10px",
                          background: "var(--m-surface)",
                          color: "var(--m-label)",
                          fontSize: "16px",
                          fontFamily: "inherit",
                          lineHeight: 1.45,
                          resize: "none",
                          outline: "none",
                          opacity: unknown ? 0.5 : 1,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          this.setState((c) => ({
                            practiceUnknown: unknown
                              ? c.practiceUnknown.filter((id) => id !== question.id)
                              : c.practiceUnknown.concat(question.id),
                          }))
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "9px",
                          padding: 0,
                          border: 0,
                          background: "transparent",
                          color: "var(--m-label)",
                          fontSize: "14.5px",
                          fontFamily: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "20px",
                            height: "20px",
                            borderRadius: "6px",
                            border: unknown ? 0 : "1px solid var(--m-sep-strong)",
                            background: unknown ? "var(--m-tint)" : "transparent",
                            color: "#fff",
                            fontSize: "12px",
                            fontWeight: 700,
                          }}
                        >
                          {unknown ? "✓" : ""}
                        </span>
                        <span>Ne vem</span>
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  data-tap="submit"
                  onClick={() => this.setState({ testGraded: true })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "48px",
                    border: 0,
                    borderRadius: "14px",
                    background: "var(--m-tint)",
                    color: "#fff",
                    fontSize: "16px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Oddaj preizkus
                </button>
              </div>
            ) : (
              <div style={completionShell()}>
                <div style={{ display: "grid", gap: "8.8px", justifyItems: "center", textAlign: "center" }}>
                  <div style={{ display: "grid", gap: "8.8px", justifyItems: "center", textAlign: "center" }}>
                    <p style={{ margin: 0, maxWidth: "38ch", fontSize: "9.9px", lineHeight: 1.2, color: "var(--m-second)", overflowWrap: "anywhere" }}>
                      Poskus 1
                    </p>
                  </div>
                </div>
                <div style={{ display: "grid", justifyItems: "center", gap: "10px" }}>
                  <div style={ringStyle(80)}>
                    {ringInner}
                    <div style={{ position: "relative", zIndex: 1, display: "grid", gap: "1.9px", justifyItems: "center", textAlign: "center" }}>
                      <strong style={{ fontSize: "23px", lineHeight: 1, letterSpacing: "-0.05em", color: "var(--m-label)" }}>80%</strong>
                      <span
                        style={{
                          maxWidth: "10ch",
                          fontSize: "9.6px",
                          fontWeight: 700,
                          letterSpacing: "0.05em",
                          lineHeight: 1.2,
                          textTransform: "uppercase",
                          color: "var(--m-second)",
                        }}
                      >
                        Rezultat
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "7px", justifyItems: "center", textAlign: "center" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--m-second)" }}>
                      Dosežene točke
                    </span>
                    <strong style={{ fontSize: "25px", lineHeight: 1, letterSpacing: "-0.06em", color: "var(--m-label)", whiteSpace: "nowrap" }}>
                      8 / 10
                    </strong>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "5.8px", width: "100%" }}>
                  {[
                    ["Povprečje", "80%"],
                    ["Najboljši rezultat", "80%"],
                    ["Najnižji rezultat", "80%"],
                    ["Poskusi", "1"],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: "grid", gap: "4.8px", minWidth: 0, padding: "7.4px 8.3px", borderRadius: "18px", border: "1px solid var(--m-sep)", background: "var(--m-surface)" }}>
                      <span style={{ fontSize: "8.6px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--m-second)" }}>
                        {label}
                      </span>
                      <strong style={{ fontSize: "12.2px", lineHeight: 1.05, letterSpacing: "-0.04em", color: "var(--m-label)" }}>{value}</strong>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "5.8px", width: "100%" }}>
                  <button
                    type="button"
                    data-tap="restart-test"
                    onClick={() => this.setState({ testGraded: false, practiceAnswers: {}, practiceUnknown: [] })}
                    style={completionAction()}
                  >
                    <span style={{ fontSize: "12.8px" }}>🔄</span>
                    Začni nov preizkus
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  renderChatTab() {
    const s = this.state;
    const messages = s.messages.length ? s.messages : this.studyData().chat;
    return (
      <div
        style={{
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr) auto",
          height: "380px",
          border: "1px solid var(--m-sep)",
          borderRadius: "18px",
          background: "var(--m-surface)",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        <div style={{ display: "grid", alignContent: "start", gap: "12px", padding: "17.6px 17.6px 12px", overflowY: "auto" }}>
          {messages.map((message, i) => (
            <div
              key={i}
              style={{
                alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                justifySelf: message.role === "user" ? "end" : "start",
                maxWidth: "84%",
                padding: "12px 14px",
                borderRadius: message.role === "user" ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                background: message.role === "user" ? "var(--m-tint)" : "var(--m-muted)",
                color: message.role === "user" ? "#fff" : "var(--m-label)",
                fontSize: "15px",
                lineHeight: 1.45,
              }}
            >
              {message.text}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gap: "8px", padding: "12px 17.6px 15px", borderTop: "1px solid var(--m-sep)" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
            <textarea
              value={s.chatInput}
              onChange={(e) => this.setState({ chatInput: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  this.sendChat();
                }
              }}
              placeholder="Vprašaj o tem predavanju"
              rows={1}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: "44px",
                maxHeight: "88px",
                padding: "11px 14px",
                border: 0,
                borderRadius: "14px",
                background: "var(--m-muted)",
                color: "var(--m-label)",
                fontSize: "16px",
                fontFamily: "inherit",
                lineHeight: 1.35,
                resize: "none",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => this.sendChat()}
              aria-label="Pošlji sporočilo"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "44px",
                height: "44px",
                flexShrink: 0,
                border: 0,
                borderRadius: "999px",
                background: "var(--m-tint)",
                color: "#fff",
                fontSize: "16px",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              ➤
            </button>
          </div>
          <p style={{ margin: 0, fontSize: "12.5px", lineHeight: 1.4, color: "var(--m-second)" }}>
            Odgovori ostajajo vezani na to predavanje.
          </p>
        </div>
      </div>
    );
  }

  renderTranscriptTab() {
    return (
      <div style={{ display: "grid", gap: "16px", padding: "17.6px", border: "1px solid var(--m-sep)", borderRadius: "18px", background: "var(--m-surface)", minWidth: 0 }}>
        {this.studyData().transcript.map((line) => (
          <div key={line.time} style={{ display: "grid", gap: "4px" }}>
            <p style={{ margin: 0, fontSize: "12.8px", fontWeight: 600, color: "var(--m-second)" }}>{line.time}</p>
            <p style={{ margin: 0, fontSize: "15.7px", lineHeight: 1.9, color: "var(--m-label)", whiteSpace: "pre-wrap" }}>{line.text}</p>
          </div>
        ))}
      </div>
    );
  }

  renderNote() {
    const s = this.state;
    const note = this.activeNote();
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "32px",
                fontWeight: 700,
                letterSpacing: "-0.04em",
                lineHeight: 1.1,
                color: "var(--m-label)",
                overflowWrap: "anywhere",
              }}
            >
              {note?.title ?? ""}
            </h1>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "9.6px", marginTop: "6.4px" }}>
              <span style={{ fontSize: "14.7px", lineHeight: 1.4, color: "var(--m-second)" }}>{note?.date ?? ""}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "inline-flex", width: "100%", marginBottom: "2.4px", padding: "2px", borderRadius: "8px", background: "var(--m-muted)" }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-tap="tab"
              onClick={() => {
                if (tab.id !== "notes" && this.state.reading) this.toggleRead();
                this.setState({ tab: tab.id });
              }}
              aria-label={tab.label}
              title={tab.label}
              style={this.segment(s.tab === tab.id)}
            >
              {tab.icon}
            </button>
          ))}
        </div>

        {s.tab === "notes" ? this.renderNotesTab() : null}
        {s.tab === "study" ? this.renderStudyTab() : null}
        {s.tab === "chat" ? this.renderChatTab() : null}
        {s.tab === "transcript" ? this.renderTranscriptTab() : null}
      </div>
    );
  }

  renderSupport() {
    const s = this.state;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "18px", paddingTop: "14.4px" }}>
        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1.02, color: "var(--m-label)" }}>
          Pomoč
        </h1>
        {HELP_SECTIONS.map((section, sectionIndex) => (
          <section key={section.title} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 650, letterSpacing: "-0.03em", color: "var(--m-label)" }}>
              {section.title}
            </h2>
            <div style={{ display: "grid", gap: "9.8px" }}>
              {section.items.map((item, itemIndex) => {
                const key = `${sectionIndex}-${itemIndex}`;
                const isOpen = s.openHelp === key;
                return (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => this.setState({ openHelp: isOpen ? null : key })}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "17px 18px",
                      border: "1px solid var(--m-sep)",
                      borderRadius: "18px",
                      background: "var(--m-surface)",
                      boxShadow: "var(--m-shadow)",
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: "15px", fontWeight: 500, color: "var(--m-label)", textAlign: "left" }}>
                        {item.title}
                      </span>
                      <span
                        style={{
                          color: "var(--m-third)",
                          fontSize: "17px",
                          transform: isOpen ? "rotate(90deg)" : "none",
                          transition: "transform 180ms ease",
                        }}
                      >
                        ›
                      </span>
                    </span>
                    {isOpen ? (
                      <span style={{ display: "block", marginTop: "10px", fontSize: "14px", lineHeight: 1.55, color: "var(--m-second)", textAlign: "left" }}>
                        {item.body}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  renderSettings() {
    const s = this.state;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "18px", paddingTop: "14.4px" }}>
        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1.02, color: "var(--m-label)" }}>
          Nastavitve
        </h1>

        <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 650, letterSpacing: "-0.03em", color: "var(--m-label)" }}>Tema</h2>
          <div style={{ display: "grid", gap: "10px" }}>
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => this.setState({ theme: option.value })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  minHeight: "66px",
                  padding: "12px 16px",
                  border: s.theme === option.value ? "1px solid var(--m-tint)" : "1px solid var(--m-sep)",
                  borderRadius: "22px",
                  background: s.theme === option.value ? "var(--m-tint-soft)" : "var(--m-card-grad)",
                  boxShadow: "var(--m-shadow)",
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
                    flexShrink: 0,
                    borderRadius: "50%",
                    background: "var(--m-muted)",
                    fontSize: "17px",
                  }}
                >
                  {option.icon}
                </span>
                <span style={{ flex: 1, textAlign: "left", fontSize: "16px", fontWeight: 600, color: "var(--m-label)" }}>{option.label}</span>
                <span style={{ color: "var(--m-tint)", fontSize: "16px", fontWeight: 700, opacity: s.theme === option.value ? 1 : 0 }}>✓</span>
              </button>
            ))}
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 650, letterSpacing: "-0.03em", color: "var(--m-label)" }}>Naročnina</h2>
          <div style={{ display: "grid", gap: "12px", padding: "18px 20px", border: "1px solid var(--m-sep)", borderRadius: "26px", background: "var(--m-card-grad)", boxShadow: "var(--m-shadow)" }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: "0 0 6px", fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--m-second)" }}>
                Paket
              </p>
              <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--m-label)" }}>Memo AI Pro (aktivno)</p>
              <p style={{ margin: "4px 0 0", fontSize: "13.6px", color: "var(--m-second)" }}>Aktivno do 12. september 2026</p>
            </div>
            <button
              type="button"
              onClick={() => this.setState({ screen: "settings" })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                minHeight: "44px",
                border: 0,
                borderRadius: "12px",
                background: "var(--m-muted)",
                color: "var(--m-tint)",
                fontSize: "15px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              Upravljaj naročnino
            </button>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 650, letterSpacing: "-0.03em", color: "var(--m-label)" }}>Račun</h2>
          <div style={{ display: "grid", gap: "12px", padding: "18px 20px", border: "1px solid var(--m-sep)", borderRadius: "26px", background: "var(--m-card-grad)", boxShadow: "var(--m-shadow)" }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: "0 0 6px", fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--m-second)" }}>
                Prijavljen
              </p>
              <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--m-label)", overflowWrap: "anywhere" }}>
                student@memoai.eu
              </p>
            </div>
            <button
              type="button"
              onClick={() => this.setState({ screen: "home" })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "44px",
                border: 0,
                borderRadius: "12px",
                background: "var(--m-red-soft)",
                color: "var(--m-red)",
                fontSize: "15px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              Odjava
            </button>
          </div>
          <div style={{ display: "grid", gap: "10px" }}>
            {[
              { icon: "🎟️", title: "Unovči kodo" },
              { icon: "🔒", title: "Zasebnost" },
              { icon: "📤", title: "Deli" },
              { icon: "💡", title: "Predlagaj funkcijo" },
            ].map((link) => (
              <button
                key={link.title}
                type="button"
                onClick={() => this.setState({ screen: "support", openHelp: null })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  minHeight: "62px",
                  padding: "12px 16px",
                  border: "1px solid var(--m-sep)",
                  borderRadius: "22px",
                  background: "var(--m-card-grad)",
                  boxShadow: "var(--m-shadow)",
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
                    flexShrink: 0,
                    borderRadius: "50%",
                    background: "var(--m-muted)",
                    fontSize: "17px",
                  }}
                >
                  {link.icon}
                </span>
                <span style={{ flex: 1, textAlign: "left", fontSize: "16px", fontWeight: 600, color: "var(--m-label)" }}>{link.title}</span>
                <span style={{ color: "var(--m-third)", fontSize: "17px" }}>›</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  /* ── Overlays ─────────────────────────────────────────────── */

  renderFolderSheet() {
    const s = this.state;
    const folderSheet = this.sheet("folders", () => this.setState({ folderSheetOpen: false }), {
      gridTemplateRows: "auto auto minmax(0, 1fr)",
      gap: "14px",
    });
    const allFolders: Array<{ id: string | null; name: string; icon: string; noteIds: string[] | null }> = [
      { id: null, name: "Vsi zapiski", icon: "🗂️", noteIds: null },
      ...s.folders,
    ];
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 115 }}>
        <button type="button" onClick={() => this.setState({ folderSheetOpen: false })} aria-label="Zapri mape" style={SHEET_BACKDROP} />
        <section style={folderSheet.style} onPointerDown={folderSheet.onPointerDown}>
          {SHEET_HANDLE}
          {sheetTitleRow("Mape", () => this.setState({ folderSheetOpen: false }), "Zapri mape")}
          <div style={{ display: "grid", alignContent: "start", gap: "12.8px", minHeight: 0, overflowY: "auto" }}>
            {allFolders.map((folder) => {
              const count = folder.noteIds ? s.notes.filter((note) => folder.noteIds!.indexOf(note.id) !== -1).length : s.notes.length;
              const active = s.folderId === folder.id;
              return (
                <button
                  key={folder.id ?? "all"}
                  type="button"
                  onClick={() => this.setState({ folderId: folder.id, folderSheetOpen: false })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "13.6px",
                    width: "100%",
                    minHeight: "79.2px",
                    padding: "14.4px 16px",
                    border: active ? "1px solid var(--m-tint)" : "1px solid var(--m-sep)",
                    borderRadius: "22px",
                    background: active ? "var(--m-tint-soft)" : "var(--m-muted)",
                    color: "var(--m-label)",
                    textAlign: "left",
                    fontSize: "14.7px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "13.6px", minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "44px",
                        height: "44px",
                        flexShrink: 0,
                        borderRadius: "999px",
                        background: "var(--m-surface)",
                        fontSize: "17px",
                      }}
                    >
                      {folder.icon}
                    </span>
                    <span style={{ display: "grid", gap: "1.9px", minWidth: 0, textAlign: "left" }}>
                      <span style={{ fontSize: "14.7px", fontWeight: 600, color: "var(--m-label)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {folder.name}
                      </span>
                      <span style={{ fontSize: "12.8px", color: "var(--m-second)" }}>{lectureSummary(count)}</span>
                    </span>
                  </span>
                  <span style={{ display: "inline-flex", flexShrink: 0, color: "var(--m-tint)", fontSize: "17.6px", fontWeight: 700, opacity: active ? 1 : 0 }}>
                    ✓
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                this.setState({ folderSheetOpen: false, folderModal: "new", folderModalId: null, folderNameValue: "", folderPickIds: [] })
              }
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "13.6px",
                width: "100%",
                minHeight: "51.6px",
                padding: "14.4px 14.4px",
                border: "1px solid var(--m-sep)",
                borderRadius: "14px",
                background: "var(--m-surface)",
                color: "var(--m-label)",
                fontSize: "14.7px",
                fontWeight: 600,
                fontFamily: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "12px", background: "var(--m-muted)", fontSize: "14px" }}>
                ➕
              </span>
              <span style={{ flex: 1 }}>Nova mapa</span>
              <span style={{ color: "var(--m-third)", fontSize: "17px" }}>›</span>
            </button>
            <button
              type="button"
              onClick={() => this.setState({ folderSheetOpen: false, folderModal: "edit" })}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "13.6px",
                width: "100%",
                minHeight: "51.6px",
                padding: "14.4px 14.4px",
                border: "1px solid var(--m-sep)",
                borderRadius: "14px",
                background: "var(--m-surface)",
                color: "var(--m-label)",
                fontSize: "14.7px",
                fontWeight: 600,
                fontFamily: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "12px", background: "var(--m-muted)", fontSize: "14px" }}>
                ✏️
              </span>
              <span style={{ flex: 1 }}>Uredi mape</span>
              <span style={{ color: "var(--m-third)", fontSize: "17px" }}>›</span>
            </button>
          </div>
        </section>
      </div>
    );
  }

  renderRenameSheet() {
    const s = this.state;
    const close = () => this.setState({ renameId: null, renameValue: "" });
    const renameSheet = this.sheet("rename", close, {
      top: "auto",
      height: "460px",
      gridTemplateRows: "auto auto minmax(0, 1fr)",
      gap: "16px",
      padding: "13.6px 16px 20px",
    });
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 125 }}>
        <button type="button" onClick={close} aria-label="Zapri" style={SHEET_BACKDROP} />
        <section style={renameSheet.style} onPointerDown={renameSheet.onPointerDown}>
          {SHEET_HANDLE}
          {sheetTitleRow("Preimenuj zapisek", close, "Zapri")}
          <div style={{ display: "grid", gap: "16px", alignContent: "start" }}>
            <p style={{ margin: 0, fontSize: "14.5px", lineHeight: 1.45, color: "var(--m-second)" }}>
              Daj temu zapisku bolj jasen naslov, ne da zapustiš stran.
            </p>
            <label style={{ display: "grid", gap: "7px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--m-second)" }}>Naslov</span>
              <input
                value={s.renameValue}
                onChange={(e) => this.setState({ renameValue: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") this.saveRename();
                }}
                placeholder="Neimenovan zapisek"
                style={MODAL_INPUT}
              />
            </label>
            <button type="button" onClick={() => this.saveRename()} style={{ ...MODAL_PRIMARY, opacity: s.renameValue.trim() ? 1 : 0.5 }}>
              Shrani naslov
            </button>
            <button type="button" onClick={close} style={MODAL_SECONDARY}>
              Prekliči
            </button>
          </div>
        </section>
      </div>
    );
  }

  renderDeleteSheet() {
    const s = this.state;
    const close = () => this.setState({ deleteId: null });
    const deleteSheet = this.sheet("delete", close, {
      top: "auto",
      height: "460px",
      gridTemplateRows: "auto auto minmax(0, 1fr)",
      gap: "16px",
      padding: "13.6px 16px 20px",
    });
    const deleteTitle = s.notes.find((note) => note.id === s.deleteId)?.title || "";
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 125 }}>
        <button type="button" onClick={close} aria-label="Zapri" style={SHEET_BACKDROP} />
        <section style={deleteSheet.style} onPointerDown={deleteSheet.onPointerDown}>
          {SHEET_HANDLE}
          {sheetTitleRow("Izbriši zapisek", close, "Zapri")}
          <div style={{ display: "grid", gap: "16px", alignContent: "start" }}>
            <p style={{ margin: 0, fontSize: "14.5px", lineHeight: 1.5, color: "var(--m-second)" }}>
              Izbriši <span style={{ color: "var(--m-label)", fontWeight: 600 }}>{deleteTitle}</span>? Tega ni mogoče razveljaviti.
            </p>
            <button
              type="button"
              onClick={() => this.setState((c) => ({ notes: c.notes.filter((note) => note.id !== c.deleteId), deleteId: null }))}
              style={{ ...MODAL_PRIMARY, background: "var(--m-red)" }}
            >
              Izbriši zapisek
            </button>
            <button type="button" onClick={close} style={MODAL_SECONDARY}>
              Prekliči
            </button>
          </div>
        </section>
      </div>
    );
  }

  renderNewFolderSheet() {
    const s = this.state;
    const close = () => this.setState({ folderModal: null, folderModalId: null });
    const newFolderSheet = this.sheet("newFolder", () => this.setState({ folderModal: null }), {
      gridTemplateRows: "auto auto auto minmax(0, 1fr) auto auto",
      gap: "12px",
    });
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 126 }}>
        <button type="button" onClick={close} aria-label="Zapri" style={SHEET_BACKDROP} />
        <section style={newFolderSheet.style} onPointerDown={newFolderSheet.onPointerDown}>
          {SHEET_HANDLE}
          {sheetTitleRow(s.folderModalId ? "Uredi mapo" : "Nova mapa", close, "Zapri")}
          <label style={{ display: "grid", gap: "7px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--m-second)" }}>Ime</span>
            <input
              value={s.folderNameValue}
              onChange={(e) => this.setState({ folderNameValue: e.target.value })}
              placeholder="Biologija, Matematika, Zgodovina..."
              style={MODAL_INPUT}
            />
          </label>
          <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: "8px", minHeight: 0 }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--m-second)" }}>Dodaj predavanja</span>
            <div
              style={{
                display: "grid",
                alignContent: "start",
                gap: "8px",
                minHeight: 0,
                overflowY: "auto",
                padding: "8px",
                border: "1px solid var(--m-sep)",
                borderRadius: "16px",
                background: "var(--m-muted)",
              }}
            >
              {s.notes.map((note) => {
                const picked = s.folderPickIds.indexOf(note.id) !== -1;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() =>
                      this.setState((c) => ({
                        folderPickIds: picked ? c.folderPickIds.filter((id) => id !== note.id) : c.folderPickIds.concat(note.id),
                      }))
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid var(--m-sep)",
                      borderRadius: "12px",
                      background: picked ? "var(--m-tint-soft)" : "var(--m-surface)",
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "20px",
                        height: "20px",
                        flexShrink: 0,
                        borderRadius: "6px",
                        border: picked ? 0 : "1px solid var(--m-sep-strong)",
                        background: picked ? "var(--m-tint)" : "transparent",
                        color: "#fff",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      ✓
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", fontSize: "14.5px", color: "var(--m-label)" }}>
                      {note.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const name = s.folderNameValue.trim();
              if (!name) return;
              this.setState((c) => ({
                folders: c.folders.concat({ id: `f${Date.now()}`, name, icon: "📁", noteIds: c.folderPickIds.slice() }),
                folderModal: null,
                folderNameValue: "",
                folderPickIds: [],
              }));
            }}
            style={{ ...MODAL_PRIMARY, opacity: s.folderNameValue.trim() ? 1 : 0.5 }}
          >
            {s.folderModalId ? "Shrani mapo" : "Ustvari mapo"}
          </button>
          <button type="button" onClick={close} style={MODAL_SECONDARY}>
            Prekliči
          </button>
        </section>
      </div>
    );
  }

  renderEditFoldersSheet() {
    const s = this.state;
    const close = () => this.setState({ folderModal: null, folderModalId: null });
    const editFoldersSheet = this.sheet("editFolders", () => this.setState({ folderModal: null }), {
      gridTemplateRows: "auto auto minmax(0, 1fr) auto",
      gap: "12px",
    });
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 126 }}>
        <button type="button" onClick={close} aria-label="Zapri" style={SHEET_BACKDROP} />
        <section style={editFoldersSheet.style} onPointerDown={editFoldersSheet.onPointerDown}>
          {SHEET_HANDLE}
          {sheetTitleRow("Uredi mape", close, "Zapri")}
          <div style={{ display: "grid", alignContent: "start", gap: "10px", minHeight: 0, overflowY: "auto" }}>
            {s.folders.map((folder) => (
              <div key={folder.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", border: "1px solid var(--m-sep)", borderRadius: "18px", background: "var(--m-surface)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", flexShrink: 0, borderRadius: "12px", background: "var(--m-muted)", fontSize: "15px" }}>
                  {folder.icon}
                </span>
                <input
                  value={folder.name}
                  onChange={(e) => {
                    const value = e.target.value;
                    this.setState((c) => ({
                      folders: c.folders.map((item) => (item.id === folder.id ? { ...item, name: value } : item)),
                    }));
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: "40px",
                    padding: "6px 10px",
                    border: 0,
                    borderRadius: "10px",
                    background: "var(--m-muted)",
                    color: "var(--m-label)",
                    fontSize: "15px",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    this.setState((c) => ({
                      folders: c.folders.filter((item) => item.id !== folder.id),
                      folderId: c.folderId === folder.id ? null : c.folderId,
                    }))
                  }
                  aria-label="Izbriši mapo"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "40px",
                    height: "40px",
                    flexShrink: 0,
                    border: "1px solid var(--m-red)",
                    borderRadius: "999px",
                    background: "var(--m-red-soft)",
                    color: "var(--m-red)",
                    fontSize: "15px",
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={close} style={MODAL_PRIMARY}>
            Končano
          </button>
        </section>
      </div>
    );
  }

  renderCreateMenu() {
    const createSheet = this.sheet("create", () => this.setState({ createMenuOpen: false }), {
      gridTemplateRows: "auto auto minmax(0, 1fr)",
    });
    const close = () => this.setState({ createMenuOpen: false });
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 110 }}>
        <button type="button" onClick={close} aria-label="Zapri" style={SHEET_BACKDROP} />
        <section style={createSheet.style} onPointerDown={createSheet.onPointerDown}>
          {SHEET_HANDLE}
          {sheetTitleRow("Nov zapisek", close, "Zapri")}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", alignContent: "stretch", gap: "10.4px", minHeight: 0, overflowY: "auto" }}>
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                data-tap="quick"
                onClick={() => this.openSheet(action.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  minHeight: "68px",
                  padding: "12px 14.4px",
                  border: "1px solid var(--m-card-border)",
                  borderRadius: "20px",
                  background: "var(--m-action-card)",
                  textAlign: "left",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    width: "37.6px",
                    height: "37.6px",
                    flexShrink: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "50%",
                    fontSize: "19.2px",
                    color: action.accent === "record" ? "var(--m-red)" : "var(--m-label)",
                    background: action.accent === "record" ? "var(--m-red-soft)" : "var(--m-icon-surface)",
                  }}
                >
                  {action.icon}
                </span>
                <span style={{ display: "grid", gap: "1.9px", minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: "15.04px", fontWeight: 600, color: "var(--m-label)" }}>{action.label}</span>
                  <span style={{ fontSize: "12.48px", lineHeight: 1.35, color: "var(--m-second)" }}>{action.detail}</span>
                </span>
                <span style={{ color: "var(--m-third)", fontSize: "17.6px" }}>›</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  renderSourceSheet() {
    const s = this.state;
    if (!s.sheetMode) return null;
    const close = () => this.setState({ sheetMode: null, busyLabel: null });
    const sourceSheet = this.sheet("source", close, {
      gridTemplateRows: "auto auto minmax(0, 1fr)",
      gap: "16px",
      padding: "11.2px 16px 20px",
    });
    const sheet = SHEET_CONTENT[s.sheetMode];
    const variants = SOURCE_VARIANTS[s.sheetMode];
    const variant = variants[(s.sourceVariant || 0) % variants.length];
    const isBusy = Boolean(s.busyLabel);

    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 120 }}>
        <button
          type="button"
          onClick={close}
          aria-label="Zapri"
          style={{ ...SHEET_BACKDROP, background: "rgba(12,15,25,0.56)" }}
        />
        <section style={sourceSheet.style} onPointerDown={sourceSheet.onPointerDown}>
          {SHEET_HANDLE}
          <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) 44px", alignItems: "center", minHeight: "50px", flex: "0 0 auto" }}>
            <h2 style={{ gridColumn: 2, margin: 0, textAlign: "center", fontSize: "19.5px", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--m-label)" }}>
              {sheet.title}
            </h2>
            {sheetCloseButton(close, "Zapri")}
          </div>

          {isBusy ? (
            <div style={{ display: "grid", alignContent: "center", alignSelf: "stretch", minHeight: 0, overflow: "hidden" }}>
              <div role="status" aria-live="polite" style={{ display: "grid", gap: "13.6px", width: "min(100%, 384px)", margin: "0 auto", textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8.8px", color: "var(--m-label)" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: "16px",
                      height: "16px",
                      flex: "none",
                      border: "2px solid color-mix(in srgb, currentColor 25%, transparent)",
                      borderTopColor: "currentColor",
                      borderRadius: "999px",
                      animation: "memo-spin 0.85s linear infinite",
                    }}
                  />
                  <p style={{ margin: 0, color: "inherit", fontSize: "16px", fontWeight: 600 }}>{s.busyLabel}</p>
                </div>
                <p style={{ margin: 0, color: "var(--m-second)", fontSize: "14.08px", lineHeight: 1.45 }}>
                  Ne zapiraj tega zaslona. Ko bo vse pripravljeno, se bo zaprl samodejno.
                </p>
                <button
                  type="button"
                  onClick={() => this.setState({ busyLabel: null })}
                  style={{
                    display: "inline-flex",
                    width: "100%",
                    minHeight: "53.6px",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    border: 0,
                    borderRadius: "20px",
                    background: "var(--m-muted)",
                    color: "var(--m-tint)",
                    fontSize: "16.8px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Prekliči
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "inline-flex", width: "100%", padding: "2px", borderRadius: "8px", background: "var(--m-muted)" }}>
                {SOURCE_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => this.setState({ sheetMode: mode.id, sourceVariant: 0 })}
                    aria-label={mode.label}
                    style={this.segment(s.sheetMode === mode.id)}
                  >
                    {mode.icon}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => this.setState((c) => ({ createAudio: !c.createAudio }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: 0,
                  border: 0,
                  background: "transparent",
                  color: "var(--m-label)",
                  fontSize: "15px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <span
                  data-tap="audio"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "22px",
                    height: "22px",
                    borderRadius: "6px",
                    border: s.createAudio ? 0 : "1px solid var(--m-sep-strong)",
                    background: s.createAudio ? "var(--m-tint)" : "transparent",
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  {s.createAudio ? "✓" : ""}
                </span>
                <span>Ustvari zvok</span>
              </button>

              <div style={{ display: "grid", gap: "8px", padding: "16px 18px", border: "1px solid var(--m-sep)", borderRadius: "18px", background: "var(--m-surface)" }}>
                <p style={{ margin: 0, fontSize: "11.5px", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--m-second)" }}>
                  {sheet.cardLabel}
                </p>
                <p style={{ margin: 0, fontSize: "16px", fontWeight: 500, color: "var(--m-label)", overflowWrap: "anywhere" }}>{variant.cardTitle}</p>
                <p style={{ margin: 0, fontSize: "13.5px", color: "var(--m-second)" }}>{variant.cardMeta}</p>
              </div>

              <button
                type="button"
                data-tap="ustvari"
                onClick={() => this.create()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  minHeight: "48px",
                  border: 0,
                  borderRadius: "12px",
                  background: "var(--m-tint)",
                  color: "#fff",
                  fontSize: "16px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <span>{sheet.createIcon}</span>
                <span>Ustvari</span>
              </button>
              <button
                type="button"
                onClick={() => this.setState((c) => ({ sourceVariant: (c.sourceVariant || 0) + 1 }))}
                style={MODAL_SECONDARY}
              >
                {sheet.secondary}
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ── Root ─────────────────────────────────────────────────── */

  render() {
    const s = this.state;
    const k = s.scale;
    const radius = 55 * k;
    const search = s.query.trim().toLowerCase();
    const activeFolder = s.folders.find((folder) => folder.id === s.folderId) ?? null;
    const filtered = s.notes.filter((note) => {
      if (activeFolder && activeFolder.noteIds.indexOf(note.id) === -1) return false;
      if (!search) return true;
      return note.title.toLowerCase().includes(search) || SOURCE_META[note.source].label.toLowerCase().includes(search);
    });

    const rootStyle: CSSProperties = {
      display: "flex",
      justifyContent: "center",
      // Without this the frame stretches to fill the reserved height and the
      // body grows taller than the screen it wraps.
      alignItems: "flex-start",
      width: "100%",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Segoe UI', sans-serif",
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

    const dockOpen = s.dockOpen;
    const dockItems = [
      { id: "home", icon: "🏠", label: "Domov" },
      { id: "support", icon: "❓", label: "Pomoč" },
      { id: "settings", icon: "⚙️", label: "Nastavitve" },
    ].filter((item) => (s.screen === "home" ? item.id !== "settings" : item.id !== "home"));

    const pillLabelStyle: CSSProperties = {
      display: "block",
      maxWidth: dockOpen ? "0px" : "160px",
      opacity: dockOpen ? 0 : 1,
      overflow: "hidden",
      whiteSpace: "nowrap",
      transition: "max-width 220ms cubic-bezier(0.22,1,0.36,1), opacity 160ms ease",
    };

    const showReadPill = s.screen === "note" && s.tab === "notes";

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
                width: `${Math.round(393 * k)}px`,
                height: `${Math.round(852 * k)}px`,
                overflow: "hidden",
                borderRadius: `${radius}px`,
                background: "var(--m-canvas)",
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
                  width: "393px",
                  height: "852px",
                  transform: `scale(${k})`,
                  transformOrigin: "top left",
                  display: "flex",
                  flexDirection: "column",
                  background: "var(--m-canvas)",
                  overflow: "hidden",
                }}
              >
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
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    height: "54px",
                    padding: "0 30px 6px 34px",
                    fontSize: "15px",
                    fontWeight: 600,
                    letterSpacing: "0.2px",
                    flex: "0 0 auto",
                  }}
                >
                  <span>9:41</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: "2px", height: "11px" }}>
                      <span style={{ width: "3px", height: "4px", borderRadius: "1px", background: "currentColor" }} />
                      <span style={{ width: "3px", height: "6px", borderRadius: "1px", background: "currentColor" }} />
                      <span style={{ width: "3px", height: "8px", borderRadius: "1px", background: "currentColor" }} />
                      <span style={{ width: "3px", height: "11px", borderRadius: "1px", background: "currentColor" }} />
                    </span>
                    <span style={{ fontSize: "12px", fontWeight: 600, lineHeight: 1 }}>5G</span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        width: "25px",
                        height: "12px",
                        padding: "1.5px",
                        border: "1px solid var(--m-sep-strong)",
                        borderRadius: "3.5px",
                      }}
                    >
                      <span style={{ width: "70%", height: "100%", borderRadius: "2px", background: "currentColor" }} />
                    </span>
                  </span>
                </div>

                <header
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    minHeight: "60px",
                    padding: "0 16px",
                    background: "var(--m-canvas)",
                    borderBottom: "1px solid var(--m-sep-strong)",
                    flex: "0 0 auto",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", height: "36px" }}>
                    <Image
                      src={BRAND_LOCKUP_SRC}
                      alt={SEO_BRAND_NAME}
                      width={BRAND_LOCKUP_WIDTH}
                      height={BRAND_LOCKUP_HEIGHT}
                      style={{ height: "100%", width: "auto", objectFit: "contain" }}
                    />
                  </span>
                </header>

                <div
                  data-app-main
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    padding: "9.6px 15.2px 130px",
                    maskImage: APP_MAIN_FEATHER,
                    WebkitMaskImage: APP_MAIN_FEATHER,
                  }}
                >
                  {s.screen === "home" ? this.renderHome(filtered) : null}
                  {s.screen === "note" ? this.renderNote() : null}
                  {s.screen === "support" ? this.renderSupport() : null}
                  {s.screen === "settings" ? this.renderSettings() : null}
                </div>

                <div
                  style={
                    dockOpen
                      ? {
                          position: "absolute",
                          left: "16px",
                          bottom: "24px",
                          zIndex: 80,
                          display: "grid",
                          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                          alignItems: "center",
                          width: "280px",
                          minHeight: "51px",
                          padding: "0 2.6px",
                          border: "2px solid var(--m-sep-strong)",
                          borderRadius: "999px",
                          background: "var(--m-nav)",
                          backdropFilter: "blur(24px) saturate(180%)",
                          WebkitBackdropFilter: "blur(24px) saturate(180%)",
                          boxShadow: "0 14px 28px rgba(0,0,0,0.18)",
                        }
                      : { position: "absolute", left: "16px", bottom: "24px", zIndex: 80, display: "inline-flex", alignItems: "center" }
                  }
                >
                  <button
                    type="button"
                    data-tap="dock"
                    onClick={() => {
                      if (dockOpen) {
                        this.setState({ dockOpen: false, screen: s.screen === "home" ? "settings" : "home", openHelp: null });
                        return;
                      }
                      this.setState({ dockOpen: true });
                    }}
                    aria-label="Navigacija"
                    style={
                      dockOpen
                        ? {
                            justifySelf: "center",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "51px",
                            height: "51px",
                            border: "2px solid transparent",
                            borderRadius: "999px",
                            background: "transparent",
                            color: "var(--m-label)",
                            fontSize: "17px",
                            fontFamily: "inherit",
                            boxShadow: "none",
                            cursor: "pointer",
                          }
                        : {
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "51px",
                            height: "51px",
                            border: "2px solid var(--m-sep-strong)",
                            borderRadius: "999px",
                            background: "var(--m-dock-toggle)",
                            color: "var(--m-dock-toggle-color)",
                            fontSize: "17px",
                            fontFamily: "inherit",
                            boxShadow: "0 14px 28px rgba(0,0,0,0.2)",
                            cursor: "pointer",
                          }
                    }
                  >
                    {s.screen === "home" ? "⚙️" : "🏠"}
                  </button>
                  {dockOpen
                    ? dockItems.map((item) => {
                        const active =
                          (item.id === "home" && (s.screen === "home" || s.screen === "note")) ||
                          (item.id === "support" && s.screen === "support") ||
                          (item.id === "settings" && s.screen === "settings");
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-tap="dock-item"
                            onClick={() =>
                              this.setState({
                                dockOpen: false,
                                screen: item.id === "home" ? "home" : (item.id as PreviewState["screen"]),
                                swipeId: null,
                                swipeOffset: 0,
                                openHelp: null,
                              })
                            }
                            aria-label={item.label}
                            style={{
                              justifySelf: "center",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "51px",
                              height: "51px",
                              border: 0,
                              borderRadius: "999px",
                              background: active ? "var(--m-tab-active)" : "transparent",
                              boxShadow: active ? "var(--m-tab-active-shadow)" : "none",
                              color: "var(--m-label)",
                              fontSize: "17px",
                              fontFamily: "inherit",
                              cursor: "pointer",
                            }}
                          >
                            {item.icon}
                          </button>
                        );
                      })
                    : null}
                </div>

                {s.screen === "home" ? (
                  <button
                    type="button"
                    data-tap="create"
                    onClick={() => this.setState({ createMenuOpen: true, dockOpen: false })}
                    style={{
                      position: "absolute",
                      right: "16px",
                      bottom: "24px",
                      zIndex: 70,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: dockOpen ? "0px" : "8px",
                      minHeight: "51px",
                      width: dockOpen ? "51px" : "auto",
                      minWidth: dockOpen ? "51px" : "178px",
                      padding: dockOpen ? 0 : "0 18px",
                      border: "2px solid rgba(255,255,255,0.2)",
                      borderRadius: "999px",
                      background: "linear-gradient(135deg, #ff6d68, #f45f5a)",
                      color: "#fff",
                      fontSize: "16px",
                      fontWeight: 650,
                      fontFamily: "inherit",
                      boxShadow: "0 12px 24px rgba(244,95,90,0.24)",
                      overflow: "hidden",
                      transition:
                        "min-width 220ms cubic-bezier(0.22,1,0.36,1), width 220ms cubic-bezier(0.22,1,0.36,1), padding 220ms cubic-bezier(0.22,1,0.36,1), gap 180ms ease",
                      cursor: "pointer",
                    }}
                  >
                    <span>➕</span>
                    <span style={pillLabelStyle}>Nov zapisek</span>
                  </button>
                ) : null}

                {showReadPill ? (
                  <button
                    type="button"
                    onClick={() => this.toggleRead()}
                    style={{
                      position: "absolute",
                      right: "16px",
                      bottom: "24px",
                      zIndex: 70,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: "51px",
                      width: dockOpen ? "51px" : "auto",
                      minWidth: dockOpen ? "51px" : "168px",
                      gap: dockOpen ? "0px" : "8px",
                      padding: dockOpen ? 0 : "0 18px",
                      overflow: "hidden",
                      transition:
                        "min-width 220ms cubic-bezier(0.22,1,0.36,1), width 220ms cubic-bezier(0.22,1,0.36,1), padding 220ms cubic-bezier(0.22,1,0.36,1), gap 180ms ease",
                      border: "2px solid rgba(255,255,255,0.2)",
                      borderRadius: "999px",
                      background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                      color: "#fff",
                      fontSize: "16px",
                      fontWeight: 650,
                      fontFamily: "inherit",
                      boxShadow: "0 12px 24px rgba(37,99,235,0.24)",
                      cursor: "pointer",
                    }}
                  >
                    <span>{s.reading ? "⏸️" : "🎧"}</span>
                    <span style={pillLabelStyle}>{s.reading ? "Premor" : "Poslušaj"}</span>
                  </button>
                ) : null}

                {s.folderSheetOpen ? this.renderFolderSheet() : null}
                {s.renameId ? this.renderRenameSheet() : null}
                {s.deleteId ? this.renderDeleteSheet() : null}
                {s.folderModal === "new" ? this.renderNewFolderSheet() : null}
                {s.folderModal === "edit" ? this.renderEditFoldersSheet() : null}
                {s.createMenuOpen ? this.renderCreateMenu() : null}
                {s.sheetMode ? this.renderSourceSheet() : null}

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
