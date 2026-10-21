import assert from "node:assert/strict";
import test from "node:test";

import {
  docxTextNeedsPictures,
  orderDocxPicturePaths,
  readEmfText,
} from "../src/lib/docx-pictures.ts";

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
  // An EMF stays in: its text is read from the file (lecture f028ac0c). Unknown formats do not.
  const relsXml = `<Relationships>${[
    relationship("rId1", "styles", "styles.xml"),
    relationship("rId4", "image", "media/image1.jpeg"),
    relationship("rId5", "image", "media/image2.png"),
    relationship("rId6", "image", "media/image3.emf"),
    relationship("rId7", "image", "https://example.com/a.png", ' TargetMode="External"'),
    relationship("rId8", "image", "media/unused.png"),
    relationship("rId10", "image", "media/image4.svg"),
  ].join("")}</Relationships>`;
  const documentXml = [
    '<w:body><w:p><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:p>',
    '<w:p><w:pict><v:imagedata r:id="rId4"/></w:pict></w:p>',
    '<w:p><a:blip r:embed="rId6"/><a:blip r:link="rId7"/><a:blip r:embed="rId5"/><a:blip r:embed="rId10"/></w:p></w:body>',
  ].join("");

  assert.deepEqual(orderDocxPicturePaths({ documentXml, relsXml }), [
    "word/media/image2.png",
    "word/media/image1.jpeg",
    "word/media/image3.emf",
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

/** An EMF of the given records: header, then the records, then EOF, each padded to 4 bytes. */
function emf(records) {
  const header = Buffer.alloc(88);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(88, 4);
  header.write(" EMF", 40, "latin1");
  const eof = Buffer.alloc(20);
  eof.writeUInt32LE(14, 0);
  eof.writeUInt32LE(20, 4);
  return new Uint8Array(Buffer.concat([header, ...records, eof]));
}

/** An EMR_EXTTEXTOUTW drawing `text` on the baseline `y`. */
function textRecord(text, y) {
  const string = Buffer.from(text, "utf16le");
  const stringOffset = 76;
  const size = stringOffset + Math.ceil(string.length / 4) * 4;
  const record = Buffer.alloc(size);
  record.writeUInt32LE(84, 0);
  record.writeUInt32LE(size, 4);
  record.writeInt32LE(y, 40);
  record.writeUInt32LE(text.length, 44);
  record.writeUInt32LE(stringOffset, 48);
  string.copy(record, stringOffset);
  return record;
}

/** A record the reader has no use for (EMR_SETTEXTCOLOR). */
function otherRecord() {
  const record = Buffer.alloc(12);
  record.writeUInt32LE(24, 0);
  record.writeUInt32LE(12, 4);
  return record;
}

// Note triage, lecture f028ac0c: a page of notes pasted into Word as one EMF picture. Its text is
// drawn as text records, a run per styled stretch of a line.
test("an EMF picture is read as the lines of text it draws", () => {
  const bytes = emf([
    textRecord("Celična membrana:", 100),
    otherRecord(),
    textRecord(" obdaja celico", 100),
    textRecord("Mitohondrij — elektrarna celice", 140),
    textRecord("   ", 180),
  ]);

  assert.equal(
    readEmfText(bytes),
    "Celična membrana: obdaja celico\nMitohondrij — elektrarna celice",
  );
});

test("an EMF without text, a damaged one, or not an EMF at all reads as empty", () => {
  assert.equal(readEmfText(emf([otherRecord()])), "");
  assert.equal(readEmfText(new Uint8Array(Buffer.from("\x89PNG not a metafile at all, really not"))), "");

  const cut = emf([textRecord("Prva vrstica", 10), textRecord("Druga vrstica", 20)]);
  assert.equal(readEmfText(cut.subarray(0, cut.length - 40)), "Prva vrstica");
});
