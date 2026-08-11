import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseFormDataRequest } from "@/lib/request-validation";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { emailAddressSchema, nextPathSchema, normalizeNextPath } from "@/lib/validation";

/**
 * Email + password sign-in.
 *
 * Deliberately not linked from anywhere in the product: real users sign in with Google or a
 * one-time email link. This exists because App Review cannot receive our sign-in emails, and an
 * app they cannot get into is rejected under Guideline 2.1. The reviewer is given an address and
 * password in the review notes and uses this page.
 *
 * Sign-up is not offered here — this only authenticates an account that already exists and has
 * had a password set for it.
 */
const PASSWORD_FORM_MAX_BYTES = 8 * 1024;

const passwordAuthSchema = z.object({
  email: emailAddressSchema,
  password: z.string().min(1).max(200),
  next: nextPathSchema,
});

function redirectWithError(request: NextRequest, next: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/password";
  url.search = "";
  url.searchParams.set("next", next);
  // Intentionally vague: distinguishing "no such account" from "wrong password" tells an
  // attacker which addresses are registered.
  url.searchParams.set("error", "1");
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:password:submit:post",
    rules: rateLimitPresets.authOAuth,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseFormDataRequest(request, {
    maxBytes: PASSWORD_FORM_MAX_BYTES,
  });

  if (!parsed.success) {
    return redirectWithError(request, "/app");
  }

  const fields = passwordAuthSchema.safeParse({
    email: parsed.data.get("email"),
    password: parsed.data.get("password"),
    next: parsed.data.get("next"),
  });

  if (!fields.success) {
    return redirectWithError(request, "/app");
  }

  const next = normalizeNextPath(fields.data.next);
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: fields.data.email.trim().toLowerCase(),
    password: fields.data.password,
  });

  if (error) {
    return applyCookies(redirectWithError(request, next));
  }

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = next;
  successUrl.search = "";
  return applyCookies(NextResponse.redirect(successUrl, { status: 303 }));
}
