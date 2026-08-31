import { redirect } from "next/navigation";

import { AuthBackLink } from "@/components/auth-back-link";
import { BrandLogo } from "@/components/brand-logo";
import { EmailEntryForm } from "@/components/email-entry-form";
import { getOptionalUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import { getTranslations } from "@/lib/i18n/server";
import { normalizeNextPath, sanitizeUserInput } from "@/lib/validation";

type SearchParams = Promise<{
  email?: string;
  mode?: string;
  next?: string;
}>;

export default async function EmailEntryPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await getOptionalUser();
  const { t } = await getTranslations();
  const params = await searchParams;
  const next = normalizeNextPath(params?.next);
  const mode = params?.mode === "login" ? "login" : "signup";
  const email = typeof params?.email === "string" ? sanitizeUserInput(params.email).slice(0, 320) : "";

  if (user) {
    redirect(next);
  }

  return (
    <main className="landing-shell landing-auth-page email-entry-page">
      <div className="email-entry-topbar">
        <AuthBackLink />
      </div>

      <section className="landing-auth-wrap email-entry-wrap">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="landing-auth-brand email-entry-brand" aria-label={t("nav.homeBrand", { brand: BRAND_NAME })}>
          <BrandLogo compact priority />
        </a>

        <div className="landing-auth-hero email-entry-copy">
          <h1 className="landing-auth-title email-entry-title">{t("auth.emailEntryTitle")}</h1>
          <p className="landing-auth-copy email-entry-text">
            {t("auth.emailEntryCopy")}
          </p>
        </div>

        <EmailEntryForm email={email} mode={mode} next={next} />
      </section>
    </main>
  );
}
