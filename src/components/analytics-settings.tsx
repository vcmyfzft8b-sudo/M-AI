"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnalyticsConsent } from "@/components/optional-analytics";
import { useTranslations } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { setAnalyticsConsent } from "@/lib/analytics-consent";

export function AnalyticsSettings() {
  const { t } = useTranslations();
  const allowed = useAnalyticsConsent();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const sheet = useSheet(useCallback(() => setOpen(false), []), { scrollable: true });
  const dismiss = sheet.dismiss;
  const status = t(allowed ? "settings.analytics.on" : "settings.analytics.off");

  useEffect(() => {
    if (!open) return;
    const opener = trigger.current;
    dialog.current?.focus();
    return () => opener?.focus();
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="memo-settings-row" aria-haspopup="dialog"
      aria-expanded={open} onClick={() => { setFailed(false); setOpen(true); }}>
      <span className="memo-settings-tile"><Emoji symbol="📊" size="1.15rem" /></span>
      <span className="memo-settings-copy">
        <span className="memo-settings-title">{t("settings.analytics.title")}</span>
        <span className="memo-settings-detail">{status}</span>
      </span>
      <Msym name="chevron_right" size="1.5rem" fill={false} weight={400} />
    </button>
    {open ? <MemoPortal>
      <button type="button" aria-label={t("common.close")}
        className={sheetClass("memo-scrim", sheet.closing)} onClick={() => dismiss()} />
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
        aria-labelledby="analytics-title" aria-describedby="analytics-detail"
        className={sheetClass("memo-confirm memo-confirm-fixed memo-analytics-sheet", sheet.closing)}
        {...sheet.dragProps}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); dismiss(); }
          if (event.key !== "Tab") return;
          const controls = dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
          if (!controls?.length) return;
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }}>
        <div className="memo-grab" data-drag-handle />
        <div data-drag-zone>
          <h2 id="analytics-title">{t("settings.analytics.title")}</h2>
          <p id="analytics-detail">{t("settings.analytics.detail")}</p>
        </div>
        <InstantLink href="/legal/privacy-policy" className="memo-underline-link">{t("landing.footer.privacy")}</InstantLink>
        <div className="memo-analytics-choice">
          <span className="memo-settings-title">{status}</span>
          <button type="button" role="switch" aria-checked={allowed}
            aria-labelledby="analytics-title" aria-describedby="analytics-detail"
            className={`memo-switch${allowed ? " on" : ""}`}
            onClick={() => setFailed(!setAnalyticsConsent(!allowed))}><span /></button>
        </div>
        {failed ? <p role="alert" className="memo-inline-error">{t("settings.analytics.saveFailed")}</p> : null}
        <div className="memo-confirm-actions">
          <button type="button" className="memo-confirm-cancel" onClick={() => dismiss()}>{t("common.done")}</button>
        </div>
      </div>
    </MemoPortal> : null}
  </>;
}
