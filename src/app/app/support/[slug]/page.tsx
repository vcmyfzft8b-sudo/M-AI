import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { SupportArticleScreen } from "@/components/support-article-screen";
import { AppleCodeForm } from "@/components/apple-code-form";
import { getHelpArticle } from "@/lib/help-center";
import { getTranslations } from "@/lib/i18n/server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";

export default async function SupportArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { locale, t } = await getTranslations();
  const article = getHelpArticle(slug, locale);

  if (!article) {
    notFound();
  }

  const native = isNativeUserAgent((await headers()).get("user-agent"));
  const content = native && slug === "redeem-code"
    ? t("native.redeemHelp")
    : native && slug === "gift-coconote"
      ? t("native.giftHelp")
      : article.content.replace(/^# .+\n+/, "");

  return (
    <SupportArticleScreen
      category={t(`help.category.${article.category}`)}
      title={article.title}
      content={content}
    >
      {native && slug === "redeem-code" && <AppleCodeForm />}
    </SupportArticleScreen>
  );
}
