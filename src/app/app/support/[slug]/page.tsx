import { notFound } from "next/navigation";

import { SupportArticleScreen } from "@/components/support-article-screen";
import { getHelpArticle } from "@/lib/help-center";
import { getTranslations } from "@/lib/i18n/server";

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

  return (
    <SupportArticleScreen
      category={t(`help.category.${article.category}`)}
      title={article.title}
      content={article.content.replace(/^# .+\n+/, "")}
    />
  );
}
