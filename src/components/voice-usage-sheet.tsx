"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";

/**
 * The meter for spoken time, shared by the two features that spend it.
 *
 * The tutor and the podcast draw on one allowance — the same minutes, the same daily reset, the
 * same hour to buy — so they answer "how much is left" with one object rather than two that look
 * nearly alike. It lives in the note screen's dock, where this app keeps the controls belonging
 * to the screen you are on: a popover on the desktop, a dragged sheet on the phone.
 */
export type VoiceUsage = {
  remainingSeconds: number;
  limitSeconds: number;
  usedSeconds: number;
  creditSeconds: number;
  hasPaidAccess: boolean;
  hasUnlimitedUsage: boolean;
};

function UsageBar({
  percent,
  label,
  ariaLabel,
  className,
}: {
  percent: number;
  label: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      className={`note-read-usage-bar memo-tutor-bar ${className ?? ""}`.trim()}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={label}
    >
      <span className="note-read-usage-fill" style={{ width: `${percent}%` }} />
      <span className="memo-tutor-bar-label on-track" aria-hidden="true">
        {label}
      </span>
      <span
        className="memo-tutor-bar-label on-fill"
        aria-hidden="true"
        style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
      >
        {label}
      </span>
    </div>
  );
}

export function VoiceUsageSheet({
  usage,
  dockSlot,
  blocked,
  buyingCredits,
  onBuyCredits,
  extra,
}: {
  usage: VoiceUsage | null;
  dockSlot: HTMLElement | null;
  /** The feature has already refused for want of time, so the offer is made without opening it. */
  blocked?: boolean;
  buyingCredits?: boolean;
  onBuyCredits?: () => void;
  /** Settings belonging to the feature this meter is shown on, below the divider. */
  extra?: ReactNode;
}) {
  const t = useT();
  const [isOpen, setOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);

    if (menuRef.current) {
      menuRef.current.open = false;
    }
  }, []);
  const sheet = useSheet(close);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    /* A meter opened over a screen that then changes underneath it should not stay open. */
    return () => close();
  }, [isOpen, close]);

  if (!dockSlot) {
    return null;
  }

  /*
   * The bar shows what is LEFT rather than what is gone, because that is the question somebody
   * glancing at it is asking. The daily bar measures the daily allowance, which is not what
   * `remainingSeconds` counts — that includes topped-up time, so a day nearly spent with an hour
   * in the bank would otherwise show full. Credits have their own bar precisely because they are
   * not this.
   */
  const dailyRemaining = usage ? Math.max(usage.limitSeconds - usage.usedSeconds, 0) : 0;
  const remainingPercent = usage
    ? usage.hasUnlimitedUsage
      ? 100
      : usage.limitSeconds > 0
        ? Math.min(100, Math.max(0, Math.round((dailyRemaining / usage.limitSeconds) * 100)))
        : 0
    : 100;
  /* Red only when nothing is left anywhere — a spent day with credits in hand is fine. */
  const isOutOfTime = Boolean(usage && !usage.hasUnlimitedUsage && usage.remainingSeconds <= 0);
  /*
   * A share, never a number of minutes. How long somebody has left is a fact about the plan, and
   * putting it on the bar invites the arithmetic instead of the glance it is there for.
   */
  const barLabel = !usage ? "" : usage.hasUnlimitedUsage ? "∞" : `${remainingPercent}%`;
  const creditHours = usage ? Math.max(1, Math.ceil(usage.creditSeconds / 3600)) : 1;
  const creditPercent = usage
    ? Math.min(100, Math.max(0, Math.round((usage.creditSeconds / (creditHours * 3600)) * 100)))
    : 0;
  const creditLabel = usage ? `${Math.floor(usage.creditSeconds / 60)} min` : "";
  const triggerLabel = !usage ? "" : usage.hasUnlimitedUsage ? t("tutor.usage.unlimited") : `${remainingPercent}%`;

  const content = usage ? (
    <>
      {/* `data-drag-handle` is what lets a drag start here: useSheet ignores pointers that land
          on a button unless the button is the grabber. */}
      <button
        type="button"
        data-drag-handle="true"
        className="mobile-sheet-drag-handle note-read-usage-drag-handle"
        aria-label={t("folders.dragToClose")}
      />
      <div className="memo-tutor-usage-heading">{t("tutor.usage.title")}</div>
      <UsageBar percent={remainingPercent} label={barLabel} ariaLabel={t("tutor.usage.title")} />
      <div className="note-read-usage-reset">
        {usage.hasUnlimitedUsage
          ? t("tutor.usage.unlimited")
          : usage.hasPaidAccess
            ? t("tutor.usage.resetsAt")
            : t("tutor.usage.freeHint")}
      </div>

      {/*
        * Topped-up time gets its own bar, stacked under the daily one so the two read as a pair.
        * They are different things — the daily allowance refills at midnight whatever you do, and
        * this only ever goes down — so one bar would have two unrelated reasons to move.
        */}
      {usage.creditSeconds > 0 ? (
        <>
          <div className="memo-tutor-usage-subheading">{t("tutor.usage.creditsTitle")}</div>
          <UsageBar
            percent={creditPercent}
            label={creditLabel}
            ariaLabel={t("tutor.usage.creditsTitle")}
            className="memo-tutor-credit-bar"
          />
          <div className="note-read-usage-reset">{t("tutor.usage.creditsNote")}</div>
        </>
      ) : null}

      {extra ? (
        <>
          <div className="note-read-settings-divider" />
          {extra}
        </>
      ) : null}

      {/*
        * The offer lives in the same sheet as the number that explains why it is being made:
        * shown once there is nothing left, whether they arrived by running out or by opening the
        * meter to see how much was gone.
        */}
      {isOutOfTime || blocked ? (
        <>
          <div className="note-read-settings-divider" />
          <div className="memo-tutor-offer">
            <h2>{t(usage.hasPaidAccess ? "tutor.paywall.creditsTitle" : "tutor.paywall.trialTitle")}</h2>
            <p>{t(usage.hasPaidAccess ? "tutor.paywall.creditsBody" : "tutor.paywall.trialBody")}</p>
            {usage.hasPaidAccess ? (
              <button
                type="button"
                className="memo-tutor-start"
                disabled={buyingCredits}
                onClick={onBuyCredits}
              >
                {buyingCredits ? t("tutor.paywall.creditsPending") : t("tutor.paywall.creditsCta")}
              </button>
            ) : (
              <a className="memo-tutor-start" href="/app/settings">
                {t("tutor.paywall.trialCta")}
              </a>
            )}
          </div>
        </>
      ) : null}
    </>
  ) : null;

  /*
   * The pill is part of the screen rather than something that arrives with the numbers, so it is
   * drawn immediately and fills in when the allowance lands. Waiting for the fetch made it pop
   * into the dock a second late, which reads as a layout bug.
   */
  const meter = usage ? (
    <>
      <details
        ref={menuRef}
        className={`memo-tutor-usage-menu ${isOutOfTime ? "limit" : ""}`.trim()}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="memo-tutor-usage-trigger">
          <Msym name="schedule" size="1.05rem" fill={false} weight={500} />
          <span>{triggerLabel}</span>
        </summary>
        <div className="note-read-usage-popover note-read-usage-inline-popover">{content}</div>
      </details>

      {isOpen ? (
        <MemoPortal>
          <button
            type="button"
            className={sheetClass("note-read-usage-mobile-backdrop", sheet.closing)}
            onClick={() => sheet.dismiss()}
            aria-label={t("common.close")}
          />
          <div
            className={sheetClass("note-read-usage-popover note-read-usage-mobile-sheet", sheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-label={t("tutor.usage.title")}
            {...sheet.dragProps}
          >
            {content}
          </div>
        </MemoPortal>
      ) : null}
    </>
  ) : (
    <span className="memo-tutor-usage-menu">
      <span className="memo-tutor-usage-trigger is-loading" aria-hidden="true">
        <Msym name="schedule" size="1.05rem" fill={false} weight={500} />
        <span className="memo-tutor-usage-pending" />
      </span>
    </span>
  );

  return createPortal(meter, dockSlot);
}
