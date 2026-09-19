"use client";

import { useT } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";

export function AppleBillingTerms({ busy, onRestore }: { busy: boolean; onRestore: () => void }) {
  const t = useT();
  // One short disclosure and the three links Apple expects next to the
  // purchase button; the full renewal wording lives in the App Store listing
  // and the plan cards state the period and price. Kept small so the paywall
  // still lands on one viewport like the web one.
  return <div className="memo-apple-billing-terms">
    <p>{t("native.renewalShort")}</p>
    <div>
      <button type="button" disabled={busy} onClick={onRestore}>{t("native.restore")}</button>
      <InstantLink href="/legal/terms-of-use">{t("legal.termsInline")}</InstantLink>
      <InstantLink href="/legal/privacy-policy">{t("legal.privacyInline")}</InstantLink>
    </div>
  </div>;
}
