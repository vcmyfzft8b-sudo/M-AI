import { NextRequest, NextResponse } from "next/server";

import { tr } from "@/lib/i18n/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Where Google's answer arrives on its way back into the app, and the reason
 * this page exists at all.
 *
 * `ASWebAuthenticationSession` ends when the browser navigates to the app's own
 * scheme, so the provider has to send it there. Asking Supabase to redirect
 * straight to `eu.memoai.memo.auth://…` made that redirect the one step nobody
 * could see: if it is refused, Supabase quietly falls back to the site URL and
 * the sheet lands on the ordinary web app — no callback, no error, nothing in
 * any log. So the provider returns here instead, to an ordinary HTTPS address
 * of the same kind the browser flow already uses.
 *
 * That alone was not enough. On the account holder's iPhone this page is now
 * reached on every attempt and the bounce into the app still never arrives, so
 * the code is also written down here for the web view inside the app to
 * collect. Both routes are offered: the bounce, which is instant when it
 * works, and the note, which does not depend on it. Whichever wins, the other
 * finds nothing left to spend.
 *
 * Nothing is read or granted here. The code is single use and bound by PKCE to
 * a verifier cookie held only in the app's own web view, which this page — a
 * different browser, with a different cookie jar — cannot see.
 */
const APP_CALLBACK = "eu.memoai.memo.auth://google/callback";
const STATE_PATTERN = /^[0-9a-f]{64}$/;

/** Opaque provider values are passed through, but only within sane bounds. */
function passthrough(value: string | null, maxLength: number) {
  return value && value.length <= maxLength ? value : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams;
  const target = new URL(APP_CALLBACK);
  // The state the app generated, echoed back by Supabase. Anything else is not
  // a callback of ours, and the app checks it again before spending the code.
  const state = parameters.get("state");
  const known = state && STATE_PATTERN.test(state) ? state : null;

  if (known) {
    target.searchParams.set("state", known);
  }

  const code = passthrough(parameters.get("code"), 4096);
  const error = code
    ? null
    // A provider failure travels too, rather than ending the sheet with
    // nothing to say.
    : passthrough(parameters.get("error"), 200) ?? "missing_code";
  const description = passthrough(parameters.get("error_description"), 300);

  if (code) {
    target.searchParams.set("code", code);
  } else {
    target.searchParams.set("error", error!);

    if (description) {
      target.searchParams.set("error_description", description);
    }
  }

  /*
   * The note for the app's web view. Only ever written against a state we
   * issued, so an address someone made up leaves nothing behind.
   */
  if (known) {
    try {
      await createSupabaseServiceRoleClient().rpc("record_mobile_oauth_handoff" as never, {
        handoff_state: known,
        handoff_code: code,
        handoff_error: code ? null : [error, description].filter(Boolean).join(": ").slice(0, 400),
      } as never);
    } catch {
      // The bounce below is still worth trying, and the app reports the
      // failure either way; a sign-in must not die because of bookkeeping.
    }
  }

  /*
   * Not a redirect: a redirect can only do one thing, and if the bounce is not
   * intercepted the sheet is left on a blank page with no way out. This does
   * the same navigation from script, and then says what is happening for the
   * case where nothing catches it — by which time the web view underneath has
   * usually finished signing in from the note above.
   */
  const location = escapeHtml(target.toString());
  const title = escapeHtml(await tr("auth.mobileCallback.title"));
  const body = escapeHtml(await tr("auth.mobileCallback.body"));
  const open = escapeHtml(await tr("auth.mobileCallback.open"));

  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title}</title><meta http-equiv="refresh" content="0;url=${location}">` +
      `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;gap:.75rem;` +
      `font:600 17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;` +
      `text-align:center;padding:2rem;color:#17171a;background:#f4f4f6}` +
      `@media(prefers-color-scheme:dark){body{color:#f4f4f6;background:#111113}}` +
      `a{color:#f45f5a}</style></head><body>` +
      `<p>${title}</p><p>${body}</p><p><a href="${location}">${open}</a></p>` +
      `<script>location.replace(${JSON.stringify(target.toString())})</script>` +
      `</body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // The code is in the query; keep it out of anybody else's referrer.
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
