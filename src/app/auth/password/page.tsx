import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth-screen";
import { PasswordAuthForm } from "@/components/password-auth-form";
import { getOptionalUser } from "@/lib/auth";
import { getTranslations } from "@/lib/i18n/server";
import { normalizeNextPath } from "@/lib/validation";

export default async function PasswordPage({ searchParams }: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = normalizeNextPath(params.next);
  if (await getOptionalUser()) redirect(next);
  const { t } = await getTranslations();
  return (
    <AuthScreen backHref="/auth/continue">
      <div className="memo-auth-card">
        <div className="memo-auth-head">
          <h1 className="memo-auth-title">{t("auth.password.title")}</h1>
          <p className="memo-auth-copy">{t("auth.password.copy")}</p>
        </div>
        <PasswordAuthForm next={next} />
        {params.error ? <p className="memo-auth-notice" data-tone="error" role="alert">{t("auth.password.error")}</p> : null}
        <p className="memo-auth-legal">
          <Link href={`/auth/email-entry?mode=login&next=${encodeURIComponent(next)}`}>{t("auth.password.useCode")}</Link>
        </p>
      </div>
    </AuthScreen>
  );
}
