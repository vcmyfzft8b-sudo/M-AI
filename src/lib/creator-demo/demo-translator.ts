"use client";

import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

/**
 * The `/creator` demo's store and its offline API run in the browser but
 * outside React, so they cannot reach for `useT` when they produce a string —
 * grading feedback on a practice answer, a default folder name, the message
 * behind a 404. `CreatorDemoProvider` registers the reader's translator while
 * it renders, before any child can call in here, so by the time one of these
 * is asked for it is set.
 *
 * The fallback returns the key rather than a plausible-looking wrong language:
 * an unregistered translator is a wiring bug, and it should look like one.
 */
let translate: Translate<MessageKey> | null = null;

export function setCreatorDemoTranslator(t: Translate<MessageKey>) {
  translate = t;
}

export function demoT(key: MessageKey): string {
  return translate ? translate(key) : key;
}
