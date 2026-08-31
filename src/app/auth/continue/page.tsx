import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LandingAuthOptions } from "@/components/landing-auth-options";
import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { getOptionalUser } from "@/lib/auth";
import { getTranslations } from "@/lib/i18n/server";
import { BRAND_NAME } from "@/lib/brand";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

export default async function ContinuePage() {
  const isVercelPreview = process.env.VERCEL_ENV === "preview";

  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  const { t } = await getTranslations();
  const providers = hasPublicSupabaseEnv
    ? await getAuthProviderAvailability()
    : { apple: false, email: false, google: false };

  return (
    <main className="landing-shell landing-auth-page">
      <div className="landing-auth-wrap">
        <Link href="/" className="landing-auth-brand" aria-label={t("nav.homeBrand", { brand: BRAND_NAME })}>
          <BrandLogo compact priority />
        </Link>

        <section className="landing-auth-hero">
          <h1 className="landing-auth-title">{t("auth.signIn")}</h1>
          <p className="landing-auth-copy">{t("auth.continue.copy")}</p>
        </section>

        <LandingAuthOptions providers={providers} next="/app/start" />

        <p className="landing-auth-legal">
          {t("auth.legalBefore", { brand: BRAND_NAME })}
          <Link href="/legal/terms-of-use">{t("legal.termsInline")}</Link>
          {t("auth.legalAnd")}
          <Link href="/legal/privacy-policy">{t("legal.privacyInline")}</Link>
          {t("auth.legalAfterContinue")}
        </p>

        {!hasPublicSupabaseEnv ? (
          <div className="dashboard-surface-card landing-env-warning">
            <p className="ios-info ios-danger">
              {t(isVercelPreview ? "env.missingPreview" : "env.missingLocal")}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
