"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";

import { BillingPortalButton } from "@/components/billing-portal-button";
import { useTranslations } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { LanguageSettingsRow } from "@/components/language-picker";
import { Emoji, Msym } from "@/components/msym";
import { useAppHref } from "@/components/creator-demo/creator-demo-context";
import { InstallGuide } from "@/components/install-guide";
import { MemoPortal } from "@/components/memo-portal";
import { useInstantNavigation } from "@/components/navigation-loading";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { BRAND_NAME, BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { ThemePreference } from "@/lib/theme";
import {
  detectInstallPlatform,
  INSTALL_GUIDE_SEEN_EVENT,
  markInstallGuideSeen,
  shouldOfferInstallGuide,
} from "@/lib/install-guide";
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
const THEME_OPTIONS: Array<{ value: ThemePreference; labelKey: MessageKey }> = [
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
  { value: "system", labelKey: "settings.theme.system" },
];

/** Platform never changes for the life of a page, so there is nothing to watch. */
function subscribeToNothing() {
  return () => {};
}

/** Re-read the "has the guide been opened" flag when anything sets it. */
function subscribeToInstallGuideSeen(onStoreChange: () => void) {
  window.addEventListener(INSTALL_GUIDE_SEEN_EVENT, onStoreChange);

  return () => window.removeEventListener(INSTALL_GUIDE_SEEN_EVENT, onStoreChange);
}

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
  installGuideSeen = false,
  isDemo = false,
}: {
  email: string;
  planLabel: string;
  planDetail: string;
  hasSubscription: boolean;
  /**
   * Whether this account has already opened the home screen guide. Read from
   * the profile so the badge is answered once and stays answered on every
   * device, rather than once per browser.
   */
  installGuideSeen?: boolean;
  /** The creator demo has no account: sign-out and deletion are hidden. */
  isDemo?: boolean;
}) {
  const t = useTranslations().t;
  const { navigateWithFeedback, overlay: navigationOverlay, isNavigating } = useInstantNavigation();
  const homeHref = useAppHref("/app");
  const startHref = useAppHref("/app/start");
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // A bottom sheet on the phone, a centred dialog on desktop — and on the
  // phone it leaves and drags like every other sheet. Once the logout POST is
  // away the sheet is locked: the page is on its way out, and dismissing it
  // would leave the settings screen looking idle while it goes.
  const confirmSheet = useSheet(useCallback(() => setConfirm(null), []), {
    locked: isLoggingOut,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [isInstallGuideOpen, setIsInstallGuideOpen] = useState(false);

  /*
   * Phones only: a desktop has no home screen to add to, so the row would be
   * answering a question nobody asked.
   */
  const isPhone = useSyncExternalStore(
    subscribeToNothing,
    () => detectInstallPlatform() !== "other",
    () => false,
  );

  /*
   * Read during render rather than in an effect, the way `isPhone` above is.
   * As an effect this settled after the first paint, which was invisible while
   * it only toggled a dot on a row that was already there — but it now decides
   * whether a card sits above everything else, and arriving late shoved the
   * whole screen down a frame in.
   */
  const showInstallHint = useSyncExternalStore(
    subscribeToInstallGuideSeen,
    () => shouldOfferInstallGuide(installGuideSeen),
    () => false,
  );

  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readStoredThemePreference,
    () => "system" as ThemePreference,
  );

  const shareHref = `mailto:?subject=${encodeURIComponent(
    t("settings.share.mailSubject", { brand: BRAND_NAME }),
  )}&body=${encodeURIComponent(t("settings.share.mailBody", { brand: BRAND_NAME }))}`;

  // There is no self-serve deletion endpoint; the request goes to support, which
  // is what the confirmation copy promises.
  const deleteRequestHref = `mailto:${BRAND_SUPPORT_EMAIL}?subject=${encodeURIComponent(
    t("settings.delete.mailSubject"),
  )}&body=${encodeURIComponent(t("settings.delete.mailBody", { email }))}`;

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
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  );

  const rows: SettingsRow[] = [
    ...(isPhone && !showInstallHint
      ? [
          {
            id: "install",
            emoji: "📲",
            title: t("settings.install.title"),
            detail: t("settings.install.detail"),
            // Opening it is the whole of "seen": the badge is there to get
            // somebody to look once, so it goes the moment they do, not when
            // they close the sheet or read to the end of it.
            onSelect: () => {
              markInstallGuideSeen();
              setIsInstallGuideOpen(true);
            },
          },
        ]
      : []),
    {
      id: "redeem",
      emoji: "🎟️",
      title: t("settings.rows.redeem"),
      href: "/app/support/redeem-code",
    },
    {
      id: "privacy",
      emoji: "🔒",
      title: t("settings.rows.privacy"),
      href: "/legal/privacy-policy",
    },
    {
      id: "share",
      emoji: "📤",
      title: t("settings.rows.share"),
      onSelect: () => setConfirm("share"),
    },
    {
      id: "feature",
      emoji: "💡",
      title: t("settings.rows.feature"),
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
      title: t("settings.signOut"),
      detail: email,
      // The phone has this on the Račun card above instead.
      className: "memo-only-desktop",
      onSelect: () => setConfirm("logout"),
    },
    {
      id: "delete",
      emoji: "🗑️",
      title: t("settings.delete.row"),
      danger: true,
      onSelect: () => setConfirm("delete"),
    },
  ];

  const confirmCopy: Record<ConfirmKind, { emoji: string; title: string; body: string; cta: string }> = {
    logout: {
      emoji: "👤",
      title: t("settings.logout.title"),
      body: t("settings.logout.body", { email }),
      cta: t("settings.signOut"),
    },
    delete: {
      emoji: "🗑️",
      title: t("settings.delete.title"),
      body: t("settings.delete.body"),
      cta: t("settings.delete.cta"),
    },
    share: {
      emoji: "📤",
      title: t("settings.share.title", { brand: BRAND_NAME }),
      body: t("settings.share.body", { brand: BRAND_NAME }),
      cta: t("settings.share.cta"),
    },
  };

  function runConfirm() {
    const kind = confirm;

    if (isLoggingOut) {
      return;
    }

    /*
     * The demo draws the whole screen — the artboard has Odjava and Izbriši
     * račun on it, and a settings page missing its account section is not the
     * settings page. There is no account behind it, so both confirmations stop
     * at the toast rather than posting a logout or opening a mail client.
     */
    if (isDemo && (kind === "logout" || kind === "delete")) {
      confirmSheet.dismiss();
      showToast(t(kind === "logout" ? "settings.demo.noLogout" : "settings.demo.noDelete"));
      return;
    }

    /*
     * The logout is a POST that comes back as a full page load, and there is
     * nothing for the app to render in between. So the sheet stays where it
     * is with the spinner on the button that was pressed, rather than closing
     * onto a settings screen that looks like nothing happened.
     */
    if (kind === "logout") {
      setIsLoggingOut(true);
      const form = document.createElement("form");
      form.method = "post";
      form.action = "/auth/logout";
      document.body.appendChild(form);
      form.submit();
      return;
    }

    confirmSheet.dismiss();

    if (kind === "delete") {
      window.location.href = deleteRequestHref;
      showToast(t("settings.toast.deleteReady"));
      return;
    }

    if (kind === "share") {
      window.location.href = shareHref;
      showToast(t("settings.toast.shareReady"));
    }
  }

  return (
    <>
      {navigationOverlay}
      <div className="memo-settings-screen">
        {/* Phone: the sheet's close control, which returns to the library. */}
        <div className="memo-settings-topbar memo-only-mobile flex">
          <button
            type="button"
            aria-label={t("common.close")}
            // An X closes a screen, so it is the app's close button rather
            // than the library header's slightly larger round control.
            className="memo-close-button"
            aria-busy={isNavigating}
            onClick={() => navigateWithFeedback(homeHref)}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>

        {/* The phone scrolls this inside the screen rather than scrolling the
            screen itself, so the close control can float above it the way the
            library's does. On desktop the wrapper is `display: contents`. */}
        <div className="memo-screen-scroll">
          <div className="memo-page">
            <h1>{t("settings.title")}</h1>

            {/*
              * Until somebody has looked at it once, the guide comes before
              * the theme, the plan and the account. Everything else on this
              * screen is for people already using the app; this is the one
              * thing that changes how they use it, and buried eight rows down
              * under a dot it was reaching nobody. It leaves on its own: the
              * moment it is opened — or the app is already installed —
              * `showInstallHint` goes false and the row returns to the list
              * below, where it stays available without taking the top spot.
              *
              * `isPhone` as well as the hint: `showInstallHint` is the "has
              * this been read" half only, and says nothing about whether the
              * device has a home screen to add to. Without it a desktop gets a
              * card for a gesture its machine does not have.
              */}
            {isPhone && showInstallHint ? (
              <button
                type="button"
                className="memo-install-cta"
                onClick={() => {
                  markInstallGuideSeen();
                  setIsInstallGuideOpen(true);
                }}
              >
                <span className="memo-install-cta-copy">
                  <span className="memo-install-cta-title">
                    <Emoji symbol="📲" size="1.15rem" />
                    <span>{t("settings.install.ctaTitle")}</span>
                  </span>
                  <span className="memo-install-cta-detail">
                    {t("settings.install.ctaDetail")}
                  </span>
                </span>
                <Msym name="chevron_right" size="1.5rem" fill={false} weight={400} />
              </button>
            ) : null}

            {/*
              * The phone puts each group under its own heading and drops the
              * explanatory line the desktop artboard keeps beside "Tema".
              */}
            <h2 className="memo-settings-heading memo-only-mobile">
              {t("settings.theme.heading")}
            </h2>

            <div className="memo-card-row memo-settings-theme">
              <span className="memo-card-row-copy memo-only-desktop">
                <span className="memo-card-row-title">{t("settings.theme.heading")}</span>
                <span className="memo-card-row-detail">{t("settings.theme.detail")}</span>
              </span>
              {themeSegment}
            </div>

            <h2 className="memo-settings-heading memo-only-mobile">
              {t("settings.subscription.heading")}
            </h2>

            <div className="memo-card-row">
              <span className="memo-card-row-copy">
                <span className="memo-eyebrow">{t("settings.plan.eyebrow")}</span>
                <span className="memo-card-row-title">{planLabel}</span>
                <span className="memo-card-row-detail">{planDetail}</span>
              </span>
              {hasSubscription ? (
                <BillingPortalButton />
              ) : (
                <InstantLink href={startHref} className="memo-primary-pill">
                  <Emoji symbol="✨" size="1rem" />
                  <span>{t("settings.plan.choose")}</span>
                </InstantLink>
              )}
            </div>

            <p className="memo-fine-print">
              {t("settings.finePrint.refundBefore")}
              <InstantLink href="/legal/refund-policy" className="memo-underline-link">
                {t("settings.finePrint.refundLink")}
              </InstantLink>
              .
            </p>

            {accountRows.length > 0 ? (
              <>
                <h2 className="memo-settings-heading memo-only-mobile">
                  {t("settings.account.heading")}
                </h2>

                {/* The phone names the account on its own card, as the design does. */}
                <div className="memo-card-row memo-settings-account memo-only-mobile">
                  <span className="memo-card-row-copy">
                    <span className="memo-eyebrow">{t("settings.account.signedIn")}</span>
                    <span className="memo-card-row-title">{email}</span>
                  </span>
                  <button
                    type="button"
                    className="memo-settings-signout"
                    onClick={() => setConfirm("logout")}
                    disabled={isLoggingOut}
                    aria-busy={isLoggingOut}
                  >
                    {isLoggingOut ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    {isLoggingOut ? t("settings.signingOut") : t("settings.signOut")}
                  </button>
                </div>
              </>
            ) : null}

            {/* The phone groups the rows into one card; desktop keeps them apart. */}
            <div className="memo-settings-list">
              {/* Its own component: the row opens a sheet and posts the
                  choice, which none of the plain rows above do. */}
              <LanguageSettingsRow />
              {rows.map(renderRow)}
              {accountRows.map(renderRow)}
            </div>

            <h2 className="memo-settings-heading memo-only-mobile">
              {t("settings.help.heading")}
            </h2>

            {/* Desktop reaches the help centre from the rail, so this card is
                the phone's only. */}
            <div className="memo-settings-list memo-settings-help memo-only-mobile grid">
              {renderRow({
                id: "help",
                emoji: "❓",
                icon: "help",
                title: t("settings.rows.help"),
                href: "/app/support",
              })}
            </div>
          </div>
        </div>
      </div>

      {confirm ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.cancel")}
            className={sheetClass("memo-scrim", confirmSheet.closing)}
            onClick={() => confirmSheet.dismiss()}
            disabled={isLoggingOut}
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
                disabled={isLoggingOut}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={`memo-confirm-go ${confirm === "delete" ? "danger" : ""}`.trim()}
                onClick={runConfirm}
                disabled={isLoggingOut}
                aria-busy={isLoggingOut}
              >
                {isLoggingOut ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {isLoggingOut ? t("settings.signingOut") : confirmCopy[confirm].cta}
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
