import { notFound } from "next/navigation";

import { SupportArticleScreen } from "@/components/support-article-screen";
import { getHelpArticle } from "@/lib/help-center";

export default async function SupportArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getHelpArticle(slug);

  if (!article) {
    notFound();
  }

  return (
    <SupportArticleScreen
      category={article.category}
      title={article.title}
      content={article.content.replace(/^# .+\n+/, "")}
    />
  );
}
