/**
 * The oral quiz the creator demo plays at `/creator/oral-quiz`: a scripted
 * exchange between the tutor and a learner, made for UGC videos and nothing else.
 *
 * It is a skit, not a lesson. The creator plays the learner and says the learner's
 * lines out loud; the tutor's lines are recordings (see
 * `scripts/generate-oral-quiz-clips.mjs`), and the screen reads each one with the
 * word being spoken highlighted. Nothing here is generated, and the real tutor
 * never reads from it.
 *
 * One script per app language. The joke is the English mnemonic, so it stays in
 * English in every one of them: "DICK" and the four English drug names it spells
 * are printed as they are, and the voice is told to say them the English way.
 * Everything around the mnemonic is translated. The screen's own chrome comes
 * from the i18n catalogues.
 */

import type { Locale } from "@/lib/i18n/locales";

export type OralQuizTutorTurn = {
  speaker: "tutor";
  /** File name stem of the recording, `public/creator-demo/oral-quiz/<locale>/<voice>-<clip>.mp3`. */
  clip: string;
  /** What the screen shows, word for word. */
  text: string;
  /** "quiz" turns are the back-and-forth; "lesson" turns are the explanation under the title. */
  part: "quiz" | "lesson";
};

export type OralQuizLearnerTurn = {
  speaker: "learner";
  /** The creator's line. The screen prints it as the tutor "hears" it. */
  text: string;
  /** How long the screen waits for it, measured off the original video. */
  ms: number;
  part: "quiz" | "lesson";
};

export type OralQuizTurn = OralQuizTutorTurn | OralQuizLearnerTurn;

export type OralQuizScript = { title: string; turns: OralQuizTurn[] };

export const ORAL_QUIZ_VOICE = "Grace";

/*
 * The exchange's shape, the same in every language: who speaks, in which part, and
 * how long the creator gets for each line (the gaps in the original video).
 */
const SHAPE = [
  { speaker: "tutor", clip: "1", part: "quiz" },
  { speaker: "learner", part: "quiz", ms: 4000 },
  { speaker: "tutor", clip: "2", part: "quiz" },
  { speaker: "learner", part: "quiz", ms: 800 },
  { speaker: "tutor", clip: "3", part: "quiz" },
  { speaker: "learner", part: "quiz", ms: 1300 },
  { speaker: "tutor", clip: "4", part: "lesson" },
  { speaker: "learner", part: "lesson", ms: 600 },
  { speaker: "tutor", clip: "5", part: "lesson" },
] as const;

type Lines = { title: string; lines: [string, string, string, string, string, string, string, string, string] };

const LINES: Record<Locale, Lines> = {
  en: {
    title: "How to administer D-I-C-K",
    lines: [
      "Your patient needs some DICK. How do you give it to her?",
      "Well, obviously I'm going to do it with consent.",
      "The patient is unconscious. She can't give consent.",
      "Oh.",
      "You just have to give her the DICK anyway.",
      "Unconsensually?",
      "Remember, DICK stands for dextrose, insulin, calcium, and Kayexalate.",
      "Oh.",
      "You need to administer it in that order, and the way to do it is this. " +
        "Dextrose goes in as an IV bolus so the insulin doesn't crash her blood sugar. " +
        "Insulin goes IV push right behind it, and it drives potassium into the cells within about fifteen minutes. " +
        "Calcium gluconate goes IV over a few minutes to protect her heart from arrhythmia while the potassium comes down. " +
        "Kayexalate goes in last, by mouth or rectally, to pull the extra potassium out of her body for good.",
    ],
  },
  sl: {
    title: "Kako dati D-I-C-K",
    lines: [
      "Tvoja pacientka potrebuje malo DICK-a. Kako ji ga daš?",
      "Seveda samo s privolitvijo.",
      "Pacientka je nezavestna. Privolitve ne more dati.",
      "Oh.",
      "Potem ji moraš DICK vseeno dati.",
      "Brez privolitve?",
      "Zapomni si: DICK pomeni dextrose, insulin, calcium in Kayexalate.",
      "Oh.",
      "Dati jih moraš v tem vrstnem redu, in sicer takole. " +
        "Dekstroza gre najprej kot IV bolus, da insulin ne zniža preveč krvnega sladkorja. " +
        "Insulin gre IV takoj za njo in v približno petnajstih minutah potisne kalij v celice. " +
        "Kalcijev glukonat daš IV v nekaj minutah, da zaščitiš srce pred aritmijo, medtem ko kalij pada. " +
        "Kayexalate pride zadnji, skozi usta ali rektalno, da odvečni kalij za vedno odstrani iz telesa.",
    ],
  },
  hr: {
    title: "Kako dati D-I-C-K",
    lines: [
      "Tvojoj pacijentici treba malo DICK-a. Kako ćeš joj ga dati?",
      "Pa naravno, samo uz pristanak.",
      "Pacijentica je bez svijesti. Ne može dati pristanak.",
      "Oh.",
      "Onda joj DICK moraš dati svejedno.",
      "Bez pristanka?",
      "Zapamti: DICK znači dextrose, insulin, calcium i Kayexalate.",
      "Oh.",
      "Moraš ih dati tim redoslijedom, i to ovako. " +
        "Dekstroza ide prva kao IV bolus, da inzulin ne sruši šećer u krvi. " +
        "Inzulin ide IV odmah za njom i za otprilike petnaest minuta potiskuje kalij u stanice. " +
        "Kalcijev glukonat daješ IV kroz nekoliko minuta da zaštitiš srce od aritmije dok kalij pada. " +
        "Kayexalate ide zadnji, na usta ili rektalno, da zauvijek izbaci višak kalija iz tijela.",
    ],
  },
  bs: {
    title: "Kako dati D-I-C-K",
    lines: [
      "Tvojoj pacijentici treba malo DICK-a. Kako ćeš joj ga dati?",
      "Pa naravno, samo uz pristanak.",
      "Pacijentica je bez svijesti. Ne može dati pristanak.",
      "Oh.",
      "Onda joj DICK moraš dati svejedno.",
      "Bez pristanka?",
      "Zapamti: DICK znači dextrose, insulin, calcium i Kayexalate.",
      "Oh.",
      "Moraš ih dati tim redoslijedom, i to ovako. " +
        "Dekstroza ide prva kao IV bolus, da inzulin ne obori šećer u krvi. " +
        "Inzulin ide IV odmah iza nje i za otprilike petnaest minuta ubacuje kalij u ćelije. " +
        "Kalcijum glukonat daješ IV kroz nekoliko minuta da zaštitiš srce od aritmije dok kalij pada. " +
        "Kayexalate ide posljednji, na usta ili rektalno, da zauvijek izbaci višak kalija iz tijela.",
    ],
  },
  sr: {
    title: "Kako dati D-I-C-K",
    lines: [
      "Tvojoj pacijentkinji treba malo DICK-a. Kako ćeš joj ga dati?",
      "Pa naravno, samo uz pristanak.",
      "Pacijentkinja je bez svesti. Ne može da da pristanak.",
      "Oh.",
      "Onda joj DICK moraš dati svejedno.",
      "Bez pristanka?",
      "Zapamti: DICK znači dextrose, insulin, calcium i Kayexalate.",
      "Oh.",
      "Moraš ih dati tim redosledom, i to ovako. " +
        "Dekstroza ide prva kao IV bolus, da insulin ne obori šećer u krvi. " +
        "Insulin ide IV odmah iza nje i za otprilike petnaest minuta ubacuje kalijum u ćelije. " +
        "Kalcijum glukonat daješ IV tokom nekoliko minuta da zaštitiš srce od aritmije dok kalijum pada. " +
        "Kayexalate ide poslednji, na usta ili rektalno, da zauvek izbaci višak kalijuma iz tela.",
    ],
  },
};

/*
 * How the voice is told to say a printed word, where the printed spelling would come
 * out wrong. One word for one word, always, so each spoken word still lands on its
 * printed one. In the four South Slavic languages the English mnemonic is spelled the
 * way an English speaker says it, or the voice reads "calcium" as "tsaltsium" and
 * "IV" as a Roman numeral.
 */
const SOUTH_SLAVIC_SPOKEN = {
  DICK: "dik",
  // Declined ("malo DICK-a", the genitive after "malo"), said as one word.
  "DICK-a": "dika",
  dextrose: "dekstrouz",
  calcium: "kelsijem",
  Kayexalate: "kajeksalejt",
};

const SPOKEN: Record<Locale, Record<string, string>> = {
  en: { DICK: "dick" },
  sl: { ...SOUTH_SLAVIC_SPOKEN, IV: "intravensko" },
  hr: { ...SOUTH_SLAVIC_SPOKEN, IV: "intravenozno" },
  bs: { ...SOUTH_SLAVIC_SPOKEN, IV: "intravenozno" },
  sr: { ...SOUTH_SLAVIC_SPOKEN, IV: "intravenozno" },
};

export const ORAL_QUIZ_SCRIPTS = Object.fromEntries(
  Object.entries(LINES).map(([locale, { title, lines }]) => [
    locale,
    {
      title,
      turns: SHAPE.map((shape, index) => ({ ...shape, text: lines[index] }) as OralQuizTurn),
    },
  ]),
) as Record<Locale, OralQuizScript>;

/** Words as the screen prints them and the timings count them: split on whitespace. */
export function oralQuizWords(text: string) {
  return text.split(/\s+/).filter(Boolean);
}

/** The line as the voice is asked to say it: the same words, respelled where needed. */
export function oralQuizSpoken(locale: Locale, text: string) {
  const spoken = SPOKEN[locale];

  return oralQuizWords(text)
    .map((word) => {
      const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      return spoken[bare] ? word.replace(bare, spoken[bare]) : word;
    })
    .join(" ");
}
