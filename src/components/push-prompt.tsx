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
  /*
   * Deliberately not `locked` while the request runs.
   *
   * `useSheet` reads its lock through a ref that is only updated in an effect,
   * so clearing the flag and dismissing in the same tick dismisses against the
   * *previous* render's lock — the sheet refuses, and sits there behind the
   * iOS alert looking like a button that did nothing. Pressing again does
   * nothing either, because by then iOS has an answer on file and there is no
   * second prompt to show. Nothing here needs the lock: both buttons guard
   * themselves, and a reader who swipes the sheet away mid-request has
   * answered it just as clearly.
   */
  const sheet = useSheet(close);

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

  function allow() {
    if (pending) return;
    setPending(true);
    /*
     * Closed on the press, not on the reply.
     *
     * iOS puts its own permission alert over the screen the instant this is
     * called, and that alert is the question now — whichever way it is
     * answered, this sheet has said its piece. Waiting for the round trip
     * before closing means coming back from the alert to a sheet still
     * sitting there, which is the one thing it must not do.
     */
    sheet.dismiss();
    // Allowed or declined, there is no second ask to offer and nothing here
    // to report: iOS owns the answer from this point.
    void nativeRequest("enablePushNotifications").catch(() => {});
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
