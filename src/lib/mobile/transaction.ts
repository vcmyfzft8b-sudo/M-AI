import { APPLE_PRODUCTS, isAppleProduct } from "./runtime.ts";

export type AppleTransaction = {
  bundleId?: string; productId?: string; transactionId?: string; originalTransactionId?: string;
  appAccountToken?: string; environment?: string; type?: string;
  purchaseDate?: number; expiresDate?: number; revocationDate?: number; signedDate?: number;
  isUpgraded?: boolean; inAppOwnershipType?: string;
};

/** Call only AFTER Apple's SignedDataVerifier has validated the JWS. */
export function entitlementFromVerifiedTransaction(
  tx: AppleTransaction, expected: { bundleId: string; environment: "Production" | "Sandbox"; userId?: string }, now = Date.now(),
) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (tx.bundleId !== expected.bundleId || tx.environment !== expected.environment
      || !isAppleProduct(tx.productId) || tx.type !== "Auto-Renewable Subscription"
      || !tx.appAccountToken || !uuid.test(tx.appAccountToken)
      || expected.userId && tx.appAccountToken.toLowerCase() !== expected.userId.toLowerCase()
      || !tx.transactionId || !/^\d+$/.test(tx.transactionId)
      || !tx.originalTransactionId || !/^\d+$/.test(tx.originalTransactionId)
      || !Number.isSafeInteger(tx.purchaseDate) || !Number.isSafeInteger(tx.expiresDate)
      || !Number.isSafeInteger(tx.signedDate) || tx.signedDate! > now + 300_000
      || tx.purchaseDate! < 0 || tx.purchaseDate! > now + 300_000
      || tx.expiresDate! < tx.purchaseDate!
      || tx.inAppOwnershipType === "FAMILY_SHARED") {
    throw new Error("Invalid Apple entitlement");
  }
  return {
    user_id: tx.appAccountToken.toLowerCase(),
    product_id: tx.productId,
    plan: APPLE_PRODUCTS[tx.productId],
    transaction_id: tx.transactionId,
    original_transaction_id: tx.originalTransactionId,
    environment: expected.environment === "Production" ? "production" as const : "sandbox" as const,
    status: tx.revocationDate || tx.isUpgraded ? "revoked" as const : tx.expiresDate! > now ? "active" as const : "expired" as const,
    purchased_at: new Date(tx.purchaseDate!).toISOString(),
    expires_at: new Date(tx.expiresDate!).toISOString(),
    revoked_at: tx.revocationDate ? new Date(tx.revocationDate).toISOString() : null,
  };
}
