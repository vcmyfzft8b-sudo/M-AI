import assert from "node:assert/strict";
import test from "node:test";

import { noteTextSchema } from "../src/lib/validation.ts";

const paragraph = "Fotosinteza je proces, pri katerem rastline pretvarjajo svetlobo v glukozo. ";
const body = paragraph.repeat(4);
const FORM_FEED = "\u000c";
const VERTICAL_TAB = "\u000b";
const NUL = "\u0000";

test("a page break in pasted text is a paragraph break, not a rejection", () => {
  // Text copied out of a PDF carries a form feed at every page boundary. Refusing the paste over
  // one is the likeliest way a long paste fails now that whole documents are pasteable, and the
  // message the user saw named neither the character nor the page it came from.
  const parsed = noteTextSchema.safeParse(`${body}${FORM_FEED}${body}`);

  assert.ok(parsed.success, parsed.success ? "" : parsed.error.issues[0]?.message);
  assert.ok(!parsed.data.includes(FORM_FEED));
  // The source pipeline splits blocks on blank lines, so the page boundary survives as one.
  assert.ok(parsed.data.includes("\n\n"));
});

test("a vertical tab is treated the same way, since word processors emit it as a break", () => {
  const parsed = noteTextSchema.safeParse(`${body}${VERTICAL_TAB}${body}`);

  assert.ok(parsed.success, parsed.success ? "" : parsed.error.issues[0]?.message);
  assert.ok(!parsed.data.includes(VERTICAL_TAB));
});

test("genuinely unstorable characters are still refused", () => {
  // A NUL byte cannot be written to Postgres at all, so it must not be waved through alongside
  // the page breaks.
  assert.equal(noteTextSchema.safeParse(`${body}${NUL}${body}`).success, false);
});

test("the paste limits still hold at both ends", () => {
  assert.equal(noteTextSchema.safeParse("too short").success, false);
  assert.equal(noteTextSchema.safeParse("a".repeat(4_000_001)).success, false);
  assert.equal(noteTextSchema.safeParse("a".repeat(3_999_000)).success, true);
});
