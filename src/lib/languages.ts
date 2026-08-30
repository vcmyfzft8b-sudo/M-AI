export const NOTE_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "sl", label: "Slovenian" },
  { value: "de", label: "German" },
  { value: "hr", label: "Croatian" },
  { value: "it", label: "Italian" },
] as const;

const NOTE_LANGUAGE_LABELS = new Map<string, string>(
  NOTE_LANGUAGE_OPTIONS.map((option) => [option.value, option.label]),
);

export function normalizeNoteLanguage(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized && NOTE_LANGUAGE_LABELS.has(normalized) ? normalized : "en";
}

export function resolveNoteLanguageLabel(value?: string | null) {
  return NOTE_LANGUAGE_LABELS.get(normalizeNoteLanguage(value)) ?? "English";
}

/**
 * Nobody picks a language any more: study material is written in whatever
 * language the source is in.
 *
 * Said as a rule about the source rather than as a language name, because the
 * model can see the source and we cannot — a note built from a Slovenian
 * lecture comes back in Slovenian without anyone having declared that. The
 * mixed case is the one worth being explicit about: lecture slides are often
 * English inside an otherwise Slovenian course, and the body of the material is
 * what should decide.
 */
export function buildGeneratedContentLanguageInstruction() {
  return (
    "Write all generated study material in the same language as the source material. " +
    "Do not translate it into another language, and do not fall back to English because " +
    "the instructions are in English. Where the source mixes languages, follow the one " +
    "the body of the material is written in, and keep technical terms, proper nouns and " +
    "quoted wording exactly as the source has them."
  );
}

/*
 * Stop words that are common in one of the supported languages and rare in the
 * rest. Slovenian and Croatian overlap heavily, so each list leans on the words
 * that actually separate them — "je" and "in" are useless here, "ki", "za",
 * "oziroma" against "što", "je li", "ali" are not.
 */
const LANGUAGE_MARKERS: Record<string, readonly string[]> = {
  en: ["the", "and", "of", "that", "with", "this", "which", "from", "there", "because"],
  sl: ["ki", "oziroma", "kjer", "lahko", "tudi", "zato", "pri", "med", "svoj", "vendar"],
  hr: ["što", "koji", "ali", "kada", "ovdje", "također", "prema", "svoj", "jer", "nakon"],
  de: ["der", "die", "das", "und", "nicht", "eine", "auch", "sich", "werden", "wenn"],
  it: ["che", "non", "della", "per", "come", "anche", "sono", "questo", "quando", "perché"],
};

/** Below this the sample is too short for the counts to mean anything. */
const MIN_WORDS_FOR_DETECTION = 12;

/**
 * The language a piece of source material is written in, as one of the codes
 * above, or `null` when the text is too short or too ambiguous to say.
 *
 * This is not a general language detector and does not need to be. It exists so
 * that read-aloud can align its audio and the assistant can answer in the right
 * language once the user is no longer telling us — and for that, telling five
 * known languages apart on a page of text is the whole job. Returning `null`
 * rather than guessing matters: callers treat "unknown" as "let the provider
 * detect it", which is better than a confident wrong answer.
 */
export function detectSourceLanguage(text: string): string | null {
  const words = text
    .toLowerCase()
    .replace(/[^\p{Letter}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < MIN_WORDS_FOR_DETECTION) {
    return null;
  }

  const counts = new Map<string, number>();

  for (const word of words) {
    for (const [code, markers] of Object.entries(LANGUAGE_MARKERS)) {
      if (markers.includes(word)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [best, runnerUp] = ranked;

  if (!best || best[1] === 0) {
    return null;
  }

  // A clear winner, not a coin toss between two close neighbours.
  if (runnerUp && runnerUp[1] > best[1] * 0.7) {
    return null;
  }

  return best[0];
}
