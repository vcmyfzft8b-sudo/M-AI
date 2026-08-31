import assert from "node:assert/strict";
import test from "node:test";

import { LOCALES, LOCALE_BCP47, localeForCountry, parseLocale } from "../src/lib/i18n/locales.ts";
import { sl } from "../src/lib/i18n/messages/sl.ts";
import { en } from "../src/lib/i18n/messages/en.ts";
import { hr } from "../src/lib/i18n/messages/hr.ts";
import { bs } from "../src/lib/i18n/messages/bs.ts";
import { sr } from "../src/lib/i18n/messages/sr.ts";

/*
 * TypeScript already forces every catalogue to carry every key `sl.ts` declares. These tests
 * cover what the type system cannot see: that the plural forms a language actually needs are
 * present, that no translation invented or dropped a `{placeholder}`, and that nothing was left
 * as a copy of the Slovenian source by accident.
 */

const CATALOGUES = { sl, en, hr, bs, sr };

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(value) {
  const forms = typeof value === "string" ? [value] : Object.values(value);

  return new Set(forms.flatMap((form) => [...form.matchAll(PLACEHOLDER)].map((match) => match[1])));
}

/** The categories `Intl.PluralRules` can actually return for a language, from a wide sample. */
function pluralCategoriesFor(locale) {
  const rules = new Intl.PluralRules(LOCALE_BCP47[locale]);
  const sample = [0, 1, 2, 3, 4, 5, 11, 12, 21, 22, 23, 25, 101, 102, 111, 1.5];

  return new Set(sample.map((count) => rules.select(count)));
}

test("every catalogue holds exactly the keys the Slovenian source declares", () => {
  const expected = Object.keys(sl).sort();

  for (const locale of LOCALES) {
    assert.deepEqual(
      Object.keys(CATALOGUES[locale]).sort(),
      expected,
      `${locale} does not carry the same keys as sl`,
    );
  }
});

test("a counted message stays counted in every language", () => {
  for (const key of Object.keys(sl)) {
    const isPlural = typeof sl[key] !== "string";

    for (const locale of LOCALES) {
      assert.equal(
        typeof CATALOGUES[locale][key] !== "string",
        isPlural,
        `${locale} changed the shape of "${key}"`,
      );
    }
  }
});

test("every plural message covers the forms its language actually uses", () => {
  for (const locale of LOCALES) {
    const categories = pluralCategoriesFor(locale);

    for (const [key, value] of Object.entries(CATALOGUES[locale])) {
      if (typeof value === "string") {
        continue;
      }

      for (const category of categories) {
        assert.ok(
          typeof value[category] === "string",
          `${locale} "${key}" has no "${category}" form, which ${locale} needs`,
        );
      }
    }
  }
});

test("a translation neither invents nor drops a placeholder", () => {
  for (const [key, sourceValue] of Object.entries(sl)) {
    const expected = [...placeholders(sourceValue)].sort();

    for (const locale of LOCALES) {
      assert.deepEqual(
        [...placeholders(CATALOGUES[locale][key])].sort(),
        expected,
        `${locale} "${key}" does not use the same placeholders as sl`,
      );
    }
  }
});

test("no message is blank", () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(CATALOGUES[locale])) {
      const forms = typeof value === "string" ? [value] : Object.values(value);

      for (const form of forms) {
        assert.ok(form.length > 0, `${locale} "${key}" is empty`);
      }
    }
  }
});

/*
 * A translated catalogue that still reads exactly like the Slovenian one is the signature of a
 * key that was copied rather than translated. Some keys are legitimately identical — brand names,
 * "PDF", "Demo", numbers — so this asserts a ratio rather than a rule, and is a smoke test for a
 * whole catalogue going untranslated rather than a check on any one string.
 */
test("each translation actually differs from the Slovenian source", () => {
  const total = Object.keys(sl).length;

  for (const locale of LOCALES.filter((candidate) => candidate !== "sl")) {
    const identical = Object.keys(sl).filter(
      (key) => JSON.stringify(CATALOGUES[locale][key]) === JSON.stringify(sl[key]),
    );

    assert.ok(
      identical.length < total * 0.15,
      `${locale} repeats the Slovenian wording for ${identical.length}/${total} keys`,
    );
  }
});

test("only the four home markets are detected by country; everywhere else is English", () => {
  assert.equal(localeForCountry("SI"), "sl");
  assert.equal(localeForCountry("HR"), "hr");
  assert.equal(localeForCountry("BA"), "bs");
  assert.equal(localeForCountry("RS"), "sr");

  // Lowercased by a proxy on the way in, which must not change the answer.
  assert.equal(localeForCountry("hr"), "hr");

  for (const country of ["DE", "AT", "IT", "US", "GB", "ME", "XK", ""]) {
    assert.equal(localeForCountry(country), null, `${country} must fall through to the default`);
  }

  assert.equal(localeForCountry(null), null);
  assert.equal(localeForCountry(undefined), null);
});

test("a locale read from a cookie or a database column is validated", () => {
  assert.equal(parseLocale("hr"), "hr");
  assert.equal(parseLocale(" SR "), "sr");
  assert.equal(parseLocale("sr-Latn"), null);
  assert.equal(parseLocale("de"), null);
  assert.equal(parseLocale(""), null);
  assert.equal(parseLocale(null), null);
  assert.equal(parseLocale(42), null);
});
