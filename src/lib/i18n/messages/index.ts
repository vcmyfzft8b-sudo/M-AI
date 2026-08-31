import { DEFAULT_LOCALE, SOURCE_LOCALE, type Locale } from "@/lib/i18n/locales";

import { bs } from "@/lib/i18n/messages/bs";
import { en } from "@/lib/i18n/messages/en";
import { hr } from "@/lib/i18n/messages/hr";
import { sl } from "@/lib/i18n/messages/sl";
import { sr } from "@/lib/i18n/messages/sr";
import type { MessageKey, Messages } from "@/lib/i18n/messages/keys";

const CATALOGUES: Record<Locale, Messages> = { sl, en, hr, bs, sr };

export function getMessages(locale: Locale): Messages {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE] ?? CATALOGUES[SOURCE_LOCALE];
}

export { CATALOGUES, bs, en, hr, sl, sr };
export type { MessageKey, Messages };
