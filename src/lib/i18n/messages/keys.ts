import type { MessageValue } from "@/lib/i18n/translate";

import { sl } from "@/lib/i18n/messages/sl";

/**
 * Every message key in the app, taken from the Slovenian catalogue.
 *
 * Slovenian is the source language — the app shipped in it before the other
 * four existed — so it defines the shape and the rest are typed against it.
 * Adding a key to `sl.ts` and forgetting one of the translations is a type
 * error, not a blank label discovered in production.
 */
export type MessageKey = keyof typeof sl;

/**
 * The per-key shape, so a counted message stays a counted message in every
 * language: a translator cannot quietly replace a set of plural forms with one
 * string, nor add plural forms to a key that has no count in it.
 */
export type Messages = {
  [Key in MessageKey]: (typeof sl)[Key] extends string ? string : MessageValue;
};
