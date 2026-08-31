"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useTranslations, writeLocaleCookie } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";

/**
 * Changing the language is a server-side fact — every screen in this app is
 * rendered from the cookie — so the picker writes the cookie, tells the server
 * to remember it against the account, and refreshes.
 *
 * The cookie is written on the client *as well* as by the route's `Set-Cookie`.
 * `router.refresh()` is allowed to start before the response's cookie has been
 * applied, and when it does the refresh re-renders in the old language and
 * looks like the picker did nothing. Writing it here first makes the ordering
 * ours.
 */
function useLocaleChange() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);

  const change = useCallback(
    (locale: Locale) => {
      setPendingLocale(locale);
      writeLocaleCookie(locale);

      startTransition(async () => {
        try {
          await fetch("/api/locale", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale }),
          });
        } catch {
          // The cookie is already written, so this browser has the language
          // either way; only the account-wide copy is lost. Refreshing below
          // still shows the new language.
        }

        router.refresh();
        setPendingLocale(null);
      });
    },
    [router],
  );

  return { change, isPending, pendingLocale };
}

function LocaleOptionList({
  active,
  pendingLocale,
  onSelect,
  className,
}: {
  active: Locale;
  pendingLocale: Locale | null;
  onSelect: (locale: Locale) => void;
  className: string;
}) {
  return (
    <div className={className} role="listbox" aria-label={LOCALE_LABELS[active]}>
      {LOCALES.map((locale) => {
        const isActive = locale === active;

        return (
          <button
            key={locale}
            type="button"
            role="option"
            aria-selected={isActive}
            lang={locale}
            className={`memo-language-option${isActive ? " active" : ""}`}
            onClick={() => onSelect(locale)}
          >
            <span className="memo-language-option-label">{LOCALE_LABELS[locale]}</span>
            {pendingLocale === locale ? (
              <Msym name="progress_activity" size="1.25rem" className="memo-spin" />
            ) : isActive ? (
              <Msym name="check" size="1.25rem" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The settings row. Opens the same bottom sheet on the phone and centred
 * dialog on desktop that every other confirmation on that screen uses, so it
 * does not read as a different kind of control.
 */
export function LanguageSettingsRow() {
  const { locale, t } = useTranslations();
  const [open, setOpen] = useState(false);
  const { change, pendingLocale } = useLocaleChange();
  const sheet = useSheet(useCallback(() => setOpen(false), []));

  return (
    <>
      <button type="button" className="memo-settings-row" onClick={() => setOpen(true)}>
        <span className="memo-settings-tile">
          <Msym name="language" size="1.35rem" fill weight={500} />
        </span>
        <span className="memo-settings-copy">
          <span className="memo-settings-title">{t("settings.language.title")}</span>
          <span className="memo-settings-detail">{LOCALE_LABELS[locale]}</span>
        </span>
        <Msym name="chevron_right" size="1.5rem" fill={false} weight={400} />
      </button>

      {open ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", sheet.closing)}
            onClick={() => sheet.dismiss()}
          />
          <div
            className={sheetClass("memo-confirm memo-confirm-fixed memo-language-sheet", sheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-label={t("settings.language.title")}
            {...sheet.dragProps}
          >
            <h2>{t("settings.language.title")}</h2>
            <p>{t("settings.language.description")}</p>
            <LocaleOptionList
              className="memo-language-options"
              active={locale}
              pendingLocale={pendingLocale}
              onSelect={(next) => {
                if (next === locale) {
                  sheet.dismiss();
                  return;
                }

                change(next);
                sheet.dismiss();
              }}
            />
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}

/**
 * The landing-page control, in the nav.
 *
 * A globe rather than a labelled button: the nav's one filled shape should be
 * the call to action, and a switcher that reads as a second button competes
 * with it — which is why every marketing site that keeps one up here (Airbnb,
 * Booking, Apple) keeps it as a quiet icon. Desktop has room for the language's
 * name beside the globe; the phone shows the globe alone.
 *
 * The full list also sits in the footer, where visitors are used to finding it.
 *
 * A plain popover rather than a `<select>`: the native control renders as the
 * operating system's language rather than the page's, and on iOS it covers the
 * hero with a wheel.
 */
export function LandingLanguagePicker() {
  const { locale, t } = useTranslations();
  const [open, setOpen] = useState(false);
  const { change, pendingLocale } = useLocaleChange();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="landing-language" ref={containerRef}>
      <button
        type="button"
        className="landing-language-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("settings.language.title")}: ${LOCALE_LABELS[locale]}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Msym name="language" size="1.2rem" />
        {/* Hidden below the phone breakpoint, where the globe alone carries it. */}
        <span className="landing-language-name">{LOCALE_LABELS[locale]}</span>
      </button>

      {open ? (
        <LocaleOptionList
          className="landing-language-menu"
          active={locale}
          pendingLocale={pendingLocale}
          onSelect={(next) => {
            setOpen(false);

            if (next !== locale) {
              change(next);
            }
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The footer control: the five languages laid out in full, the placement most
 * marketing sites use. Nothing opens — a visitor scanning the footer for their
 * language sees it and clicks it.
 */
export function FooterLanguagePicker() {
  const { locale, t } = useTranslations();
  const { change, pendingLocale } = useLocaleChange();

  return (
    <div className="landing-v2-footer-group landing-footer-language">
      <h2>{t("settings.language.title")}</h2>
      <ul>
        {LOCALES.map((option) => (
          <li key={option}>
            <button
              type="button"
              className={option === locale ? "is-active" : undefined}
              aria-current={option === locale ? "true" : undefined}
              aria-busy={pendingLocale === option}
              onClick={() => {
                if (option !== locale) {
                  change(option);
                }
              }}
            >
              {LOCALE_LABELS[option]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
