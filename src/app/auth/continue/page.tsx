import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { BrandLogo } from "@/components/brand-logo";
import { LandingAuthOptions } from "@/components/landing-auth-options";
import {
  getAuthProviderAvailability,
  getIosAppReviewSafeAuthProviders,
} from "@/lib/auth-providers";
import { getOptionalUser } from "@/lib/auth";
import {
  BRAND_NAME,
  PUBLIC_PRIVACY_POLICY_PATH,
  PUBLIC_TERMS_OF_USE_PATH,
} from "@/lib/brand";
import { isMemoIosAppUserAgent } from "@/lib/native-platform";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

export default async function ContinuePage() {
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  const requestHeaders = await headers();
  const isIosApp = isMemoIosAppUserAgent(requestHeaders.get("user-agent"));

  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  const authProviders = hasPublicSupabaseEnv
    ? await getAuthProviderAvailability()
    : { apple: false, email: false, google: false };
  const providers = isIosApp
    ? getIosAppReviewSafeAuthProviders(authProviders)
    : authProviders;

  return (
    <main className="landing-shell landing-auth-page">
      <div className="landing-auth-wrap">
        <Link href="/" className="landing-auth-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo compact imageSizes="(max-width: 768px) 4.6rem, 7rem" priority />
        </Link>

        <section className="landing-auth-hero">
          <h1 className="landing-auth-title">Prijava</h1>
          <p className="landing-auth-copy">Prijavi se ali ustvari nov račun.</p>
        </section>

        <LandingAuthOptions providers={providers} next="/app/start" />

        <p className="landing-auth-legal">
          Z nadaljevanjem se strinjaš s {`${BRAND_NAME}`}{" "}
          <Link href={PUBLIC_TERMS_OF_USE_PATH}>pogoji uporabe</Link> in{" "}
          <Link href={PUBLIC_PRIVACY_POLICY_PATH}>politiko zasebnosti</Link>, vključno z AI
          obdelavo zvoka, besedila, dokumentov in povezav. Potrjuješ tudi, da imaš
          potrebna dovoljenja za snemanje, nalaganje in uporabo gradiva, ki ga pošlješ
          v Memo.
        </p>

        {!hasPublicSupabaseEnv ? (
          <div className="dashboard-surface-card landing-env-warning">
            <p className="ios-info ios-danger">
              {isVercelPreview
                ? "Vercel Preview nima nastavljenih `NEXT_PUBLIC_SUPABASE_URL` in/ali `NEXT_PUBLIC_SUPABASE_ANON_KEY`."
                : "Manjkajo javne `Supabase` okoljske spremenljivke. Izpolni `.env.local`."}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
