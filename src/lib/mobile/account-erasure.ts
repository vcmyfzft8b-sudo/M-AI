import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/billing";
import { eraseDueAccountsWith } from "./account-erasure-engine";
import { revokeAppleAccountGrants } from "./apple-account-grants";

export async function eraseDueAccounts() {
  return eraseDueAccountsWith(createSupabaseServiceRoleClient(), async (customerId) => {
    const stripe = getStripeClient();
    for await (const subscription of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) await stripe.subscriptions.cancel(subscription.id);
    }
  }, new Date(), revokeAppleAccountGrants);
}
