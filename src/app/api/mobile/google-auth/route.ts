import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { applySignInLocale } from "@/lib/i18n/sign-in-locale";

const stateCookie = "memo-google-state";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/api/mobile/google-auth" };
const statePattern = /^[0-9a-f]{64}$/;
const schema = z.object({ code: z.string().min(1).max(4096), state: z.string().regex(statePattern) }).strict();
const noStore = { "Cache-Control": "no-store" };
/** Generous: the page asks about once a second while the sign-in sheet is up. */
const pollLimit = [{ windowSeconds: 300, maxRequests: 400, scope: "ip" as const, storage: "memory" as const }];

async function enabled() {
  return process.env.NATIVE_GOOGLE_SIGN_IN_ENABLED === "true" && (await getAuthProviderAvailability()).google;
}

// PKCE starts in the WKWebView cookie jar; only the provider interaction leaves
// for ASWebAuthenticationSession. Its callback carries a one-use code, not tokens.
//
// The provider returns to an ordinary HTTPS page of ours, which both bounces to
// the app's scheme and writes the code down for this route to collect (see
// /auth/mobile-callback). Supabase used to be asked to redirect to that scheme
// itself, and when it would not, it fell back to the site URL: the sheet landed
// on the plain web app and nothing was ever reported. The bounce that replaced
// it is reached on every attempt but does not always arrive in the app, so the
// page inside the web view asks here instead — `?poll=1` below.
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!await enabled()) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  if (request.nextUrl.searchParams.get("poll") === "1") return collect(request);

  const limited = await enforceRateLimit({ request, route: "auth:google:native:start", rules: rateLimitPresets.authOAuth });
  if (limited) return limited;
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const state = randomBytes(32).toString("hex");
  const redirect = new URL("/auth/mobile-callback", request.nextUrl.origin);
  redirect.searchParams.set("state", state);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google", options: { redirectTo: redirect.toString(), skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) return NextResponse.json({ error: "Unavailable" }, { status: 503, headers: noStore });
  const response = applyCookies(NextResponse.json({ url: data.url, state }, { headers: noStore }));
  response.cookies.set(stateCookie, state, { ...cookieOptions, secure: request.nextUrl.protocol === "https:", maxAge: 600 });
  return response;
}

/**
 * The page in the app's web view asking whether the sheet has finished.
 *
 * The answer is only ever the one left for this cookie jar: the state cookie
 * set when the flow began names it, and the code it points at is worthless
 * without the PKCE verifier cookie sitting beside it. Claiming spends the note,
 * so a code is exchanged once and a second asker finds nothing.
 */
async function collect(request: NextRequest) {
  const limited = await enforceRateLimit({ request, route: "auth:google:native:poll", rules: pollLimit });
  if (limited) return limited;
  const state = request.cookies.get(stateCookie)?.value;
  if (!state || !statePattern.test(state)) return NextResponse.json({ status: "idle" }, { headers: noStore });

  let claimed: { code: string | null; error: string | null } | null = null;
  try {
    const { data } = await createSupabaseServiceRoleClient()
      .rpc("claim_mobile_oauth_handoff" as never, { handoff_state: state } as never);
    claimed = (data as { code: string | null; error: string | null }[] | null)?.[0] ?? null;
  } catch {
    // The sheet may still hand the code over directly; say nothing has
    // happened rather than ending a sign-in that is still running.
    return NextResponse.json({ status: "pending" }, { headers: noStore });
  }

  if (!claimed) return NextResponse.json({ status: "pending" }, { headers: noStore });
  if (!claimed.code) return endFlow(request, NextResponse.json({ status: "failed" }, { status: 200, headers: noStore }));
  return finish(request, claimed.code);
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!await enabled()) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const limited = await enforceRateLimit({ request, route: "auth:google:native:finish", rules: rateLimitPresets.authVerify });
  if (limited) return limited;
  const parsed = await parseJsonRequest(request, schema, { maxBytes: 8 * 1024 });
  if (!parsed.success) return parsed.response;
  if (parsed.data.state !== request.cookies.get(stateCookie)?.value) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  return finish(request, parsed.data.code, true);
}

/** Clears the challenge, so a spent or failed flow cannot be replayed. */
function endFlow(request: NextRequest, response: NextResponse) {
  response.cookies.set(stateCookie, "", { ...cookieOptions, maxAge: 0 });
  return response;
}

/**
 * Exchanges the code in this cookie jar and keeps the session only if it
 * belongs to the account that started the flow.
 */
async function finish(request: NextRequest, code: string, fromApp = false) {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: previous } = await supabase.auth.getUser();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const valid = !error && data.session && data.user && !accountDeletionRequested(data.user)
    && data.user.identities?.some(identity => identity.provider === "google")
    && (!previous.user || previous.user.id === data.user.id);
  if (!valid && data.session) await supabase.auth.signOut({ scope: "local" });
  const failure = fromApp ? { error: "Google sign-in could not be completed" } : { status: "failed" };
  const response = endFlow(request, applyCookies(NextResponse.json(
    valid ? (fromApp ? { signedIn: true } : { status: "signedIn" }) : failure,
    { status: valid || !fromApp ? 200 : 401, headers: noStore })));
  if (!valid && data.session) {
    const names = new Set([...request.cookies.getAll(), ...response.cookies.getAll()].map(cookie => cookie.name));
    for (const name of names) if (name.startsWith("sb-")) response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return valid ? applySignInLocale(request, response, data.user!.id) : response;
}
