/**
 * Deciding which of a creator's posts are Memo AI content.
 *
 * Several of the campaign accounts are personal accounts that only sometimes
 * post about Memo AI, so every video is scored from the signals TikTok gives
 * us: the caption, the hashtags, the accounts it @-mentions, any link in the
 * text, and the creator's own discount code.
 *
 * Signals are additive. A score of 1.0 is "certain"; anything a single
 * unambiguous signal produces (a memoai.eu link, an @memo_ai mention, #memoai,
 * or the creator's own promo code) reaches it on its own. Weaker signals — the
 * bare word "memo", a study-related keyword — accumulate but land the video in
 * the review queue instead of silently counting it.
 */

import type {
  UgcClassification,
  UgcClassificationSource,
  UgcContentMode,
  UgcRuleKind,
} from "@/lib/database.types";

export type ClassificationRule = {
  kind: UgcRuleKind;
  pattern: string;
  weight: number;
};

export type ClassificationInput = {
  caption: string | null;
  hashtags: string[];
  mentions: string[];
  contentMode: UgcContentMode;
  /** Stripe promotion codes belonging to this creator, e.g. `["EMA50"]`. */
  promoCodes?: string[];
};

export type ClassificationResult = {
  classification: UgcClassification;
  source: UgcClassificationSource;
  confidence: number;
  reason: string;
  matches: string[];
};

/** Score at or above which a video counts as Memo AI content. */
export const MEMO_THRESHOLD = 1;
/** Score at or above which a video goes to the review queue rather than "personal". */
export const REVIEW_THRESHOLD = 0.4;

/**
 * Lowercases and strips diacritics so "Zapiski", "zapiski" and "zapíski" all
 * match the same rule. Slovenian captions routinely mix these.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips a leading `@` and any display-name spacing: "@Memo AI" -> "memoai". */
function normalizeMention(value: string): string {
  return normalizeText(value).replace(/^@+/, "").replace(/[\s._-]/g, "");
}

function normalizeHashtag(value: string): string {
  return normalizeText(value).replace(/^#+/, "").replace(/[\s._-]/g, "");
}

/**
 * Word-boundary-aware substring test. Without this, "memo" would match inside
 * "memories" and a personal vlog would be miscounted as campaign content.
 */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) {
    return false;
  }

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Allow a flexible separator so "memo ai", "memo-ai" and "memo.ai" all hit.
  const flexible = escaped.replace(/\\?[\s._-]+/g, "[\\s._-]*");

  return new RegExp(`(^|[^a-z0-9])${flexible}([^a-z0-9]|$)`).test(haystack);
}

export function classifyVideo(
  input: ClassificationInput,
  rules: ClassificationRule[],
): ClassificationResult {
  // An account flagged as dedicated or personal short-circuits scoring: the
  // admin has already told us what the whole account is.
  if (input.contentMode === "dedicated") {
    return {
      classification: "memo",
      source: "account_default",
      confidence: 1,
      reason: "Account is marked as a dedicated Memo AI account.",
      matches: [],
    };
  }

  if (input.contentMode === "personal") {
    return {
      classification: "personal",
      source: "account_default",
      confidence: 1,
      reason: "Account is marked as personal, so its posts never count.",
      matches: [],
    };
  }

  const caption = normalizeText(input.caption ?? "");
  const hashtags = new Set(input.hashtags.map(normalizeHashtag).filter(Boolean));
  const mentions = new Set(input.mentions.map(normalizeMention).filter(Boolean));

  let score = 0;
  const matches: string[] = [];

  // The creator's own discount code is the single strongest signal there is:
  // nobody puts "EMA50" in a caption that is not selling Memo AI.
  for (const code of input.promoCodes ?? []) {
    const normalized = normalizeText(code).replace(/\s/g, "");

    if (normalized && caption.replace(/\s/g, "").includes(normalized)) {
      score += 1;
      matches.push(`promo code ${code.toUpperCase()}`);
      break;
    }
  }

  for (const rule of rules) {
    const pattern = normalizeText(rule.pattern);

    if (!pattern) {
      continue;
    }

    let hit = false;

    switch (rule.kind) {
      case "hashtag":
        hit = hashtags.has(normalizeHashtag(rule.pattern));
        break;
      case "mention":
        hit = mentions.has(normalizeMention(rule.pattern));
        break;
      case "link":
        // Links appear as plain text in TikTok captions, so a raw substring
        // test is right here — domains have no word boundaries to respect.
        hit = caption.replace(/\s/g, "").includes(pattern.replace(/\s/g, ""));
        break;
      case "keyword":
        hit = containsPhrase(caption, pattern);
        break;
    }

    if (hit) {
      score += rule.weight;
      matches.push(
        `${rule.kind} "${rule.pattern}"${rule.weight < 1 ? ` (+${rule.weight})` : ""}`,
      );
    }
  }

  const confidence = Math.min(score, 1);

  if (score >= MEMO_THRESHOLD) {
    return {
      classification: "memo",
      source: "rule",
      confidence,
      reason: `Matched ${matches.join(", ")}.`,
      matches,
    };
  }

  if (score >= REVIEW_THRESHOLD) {
    return {
      classification: "unknown",
      source: "rule",
      confidence,
      reason: matches.length
        ? `Weak signal only — matched ${matches.join(", ")}. Needs a human check.`
        : "Weak signal only. Needs a human check.",
      matches,
    };
  }

  return {
    classification: "personal",
    source: "rule",
    confidence: 1 - confidence,
    reason: "No Memo AI signal in the caption, hashtags or mentions.",
    matches,
  };
}

/** Pulls `#tags` out of a caption when the collector did not supply them. */
export function extractHashtags(caption: string | null): string[] {
  if (!caption) {
    return [];
  }

  return Array.from(
    new Set(
      Array.from(caption.matchAll(/#([\p{L}\p{N}_]+)/gu), (match) =>
        match[1].toLowerCase(),
      ),
    ),
  );
}

/** Pulls `@handles` out of a caption when the collector did not supply them. */
export function extractMentions(caption: string | null): string[] {
  if (!caption) {
    return [];
  }

  return Array.from(
    new Set(
      Array.from(caption.matchAll(/@([\p{L}\p{N}._]+)/gu), (match) =>
        match[1].toLowerCase(),
      ),
    ),
  );
}

/**
 * What the model answered for one post.
 *
 * A three-way verdict rather than a boolean plus a confidence score: models
 * report low confidence for a clear negative just as readily as for a genuine
 * toss-up, so scoring confidence pushed plainly personal videos into the review
 * queue. Asking for the three outcomes directly lets "unclear" mean what it
 * says.
 */
export type AiVerdict = {
  verdict: "memo" | "personal" | "unclear";
  reason: string;
};

/** Folds an AI verdict into the shape the rest of the pipeline stores. */
export function toClassificationResult(
  verdict: AiVerdict,
  ruleVerdict: ClassificationResult,
): ClassificationResult {
  if (verdict.verdict === "unclear") {
    return {
      classification: "unknown",
      source: "ai",
      confidence: 0.5,
      reason: `AI could not tell: ${verdict.reason}`,
      matches: ruleVerdict.matches,
    };
  }

  return {
    classification: verdict.verdict === "memo" ? "memo" : "personal",
    source: "ai",
    confidence: 1,
    reason: `AI: ${verdict.reason}`,
    matches: ruleVerdict.matches,
  };
}
