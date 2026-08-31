import assert from "node:assert/strict";
import test from "node:test";

import { createTranslator, interpolate, selectPluralForm } from "../src/lib/i18n/translate.ts";
import { bs } from "../src/lib/i18n/messages/bs.ts";
import { en } from "../src/lib/i18n/messages/en.ts";
import { hr } from "../src/lib/i18n/messages/hr.ts";
import { sl } from "../src/lib/i18n/messages/sl.ts";
import { sr } from "../src/lib/i18n/messages/sr.ts";

const CATALOGUES = { sl, en, hr, bs, sr };

function translatorFor(locale) {
  return createTranslator(locale, [CATALOGUES[locale], en]);
}

test("a placeholder is filled, and an unknown one is left alone", () => {
  assert.equal(interpolate("Hi {name}", { name: "Ana" }), "Hi Ana");
  assert.equal(interpolate("Hi {name}", { other: "Ana" }), "Hi {name}");
  assert.equal(interpolate("Hi {name}", undefined), "Hi {name}");
  assert.equal(interpolate("{count} of {total}", { count: 2, total: 8 }), "2 of 8");
});

/*
 * The reason plurals are message data rather than an `n === 1` check anywhere in the app.
 * Slovenian has a separate form for exactly two and another for three or four; Croatian,
 * Bosnian and Serbian group two-to-four together; English has one form and a plural. The same
 * key, the same counts, five different answers.
 */
test("Slovenian counts one, two, few and many separately", () => {
  const t = translatorFor("sl");

  assert.equal(t("source.pages", { count: 1 }), "1 stran");
  assert.equal(t("source.pages", { count: 2 }), "2 strani");
  assert.equal(t("source.pages", { count: 3 }), "3 strani");
  assert.equal(t("source.pages", { count: 7 }), "7 strani");
  assert.equal(t("source.slides", { count: 1 }), "1 prosojnica");
  assert.equal(t("source.slides", { count: 2 }), "2 prosojnici");
  assert.equal(t("source.slides", { count: 3 }), "3 prosojnice");
  assert.equal(t("source.slides", { count: 7 }), "7 prosojnic");
});

test("Croatian, Bosnian and Serbian group two to four together", () => {
  for (const locale of ["hr", "bs", "sr"]) {
    const t = translatorFor(locale);

    assert.equal(t("source.slides", { count: 1 }), "1 slajd", locale);
    assert.equal(t("source.slides", { count: 2 }), "2 slajda", locale);
    assert.equal(t("source.slides", { count: 4 }), "4 slajda", locale);
    assert.equal(t("source.slides", { count: 5 }), "5 slajdova", locale);
    // 11–14 take the "many" form even though they end in 1–4.
    assert.equal(t("source.slides", { count: 11 }), "11 slajdova", locale);
    assert.equal(t("source.slides", { count: 21 }), "21 slajd", locale);
  }
});

test("English has one form and a plural", () => {
  const t = translatorFor("en");

  assert.equal(t("source.pages", { count: 1 }), "1 page");
  assert.equal(t("source.pages", { count: 2 }), "2 pages");
  assert.equal(t("source.pages", { count: 0 }), "0 pages");
});

test("a plural falls back to `other` where a language does not define the category", () => {
  // English has no "few"; asking for it must not produce undefined.
  assert.equal(selectPluralForm("en", { one: "card", other: "cards" }, 3), "cards");
});

test("a key with no message anywhere renders as itself rather than as blank", () => {
  const t = createTranslator("sl", [{}]);

  assert.equal(t("nothing.here"), "nothing.here");
});

test("a message missing from a locale falls through to the next catalogue", () => {
  const t = createTranslator("hr", [{}, { "common.save": "Save" }]);

  assert.equal(t("common.save"), "Save");
});

test("the same key gives a different sentence in each language", () => {
  const rendered = ["sl", "en", "hr", "bs", "sr"].map((locale) =>
    translatorFor(locale)("settings.title"),
  );

  assert.equal(new Set(rendered).size >= 3, true, rendered.join(" / "));
});
