import Link from "next/link";
import { AlertCircle, ChevronLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { BRAND_NAME } from "@/lib/brand";
import { getTranslations } from "@/lib/i18n/server";
import { sanitizeUserInput } from "@/lib/validation";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { t } = await getTranslations();
  const params = await searchParams;
  const message = typeof params.message === "string"
    ? sanitizeUserInput(params.message).slice(0, 240)
    : undefined;

  return (
    <main className="landing-shell auth-shell">
      <header className="ios-nav landing-nav">
        <div className="ios-nav-inner landing-nav-inner">
          <Link href="/" className="landing-brand-link" aria-label={t("nav.homeBrand", { brand: BRAND_NAME })}>
            <BrandLogo compact />
          </Link>

          <div className="landing-nav-actions">
            <Link href="/" className="app-back-button">
              <ChevronLeft className="h-5 w-5" />
              {t("common.back")}
            </Link>
          </div>
        </div>
      </header>

      <div className="ios-content">
        <section className="auth-stage">
          <div className="auth-panel">
            <div className="auth-check-icon error">
              <AlertCircle className="h-6 w-6" />
            </div>
            <p className="auth-eyebrow">{t("auth.error.eyebrow")}</p>
            <h1 className="auth-title">{t("auth.error.title")}</h1>
            <p className="auth-copy">{message ?? t("auth.error.copy")}</p>

            {/* One door: `/auth/continue` offers signing in and signing up
                together, so a second button here would only be the same page
                under a different name. */}
            <div className="auth-check-actions">
              <Link href="/auth/continue" className="ios-primary-button auth-submit-button">
                {t("auth.error.backToLogin")}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
