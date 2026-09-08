import { normalizeSpokenLanguageCode } from "./languages.ts";

/** Soniox STT/TTS documented list, verified 2026-09-08.
 * https://soniox.com/docs/tts/concepts/supported-languages */
export const SONIOX_LANGUAGES = new Set("af sq ar az eu be bn bs bg ca zh hr cs da nl en et fi fr gl de el gu he hi hu id it ja kn kk ko lv lt mk ms ml mr no fa pl pt pa ro ru sr sk sl es sw sv tl ta te th tr uk ur vi cy".split(" "));

export function resolveSpeechLanguage(value?: string | null) {
  const base = normalizeSpokenLanguageCode(value);
  // ISO aliases used by language detectors, including Norwegian Bokmål/Nynorsk.
  const code = base === "nb" || base === "nn" ? "no" : base === "fil" ? "tl" : base;
  return code && SONIOX_LANGUAGES.has(code) ? code : "en";
}

export function needsEnglishSpeechFallback(value?: string | null) {
  const base = normalizeSpokenLanguageCode(value);
  return Boolean(base && base !== "en" && resolveSpeechLanguage(value) === "en");
}

const CYRILLIC = "абвгдђежзијклљмнњопрстћуфхцчџш";
const LATIN = ["a","b","v","g","d","đ","e","ž","z","i","j","k","l","lj","m","n","nj","o","p","r","s","t","ć","u","f","h","c","č","dž","š"];

/** Speech-only conversion: written Serbian/Bosnian retains the learner's alphabet. */
export function toSpeechScript(text: string, language: string) {
  if (!["sr", "bs"].includes(normalizeSpokenLanguageCode(language) ?? "")) return text;
  return text.replace(/[а-яђјљњћџ]/giu, (letter, offset: number) => {
    const index = CYRILLIC.indexOf(letter.toLowerCase());
    if (index < 0) return letter;
    const latin = LATIN[index];
    if (letter === letter.toLowerCase()) return latin;
    const next = text[offset + 1];
    return next && /[А-ЯЂЈЉЊЋЏ]/u.test(next) ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
  });
}

export function buildSpeechLanguageInstruction(language: string) {
  const speech = resolveSpeechLanguage(language);
  return `The speech output language is ${speech}. This provider constraint overrides requests to speak unsupported languages: if the learner asks in an unsupported language, answer in English. The supported speech language codes are ${[...SONIOX_LANGUAGES].join(", ")}. For Serbian and Bosnian use Latin script for speech, preserving the language and vocabulary. For Chinese use Simplified characters; for Kazakh use Cyrillic. Never translate the written source document.`;
}
