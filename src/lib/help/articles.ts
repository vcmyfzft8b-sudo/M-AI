/**
 * The help centre's articles, keyed by slug.
 *
 * The bodies live in one file per language rather than in the message
 * catalogues: they are documents, not labels — thousands of words of markdown
 * apiece for the legal ones — and they are edited and reviewed as documents.
 * The catalogue keeps only the chrome around them (the screen's heading, the
 * section names), which is what a translator handles alongside the rest of the
 * app.
 *
 * `HELP_ARTICLE_ORDER` fixes the order the help screen lists them in and, with
 * `HELP_ARTICLE_CATEGORY`, is the one place that decides which articles exist.
 * Every locale file is typed against it, so a language cannot quietly ship
 * eleven articles where another has twelve.
 */
export const HELP_ARTICLE_ORDER = [
  "family-plan",
  "gift-coconote",
  "supported-language",
  "feature-request",
  "video-isnt-working",
  "audio-upload-issue",
  "transcript-cut-short",
  "redeem-code",
  "privacy-policy",
  "refund-policy",
  "terms-of-use",
] as const;

export type HelpArticleSlug = (typeof HELP_ARTICLE_ORDER)[number];

/** The three groups the help screen splits the list into. */
export type HelpCategory = "common" | "recording" | "account";

export const HELP_ARTICLE_CATEGORY: Record<HelpArticleSlug, HelpCategory> = {
  "family-plan": "common",
  "gift-coconote": "common",
  "supported-language": "common",
  "feature-request": "common",
  "video-isnt-working": "recording",
  "audio-upload-issue": "recording",
  "transcript-cut-short": "recording",
  "redeem-code": "account",
  "privacy-policy": "account",
  "refund-policy": "account",
  "terms-of-use": "account",
};

export type HelpArticleContent = {
  title: string;
  /** Markdown. The legal ones may close with a `---` fine-print block. */
  content: string;
};

export type HelpArticles = Record<HelpArticleSlug, HelpArticleContent>;
