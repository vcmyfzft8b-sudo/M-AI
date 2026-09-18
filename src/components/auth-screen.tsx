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
 * mascot, so a second brand mark in the corner said nothing twice. The app has
 * no landing page to go back to, so its header is an empty band that keeps the
 * card at the same height as on the web.
 */
export async function AuthScreen({
  backHref = "/",
  children,
}: {
  backHref?: string;
  children: ReactNode;
}) {
  // The iOS app has no landing page: the wrapper opens sign-in directly and
  // rewrites "/" back to it, so a back arrow would only lead to itself.
  const native = isNativeUserAgent((await headers()).get("user-agent"));

  return (
    <main className="memo memo-auth">
      <header className="memo-auth-header">
        {native ? <span className="memo-auth-header-gap" aria-hidden="true" /> : <AuthBackLink href={backHref} />}
      </header>

      <div className="memo-auth-stage">{children}</div>
    </main>
  );
}
