import { NextResponse } from "next/server";
import { z } from "zod";

import { getStripeClient } from "@/lib/billing";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import {
  createSupabaseRouteHandlerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

const deleteAccountSchema = z.object({
  confirmation: z.literal("IZBRIŠI"),
});

const STORAGE_BUCKET = "lecture-audio";
const STORAGE_PAGE_SIZE = 100;
const MAX_STORAGE_DEPTH = 12;

type StorageBucket = ReturnType<
  ReturnType<typeof createSupabaseServiceRoleClient>["storage"]["from"]
>;

async function listStoredFiles(
  bucket: StorageBucket,
  prefix: string,
  depth = 0,
): Promise<string[]> {
  if (depth > MAX_STORAGE_DEPTH) {
    throw new Error("Storage path nesting is unexpectedly deep.");
  }

  const files: string[] = [];

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await bucket.list(prefix, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw error;
    }

    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.id || entry.metadata) {
        files.push(path);
      } else {
        files.push(...(await listStoredFiles(bucket, path, depth + 1)));
      }
    }

    if (!data || data.length < STORAGE_PAGE_SIZE) {
      break;
    }
  }

  return files;
}

async function deleteUserStorage(userId: string) {
  const bucket = createSupabaseServiceRoleClient().storage.from(STORAGE_BUCKET);
  const paths = await listStoredFiles(bucket, userId);

  for (let index = 0; index < paths.length; index += 1000) {
    const { error } = await bucket.remove(paths.slice(index, index + 1000));

    if (error) {
      throw error;
    }
  }
}

async function cancelStripeBilling(customerId: string | null) {
  if (!customerId) {
    return;
  }

  try {
    const stripe = getStripeClient();
    let startingAfter: string | undefined;

    do {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        starting_after: startingAfter,
      });

      for (const subscription of subscriptions.data) {
        if (subscription.status !== "canceled") {
          await stripe.subscriptions.cancel(subscription.id);
        }
      }

      startingAfter = subscriptions.has_more
        ? subscriptions.data.at(-1)?.id
        : undefined;
    } while (startingAfter);

    await stripe.customers.del(customerId);
  } catch (error) {
    if ((error as { code?: string }).code !== "resource_missing") {
      throw error;
    }
  }
}

export async function DELETE(request: Request) {
  const routeClient = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await routeClient.supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:account:delete",
    rules: rateLimitPresets.expensiveMutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, deleteAccountSchema, {
    maxBytes: 1024,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const service = createSupabaseServiceRoleClient();

  try {
    const { data: profileData, error: profileError } = await service
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const profile = profileData as { stripe_customer_id: string | null } | null;

    await cancelStripeBilling(profile?.stripe_customer_id ?? null);
    await deleteUserStorage(user.id);

    const { error: usageError } = await service
      .from("ai_usage_events")
      .delete()
      .eq("user_id", user.id);

    if (usageError) {
      throw usageError;
    }

    const { error: authError } = await service.auth.admin.deleteUser(user.id);

    if (authError) {
      throw authError;
    }

    await routeClient.supabase.auth.signOut({ scope: "local" });
    return routeClient.applyCookies(NextResponse.json({ ok: true }));
  } catch (error) {
    console.error("Account deletion failed", { userId: user.id, error });
    return NextResponse.json(
      {
        error:
          "Računa ni bilo mogoče v celoti izbrisati. Poskusi znova ali se obrni na podporo.",
      },
      { status: 500 },
    );
  }
}
