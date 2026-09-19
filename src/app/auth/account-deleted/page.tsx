import { InstantLink } from "@/components/instant-link";
import { AuthScreen } from "@/components/auth-screen";
import { getTranslations } from "@/lib/i18n/server";

export default async function AccountDeletedPage({ searchParams }: { searchParams: Promise<{ apple?: string }> }) {
  const { t } = await getTranslations();
  const { apple } = await searchParams;
  return <AuthScreen>
    <div className="memo-auth-card">
      <div className="memo-auth-head">
        <h1 className="memo-auth-title">{t("native.deletionRequestedTitle")}</h1>
        <p className="memo-auth-copy">{t("native.deletionRequestedCopy")}</p>
      </div>
      {apple === "manual" ? <p className="memo-auth-copy">
        {t("native.appleDisconnectCopy")}{" "}
        <a href="https://support.apple.com/en-us/102571">{t("native.appleDisconnectLink")}</a>
      </p> : null}
      <InstantLink className="memo-button-coral" href="/auth/continue">{t("auth.signIn")}</InstantLink>
    </div>
  </AuthScreen>;
}
