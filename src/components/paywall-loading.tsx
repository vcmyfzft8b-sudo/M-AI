"use client";

import type { CSSProperties, ReactNode } from "react";

import { useT } from "@/components/i18n-provider";
import { HAND_FONT, NotebookSpiral, Tape, Ticket } from "@/components/paywall-notebook";
import { paywallAccentStyle, paywallHeroHeight } from "@/components/paywall-hero";
import { PlanSkeleton } from "@/components/paywall-plan-skeleton";
import { PAYWALL_CHECKLISTS, paywallTitleKey } from "@/lib/paywall-copy";
import type { PaywallReason } from "@/lib/paywall-reasons";

/**
 * A paywall while it loads: the notebook page itself, with pills where the
 * words go.
 *
 * Built from the paywall's own classes — the paper, the spiral, the close
 * row, the coupon, the two sticky-note plans, the coral button — so every part
 * lands where the real one will and nothing moves when it arrives. Before this
 * the route fell back to the home screen's skeleton, so a tap on a locked
 * feature flashed a list of notes before the paywall.
 *
 * Each paywall has its own: the scene at the top is that paywall's scene
 * (`paywall-hero.tsx`) as flat shapes in the same places and at the same
 * height — the lock and the fanned notes, the cassette, the calendar — and a
 * feature's paywall is washed in that feature's colour. The headline, the
 * checklist and the coupon are the real words set in the page's ink, so they
 * wrap exactly as the page will in every language.
 */
export function PaywallLoading({ reason = null }: { reason?: PaywallReason | null }) {
  const t = useT();

  return (
    <main className="app-start-shell" data-route-skeleton="" aria-busy="true">
      <section
        className={`app-start-panel app-start-panel-paywall memo-paywall-shell memo-nb-paper memo-nb-skeleton ${HAND_FONT.variable}`}
        data-reason={reason ?? undefined}
        style={paywallAccentStyle(reason)}
        aria-hidden="true"
      >
        <NotebookSpiral />
        <div className="app-start-dismiss-row">
          <span className="memo-close-button app-start-close-button" />
        </div>

        {reason ? <SceneSkeleton reason={reason} /> : <DeckSkeleton />}

        {/* A feature's paywall carries the ladder's coupon on the web; the
            app sells at Apple's prices and has none (hidden by `data-native`).
            Which rung is not known yet; every rung's number is as wide. */}
        {reason ? (
          <div className="memo-nb-skel-ticket memo-nb-ghost-text">
            <Ticket percent={30} off={t("paywall.offer.off")} note={t("paywall.offer.firstPayment")} />
          </div>
        ) : null}

        <h1 className="memo-nb-title memo-nb-ghost-text">
          <span>{t(paywallTitleKey(reason, true)).replaceAll("*", "")}</span>
        </h1>

        <ul className="memo-nb-checks memo-nb-hand memo-nb-ghost-text">
          {PAYWALL_CHECKLISTS[reason ?? "plain"].map((key) => (
            <li key={key}>
              <span className="memo-nb-skel-tick" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>

        <div className="memo-nb-plans">
          <PlanSkeleton index={0} discounted={reason !== null} />
          <PlanSkeleton index={1} discounted={reason !== null} />
        </div>

        {/* The plain paywall carries the trial's timeline; a feature's, one line. */}
        {reason ? (
          <span className="memo-nb-skel-due app-loading-pill" />
        ) : (
          <div className="memo-nb-skel-timeline">
            {[0, 1, 2].map((index) => (
              <span key={index}>
                <span className="app-loading-pill memo-nb-skel-dot" />
                <span className="app-loading-pill" style={{ width: "3.2rem" }} />
                <span className="app-loading-pill" style={{ width: "4.2rem", height: "0.6rem" }} />
              </span>
            ))}
          </div>
        )}

        <span className="memo-paywall-cta memo-nb-skel-cta" />
      </section>
    </main>
  );
}

/** px on the 24rem stage, as the scenes are drawn (`paywall-hero.tsx`). */
const rem = (px: number) => `${px / 16}rem`;

type Box = { x?: number; y?: number; w: number; h: number; r?: number; rotate?: string; style?: CSSProperties };

function boxStyle({ x, y, w, h, r = 999, rotate, style }: Box): CSSProperties {
  return {
    ...(x === undefined ? {} : { left: rem(x) }),
    ...(y === undefined ? {} : { top: rem(y) }),
    width: rem(w),
    height: rem(h),
    borderRadius: r >= 999 ? 999 : rem(r),
    rotate,
    ...style,
  };
}

/** A flat shape where a part of the scene goes. */
function Ghost(props: Box) {
  return <span className="app-loading-pill memo-nb-ghost" style={boxStyle(props)} />;
}

/** Memo's place: he is 320 × 288. */
function GhostMemo({ x, y, w }: { x: number; y: number; w: number }) {
  return <Ghost x={x} y={y} w={w} h={Math.round(w * 0.9)} />;
}

/** A sheet of paper with lines on it: an index card, a note, the read-aloud card. */
function GhostPaper({ lines = [70, 90, 55], children, tape = true, ...box }: Box & { lines?: number[]; children?: ReactNode; tape?: boolean }) {
  return (
    <span className="memo-nb-ghost-paper" style={boxStyle({ r: 12, ...box })}>
      {tape ? <Tape /> : null}
      {children}
      {lines.map((width, index) => (
        <span key={index} className="app-loading-pill" style={{ width: `${width}%` }} />
      ))}
    </span>
  );
}

/** A feature's scene, as shapes: the same places, the same height. */
function SceneSkeleton({ reason }: { reason: PaywallReason }) {
  let scene: ReactNode;

  switch (reason) {
    case "note":
      scene = (
        <>
          {[0, 1, 2].map((index) => <Ghost key={index} x={52} y={6 + index * 52} w={46} h={46} r={16} />)}
          <Ghost x={134} y={64} w={190} h={30} r={10} />
          <Ghost x={134} y={120} w={208} h={9} />
          <Ghost x={134} y={148} w={120} h={12} />
          <Ghost x={262} y={150} w={80} h={9} />
          <Ghost x={134} y={178} w={170} h={9} />
          {[0, 1, 2].map((index) => <Ghost key={index} x={196 + index * 54} y={190} w={44} h={44} r={15} />)}
          <GhostMemo x={36} y={164} w={84} />
        </>
      );
      break;

    case "locked":
      // The four notes fanned out round the lock, the lock in front.
      scene = (
        <>
          {[
            ["-30deg", "-96px", "8px"],
            ["30deg", "96px", "8px"],
            ["-11deg", "-36px", "-16px"],
            ["11deg", "36px", "-16px"],
          ].map(([r1, x1, y1]) => (
            <span key={r1} className="app-loading-pill memo-nb-ghost memo-nb-skel-lockcard" style={{ transform: `rotate(${r1}) translate(${x1}, ${y1})` }} />
          ))}
          <span className="memo-nb-skel-shackle" />
          <span className="memo-nb-skel-lockbody" />
        </>
      );
      break;

    case "chat":
      scene = (
        <>
          <Ghost x={32} y={8} w={42} h={50} r={20} />
          <Ghost w={150} h={42} r={18} style={{ right: "4.2rem", top: "1.1rem" }} />
          <Ghost w={184} h={64} r={18} style={{ left: "7rem", top: "4.9rem" }} />
          <GhostMemo x={18} y={110} w={92} />
        </>
      );
      break;

    case "listen":
      scene = (
        <>
          <GhostPaper w={224} h={186} rotate="-3deg" lines={[60, 100, 86, 100, 72]} style={{ left: "1.4rem", top: "1.4rem", padding: "1.5rem 1.1rem 0.9rem" }} />
          <GhostMemo x={268} y={100} w={104} />
          <Ghost x={330} y={208} w={43} h={43} />
        </>
      );
      break;

    case "tutor":
      scene = (
        <>
          <GhostMemo x={34} y={92} w={144} />
          <Ghost x={4} y={70} w={48} h={48} />
          <Ghost x={182} y={48} w={196} h={112} r={28} />
          <Ghost x={287} y={187} w={62} h={62} />
          <Ghost w={120} h={24} rotate="-7deg" style={{ right: "6.4rem", top: "12.9rem" }} />
        </>
      );
      break;

    case "podcast":
      scene = (
        <>
          <Ghost w={250} h={160} r={18} rotate="-4deg" style={{ left: "3.6rem", top: "2.3rem" }} />
          <GhostMemo x={12} y={168} w={104} />
          <Ghost x={84} y={166} w={43} h={43} />
          <Ghost x={140} y={222} w={176} h={40} r={8} />
        </>
      );
      break;

    case "regenerate":
      scene = (
        <>
          <GhostPaper tape={false} lines={[]} w={200} h={128} style={{ left: "50%", marginLeft: "-6.25rem", top: "2.9rem", transform: "rotate(-9deg) translate(-18px, 8px)" }} />
          <GhostPaper tape={false} lines={[]} w={200} h={128} style={{ left: "50%", marginLeft: "-6.25rem", top: "2.6rem", transform: "rotate(6deg) translate(16px, 4px)" }} />
          <GhostPaper tape={false} lines={[64]} w={200} h={128} style={{ left: "50%", marginLeft: "-6.25rem", top: "2.25rem", paddingTop: "3rem", justifyItems: "center" }} />
          <Ghost x={252} y={6} w={46} h={46} />
          {[0, 1, 2].map((index) => <Ghost key={index} x={132 + index * 54} y={index === 1 ? 206 : 200} w={44} h={44} r={15} />)}
          <GhostMemo x={18} y={150} w={96} />
        </>
      );
      break;

    case "library":
      scene = (
        <>
          {[
            [16, 8, "-6deg"],
            [128, 2, "3deg"],
            [236, 58, "-3deg"],
          ].map(([x, y, rotate]) => (
            <GhostPaper key={x} x={x as number} y={y as number} w={104} h={76} r={12} rotate={rotate as string} lines={[80, 100, 60]} style={{ padding: "0.9rem 0.75rem 0.6rem" }} />
          ))}
          <Ghost w={288} h={62} r={20} style={{ left: "3.1rem", top: "9.4rem" }} />
        </>
      );
      break;

    case "exam":
      scene = (
        <>
          <span className="memo-nb-ghost-paper memo-nb-skel-cal" style={{ left: rem(92), top: rem(10) }}>
            <Tape tone="pink" />
            <span className="memo-nb-skel-cal-head" />
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} className="app-loading-pill" />
            ))}
          </span>
          <Ghost x={300} y={150} w={42} h={42} />
          <Ghost x={214} y={200} w={100} h={22} rotate="-6deg" />
          <GhostMemo x={6} y={128} w={93} />
        </>
      );
      break;

    case "offer":
      // The browsing offer most often strikes out one or two earlier prices.
      scene = (
        <>
          <GhostPaper x={30} y={12} w={124} h={52} rotate="-7deg" lines={[80]} style={{ padding: "1.15rem 1.15rem 0.7rem" }} />
          <GhostPaper x={134} y={86} w={104} h={52} rotate="5deg" lines={[80]} style={{ padding: "1.15rem 1.15rem 0.7rem" }} />
          <GhostMemo x={286} y={60} w={104} />
          <Ghost x={26} y={164} w={180} h={26} rotate="-6deg" />
        </>
      );
      break;
  }

  return (
    <div className="memo-nb-hero memo-nb-skel-hero" style={{ height: `${paywallHeroHeight(reason, 3)}rem` }}>
      {scene}
    </div>
  );
}

/** The plain paywall's deck of index cards, Memo peeking over its corner. */
function DeckSkeleton() {
  return (
    <div className="memo-nb-deck memo-nb-skel-hero">
      <div className="memo-nb-deck-stage">
        <div className="memo-nb-card base" style={{ "--r": "-7deg", "--x": "-10px", "--y": "8px" } as CSSProperties} />
        <div className="memo-nb-card base" style={{ "--r": "5deg", "--x": "10px", "--y": "4px" } as CSSProperties} />
        <div className="memo-nb-card memo-nb-skel-deal">
          <span className="app-loading-pill memo-nb-skel-deal-icon" />
          <span className="memo-nb-skel-deal-text">
            <span className="app-loading-pill" style={{ width: "90%" }} />
            <span className="app-loading-pill" style={{ width: "60%" }} />
          </span>
        </div>
        <Tape />
      </div>
      <span className="app-loading-pill memo-nb-ghost memo-nb-skel-deck-memo" />
    </div>
  );
}
