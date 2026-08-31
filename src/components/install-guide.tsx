"use client";

import { useT } from "@/components/i18n-provider";
import { InstallShot } from "@/components/install-shot";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { HOME_SCREEN_STEPS } from "@/lib/install-guide";

/**
 * How to keep Memo on the home screen.
 *
 * The screenshots and the wording are the onboarding paywall's — one set,
 * shared, so the two places that explain this cannot drift into explaining it
 * differently. They are real captures from a real iPhone, which is why they
 * carry a highlight box: pointing at the row beats describing where it is.
 *
 * Android sees the same shots. The control sits behind a different menu there,
 * but it is named the same and the destination is identical, so the pictures
 * still show what the person is looking for.
 *
 * There is no install button because iOS has no prompt to trigger. Showing
 * where the control lives is the only honest thing an app can do here.
 */
export function InstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const sheet = useSheet(onClose, { scrollable: true });

  if (!open) {
    return null;
  }

  return (
    <MemoPortal>
      <button
        type="button"
        aria-label={t("common.close")}
        className={sheetClass("memo-scrim", sheet.closing)}
        onClick={() => sheet.dismiss()}
      />
      <div
        className={sheetClass("memo-sheet-full memo-install-sheet", sheet.closing)}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.install.ctaTitle")}
        {...sheet.dragProps}
      >
        <div className="memo-grab-wide" data-drag-handle>
          <span />
        </div>

        <div className="memo-install-head" data-drag-zone>
          <span className="memo-install-title">{t("install.sheetTitle")}</span>
          <button
            type="button"
            aria-label={t("common.close")}
            className="memo-close-button"
            onClick={() => sheet.dismiss()}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>

        <div className="memo-install-body memo-scroll">
          <p className="memo-install-lead">
            {t("install.lead")}
          </p>

          <ol className="memo-install-steps">
            {HOME_SCREEN_STEPS.map((step, index) => (
              <li key={step.titleKey} className="memo-install-step">
                <div className="memo-install-step-head">
                  <span className="memo-install-step-number">{index + 1}</span>
                  <span className="memo-install-step-copy">
                    <span>{t(step.titleKey)}</span>
                    <span>{t(step.descriptionKey)}</span>
                  </span>
                </div>

                <div className="memo-install-shot">
                  <InstallShot step={step} sizes="(max-width: 1099px) 60vw, 15rem" />
                  {step.highlight ? (
                    <span className="memo-install-highlight" style={step.highlight} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </MemoPortal>
  );
}
