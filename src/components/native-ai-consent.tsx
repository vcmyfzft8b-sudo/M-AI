"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";

export function NativeAIConsent() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mobile/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allow: true }) });
      if (!response.ok) throw new Error();
      window.location.assign("/app");
    } catch { setBusy(false); setError(t("common.somethingWentWrong")); }
  }
  return <section className="memo-native-paywall">
    <h1>{t("native.aiTitle")}</h1>
    <p>{t("native.aiBody")}</p>
    <p className="memo-fine-print">{t("native.aiControl")}</p>
    <Link href="/legal/privacy-policy" className="memo-underline-link">{t("legal.privacyInline")}</Link>
    <button type="button" className="memo-primary-pill" onClick={() => void accept()} disabled={busy}>{t("native.aiAllow")}</button>
    <form action="/auth/logout" method="post"><button type="submit" className="memo-confirm-cancel" disabled={busy}>{t("native.aiDecline")}</button></form>
    <Link href="/app/settings" className="memo-underline-link">{t("nav.settings")}</Link>
    {error ? <p role="status" className="memo-inline-error">{error}</p> : null}
  </section>;
}
