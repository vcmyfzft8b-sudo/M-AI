"use client";

import Link from "next/link";
import { useT } from "@/components/i18n-provider";

export function AppleBillingTerms({ busy, onRestore }: { busy: boolean; onRestore: () => void }) {
  const t = useT();
  return <div className="memo-apple-billing-terms">
    <p>{t("native.renewal")}</p>
    <div>
      <button type="button" disabled={busy} onClick={onRestore}>{t("native.restore")}</button>
      <Link href="/legal/terms-of-use">{t("legal.termsInline")}</Link>
      <Link href="/legal/privacy-policy">{t("legal.privacyInline")}</Link>
    </div>
  </div>;
}
