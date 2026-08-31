import { NextResponse } from "next/server";
import { z } from "zod";

import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALES,
} from "@/lib/i18n/locales";
import { writeProfileLocale } from "@/lib/i18n/profile-locale";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const localeSchema = z.object({
  locale: z.enum(LOCALES),
});

/**
 * Records the language somebody picked.
 *
 * Deliberately open to signed-out visitors: the picker is on the landing page,
 * which is exactly where a Croatian visitor who was handed English needs it,
 * and there is no account yet to hang the choice on. For them the cookie is
 * the whole of the preference. For a signed-in visitor the column is written
 * as well, so the choice survives this browser.
 *
 * The cookie is written either way, including when the profile write fails —
 * the language has to change on screen even if it cannot be remembered
 * account-wide, and the response says which of the two happened.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit({
    request,
    route: "api:locale:post",
    rules: rateLimitPresets.localePreference,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, localeSchema, { maxBytes: 512 });

  if (!parsed.success) {
    return parsed.response;
  }

  const { locale } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let saved = false;

  if (user) {
    try {
      saved = await writeProfileLocale(user.id, locale);
    } catch (error) {
      // The cookie below still applies the choice, so this is a lost
      // cross-device preference rather than a failed request.
      console.error("Failed to persist ui_language", { userId: user.id, locale, error });
    }
  }

  const response = NextResponse.json({ locale, saved });

  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  return response;
}
