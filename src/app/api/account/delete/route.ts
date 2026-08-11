import { NextResponse } from "next/server";

import { getStripeClient, getViewerAppState } from "@/lib/billing";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Permanently deletes the signed-in user's account.
 *
 * Required by App Store Guideline 5.1.1(v): an app that lets people create an account must let
 * them delete it from inside the app, not only by emailing support.
 *
 * Order matters. Stripe is cancelled first, because losing the ability to bill someone whose
 * account is gone is the one step that cannot be repaired afterwards. Storage objects go next
 * (rows still name their paths), then the database rows, then the auth user last — while the
 * auth user exists the caller can retry, so a failure part-way leaves a recoverable state
 * rather than an orphaned login with no data.
 */
export async function POST(request: Request) {
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:account:delete:post",
    rules: rateLimitPresets.mutate,
    userId: appState.user.id,
  });

  if (limited) {
    return limited;
  }

  const userId = appState.user.id;
  const service = createSupabaseServiceRoleClient();

  // 1. Stop billing.
  const stripeCustomerId = appState.profile?.stripe_customer_id ?? null;

  if (stripeCustomerId) {
    try {
      const stripe = getStripeClient();
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: "all",
        limit: 100,
      });

      for (const subscription of subscriptions.data) {
        if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
          continue;
        }
        await stripe.subscriptions.cancel(subscription.id);
      }
    } catch (error) {
      // Never leave an active subscription behind on a deleted account.
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? `Naročnine ni bilo mogoče preklicati: ${error.message}`
              : "Naročnine ni bilo mogoče preklicati.",
        },
        { status: 500 },
      );
    }
  }

  // 2. Remove stored audio, scans and note media.
  const { data: lectureRows } = await service
    .from("lectures")
    .select("storage_path")
    .eq("user_id", userId);

  const { data: noteMediaRows } = await service
    .from("lecture_note_media")
    .select("storage_path")
    .eq("user_id", userId);

  const storagePaths = [
    ...((lectureRows ?? []) as Array<{ storage_path: string | null }>),
    ...((noteMediaRows ?? []) as Array<{ storage_path: string | null }>),
  ]
    .map((row) => row.storage_path)
    .filter((path): path is string => Boolean(path));

  if (storagePaths.length > 0) {
    await service.storage.from("lecture-audio").remove(storagePaths);
  }

  // 3. Remove the rows. Anything with a cascade on auth.users would go with the user anyway;
  // deleting explicitly keeps this correct if those constraints ever change.
  await service.from("lectures").delete().eq("user_id", userId);
  await service.from("profiles").delete().eq("id", userId);

  // 4. Remove the login itself.
  const { error: authError } = await service.auth.admin.deleteUser(userId);

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Clear the session cookies, so the browser is not left holding a token for a user that no
  // longer exists.
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  await supabase.auth.signOut().catch(() => undefined);

  return applyCookies(NextResponse.json({ ok: true }));
}
