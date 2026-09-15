import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { applySignInLocale } from "@/lib/i18n/sign-in-locale";
import { appleSignInConfigured, exchangeAppleCode, nativeAppleClientID, revokeAppleToken, sealAppleToken, verifyAppleIdentity } from "@/lib/mobile/apple-identity";

const nonceCookie = "memo-apple-nonce";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/api/mobile/apple-auth" };
const schema = z.object({ identityToken: z.string().min(1).max(16_384), authorizationCode: z.string().min(1).max(4096),
  nonce: z.string().regex(/^[0-9a-f]{64}$/), fullName: z.string().trim().max(200).optional() }).strict();

export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!appleSignInConfigured()) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const limited = await enforceRateLimit({ request, route: "auth:apple:native:nonce", rules: rateLimitPresets.authOAuth });
  if (limited) return limited;
  const nonce = randomBytes(32).toString("hex");
  const response = NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(nonceCookie, nonce, { ...cookieOptions, secure: request.nextUrl.protocol === "https:", maxAge: 600 });
  return response;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!appleSignInConfigured()) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const limited = await enforceRateLimit({ request, route: "auth:apple:native:verify", rules: rateLimitPresets.authVerify });
  if (limited) return limited;
  const parsed = await parseJsonRequest(request, schema, { maxBytes: 24 * 1024 });
  if (!parsed.success) return parsed.response;
  if (parsed.data.nonce !== request.cookies.get(nonceCookie)?.value) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const finish = (status: number) => {
    const response = applyCookies(NextResponse.json(status === 200 ? { signedIn: true } : { error: "Apple sign-in could not be completed" },
      { status, headers: { "Cache-Control": "no-store" } }));
    response.cookies.set(nonceCookie, "", { ...cookieOptions, maxAge: 0 });
    if (status !== 200 && sessionCreated) {
      const names = new Set([...request.cookies.getAll(), ...response.cookies.getAll()].map(cookie => cookie.name));
      for (const name of names) if (name.startsWith("sb-")) response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
    return response;
  };
  let refreshToken: string | undefined;
  let sessionCreated = false;
  try {
    const identity = await verifyAppleIdentity(parsed.data.identityToken, parsed.data.nonce);
    const { data: existing } = await supabase.auth.getUser();
    // Reauthorization during deletion must not switch the signed-in account.
    if (existing.user && !existing.user.identities?.some(item => item.provider === "apple" && item.identity_data?.sub === identity.sub)) {
      return finish(403);
    }
    refreshToken = await exchangeAppleCode(parsed.data.authorizationCode, parsed.data.nonce, identity.sub!);
    const { data, error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: parsed.data.identityToken, nonce: parsed.data.nonce });
    sessionCreated = Boolean(data.session);
    if (error || !data.user || accountDeletionRequested(data.user) || existing.user && data.user.id !== existing.user.id) throw new Error("Sign-in rejected");
    const clientId = nativeAppleClientID();
    const saved = await createSupabaseServiceRoleClient().from("apple_auth_grants").upsert({
      user_id: data.user.id, client_id: clientId, apple_subject: identity.sub!,
      refresh_token_encrypted: sealAppleToken(refreshToken, data.user.id, clientId), updated_at: new Date().toISOString(),
    } as never, { onConflict: "user_id,client_id" });
    if (saved.error) throw new Error("Authorization could not be retained");
    refreshToken = undefined; // Durable, encrypted grant now belongs to the erasure worker.
    if (parsed.data.fullName && !data.user.user_metadata?.full_name) {
      await supabase.auth.updateUser({ data: { full_name: parsed.data.fullName } });
    }
    return await applySignInLocale(request, finish(200), data.user.id);
  } catch {
    if (sessionCreated) await supabase.auth.signOut({ scope: "local" });
    if (refreshToken) { try { await revokeAppleToken(refreshToken, nativeAppleClientID()); } catch { /* No token or provider diagnostics in logs. */ } }
    return finish(401);
  }
}
