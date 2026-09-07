import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
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
    <AuthScreen>
      <div className="memo-auth-card">
        {/* One door for signing in and signing up, so there is no second
            screen to label — the eyebrow that names which of the two you are
            on would only repeat the title here. */}
        <div className="memo-auth-head">
          <Image
            src="/memo-mascot.png"
            alt=""
            width={320}
            height={288}
            className="memo-auth-mascot"
            priority
          />
          <h1 className="memo-auth-title">{t("auth.signIn")}</h1>
          <p className="memo-auth-copy">{t("auth.continue.copy")}</p>
        </div>

        <LandingAuthOptions providers={providers} next="/app/start" />
      </div>

      <p className="memo-auth-legal">
        {t("auth.legalBefore", { brand: BRAND_NAME })}
        <Link href="/legal/terms-of-use">{t("legal.termsInline")}</Link>
        {t("auth.legalAnd")}
        <Link href="/legal/privacy-policy">{t("legal.privacyInline")}</Link>
        {t("auth.legalAfterContinue")}
      </p>

      {!hasPublicSupabaseEnv ? (
        <p className="memo-auth-notice" data-tone="error" role="status">
          {t(isVercelPreview ? "env.missingPreview" : "env.missingLocal")}
        </p>
      ) : null}
    </AuthScreen>
  );
}
