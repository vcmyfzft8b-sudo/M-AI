"use client";

import Image from "next/image";
import { useCallback } from "react";

import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { HOME_SCREEN_STEPS, markInstallGuideSeen } from "@/lib/install-guide";

/**
 * How to keep Memo on the home screen.
 *
 * The screenshots and the wording are the onboarding paywall's — one set,
 * shared, so the two places that explain this cannot drift into explaining it
 * differently. They are real captures from a real iPhone, which is why they
 * carry a highlight box: pointing at the row beats describing where it is.
 *
 * iOS only, deliberately. These shots are of Safari, and Android's route is
 * different enough that showing an iPhone to an Android user would mislead
 * rather than help — the row that opens this is hidden there.
 *
 * There is no install button because iOS has no prompt to trigger. Showing
 * where the control lives is the only honest thing an app can do here.
 */
export function InstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
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
            Dodaj Memo med aplikacije: odpre se čez cel zaslon, brez vrstice brskalnika, in je
            vedno pri roki.
          </p>

          <ol className="memo-install-steps">
            {HOME_SCREEN_STEPS.map((step, index) => (
              <li key={step.title} className="memo-install-step">
                <div className="memo-install-step-head">
                  <span className="memo-install-step-number">{index + 1}</span>
                  <span className="memo-install-step-copy">
                    <span>{step.title}</span>
                    <span>{step.description}</span>
                  </span>
                </div>

                <div className="memo-install-shot">
                  <Image
                    src={step.src}
                    alt={step.alt}
                    width={390}
                    height={844}
                    sizes="(max-width: 1099px) 60vw, 15rem"
                  />
                  {"highlight" in step && step.highlight ? (
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
