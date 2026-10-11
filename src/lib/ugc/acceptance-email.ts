import type { CreatorMarket } from "./creator-program.ts";

/**
 * The email an accepted creator gets: welcome, and their personal join link. The link
 * opens the Terms of Participation; accepting them is what joins the program and
 * reveals the campaign's Discord invite, so nobody reaches the Discord without having
 * agreed. Written in the language they applied in.
 *
 * Pure (the translator is handed in), so a test can render it in every language.
 * Sending is `send-acceptance-email.ts`.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type AcceptanceEmail = {
  subject: string;
  html: string;
  text: string;
  joinUrl: string;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

export function buildAcceptanceEmail({
  t,
  fullName,
  market,
  joinUrl,
  needsGuardian = false,
}: {
  t: Translate;
  fullName: string;
  market: CreatorMarket;
  joinUrl: string;
  /** Under 18: a parent or guardian signs on the same page, and the email says so. */
  needsGuardian?: boolean;
}): AcceptanceEmail {
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;
  const campaign = t(market === "si" ? "ugcApply.market.si" : "ugcApply.market.balkans");

  const greeting = t("ugcApply.email.greeting", { name: firstName });
  const accepted = t("ugcApply.email.accepted", { campaign });
  const discord = t("ugcApply.email.discord", { button: t("ugcJoin.submit") });
  const guardian = needsGuardian ? t("ugcApply.email.guardian") : null;
  const button = t("ugcApply.email.button");
  const fallback = t("ugcApply.email.linkFallback", { link: joinUrl });
  const closing = t("ugcApply.email.closing");
  const signoff = t("ugcApply.email.signoff");

  const text = [greeting, "", accepted, "", discord, ...(guardian ? ["", guardian] : []), "", `${button}: ${joinUrl}`, "", closing, signoff].join("\n");

  // Inline styles only: mail clients drop <style> blocks and ignore CSS variables.
  const paragraph = (content: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#17171a">${content}</p>`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f1f5">
    <div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
      <div style="background:#ffffff;border-radius:22px;padding:32px 28px">
        ${paragraph(escapeHtml(greeting))}
        ${paragraph(escapeHtml(accepted))}
        ${paragraph(escapeHtml(discord))}
        ${guardian ? paragraph(escapeHtml(guardian)) : ""}
        <p style="margin:24px 0">
          <a href="${joinUrl}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#f45f5a;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none">${escapeHtml(button)}</a>
        </p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#8e8e95">${escapeHtml(fallback)}</p>
        ${paragraph(escapeHtml(closing))}
        <p style="margin:0;font-size:16px;line-height:1.55;color:#17171a;font-weight:700">${escapeHtml(signoff)}</p>
      </div>
    </div>
  </body>
</html>`;

  return { subject: t("ugcApply.email.subject"), html, text, joinUrl };
}
