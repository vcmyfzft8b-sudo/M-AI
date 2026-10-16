// A page's first `<article>` is not always its article. Drupal sites, among others, mark every
// teaser card as one, and a mega-menu full of recipe cards comes before the content: a Schär
// article about coeliac disease in children read as "Veganski falafel wrap" and failed as
// link_not_enough_text (2026-10-15). The page's `<main>` bounds where the content is, and among
// the articles in it the one with the most text is the one a learner linked.

function visibleTextLength(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** The page's main article, else its `<main>`, else null. Pure, so it is unit-tested. */
export function pickPageArticleHtml(html: string): string | null {
  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? null;
  const articles = (main ?? html).match(/<article\b[\s\S]*?<\/article>/gi) ?? [];

  if (articles.length === 0) {
    return main;
  }

  return articles.reduce((best, article) =>
    visibleTextLength(article) > visibleTextLength(best) ? article : best,
  );
}
