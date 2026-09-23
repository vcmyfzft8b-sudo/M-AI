import { isAppleProduct, isTrialProduct } from "./runtime.ts";

/** A code validated more than a day before the purchase is not what unlocked it. */
export const CODE_ATTRIBUTION_WINDOW_MS = 24 * 60 * 60_000;

// Apple's offerType: 1 introductory, 2 promotional, 3 offer code. A code only
// ever unlocks the half-price introductory or promotional offer.
const CODED_OFFER_TYPES: ReadonlySet<number> = new Set([1, 2]);

type Transaction = {
  productId?: string; transactionId?: string; originalTransactionId?: string;
  purchaseDate?: number; price?: number; currency?: string; offerType?: number;
  transactionReason?: string;
};

/**
 * The credit a coded first charge earns, or null when this transaction is not
 * one. Mirrors the Stripe rule: the customer's first paid charge on a discount
 * counts; renewals, the free-trial products and zero-price charges do not.
 */
export function codeCreditForTransaction(tx: Transaction) {
  if (!isAppleProduct(tx.productId) || isTrialProduct(tx.productId)) return null;
  if (tx.transactionReason === "RENEWAL") return null;
  if (!CODED_OFFER_TYPES.has(tx.offerType ?? 0)) return null;
  if (!tx.transactionId || !tx.originalTransactionId || !Number.isSafeInteger(tx.purchaseDate)) return null;
  if (!Number.isSafeInteger(tx.price) || tx.price! <= 0 || !/^[A-Z]{3}$/.test(tx.currency ?? "")) return null;
  return {
    original_transaction_id: tx.originalTransactionId,
    transaction_id: tx.transactionId,
    product_id: tx.productId,
    offer_type: tx.offerType!,
    // Apple reports milliunits; every currency Memo sells in has two decimals.
    price_minor: Math.round(tx.price! / 10),
    currency: tx.currency!.toLowerCase(),
    paid_at: new Date(tx.purchaseDate!).toISOString(),
  };
}
