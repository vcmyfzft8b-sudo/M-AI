export const NOTE_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "sl", label: "Slovenian" },
  { value: "de", label: "German" },
  { value: "hr", label: "Croatian" },
  { value: "bs", label: "Bosnian" },
  { value: "sr", label: "Serbian" },
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
 * The language a note's material is written in, and so the one the tutor speaks
 * and previews its voices in.
 *
 * Detection over the note beats the lecture's `language_hint`, which is only what
 * the transcriber was told — for an uploaded PDF that is whatever the default was
 * rather than what is on the page. Detection answers null when it cannot tell, and
 * only then does the hint decide.
 *
 * Stated here, once, because two sides have to agree about it: the server picks the
 * voice's language for a session, and the note screen picks it for the audition the
 * learner hears before there is a session. A disagreement means auditioning a voice
 * in a language it will not be used in, which is the one thing the audition is for.
 */
export function resolveMaterialLanguage(text: string, hint?: string | null) {
  return normalizeNoteLanguage(detectSourceLanguage(text) ?? hint ?? null);
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
  // Croatian, Bosnian and Serbian share these; which of the three it is comes from the
  // orthography, not the vocabulary, so `refineBcsVariety` decides that afterwards.
  hr: ["što", "šta", "koji", "ali", "kada", "također", "takođe", "prema", "jer", "nakon"],
  de: ["der", "die", "das", "und", "nicht", "eine", "auch", "sich", "werden", "wenn"],
  it: ["che", "non", "della", "per", "come", "anche", "sono", "questo", "quando", "perché"],
};

/*
 * Serbian is written ekavian and Croatian and Bosnian are written ijekavian, and the words that
 * differ are ordinary enough to appear in any page of notes. That split is what separates the
 * three; their stop words do not, which is why they share one marker list above.
 *
 * Bosnian is deliberately not a third answer here. It is ijekavian like Croatian and differs
 * from it in vocabulary rather than orthography — too little to call from a page of text, and
 * the cost of guessing wrong is a heading reading "Usporedba" instead of "Poređenje". Bosnian
 * material is answered as `hr`, whose ijekavian furniture reads correctly in it.
 */
const EKAVIAN_MARKERS = [
  "gde", "ovde", "onde", "posle", "pre", "vreme", "uvek", "deo", "delu", "mesto", "mestu",
  "sledeći", "razume", "razumeti", "celo", "ceo", "primer", "primeri", "primera", "beleške",
  "takođe", "nedelja", "greška",
];

const IJEKAVIAN_MARKERS = [
  "gdje", "ovdje", "ondje", "poslije", "prije", "vrijeme", "uvijek", "dio", "dijelu", "mjesto",
  "mjestu", "sljedeći", "razumije", "razumjeti", "cijelo", "cijeli", "primjer", "primjeri",
  "primjera", "bilješke", "također", "tjedan", "pogreška",
];

function countMarkers(words: readonly string[], markers: readonly string[]) {
  return words.reduce((total, word) => total + (markers.includes(word) ? 1 : 0), 0);
}

/** Which of the three the shared `hr` bucket actually is. */
function refineBcsVariety(words: readonly string[]) {
  const ekavian = countMarkers(words, EKAVIAN_MARKERS);
  const ijekavian = countMarkers(words, IJEKAVIAN_MARKERS);

  return ekavian > ijekavian ? "sr" : "hr";
}

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

  return best[0] === "hr" ? refineBcsVariety(words) : best[0];
}
