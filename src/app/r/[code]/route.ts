import { NextResponse, type NextRequest } from "next/server";

import { getOptionalUser } from "@/lib/auth";
import { findGiveawayCode, rememberGiveawayReferral } from "@/lib/giveaway";
import {
  GIVEAWAY_REF_COOKIE,
  GIVEAWAY_REF_COOKIE_MAX_AGE,
  isGiveawayCodeFormat,
  normalizeGiveawayCode,
} from "@/lib/giveaway-shared";
import { hasPublicSupabaseEnv } from "@/lib/public-env";
import { resolveSiteOrigin } from "@/lib/site-url";

/**
 * The share link: `/r/BTS-7K2XQ4`.
 *
 * It does one thing — remembers the code in a cookie — and then sends the
 * visitor where they would have gone anyway: the landing page, or straight
 * to the paywall if they already have an account. Checkout reads the cookie
 * and attaches the discount, so a friend never has to type the code.
 *
 * A code that is not one of ours still redirects, without a cookie, so a
 * mistyped link is a visit to the site rather than a dead page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeGiveawayCode(decodeURIComponent(rawCode));
  const origin = resolveSiteOrigin(request);

  const known = isGiveawayCodeFormat(code) ? await findGiveawayCode(code).catch(() => null) : null;
  const user = hasPublicSupabaseEnv ? await getOptionalUser() : null;
  const signedIn = Boolean(user);

  // An existing account opening a friend's link: the code sticks to the
  // account right here, so a purchase later, from anywhere, credits the friend.
  if (user && known && known.user_id !== user.id) {
    await rememberGiveawayReferral(user.id, known.code);
  }

  const response = NextResponse.redirect(
    new URL(signedIn ? "/app/start" : "/", origin),
    { status: 307 },
  );

  if (known) {
    response.cookies.set(GIVEAWAY_REF_COOKIE, known.code, {
      path: "/",
      maxAge: GIVEAWAY_REF_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
    });
  }

  return response;
}
