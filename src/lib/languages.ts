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

/** Content language is independent of the five interface catalogues. */
export function normalizeContentLanguageCode(value?: string | null): string | null {
  const input = value?.trim().replaceAll("_", "-");
  if (!input || !/^[a-z]{2,3}(?:-[a-z]{4})?(?:-[a-z]{2}|-\d{3})?$/iu.test(input)) return null;
  try {
    const canonical = Intl.getCanonicalLocales(input)[0];
    const [base, script] = canonical.split("-");
    if (["und", "zxx", "mul"].includes(base)) return null;
    return script?.length === 4 ? `${base}-${script}` : base;
  } catch {
    return null;
  }
}

export function normalizeNoteLanguage(value?: string | null) {
  return normalizeContentLanguageCode(value) ?? "en";
}

export function normalizeSpokenLanguageCode(value?: string | null) {
  return normalizeContentLanguageCode(value)?.split("-")[0] ?? null;
}

export function resolveNoteLanguageLabel(value?: string | null) {
  const language = normalizeNoteLanguage(value);
  return NOTE_LANGUAGE_LABELS.get(language) ?? new Intl.DisplayNames(["en"], { type: "language" }).of(language) ?? language;
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
  const detected = detectSourceLanguage(text);
  const known = normalizeContentLanguageCode(hint);
  // Closely related BCS varieties cannot always be distinguished from a short passage.
  if (known && /^(bs|hr|sr)(-|$)/u.test(known) && detected && ["bs", "hr", "sr"].includes(detected)) return known;
  return normalizeNoteLanguage(detected ?? known);
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
export function buildGeneratedContentLanguageInstruction(language?: string | null) {
  return (
    (normalizeContentLanguageCode(language) ? `The detected source language is ${normalizeContentLanguageCode(language)}. Write in that language and preserve its script, regional spelling and vocabulary. ` : "") +
    "Write all generated study material in the same language as the source material. " +
    "Do not translate it into another language, and do not fall back to English because " +
    "the instructions are in English. Where the source mixes languages, follow the one " +
    "the body of the material is written in, and keep technical terms, proper nouns and " +
    "quoted wording exactly as the source has them. Bosnian, Croatian, Serbian and Slovenian are distinct: never substitute one for another. Keep Serbian Cyrillic when the source uses Cyrillic. All headings, callouts, summaries, questions, answers and explanations follow the same source language and script."
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
  et: ["ja", "on", "mis", "kui", "ning", "seda", "selle", "võib", "kuidas", "tõttu", "ehk", "kuid"],
  fr: ["les", "des", "une", "dans", "avec", "pour", "sont", "cette", "aussi", "mais"],
  pl: ["jest", "który", "które", "przez", "oraz", "się", "ponieważ", "może", "tego", "także"],
  it: ["che", "non", "della", "per", "come", "anche", "sono", "questo", "quando", "perché"],
};

/* BCS orthography is evidence, not a substitute for a detected document language.
 * Serbian may be ekavian OR ijekavian and may use either alphabet. */
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

  if (ekavian > ijekavian) return "sr";
  const bosnian = countMarkers(words, ["historija", "historijski", "opći", "općina", "kahva", "lahko", "poređenje", "funkcioniše", "sedmica", "faktor"]);
  const croatian = countMarkers(words, ["povijest", "povijesni", "opći", "općina", "kava", "usporedba", "funkcionira", "tjedan", "čimbenik"]);
  return bosnian > croatian ? "bs" : "hr";
}

/** Below this the sample is too short for the counts to mean anything. */
const MIN_WORDS_FOR_DETECTION = 12;

/** Fast local evidence for previews, conversation switches and outage fallback.
 * General document detection is server-side in source-language.ts; unknown stays null. */
export function detectSourceLanguage(text: string): string | null {
  // Serbian's distinct Cyrillic letters identify its script without a Latin-only word list.
  if (/[ђћљњџЂЋЉЊЏ]/u.test(text) && /[\p{Script=Cyrillic}]/u.test(text)) return "sr-Cyrl";
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

  if (!best || best[1] < 2 || best[1] / words.length < 0.035) {
    return null;
  }

  // A clear winner, not a coin toss between two close neighbours.
  if (runnerUp && runnerUp[1] > best[1] * 0.7) {
    return null;
  }

  return best[0] === "hr" ? refineBcsVariety(words) : best[0];
}
