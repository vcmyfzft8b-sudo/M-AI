import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { SupportArticleScreen } from "@/components/support-article-screen";
import { AppleCodeForm } from "@/components/apple-code-form";
import { getHelpArticle } from "@/lib/help-center";
import { getTranslations } from "@/lib/i18n/server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";

export default async function SupportArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { slug } = await params;
  // Settings links straight into an article (the code form); its arrow must
  // return there, not to the help index the reader never saw.
  const backHref = (await searchParams).from === "settings" ? "/app/settings" : undefined;
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
      appearance={native && slug === "redeem-code" ? "offer" : "article"}
      backHref={backHref}
    >
      {native && slug === "redeem-code" && <AppleCodeForm />}
    </SupportArticleScreen>
  );
}
