"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { nativeRequest } from "@/lib/mobile/client";

/**
 * Asking to be allowed to say when the note is finished.
 *
 * Timing is the whole design here. iOS gives an app exactly one chance to ask —
 * a decline is final, and only the Settings app can undo it — so the question
 * waits for the one moment it answers itself: a note is generating, the reader
 * is watching a progress bar, and "shall we tell you when it's done?" is the
 * thing they already want. Asking at launch spends that single chance on a
 * question about nothing.
 */

/** The bridge version that added the notification commands. */
const PUSH_BRIDGE_VERSION = 3;

/**
 * Asked once per install, remembered here rather than server-side: the answer
 * belongs to this phone, iOS already holds the real one, and a reader who said
 * no should not be asked again by every note they make.
 */
const ASKED_KEY = "memo.push.asked";

function available() {
  return typeof window !== "undefined" && (window.memoNative?.version ?? 0) >= PUSH_BRIDGE_VERSION;
}

function alreadyAsked() {
  try {
    return window.localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    // A private window, or site data switched off. Treat it as asked: better
    // to skip the prompt than to show it on every note.
    return true;
  }
}

function rememberAsked() {
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
  } catch { /* Nothing to remember it with; the session's own state still holds. */ }
}

export function PushPrompt({ active }: { active: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const sheet = useSheet(close, { locked: pending });

  useEffect(() => {
    if (!active || !available() || alreadyAsked()) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await nativeRequest<{ authorized: boolean; canAsk: boolean }>("pushStatus");
        // `canAsk` is false once iOS has an answer on file, in either
        // direction. Nothing this sheet can do would change it.
        if (cancelled || !status.canAsk) return;
        // Marked before the sheet is shown, not after it is answered: a reader
        // who swipes it away has answered it too.
        rememberAsked();
        setOpen(true);
      } catch { /* An older build, or the bridge refused. Stay quiet. */ }
    })();
    return () => { cancelled = true; };
  }, [active]);

  async function allow() {
    if (pending) return;
    setPending(true);
    try {
      await nativeRequest("enablePushNotifications");
    } catch {
      // Declined at the iOS prompt, or the token could not be registered.
      // Either way the sheet has said its piece and closes; there is no
      // second ask to offer.
    } finally {
      setPending(false);
      sheet.dismiss();
    }
  }

  if (!open) return null;

  return (
    <MemoPortal>
      <button
        type="button"
        aria-label={t("common.close")}
        className={sheetClass("memo-scrim", sheet.closing)}
        onClick={() => sheet.dismiss()}
        disabled={pending}
      />
      <div
        className={sheetClass("memo-confirm memo-confirm-fixed", sheet.closing)}
        role="dialog"
        aria-modal="true"
        {...sheet.dragProps}
      >
        <div className="memo-grab" data-drag-handle />
        <span className="memo-confirm-tile">
          <Emoji symbol="🔔" size="1.4rem" />
        </span>
        <h2>{t("push.enableTitle")}</h2>
        <p>{t("push.enableBody")}</p>
        <div className="memo-confirm-actions">
          <button
            type="button"
            className="memo-confirm-cancel"
            onClick={() => sheet.dismiss()}
            disabled={pending}
          >
            {t("push.enableSkip")}
          </button>
          <button
            type="button"
            className="memo-confirm-go"
            onClick={allow}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t("push.enableAllow")}
          </button>
        </div>
      </div>
    </MemoPortal>
  );
}
