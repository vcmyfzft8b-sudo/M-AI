import assert from "node:assert/strict";
import test from "node:test";

import { docxTextNeedsPictures, orderDocxPicturePaths } from "../src/lib/docx-pictures.ts";

const relationship = (id, type, target, extra = "") =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${extra}/>`;

// Note triage, lectures 6eb2e4a0 and 8a50f10e: a Word document whose only content was one pasted
// diagram. The raw text was empty, so the picture has to be read.
test("an empty or thin Word document is read through its pictures", () => {
  assert.equal(docxTextNeedsPictures(""), true);
  assert.equal(docxTextNeedsPictures("Glasbena teorija 1. 2. 3."), true);
});

test("a Word document of text is not", () => {
  const paragraph =
    "Fotosinteza je proces, pri katerem rastline s pomočjo svetlobne energije iz ogljikovega dioksida in vode tvorijo glukozo in kisik. Poteka v kloroplastih listnih celic.";

  assert.equal(docxTextNeedsPictures([paragraph, paragraph].join("\n")), false);
});

test("pictures come in page order, once each, without external links or other parts", () => {
  const relsXml = `<Relationships>${[
    relationship("rId1", "styles", "styles.xml"),
    relationship("rId4", "image", "media/image1.jpeg"),
    relationship("rId5", "image", "media/image2.png"),
    relationship("rId6", "image", "media/image3.emf"),
    relationship("rId7", "image", "https://example.com/a.png", ' TargetMode="External"'),
    relationship("rId8", "image", "media/unused.png"),
  ].join("")}</Relationships>`;
  const documentXml = [
    '<w:body><w:p><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:p>',
    '<w:p><w:pict><v:imagedata r:id="rId4"/></w:pict></w:p>',
    '<w:p><a:blip r:embed="rId6"/><a:blip r:link="rId7"/><a:blip r:embed="rId5"/></w:p></w:body>',
  ].join("");

  assert.deepEqual(orderDocxPicturePaths({ documentXml, relsXml }), [
    "word/media/image2.png",
    "word/media/image1.jpeg",
  ]);
});

test("a document with no pictures has none to read", () => {
  assert.deepEqual(
    orderDocxPicturePaths({
      documentXml: "<w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body>",
      relsXml: `<Relationships>${relationship("rId1", "styles", "styles.xml")}</Relationships>`,
    }),
    [],
  );
});

test("a picture addressed from the package root is found too", () => {
  const relsXml = `<Relationships>${relationship("rId9", "image", "/word/media/image7.png")}</Relationships>`;
  const documentXml = '<w:body><w:p><a:blip r:embed="rId9"/></w:p></w:body>';

  assert.deepEqual(orderDocxPicturePaths({ documentXml, relsXml }), ["word/media/image7.png"]);
});
