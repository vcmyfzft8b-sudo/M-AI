import type { ReactNode } from "react";

import { AuthBackLink } from "@/components/auth-back-link";
import { headers } from "next/headers";
import { isNativeUserAgent } from "@/lib/mobile/runtime";

/**
 * The frame every auth screen sits in: the header row, then a centred stage.
 *
 * Auth is outside the app shell — there is no rail and no chat column — so the
 * 1100px breakpoint is not a layout change here. The same header and the same
 * `min(100%, 28rem)` card serve every width; only type and padding step up.
 *
 * The header carries only the back control: the card below already shows the
 * mascot, so a second brand mark in the corner said nothing twice.
 *
 * Where the arrow leads is the page's call. The chooser's default is the
 * landing page, which the iOS app does not have (the wrapper opens sign-in
 * directly and rewrites "/" back to it), so there the app draws an empty band
 * that keeps the card at the same height. A page that names a target — the
 * e-mail steps go back to the chooser — gets the arrow on both platforms, and
 * `back={false}` removes it where there is nothing to go back to.
 */
export async function AuthScreen({
  backHref = "/",
  back,
  children,
}: {
  backHref?: string;
  back?: boolean;
  children: ReactNode;
}) {
  const native = isNativeUserAgent((await headers()).get("user-agent"));
  const showBack = back ?? (native ? backHref !== "/" : true);

  return (
    <main className="memo memo-auth">
      <header className="memo-auth-header">
        {showBack ? <AuthBackLink href={backHref} /> : <span className="memo-auth-header-gap" aria-hidden="true" />}
      </header>

      <div className="memo-auth-stage">{children}</div>
    </main>
  );
}
