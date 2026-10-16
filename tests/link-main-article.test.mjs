import assert from "node:assert/strict";
import test from "node:test";

import { pickPageArticleHtml, pickRoleMainHtml } from "../src/lib/link-main-article.ts";

const TEASER = (name) => `<article class="node recipe recipe--minimal"><a href="/r/${name}">${name}</a></article>`;
const BODY = "<p>Coeliac disease is an immune reaction to gluten that damages the small intestine.</p>".repeat(20);

test("a teaser card in the menu is not the page's article", () => {
  const html = `<html><body>
<div class="mega-menu">${TEASER("falafel-wrap")}${TEASER("pasta-salad")}</div>
<main role="main"><article class="node article article--full"><h1>Coeliac disease</h1>${BODY}</article>
${TEASER("related-recipe")}</main>
</body></html>`;

  const picked = pickPageArticleHtml(html);

  assert.match(picked, /article--full/);
  assert.match(picked, /immune reaction to gluten/);
});

test("without a <main>, the longest article wins", () => {
  const html = `<body>${TEASER("one")}<article>${BODY}</article>${TEASER("two")}</body>`;

  assert.match(pickPageArticleHtml(html), /immune reaction to gluten/);
});

test("a <main> with no article in it is read whole", () => {
  const html = `<body><nav>${TEASER("menu-card")}</nav><main><h1>Coeliac disease</h1>${BODY}</main></body>`;
  const picked = pickPageArticleHtml(html);

  assert.match(picked, /^<main>/);
  assert.doesNotMatch(picked, /menu-card/);
});

test("a page with neither is left to the caller", () => {
  assert.equal(pickPageArticleHtml(`<body><div>${BODY}</div></body>`), null);
});

test("a Moodle role=main region is read whole, not up to its first closing tag", () => {
  const html = `<body><nav>Course menu</nav><div id="region-main"><div role="main"><span id="maincontent"></span>
<div class="box"><h2>Pythagoras' theorem</h2><div>${BODY}</div></div></div><aside>Blocks</aside></div></body>`;
  const picked = pickRoleMainHtml(html);

  assert.match(picked, /^<div role="main">/);
  assert.match(picked, /immune reaction to gluten/);
  assert.match(picked, /<\/div><\/div><\/div>$/);
  assert.doesNotMatch(picked, /Blocks|Course menu/);
});

test("a page without role=main has no role=main region", () => {
  assert.equal(pickRoleMainHtml(`<body><div>${BODY}</div></body>`), null);
});
