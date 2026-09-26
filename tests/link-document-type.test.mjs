import assert from "node:assert/strict";
import test from "node:test";

import { resolveLinkDocumentType } from "../src/lib/link-source-validation.ts";

// Three of the week's failed notes (2026-09) were links straight to a PDF, turned away with
// "download it and upload it" when downloading it is exactly what we can do.
test("a PDF link is read as a document by its content type", () => {
  assert.equal(
    resolveLinkDocumentType("application/pdf", new URL("https://cpi.si/wp-content/uploads/2020/08/LEPILA.pdf"))
      ?.extension,
    "pdf",
  );
});

test("a generic download is recognised by the file name in the link", () => {
  assert.equal(
    resolveLinkDocumentType("application/octet-stream", new URL("https://example.org/files/skripta.pdf"))
      ?.extension,
    "pdf",
  );
  assert.equal(
    resolveLinkDocumentType("", new URL("https://example.org/predavanje.pptx"))?.extension,
    "pptx",
  );
});

test("a web page stays a web page", () => {
  assert.equal(resolveLinkDocumentType("text/html; charset=utf-8", new URL("https://example.org/a.pdf")), null);
  assert.equal(resolveLinkDocumentType("application/octet-stream", new URL("https://example.org/archive.zip")), null);
});
