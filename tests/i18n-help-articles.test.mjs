import assert from "node:assert/strict";
import test from "node:test";

import { HELP_ARTICLE_CATEGORY, HELP_ARTICLE_ORDER } from "../src/lib/help/articles.ts";
import { bsHelpArticles } from "../src/lib/help/bs.ts";
import { enHelpArticles } from "../src/lib/help/en.ts";
import { hrHelpArticles } from "../src/lib/help/hr.ts";
import { slHelpArticles } from "../src/lib/help/sl.ts";
import { srHelpArticles } from "../src/lib/help/sr.ts";

const ARTICLES = {
  sl: slHelpArticles,
  en: enHelpArticles,
  hr: hrHelpArticles,
  bs: bsHelpArticles,
  sr: srHelpArticles,
};

/** The three documents a person may be held to. They must never be missing or truncated. */
const LEGAL_SLUGS = ["privacy-policy", "refund-policy", "terms-of-use"];

test("every language has every article", () => {
  for (const [locale, articles] of Object.entries(ARTICLES)) {
    assert.deepEqual(
      Object.keys(articles).sort(),
      [...HELP_ARTICLE_ORDER].sort(),
      `${locale} does not carry the same articles`,
    );
  }
});

test("no article has an empty title or body", () => {
  for (const [locale, articles] of Object.entries(ARTICLES)) {
    for (const slug of HELP_ARTICLE_ORDER) {
      assert.ok(articles[slug].title.trim().length > 0, `${locale} ${slug} has no title`);
      assert.ok(articles[slug].content.trim().length > 0, `${locale} ${slug} has no body`);
    }
  }
});

test("every article opens with the H1 the readers strip off", () => {
  // Both the support reader and the public legal page remove the leading "# ..." and render the
  // title from the article's own `title`. An article without one loses its first line instead.
  for (const [locale, articles] of Object.entries(ARTICLES)) {
    for (const slug of HELP_ARTICLE_ORDER) {
      assert.match(
        articles[slug].content,
        /^# .+\n/,
        `${locale} ${slug} does not start with an H1`,
      );
    }
  }
});

test("a translated legal document is not a stub", () => {
  // A machine-shortened or half-finished legal translation is the failure worth catching here:
  // these are binding documents, and one that lost half its sections is worse than none.
  for (const slug of LEGAL_SLUGS) {
    const source = slHelpArticles[slug].content;

    for (const [locale, articles] of Object.entries(ARTICLES)) {
      const translated = articles[slug].content;

      assert.ok(
        translated.length > source.length * 0.75,
        `${locale} ${slug} is far shorter than the Slovenian original`,
      );

      // Numbered sections are the document's skeleton; every language must keep all of them.
      const sourceSections = source.match(/^## \d+\./gm)?.length ?? 0;
      const translatedSections = translated.match(/^## \d+\./gm)?.length ?? 0;

      assert.equal(
        translatedSections,
        sourceSections,
        `${locale} ${slug} has ${translatedSections} numbered sections, sl has ${sourceSections}`,
      );
    }
  }
});

test("the withdrawal fine print survives translation", () => {
  // The public legal page lifts everything after a `---` out as fine print. The terms carry the
  // statutory right of withdrawal there, which is the one block a consumer must always be shown.
  for (const [locale, articles] of Object.entries(ARTICLES)) {
    const [, finePrint] = articles["terms-of-use"].content.split("\n---\n");

    assert.ok(
      finePrint && finePrint.trim().length > 200,
      `${locale} terms-of-use lost its fine-print block`,
    );
    assert.match(finePrint, /14/, `${locale} fine print no longer states the 14-day period`);
  }
});

test("the support address is unchanged in every language", () => {
  for (const [locale, articles] of Object.entries(ARTICLES)) {
    for (const slug of LEGAL_SLUGS) {
      assert.match(
        articles[slug].content,
        /info@memoai\.eu/,
        `${locale} ${slug} lost the contact address`,
      );
    }
  }
});

test("every article belongs to one of the three help sections", () => {
  for (const slug of HELP_ARTICLE_ORDER) {
    assert.ok(
      ["common", "recording", "account"].includes(HELP_ARTICLE_CATEGORY[slug]),
      `${slug} has no section`,
    );
  }
});
