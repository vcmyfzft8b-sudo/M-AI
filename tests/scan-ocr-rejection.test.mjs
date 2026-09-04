import assert from "node:assert/strict";
import test from "node:test";

import { bs } from "../src/lib/i18n/messages/bs.ts";
import { en } from "../src/lib/i18n/messages/en.ts";
import { hr } from "../src/lib/i18n/messages/hr.ts";
import { sl } from "../src/lib/i18n/messages/sl.ts";
import { sr } from "../src/lib/i18n/messages/sr.ts";
import {
  LECTURE_FAILURE_MESSAGE_KEYS,
  canRetryLectureFailureCode,
} from "../src/lib/lecture-failure-codes.ts";
import { toLectureFailureCode } from "../src/lib/lecture-processing-errors.ts";
import { NoReadableScanTextError } from "../src/lib/scan-ocr-errors.ts";
import {
  OCR_MIN_ACCEPTED_TEXT_CHARS,
  classifyImageOcrText,
  isAcceptableImageOcrText,
} from "../src/lib/scan-ocr-text.ts";

/*
 * A learner photographed one sparse page of first-aid notes on 2026-09-03. Both OCR passes read
 * it and returned 112 and 113 characters -- a handful short of the 120-character floor -- and we
 * told them the photo was unreadable. It was not: we had read it, there was simply little on the
 * page. These tests hold the two cases apart.
 */

/** A real but thin reading: under the floor, and unmistakably text. */
const SPARSE_READING =
  "Prva pomoč pri opeklinah: hladi z mlačno vodo, rane ne mažemo s kremo, pokrijemo s sterilno gazo.";

const FULL_READING = `${SPARSE_READING} Pri hujših opeklinah nemudoma pokličemo nujno medicinsko pomoč in ponesrečenca ogrejemo.`;

test("the fixture straddles the floor the way the production case did", () => {
  assert.ok(
    SPARSE_READING.length < OCR_MIN_ACCEPTED_TEXT_CHARS,
    "the sparse fixture must fall under the accepted-text floor",
  );
  assert.ok(FULL_READING.length >= OCR_MIN_ACCEPTED_TEXT_CHARS);
});

test("a real but thin reading is the material, not an unreadable photo", () => {
  assert.deepEqual(classifyImageOcrText(SPARSE_READING), {
    acceptable: false,
    rejection: "too_short",
  });
});

test("a full reading is kept", () => {
  assert.deepEqual(classifyImageOcrText(FULL_READING), { acceptable: true });
});

test("the floor is exact", () => {
  const atFloor = "a".repeat(OCR_MIN_ACCEPTED_TEXT_CHARS);
  const belowFloor = "a".repeat(OCR_MIN_ACCEPTED_TEXT_CHARS - 1);

  assert.deepEqual(classifyImageOcrText(atFloor), { acceptable: true });
  assert.deepEqual(classifyImageOcrText(belowFloor), {
    acceptable: false,
    rejection: "too_short",
  });
});

test("a refusal is an unreadable photo however long it runs", () => {
  // The length of a refusal is a property of the refusal, so it must be recognised before any
  // character count -- otherwise a wordy "I can't read this" is mistaken for sparse notes and the
  // learner is sent off to photograph more material we equally cannot read.
  const wordyRefusal =
    "I am sorry, but I cannot read this image. It appears to be out of focus and heavily overexposed, and there is nothing legible for me to transcribe from it at all.";

  assert.ok(wordyRefusal.length > OCR_MIN_ACCEPTED_TEXT_CHARS);
  assert.deepEqual(classifyImageOcrText(wordyRefusal), {
    acceptable: false,
    rejection: "unreadable",
  });

  assert.deepEqual(classifyImageOcrText("Na sliki ni berljivega besedila."), {
    acceptable: false,
    rejection: "unreadable",
  });
});

test("nothing at all is an unreadable photo", () => {
  for (const empty of ["", "   ", "\n\n\t"]) {
    assert.deepEqual(classifyImageOcrText(empty), {
      acceptable: false,
      rejection: "unreadable",
    });
  }
});

test("a page of stray marks is unreadable, not sparse", () => {
  // Short and mostly noise. Answering this with "add more pages" would be wrong: nothing was read.
  assert.deepEqual(classifyImageOcrText("~~~ ||| ~~~ ||| ~~~ |||"), {
    acceptable: false,
    rejection: "unreadable",
  });
});

test("the accept/reject verdict itself is unchanged by the split", () => {
  assert.equal(isAcceptableImageOcrText(FULL_READING), true);
  assert.equal(isAcceptableImageOcrText(SPARSE_READING), false);
  assert.equal(isAcceptableImageOcrText(""), false);
  assert.equal(isAcceptableImageOcrText("Na sliki ni berljivega besedila."), false);
});

function diagnosticsWithRejections(rejections) {
  return {
    imageCount: rejections.length,
    images: rejections.map((rejection, index) => ({
      attempts: [
        {
          acceptable: false,
          errorMessage: null,
          maxOutputTokens: 3500,
          mediaResolution: "medium",
          model: "gemini-3.5-flash-lite",
          outputLength: 112,
          rejection,
          stage: "ocr_primary",
        },
      ],
      fileName: `photo-${index}.jpg`,
      imageIndex: index,
      mimeType: "image/jpeg",
      sizeBytes: 3_466_725,
    })),
    readableImageCount: 0,
    skippedImageCount: rejections.length,
  };
}

test("the error reads its verdict off its own evidence", () => {
  assert.equal(new NoReadableScanTextError(diagnosticsWithRejections(["too_short"])).reason, "too_short");
  assert.equal(
    new NoReadableScanTextError(diagnosticsWithRejections(["unreadable"])).reason,
    "unreadable",
  );
});

test("one page we could read makes 'add more material' the right advice", () => {
  // Some photos were unreadable, but one was read and simply thin: the learner does have a
  // working camera, so the useful instruction is to add pages.
  const mixed = new NoReadableScanTextError(
    diagnosticsWithRejections(["unreadable", "too_short", "unreadable"]),
  );

  assert.equal(mixed.reason, "too_short");
});

test("a set of genuinely unreadable photos still says so", () => {
  const allUnreadable = new NoReadableScanTextError(
    diagnosticsWithRejections(["unreadable", "unreadable"]),
  );

  assert.equal(allUnreadable.reason, "unreadable");
});

test("an error carrying no diagnostics falls back to unreadable", () => {
  // What the pipeline raises when a photo produced no attempts at all.
  assert.equal(new NoReadableScanTextError({}).reason, "unreadable");
});

test("the two rejections carry different failure codes", () => {
  assert.equal(
    toLectureFailureCode(new NoReadableScanTextError(diagnosticsWithRejections(["too_short"]))),
    "scan_text_too_short",
  );
  assert.equal(
    toLectureFailureCode(new NoReadableScanTextError(diagnosticsWithRejections(["unreadable"]))),
    "scan_not_enough_text",
  );
});

test("neither rejection offers a retry that would reproduce itself", () => {
  assert.equal(canRetryLectureFailureCode("scan_text_too_short"), false);
  assert.equal(canRetryLectureFailureCode("scan_not_enough_text"), false);
});

test("the sparse-reading failure speaks every language the app does", () => {
  const key = LECTURE_FAILURE_MESSAGE_KEYS.scan_text_too_short;

  assert.equal(key, "failure.scan_text_too_short");

  for (const [locale, catalogue] of Object.entries({ sl, en, hr, bs, sr })) {
    const message = catalogue[key];

    assert.equal(typeof message, "string", `${locale} is missing ${key}`);
    assert.notEqual(
      message,
      catalogue["failure.scan_not_enough_text"],
      `${locale} tells a learner with sparse notes that their photo was unreadable`,
    );
  }
});

test("the sparse-reading message asks for more material rather than blaming the photo", () => {
  assert.match(en["failure.scan_text_too_short"], /add a few more photos/i);
  assert.doesNotMatch(en["failure.scan_text_too_short"], /unreadable|could not be read/i);
  assert.match(sl["failure.scan_text_too_short"], /Dodaj še nekaj fotografij/i);
});
