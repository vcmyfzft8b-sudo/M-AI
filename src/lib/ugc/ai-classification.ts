import "server-only";

import { z } from "zod";

import { generateStructuredObjectWithGemini } from "@/lib/ai/gemini";
import { getServerEnv } from "@/lib/server-env";
import {
  type AiVerdict,
  type ClassificationResult,
  toClassificationResult,
} from "@/lib/ugc/classification";

export { toClassificationResult };
export type { AiVerdict };

/**
 * AI review of whether a post is Memo AI content.
 *
 * Keyword rules are fast and cheap but they only see the surface: they cannot
 * tell "this app saved me" from "this memo from my boss", and they miss a
 * promotion written without any of the expected tokens. On a personal account
 * that mixes genuine campaign posts with everyday video, that is the difference
 * between a trustworthy number and a guess.
 *
 * So on mixed accounts the caption is read by a model as well. Dedicated
 * accounts skip this entirely — every post there counts by definition, and
 * paying to confirm it would be waste.
 *
 * The model decides; the rules stay as the prior it is shown, and as the
 * fallback when the model is unavailable.
 */

/**
 * A three-way verdict rather than a boolean plus a confidence score.
 *
 * The first version asked for `isMemoAi` and a confidence, then treated a low
 * score as ambiguity. Models report low confidence for a clear negative just as
 * readily as for a genuine toss-up, so an obviously personal video — a family
 * post with two million views — landed in the review queue alongside the real
 * unknowns. Asking for the three outcomes directly lets "unclear" mean what it
 * says.
 */
const verdictSchema = z.object({
  verdict: z
    .enum(["memo", "personal", "unclear"])
    .describe(
      "memo when the post promotes or features Memo AI, personal when it plainly does not, unclear only when the caption genuinely gives you too little to judge.",
    ),
  reason: z
    .string()
    .max(200)
    .describe("One short sentence, in English, explaining the decision."),
});

const batchSchema = z.object({
  verdicts: z.array(
    verdictSchema.extend({
      id: z.string().describe("The id of the post being judged, copied exactly."),
    }),
  ),
});

const INSTRUCTIONS = `You decide whether a TikTok post is promoting Memo AI.

Memo AI (memoai.eu) is a Slovenian study app: it turns lectures, PDFs, documents
and links into transcripts, notes, flashcards, quizzes, practice tests and a
study chat. Creators in its campaign post about it, usually in Slovenian, often
with a personal discount code.

These accounts are personal. The same creator posts ordinary life content —
vlogs, hauls, hiking, jokes, family — alongside the occasional paid Memo AI
post. Your job is to separate the two.

Count a post as Memo AI when it promotes, demonstrates, credits or recommends
the app: it names Memo AI, mentions the app's account, carries the creator's
discount code, links to memoai.eu, or plainly describes using this study app.

Do NOT count a post merely because it is about school, studying, notes, exams or
productivity. Slovenian study creators post that constantly without any Memo AI
involvement. The word "memo" in its ordinary sense — a note or reminder — is not
a mention of the app, and neither is an unrelated AI tool.

Answer "personal" whenever the post is plainly ordinary content — that is a
decision, not a doubt. Reserve "unclear" for the rare caption that is genuinely
impossible to judge, such as an empty one, or a bare hashtag that could belong
to either kind of post. Those go to a human for review.

Answer for every post you are given, copying each id exactly.`;

export type AiClassificationInput = {
  id: string;
  caption: string | null;
  hashtags: string[];
  mentions: string[];
  creatorName: string;
  promoCodes: string[];
  /** What the keyword rules concluded, shown to the model as a prior. */
  ruleVerdict: ClassificationResult;
};

/** Posts judged per model call. Captions are short, so batching is cheap. */
const BATCH_SIZE = 25;

function describe(post: AiClassificationInput): string {
  return [
    `id: ${post.id}`,
    `creator: ${post.creatorName}`,
    post.promoCodes.length > 0
      ? `their discount codes: ${post.promoCodes.join(", ")}`
      : "their discount codes: none on file",
    `caption: ${post.caption?.trim() || "(empty)"}`,
    `hashtags: ${post.hashtags.length > 0 ? post.hashtags.join(", ") : "(none)"}`,
    `mentions: ${post.mentions.length > 0 ? post.mentions.join(", ") : "(none)"}`,
    `keyword rules said: ${post.ruleVerdict.classification} (${post.ruleVerdict.reason})`,
  ].join("\n");
}

export function isAiClassificationConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/**
 * Judges a batch of posts. Returns a verdict per post id; ids missing from the
 * result simply keep whatever the rules decided.
 */
export async function classifyWithAi(
  posts: AiClassificationInput[],
): Promise<Map<string, AiVerdict>> {
  const verdicts = new Map<string, AiVerdict>();

  if (posts.length === 0 || !isAiClassificationConfigured()) {
    return verdicts;
  }

  const env = getServerEnv();

  for (let index = 0; index < posts.length; index += BATCH_SIZE) {
    const batch = posts.slice(index, index + BATCH_SIZE);

    try {
      const result = await generateStructuredObjectWithGemini({
        schema: batchSchema,
        instructions: INSTRUCTIONS,
        input: batch.map(describe).join("\n\n---\n\n"),
        // Flash-lite is the cheapest model that reads Slovenian well, and the
        // job is a short-caption judgement rather than long-form reasoning.
        model: env.GEMINI_TEXT_MODEL,
        usageContext: { stage: "ugc_classification" },
      });

      for (const verdict of result.verdicts) {
        verdicts.set(verdict.id, {
          verdict: verdict.verdict,
          reason: verdict.reason,
        });
      }
    } catch {
      // A model failure must not stop a sync: those posts keep the rule verdict
      // and can be reviewed by hand.
      continue;
    }
  }

  return verdicts;
}
