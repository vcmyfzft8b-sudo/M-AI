/** A presentation hint only. Never use the user agent to authorize a user. */
export function isNativeUserAgent(value: string | null | undefined): boolean {
  return /(?:^|\s)MemoAI-iOS\/\d+(?:\.\d+)*(?:\s|$)/.test(value ?? "");
}

export const APPLE_PRODUCTS = {
  "eu.memoai.premium.monthly": "monthly",
  "eu.memoai.premium.yearly": "yearly",
  "eu.memoai.premium.trial.monthly": "monthly",
  "eu.memoai.premium.trial.yearly": "yearly",
} as const;

export type AppleProductId = keyof typeof APPLE_PRODUCTS;

export function isAppleProduct(value: unknown): value is AppleProductId {
  return typeof value === "string" && Object.hasOwn(APPLE_PRODUCTS, value);
}

/** Separate products in the SAME Apple subscription group offer trial or wheel pricing.
 * Apple allows only one introductory redemption per group, preventing stacking. */
export function isTrialProduct(value: AppleProductId): boolean {
  return value === "eu.memoai.premium.trial.monthly" || value === "eu.memoai.premium.trial.yearly";
}
