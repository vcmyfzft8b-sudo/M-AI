import {
  HELP_ARTICLE_CATEGORY,
  HELP_ARTICLE_ORDER,
  type HelpArticleSlug,
  type HelpArticles,
  type HelpCategory,
} from "@/lib/help/articles";
import { bsHelpArticles } from "@/lib/help/bs";
import { enHelpArticles } from "@/lib/help/en";
import { hrHelpArticles } from "@/lib/help/hr";
import { slHelpArticles } from "@/lib/help/sl";
import { srHelpArticles } from "@/lib/help/sr";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

export type HelpArticle = {
  slug: HelpArticleSlug;
  title: string;
  category: HelpCategory;
  content: string;
};

const ARTICLES_BY_LOCALE: Record<Locale, HelpArticles> = {
  sl: slHelpArticles,
  en: enHelpArticles,
  hr: hrHelpArticles,
  bs: bsHelpArticles,
  sr: srHelpArticles,
};

const CATEGORY_LABEL_KEYS: Record<HelpCategory, MessageKey> = {
  common: "help.category.common",
  recording: "help.category.recording",
  account: "help.category.account",
};

export function getHelpArticles(locale: Locale): HelpArticle[] {
  const articles = ARTICLES_BY_LOCALE[locale] ?? ARTICLES_BY_LOCALE[DEFAULT_LOCALE];

  return HELP_ARTICLE_ORDER.map((slug) => ({
    slug,
    title: articles[slug].title,
    category: HELP_ARTICLE_CATEGORY[slug],
    content: articles[slug].content,
  }));
}

export function getHelpArticle(slug: string, locale: Locale): HelpArticle | null {
  return getHelpArticles(locale).find((article) => article.slug === slug) ?? null;
}

/**
 * The help screen's three groups, in order, with the articles that belong to
 * each. A group with nothing in it is dropped rather than drawn as an empty
 * heading — which cannot happen today, but would the moment an article moves.
 */
export function getHelpSections(locale: Locale, t: Translate<MessageKey>) {
  const articles = getHelpArticles(locale);

  return (["common", "recording", "account"] as const)
    .map((category) => ({
      category,
      title: t(CATEGORY_LABEL_KEYS[category]),
      items: articles.filter((article) => article.category === category),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * A legal document may close with a fine-print block after a horizontal rule.
 * The public legal pages lift that block out and render it below the footer;
 * anywhere else (the in-app support reader) it stays inline at the end.
 */
export function splitArticleFinePrint(content: string) {
  const marker = "\n---\n";
  const markerIndex = content.indexOf(marker);

  if (markerIndex === -1) {
    return { body: content, finePrint: null };
  }

  return {
    body: content.slice(0, markerIndex).trimEnd(),
    finePrint: content.slice(markerIndex + marker.length).trim() || null,
  };
}
