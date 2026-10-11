import "server-only";

import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import { getTranslationsFor } from "@/lib/i18n/server";
import { parseLocale } from "@/lib/i18n/locales";
import { getPublicEnv } from "@/lib/public-env";
import { buildAcceptanceEmail } from "@/lib/ugc/acceptance-email";
import type { CreatorMarket } from "@/lib/ugc/creator-program";

/** The personal link in the acceptance email: the terms, then the Discord invite. */
export function creatorJoinUrl(joinToken: string) {
  return new URL(`/ugc/join/${joinToken}`, getPublicEnv().siteUrl).toString();
}

/**
 * Sends the acceptance email through Resend's HTTP API.
 *
 * Needs `RESEND_API_KEY`, and a sender on a domain verified in Resend
 * (`UGC_EMAIL_FROM`, default `Memo AI <creators@memoai.eu>`). Replies go to the
 * support inbox. Without the key nothing is sent and the caller is told so — the
 * admin page then offers to send it again once the key is set.
 *
 * `idempotencyKey` makes a double click one email: Resend drops a repeat with the
 * same key for 24 hours.
 */
export async function sendAcceptanceEmail({
  to,
  fullName,
  locale,
  market,
  joinToken,
  idempotencyKey,
  needsGuardian = false,
}: {
  to: string;
  fullName: string;
  locale: string;
  market: CreatorMarket;
  joinToken: string;
  idempotencyKey: string;
  needsGuardian?: boolean;
}): Promise<{ sent: true } | { sent: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY is not set, so no email was sent." };
  }

  const email = buildAcceptanceEmail({
    t: getTranslationsFor(parseLocale(locale) ?? "en") as (key: string, values?: Record<string, string | number>) => string,
    fullName,
    market,
    joinUrl: creatorJoinUrl(joinToken),
    needsGuardian,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.UGC_EMAIL_FROM?.trim() || "Memo AI <creators@memoai.eu>",
        to: [to],
        reply_to: BRAND_SUPPORT_EMAIL,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");

      return { sent: false, error: `Resend answered ${response.status}: ${detail.slice(0, 300)}` };
    }

    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}
