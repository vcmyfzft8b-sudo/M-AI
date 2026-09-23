/** Apple identifiers are server-selected. A typed code never selects arbitrary offers. */
export const APPLE_CODE_OFFERS = {
  "eu.memoai.premium.monthly": "memo_code_half_month",
  "eu.memoai.premium.yearly": "memo_code_half_year",
} as const;

type Promotion = {
  code: string; active: boolean; customer?: unknown; customer_account?: unknown;
  expires_at?: number | null; max_redemptions?: number | null;
  restrictions?: { first_time_transaction?: boolean; minimum_amount?: number | null };
};
type Coupon = {
  id: string; valid: boolean; percent_off: number | null; amount_off?: number | null;
  duration: string; redeem_by?: number | null; max_redemptions?: number | null;
  applies_to?: { products?: string[] };
};

/**
 * Mirrors the audited unrestricted, 50%-once web campaign. Fail closed if its
 * terms change: capped codes need a shared redemption ledger, and recurring,
 * customer-specific or minimum-spend discounts need different Apple products.
 */
export function acceptsAppleHalfOffCode(code: string, promotion: Promotion, coupon: Coupon, product: string, now: number): boolean {
  return promotion.active && promotion.code.toUpperCase() === code.trim().toUpperCase() &&
    !promotion.customer && !promotion.customer_account && promotion.max_redemptions == null &&
    (promotion.expires_at == null || promotion.expires_at > now) &&
    promotion.restrictions?.first_time_transaction !== true && promotion.restrictions?.minimum_amount == null &&
    coupon.id === "memo50-first-cycle" && coupon.valid && coupon.percent_off === 50 && coupon.amount_off == null &&
    coupon.duration === "once" && coupon.max_redemptions == null &&
    (coupon.redeem_by == null || coupon.redeem_by > now) &&
    (!coupon.applies_to?.products?.length || coupon.applies_to.products.includes(product));
}
