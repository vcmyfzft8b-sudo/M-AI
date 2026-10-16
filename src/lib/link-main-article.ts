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

/**
 * The whole element marked `role="main"`, nested tags of its own name included, or null. Moodle
 * opens it with `<div role="main"><span id="maincontent"></span>`, and a match that stopped at the
 * first closing tag read an Arnes Učilnice page as nothing and failed it as source_too_short
 * (2026-10-16).
 */
export function pickRoleMainHtml(html: string): string | null {
  const open = /<([a-z][a-z0-9-]*)\b[^>]*\brole=["']main["'][^>]*>/i.exec(html);

  if (!open) {
    return null;
  }

  const tags = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "gi");
  tags.lastIndex = open.index + open[0].length;
  let depth = 1;

  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] ? -1 : tag[0].endsWith("/>") ? 0 : 1;

    if (depth === 0) {
      return html.slice(open.index, tag.index + tag[0].length);
    }
  }

  return html.slice(open.index);
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
