import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/admin/auth";
import { getAuthProviderAvailability } from "@/lib/auth-providers";

type SearchParams = Promise<{ denied?: string }>;

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const result = await getAdminContext();

  if (result.ok) {
    redirect("/admin");
  }

  const params = await searchParams;
  const providers = await getAuthProviderAvailability();

  // Two different failures land here: nobody is signed in, or somebody is
  // signed in with an account that is not on the allowlist. Saying which one
  // it is saves a confusing loop of re-entering the same address.
  const denied = params?.denied === "1" || result.reason === "not_allowlisted";
  const signedInEmail = result.reason === "not_allowlisted" ? result.email : null;

  return (
    <main className="admin-login">
      <div className="admin-login-card">
        <h1 className="admin-login-title">Memo AI admin</h1>
        <p className="admin-login-sub">
          {denied
            ? "This account does not have admin access. Sign in with an allowlisted address, or ask the owner to add yours."
            : "Sign in with an allowlisted address to open the dashboard."}
        </p>

        {denied && signedInEmail && (
          <div className="admin-alert" data-tone="error">
            <span>
              Signed in as <strong>{signedInEmail}</strong>, which is not on the
              admin allowlist.
            </span>
          </div>
        )}

        {providers.google && (
          <>
            <form action="/auth/google" method="post">
              <input type="hidden" name="next" value="/admin" />
              <button
                type="submit"
                className="admin-button"
                data-variant="primary"
                style={{ width: "100%" }}
              >
                Continue with Google
              </button>
            </form>
            {providers.email && (
              <div className="admin-login-divider">or</div>
            )}
          </>
        )}

        {providers.email && (
          <form
            action="/auth/email"
            method="post"
            style={{ display: "grid", gap: "0.625rem" }}
          >
            <input type="hidden" name="mode" value="login" />
            <input type="hidden" name="next" value="/admin" />
            <div className="admin-field">
              <label className="admin-label" htmlFor="admin-email">
                Email
              </label>
              <input
                id="admin-email"
                className="admin-input"
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </div>
            <button type="submit" className="admin-button">
              Email me a sign-in code
            </button>
          </form>
        )}

        <div className="admin-help" style={{ marginTop: "1.25rem" }}>
          {denied ? (
            // `/auth/logout` only accepts POST, so this has to be a form.
            <form action="/auth/logout" method="post">
              <button type="submit" className="admin-button" data-variant="ghost" data-size="sm">
                Sign out and use another account
              </button>
            </form>
          ) : (
            <Link className="admin-link" href="/">
              Back to memoai.eu
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
