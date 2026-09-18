import { NextRequest, NextResponse } from "next/server";

/**
 * The last hop of the app's Google sign-in, and the reason it is here.
 *
 * `ASWebAuthenticationSession` ends when the browser navigates to the app's
 * own scheme, so the provider has to send it there. Asking Supabase to
 * redirect straight to `eu.memoai.memo.auth://…` made that redirect the one
 * step nobody could see: if it is refused, Supabase falls back to the site URL
 * and the sheet quietly lands on the ordinary web app instead — no error, no
 * callback, and a session that can only be closed by hand. That is exactly
 * what the app did.
 *
 * So the provider now returns to this ordinary HTTPS page — the same kind of
 * address as the browser flow's callback, which Supabase has always accepted —
 * and the page bounces to the app scheme itself. The redirect the session
 * watches for is now ours to make, and its absence shows up in the request log
 * like any other page.
 *
 * Nothing is read or written here: the authorization code is single-use and
 * bound by PKCE to the verifier cookie held in the app's own web view, which
 * this page cannot see. It is carried across, and `/api/mobile/google-auth`
 * finishes the exchange there.
 */
const APP_CALLBACK = "eu.memoai.memo.auth://google/callback";

/** Opaque provider values are passed through, but only within sane bounds. */
function passthrough(value: string | null, maxLength: number) {
  return value && value.length <= maxLength ? value : null;
}

export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams;
  const target = new URL(APP_CALLBACK);
  // The state the app generated, echoed by Supabase. Anything else is not a
  // callback of ours, and the app checks it again before spending the code.
  const state = parameters.get("state");

  if (state && /^[0-9a-f]{64}$/.test(state)) {
    target.searchParams.set("state", state);
  }

  const code = passthrough(parameters.get("code"), 4096);
  const error = passthrough(parameters.get("error"), 200);

  if (code) {
    target.searchParams.set("code", code);
  } else {
    // A provider failure travels too: the app turns it into the reason it
    // shows, instead of a session that ends with nothing to say.
    target.searchParams.set("error", error ?? "missing_code");
    const description = passthrough(parameters.get("error_description"), 300);

    if (description) {
      target.searchParams.set("error_description", description);
    }
  }

  const location = target.toString();

  /*
   * The body is for the case this page is opened outside the app — a link
   * pasted into a browser, a provider that follows redirects itself. There the
   * scheme leads nowhere and a blank page would be the whole explanation.
   */
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Memo</title><p>Returning to Memo…`,
    {
      status: 302,
      headers: {
        Location: location,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // The code is in the query; keep it out of anybody else's referrer.
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
