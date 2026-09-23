import "server-only";

import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { codeCreditForTransaction, CODE_ATTRIBUTION_WINDOW_MS } from "@/lib/mobile/code-credit";

type Service = ReturnType<typeof createSupabaseServiceRoleClient>;
const table = (service: Service) => service.from("apple_code_redemptions");

/**
 * Remembers that this account validated a creator code, so the Apple purchase
 * that follows can be credited to it. Apple's transaction never carries our
 * code, so this is the only record of which code unlocked the offer.
 *
 * One pending row per account and code: checking the same code again refreshes
 * it instead of stacking rows.
 */
export async function recordAppleCodeValidation(userId: string, code: string) {
  const service = createSupabaseServiceRoleClient();
  const normalized = code.trim().toUpperCase();
  const now = new Date().toISOString();
  const pending = await table(service).select("id").eq("user_id", userId).eq("code", normalized)
    .is("transaction_id", null).limit(1).maybeSingle();
  if (pending.error) throw new Error("Apple code redemption lookup failed", { cause: pending.error });
  const write = pending.data
    ? await table(service).update({ validated_at: now } as never).eq("id", (pending.data as { id: string }).id)
    : await table(service).insert({ user_id: userId, code: normalized, validated_at: now } as never);
  if (write.error) throw new Error("Apple code redemption write failed", { cause: write.error });
}

/**
 * Credits a verified Apple purchase to the code validated just before it, and
 * marks a credited purchase refunded when Apple revokes it. Safe to call for
 * every transaction and every replay: the unique indexes make a second attach
 * a no-op, and a transaction that is not a coded first charge changes nothing.
 */
export async function attributeAppleCodePurchase(
  verified: JWSTransactionDecodedPayload,
  row: { user_id: string; environment: "production" | "sandbox" },
) {
  const service = createSupabaseServiceRoleClient();
  if (verified.revocationDate && verified.transactionId) {
    const revoked = await table(service).update({ revoked_at: new Date(verified.revocationDate).toISOString() } as never)
      .eq("transaction_id", verified.transactionId).is("revoked_at", null);
    if (revoked.error) throw new Error("Apple code refund update failed", { cause: revoked.error });
    return;
  }
  const credit = codeCreditForTransaction(verified);
  if (!credit) return;
  const already = await table(service).select("id").eq("original_transaction_id", credit.original_transaction_id).limit(1).maybeSingle();
  if (already.error) throw new Error("Apple code redemption lookup failed", { cause: already.error });
  if (already.data) return;
  const earliest = new Date(Date.parse(credit.paid_at) - CODE_ATTRIBUTION_WINDOW_MS).toISOString();
  // Validation happens before the purchase sheet opens; allow a little clock skew.
  const latest = new Date(Date.parse(credit.paid_at) + 5 * 60_000).toISOString();
  const pending = await table(service).select("id").eq("user_id", row.user_id).is("transaction_id", null)
    .gte("validated_at", earliest).lte("validated_at", latest)
    .order("validated_at", { ascending: false }).limit(1).maybeSingle();
  if (pending.error) throw new Error("Apple code redemption lookup failed", { cause: pending.error });
  if (!pending.data) return;
  const attached = await table(service).update({ ...credit, environment: row.environment } as never)
    .eq("id", (pending.data as { id: string }).id).is("transaction_id", null);
  // A concurrent notification and client report can race to attach the same
  // purchase; the unique index turns the loser into a harmless conflict.
  if (attached.error && attached.error.code !== "23505") {
    throw new Error("Apple code redemption attach failed", { cause: attached.error });
  }
}
