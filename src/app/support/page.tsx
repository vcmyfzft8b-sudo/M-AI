import { InstantLink } from "@/components/instant-link";
import { AuthScreen } from "@/components/auth-screen";
import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import { getTranslations } from "@/lib/i18n/server";

export default async function PublicSupportPage() {
  const { t } = await getTranslations();
  return <AuthScreen>
    <section className="memo-native-paywall">
      <h1>{t("help.title")}</h1>
      <a className="memo-primary-pill" href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a>
      <InstantLink className="memo-underline-link" href="/legal/privacy-policy">{t("legal.privacyInline")}</InstantLink>
      <InstantLink className="memo-underline-link" href="/legal/terms-of-use">{t("legal.termsInline")}</InstantLink>
    </section>
  </AuthScreen>;
}
