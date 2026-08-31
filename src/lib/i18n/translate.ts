// Imported by its real filename so the Node test runner can load this module directly; it
// cannot resolve the "@/" alias. See `allowImportingTsExtensions` in tsconfig.json.
import { LOCALE_INTL_TAG, type Locale } from "./locales.ts";

/**
 * One message with a count in it.
 *
 * The Slavic languages Memo now ships in do not agree with English about how
 * many plural forms a sentence has, and they do not agree with each other:
 * Slovenian distinguishes one / two / three-or-four / five-or-more, Croatian,
 * Bosnian and Serbian collapse the middle two, and English has just the two.
 * So a counted string is authored as a set of forms rather than as one string
 * with an "s" glued on, and `Intl.PluralRules` picks between them per locale.
 *
 * `other` is required because every locale has that category; the rest are
 * optional and each catalogue supplies the ones its own language actually uses.
 */
export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type MessageValue = string | PluralForms;

export type InterpolationValues = Record<string, string | number>;

/**
 * `{name}` placeholders, and nothing more clever than that. Anything needing
 * markup in the middle of a sentence is authored as separate keys instead, so
 * that a translator never has to keep a tag balanced.
 */
const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, values?: InterpolationValues) {
  if (!values) {
    return template;
  }

  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name];

    return value === undefined ? match : String(value);
  });
}

/**
 * `Intl.PluralRules` is not free to construct and a list screen asks for the
 * same one on every row, so each locale's rules are built once.
 */
const pluralRulesCache = new Map<Locale, Intl.PluralRules>();

function pluralRulesFor(locale: Locale) {
  const cached = pluralRulesCache.get(locale);

  if (cached) {
    return cached;
  }

  const rules = new Intl.PluralRules(LOCALE_INTL_TAG[locale]);
  pluralRulesCache.set(locale, rules);

  return rules;
}

/**
 * The form of `forms` that `count` takes in `locale`, falling back through the
 * categories a language might not define down to `other`, which every
 * catalogue must carry.
 */
export function selectPluralForm(locale: Locale, forms: PluralForms, count: number) {
  const category = pluralRulesFor(locale).select(count);

  return forms[category] ?? forms.other;
}

export function isPluralForms(value: MessageValue): value is PluralForms {
  return typeof value === "object" && value !== null && "other" in value;
}

/**
 * Resolve one key against a locale's catalogue, then the fallbacks behind it.
 *
 * In practice the fallbacks never fire: every catalogue is typed against the
 * Slovenian one, so an incomplete translation is a build error rather than a
 * blank label. They exist for the case a message arrives from outside
 * TypeScript's reach — a locale read from an old cookie, a catalogue trimmed by
 * a bad merge — where showing the wrong language beats showing a key.
 */
export function resolveMessage(
  key: string,
  dictionaries: ReadonlyArray<Readonly<Record<string, MessageValue>>>,
): MessageValue | null {
  for (const dictionary of dictionaries) {
    const value = dictionary[key];

    if (value !== undefined) {
      return value;
    }
  }

  return null;
}

export type Translate<Key extends string = string> = (
  key: Key,
  values?: InterpolationValues & { count?: number },
) => string;

/**
 * Build the `t` a component calls.
 *
 * `dictionaries` is the lookup chain, most specific first. A counted message is
 * asked for with `{ count }` in the values, which both selects the plural form
 * and interpolates as `{count}`.
 */
export function createTranslator<Key extends string = string>(
  locale: Locale,
  dictionaries: ReadonlyArray<Readonly<Record<string, MessageValue>>>,
): Translate<Key> {
  return function translate(key, values) {
    const message = resolveMessage(key, dictionaries);

    if (message === null) {
      // Nothing sensible left to render. The key itself is the least
      // misleading thing to show, and it names what is missing.
      return key;
    }

    const template = isPluralForms(message)
      ? selectPluralForm(locale, message, Number(values?.count ?? 0))
      : message;

    return interpolate(template, values);
  };
}
