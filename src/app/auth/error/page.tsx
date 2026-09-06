import Link from "next/link";

import { AuthScreen } from "@/components/auth-screen";
import { Msym } from "@/components/msym";
import { getTranslations } from "@/lib/i18n/server";
import { sanitizeUserInput } from "@/lib/validation";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { t } = await getTranslations();
  const params = await searchParams;
  const message = typeof params.message === "string"
    ? sanitizeUserInput(params.message).slice(0, 240)
    : undefined;

  return (
    <AuthScreen>
      <div className="memo-auth-card">
        <div className="memo-auth-head">
          <span className="memo-auth-badge error">
            <Msym name="warning" fill={false} weight={500} size="1.6rem" />
          </span>
          <p className="memo-eyebrow">{t("auth.error.eyebrow")}</p>
          <h1 className="memo-auth-title">{t("auth.error.title")}</h1>
          <p className="memo-auth-copy long">{message ?? t("auth.error.copy")}</p>
        </div>

        {/* One door: `/auth/continue` offers signing in and signing up
            together, so a second button here would only be the same page
            under a different name. */}
        <Link href="/auth/continue" className="memo-button-coral memo-auth-submit">
          {t("auth.error.backToLogin")}
        </Link>
      </div>
    </AuthScreen>
  );
}
