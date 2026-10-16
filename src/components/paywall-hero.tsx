"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MascotFigure, MascotSparkles, useMascot } from "@/components/onboarding-mascot";
import type { PaywallReason } from "@/lib/paywall-reasons";
import { NOTE_TABS } from "@/lib/note-tabs";
import { PAYWALL_LADDER } from "@/lib/paywall-ladder";

/**
 * The top of a feature's paywall: Memo, doing the thing the learner just ran
 * out of, in that feature's colour.
 *
 * Every feature has its own scene and its own move — he talks on the chat
 * paywall, grooves in headphones on the read-aloud one, nods in a mortarboard
 * beside the tutor's orb, peeks out from behind a locked note — so meeting the
 * paywall a second time does not look like meeting the same screen again. The
 * layout of the plans below changes with it (`paywallLayout`).
 *
 * Memo is the onboarding's own figure (`onboarding-mascot.tsx`), so he blinks
 * the same way. Everything here is decoration (`aria-hidden`); the headline
 * under it says what the screen is for, and `prefers-reduced-motion` stops the
 * movement globally.
 */
const tint = (id: string) => NOTE_TABS.find((tab) => tab.id === id)?.tint;

const SCENES: Record<PaywallReason, { accent?: string; layout: PaywallLayout }> = {
  chat: { accent: tint("quiz"), layout: "cards" },
  listen: { accent: tint("speed"), layout: "rows" },
  tutor: { accent: tint("tutor"), layout: "spotlight" },
  podcast: { accent: tint("podcast"), layout: "rows" },
  note: { accent: tint("notes"), layout: "cards" },
  locked: { accent: tint("palace"), layout: "cards" },
  regenerate: { accent: tint("flashcards"), layout: "cards" },
  library: { accent: tint("mindmap"), layout: "spotlight" },
  exam: { accent: tint("test"), layout: "spotlight" },
  offer: { layout: "cards" },
};

export type PaywallLayout = "cards" | "rows" | "spotlight";

/** How the plans are laid out under this feature's scene. */
export function paywallLayout(reason: PaywallReason | null): PaywallLayout {
  return reason ? SCENES[reason].layout : "cards";
}

/** The feature's colour, for the whole screen's wash as well as the scene. */
export function paywallAccentStyle(reason: PaywallReason | null): CSSProperties | undefined {
  const accent = reason ? SCENES[reason].accent : undefined;
  return accent ? ({ "--paywall-accent": accent } as CSSProperties) : undefined;
}

function Wave({ bars = 9 }: { bars?: number }) {
  return (
    <span className="memo-pw-wave">
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} style={{ "--i": index } as CSSProperties} />
      ))}
    </span>
  );
}

function NoteCard({ icon, className = "" }: { icon: string; className?: string }) {
  return (
    <span className={`memo-pw-note ${className}`.trim()}>
      <span className="memo-pw-note-icon">
        <Msym name={icon} size="1.1rem" fill={false} weight={500} />
      </span>
      <span className="memo-pw-note-lines">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

/** Memo, blinking, with the feature's icon pinned to his shoulder. */
export function PaywallMascot({ move, badge }: { move: string; badge?: string }) {
  return <Memo move={move} badge={badge} />;
}

function Memo({ move, badge }: { move: string; badge?: string }) {
  const root = useRef<HTMLSpanElement | null>(null);
  // Read once; it only decides whether he blinks, never what is drawn.
  const [calm] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false),
  );

  // Only for the blinking: he blinks on his own while he is on screen.
  useMascot({ accent: "var(--paywall-accent)", calm, scope: () => root.current });

  return (
    <span ref={root} className={`memo-pw-memo ${move}`}>
      <span className="memo-pw-memo-body">
        {/* The largest thing on the screen as it opens: loaded first. */}
        <MascotFigure priority />
      </span>
      {badge ? (
        <span className="memo-pw-tag">
          <Msym name={badge} size="1.15rem" fill={false} weight={600} />
        </span>
      ) : null}
    </span>
  );
}

/** A voice, speaking: a bubble with a moving wave in it. */
function Voice({ bars = 11, play = false }: { bars?: number; play?: boolean }) {
  return (
    <span className="memo-pw-voice">
      {play ? (
        <span className="memo-pw-play">
          <Msym name="play_arrow" size="1.2rem" fill weight={600} />
        </span>
      ) : null}
      <Wave bars={bars} />
    </span>
  );
}

/**
 * Free next to the subscription, line by line, with the real limits — the
 * library paywall's whole argument, since asking across notes only means
 * something once there is more than the one free note.
 */
export function PaywallCompare() {
  const t = useT();
  const rows = [
    ["paywall.compare.notes", "paywall.compare.notesFree", "paywall.compare.notesPlan"],
    ["paywall.compare.chat", "paywall.compare.chatFree", "paywall.compare.chatPlan"],
    ["paywall.compare.listen", "paywall.compare.listenFree", "paywall.compare.listenPlan"],
    ["paywall.compare.tutor", "paywall.compare.tutorFree", "paywall.compare.tutorPlan"],
  ] as const;

  return (
    <table className="memo-pw-compare">
      <thead>
        <tr>
          <th />
          <th scope="col">{t("paywall.compare.free")}</th>
          <th scope="col" className="plan">{t("paywall.compare.plan")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, free, plan]) => (
          <tr key={label}>
            <th scope="row">{t(label)}</th>
            <td>{t(free)}</td>
            <td className="plan">{t(plan)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The prices this learner was offered before, crossed out, each a little lower
 * than the one before it: what makes the browsing offer read as "better than
 * last time" without saying the new price twice (the headline below says it).
 */
function EarlierOffers({ step }: { step: number }) {
  const t = useT();
  const earlier = PAYWALL_LADDER.filter((offer) => offer.step < step);

  return (
    <span className="memo-pw-tags">
      {earlier.map((offer, index) => (
        <span key={offer.step} className="memo-pw-tag-old" style={{ "--i": index } as CSSProperties}>
          {offer.percentOff ? `−${offer.percentOff}%` : t("paywall.demo.fullPrice")}
        </span>
      ))}
    </span>
  );
}

/**
 * The paywall nothing opened (after onboarding, the Upgrade button) keeps the
 * Memo AI logo it always had, with Memo in it alive: he blinks and waves
 * beside the wordmark, sparkles round him. The wordmark is the logo's own.
 */
export function PaywallBrand({ label }: { label: string }) {
  return (
    <div className="memo-pw-brand" role="img" aria-label={label}>
      <span className="memo-pw-brand-mascot" aria-hidden="true">
        <Memo move="wave" />
        <MascotSparkles />
      </span>
      <span className="memo-pw-brand-word" aria-hidden="true" />
    </div>
  );
}

export function PaywallHero({ reason, step = 1 }: { reason: PaywallReason; step?: number }) {
  const t = useT();
  let scene: ReactNode;

  switch (reason) {
    case "chat":
      scene = (
        <span className="memo-pw-scene chat">
          <Memo move="wave" badge="forum" />
          <span className="memo-pw-chat">
            <span className="memo-pw-bubble mine">{t("paywall.demo.chatQuestion")}</span>
            <span className="memo-pw-bubble theirs">{t("paywall.demo.chatAnswer")}</span>
            <span className="memo-pw-bubble theirs typing">
              <span />
              <span />
              <span />
            </span>
          </span>
        </span>
      );
      break;
    case "listen": {
      const words = t("paywall.demo.listenLine").split(" ");
      scene = (
        <span className="memo-pw-scene listen">
          <Memo move="groove" badge="headphones" />
          <span className="memo-pw-listen">
            <span className="memo-pw-listen-line">
              {words.map((word, index) => (
                <span key={index} style={{ "--i": index, "--n": words.length } as CSSProperties}>
                  {word}{" "}
                </span>
              ))}
            </span>
            <Wave bars={14} />
          </span>
        </span>
      );
      break;
    }
    case "tutor":
      scene = (
        <span className="memo-pw-scene tutor">
          <Memo move="nod" badge="school" />
          <Voice bars={13} />
        </span>
      );
      break;
    case "podcast":
      scene = (
        <span className="memo-pw-scene podcast">
          <Memo move="sway" badge="mic" />
          <Voice bars={12} play />
        </span>
      );
      break;
    case "note":
      scene = (
        <span className="memo-pw-scene note">
          <span className="memo-pw-fly">
            <NoteCard icon="description" className="one" />
            <NoteCard icon="description" className="two" />
          </span>
          <Memo move="write" badge="edit_square" />
          <MascotSparkles />
        </span>
      );
      break;
    case "locked":
      scene = (
        <span className="memo-pw-scene locked">
          <NoteCard icon="description" className="blurred big" />
          <Memo move="peek" badge="lock" />
        </span>
      );
      break;
    case "regenerate":
      scene = (
        <span className="memo-pw-scene regenerate">
          <span className="memo-pw-orbit">
            <span className="memo-pw-card"><Msym name="style" size="1.2rem" fill={false} weight={500} /></span>
            <span className="memo-pw-card"><Msym name="quiz" size="1.2rem" fill={false} weight={500} /></span>
            <span className="memo-pw-card"><Msym name="account_tree" size="1.2rem" fill={false} weight={500} /></span>
          </span>
          <Memo move="hop" badge="refresh" />
        </span>
      );
      break;
    case "exam":
      scene = (
        <span className="memo-pw-scene regenerate">
          <span className="memo-pw-orbit">
            <span className="memo-pw-card"><Msym name="event" size="1.2rem" fill={false} weight={500} /></span>
            <span className="memo-pw-card"><Msym name="style" size="1.2rem" fill={false} weight={500} /></span>
            <span className="memo-pw-card"><Msym name="assignment" size="1.2rem" fill={false} weight={500} /></span>
          </span>
          <Memo move="nod" badge="school" />
          <MascotSparkles />
        </span>
      );
      break;
    case "offer":
      scene = (
        <span className="memo-pw-scene offer">
          <EarlierOffers step={step} />
          <Memo move="hop" badge="redeem" />
          <MascotSparkles />
        </span>
      );
      break;
    case "library":
      scene = (
        <span className="memo-pw-scene library">
          <span className="memo-pw-orbit planets">
            {["description", "style", "quiz", "podcasts"].map((icon) => (
              <span key={icon}>
                <Msym name={icon} size="1.1rem" fill={false} weight={500} />
              </span>
            ))}
          </span>
          <Memo move="float" badge="forum" />
        </span>
      );
      break;
  }

  return (
    <div className={`memo-pw-hero ${reason}`} style={paywallAccentStyle(reason)} aria-hidden="true">
      {scene}
    </div>
  );
}
