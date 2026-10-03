import assert from "node:assert/strict";
import test from "node:test";

import { stripHtmlForms } from "../src/lib/link-html-forms.ts";
import { looksLikeLoginPage } from "../src/lib/link-login-walls.ts";
import {
  findRepositoryDocumentUrl,
  isRepositoryCatalogueUrl,
  repositoryDocumentTitle,
  sessionCookieHeader,
} from "../src/lib/link-repository-documents.ts";

// A synthetic page of the shape dLib.si serves: one ASP.NET server form around the whole body, a
// sign-in widget with a password field in the corner, and the catalogue card with its PDF link.
const WEBFORMS_CATALOGUE_PAGE = `<!DOCTYPE html>
<html><head><title>dLib.si - An example article</title></head>
<body>
<form method="post" action="./URN:NBN:SI:DOC-EXAMPLE" id="form1">
<div class="aspNetHidden"><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="abc" /></div>
<div class="login">E-mail: <input type="text" name="user" /> Password: <input name="pw" type="password" /></div>
<div class="card">
  <h1>An example article : with a subtitle</h1>
  <a href="/stream/URN:NBN:SI:DOC-EXAMPLE/0f0e0d0c-1111-2222-3333-444455556666/PDF">1. PDF file (145 kB)</a>
  <a href="/stream/URN:NBN:SI:DOC-EXAMPLE/aaaabbbb-1111-2222-3333-444455556666/TEXT">1. TXT file (19 kB)</a>
  <p>Author: Example, Author. Source: An example journal, volume 1, issue 2.</p>
</div>
</form>
</body></html>`;

// The production failure: the page read as nothing once its one form was dropped, and the sign-in
// widget's password field then got it reported as a login wall.
test("keeps the contents of an ASP.NET WebForms page form", () => {
  const stripped = stripHtmlForms(WEBFORMS_CATALOGUE_PAGE);

  assert.match(stripped, /An example article : with a subtitle/);
  assert.match(stripped, /An example journal/);
  // The page still has a password field, which is why the text must not come out thin.
  assert.equal(looksLikeLoginPage(WEBFORMS_CATALOGUE_PAGE), true);
});

test("still drops ordinary forms", () => {
  const html = `<main><p>The article.</p>
<form action="/search"><input name="q" /> Search the site</form>
<form action="/login"><input type="password" name="pw" /> Sign in to comment</form></main>`;
  const stripped = stripHtmlForms(html);

  assert.match(stripped, /The article\./);
  assert.doesNotMatch(stripped, /Search the site/);
  assert.doesNotMatch(stripped, /Sign in to comment/);
});

test("finds the open PDF a dLib catalogue page links to, on the page's own host", () => {
  const pageUrl = new URL("https://www.dlib.si/details/URN:NBN:SI:DOC-EXAMPLE");
  const documentUrl = findRepositoryDocumentUrl(pageUrl, WEBFORMS_CATALOGUE_PAGE);

  assert.equal(
    documentUrl?.toString(),
    "https://www.dlib.si/stream/URN:NBN:SI:DOC-EXAMPLE/0f0e0d0c-1111-2222-3333-444455556666/PDF",
  );
  assert.equal(isRepositoryCatalogueUrl(pageUrl), true);
});

test("follows nothing on other hosts, pages without a PDF, or links that leave the host", () => {
  assert.equal(
    findRepositoryDocumentUrl(new URL("https://example.com/details/x"), WEBFORMS_CATALOGUE_PAGE),
    null,
  );
  assert.equal(isRepositoryCatalogueUrl(new URL("https://notdlib.si/x")), false);
  assert.equal(
    findRepositoryDocumentUrl(
      new URL("https://www.dlib.si/details/URN:NBN:SI:DOC-EXAMPLE"),
      "<p>Restricted item: available in the library reading room only.</p>",
    ),
    null,
  );
  assert.equal(
    findRepositoryDocumentUrl(
      new URL("https://www.dlib.si/details/URN:NBN:SI:DOC-EXAMPLE"),
      '<a href="https://elsewhere.example/stream/URN:X/1/PDF">PDF</a>',
    ),
    null,
  );
});

test("sends back only the cookie pairs, without their attributes", () => {
  const headers = new Headers();
  headers.append("Set-Cookie", "ASP.NET_SessionId=abc123; path=/; HttpOnly; SameSite=Lax");
  headers.append("Set-Cookie", "balancer=xyz; Path=/; Expires=Fri, 02-Oct-2026 13:12:31 GMT");

  assert.equal(sessionCookieHeader(headers), "ASP.NET_SessionId=abc123; balancer=xyz");
  assert.equal(sessionCookieHeader(new Headers()), "");
});

test("titles the document by the work, not the site", () => {
  assert.equal(repositoryDocumentTitle("dLib.si - An example article"), "An example article");
  assert.equal(repositoryDocumentTitle("An example article"), "An example article");
});
