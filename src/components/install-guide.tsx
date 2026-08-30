"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import {
  detectInstallPlatform,
  markInstallGuideSeen,
  type InstallPlatform,
} from "@/lib/install-guide";

/*
 * The illustrations are drawn here rather than shipped as images.
 *
 * A screenshot of iOS Safari goes stale every September and is wrong for
 * everyone on the other OS version; a drawing of the same phone stays right,
 * weighs nothing, and — because it is built from the app's own tokens — is
 * legible in both themes without a second asset. What matters is that the
 * reader recognises *where* to press, which a clean diagram says better than a
 * screenshot of somebody else's phone.
 */

/** Support and platform never change for the life of a page. */
function subscribeToNothing() {
  return () => {};
}

/**
 * Real screenshots drop in here.
 *
 * Put files at `public/install/ios-1.png` … `ios-3.png` and `android-1.png` …
 * `android-3.png` and they replace the drawings below, no code change: the
 * image is tried first and the drawing is what shows if it 404s. They are not
 * shipped because Apple's and Google's interfaces are their copyright, and a
 * screenshot lifted from a blog is somebody else's work — these have to be
 * taken on a real device by someone who owns the result.
 */
function StepArt({
  platform,
  step,
  children,
}: {
  platform: InstallPlatform;
  step: number;
  children: React.ReactNode;
}) {
  const [hasShot, setHasShot] = useState(true);
  const src = `/install/${platform === "android" ? "android" : "ios"}-${step}.png`;

  if (!hasShot) {
    return <>{children}</>;
  }

  /* eslint-disable-next-line @next/next/no-img-element -- the file may not
     exist, and next/image cannot fall back when it does not. */
  return (
    <img
      src={src}
      alt=""
      className="memo-install-shot"
      onError={() => setHasShot(false)}
    />
  );
}

/** A phone drawn at the proportions of the real thing. */
function PhoneFrame({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <svg viewBox="0 0 168 232" className="memo-install-art" role="img" aria-label={label}>
      <rect x="24" y="4" width="120" height="224" rx="20" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />
      <rect x="70" y="10" width="28" height="5" rx="2.5" fill="var(--muted-2)" />
      {children}
    </svg>
  );
}

/** A row of the kind iOS and Android both use in their menus. */
function MenuRow({ y, label, highlight = false }: { y: number; label: string; highlight?: boolean }) {
  return (
    <>
      <rect
        x="30"
        y={y}
        width="108"
        height="22"
        rx="7"
        fill={highlight ? "rgba(244, 95, 90, 0.14)" : "transparent"}
        stroke={highlight ? "#f45f5a" : "transparent"}
        strokeWidth="1.5"
      />
      <text
        x="40"
        y={y + 15}
        fontSize="8.5"
        fontWeight={highlight ? 700 : 500}
        fill={highlight ? "#f45f5a" : "var(--muted)"}
      >
        {label}
      </text>
      <rect x="120" y={y + 6} width="10" height="10" rx="2.5" fill={highlight ? "#f45f5a" : "var(--field)"} />
    </>
  );
}

/** Safari, with the share control on the bottom bar ringed. */
function IosShareArt() {
  return (
    <PhoneFrame label="Safari z gumbom za deljenje na spodnji vrstici">
      <rect x="32" y="24" width="104" height="16" rx="8" fill="var(--field)" />
      <text x="52" y="35" fontSize="8" fill="var(--muted)">memoai.eu</text>
      <rect x="34" y="52" width="70" height="7" rx="3.5" fill="var(--field)" />
      <rect x="34" y="66" width="96" height="6" rx="3" fill="var(--field)" />
      <rect x="34" y="78" width="88" height="6" rx="3" fill="var(--field)" />
      <rect x="34" y="90" width="60" height="6" rx="3" fill="var(--field)" />

      <rect x="26" y="196" width="116" height="30" rx="12" fill="var(--bg)" />
      <path d="M42 211h8M46 207v8" stroke="var(--muted-2)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="120" cy="211" r="4" fill="none" stroke="var(--muted-2)" strokeWidth="1.8" />
      <circle cx="84" cy="211" r="13" fill="rgba(244, 95, 90, 0.16)" />
      <path d="M84 204v13" stroke="#f45f5a" strokeWidth="2" strokeLinecap="round" />
      <path d="M80 208l4-4 4 4" stroke="#f45f5a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M77 212v6h14v-6" stroke="#f45f5a" strokeWidth="2" strokeLinecap="round" fill="none" />
    </PhoneFrame>
  );
}

/** The iOS share sheet, scrolled to the row that matters. */
function IosSheetArt() {
  return (
    <PhoneFrame label="Deljenje z vrstico Dodaj na začetni zaslon">
      <rect x="26" y="60" width="116" height="166" rx="16" fill="var(--bg)" />
      <rect x="72" y="66" width="24" height="4" rx="2" fill="var(--muted-2)" />
      <circle cx="44" cy="92" r="11" fill="var(--field)" />
      <circle cx="72" cy="92" r="11" fill="var(--field)" />
      <circle cx="100" cy="92" r="11" fill="var(--field)" />
      <circle cx="126" cy="92" r="11" fill="var(--field)" />
      <MenuRow y={116} label="Dodaj med zaznamke" />
      <MenuRow y={142} label="Na začetni zaslon" highlight />
      <MenuRow y={168} label="Kopiraj" />
      <MenuRow y={194} label="Natisni" />
    </PhoneFrame>
  );
}

/** Chrome, with the overflow menu ringed. */
function AndroidMenuArt() {
  return (
    <PhoneFrame label="Chrome z menijem treh pik zgoraj desno">
      <rect x="32" y="24" width="88" height="16" rx="8" fill="var(--field)" />
      <text x="46" y="35" fontSize="8" fill="var(--muted)">memoai.eu</text>
      <circle cx="130" cy="32" r="12" fill="rgba(244, 95, 90, 0.16)" />
      <circle cx="130" cy="27" r="1.9" fill="#f45f5a" />
      <circle cx="130" cy="32" r="1.9" fill="#f45f5a" />
      <circle cx="130" cy="37" r="1.9" fill="#f45f5a" />
      <rect x="34" y="56" width="70" height="7" rx="3.5" fill="var(--field)" />
      <rect x="34" y="70" width="96" height="6" rx="3" fill="var(--field)" />
      <rect x="34" y="82" width="88" height="6" rx="3" fill="var(--field)" />
      <rect x="34" y="94" width="60" height="6" rx="3" fill="var(--field)" />
    </PhoneFrame>
  );
}

/** Chrome's menu, with the install row highlighted. */
function AndroidSheetArt() {
  return (
    <PhoneFrame label="Meni Chroma z vrstico Namesti aplikacijo">
      <rect x="52" y="24" width="90" height="150" rx="12" fill="var(--bg)" stroke="var(--line)" />
      <MenuRow y={34} label="Nov zavihek" />
      <MenuRow y={60} label="Zgodovina" />
      <MenuRow y={86} label="Namesti aplikacijo" highlight />
      <MenuRow y={112} label="Prenosi" />
      <MenuRow y={138} label="Nastavitve" />
    </PhoneFrame>
  );
}

/** The result: Memo sitting among the other apps. */
function HomeScreenArt() {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <PhoneFrame label="Memo med aplikacijami na začetnem zaslonu">
      {cells.map((cell) => {
        const column = cell % 4;
        const row = Math.floor(cell / 4);
        const isMemo = cell === 5;

        return (
          <rect
            key={cell}
            x={32 + column * 27}
            y={70 + row * 34}
            width="22"
            height="22"
            rx="6"
            fill={isMemo ? "#f45f5a" : "var(--field)"}
            stroke={isMemo ? "var(--surface)" : "none"}
            strokeWidth="2"
          />
        );
      })}
      <text x="84" y="160" fontSize="8" fontWeight="700" fill="var(--muted)" textAnchor="middle">
        Memo
      </text>
      <rect x="34" y="196" width="100" height="24" rx="12" fill="var(--field)" />
    </PhoneFrame>
  );
}

type Step = { title: string; body: string; art: React.ReactNode };

function stepsFor(platform: InstallPlatform): Step[] {
  if (platform === "android") {
    return [
      {
        title: "Odpri meni",
        body: "V Chromu se dotakni treh pik zgoraj desno.",
        art: <AndroidMenuArt />,
      },
      {
        title: "Izberi »Namesti aplikacijo«",
        body: "Če te možnosti ni, izberi »Dodaj na začetni zaslon«.",
        art: <AndroidSheetArt />,
      },
      {
        title: "Potrdi in končaj",
        body: "Memo se pojavi med tvojimi aplikacijami in se odpre čez cel zaslon.",
        art: <HomeScreenArt />,
      },
    ];
  }

  return [
    {
      title: "Dotakni se gumba za deljenje",
      body: "V Safariju je na spodnji vrstici — kvadratek s puščico navzgor.",
      art: <IosShareArt />,
    },
    {
      title: "Izberi »Dodaj na začetni zaslon«",
      body: "Podrsaj po seznamu navzdol, dokler ne najdeš te vrstice.",
      art: <IosSheetArt />,
    },
    {
      title: "Potrdi z »Dodaj«",
      body: "Memo se pojavi med aplikacijami in se odpre brez vrstice brskalnika.",
      art: <HomeScreenArt />,
    },
  ];
}

/**
 * How to keep Memo on the home screen.
 *
 * Neither platform lets a website install itself — iOS has no prompt at all,
 * and Chrome's only appears on its own terms — so the honest thing is to show
 * where the control is rather than to offer a button that cannot work.
 */
export function InstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  /*
   * Read through `useSyncExternalStore`: the platform comes from `navigator`,
   * which the server does not have, so the first paint must say "other" and
   * the client must be free to disagree without a hydration mismatch. It never
   * changes for the life of the page, so there is nothing to subscribe to.
   */
  const platform = useSyncExternalStore<InstallPlatform>(
    subscribeToNothing,
    detectInstallPlatform,
    () => "other" as const,
  );

  const sheet = useSheet(
    useCallback(() => {
      markInstallGuideSeen();
      onClose();
    }, [onClose]),
    { scrollable: true },
  );

  if (!open) {
    return null;
  }

  const steps = stepsFor(platform);

  return (
    <MemoPortal>
      <button
        type="button"
        aria-label="Zapri"
        className={sheetClass("memo-scrim", sheet.closing)}
        onClick={() => sheet.dismiss()}
      />
      <div
        className={sheetClass("memo-sheet-full memo-install-sheet", sheet.closing)}
        role="dialog"
        aria-modal="true"
        aria-label="Dodaj Memo na začetni zaslon"
        {...sheet.dragProps}
      >
        <div className="memo-grab-wide" data-drag-handle>
          <span />
        </div>

        <div className="memo-install-head" data-drag-zone>
          <span className="memo-install-title">Memo na začetnem zaslonu</span>
          <button
            type="button"
            aria-label="Zapri"
            className="memo-close-button"
            onClick={() => sheet.dismiss()}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>

        <div className="memo-install-body memo-scroll">
          <p className="memo-install-lead">
            {platform === "other"
              ? "Na telefonu lahko Memo dodaš med aplikacije in se odpre čez cel zaslon — brez vrstice brskalnika."
              : "Dodaj Memo med aplikacije: odpre se čez cel zaslon, brez vrstice brskalnika, in je vedno pri roki."}
          </p>

          <ol className="memo-install-steps">
            {steps.map((step, index) => (
              <li key={step.title} className="memo-install-step">
                <div className="memo-install-step-head">
                  <span className="memo-install-step-number">{index + 1}</span>
                  <span className="memo-install-step-copy">
                    <span>{step.title}</span>
                    <span>{step.body}</span>
                  </span>
                </div>
                <StepArt platform={platform} step={index + 1}>
                  {step.art}
                </StepArt>
              </li>
            ))}
          </ol>

          <button type="button" className="memo-sheet-coral" onClick={() => sheet.dismiss()}>
            Razumem
          </button>
        </div>
      </div>
    </MemoPortal>
  );
}
