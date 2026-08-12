"use client";

import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { Component } from "react";

type FlowSource = {
  id: string;
  icon: string;
  kind: string;
  kindColor: string;
  label: string;
  sub: string;
  noteTitle: string;
  noteSub: string;
};

const FLOW_SOURCES: FlowSource[] = [
  {
    id: "audio",
    icon: "🎙️",
    kind: "mp3",
    kindColor: "#e8663d",
    label: "predavanje-4.mp3",
    sub: "Zvok · 48:12",
    noteTitle: "Predavanje IS – 4. teden",
    noteSub: "Zvok · danes",
  },
  {
    id: "pdf",
    icon: "📄",
    kind: "pdf",
    kindColor: "#d0342c",
    label: "skripta-IS.pdf",
    sub: "PDF · 24 strani",
    noteTitle: "Skripta IS – poglavje 4",
    noteSub: "PDF · danes",
  },
  {
    id: "doc",
    icon: "📝",
    kind: "docx",
    kindColor: "#2b579a",
    label: "seminarska-erp.docx",
    sub: "Word · 12 strani",
    noteTitle: "Seminarska: Kako deluje ERP",
    noteSub: "Word · danes",
  },
];

const STUDY_CARDS = [
  { q: "Kaj je transakcijski informacijski sistem?", a: "Sistem, ki zajema in obdeluje dnevne poslovne transakcije." },
  { q: "Čemu služi odločitveni sistem?", a: "Analizi podatkov za taktične in strateške odločitve vodstva." },
  { q: "Kaj povezuje ERP?", a: "Procese celotnega podjetja v en integriran sistem." },
];

const STUDY_QUIZ = [
  {
    q: "Kateri sistem obdeluje dnevne transakcije?",
    options: ["Transakcijski", "Odločitveni", "Ekspertni", "Informacijski portal"],
    correct: 0,
  },
  {
    q: "Kaj pomeni ERP?",
    options: ["Elektronski račun", "Načrtovanje virov podjetja", "Poročilo prodaje", "Enotni registrski profil"],
    correct: 1,
  },
  {
    q: "Kdo najpogosteje uporablja odločitveni sistem?",
    options: ["Stranke", "Dobavitelji", "Vodstvo", "Zunanji revizor"],
    correct: 2,
  },
  {
    q: "Zakaj so kakovostni podatki ključni?",
    options: ["Znižajo ceno strojne opreme", "Pospešijo internet", "Brez njih so odločitve slabe", "Nadomeščajo vodstvo"],
    correct: 2,
  },
];

const STUDY_TEST = [
  {
    q: "Naštej eno prednost ERP sistema.",
    keys: ["integr", "povez", "enot", "podat", "proces", "učinkovit"],
    a: "Enotni podatki in povezani procesi.",
  },
  {
    q: "Kaj je izhod transakcijskega sistema?",
    keys: ["podat", "zapis", "transakcij", "poročil"],
    a: "Zapisi o transakcijah za nadaljnjo obdelavo.",
  },
  {
    q: "Zakaj vodstvo potrebuje odločitveni sistem?",
    keys: ["analiz", "scenarij", "odloč", "napoved", "primerj"],
    a: "Ker primerja scenarije in podpira odločitve.",
  },
];

const PAST_NOTES = [
  { icon: "🎙️", title: "Predavanje IS – 3. teden", sub: "Zvok · včeraj" },
  { icon: "📄", title: "Skripta IS – poglavje 2", sub: "PDF · v torek" },
  { icon: "📝", title: "Seminarska: ERP", sub: "Word · v petek" },
  { icon: "🎙️", title: "Predavanje IS – 2. teden", sub: "Zvok · prejšnji teden" },
];

// Chip geometry lives in landing.css so it can shrink to fit three across
// on narrow screens; only the drag state stays inline here.
const CHIP_BASE: CSSProperties = {
  transition: "transform 220ms cubic-bezier(0.34,1.3,0.5,1), opacity 220ms ease",
};

const STATUS_BASE: CSSProperties = {
  margin: 0,
  minHeight: "1.2rem",
  fontSize: "0.88rem",
  fontWeight: 500,
  transition: "color 300ms ease, opacity 300ms ease",
};

const NOTE_IN = "memo-note-in 260ms cubic-bezier(0.22,1,0.36,1) both";

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
};

type FlowDemoState = {
  flowStage: number;
  noteStep: number;
  flowOver: boolean;
  flowLabel: string | null;
  flowSource: FlowSource | null;
  flowGhost: FlowGhost | null;
  flowDrag: string | null;
  sTab: "cards" | "quiz" | "test";
  sIdx: number;
  sFlip: boolean;
  sDx: number;
  sOut: boolean;
  sEnter: boolean;
  sKnown: number;
  sQIdx: number;
  sQPick: number | null;
  sQScore: number;
  sTIdx: number;
  sTVal: string;
  sTShown: boolean;
  sTScore: number;
  sTOk: boolean;
  touchGhost: { icon: string; label: string; x: number; y: number } | null;
};

export class LandingFlowDemo extends Component<FlowDemoProps, FlowDemoState> {
  state: FlowDemoState = {
    flowStage: 0,
    noteStep: 0,
    flowOver: false,
    flowLabel: null,
    flowSource: null,
    flowGhost: null,
    flowDrag: null,
    sTab: "cards",
    sIdx: 0,
    sFlip: false,
    sDx: 0,
    sOut: false,
    sEnter: false,
    sKnown: 0,
    sQIdx: 0,
    sQPick: null,
    sQScore: 0,
    sTIdx: 0,
    sTVal: "",
    sTShown: false,
    sTScore: 0,
    sTOk: false,
    touchGhost: null,
  };

  private flowWrap: HTMLDivElement | null = null;
  private flowTile: HTMLDivElement | null = null;
  private flowChipEls: Array<HTMLDivElement | null> = [];
  private flowObserver: IntersectionObserver | null = null;
  private flowTimers: number[] = [];
  private flowUserActed = false;
  private flowStarted = false;
  private studyTimer: number | undefined;
  private cardStart: { x: number; y: number; moved: boolean } | null = null;
  private studyTouched = false;
  private touchDrag: { chip: FlowSource; startX: number; startY: number; moved: boolean } | null = null;
  private suppressChipClick = false;
  private stepEls: Array<HTMLElement | null> = [];
  private stepObserver: IntersectionObserver | null = null;
  private stepVisible: Record<number, boolean> = {};
  private advancing = false;

  componentDidMount() {
    this.setupFlow();
    this.setupStepObserver();
  }

  componentWillUnmount() {
    this.clearFlowTimers();
    window.clearTimeout(this.studyTimer);
    if (this.flowObserver) this.flowObserver.disconnect();
    if (this.stepObserver) this.stepObserver.disconnect();
    window.removeEventListener("pointermove", this.onChipPointerMove);
    window.removeEventListener("pointerup", this.onChipPointerUp);
    window.removeEventListener("pointercancel", this.onChipPointerUp);
  }

  // Stacked layouts show one step at a time, so each step waits for its own
  // card to be on screen — otherwise steps 2 and 3 animate out of sight and
  // are already finished by the time the user scrolls to them.
  setupStepObserver() {
    if (!this.isCompact() || !("IntersectionObserver" in window)) return;
    this.stepObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const step = Number(entry.target.getAttribute("data-flow-step"));
          // Mostly on screen, so a step below the fold does not count as seen.
          this.stepVisible[step] = entry.isIntersecting && entry.intersectionRatio >= 0.75;
        });
        this.maybeAdvance();
      },
      { threshold: [0.25, 0.5, 0.75, 0.9, 1] },
    );
    this.stepEls.forEach((el) => el && this.stepObserver?.observe(el));
  }

  maybeAdvance() {
    if (!this.isCompact() || this.advancing) return;
    const stage = this.state.flowStage;
    // Step 1 on screen: drop the file into the card and start the story.
    if (stage === 0 && this.stepVisible[1] && !this.flowStarted && !this.flowUserActed) {
      this.flowStarted = true;
      this.flowLater(() => this.autoFlow(), 400);
      return;
    }
    if (stage === 1 && this.stepVisible[2]) {
      this.advancing = true;
      [180, 620, 1040, 1400, 1720, 2020, 2320].forEach((ms, i) =>
        this.flowLater(() => this.setState({ noteStep: i + 1 }), ms),
      );
      this.flowLater(() => {
        this.advancing = false;
        this.setState({ flowStage: 2 }, () => this.maybeAdvance());
      }, 2480);
      return;
    }
    if (stage === 2 && this.stepVisible[3]) {
      this.flowLater(() => this.setState({ flowStage: 3 }), 400);
    }
  }

  clearFlowTimers() {
    this.flowTimers.forEach((id) => window.clearTimeout(id));
    this.flowTimers = [];
  }

  flowLater(fn: () => void, ms: number) {
    this.flowTimers.push(window.setTimeout(fn, ms));
  }

  // Below the two-column breakpoint the steps stack, so scrolling through the
  // section would restart the story mid-read. There it plays once and stays on
  // the finished state, ready to be used; desktop keeps looping.
  isCompact() {
    return typeof window !== "undefined" && window.innerWidth < 900;
  }

  setupFlow() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || this.props.storyAutoplay === false || !("IntersectionObserver" in window)) {
      this.flowUserActed = true;
      return;
    }
    // The story plays once, and only after the steps are properly on screen —
    // never while they are half out of view, and never on a loop.
    this.flowObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (this.flowUserActed || this.flowStarted || !entry.isIntersecting) return;
          // A grid taller than the viewport can never reach full visibility.
          const needed = entry.boundingClientRect.height > window.innerHeight * 0.9 ? 0.6 : 0.9;
          if (entry.intersectionRatio < needed) return;
          this.flowStarted = true;
          this.flowObserver?.disconnect();
          this.flowObserver = null;
          this.flowLater(() => this.autoFlow(), 400);
        });
      },
      { threshold: [0.25, 0.5, 0.6, 0.75, 0.9, 1] },
    );
    if (this.isCompact()) {
      this.flowObserver.disconnect();
      this.flowObserver = null;
      return;
    }
    if (this.flowWrap) this.flowObserver.observe(this.flowWrap);
  }

  runFlow(source: FlowSource, byUser: boolean) {
    this.clearFlowTimers();
    if (byUser) this.flowUserActed = true;
    // A new source restarts the whole story, study material included, so the
    // deck animates in from the first card again.
    this.studyTouched = false;
    this.setState({
      flowStage: 1,
      flowOver: false,
      flowLabel: source.label,
      flowSource: source,
      flowGhost: null,
      flowDrag: null,
      noteStep: 0,
      sTab: "cards",
      sIdx: 0,
      sFlip: false,
      sDx: 0,
      sOut: false,
      sEnter: false,
      sKnown: 0,
      sQIdx: 0,
      sQPick: null,
      sQScore: 0,
      sTIdx: 0,
      sTVal: "",
      sTShown: false,
      sTScore: 0,
      sTOk: false,
    });
    if (this.isCompact()) {
      this.advancing = false;
      window.setTimeout(() => this.maybeAdvance(), 0);
      return;
    }
    [180, 620, 1040, 1400, 1720, 2020, 2320].forEach((ms, i) =>
      this.flowLater(() => this.setState({ noteStep: i + 1 }), ms),
    );
    this.flowLater(() => this.setState({ flowStage: 2 }), 2480);
    this.flowLater(() => this.setState({ flowStage: 3 }), 3100);
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
      70,
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
      260,
    );
    this.flowLater(() => this.setState({ flowOver: true }), 860);
    this.flowLater(
      () =>
        this.setState((s) =>
          s.flowGhost ? { flowGhost: { ...s.flowGhost, opacity: 0, scale: 0.4 } } : null,
        ),
      1020,
    );
    this.flowLater(() => {
      this.setState({ flowGhost: null });
      this.runFlow(src, false);
    }, 1180);
  }

  studyTouch() {
    this.studyTouched = true;
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

  gradeCard(known: boolean) {
    if (this.state.sOut) return;
    this.setState({ sOut: true, sDx: known ? 300 : -300 });
    window.clearTimeout(this.studyTimer);
    this.studyTimer = window.setTimeout(() => {
      this.setState((p) => ({
        sIdx: p.sIdx + 1,
        sKnown: p.sKnown + (known ? 1 : 0),
        sFlip: false,
        sDx: 0,
        sOut: false,
        sEnter: true,
      }));
      window.setTimeout(() => this.setState({ sEnter: false }), 40);
    }, 230);
  }

  onCardDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    this.studyTouch();
    if (this.state.sOut) return;
    this.cardStart = { x: e.clientX, y: e.clientY, moved: false };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
  };

  onCardMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!this.cardStart || this.state.sOut) return;
    const dx = e.clientX - this.cardStart.x;
    if (Math.abs(dx) > 4) this.cardStart.moved = true;
    this.setState({ sDx: dx });
  };

  onCardUp = () => {
    if (!this.cardStart) return;
    const moved = this.cardStart.moved;
    this.cardStart = null;
    const dx = this.state.sDx;
    if (Math.abs(dx) > 52) {
      this.gradeCard(dx > 0);
      return;
    }
    this.setState((p) => ({ sDx: 0, sFlip: moved ? p.sFlip : !p.sFlip }));
  };

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

  restartStudy = () => {
    this.studyTouch();
    const tab = this.state.sTab;
    if (tab === "cards") {
      this.setState({ sIdx: 0, sKnown: 0, sFlip: false, sDx: 0, sOut: false, sEnter: true });
      window.setTimeout(() => this.setState({ sEnter: false }), 40);
    } else if (tab === "quiz") {
      this.setState({ sQIdx: 0, sQScore: 0, sQPick: null });
    } else {
      this.setState({ sTIdx: 0, sTScore: 0, sTVal: "", sTShown: false, sTOk: false });
    }
  };

  submitTest = () => {
    this.studyTouch();
    const t = STUDY_TEST[Math.min(this.state.sTIdx, STUDY_TEST.length - 1)];
    if (!this.state.sTShown) {
      if (!this.state.sTVal.trim()) return;
      const low = this.state.sTVal.toLowerCase();
      const ok = t.keys.some((k) => low.indexOf(k) >= 0);
      this.setState((p) => ({ sTShown: true, sTScore: p.sTScore + (ok ? 1 : 0), sTOk: ok }));
      return;
    }
    this.setState((p) => ({ sTIdx: p.sTIdx + 1, sTVal: "", sTShown: false, sTOk: false }));
  };

  tabStyle(id: FlowDemoState["sTab"]): CSSProperties {
    const on = this.state.sTab === id;
    return {
      flex: 1,
      padding: "6px 0",
      border: "none",
      borderRadius: "7px",
      background: on ? "var(--l-surface)" : "transparent",
      fontSize: "12.5px",
      fontWeight: on ? 600 : 500,
      fontFamily: "inherit",
      color: on ? "var(--l-label)" : "var(--l-second)",
      cursor: "pointer",
      transition: "background 200ms ease, color 200ms ease",
    };
  }

  selectTab(id: FlowDemoState["sTab"]) {
    this.studyTouch();
    this.setState({ sTab: id });
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

  renderStep1() {
    const s = this.state;
    const stage = s.flowStage;
    const over = s.flowOver;

    const dropCardStyle: CSSProperties = {
      display: "grid",
      alignContent: "start",
      gap: "8px",
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      boxSizing: "border-box",
      minHeight: "23rem",
      overflow: "hidden",
      alignSelf: "stretch",
      padding: "13px 14px",
      borderRadius: "18px",
      background: "var(--l-surface)",
      border: over ? "1px solid var(--l-flow)" : "1px solid var(--l-line)",
      boxShadow: over ? "0 0 0 6px var(--l-flow-soft), var(--l-shadow)" : "var(--l-shadow)",
      transform: over ? "scale(1.03)" : "scale(1)",
      cursor: "pointer",
      transition:
        "transform 260ms cubic-bezier(0.34,1.4,0.5,1), box-shadow 260ms ease, border-color 260ms ease",
    };

    const dropRowStyle: CSSProperties = {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "8px 11px",
      minWidth: 0,
      minHeight: "58px",
      padding: "10px 11px",
      borderRadius: "14px",
      boxSizing: "border-box",
      background: stage >= 1 ? "var(--l-surface-62)" : "transparent",
      border: stage >= 1 ? "1px solid var(--l-line)" : "1px dashed var(--l-line)",
      transition: "background 300ms ease, border-color 300ms ease",
    };

    const dropIcon = stage >= 1 ? (s.flowSource ? s.flowSource.icon : "🎙️") : "⬇️";
    const dropTitle = stage >= 1 ? (s.flowSource ? s.flowSource.noteTitle : "Nov zapisek") : "Spusti vir sem";
    const dropSubtitle = stage >= 1 ? (s.flowSource ? s.flowSource.noteSub : "danes") : "Zvok, PDF, dokument ali besedilo";

    return (
      <article
        data-scroll-reveal=""
        data-flow-step="1"
        ref={(el) => {
          this.stepEls[0] = el;
        }}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          justifyItems: "center",
          gap: "0.85rem",
          minWidth: 0,
          textAlign: "center",
        }}
      >
        <span style={this.nodeStyle(1, { pulse: true, over: true })} />
        <h3 style={{ margin: "0.35rem 0 0", color: "var(--l-label)", fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.25 }}>
          Posnemi ali naloži
        </h3>
        <div
          ref={(el) => {
            this.flowTile = el;
          }}
          onDragOver={this.onFlowDragOver}
          onDragLeave={this.onFlowDragLeave}
          onDrop={this.onFlowDrop}
          onClick={() => this.runFlow(FLOW_SOURCES[0], true)}
          style={dropCardStyle}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <span style={{ fontSize: "10.6px", fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--l-second)" }}>
              Zapiski
            </span>
            <span style={{ fontSize: "10.6px", fontWeight: 600, color: "var(--l-second)" }}>
              {stage >= 1 ? "5 zapiskov" : "4 zapiski"}
            </span>
          </div>
          <div style={dropRowStyle}>
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
              {dropIcon}
            </span>
            <span style={{ display: "grid", gap: "4px", minWidth: 0, flex: 1, textAlign: "left" }}>
              <span
                style={{
                  fontSize: "14.7px",
                  fontWeight: 500,
                  color: "var(--l-label)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {dropTitle}
              </span>
              <span style={{ fontSize: "12.5px", lineHeight: 1.3, color: "var(--l-second)" }}>{dropSubtitle}</span>
            </span>
            {stage === 1 ? (
              <span
                style={{
                  flexBasis: "100%",
                  minWidth: 0,
                  marginTop: "2px",
                  padding: "4px 9px",
                  borderRadius: "999px",
                  background: "var(--l-line)",
                  color: "var(--l-second)",
                  fontSize: "9.2px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: "center",
                }}
              >
                Ustvarjanje zapiskov
              </span>
            ) : null}
          </div>
          {PAST_NOTES.map((row) => (
            <div
              key={row.title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                minWidth: 0,
                padding: "8px 11px",
                borderRadius: "14px",
                boxSizing: "border-box",
                border: "1px solid var(--l-line)",
                background: "var(--l-surface-62)",
                opacity: 0.6,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: "30px",
                  height: "30px",
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  background: "var(--l-line)",
                  fontSize: "13px",
                }}
              >
                {row.icon}
              </span>
              <span style={{ display: "grid", gap: "3px", minWidth: 0, flex: 1, textAlign: "left" }}>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--l-label)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.title}
                </span>
                <span style={{ fontSize: "11.4px", lineHeight: 1.3, color: "var(--l-second)" }}>{row.sub}</span>
              </span>
            </div>
          ))}
        </div>
        <p style={{ ...STATUS_BASE, color: stage >= 2 ? "var(--l-label)" : "var(--l-second)" }}>
          {stage === 0 ? "Povleci ali klikni" : stage === 1 ? "Prepisujem…" : "Vir dodan"}
        </p>
      </article>
    );
  }

  renderStep2() {
    const s = this.state;
    const stage = s.flowStage;
    const noteVis = stage >= 2 ? 7 : stage === 1 ? s.noteStep : 0;

    const noteCardStyle: CSSProperties = {
      display: "grid",
      gap: "9px",
      alignContent: "start",
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      boxSizing: "border-box",
      minHeight: "23rem",
      overflow: "hidden",
      alignSelf: "stretch",
      padding: "15px 14px",
      borderRadius: "18px",
      border: "1px solid var(--l-line)",
      background: "var(--l-surface)",
      boxShadow: "var(--l-shadow)",
    };

    const bullet = (bold: string, rest: string) => (
      <span
        style={{
          animation: NOTE_IN,
          display: "grid",
          gridTemplateColumns: "12px 1fr",
          fontSize: "12.6px",
          lineHeight: 1.5,
          color: "var(--l-label)",
        }}
      >
        <span style={{ opacity: 0.72 }}>•</span>
        <span>
          <span style={{ fontWeight: 600 }}>{bold}</span> {rest}
        </span>
      </span>
    );

    return (
      <article
        data-scroll-reveal=""
        data-flow-step="2"
        ref={(el) => {
          this.stepEls[1] = el;
        }}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          justifyItems: "center",
          gap: "0.85rem",
          minWidth: 0,
          textAlign: "center",
        }}
      >
        <span style={this.nodeStyle(1)} />
        <h3 style={{ margin: "0.35rem 0 0", color: "var(--l-label)", fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.25 }}>
          Dobi zapiske
        </h3>
        <div style={noteCardStyle}>
          {noteVis >= 1 ? (
            <span
              style={{
                animation: NOTE_IN,
                display: "inline-block",
                justifySelf: "start",
                padding: "1.6px 5.1px",
                borderRadius: "6.7px",
                background: "rgba(37,99,235,0.42)",
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--l-label)",
              }}
            >
              Hiter pregled
            </span>
          ) : null}
          {noteVis >= 2 ? (
            <p style={{ animation: NOTE_IN, margin: 0, fontSize: "13.5px", lineHeight: 1.62, color: "var(--l-label)", textAlign: "left" }}>
              <span style={{ padding: "1.6px 5.1px", borderRadius: "6.7px", background: "rgba(232,132,52,0.42)" }}>
                Poslovni informacijski sistemi
              </span>{" "}
              zbirajo in obdelujejo informacije, ki podpirajo{" "}
              <span style={{ padding: "1.6px 5.1px", borderRadius: "6.7px", background: "rgba(37,99,235,0.42)" }}>
                odločanje v podjetjih
              </span>
              .
            </p>
          ) : null}
          {noteVis >= 3 ? (
            <span
              style={{
                animation: NOTE_IN,
                display: "inline-block",
                justifySelf: "start",
                padding: "1.6px 5.1px",
                borderRadius: "6.7px",
                background: "rgba(37,99,235,0.42)",
                fontSize: "13.4px",
                fontWeight: 700,
                color: "var(--l-label)",
              }}
            >
              Vrste sistemov
            </span>
          ) : null}
          <div style={{ display: "grid", gap: "5.5px", textAlign: "left" }}>
            {noteVis >= 4 ? bullet("Transakcijski", "– zajema dnevne poslovne dogodke.") : null}
            {noteVis >= 5 ? bullet("Odločitveni", "– analize za vodstvo in scenarije.") : null}
            {noteVis >= 6 ? bullet("ERP", "– poveže procese v enoten podatkovni model.") : null}
          </div>
          {noteVis >= 7 ? (
            <div
              style={{
                animation: NOTE_IN,
                display: "grid",
                gap: "2px",
                padding: "8px 10px",
                border: "1px solid rgba(245,158,11,0.3)",
                borderLeft: "3px solid #f59e0b",
                borderRadius: "10px",
                background: "rgba(180,83,9,0.22)",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: "10.6px", fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--l-second)" }}>
                Ključno
              </span>
              <span style={{ fontSize: "12.4px", lineHeight: 1.45, color: "var(--l-label)" }}>
                Brez kakovostnih podatkov tudi najboljši sistem ne da dobrih odločitev.
              </span>
            </div>
          ) : null}
          {stage === 1 && noteVis < 7 ? (
            <span
              style={{
                justifySelf: "start",
                width: "8px",
                height: "14px",
                borderRadius: "2px",
                background: "var(--l-label)",
                animation: "memo-caret 900ms steps(1, end) infinite",
              }}
            />
          ) : null}
        </div>
        <p style={{ ...STATUS_BASE, color: stage >= 2 ? "var(--l-label)" : "var(--l-second)" }}>
          {stage >= 2 ? "Zapiski pripravljeni" : stage === 1 ? "Pišem zapiske…" : ""}
        </p>
      </article>
    );
  }

  renderStudyDone() {
    const s = this.state;
    const cards = STUDY_CARDS;
    const quiz = STUDY_QUIZ;
    const test = STUDY_TEST;
    const pct =
      s.sTab === "cards"
        ? Math.round((s.sKnown / cards.length) * 100)
        : s.sTab === "quiz"
          ? Math.round((s.sQScore / quiz.length) * 100)
          : Math.round((s.sTScore / test.length) * 100);
    const metric =
      s.sTab === "cards"
        ? `${s.sKnown}/${cards.length}`
        : s.sTab === "quiz"
          ? `${s.sQScore}/${quiz.length}`
          : `${s.sTScore}/${test.length}`;

    return (
      <div
        style={{
          display: "grid",
          alignContent: "center",
          justifyItems: "center",
          gap: "11px",
          height: "100%",
          minHeight: "196px",
          padding: "14px 12px",
          boxSizing: "border-box",
          border: "1px solid var(--l-line)",
          borderRadius: "16px",
          background: "radial-gradient(circle at top, rgba(10,132,255,0.18), transparent 55%), var(--l-surface-62)",
        }}
      >
        <div style={{ display: "grid", gap: "7px", justifyItems: "center", textAlign: "center" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              minHeight: "19.2px",
              padding: "0 7.2px",
              borderRadius: "999px",
              background: "color-mix(in srgb, var(--l-tint) 16%, var(--l-surface))",
              color: "var(--l-tint)",
              fontSize: "9.3px",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {s.sTab === "cards" ? "Zaključeno" : s.sTab === "quiz" ? "Kviz zaključen" : "Preizkus oddan"}
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: "13px",
              fontWeight: 720,
              letterSpacing: "-0.04em",
              lineHeight: 1.25,
              color: "var(--l-label)",
              overflowWrap: "anywhere",
            }}
          >
            {s.sTab === "cards"
              ? s.sKnown === cards.length
                ? "Vse kartice so predelane"
                : "Ponovi kartice, ki si jih zgrešil"
              : s.sTab === "quiz"
                ? s.sQScore === quiz.length
                  ? "Vsa vprašanja so predelana"
                  : "Ponovi vprašanja, ki si jih zgrešil"
                : "Preizkus je ocenjen"}
          </h3>
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: "7px" }}>
          <div
            style={{
              position: "relative",
              display: "grid",
              placeItems: "center",
              width: "76px",
              height: "76px",
              padding: "5.4px",
              borderRadius: "50%",
              background: `conic-gradient(var(--l-tint) ${pct}%, color-mix(in srgb, var(--l-line) 86%, transparent) ${pct}% 100%)`,
              boxShadow: "inset 0 0 0 1px var(--l-line), 0 0 36px rgba(10,132,255,0.10)",
              transition: "background 700ms cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "5.4px",
                borderRadius: "50%",
                background: "var(--l-surface)",
                boxShadow: "inset 0 0 0 1px var(--l-line), 0 10px 24px rgba(0,0,0,0.08)",
              }}
            />
            <div style={{ position: "relative", zIndex: 1, display: "grid", gap: "2px", justifyItems: "center", textAlign: "center" }}>
              <strong style={{ fontSize: "17.3px", lineHeight: 1, letterSpacing: "-0.05em", color: "var(--l-label)" }}>{pct}%</strong>
              <span
                style={{
                  maxWidth: "9ch",
                  fontSize: "7.7px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  lineHeight: 1.2,
                  textTransform: "uppercase",
                  color: "var(--l-second)",
                }}
              >
                {s.sTab === "cards" ? "Znanih" : s.sTab === "quiz" ? "Pravilnih" : "Točk"}
              </span>
            </div>
          </div>
          <div style={{ display: "grid", gap: "4px", justifyItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--l-second)" }}>
              {s.sTab === "cards" ? "Znane kartice" : s.sTab === "quiz" ? "Pravilni odgovori" : "Dosežene točke"}
            </span>
            <strong style={{ fontSize: "18.6px", lineHeight: 1, letterSpacing: "-0.06em", color: "var(--l-label)", whiteSpace: "nowrap" }}>
              {metric}
            </strong>
          </div>
        </div>
        <button
          type="button"
          onClick={this.restartStudy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            width: "100%",
            minHeight: "34px",
            padding: "0 12px",
            border: "1px solid var(--l-line)",
            borderRadius: "999px",
            background: "var(--l-surface)",
            color: "var(--l-label)",
            fontFamily: "inherit",
            fontSize: "11.6px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "12px" }}>🔄</span>
          {s.sTab === "cards" ? "Začni komplet znova" : s.sTab === "quiz" ? "Začni kviz znova" : "Začni nov preizkus"}
        </button>
      </div>
    );
  }

  renderStep3() {
    const s = this.state;
    const stage = s.flowStage;
    const cards = STUDY_CARDS;
    const quiz = STUDY_QUIZ;
    const test = STUDY_TEST;
    const card = cards[Math.min(s.sIdx, cards.length - 1)];
    const q = quiz[Math.min(s.sQIdx, quiz.length - 1)];
    const t = test[Math.min(s.sTIdx, test.length - 1)];
    const cardsDone = s.sIdx >= cards.length;
    const quizDone = s.sQIdx >= quiz.length;
    const testDone = s.sTIdx >= test.length;
    const cardHint =
      !this.studyTouched && s.sTab === "cards" && s.sIdx === 0 && !s.sFlip && s.sDx === 0 && !s.sOut && !s.sEnter;
    const doneNow = s.sTab === "cards" ? cardsDone : s.sTab === "quiz" ? quizDone : testDone;
    const done3 = stage >= 3;

    const studyCardStyle: CSSProperties = {
      display: "grid",
      gridTemplateRows: "minmax(0, 1fr)",
      alignContent: "stretch",
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      boxSizing: "border-box",
      minHeight: "23rem",
      overflow: "visible",
      alignSelf: "stretch",
      padding: "14px",
      borderRadius: "18px",
      border: "1px solid var(--l-line)",
      background: "var(--l-surface)",
      boxShadow: "var(--l-shadow)",
      textAlign: "center",
    };

    const studyBodyStyle: CSSProperties = {
      display: "grid",
      gap: "10px",
      gridTemplateRows: "auto minmax(0, 1fr)",
      height: "100%",
      minHeight: 0,
      opacity: done3 ? 1 : 0,
      transform: done3 ? "translateY(0)" : "translateY(8px)",
      pointerEvents: done3 ? "auto" : "none",
      transition: "opacity 520ms ease, transform 620ms cubic-bezier(0.22,1,0.36,1)",
    };

    const cardStyle: CSSProperties = {
      position: "absolute",
      inset: 0,
      zIndex: 1,
      animation: cardHint ? "memo-card-nudge 4.2s cubic-bezier(0.33,1,0.68,1) 0.9s infinite" : "none",
      perspective: "900px",
      cursor: "grab",
      userSelect: "none",
      WebkitUserSelect: "none",
      touchAction: "none",
      transform: s.sEnter
        ? "translate3d(0,18px,0) scale(0.94)"
        : `translate3d(${s.sDx}px,0,0) rotate(${s.sDx * 0.035}deg)`,
      opacity: s.sOut || s.sEnter ? 0 : 1,
      transition: s.sOut
        ? "transform 230ms cubic-bezier(0.32,0,0.67,0), opacity 230ms ease"
        : s.sEnter
          ? "none"
          : s.sDx === 0
            ? "transform 320ms cubic-bezier(0.2,0.85,0.3,1), opacity 300ms ease"
            : "none",
      willChange: "transform",
    };

    const faceBase: CSSProperties = {
      position: "absolute",
      inset: 0,
      display: "grid",
      alignContent: "space-between",
      gap: "8px",
      padding: "14px 12px",
      boxSizing: "border-box",
      border: "1px solid var(--l-line)",
      borderRadius: "14px",
      background: "var(--l-surface-62)",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
    };

    const cardCounter = `${Math.min(s.sIdx + 1, cards.length)} / ${cards.length}`;

    return (
      <article
        data-scroll-reveal=""
        data-flow-step="3"
        ref={(el) => {
          this.stepEls[2] = el;
        }}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          justifyItems: "center",
          gap: "0.85rem",
          minWidth: 0,
          textAlign: "center",
        }}
      >
        <span style={this.nodeStyle(3)} />
        <h3 style={{ margin: "0.35rem 0 0", color: "var(--l-label)", fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.25 }}>
          Ponavljaj snov
        </h3>
        <div style={studyCardStyle}>
          <div style={studyBodyStyle}>
            <div style={{ display: "flex", width: "100%", padding: "2px", borderRadius: "8px", background: "var(--l-line)" }}>
              <button type="button" onClick={() => this.selectTab("cards")} style={this.tabStyle("cards")}>
                Flashcards
              </button>
              <button type="button" onClick={() => this.selectTab("quiz")} style={this.tabStyle("quiz")}>
                Kviz
              </button>
              <button type="button" onClick={() => this.selectTab("test")} style={this.tabStyle("test")}>
                Test
              </button>
            </div>

            {s.sTab === "cards" && !cardsDone ? (
              <div style={{ position: "relative", height: "100%", minHeight: "196px", touchAction: "pan-y" }}>
                <div
                  onPointerDown={this.onCardDown}
                  onPointerMove={this.onCardMove}
                  onPointerUp={this.onCardUp}
                  onPointerCancel={this.onCardUp}
                  style={cardStyle}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "14px",
                      fontSize: "30px",
                      pointerEvents: "none",
                      background:
                        s.sDx < 0
                          ? "color-mix(in srgb, var(--l-red) 22%, transparent)"
                          : "color-mix(in srgb, var(--l-green) 22%, transparent)",
                      opacity: s.sEnter ? 0 : Math.min(1, Math.abs(s.sDx) / 60),
                      transition: s.sDx === 0 ? "opacity 190ms ease" : "none",
                    }}
                  >
                    {s.sDx < 0 ? "❌" : "✅"}
                  </div>
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: "100%",
                      transformStyle: "preserve-3d",
                      WebkitTransformStyle: "preserve-3d",
                      transform: `rotateY(${s.sFlip ? 180 : 0}deg)`,
                      transition: "transform 520ms cubic-bezier(0.34,1.12,0.44,1)",
                      animation: cardHint ? "memo-card-peek 4.2s cubic-bezier(0.33,1,0.68,1) 0.9s infinite" : "none",
                    }}
                  >
                    <div style={faceBase}>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--l-second)", textAlign: "left" }}>{cardCounter}</span>
                      <span style={{ fontSize: "15px", fontWeight: 600, lineHeight: 1.35, color: "var(--l-label)" }}>{card.q}</span>
                      <span style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--l-second)" }}>Pokaži odgovor</span>
                    </div>
                    <div style={{ ...faceBase, transform: "rotateY(180deg)" }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--l-second)", textAlign: "left" }}>{cardCounter}</span>
                      <span style={{ fontSize: "13.4px", fontWeight: 500, lineHeight: 1.45, color: "var(--l-label)" }}>{card.a}</span>
                      <span style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--l-second)" }}>Povleci levo ali desno</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {s.sTab === "quiz" && !quizDone ? (
              <div
                style={{
                  display: "grid",
                  alignContent: "center",
                  gap: "12px",
                  height: "100%",
                  minHeight: "196px",
                  padding: "12px",
                  boxSizing: "border-box",
                  border: "1px solid var(--l-line)",
                  borderRadius: "14px",
                  background: "var(--l-surface-62)",
                }}
              >
                <div style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--l-second)", textAlign: "left" }}>
                    {Math.min(s.sQIdx + 1, quiz.length)} / {quiz.length}
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: 650, lineHeight: 1.32, color: "var(--l-label)", textAlign: "left" }}>
                    {q.q}
                  </span>
                </div>
                <div style={{ display: "grid", gap: "6px" }}>
                  {q.options.map((label, i) => {
                    const picked = s.sQPick === i;
                    const reveal = s.sQPick !== null;
                    const right = i === q.correct;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          this.studyTouch();
                          if (this.state.sQPick !== null) return;
                          this.setState({ sQPick: i });
                          window.clearTimeout(this.studyTimer);
                          this.studyTimer = window.setTimeout(
                            () =>
                              this.setState((p) => ({
                                sQIdx: p.sQIdx + 1,
                                sQScore: p.sQScore + (right ? 1 : 0),
                                sQPick: null,
                              })),
                            950,
                          );
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "9px 10px",
                          textAlign: "left",
                          fontFamily: "inherit",
                          fontSize: "12.8px",
                          fontWeight: 600,
                          lineHeight: 1.25,
                          borderRadius: "10px",
                          cursor: reveal ? "default" : "pointer",
                          border: `1px solid ${reveal && right ? "var(--l-green)" : picked ? "var(--l-red)" : "var(--l-line)"}`,
                          background: reveal && right ? "rgba(50,215,75,0.16)" : picked ? "rgba(255,69,58,0.14)" : "var(--l-surface)",
                          color: "var(--l-label)",
                          transition: "background 200ms ease, border-color 200ms ease",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            flexShrink: 0,
                            alignItems: "center",
                            justifyContent: "center",
                            width: "19px",
                            height: "19px",
                            borderRadius: "6px",
                            background: reveal && right ? "rgba(50,215,75,0.3)" : picked ? "rgba(255,69,58,0.26)" : "var(--l-line)",
                            fontSize: "11px",
                            fontWeight: 800,
                            color: "var(--l-label)",
                          }}
                        >
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {s.sTab === "test" && !testDone ? (
              <div
                style={{
                  display: "grid",
                  alignContent: "center",
                  gap: "12px",
                  height: "100%",
                  minHeight: "196px",
                  padding: "12px",
                  boxSizing: "border-box",
                  border: "1px solid var(--l-line)",
                  borderRadius: "14px",
                  background: "var(--l-surface-62)",
                }}
              >
                <div style={{ display: "grid", gap: "7px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--l-second)", textAlign: "left" }}>
                    {Math.min(s.sTIdx + 1, test.length)} / {test.length}
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: 650, lineHeight: 1.32, color: "var(--l-label)", textAlign: "left" }}>
                    {t.q}
                  </span>
                </div>
                <input
                  type="text"
                  value={s.sTVal}
                  onChange={(e) => {
                    this.studyTouch();
                    this.setState({ sTVal: e.target.value });
                  }}
                  placeholder="Tvoj odgovor"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    minHeight: "62px",
                    padding: "12px 12px",
                    border: "1px solid var(--l-line)",
                    borderRadius: "12px",
                    background: "var(--l-surface)",
                    color: "var(--l-label)",
                    fontFamily: "inherit",
                    fontSize: "13px",
                    lineHeight: 1.3,
                    outline: "none",
                  }}
                />
                <span
                  style={{
                    fontSize: "11.8px",
                    fontWeight: 600,
                    lineHeight: 1.32,
                    textAlign: "left",
                    minHeight: "16px",
                    color: s.sTShown && s.sTOk ? "var(--l-green)" : "var(--l-second)",
                    opacity: s.sTShown ? 1 : 0,
                    transition: "opacity 200ms ease",
                  }}
                >
                  {s.sTShown ? (s.sTOk ? `✓ ${t.a}` : t.a) : ""}
                </span>
                <button
                  type="button"
                  onClick={this.submitTest}
                  style={{
                    justifySelf: "start",
                    padding: "9px 16px",
                    border: "none",
                    borderRadius: "999px",
                    background: "var(--l-label)",
                    color: "var(--l-page)",
                    fontFamily: "inherit",
                    fontSize: "12.4px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {s.sTShown ? "Naprej" : "Preveri"}
                </button>
              </div>
            ) : null}

            {doneNow ? this.renderStudyDone() : null}
          </div>
        </div>
        <p style={{ ...STATUS_BASE, color: done3 ? "var(--l-label)" : "var(--l-second)" }}>
          {done3 ? "Gradivo pripravljeno" : stage === 2 ? "Ustvarjam gradivo…" : ""}
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
          <span style={{ color: "var(--l-second)", fontSize: "0.92rem" }}>Povleci vir v prvi korak</span>
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
                <span className="landing-v2-flow-chip-sub">{chip.sub}</span>
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
              transition: "transform 700ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease",
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
