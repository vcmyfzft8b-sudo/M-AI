import { isAppleProduct, isTrialProduct, type AppleProductId } from "./runtime.ts";

/** Prices and introductory eligibility come from StoreKit, never Stripe arithmetic. */
export type NativeProduct = {
  id: AppleProductId;
  name: string;
  price: string;
  quote: string;
  available: true;
  introPrice?: string;
  halfOff?: boolean;
  trialDays?: 3;
};

export function nativeProducts(value: unknown): NativeProduct[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NativeProduct => item !== null && typeof item === "object" &&
    isAppleProduct(item.id) && typeof item.name === "string" &&
    typeof item.price === "string" && item.price.length > 0 &&
    typeof item.quote === "string" && item.quote.length > 0 && item.available === true &&
    (item.introPrice === undefined || (typeof item.introPrice === "string" && item.introPrice.length > 0)) &&
    (item.halfOff === undefined || typeof item.halfOff === "boolean") &&
    (item.trialDays === undefined || (item.trialDays === 3 && item.introPrice === undefined && item.halfOff !== true)));
}

export function halfOffProducts(value: unknown): NativeProduct[] {
  return nativeProducts(value).filter(item => item.halfOff === true && Boolean(item.introPrice));
}

/** Ordinary signup uses trial products; the wheel uses the paid first-period offer products. */
export function trialPlanProducts(value: unknown): NativeProduct[] {
  return nativeProducts(value).filter(item => isTrialProduct(item.id));
}
