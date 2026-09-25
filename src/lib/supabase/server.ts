import "server-only";

import { createServerClient } from "@supabase/ssr";
import { AuthError, createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/public-env";
import { getServerEnv } from "@/lib/server-env";
import { accountDeletionRequested } from "@/lib/mobile/account-lifecycle";
import { withSupabaseReadRetry } from "@/lib/supabase/read-retry";

function blockDeletingAccount(client: SupabaseClient<Database>) {
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = async (jwt?: string) => {
    const result = await getUser(jwt);
    if (result.data.user && accountDeletionRequested(result.data.user)) {
      return { data: { user: null }, error: new AuthError("Account deletion requested", 401) };
    }
    return result;
  };
  return client;
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Missing Supabase public environment variables.");
  }

  return blockDeletingAccount(createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: withSupabaseReadRetry() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Session refresh writes are handled in middleware.
      },
    },
  }));
}

export async function createSupabaseRouteHandlerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Missing Supabase public environment variables.");
  }

  let cookiesToApply: Array<
    [string, string, Partial<ResponseCookie> | undefined]
  > = [];

  const supabase = blockDeletingAccount(createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: withSupabaseReadRetry() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(items) {
        cookiesToApply = items.map(({ name, value, options }) => [
          name,
          value,
          options,
        ]);
      },
    },
  }));

  return {
    supabase,
    applyCookies(response: NextResponse) {
      cookiesToApply.forEach(([name, value, options]) => {
        response.cookies.set(name, value, options);
      });

      return response;
    },
  };
}

export function createSupabaseServiceRoleClient() {
  const env = getServerEnv();

  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: { fetch: withSupabaseReadRetry() },
    },
  );
}
