"use client";

import Image from "next/image";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { Tape } from "@/components/paywall-notebook";
import type { PaywallReason } from "@/lib/paywall-reasons";
import { NOTE_TABS } from "@/lib/note-tabs";
import { PAYWALL_LADDER } from "@/lib/paywall-ladder";

/**
 * The top of a feature's paywall: the feature itself, drawn on the notebook
 * page and moving, in that feature's colour.
 *
 * A new note writes itself from a recording, a PDF and a photo; an old one is
 * locked until the padlock springs and the notes fan out; the chat answers; a
 * card is read out to Memo in headphones; the tutor waits for your turn; a
 * cassette plays the podcast; a flashcard flips; three subjects feed one
 * answer; the earlier offers are struck out one after another. Meeting the
 * paywall a second time does not look like meeting the same screen again.
 *
 * Everything here is decoration (`aria-hidden`): the headline under it says
 * what the screen is for, and `prefers-reduced-motion` stops the movement
 * globally. Positions are on a 24rem stage, in rem.
 */
const tint = (id: string) => NOTE_TABS.find((tab) => tab.id === id)?.tint ?? "var(--promo)";

const ACCENTS: Record<PaywallReason, string> = {
  note: tint("notes"),
  locked: "var(--nb-gold)",
  chat: tint("quiz"),
  listen: "var(--nb-violet)",
  tutor: tint("tutor"),
  podcast: tint("podcast"),
  regenerate: tint("flashcards"),
  library: "var(--nb-sky)",
  exam: tint("test"),
  offer: "var(--promo)",
};

/** The feature's colour, for the whole screen's wash as well as the scene. */
export function paywallAccentStyle(reason: PaywallReason | null): CSSProperties | undefined {
  return reason ? ({ "--paywall-accent": ACCENTS[reason] } as CSSProperties) : undefined;
}

/** A position on the stage: px from the design, in rem. */
function at(x: number, y: number, extra: CSSProperties = {}): CSSProperties {
  return { left: `${x / 16}rem`, top: `${y / 16}rem`, ...extra };
}

/** Memo, bobbing on his shadow. */
export function NotebookMemo({ style, wave = false }: { style?: CSSProperties; wave?: boolean }) {
  return (
    <span className={`memo-nb-memo ${wave ? "wave" : ""}`.trim()} style={style}>
      <Image src="/memo-mascot.png" alt="" width={320} height={288} />
    </span>
  );
}

function Icon({ name, color, className, style }: { name: string; color: string; className: string; style?: CSSProperties }) {
  return (
    <span className={`memo-nb-icon ${className}`} style={{ "--t": color, ...style } as CSSProperties}>
      <Msym name={name} size="1em" fill weight={600} />
    </span>
  );
}

function Pen({ width, height, viewBox, d, style, loop = false }: { width: number; height: number; viewBox: string; d: string[]; style?: CSSProperties; loop?: boolean }) {
  return (
    <svg className={`memo-nb-pen ${loop ? "loop" : ""}`.trim()} width={width} height={height} viewBox={viewBox} style={{ overflow: "visible", ...style }}>
      {d.map((path, index) => (
        <path key={index} pathLength={1} d={path} style={{ animationDelay: loop ? `${index * 0.25}s` : undefined }} />
      ))}
    </svg>
  );
}

function Bars({ count, style }: { count: number; style?: CSSProperties }) {
  return (
    <span className="memo-nb-wave" style={style}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} style={{ "--i": index } as CSSProperties} />
      ))}
    </span>
  );
}

const EQ_HEIGHTS = [0.5, 0.8, 0.6, 1, 0.7, 0.9, 0.55, 1, 0.75, 0.6, 0.9, 0.5, 0.8, 0.65, 0.95, 0.55, 0.8, 0.6, 0.9, 0.45];

/** How many earlier offers the browsing offer strikes out (at most three). */
function offerTagsShown(step: number) {
  return Math.min(PAYWALL_LADDER.filter((offer) => offer.step < step).length, 3);
}

/** Below Memo when it has the left side to itself, so a long language never runs into him. */
function offerNoteY(shown: number) {
  return shown >= 3 ? 196 : Math.max(30 + shown * 62, 158);
}

/**
 * Each scene's height, in rem. Shared with the paywall's skeleton
 * (`paywall-loading.tsx`), which holds exactly this much room so nothing under
 * the scene moves when the page arrives.
 */
export function paywallHeroHeight(reason: PaywallReason, step = 1): number {
  switch (reason) {
    case "note": return 14.75;
    case "locked": return 16.4;
    case "chat": return 13;
    case "listen": return 15.6;
    case "tutor": return 16.9;
    case "podcast": return 17.5;
    case "regenerate": return 16.4;
    case "library": return 13.4;
    case "exam": return 14.5;
    case "offer": {
      // As tall as the tags it holds: a second offer has one tag to strike,
      // not three, and must not leave the space of two empty.
      const shown = offerTagsShown(step);
      return shown >= 3 ? 14.75 : Math.max(10, (offerNoteY(shown) + 42) / 16);
    }
  }
}

export function PaywallHero({ reason, step = 1 }: { reason: PaywallReason; step?: number }) {
  const t = useT();
  let scene: ReactNode;
  const height = paywallHeroHeight(reason, step);

  switch (reason) {
    case "note":
      scene = (
        <>
          {[
            ["mic", tint("notes")],
            ["picture_as_pdf", tint("flashcards")],
            ["photo_camera", tint("test")],
          ].map(([icon, color], index) => (
            <Fragment key={icon}>
              <Icon name={icon} color={color} className="memo-nb-src" style={{ ...at(52, 6 + index * 52), "--i": index } as CSSProperties} />
              <span className="memo-nb-packet" style={{ ...at(70, 24 + index * 52), "--t": color, "--i": index, "--dx": "82px", "--dy": `${66 - index * 52}px` } as CSSProperties} />
            </Fragment>
          ))}
          {/* The leaf follows the word, however long the language makes it. */}
          <span className="memo-nb-doodled" style={at(134, 62)}>
            <span className="memo-nb-write-title memo-nb-hand">{t("paywall.scene.subject")}</span>
            <Pen width={30} height={30} viewBox="0 0 44 44" loop d={["M8 36 C 10 16, 24 6, 38 6 C 38 22, 28 34, 8 36 Z M8 36 L 26 18"]} style={{ marginTop: "-0.55rem", "--nb-pen": tint("test"), "--cyc": "6s", "--dl": "0.4s" } as CSSProperties} />
          </span>
          <span className="memo-nb-bar" style={{ ...at(134, 120), width: "13rem", "--i": 0 } as CSSProperties} />
          <span className="memo-nb-bar mark" style={{ ...at(134, 148), width: "7.5rem", "--i": 1 } as CSSProperties} />
          <span className="memo-nb-bar" style={{ ...at(262, 150), width: "5rem", "--i": 2 } as CSSProperties} />
          <span className="memo-nb-bar ink" style={{ ...at(134, 178), width: "10.6rem", "--i": 3 } as CSSProperties} />
          {[
            ["style", tint("flashcards")],
            ["quiz", tint("quiz")],
            ["school", tint("tutor")],
          ].map(([icon, color], index) => (
            <Icon key={icon} name={icon} color={color} className="memo-nb-out" style={{ ...at(196 + index * 54, 190), "--i": index } as CSSProperties} />
          ))}
          <NotebookMemo style={{ ...at(36, 164), width: "5.25rem" }} />
        </>
      );
      break;

    case "locked":
      scene = (
        <>
          <span className="memo-nb-halo" />
          {[
            ["description", tint("notes"), "-8deg", "-30deg", "-96px", "8px"],
            ["school", tint("tutor"), "8deg", "30deg", "96px", "8px"],
            ["style", tint("flashcards"), "-3deg", "-11deg", "-36px", "-16px"],
            ["quiz", tint("quiz"), "3deg", "11deg", "36px", "-16px"],
          ].map(([icon, color, r0, r1, x1, y1]) => (
            <span key={icon} className="memo-nb-lockcard" style={{ "--t": color, "--r0": r0, "--r1": r1, "--x1": x1, "--y1": y1 } as CSSProperties}>
              <Icon name={icon} color={color} className="" />
              <span className="memo-nb-line tinted" style={{ width: "78%" }} />
              <span className="memo-nb-line" />
              <span className="memo-nb-line" style={{ width: "64%" }} />
              <span className="memo-nb-line" style={{ width: "86%" }} />
            </span>
          ))}
          <span className="memo-nb-burst" style={{ top: "11rem", "--cyc": "5s" } as CSSProperties}>
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, index) => (
              <i key={angle} style={{ "--a": `${angle}deg`, "--c": index % 2 ? "var(--promo)" : "var(--nb-gold)" } as CSSProperties} />
            ))}
          </span>
          {/* 30 units of empty sky above the shackle: WebKit paints a filtered
              svg only a few pixels past its own box, so the shackle springing
              open used to lose its top in Safari and the app. */}
          <svg className="memo-nb-lock" viewBox="0 -30 118 170">
            <defs>
              <linearGradient id="memo-nb-lock-body" x1="0" y1="0" x2="0.35" y2="1">
                <stop offset="0" stopColor="var(--nb-gold-light)" />
                <stop offset="0.45" stopColor="var(--nb-gold)" />
                <stop offset="1" stopColor="var(--nb-gold-deep)" />
              </linearGradient>
              <linearGradient id="memo-nb-lock-steel" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--nb-steel)" />
                <stop offset="0.35" stopColor="var(--nb-steel-light)" />
                <stop offset="1" stopColor="var(--nb-steel)" />
              </linearGradient>
            </defs>
            <g className="memo-nb-shackle">
              <path d="M32 72 V44 a27 27 0 0 1 54 0 V72" fill="none" stroke="url(#memo-nb-lock-steel)" strokeWidth={13} strokeLinecap="round" />
            </g>
            <rect x={8} y={62} width={102} height={74} rx={22} fill="url(#memo-nb-lock-body)" />
            <rect x={14} y={68} width={90} height={62} rx={17} fill="none" stroke="var(--nb-gold-light)" strokeWidth={1.5} />
            <circle className="memo-nb-keyhole" cx={59} cy={95} r={10} />
            <path className="memo-nb-keyhole" d="M54 101 h10 l3 20 h-16 z" />
          </svg>
        </>
      );
      break;

    case "chat":
      scene = (
        <>
          <Pen width={52} height={60} viewBox="0 0 52 60" loop d={["M26 6 C 12 6, 6 18, 10 28 C 13 35, 19 37, 19 44 L 33 44 C 33 37, 39 35, 42 28 C 46 18, 40 6, 26 6 Z M20 50 L 32 50 M22 55 L 30 55"]} style={{ ...at(28, 4), "--nb-pen": "var(--nb-gold)", "--cyc": "6s" } as CSSProperties} />
          <span className="memo-nb-bubble mine">{t("paywall.demo.chatQuestion")}</span>
          <span className="memo-nb-typing">
            <span style={{ "--i": 0 } as CSSProperties} />
            <span style={{ "--i": 1 } as CSSProperties} />
            <span style={{ "--i": 2 } as CSSProperties} />
          </span>
          <span className="memo-nb-bubble theirs">{t("paywall.demo.chatAnswer")}</span>
          <Pen width={30} height={40} viewBox="0 0 30 40" loop d={["M6 12 C 6 4, 24 2, 24 12 C 24 20, 14 20, 14 28 M14 35 L 14 36"]} style={{ ...at(330, 150), "--cyc": "6s", "--nb-pen": "var(--paywall-accent)" } as CSSProperties} />
          <NotebookMemo style={{ ...at(18, 110), width: "5.75rem" }} />
        </>
      );
      break;

    case "listen":
      scene = (
        <>
          <span className="memo-nb-readcard">
            <Tape style={{ left: "50%", top: "-0.6rem", translate: "-50% 0", rotate: "3deg", width: "4rem" }} />
            <span className="memo-nb-hand">{t("paywall.scene.subject")}</span>
            {[100, 86, 100, 72, 90].map((width, index) => (
              <span key={index} className="memo-nb-readline" style={{ width: `${width}%`, "--i": index } as CSSProperties} />
            ))}
          </span>
          <Pen width={60} height={90} viewBox="0 0 60 90" loop d={["M6 30 C 14 38, 14 52, 6 60", "M20 20 C 34 34, 34 56, 20 70", "M34 10 C 54 30, 54 60, 34 80"]} style={{ ...at(244, 66), "--cyc": "2.4s", "--nb-pen": "var(--paywall-accent)" } as CSSProperties} />
          <NotebookMemo style={{ ...at(268, 100), width: "6.5rem" }} />
          <Icon name="headphones" color="var(--paywall-accent)" className="memo-nb-badge-round" style={at(330, 208)} />
        </>
      );
      break;

    case "tutor":
      scene = (
        <>
          <NotebookMemo style={{ ...at(34, 92), width: "9rem" }} />
          <Icon name="school" color="var(--paywall-accent)" className="memo-nb-badge-round" style={{ ...at(4, 70), width: "3rem", height: "3rem" }} />
          <Pen width={196} height={136} viewBox="0 0 196 136" loop d={["M24 10 C 70 0, 160 2, 182 16 C 196 28, 194 86, 180 98 C 156 112, 96 112, 66 108 L 22 132 L 42 104 C 14 100, 4 86, 6 56 C 6 28, 12 14, 24 10 Z"]} style={{ ...at(182, 48), "--nb-pen": "var(--text)", "--cyc": "6s" } as CSSProperties} />
          <Bars count={15} style={at(214, 80)} />
          <span className="memo-nb-ring" style={{ ...at(287, 187), "--i": 0 } as CSSProperties} />
          <span className="memo-nb-ring" style={{ ...at(287, 187), "--i": 1 } as CSSProperties} />
          <span className="memo-nb-mic" style={{ ...at(287, 187), display: "grid", placeItems: "center" }}>
            <Msym name="mic" size="1.9rem" fill weight={600} />
          </span>
          {/* Pinned by its right end, so the arrow always points into the mic
              and a longer language grows to the left. */}
          <span className="memo-nb-doodled" style={{ right: "6.4rem", top: "12.5rem" }}>
            <span className="memo-nb-hand" style={{ fontSize: "1.85rem", color: "var(--promo)", rotate: "-7deg" }}>{t("paywall.scene.yourTurn")}</span>
            <Pen width={40} height={30} viewBox="0 0 40 30" d={["M2 6 C 12 22, 24 24, 36 18 M28 14 L 37 18 L 31 26"]} style={{ marginTop: "0.9rem", "--dl": "1.6s" } as CSSProperties} />
          </span>
        </>
      );
      break;

    case "podcast":
      scene = (
        <>
          {[[316, 110], [330, 164], [40, 30]].map(([x, y], index) => (
            <span key={index} className="memo-nb-note-glyph" style={{ ...at(x, y), "--i": index } as CSSProperties}>
              <Msym name="music_note" size="1em" fill weight={600} />
            </span>
          ))}
          <span className="memo-nb-cassette">
            <span className="memo-nb-cassette-label memo-nb-hand">{t("paywall.scene.episode")}</span>
            <span className="memo-nb-cassette-window">
              <span className="memo-nb-reel" />
              <span className="memo-nb-band" />
              <span className="memo-nb-reel" />
            </span>
            <Tape style={{ left: "-1.1rem", top: "-0.4rem", rotate: "-32deg", width: "3.6rem" }} />
          </span>
          <NotebookMemo style={{ ...at(12, 168), width: "6.5rem" }} />
          <Icon name="headphones" color="var(--paywall-accent)" className="memo-nb-badge-round" style={at(84, 166)} />
          <span className="memo-nb-eq" style={at(140, 214)}>
            {EQ_HEIGHTS.map((h, index) => (
              <span key={index} style={{ "--i": index, "--h": h } as CSSProperties} />
            ))}
          </span>
        </>
      );
      break;

    case "regenerate":
      scene = (
        <>
          <span className="memo-nb-index" style={{ top: "2.9rem", transform: "rotate(-9deg) translate(-18px, 8px)" }} />
          <span className="memo-nb-index" style={{ top: "2.6rem", transform: "rotate(6deg) translate(16px, 4px)" }} />
          <span className="memo-nb-index flip" style={{ top: "2.25rem" }}>
            <span className="memo-nb-face front memo-nb-hand">{t("paywall.scene.flashFront")}</span>
            <span className="memo-nb-face back">{t("paywall.scene.flashBack")}</span>
          </span>
          <Icon name="autorenew" color="var(--paywall-accent)" className="memo-nb-renew" style={at(252, 6)} />
          {[
            ["account_tree", tint("tutor")],
            ["assignment", tint("test")],
            ["quiz", tint("quiz")],
          ].map(([icon, color], index) => (
            <Icon
              key={icon}
              name={icon}
              color={color}
              className="memo-nb-out"
              style={{ ...at(132 + index * 54, index === 1 ? 206 : 200), opacity: 1, animation: `memo-nb-pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) both ${0.8 + index * 0.15}s, memo-nb-float 4s ease-in-out infinite ${-index * 1.3}s` }}
            />
          ))}
          <NotebookMemo style={{ ...at(18, 150), width: "6rem" }} />
        </>
      );
      break;

    case "library":
      scene = (
        <>
          {[
            ["paywall.scene.biology", "var(--nb-note-yellow)", "lilac", 16, 8, "-6deg"],
            ["paywall.scene.history", "var(--nb-note-pink)", "yellow", 128, 2, "3deg"],
            ["paywall.scene.chemistry", "var(--nb-note-mint)", "pink", 236, 58, "-3deg"],
          ].map(([key, note, tape, x, y, rotate], index) => (
            <span key={key as string} className="memo-nb-subject" style={{ ...at(x as number, y as number), "--note": note, rotate, "--d": index } as CSSProperties}>
              <Tape tone={tape as "lilac" | "yellow" | "pink"} />
              <span className="memo-nb-hand">{t(key as "paywall.scene.biology")}</span>
              <i />
              <i style={{ width: "60%" }} />
            </span>
          ))}
          <Pen
            width={390}
            height={70}
            viewBox="0 0 390 70"
            loop
            d={["M70 4 C 84 34, 140 44, 178 62 M172 52 L 180 63 L 167 66", "M182 4 C 186 24, 192 40, 195 60 M188 50 L 195 62 L 202 50", "M288 52 C 272 58, 240 58, 212 62 M224 52 L 211 63 L 224 67"]}
            style={{ ...at(0, 84), "--nb-pen": "color-mix(in oklch, var(--text) 55%, transparent)", "--cyc": "5s" } as CSSProperties}
          />
          <span className="memo-nb-answer">
            <Image src="/memo-mascot.png" alt="" width={320} height={288} />
            <span style={{ display: "grid", gap: "0.5rem", flex: 1 }}>
              <span className="memo-nb-bar" style={{ width: "100%", "--i": 0 } as CSSProperties} />
              <span className="memo-nb-bar" style={{ width: "78%", "--i": 1 } as CSSProperties} />
            </span>
            {["var(--nb-gold)", "var(--nb-tape-pink)", "var(--nb-good)"].map((color, index) => (
              <b key={color} className="memo-nb-cite" style={{ "--c": color, "--i": index } as CSSProperties} />
            ))}
          </span>
        </>
      );
      break;

    case "exam":
      // A week on a calendar page: the study days ticked off in turn, the
      // exam day circled in pen.
      scene = (
        <>
          <span className="memo-nb-cal" style={at(92, 10)}>
            <Tape tone="pink" />
            <span className="memo-nb-cal-head" />
            {[12, 13, 14, 15, 16, 17, 18, 19].map((day, index) => (
              <span key={day} className={`memo-nb-cal-day ${index < 6 ? "done" : index === 6 ? "exam" : ""}`.trim()}>
                {day}
                {index < 6 ? (
                  <svg className="memo-nb-pen" viewBox="0 0 20 20" style={{ "--dl": `${0.6 + index * 0.28}s`, "--dur": "0.3s", "--nb-pen": "var(--nb-good)" } as CSSProperties}>
                    <path pathLength={1} d="M3 11 L 8 16 L 17 4" />
                  </svg>
                ) : null}
                {index === 6 ? (
                  <svg className="memo-nb-pen memo-nb-cal-ring" viewBox="0 0 200 160" preserveAspectRatio="none" style={{ "--dl": "2.4s", "--dur": "0.7s" } as CSSProperties}>
                    <path pathLength={1} d="M152 13 C 112 2, 52 4, 23 28 C 3 46, 2 112, 30 136 C 60 160, 146 159, 176 133 C 198 113, 200 54, 179 31 C 166 17, 140 9, 112 10" />
                  </svg>
                ) : null}
              </span>
            ))}
          </span>
          <Icon name="flag" color="var(--promo)" className="memo-nb-cal-flag" style={at(300, 150)} />
          <span className="memo-nb-cal-note memo-nb-hand" style={at(214, 196)}>{t("paywall.scene.examDay")}</span>
          <NotebookMemo wave style={{ ...at(6, 128), width: "5.8rem" }} />
        </>
      );
      break;

    case "offer": {
      // The prices this learner was offered before, crossed out in turn, each
      // a little lower than the one before it: what makes the browsing offer
      // read as "better than last time" without saying the new price twice.
      const earlier = PAYWALL_LADDER.filter((offer) => offer.step < step);
      const spots: [number, number, string, "mint" | "yellow" | "pink"][] = [
        [30, 12, "-7deg", "mint"],
        [134, 86, "5deg", "yellow"],
        [240, 154, "-4deg", "pink"],
      ];
      const shown = offerTagsShown(step);
      const noteY = offerNoteY(shown);
      scene = (
        <>
          {earlier.slice(0, spots.length).map((offer, index) => {
            const [x, y, rotate, tape] = spots[index];
            return (
              <span key={offer.step} className="memo-nb-tag" style={{ ...at(x, y), rotate, "--i": index } as CSSProperties}>
                <Tape tone={tape} />
                <span>
                  {offer.percentOff ? `−${offer.percentOff}%` : t("paywall.demo.fullPrice")}
                  <svg className="memo-nb-pen" viewBox="0 0 100 12" preserveAspectRatio="none" style={{ "--dl": `${0.7 + index * 0.35}s`, "--dur": "0.3s" } as CSSProperties}>
                    <path pathLength={1} d="M2 9 C 30 7, 68 5, 98 3" />
                  </svg>
                </span>
              </span>
            );
          })}
          <NotebookMemo wave style={{ ...at(286, 60), width: "6.5rem" }} />
          <span className="memo-nb-spark" style={{ ...at(232, 6), "--d": 0 } as CSSProperties} />
          <span className="memo-nb-spark" style={{ ...at(250, 50), "--d": 2 } as CSSProperties} />
          <span className="memo-nb-hand" style={{ ...at(26, noteY), fontSize: shown >= 3 ? "1.5rem" : "1.85rem", color: "var(--promo)", rotate: "-6deg", animation: "memo-nb-pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) both 2s" }}>{t("paywall.scene.bestPrice")}</span>
        </>
      );
      break;
    }
  }

  return (
    <div className={`memo-nb-hero ${reason}`} style={{ height: `${height}rem`, ...paywallAccentStyle(reason) }} aria-hidden="true">
      {scene}
    </div>
  );
}

/**
 * The plain paywall's top (after onboarding, the Upgrade button): a taped
 * stack of index cards dealing out what the plan includes, one every couple of
 * seconds, with Memo peeking over the corner.
 */
export function PaywallDeck() {
  const t = useT();
  const cards: [string, string, "paywall.deck.notes" | "paywall.deck.flashcards" | "paywall.deck.quizzes" | "paywall.deck.tutor"][] = [
    ["description", tint("notes"), "paywall.deck.notes"],
    ["style", tint("flashcards"), "paywall.deck.flashcards"],
    ["quiz", tint("quiz"), "paywall.deck.quizzes"],
    ["school", tint("tutor"), "paywall.deck.tutor"],
  ];

  return (
    <div className="memo-nb-deck" aria-hidden="true">
      <Pen width={36} height={36} viewBox="0 0 34 34" loop d={["M17 2 L 20 13 L 32 14 L 22 21 L 26 32 L 17 25 L 8 32 L 12 21 L 2 14 L 14 13 Z"]} style={{ ...at(24, 18), "--nb-pen": "var(--nb-gold)", "--cyc": "5s" } as CSSProperties} />
      <div className="memo-nb-deck-stage">
        <div className="memo-nb-card base" style={{ "--r": "-7deg", "--x": "-10px", "--y": "8px" } as CSSProperties} />
        <div className="memo-nb-card base" style={{ "--r": "5deg", "--x": "10px", "--y": "4px" } as CSSProperties} />
        {cards.map(([icon, color, key], index) => (
          <div key={key} className="memo-nb-card deal" style={{ "--i": index } as CSSProperties}>
            <Icon name={icon} color={color} className="" />
            <span className="memo-nb-hand">{t(key)}</span>
          </div>
        ))}
        <Tape />
      </div>
      <NotebookMemo />
      <div className="memo-nb-dots">
        {cards.map(([, , key], index) => (
          <span key={key} style={{ "--i": index } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
