import "server-only";

import { AppStoreServerAPIClient, Environment, SignedDataVerifier, VerificationException, VerificationStatus, type JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { entitlementFromVerifiedTransaction } from "@/lib/mobile/transaction";
import { isAppleConsumable } from "@/lib/mobile/runtime";
import { attributeAppleCodePurchase } from "@/lib/mobile/code-attribution";
import roots from "@/lib/mobile/apple-roots.json";

export function appleEnvironment(): Environment.PRODUCTION | Environment.SANDBOX {
  return process.env.VERCEL_ENV === "production" ? Environment.PRODUCTION : Environment.SANDBOX;
}

/**
 * TestFlight and App Review buy in Apple's Sandbox while talking to the production server, and
 * App Review may register its own account rather than use the demo one, so production honours a
 * sandbox purchase for any account. Only a build signed by our team (TestFlight, App Review, a
 * developer's Xcode run) can make a sandbox purchase Apple signs for our bundle id; an App Store
 * download always buys in production. Until 27 September 2026 this was limited to the accounts
 * on APPLE_SANDBOX_REVIEW_USER_IDS, and every other TestFlight purchase answered 503.
 */
export function appleAccountEnvironments() {
  return appleEnvironment() === Environment.PRODUCTION ? ["production", "sandbox"] : ["sandbox"];
}

function assertDatabaseEnvironment() {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://invalid").host;
  const expected = appleEnvironment() === Environment.PRODUCTION ? "zrcwmhuwwvguiekzmcdj.supabase.co" : "yviipoccwsndxyrhtcjm.supabase.co";
  if (host !== expected) throw new Error("Apple billing database environment mismatch");
}

export function appleVerifier(environment = appleEnvironment()) {
  assertDatabaseEnvironment();
  const bundleId = process.env.APPLE_BUNDLE_ID || "eu.memoai.memo";
  const appId = Number(process.env.APPLE_APP_ID);
  if (environment === Environment.PRODUCTION && (!Number.isSafeInteger(appId) || appId <= 0)) throw new Error("APPLE_APP_ID is required");
  return new SignedDataVerifier(roots.map(root => Buffer.from(root, "base64")), true, environment, bundleId,
    environment === Environment.PRODUCTION ? appId : undefined);
}

function appleAPI(environment = appleEnvironment()) {
  const { APPLE_IAP_PRIVATE_KEY, APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID } = process.env;
  if (!APPLE_IAP_PRIVATE_KEY || !APPLE_IAP_KEY_ID || !APPLE_IAP_ISSUER_ID) throw new Error("Apple server API is not configured");
  return new AppStoreServerAPIClient(APPLE_IAP_PRIVATE_KEY.replace(/\\n/g, "\n"), APPLE_IAP_KEY_ID,
    APPLE_IAP_ISSUER_ID, process.env.APPLE_BUNDLE_ID || "eu.memoai.memo", environment);
}

export function appleBillingConfigured() {
  if (process.env.APPLE_IAP_ENABLED !== "true") return false;
  try { appleVerifier(); appleAPI(); return true; } catch { return false; }
}

/**
 * The purchase is genuine but was bought for a different Memo account (Apple's
 * appAccountToken names another user). Retrying never helps; the buyer has to
 * sign in to the account that owns it.
 */
export class AppleAccountMismatch extends Error {
  constructor() { super("Apple purchase belongs to another account"); this.name = "AppleAccountMismatch"; }
}

/** A notification Apple can resend for three days without it ever becoming acceptable. */
export class AppleNotificationRejected extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "AppleNotificationRejected"; }
}

async function verifyTransaction(jws: string) {
  let environment = appleEnvironment();
  let verified: JWSTransactionDecodedPayload;
  try { verified = await appleVerifier(environment).verifyAndDecodeTransaction(jws); }
  catch (error) {
    // Only a payload the production verifier read and found to be Sandbox gets a second look: an
    // OCSP or chain failure must stay that failure, not become a sandbox verdict on a real purchase.
    if (environment !== Environment.PRODUCTION || !(error instanceof VerificationException)
        || error.status !== VerificationStatus.INVALID_ENVIRONMENT) throw error;
    environment = Environment.SANDBOX;
    verified = await appleVerifier(environment).verifyAndDecodeTransaction(jws);
    // Our app always names the buyer; a sandbox purchase that names nobody was not made in it.
    if (!verified.appAccountToken) throw new AppleNotificationRejected("Sandbox purchase names no Memo account");
  }
  return { environment, verified };
}

/**
 * Apple sends Sandbox notifications — its own connectivity test, and every TestFlight and App
 * Review purchase event — to the production server URL, so production must be able to READ one.
 * What a sandbox payload may grant is decided in verifyTransaction above. Gating the decode on
 * the old reviewer allowlist made every sandbox notification a 503, which Apple then retried at
 * 1, 12, 24, 48 and 72 hours.
 */
export async function verifyAppleNotification(jws: string) {
  try { return await appleVerifier().verifyAndDecodeNotification(jws); }
  catch (error) {
    if (appleEnvironment() !== Environment.PRODUCTION) throw error;
    return appleVerifier(Environment.SANDBOX).verifyAndDecodeNotification(jws);
  }
}

// Only the statuses that describe the PAYLOAD as somebody else's: a bundle id or app id that is
// not ours, an environment neither verifier matched, a certificate chain that is not three certs
// long. Those read the same way for the next three days.
//
// Everything else stays retryable even when it sounds terminal, because the library reuses those
// statuses for our own side of the exchange. VERIFICATION_FAILURE is the catch-all wrapper around
// the whole of verifyJWT and is also what a chain that does not meet our pinned roots throws — so
// it is what an unrotated root would throw for EVERY notification. FAILURE is mostly an OCSP
// verdict: a responder we cannot parse, or a response that has gone stale. Acknowledging those
// would quietly discard real billing notifications during an outage we could still recover from.
const PERMANENT_VERIFICATION_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  VerificationStatus.INVALID_APP_IDENTIFIER, VerificationStatus.INVALID_ENVIRONMENT,
  VerificationStatus.INVALID_CHAIN_LENGTH,
]);

/**
 * Whether asking Apple to send this notification again could ever produce a different outcome.
 * Retryable by default: only a positively identified dead end is worth acknowledging, because
 * acknowledging a notification we should have kept loses it for good.
 */
export function appleNotificationRetryable(error: unknown) {
  if (error instanceof AppleNotificationRejected) return false;
  if (error instanceof VerificationException) return !PERMANENT_VERIFICATION_STATUSES.has(error.status);
  return true;
}

/**
 * A verified tutor-hour purchase, refreshed from Apple so a replayed receipt
 * for a refunded purchase is recognised. Throws `AppleAccountMismatch` when
 * the purchase belongs to another Memo account.
 */
export async function verifyAppleConsumable(signedTransaction: string, userId: string) {
  const checked = await verifyTransaction(signedTransaction);
  let verified = checked.verified;
  const bundleId = process.env.APPLE_BUNDLE_ID || "eu.memoai.memo";
  if (verified.bundleId !== bundleId || verified.environment !== checked.environment
      || !isAppleConsumable(verified.productId) || verified.type !== "Consumable"
      || !verified.transactionId || !/^\d+$/.test(verified.transactionId)) {
    throw new Error("Invalid Apple consumable");
  }
  if (!verified.appAccountToken || verified.appAccountToken.toLowerCase() !== userId.toLowerCase()) {
    throw new AppleAccountMismatch();
  }
  const current = await appleAPI(checked.environment).getTransactionInfo(verified.transactionId);
  if (!current.signedTransactionInfo) throw new Error("Apple returned no transaction");
  verified = await appleVerifier(checked.environment).verifyAndDecodeTransaction(current.signedTransactionInfo);
  return {
    transactionId: verified.transactionId!,
    environment: checked.environment === Environment.PRODUCTION ? "production" as const : "sandbox" as const,
    revoked: Boolean(verified.revocationDate),
    // Apple reports milliunits.
    amountMinor: Number.isSafeInteger(verified.price) ? Math.round(verified.price! / 10) : 0,
    currency: (verified.currency ?? "EUR").toLowerCase(),
  };
}

/**
 * Whether the Memo account a purchase names still exists. Apple writes the buyer's account id into
 * every transaction of a subscription (appAccountToken) for good, so a purchase outlives the Memo
 * account it was made for when that account is deleted and the Apple subscription is not.
 */
async function memoAccountExists(service: ReturnType<typeof createSupabaseServiceRoleClient>, id: string) {
  const account = await service.auth.admin.getUserById(id);
  if (account.error?.status === 404 || account.error?.code === "user_not_found") return false;
  if (account.error || !account.data.user) throw new Error("Apple account lookup failed");
  return true;
}

export async function saveAppleTransaction(signedTransaction: string, userId?: string, refresh = false) {
  const checked = await verifyTransaction(signedTransaction);
  let verified = checked.verified;
  // Tutor hours are consumables: credited once by /api/mobile/tutor-credits,
  // never an entitlement. A server notification about one (a refund, Apple's
  // consumption request) is acknowledged rather than retried for three days.
  if (isAppleConsumable(verified.productId)) return null;
  const verifier = appleVerifier(checked.environment);
  const service = createSupabaseServiceRoleClient();
  /*
   * A purchase made for another Memo account is refused, unless that account no longer exists: then
   * the Apple subscription it left behind is taken over by the account restoring it. Otherwise every
   * restore, and every launch, on an Apple ID that once bought for a deleted account answers "this
   * belongs to a different Memo account" for good, because nothing ever finishes those transactions
   * (28 Sep 2026: eight of them from two deleted test accounts on one TestFlight Apple ID).
   */
  const buyer = verified.appAccountToken?.toLowerCase();
  let claimed = false;
  if (userId && buyer && buyer !== userId.toLowerCase()) {
    if (await memoAccountExists(service, buyer)) throw new AppleAccountMismatch();
    claimed = true;
  }
  const expected = { bundleId: process.env.APPLE_BUNDLE_ID || "eu.memoai.memo", environment: checked.environment, userId: claimed ? undefined : userId };
  // Validate the payload before contacting Apple or touching the database.
  entitlementFromVerifiedTransaction(verified, expected);
  if (refresh) {
    // A replayed, previously valid receipt must not re-enable a refunded purchase.
    const current = await appleAPI(checked.environment).getTransactionInfo(verified.transactionId!);
    if (!current.signedTransactionInfo) throw new Error("Apple returned no transaction");
    signedTransaction = current.signedTransactionInfo;
    verified = await verifier.verifyAndDecodeTransaction(signedTransaction);
  }
  const { plan, ...entitlement } = entitlementFromVerifiedTransaction(verified, expected);
  const row = { ...entitlement, signed_transaction_jws: signedTransaction, raw_payload: JSON.parse(JSON.stringify(verified)) };
  const table = () => service.from("mobile_app_store_entitlements");
  if (claimed) {
    row.user_id = userId!.toLowerCase();
  } else if (!userId && !await memoAccountExists(service, row.user_id)) {
    /*
     * A notification (a renewal, a refund) about a purchase whose buyer's account is gone follows
     * whoever took the subscription over; with nobody, there is nothing to update.
     */
    const taken = await table().select("user_id").eq("original_transaction_id", row.original_transaction_id).limit(1).maybeSingle();
    if (taken.error) throw new Error("Apple entitlement lookup failed", { cause: taken.error });
    if (!taken.data) return null;
    row.user_id = (taken.data as { user_id: string }).user_id;
  }
  const { error: insertError } = await table().upsert(row as never, {
    onConflict: "original_transaction_id,product_id", ignoreDuplicates: true,
  });
  if (insertError) throw new Error("Apple entitlement insert failed", { cause: insertError });
  const owner = await table().select("user_id,environment").eq("original_transaction_id", row.original_transaction_id).eq("product_id", row.product_id).single();
  const existing = owner.data as { user_id: string; environment: string } | null;
  if (!owner.error && existing && existing.user_id !== row.user_id) throw new AppleAccountMismatch();
  if (owner.error || existing?.user_id !== row.user_id || existing.environment !== row.environment) throw new Error("Apple transaction ownership mismatch");
  // SQL conditional update prevents a delayed renewal/refund or concurrent restore
  // from overwriting a newer purchase, or a newer signature for the same purchase.
  const { error } = await table().update(row as never)
    .eq("original_transaction_id", row.original_transaction_id).eq("product_id", row.product_id)
    .eq("user_id", row.user_id).eq("environment", row.environment)
    .or(`purchased_at.lt.${row.purchased_at},and(purchased_at.eq.${row.purchased_at},raw_payload->signedDate.lte.${verified.signedDate})`);
  if (error) throw new Error("Apple entitlement update failed", { cause: error });
  const history = await service.from("profiles").update({ subscription_trial_started_at: row.purchased_at } as never)
    .eq("id", row.user_id).is("subscription_trial_started_at", null);
  if (history.error) throw new Error("Apple subscription history update failed", { cause: history.error });
  // Creator credit is bookkeeping: it must never withhold the entitlement. A purchase taken over
  // from a deleted account was not bought with the restoring account's code, so it earns none.
  if (!claimed) {
    await attributeAppleCodePurchase(verified, row).catch(() => {
      console.error("Apple code attribution unavailable", { stage: "attach_purchase" });
    });
  }
  return { ...row, plan };
}

export async function getAppleEntitlement(userId: string) {
  if (process.env.APPLE_IAP_ENABLED !== "true") return null;
  assertDatabaseEnvironment();
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("mobile_app_store_entitlements").select("product_id,expires_at")
    .eq("user_id", userId).in("environment", appleAccountEnvironments())
    .eq("status", "active").gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Apple entitlement lookup failed", { cause: error });
  return data as { product_id: string; expires_at: string | null } | null;
}
