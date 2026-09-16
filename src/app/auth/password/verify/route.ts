import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseFormDataRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { emailAddressSchema, nextPathSchema } from "@/lib/validation";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { applySignInLocale } from "@/lib/i18n/sign-in-locale";

const schema = z.object({
  email: emailAddressSchema.transform(value => value.toLowerCase()),
  // Passwords are opaque: never trim or Unicode-normalize them.
  password: z.string().min(1).max(1024),
  next: nextPathSchema,
});

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }
  const limited = await enforceRateLimit({ request, route: "auth:password:ip", rules: rateLimitPresets.authVerify });
  if (limited) return limited;
  const form = await parseFormDataRequest(request, { maxBytes: 8 * 1024 });
  const parsed = form.success ? schema.safeParse({ email: form.data.get("email"), password: form.data.get("password"), next: form.data.get("next") }) : null;
  const retry = new URL("/auth/password", request.nextUrl.origin);
  retry.searchParams.set("error", "invalid");
  if (!parsed?.success) return NextResponse.redirect(retry, { status: 303 });
  retry.searchParams.set("next", parsed.data.next);
  // A second limit follows the account across IPs without storing its email.
  const accountLimit = await enforceRateLimit({ request, route: "auth:password:account",
    userId: createHash("sha256").update(parsed.data.email).digest("hex"),
    rules: [{ windowSeconds: 600, maxRequests: 15, scope: "user" }],
  });
  if (accountLimit) return accountLimit;
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error || !data.user || accountDeletionRequested(data.user)) {
    if (data.session) await supabase.auth.signOut({ scope: "local" });
    return applyCookies(NextResponse.redirect(retry, { status: 303 }));
  }
  return applySignInLocale(request,
    applyCookies(NextResponse.redirect(new URL(parsed.data.next, request.nextUrl.origin), { status: 303 })), data.user.id);
}
