import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthProviderAvailability } from "@/lib/auth-providers";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { applySignInLocale } from "@/lib/i18n/sign-in-locale";

const stateCookie = "memo-google-state";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/api/mobile/google-auth" };
const schema = z.object({ code: z.string().min(1).max(4096), state: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const noStore = { "Cache-Control": "no-store" };

async function enabled() {
  return process.env.NATIVE_GOOGLE_SIGN_IN_ENABLED === "true" && (await getAuthProviderAvailability()).google;
}

// PKCE starts in the WKWebView cookie jar; only the provider interaction leaves
// for ASWebAuthenticationSession. Its callback carries a one-use code, not tokens.
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!await enabled()) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const limited = await enforceRateLimit({ request, route: "auth:google:native:start", rules: rateLimitPresets.authOAuth });
  if (limited) return limited;
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const state = randomBytes(32).toString("hex");
  const redirect = new URL("eu.memoai.memo.auth://google/callback");
  redirect.searchParams.set("state", state);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google", options: { redirectTo: redirect.toString(), skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) return NextResponse.json({ error: "Unavailable" }, { status: 503, headers: noStore });
  const response = applyCookies(NextResponse.json({ url: data.url, state }, { headers: noStore }));
  response.cookies.set(stateCookie, state, { ...cookieOptions, secure: request.nextUrl.protocol === "https:", maxAge: 600 });
  return response;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!await enabled()) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const limited = await enforceRateLimit({ request, route: "auth:google:native:finish", rules: rateLimitPresets.authVerify });
  if (limited) return limited;
  const parsed = await parseJsonRequest(request, schema, { maxBytes: 8 * 1024 });
  if (!parsed.success) return parsed.response;
  if (parsed.data.state !== request.cookies.get(stateCookie)?.value) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: previous } = await supabase.auth.getUser();
  const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.data.code);
  const valid = !error && data.session && data.user && !accountDeletionRequested(data.user)
    && data.user.identities?.some(identity => identity.provider === "google")
    && (!previous.user || previous.user.id === data.user.id);
  if (!valid && data.session) await supabase.auth.signOut({ scope: "local" });
  const response = applyCookies(NextResponse.json(valid ? { signedIn: true } : { error: "Google sign-in could not be completed" },
    { status: valid ? 200 : 401, headers: noStore }));
  response.cookies.set(stateCookie, "", { ...cookieOptions, maxAge: 0 });
  if (!valid && data.session) {
    const names = new Set([...request.cookies.getAll(), ...response.cookies.getAll()].map(cookie => cookie.name));
    for (const name of names) if (name.startsWith("sb-")) response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return valid ? applySignInLocale(request, response, data.user!.id) : response;
}
