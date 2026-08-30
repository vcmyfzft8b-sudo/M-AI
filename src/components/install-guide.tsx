"use client";

import { useCallback, useSyncExternalStore } from "react";

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

/** A phone outline the step art sits inside. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 200 132" className="memo-install-art" role="img" aria-hidden="true">
      <rect
        x="52"
        y="6"
        width="96"
        height="120"
        rx="14"
        fill="var(--surface)"
        stroke="var(--line)"
        strokeWidth="2"
      />
      {children}
    </svg>
  );
}

/** Safari's bottom bar, with the share control called out. */
function IosShareArt() {
  return (
    <PhoneFrame>
      <rect x="60" y="16" width="80" height="8" rx="4" fill="var(--field)" />
      <rect x="60" y="32" width="62" height="6" rx="3" fill="var(--field)" />
      <rect x="60" y="44" width="72" height="6" rx="3" fill="var(--field)" />
      <rect x="60" y="56" width="48" height="6" rx="3" fill="var(--field)" />

      {/* The toolbar */}
      <rect x="54" y="98" width="92" height="26" rx="10" fill="var(--bg)" />
      <circle cx="70" cy="111" r="3" fill="var(--muted-2)" />
      <circle cx="86" cy="111" r="3" fill="var(--muted-2)" />
      <circle cx="130" cy="111" r="3" fill="var(--muted-2)" />

      {/* The share glyph, ringed */}
      <circle cx="108" cy="111" r="12" fill="rgba(244, 95, 90, 0.16)" />
      <path
        d="M108 104v13M108 104l-4 4M108 104l4 4"
        stroke="#f45f5a"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M101 112v5h14v-5"
        stroke="#f45f5a"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </PhoneFrame>
  );
}

/** Chrome's overflow menu, with the three dots called out. */
function AndroidMenuArt() {
  return (
    <PhoneFrame>
      {/* The address bar */}
      <rect x="58" y="14" width="84" height="14" rx="7" fill="var(--field)" />
      <circle cx="136" cy="21" r="1.6" fill="#f45f5a" />
      <circle cx="136" cy="26" r="1.6" fill="#f45f5a" />
      <circle cx="136" cy="16" r="1.6" fill="#f45f5a" />
      <circle cx="136" cy="21" r="11" fill="rgba(244, 95, 90, 0.16)" />
      <circle cx="136" cy="16" r="1.7" fill="#f45f5a" />
      <circle cx="136" cy="21" r="1.7" fill="#f45f5a" />
      <circle cx="136" cy="26" r="1.7" fill="#f45f5a" />

      <rect x="60" y="40" width="62" height="6" rx="3" fill="var(--field)" />
      <rect x="60" y="52" width="72" height="6" rx="3" fill="var(--field)" />
      <rect x="60" y="64" width="48" height="6" rx="3" fill="var(--field)" />
      <rect x="60" y="76" width="66" height="6" rx="3" fill="var(--field)" />
    </PhoneFrame>
  );
}

/** The menu row to look for, and the app landing on the home screen. */
function AddToHomeArt({ label }: { label: string }) {
  return (
    <PhoneFrame>
      <rect
        x="58"
        y="20"
        width="84"
        height="22"
        rx="8"
        fill="rgba(244, 95, 90, 0.14)"
        stroke="#f45f5a"
        strokeWidth="1.5"
      />
      <rect x="66" y="27" width="10" height="10" rx="2.5" fill="#f45f5a" />
      <text x="82" y="35" fontSize="8" fontWeight="700" fill="var(--text)">
        {label}
      </text>

      {/* The result: an icon among the others */}
      <rect x="62" y="58" width="18" height="18" rx="5" fill="var(--field)" />
      <rect x="86" y="58" width="18" height="18" rx="5" fill="var(--field)" />
      <rect
        x="110"
        y="58"
        width="18"
        height="18"
        rx="5"
        fill="#f45f5a"
        stroke="var(--surface)"
        strokeWidth="2"
      />
      <rect x="62" y="84" width="18" height="18" rx="5" fill="var(--field)" />
      <rect x="86" y="84" width="18" height="18" rx="5" fill="var(--field)" />
      <rect x="110" y="84" width="18" height="18" rx="5" fill="var(--field)" />
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
        art: <AddToHomeArt label="Namesti aplikacijo" />,
      },
      {
        title: "Potrdi",
        body: "Memo se pojavi med tvojimi aplikacijami in se odpre čez cel zaslon.",
        art: <AddToHomeArt label="Dodaj" />,
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
      art: <AddToHomeArt label="Na začetni zaslon" />,
    },
    {
      title: "Potrdi z »Dodaj«",
      body: "Memo se pojavi med aplikacijami in se odpre brez vrstice brskalnika.",
      art: <AddToHomeArt label="Dodaj" />,
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
                {step.art}
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
