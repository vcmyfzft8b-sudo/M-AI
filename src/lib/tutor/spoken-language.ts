// Relative, not aliased, and free of "server-only": the language the tutor is speaking decides
// what the checker is told, which makes it worth a test of its own (tests/tutor-spoken-language)
// and worth being loadable outside Next, where "@/" does not resolve.
import { detectSourceLanguage } from "../languages.ts";

/** Just enough of a turn to tell what language it is happening in. */
type SpokenTurnContext = {
  /** What the learner just said, when they interrupted. */
  question: string | null;
  history: readonly { role: "tutor" | "learner"; content: string }[];
};

/**
 * Which language a spoken turn is in, and therefore which one the checker is told it is reading.
 *
 * Normally the material's, because that is what the tutor was told to speak. But the spoken
 * prompt has one rule that outranks it — the learner's own voice — and it fires in practice:
 * asked a Slovenian question about an English lecture, the tutor answers in Slovenian, which is
 * correct. Handing that turn to the checker as English would be asking it to translate, and
 * translating is the one thing this pass must never do.
 *
 * So the learner's words decide, most recent first, and only theirs. The tutor's own turns are
 * excluded because they are downstream of this decision: including them would keep a language
 * alive for one more turn after the learner had already left it. Older turns are consulted only
 * when the newest are too short to read — `detectSourceLanguage` answers null rather than
 * guessing, and null at every depth means the material's language stands.
 */
export function resolveSpokenLanguage(materialLanguage: string, turn: SpokenTurnContext) {
  const learnerSaid = [
    turn.question,
    ...turn.history
      .filter((entry) => entry.role === "learner")
      .map((entry) => entry.content)
      .reverse(),
  ].filter((content): content is string => Boolean(content?.trim()));

  for (let depth = 1; depth <= learnerSaid.length; depth += 1) {
    const detected = detectSourceLanguage(learnerSaid.slice(0, depth).join(" "));

    if (detected) {
      return detected;
    }
  }

  return materialLanguage;
}

/**
 * The language of a piece of the turn the tutor is actually saying.
 *
 * `resolveSpokenLanguage` reads the learner's intent from what they said; this reads the outcome
 * from what the tutor wrote, and it exists because the first one has a blind spot that matters.
 * `detectSourceLanguage` needs about a dozen words to commit, and a spoken interruption is
 * usually shorter than that — "počakaj, razloži mi to bolj preprosto" is six. So a Slovenian
 * learner interrupting an English lecture falls through to the material's language, and the
 * answer they get in Slovenian would be checked as English, or — because English is skipped —
 * not checked at all. That is precisely the case this pass is for.
 *
 * The tutor's own words do not have that problem: a unit of speech is long enough to read, and
 * it is the text being repaired, so it is the most direct evidence there is of what language the
 * repair is happening in. Detection still answers null when a unit is too short or sits between
 * two close neighbours, and null falls back to the turn's language, which is where the learner's
 * intent and the material still decide.
 */
export function resolvePassageLanguage(turnLanguage: string, passage: string) {
  return detectSourceLanguage(passage) ?? turnLanguage;
}
