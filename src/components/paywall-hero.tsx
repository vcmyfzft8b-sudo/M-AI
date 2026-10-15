"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MascotFigure, MascotSparkles, MascotThought, useMascot } from "@/components/onboarding-mascot";
import type { PaywallReason } from "@/lib/paywall-reasons";
import { NOTE_TABS } from "@/lib/note-tabs";

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

function NoteCard({ emoji, className = "" }: { emoji: string; className?: string }) {
  return (
    <span className={`memo-pw-note ${className}`.trim()}>
      <span className="memo-pw-note-emoji">{emoji}</span>
      <span className="memo-pw-note-lines">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

/** Memo, blinking, with whatever he is wearing or holding for this scene. */
function Memo({ move, prop, propClass = "", thought }: { move: string; prop?: string; propClass?: string; thought?: string }) {
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
        <MascotFigure />
      </span>
      {prop ? <span className={`memo-pw-prop ${propClass}`.trim()}>{prop}</span> : null}
      {thought ? <MascotThought icon={thought} offset="-1.4rem" scale={0.9} /> : null}
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

export function PaywallHero({ reason }: { reason: PaywallReason }) {
  const t = useT();
  let scene: ReactNode;

  switch (reason) {
    case "chat":
      scene = (
        <span className="memo-pw-scene chat">
          <Memo move="wave" />
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
          <span className="memo-pw-notes-float" aria-hidden="true">
            <span>♪</span>
            <span>♫</span>
            <span>♪</span>
          </span>
          <Memo move="groove" prop="🎧" propClass="on-head" />
          <span className="memo-pw-listen">
            <span className="memo-pw-listen-line">
              {words.map((word, index) => (
                <span key={index} style={{ "--i": index, "--n": words.length } as CSSProperties}>
                  {word}{" "}
                </span>
              ))}
            </span>
            <Wave bars={12} />
          </span>
        </span>
      );
      break;
    }
    case "tutor":
      scene = (
        <span className="memo-pw-scene tutor">
          <Memo move="nod" prop="🎓" propClass="on-head cap" />
          <span className="memo-pw-tutor">
            <span className="memo-pw-orb" />
            <Wave bars={7} />
          </span>
        </span>
      );
      break;
    case "podcast":
      scene = (
        <span className="memo-pw-scene podcast">
          <Memo move="sway" prop="🎙️" propClass="in-hand" />
          <span className="memo-pw-podcast">
            <span className="memo-pw-orb small" />
            <Wave bars={10} />
          </span>
        </span>
      );
      break;
    case "note":
      scene = (
        <span className="memo-pw-scene note">
          <span className="memo-pw-fly">
            <NoteCard emoji="🧬" className="one" />
            <NoteCard emoji="📈" className="two" />
          </span>
          <Memo move="write" thought="💡" />
          <MascotSparkles />
        </span>
      );
      break;
    case "locked":
      scene = (
        <span className="memo-pw-scene locked">
          <NoteCard emoji="📈" className="blurred big" />
          <Memo move="peek" prop="🔑" propClass="in-hand key" />
        </span>
      );
      break;
    case "regenerate":
      scene = (
        <span className="memo-pw-scene regenerate">
          <span className="memo-pw-orbit">
            <span className="memo-pw-card">❓</span>
            <span className="memo-pw-card">💡</span>
            <span className="memo-pw-card">✅</span>
          </span>
          <Memo move="hop" />
        </span>
      );
      break;
    case "library":
      scene = (
        <span className="memo-pw-scene library">
          <span className="memo-pw-orbit planets">
            <span>🧬</span>
            <span>📈</span>
            <span>🌿</span>
            <span>🏛️</span>
          </span>
          <Memo move="float" />
          <span className="memo-pw-answer">
            <Msym name="forum" size="1.2rem" fill={false} weight={500} />
          </span>
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
