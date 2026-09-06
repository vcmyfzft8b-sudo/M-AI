import Link from "next/link";
import type { ReactNode } from "react";

import { AuthBackLink } from "@/components/auth-back-link";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND_NAME } from "@/lib/brand";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The frame every auth screen sits in: the header row, then a centred stage.
 *
 * Auth is outside the app shell — there is no rail and no chat column — so the
 * 1100px breakpoint is not a layout change here. The same header and the same
 * `min(100%, 28rem)` card serve every width; only type and padding step up.
 *
 * The back control leads the row and the lockup trails it on the phone, because
 * the thing you might press belongs where a thumb already is. On desktop the
 * two lead the row together.
 */
export async function AuthScreen({
  backHref = "/",
  children,
}: {
  backHref?: string;
  children: ReactNode;
}) {
  const { t } = await getTranslations();

  return (
    <main className="memo memo-auth">
      <header className="memo-auth-header">
        <AuthBackLink href={backHref} />

        <Link
          href="/"
          className="memo-auth-lockup"
          aria-label={t("nav.homeBrand", { brand: BRAND_NAME })}
        >
          <BrandLogo compact priority />
        </Link>

        <span className="memo-auth-header-gap" aria-hidden="true" />
      </header>

      <div className="memo-auth-stage">{children}</div>
    </main>
  );
}
