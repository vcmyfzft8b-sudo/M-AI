"use client";

import type { CSSProperties, ReactNode } from "react";
import { Fragment, useState } from "react";

import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";

import { LandingTutorDemo } from "./landing-tutor-demo";

/*
 * The seven things the product does, each with a small animated illustration.
 *
 * The captions are product copy and are translated. What the illustrations
 * *contain* — a sample lecture on business information systems, its bullet
 * points and its quiz — is left in Slovenian: it stands in for the learner's
 * own material, which is in their own language whatever the interface is set
 * to. See the note at the top of memo-app-preview-data.ts.
 */
const FEATURES = [
  { titleKey: "showcase.captureTitle", descKey: "showcase.captureDesc" },
  { titleKey: "showcase.notesTitle", descKey: "showcase.notesDesc" },
  /* Third, where the app puts it: once the note exists, the other way to take
     it in is to have it explained rather than to practise it. */
  { titleKey: "showcase.tutorTitle", descKey: "showcase.tutorDesc" },
  { titleKey: "showcase.cardsTitle", descKey: "showcase.cardsDesc" },
  { titleKey: "showcase.quizTitle", descKey: "showcase.quizDesc" },
  { titleKey: "showcase.testsTitle", descKey: "showcase.testsDesc" },
  { titleKey: "showcase.listenTitle", descKey: "showcase.listenDesc" },
] as const satisfies ReadonlyArray<{ titleKey: MessageKey; descKey: MessageKey }>;

function readWord(text: string, delay: number, bold?: boolean): ReactNode {
  return (
    <span
      key={`${text}-${delay}`}
      style={{
        padding: "1.4px 3.6px",
        borderRadius: "6px",
        fontWeight: bold ? 700 : undefined,
        animation: `memo-fx-read 7.2s ease-in-out ${delay.toFixed(2)}s infinite both`,
      }}
    >
      {text}
    </span>
  );
}

function readSequence(words: string[], startDelay: number, boldFirst?: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  words.forEach((word, i) => {
    if (i > 0) out.push(" ");
    out.push(readWord(word, startDelay + i * 0.2, boldFirst && i === 0));
  });
  return out;
}

function WavePanel() {
  const t = useT();

  return (
    <div style={{ display: "grid", gap: "12px", width: "100%", maxWidth: "17rem", justifyItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", height: "34px" }}>
        {Array.from({ length: 11 }, (_, i) => (
          <span
            key={i}
            style={{
              width: "3.5px",
              height: "100%",
              borderRadius: "999px",
              background: "#86868b",
              opacity: 0.9,
              transformOrigin: "center",
              animation: `memo-fx-bar 1.15s ease-in-out ${(i * 0.09).toFixed(2)}s infinite`,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "11px",
          width: "100%",
          boxSizing: "border-box",
          padding: "11px 12px",
          borderRadius: "14px",
          background: "var(--l-surface)",
          boxShadow: "var(--l-shadow)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "34px",
            height: "34px",
            flexShrink: 0,
            borderRadius: "50%",
            background: "var(--l-line)",
            fontSize: "15px",
          }}
        >
          🎙️
        </span>
        <span style={{ display: "grid", gap: "3px", minWidth: 0, textAlign: "left" }}>
          <span
            style={{
              fontSize: "13.5px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--l-label)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {t("flowDemo.noteTitle.audio")}
          </span>
          <span style={{ fontSize: "11.5px", color: "var(--l-second)" }}>
            {`${t("flowDemo.kindAudio")} · ${t("flowDemo.today")}`}
          </span>
        </span>
      </div>
      <span
        style={{
          padding: "5px 9px",
          borderRadius: "999px",
          background: "var(--l-line)",
          color: "var(--l-second)",
          fontSize: "9.5px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          animation: "memo-fx-fade 3.8s ease-in-out infinite",
        }}
      >
        {t("showcase.transcribing")}
      </span>
    </div>
  );
}

function NotesPanel() {
  const t = useT();
  const writeLine = (delay: number): CSSProperties => ({
    display: "block",
    whiteSpace: "nowrap",
    fontSize: "12.5px",
    lineHeight: 1.62,
    color: "var(--l-label)",
    animation: `memo-fx-write 5.2s linear ${delay}s infinite both`,
  });

  return (
    <div style={{ display: "grid", gap: "6px", width: "100%", maxWidth: "17rem", textAlign: "left" }}>
      <span
        style={{
          justifySelf: "start",
          padding: "2.5px 7px",
          borderRadius: "6.7px",
          background: "var(--m-head-hl)",
          color: "var(--l-label)",
          fontSize: "12.5px",
          fontWeight: 700,
          whiteSpace: "nowrap",
          animation: "memo-fx-write 5.2s linear 0s infinite both",
        }}
      >
        {t("flowDemo.note.overview")}
      </span>
      <span style={writeLine(0.35)}>
        <span style={{ padding: "1.6px 5.1px", borderRadius: "6.7px", background: "var(--m-marker)" }}>
          {t("flowDemo.note.leadA")}
        </span>
      </span>
      <span style={writeLine(0.7)}>{t("showcase.note.line1")}</span>
      <span style={writeLine(1.05)}>
        {t("showcase.note.line2Before")}{" "}
        <span style={{ padding: "1.6px 5.1px", borderRadius: "6.7px", background: "var(--m-marker)" }}>
          {t("showcase.note.decision")}
        </span>
        .
      </span>
      <div
        style={{
          display: "grid",
          gap: "4px",
          marginTop: "3px",
          padding: "9px 11px",
          border: "1px solid var(--m-callout-takeaway-line)",
          borderLeft: "3px solid #f59e0b",
          borderRadius: "14px",
          background: "var(--m-callout-takeaway-bg)",
          animation: "memo-fx-write 5.2s linear 1.45s infinite both",
        }}
      >
        <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--l-flow)" }}>
          {t("flowDemo.note.keyLabel")}
        </span>
        <span style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--l-label)" }}>
          {t("showcase.note.keyBody")}
        </span>
      </div>
    </div>
  );
}

function FlashcardPanel() {
  const t = useT();
  const face: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px",
    boxSizing: "border-box",
    border: "1px solid var(--l-line)",
    borderRadius: "20px",
    background: "linear-gradient(180deg, var(--l-surface), var(--l-surface))",
    boxShadow: "var(--l-shadow)",
    backfaceVisibility: "hidden",
    overflow: "hidden",
  };

  return (
    <div style={{ display: "grid", justifyItems: "center", gap: "10px", width: "100%", maxWidth: "19rem" }}>
      <div style={{ position: "relative", width: "100%", height: "12.6rem" }}>
        <div style={{ position: "absolute", inset: 0, animation: "memo-fx-throw 6.4s linear infinite", willChange: "transform, opacity" }}>
          <div style={{ perspective: "900px", width: "100%", height: "100%" }}>
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                transformStyle: "preserve-3d",
                animation: "memo-fx-flip 6.4s cubic-bezier(0.65,0,0.35,1) infinite",
              }}
            >
              <div style={face}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--l-second)" }}>1 / 8</span>
                <span
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                    fontWeight: 600,
                    lineHeight: 1.4,
                    color: "var(--l-label)",
                    textAlign: "center",
                  }}
                >
                  {t("showcase.card.front")}
                </span>
                <span style={{ fontSize: "12.5px", fontWeight: 650, color: "var(--l-second)" }}>{t("flowDemo.showAnswer")}</span>
              </div>
              <div style={{ ...face, transform: "rotateY(180deg)" }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--l-second)" }}>1 / 8</span>
                <span
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "16px",
                    fontWeight: 600,
                    lineHeight: 1.4,
                    color: "var(--l-label)",
                    textAlign: "center",
                  }}
                >
                  {t("showcase.card.back")}
                </span>
                <span style={{ fontSize: "12.5px", fontWeight: 650, color: "var(--l-second)" }}>{t("preview.backToQuestion")}</span>
              </div>
            </div>
          </div>
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "20px",
              background: "rgba(50,215,75,0.22)",
              fontSize: "36px",
              pointerEvents: "none",
              animation: "memo-fx-known 6.4s ease-in-out infinite",
            }}
          >
            ✅
          </span>
        </div>
      </div>
    </div>
  );
}

function QuizPanel() {
  const t = useT();
  const option = (letter: string, label: string, animated?: boolean): ReactNode => (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "9px",
        padding: "11px 12px",
        boxSizing: "border-box",
        border: animated ? "1px solid transparent" : "1px solid var(--l-line)",
        borderRadius: "14px",
        background: "var(--l-surface)",
        fontSize: "13px",
        fontWeight: 600,
        color: "var(--l-label)",
        animation: animated ? "memo-fx-pick 2.6s ease-in-out infinite" : undefined,
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
          background: "var(--l-line)",
          fontSize: "11px",
          fontWeight: 800,
          color: "var(--l-label)",
        }}
      >
        {letter}
      </span>
      {label}
    </span>
  );

  return (
    <div style={{ display: "grid", gap: "10px", width: "100%", maxWidth: "20rem", textAlign: "left" }}>
      <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--l-second)" }}>{t("showcase.quizCounter")}</span>
      {option("A", t("showcase.quizA"), true)}
      {option("B", t("showcase.quizB"))}
      {option("C", t("showcase.quizC"))}
    </div>
  );
}

function TestPanel() {
  const t = useT();
  return (
    <div
      style={{
        display: "grid",
        gap: "12px",
        width: "100%",
        maxWidth: "20rem",
        boxSizing: "border-box",
        padding: "16px",
        borderRadius: "16px",
        background: "var(--l-surface)",
        boxShadow: "var(--l-shadow)",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--l-second)" }}>
        {t("showcase.testQuestionNo")}
      </span>
      <span style={{ fontSize: "13px", fontWeight: 600, lineHeight: 1.4, color: "var(--l-label)" }}>
        {t("showcase.testPrompt")}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: "3px",
          minHeight: "44px",
          padding: "10px 12px",
          boxSizing: "border-box",
          border: "1px solid var(--l-line)",
          borderRadius: "12px",
          background: "var(--l-canvas)",
          fontSize: "12.5px",
          color: "var(--l-label)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "inline-block",
            overflow: "hidden",
            whiteSpace: "nowrap",
            animation: "memo-fx-type 4.4s steps(30, end) infinite",
          }}
        >
          {t("showcase.testAnswer")}
        </span>
        <span
          style={{
            display: "inline-block",
            width: "1.5px",
            height: "15px",
            background: "var(--l-label)",
            animation: "memo-caret 0.9s steps(1, end) infinite",
          }}
        />
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          fontWeight: 700,
          color: "#32d74b",
          animation: "memo-fx-fade 4.4s ease-in-out infinite",
        }}
      >
        {`✓ ${t("showcase.testCorrect")}`}
      </span>
    </div>
  );
}

function ReadPanel() {
  const t = useT();
  const chip: CSSProperties = {
    justifySelf: "start",
    padding: "2.5px 7px",
    borderRadius: "6.7px",
    background: "var(--m-head-hl)",
    color: "var(--l-label)",
    fontSize: "12.5px",
    fontWeight: 700,
  };
  const bulletRow: CSSProperties = {
    display: "flex",
    gap: "7px",
    fontSize: "12.6px",
    lineHeight: 1.8,
    color: "var(--l-label)",
  };

  return (
    <div style={{ display: "grid", gap: "9px", width: "100%", maxWidth: "19rem", textAlign: "left" }}>
      <span style={chip}>{t("flowDemo.note.overview")}</span>
      <p style={{ margin: 0, fontSize: "12.8px", lineHeight: 1.8, color: "var(--l-label)" }}>
        {readSequence(
          t("showcase.read.lead").split(" "),
          0,
        )}
      </p>
      <span style={chip}>{t("showcase.read.keyTypes")}</span>
      <div style={{ display: "grid", gap: "4px" }}>
        <span style={bulletRow}>
          <span style={{ color: "var(--l-second)" }}>•</span>
          <span>{readSequence(t("showcase.read.bullet1").split(" "), 2.4, true)}</span>
        </span>
        <span style={bulletRow}>
          <span style={{ color: "var(--l-second)" }}>•</span>
          <span>{readSequence(t("showcase.read.bullet2").split(" "), 3.6, true)}</span>
        </span>
        <span style={bulletRow}>
          <span style={{ color: "var(--l-second)" }}>•</span>
          <span>{readSequence(t("showcase.read.bullet3").split(" "), 5.0, true)}</span>
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gap: "3px",
          padding: "8px 10px",
          border: "1px solid var(--m-callout-takeaway-line)",
          borderLeft: "3px solid #f59e0b",
          borderRadius: "14px",
          background: "var(--m-callout-takeaway-bg)",
        }}
      >
        <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--l-flow)" }}>
          {t("flowDemo.note.keyLabel")}
        </span>
        <span style={{ fontSize: "12.2px", lineHeight: 1.6, color: "var(--l-label)" }}>
          {readSequence(t("showcase.read.keyBody").split(" "), 6.6)}
        </span>
      </div>
    </div>
  );
}

/* Only the tutor cares; the rest ignore it and animate on their own loop. */
type PanelProps = { active?: boolean };

/*
 * The live tutor, drawn at its own size and shrunk as a whole — the sphere's
 * proportions are the design's, and re-laying it out smaller would lose them.
 * It only starts once the visitor is actually on this feature.
 */
function TutorPanel({ active }: PanelProps) {
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: "17rem", height: "16rem" }}>
      {/* Centred by the transform rather than by the box: the panel it is drawn
          at is taller than the space it is drawn into, and a grid that has to
          centre something bigger than its own track aligns it to the start. */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "330px",
          transform: "translate(-50%, -50%) scale(0.62)",
        }}
      >
        <LandingTutorDemo autoStart={active} />
      </div>
    </div>
  );
}

const PANELS: Array<(props: PanelProps) => ReactNode> = [
  WavePanel,
  NotesPanel,
  TutorPanel,
  FlashcardPanel,
  QuizPanel,
  TestPanel,
  ReadPanel,
];

export function LandingFeatureShowcase() {
  const t = useT();
  const [active, setActive] = useState(0);

  return (
    <div className="landing-v2-fx-layout">
      <div style={{ display: "grid", alignContent: "start", gap: "2px" }}>
        {FEATURES.map((feature, i) => {
          const on = active === i;
          const Panel = PANELS[i];
          return (
            <Fragment key={feature.titleKey}>
            <button
              type="button"
              onClick={() => setActive(i)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.85rem",
                width: "100%",
                padding: "0.95rem 0.5rem",
                border: "none",
                borderBottom: "1px solid var(--l-line-faint)",
                background: "transparent",
                fontFamily: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: "3px",
                  height: "1.9rem",
                  marginTop: "0.15rem",
                  borderRadius: "999px",
                  background: on ? "var(--l-label)" : "transparent",
                  transition: "background 260ms ease",
                }}
              />
              <span style={{ display: "grid", gap: "3px", textAlign: "left" }}>
                <span
                  style={{
                    color: on ? "var(--l-label)" : "var(--l-second)",
                    fontSize: "1.05rem",
                    fontWeight: 700,
                    lineHeight: 1.25,
                    transition: "color 260ms ease",
                  }}
                >
                  {t(feature.titleKey)}
                </span>
                {/* The title's colour already marks the active row; dimming
                    this line as well pushed it under 3:1 against the page. */}
                <span
                  style={{
                    color: "var(--l-second)",
                    fontSize: "0.9rem",
                    lineHeight: 1.45,
                  }}
                >
                  {t(feature.descKey)}
                </span>
              </span>
            </button>

            {/* Stacked layouts show the demo right under its feature; the
                side stage takes over from the two-column breakpoint up. */}
            <div className="landing-v2-fx-inline" data-open={on ? "true" : "false"} aria-hidden={!on}>
              <div className="landing-v2-fx-inline-panel" data-fx-still={on ? "false" : "true"}>
                {on ? <Panel active={on} /> : null}
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>

      <div className="landing-v2-fx-stage">
        {PANELS.map((Panel, i) => {
          const on = active === i;
          return (
            <div
              key={i}
              data-fx-still={on ? "false" : "true"}
              style={{
                position: on ? "relative" : "absolute",
                inset: on ? "auto" : 0,
                display: "grid",
                placeItems: "center",
                width: "100%",
                opacity: on ? 1 : 0,
                transform: `scale(var(--fx-scale, 1)) translateY(${on ? 0 : 8}px)`,
                pointerEvents: on ? "auto" : "none",
                transition: "opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              <Panel active={on} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
