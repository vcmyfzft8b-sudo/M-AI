import "server-only";

import { normalizeNoteLanguage, resolveNoteLanguageLabel } from "@/lib/languages";

export type CalloutLabels = {
  definition: string;
  example: string;
  commonMistake: string;
  keyTakeaway: string;
};

const CALLOUT_LABELS: Record<string, CalloutLabels> = {
  en: {
    definition: "Definition",
    example: "Example",
    commonMistake: "Common mistake",
    keyTakeaway: "Key takeaway",
  },
  sl: {
    definition: "Definicija",
    example: "Primer",
    commonMistake: "Pogosta napaka",
    keyTakeaway: "Ključno",
  },
  de: {
    definition: "Definition",
    example: "Beispiel",
    commonMistake: "Häufiger Fehler",
    keyTakeaway: "Kernaussage",
  },
  hr: {
    definition: "Definicija",
    example: "Primjer",
    commonMistake: "Česta pogreška",
    keyTakeaway: "Ključno",
  },
  it: {
    definition: "Definizione",
    example: "Esempio",
    commonMistake: "Errore comune",
    keyTakeaway: "Punto chiave",
  },
};

export function resolveCalloutLabels(languageCode?: string | null): CalloutLabels {
  return CALLOUT_LABELS[normalizeNoteLanguage(languageCode)] ?? CALLOUT_LABELS.en;
}

/**
 * The language rule shared by every generation prompt. Content language follows the learner's
 * choice; technical terms, symbols, and proper names stay as the source uses them.
 */
export function buildLanguageDirective(languageCode?: string | null) {
  const code = normalizeNoteLanguage(languageCode);
  const label = resolveNoteLanguageLabel(code);

  return [
    `LANGUAGE: Write every piece of learner-facing text in ${label} (${code}) — including headings, questions, answers, explanations, and hints.`,
    `Translate source content into ${label} where needed, but keep established technical terms, formulas, units, and proper names exactly as the field uses them; give the ${label} term with the original in parentheses on first mention when both are common.`,
    `Never drift back into another language mid-text.`,
  ].join("\n");
}
