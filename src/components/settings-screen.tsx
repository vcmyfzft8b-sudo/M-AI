"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { BillingPortalButton } from "@/components/billing-portal-button";
import { InstantLink } from "@/components/instant-link";
import { Emoji, Msym } from "@/components/msym";
import { useAppHref } from "@/components/creator-demo/creator-demo-context";
import { InstallGuide } from "@/components/install-guide";
import { MemoPortal } from "@/components/memo-portal";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { BRAND_NAME, BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import type { ThemePreference } from "@/lib/theme";
import { INSTALL_GUIDE_SEEN_KEY, shouldOfferInstallGuide } from "@/lib/install-guide";
import {
  readStoredThemePreference,
  setThemePreference,
  subscribeToThemePreference,
} from "@/lib/theme";

/**
 * Nastavitve, as the redesign draws it: a theme segment, the plan card, and a
 * list of rows. On the phone the same content is grouped under headings the way
 * the settings sheet shows it, and the close control returns to the library.
 */

/*
 * Desktop order. The phone artboard leads with Sistem instead, which the
 * stylesheet reorders rather than this list — one DOM, two orders.
 */
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Svetla" },
  { value: "dark", label: "Temna" },
  { value: "system", label: "Sistem" },
];

type ConfirmKind = "logout" | "delete" | "share";

type SettingsRow = {
  id: string;
  emoji: string;
  /** An icon-font glyph where the design draws one instead of an emoji. */
  icon?: string;
  title: string;
  href?: string;
  detail?: string;
  danger?: boolean;
  /** Extra classes on the row, for rows only one breakpoint draws. */
  className?: string;
  onSelect?: () => void;
};

export function SettingsScreen({
  email,
  planLabel,
  planDetail,
  hasSubscription,
  isDemo = false,
}: {
  email: string;
  planLabel: string;
  planDetail: string;
  hasSubscription: boolean;
  /** The creator demo has no account: sign-out and deletion are hidden. */
  isDemo?: boolean;
}) {
  const router = useRouter();
  const startHref = useAppHref("/app/start");
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  // A bottom sheet on the phone, a centred dialog on desktop — and on the
  // phone it leaves and drags like every other sheet.
  const confirmSheet = useSheet(useCallback(() => setConfirm(null), []));
  const [toast, setToast] = useState<string | null>(null);
  const [isInstallGuideOpen, setIsInstallGuideOpen] = useState(false);
  /* Same badge as the gear carries, on the row that answers it. */
  const [showInstallHint, setShowInstallHint] = useState(false);

  useEffect(() => {
    const sync = () => setShowInstallHint(shouldOfferInstallGuide());

    sync();
    window.addEventListener(INSTALL_GUIDE_SEEN_KEY, sync);

    return () => window.removeEventListener(INSTALL_GUIDE_SEEN_KEY, sync);
  }, []);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readStoredThemePreference,
    () => "system" as ThemePreference,
  );

  const shareHref = `mailto:?subject=${encodeURIComponent(
    `Preizkusi ${BRAND_NAME}`,
  )}&body=${encodeURIComponent(
    `Uporabljam ${BRAND_NAME} za zapiske predavanj in mislim, da bi ti lahko prišel prav.`,
  )}`;

  // There is no self-serve deletion endpoint; the request goes to support, which
  // is what the confirmation copy promises.
  const deleteRequestHref = `mailto:${BRAND_SUPPORT_EMAIL}?subject=${encodeURIComponent(
    "Zahteva za izbris računa",
  )}&body=${encodeURIComponent(
    `Prosim za izbris računa ${email} in vseh povezanih podatkov.`,
  )}`;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }

  function renderRow(row: SettingsRow) {
    const body = (
      <>
        <span className={`memo-settings-tile ${row.danger ? "danger" : ""}`.trim()}>
          {row.icon ? (
            <Msym name={row.icon} size="1.35rem" fill weight={500} />
          ) : (
            <Emoji symbol={row.emoji} size="1.15rem" />
          )}
        </span>
        <span className="memo-settings-copy">
          <span className={`memo-settings-title ${row.danger ? "danger" : ""}`.trim()}>
            {row.title}
          </span>
          {row.detail ? <span className="memo-settings-detail">{row.detail}</span> : null}
        </span>
        <Msym name="chevron_right" size="1.5rem" fill={false} weight={400} />
      </>
    );

    return row.href ? (
      <InstantLink
        key={row.id}
        href={row.href}
        className={`memo-settings-row ${row.className ?? ""}`.trim()}
      >
        {body}
      </InstantLink>
    ) : (
      <button
        key={row.id}
        type="button"
        className={`memo-settings-row ${row.className ?? ""}`.trim()}
        onClick={row.onSelect}
        disabled={row.id === "logout" && isLoggingOut}
      >
        {body}
      </button>
    );
  }

  const themeSegment = (
    <div className="memo-segment">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          data-theme-option={option.value}
          className={preference === option.value ? "active" : ""}
          aria-pressed={preference === option.value}
          onClick={() => setThemePreference(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const rows: SettingsRow[] = [
    {
      id: "install",
      emoji: "📲",
      title: "Dodaj na začetni zaslon",
      detail: "Odpri Memo kot aplikacijo",
      className: showInstallHint ? "has-dot" : "",
      onSelect: () => setIsInstallGuideOpen(true),
    },
    {
      id: "redeem",
      emoji: "🎟️",
      title: "Unovči kodo",
      href: "/app/support/redeem-code",
    },
    {
      id: "privacy",
      emoji: "🔒",
      title: "Zasebnost",
      href: "/legal/privacy-policy",
    },
    { id: "share", emoji: "📤", title: "Deli", onSelect: () => setConfirm("share") },
    {
      id: "feature",
      emoji: "💡",
      title: "Predlagaj funkcijo",
      href: "/app/support/feature-request",
    },
  ];

  /*
   * Desktop keeps Odjava and Izbriši račun in the same list, as its artboard
   * shows them. The phone gives the account its own card under a "Račun"
   * heading, so there they are rendered separately rather than as rows.
   */
  const accountRows: typeof rows = [
    {
      id: "logout",
      emoji: "👤",
      title: "Odjava",
      detail: email,
      // The phone has this on the Račun card above instead.
      className: "memo-only-desktop",
      onSelect: () => setConfirm("logout"),
    },
    {
      id: "delete",
      emoji: "🗑️",
      title: "Izbriši račun",
      danger: true,
      onSelect: () => setConfirm("delete"),
    },
  ];

  const confirmCopy: Record<ConfirmKind, { emoji: string; title: string; body: string; cta: string }> = {
    logout: {
      emoji: "👤",
      title: "Se želiš odjaviti?",
      body: `Odjavljen boš iz računa ${email} na tej napravi.`,
      cta: "Odjava",
    },
    delete: {
      emoji: "🗑️",
      title: "Izbriši račun?",
      body:
        "Vsi zapiski, kartice in kvizi bodo trajno izbrisani. Zahtevo obdelamo ročno — poslali ti bomo potrditev po e-pošti.",
      cta: "Pošlji zahtevo",
    },
    share: {
      emoji: "📤",
      title: `Deli ${BRAND_NAME}`,
      body: `Pošlji povabilo sošolcu — uporabljam ${BRAND_NAME} za zapiske predavanj in mislim, da bi ti lahko prišel prav.`,
      cta: "Odpri e-pošto",
    },
  };

  function runConfirm() {
    const kind = confirm;
    confirmSheet.dismiss();

    /*
     * The demo draws the whole screen — the artboard has Odjava and Izbriši
     * račun on it, and a settings page missing its account section is not the
     * settings page. There is no account behind it, so both confirmations stop
     * at the toast rather than posting a logout or opening a mail client.
     */
    if (isDemo) {
      if (kind === "logout") {
        showToast("V predstavitvi ni računa za odjavo");
        return;
      }

      if (kind === "delete") {
        showToast("V predstavitvi ni računa za izbris");
        return;
      }
    }

    if (kind === "logout") {
      setIsLoggingOut(true);
      const form = document.createElement("form");
      form.method = "post";
      form.action = "/auth/logout";
      document.body.appendChild(form);
      form.submit();
      return;
    }

    if (kind === "delete") {
      window.location.href = deleteRequestHref;
      showToast("Zahteva za izbris pripravljena");
      return;
    }

    if (kind === "share") {
      window.location.href = shareHref;
      showToast("Povabilo pripravljeno");
    }
  }

  return (
    <>
      <div className="memo-settings-screen">
        {/* Phone: the sheet's close control, which returns to the library. */}
        <div className="memo-settings-topbar memo-only-mobile flex">
          <button
            type="button"
            aria-label="Zapri"
            // An X closes a screen, so it is the app's close button rather
            // than the library header's slightly larger round control.
            className="memo-close-button"
            onClick={() => router.push("/app")}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>

        <div className="memo-page">
          <h1>Nastavitve</h1>

          {/*
            * The phone puts each group under its own heading and drops the
            * explanatory line the desktop artboard keeps beside "Tema".
            */}
          <h2 className="memo-settings-heading memo-only-mobile">Tema</h2>

          <div className="memo-card-row memo-settings-theme">
            <span className="memo-card-row-copy memo-only-desktop">
              <span className="memo-card-row-title">Tema</span>
              <span className="memo-card-row-detail">Svetla ali temna postavitev</span>
            </span>
            {themeSegment}
          </div>

          <h2 className="memo-settings-heading memo-only-mobile">Naročnina</h2>

          <div className="memo-card-row">
            <span className="memo-card-row-copy">
              <span className="memo-eyebrow">Paket</span>
              <span className="memo-card-row-title">{planLabel}</span>
              <span className="memo-card-row-detail">{planDetail}</span>
            </span>
            {hasSubscription ? (
              <BillingPortalButton />
            ) : (
              <InstantLink href={startHref} className="memo-primary-pill">
                <Emoji symbol="✨" size="1rem" />
                <span>Izberi paket</span>
              </InstantLink>
            )}
          </div>

          <p className="memo-fine-print">
            Preklic in vračila ureja{" "}
            <InstantLink href="/legal/refund-policy" className="memo-underline-link">
              politika vračil
            </InstantLink>
            .
          </p>

          {accountRows.length > 0 ? (
            <>
              <h2 className="memo-settings-heading memo-only-mobile">Račun</h2>

              {/* The phone names the account on its own card, as the design does. */}
              <div className="memo-card-row memo-settings-account memo-only-mobile">
                <span className="memo-card-row-copy">
                  <span className="memo-eyebrow">Prijavljen</span>
                  <span className="memo-card-row-title">{email}</span>
                </span>
                <button
                  type="button"
                  className="memo-settings-signout"
                  onClick={() => setConfirm("logout")}
                  disabled={isLoggingOut}
                >
                  Odjava
                </button>
              </div>
            </>
          ) : null}

          {/* The phone groups the rows into one card; desktop keeps them apart. */}
          <div className="memo-settings-list">
            {rows.map(renderRow)}
            {accountRows.map(renderRow)}
          </div>

          <h2 className="memo-settings-heading memo-only-mobile">Pomoč</h2>

          {/* Desktop reaches the help centre from the rail, so this card is
              the phone's only. */}
          <div className="memo-settings-list memo-settings-help memo-only-mobile grid">
            {renderRow({
              id: "help",
              emoji: "❓",
              icon: "help",
              title: "Center za pomoč",
              href: "/app/support",
            })}
          </div>
        </div>
      </div>

      {confirm ? (
        <MemoPortal>
          <button
            type="button"
            aria-label="Prekliči"
            className={sheetClass("memo-scrim", confirmSheet.closing)}
            onClick={() => confirmSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-confirm memo-confirm-fixed", confirmSheet.closing)}
            role="dialog"
            aria-modal="true"
            {...confirmSheet.dragProps}
          >
            <span className={`memo-confirm-tile ${confirm === "delete" ? "danger" : ""}`.trim()}>
              <Emoji symbol={confirmCopy[confirm].emoji} size="1.4rem" />
            </span>
            <h2>{confirmCopy[confirm].title}</h2>
            <p>{confirmCopy[confirm].body}</p>
            <div className="memo-confirm-actions">
              <button
                type="button"
                className="memo-confirm-cancel"
                onClick={() => confirmSheet.dismiss()}
              >
                Prekliči
              </button>
              <button
                type="button"
                className={`memo-confirm-go ${confirm === "delete" ? "danger" : ""}`.trim()}
                onClick={runConfirm}
              >
                {confirmCopy[confirm].cta}
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      <InstallGuide
        open={isInstallGuideOpen}
        onClose={() => setIsInstallGuideOpen(false)}
      />

      {toast ? (
        <MemoPortal>
          <div className="memo-toast" role="status">
            <Msym name="check_circle" size="1.25rem" />
            <span>{toast}</span>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
