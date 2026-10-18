"use client";

import { Caveat } from "next/font/google";
import type { CSSProperties } from "react";

import { Msym } from "@/components/msym";

/**
 * The notebook every paywall is drawn on — the wheel, its prize and the
 * minutes sheet as well: ruled paper, washi tape, a highlighter, a pen.
 *
 * These are the pieces they share. All of them are decoration except what the
 * caller passes in as text; the styles are the `.memo-nb-*` block in
 * `redesign.css`.
 */

/**
 * The handwriting. Only for annotations — a ticked item, a label on a card —
 * never for a price, a plan or a button, which stay in the system font.
 */
export const HAND_FONT = Caveat({ subsets: ["latin", "latin-ext"], weight: "700", variable: "--font-hand", display: "swap" });

/**
 * Fetch the handwriting ahead of the screen that uses it. A browser only
 * downloads a font once text first asks for it, so the wheel used to open in
 * the fallback face and change face a moment later.
 */
export function warmHandFont() {
  if (typeof document === "undefined") {
    return;
  }

  void document.fonts?.load(`700 1em ${HAND_FONT.style.fontFamily}`).catch(() => {});
}

/** Washi tape in one of the notebook's colours. */
export type TapeTone = "yellow" | "pink" | "mint" | "lilac";

export function Tape({ tone = "yellow", style }: { tone?: TapeTone; style?: CSSProperties }) {
  return (
    <span
      className="memo-nb-tape"
      aria-hidden="true"
      style={{ "--tape": `var(--nb-tape-${tone})`, ...style } as CSSProperties}
    />
  );
}

/** The spiral binding across the top of a page. Hidden in the app, under the status bar. */
export function NotebookSpiral() {
  return (
    <div className="memo-nb-spiral" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

/**
 * A headline with one phrase highlighted. The catalogue marks the phrase with
 * asterisks ("Make your *next note*") so each language picks its own words.
 */
export function Marked({ text }: { text: string }) {
  const parts = text.split("*");

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="memo-nb-hl">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** A tick drawn in pen, `delay` seconds after the screen opens. */
export function PenTick({ delay }: { delay: number }) {
  return (
    <svg className="memo-nb-pen" viewBox="0 0 20 20" aria-hidden="true" style={{ "--dl": `${delay}s`, "--dur": "0.35s" } as CSSProperties}>
      <path pathLength={1} d="M3 11 L 8 16 L 17 4" />
    </svg>
  );
}

/** What the plan adds, as a short handwritten list ticked off in turn. */
export function Checklist({ items, from = 1.3 }: { items: string[]; from?: number }) {
  return (
    <ul className="memo-nb-checks memo-nb-hand">
      {items.map((item, index) => (
        <li key={item}>
          <PenTick delay={from + index * 0.3} />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** The loop drawn round the chosen plan: one stroke, overlapping where it closes. */
export function PenCircle() {
  return (
    <svg className="memo-nb-circle memo-nb-pen" viewBox="0 0 200 160" preserveAspectRatio="none" aria-hidden="true">
      <path pathLength={1} d="M152 13 C 112 2, 52 4, 23 28 C 3 46, 2 112, 30 136 C 60 160, 146 159, 176 133 C 198 113, 200 54, 179 31 C 166 17, 140 9, 112 10" />
    </svg>
  );
}

/** The discount, on a coupon taped to the page. */
export function Ticket({ percent, off, note, tape = "mint" }: { percent: number; off: string; note: string; tape?: TapeTone }) {
  return (
    <div className="memo-nb-ticket-wrap">
      <Tape tone={tape} />
      <div className="memo-nb-ticket">
        <span className="memo-nb-ticket-num">−{percent}%</span>
        <span className="memo-nb-ticket-cut" aria-hidden="true" />
        <span className="memo-nb-ticket-off">
          <b>{off}</b>
          <span>{note}</span>
        </span>
      </div>
    </div>
  );
}

/** Today → the day the plan starts → cancelling, for a paywall that comes with the trial. */
export function TrialTimeline({ steps }: { steps: { icon: string; title: string; body: string }[] }) {
  return (
    <ol className="memo-nb-timeline">
      {steps.map((step) => (
        <li key={step.icon}>
          <Msym name={step.icon} size="1.05rem" fill={false} weight={600} />
          <b>{step.title}</b>
          <span>{step.body}</span>
        </li>
      ))}
    </ol>
  );
}
