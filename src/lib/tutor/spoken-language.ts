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
