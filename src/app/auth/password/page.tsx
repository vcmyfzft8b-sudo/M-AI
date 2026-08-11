import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { getOptionalUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import { normalizeNextPath } from "@/lib/validation";

/**
 * Sign-in page for App Review.
 *
 * Not linked from anywhere in the product — reviewers reach it by URL with credentials supplied
 * in the review notes. See `src/app/auth/password/route.ts` for why it exists.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ next?: string; error?: string }>;

export default async function PasswordSignInPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const next = normalizeNextPath(params?.next);
  const user = await getOptionalUser();

  if (user) {
    redirect(next);
  }

  return (
    <main className="landing-shell landing-auth-page">
      <div className="landing-auth-wrap">
        <Link href="/" className="landing-auth-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo compact priority />
        </Link>

        <section className="landing-auth-hero">
          <h1 className="landing-auth-title">Prijava z geslom</h1>
          <p className="landing-auth-copy">Vpiši e-naslov in geslo svojega računa.</p>
        </section>

        <form method="post" action="/auth/password/submit" className="landing-auth-form">
          <input type="hidden" name="next" value={next} />

          <label htmlFor="password-email">E-naslov</label>
          <input
            id="password-email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />

          <label htmlFor="password-password">Geslo</label>
          <input
            id="password-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />

          {params?.error ? (
            <p className="ios-info ios-danger">Napačen e-naslov ali geslo.</p>
          ) : null}

          <button type="submit" className="landing-auth-submit">
            Prijavi se
          </button>
        </form>
      </div>
    </main>
  );
}
