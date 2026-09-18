"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";

/**
 * The AI-processing gate the iOS app shows once, before the study screens.
 *
 * Drawn as an auth card — the same frame, mascot, copy and buttons as the
 * sign-in steps it follows — so it reads as one more step of the way in
 * rather than a different screen. Both choices lock the card while they run:
 * allowing posts the consent and moves on, declining signs out.
 */
export function NativeAIConsent() {
  const t = useT();
  const [pending, setPending] = useState<"allow" | "decline" | null>(null);
  const [error, setError] = useState("");

  async function allow() {
    if (pending) return;
    setPending("allow"); setError("");
    try {
      const response = await fetch("/api/mobile/consent", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allow: true }),
      });
      if (!response.ok) throw new Error();
      window.location.assign("/app");
    } catch { setPending(null); setError(t("common.somethingWentWrong")); }
  }

  return (
    <div className="memo-auth-card">
      <div className="memo-auth-head">
        <Image src="/memo-mascot.png" alt="" width={320} height={288} className="memo-auth-mascot" priority />
        <h1 className="memo-auth-title">{t("native.aiTitle")}</h1>
        <p className="memo-auth-copy long">{t("native.aiBody")}</p>
      </div>

      <p className="memo-auth-note">
        {t("native.aiControl")}{" "}
        <Link href="/legal/privacy-policy" className="memo-auth-inline-link">{t("legal.privacyInline")}</Link>
      </p>

      <div className="memo-auth-actions">
        <button
          type="button"
          className="memo-button-coral memo-auth-submit"
          onClick={() => void allow()}
          disabled={pending !== null}
          aria-busy={pending === "allow"}
        >
          {pending === "allow" ? <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" /> : null}
          <span>{t("native.aiAllow")}</span>
        </button>

        <form
          action="/auth/logout"
          method="post"
          className="memo-auth-provider-form"
          onSubmit={event => {
            if (pending) { event.preventDefault(); return; }
            setPending("decline");
          }}
        >
          <button
            type="submit"
            className="memo-button-outline memo-auth-resend"
            disabled={pending !== null}
            aria-busy={pending === "decline"}
          >
            {pending === "decline" ? <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" /> : null}
            <span>{t("native.aiDecline")}</span>
          </button>
        </form>

        <Link
          href="/app/settings"
          className="memo-auth-ghost"
          aria-disabled={pending !== null}
          onClick={event => { if (pending) event.preventDefault(); }}
        >
          {t("nav.settings")}
        </Link>
      </div>

      {error ? <p role="status" className="memo-auth-note error">{error}</p> : null}
    </div>
  );
}
