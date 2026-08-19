import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LandingAuthOptions } from "@/components/landing-auth-options";
import { getAdminContext } from "@/lib/admin/auth";
import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { BRAND_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * The admin sign-in screen.
 *
 * Deliberately the same page users see at `/auth/continue` — same brand mark,
 * same provider buttons, same layout — so there is one login design to keep up
 * rather than two. The only differences are the copy, the `next` target, and
 * the notice explaining why an attempt was turned away.
 */
export default async function AdminLoginPage() {
  const result = await getAdminContext();

  if (result.ok) {
    redirect("/admin");
  }

  const providers = await getAuthProviderAvailability();

  // Three different things land here and they need different wording: nobody is
  // signed in, somebody is signed in with an address that is not allowlisted,
  // or the allowlist itself could not be read. Reporting that last one as "you
  // are not allowed" sends people hunting for a permissions problem that does
  // not exist.
  const notice =
    result.reason === "lookup_failed" ? (
      <p className="landing-auth-notice" data-tone="error" role="status">
        <strong>Seznama skrbnikov ni bilo mogoče prebrati.</strong> To je napaka
        v nastavitvah, ne v tvojem računu — najverjetneje migracija{" "}
        <code>0027</code> še ni bila izvedena na tej bazi.
      </p>
    ) : result.reason === "not_allowlisted" ? (
      <p className="landing-auth-notice" data-tone="error" role="status">
        Prijavljen si kot <strong>{result.email}</strong>, ki nima skrbniškega
        dostopa. Prijavi se z dovoljenim e-naslovom ali prosi lastnika, da doda
        tvojega.
      </p>
    ) : null;

  return (
    <main className="landing-shell landing-auth-page">
      <div className="landing-auth-wrap">
        <Link href="/" className="landing-auth-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo compact priority />
        </Link>

        <section className="landing-auth-hero">
          <h1 className="landing-auth-title">Prijava</h1>
          <p className="landing-auth-copy">
            Nadzorna plošča za kampanjo, prodajo in uporabnike.
          </p>
        </section>

        {notice}

        <LandingAuthOptions providers={providers} next="/admin" mode="login" />

        {result.reason === "not_allowlisted" ? (
          // `/auth/logout` only accepts POST, so this has to be a form.
          <form action="/auth/logout" method="post" className="landing-auth-legal">
            <button type="submit" className="landing-auth-signout">
              Odjavi se in uporabi drug račun
            </button>
          </form>
        ) : (
          <p className="landing-auth-legal">
            Dostop imajo samo e-naslovi na seznamu skrbnikov.
          </p>
        )}
      </div>
    </main>
  );
}
