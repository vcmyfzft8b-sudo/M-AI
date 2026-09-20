import { NextResponse, type NextRequest } from "next/server";

import { getLocale } from "@/lib/i18n/server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";
import {
  ONBOARDING_COOKIE_MAX_AGE,
  ONBOARDING_RESPONSE_COOKIE,
  ONBOARDING_SEEN_COOKIE,
  saveAnonymousOnboarding,
} from "@/lib/onboarding-anonymous";
import { ONBOARDING_MAX_BYTES, onboardingSubmissionSchema } from "@/lib/onboarding-submission";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { tr } from "@/lib/i18n/server";

/**
 * The survey, from someone who has not signed up.
 *
 * Open by necessity — the whole point is that it runs before the account
 * exists — so it is rate limited by address rather than by user, and it stores
 * nothing a caller supplies beyond the survey's own closed set of enum
 * answers. There is no identifier in the body: the response is addressed only
 * by the httpOnly cookie this sets, which is what the account presents later.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:onboarding:anonymous:post",
    rules: rateLimitPresets.mutate,
  });
  if (limited) return limited;

  const parsed = await parseJsonRequest(request, onboardingSubmissionSchema, {
    maxBytes: ONBOARDING_MAX_BYTES,
  });
  if (!parsed.success) return parsed.response;

  let id: string;
  try {
    id = await saveAnonymousOnboarding(parsed.data, {
      source: isNativeUserAgent(request.headers.get("user-agent")) ? "ios" : "web",
      locale: await getLocale(),
    });
  } catch {
    return NextResponse.json({ error: await tr("common.somethingWentWrong") }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const shared = {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ONBOARDING_COOKIE_MAX_AGE,
  } as const;
  // The response id never reaches the page: it is only ever presented back to
  // us, by the browser, on the request that claims it.
  response.cookies.set(ONBOARDING_RESPONSE_COOKIE, id, shared);
  // Readable by nothing in particular, and carrying nothing: it exists so a
  // returning visitor who never signed up is offered sign-in rather than the
  // whole survey again.
  response.cookies.set(ONBOARDING_SEEN_COOKIE, "1", { ...shared, httpOnly: false });
  return response;
}
