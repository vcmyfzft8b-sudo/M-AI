import Image from "next/image";
import { redirect } from "next/navigation";

import { NativeSubmitButton } from "@/components/admin/native-submit";
import { AuthScreen } from "@/components/auth-screen";
import { LandingAuthOptions } from "@/components/landing-auth-options";
import { getAdminContext } from "@/lib/admin/auth";
import { getAuthProviderAvailability } from "@/lib/auth-providers";

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
      <p className="memo-auth-notice" data-tone="error" role="status">
        <strong>Seznama skrbnikov ni bilo mogoče prebrati.</strong> To je napaka
        v nastavitvah, ne v tvojem računu — najverjetneje migracija{" "}
        <code>0027</code> še ni bila izvedena na tej bazi.
      </p>
    ) : result.reason === "not_allowlisted" ? (
      <p className="memo-auth-notice" data-tone="error" role="status">
        Prijavljen si kot <strong>{result.email}</strong>, ki nima skrbniškega
        dostopa. Prijavi se z dovoljenim e-naslovom ali prosi lastnika, da doda
        tvojega.
      </p>
    ) : null;

  return (
    <AuthScreen>
      {notice}

      <div className="memo-auth-card">
        <div className="memo-auth-head">
          <Image
            src="/memo-mascot.png"
            alt=""
            width={320}
            height={288}
            className="memo-auth-mascot"
            priority
          />
          <h1 className="memo-auth-title">Prijava</h1>
          <p className="memo-auth-copy long">
            Nadzorna plošča za kampanjo, prodajo in uporabnike.
          </p>
        </div>

        <LandingAuthOptions providers={providers} next="/admin" mode="login" />
      </div>

      {result.reason === "not_allowlisted" ? (
        // `/auth/logout` only accepts POST, so this has to be a form.
        <NativeSubmitButton
          action="/auth/logout"
          className="memo-auth-legal-button"
          formClassName="memo-auth-legal"
          pendingLabel="Odjavljam…"
        >
          Odjavi se in uporabi drug račun
        </NativeSubmitButton>
      ) : (
        <p className="memo-auth-legal">
          Dostop imajo samo e-naslovi na seznamu skrbnikov.
        </p>
      )}
    </AuthScreen>
  );
}
