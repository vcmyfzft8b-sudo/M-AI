"use client";

import { useState } from "react";
import { useAnalyticsConsent } from "@/components/optional-analytics";
import { useTranslations } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { setAnalyticsConsent } from "@/lib/analytics-consent";

export function AnalyticsSettings() {
  const { t } = useTranslations();
  const allowed = useAnalyticsConsent();
  const [failed, setFailed] = useState(false);
  return <div className="memo-card-row memo-settings-analytics">
    <div className="memo-card-row-copy">
      <span id="analytics-title" className="memo-card-row-title">{t("settings.analytics.title")}</span>
      <span id="analytics-detail" className="memo-card-row-detail">{t("settings.analytics.detail")}</span>
      <InstantLink href="/legal/privacy-policy" className="memo-fine-print-link">{t("landing.footer.privacy")}</InstantLink>
      {failed ? <p role="alert" className="memo-inline-error">{t("settings.analytics.saveFailed")}</p> : null}
    </div>
    <button type="button" role="switch" aria-checked={allowed}
      aria-labelledby="analytics-title" aria-describedby="analytics-detail"
      className={`memo-switch${allowed ? " on" : ""}`}
      onClick={() => setFailed(!setAnalyticsConsent(!allowed))}><span /></button>
  </div>;
}
