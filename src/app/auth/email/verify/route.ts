import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseFormDataRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { reviewCodeMatches } from "@/lib/review-login";
import {
  createSupabaseRouteHandlerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import {
  emailAddressSchema,
  nextPathSchema,
  normalizeNextPath,
  sanitizeUserInput,
  verificationCodeSchema,
} from "@/lib/validation";
import { tr } from "@/lib/i18n/server";

const VERIFY_EMAIL_FORM_MAX_BYTES = 8 * 1024;

const verifyEmailCodeSchema = z.object({
  email: emailAddressSchema,
  code: verificationCodeSchema,
  mode: z.enum(["login", "signup"]),
  next: nextPathSchema,
});

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "auth:email:verify:post",
    rules: rateLimitPresets.authVerify,
  });

  if (limited) {
    return limited;
  }

  const parsedFormData = await parseFormDataRequest(request, {
    maxBytes: VERIFY_EMAIL_FORM_MAX_BYTES,
  });

  if (!parsedFormData.success) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set("email", "");
    retryUrl.searchParams.set("mode", "login");
    retryUrl.searchParams.set("next", "/app");
    retryUrl.searchParams.set("messageType", "error");
    retryUrl.searchParams.set("message", await tr("api.formInvalidOrTooLarge"));
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const formData = parsedFormData.data;
  const emailField = formData.get("email");
  const nextField = formData.get("next");
  const parsed = verifyEmailCodeSchema.safeParse({
    email: emailField,
    code: formData.get("code"),
    mode: formData.get("mode"),
    next: nextField,
  });

  if (!parsed.success) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set(
      "email",
      typeof emailField === "string" ? sanitizeUserInput(emailField).slice(0, 320) : "",
    );
    retryUrl.searchParams.set("mode", String(formData.get("mode") ?? "login"));
    retryUrl.searchParams.set(
      "next",
      normalizeNextPath(typeof nextField === "string" ? nextField : null),
    );
    retryUrl.searchParams.set("messageType", "error");
    retryUrl.searchParams.set(
      "message",
      parsed.error.issues[0]?.message ?? await tr("api.enterCode"),
    );
    return NextResponse.redirect(retryUrl, { status: 303 });
  }

  const next = parsed.data.next;
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await verifyCode(supabase, parsed.data.email, parsed.data.code);

  if (error) {
    const retryUrl = request.nextUrl.clone();
    retryUrl.pathname = "/auth/check-email";
    retryUrl.search = "";
    retryUrl.searchParams.set("email", parsed.data.email);
    retryUrl.searchParams.set("mode", parsed.data.mode);
    retryUrl.searchParams.set("next", next);
    retryUrl.searchParams.set("messageType", "error");
    retryUrl.searchParams.set("message", sanitizeUserInput(error.message).slice(0, 240));
    return applyCookies(NextResponse.redirect(retryUrl, { status: 303 }));
  }

  const successUrl = request.nextUrl.clone();
  successUrl.pathname = next;
  successUrl.search = "";
  return applyCookies(NextResponse.redirect(successUrl, { status: 303 }));
}

type RouteSupabase = Awaited<ReturnType<typeof createSupabaseRouteHandlerClient>>["supabase"];

/**
 * A mailed code is checked by Supabase. A review account's fixed code is
 * checked here, and then turned into the same kind of session by consuming an
 * admin-issued magic link on the spot — so the cookie jar ends up exactly as
 * it would after a mailed code, and nothing downstream knows the difference.
 * The link never leaves the server. An account that is being deleted stays
 * out, as with every other way in.
 */
async function verifyCode(supabase: RouteSupabase, email: string, code: string) {
  if (!reviewCodeMatches(email, code)) {
    return supabase.auth.verifyOtp({ email, token: code, type: "email" });
  }

  const { data, error } = await createSupabaseServiceRoleClient().auth.admin.generateLink({
    type: "magiclink",
    email: email.trim().toLowerCase(),
  });

  if (error || !data.user || accountDeletionRequested(data.user)) {
    return { error: error ?? new Error("Account unavailable") };
  }

  return supabase.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
}
