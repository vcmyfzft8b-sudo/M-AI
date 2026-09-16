import "server-only";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { openAppleToken, revokeAppleToken } from "./apple-identity";
import type { Database } from "@/lib/database.types";

export async function revokeAppleAccountGrants(userId: string) {
  const service = createSupabaseServiceRoleClient();
  const { data, error } = await service.from("apple_auth_grants").select("*").eq("user_id", userId);
  if (error) throw new Error("Apple grants unavailable");
  for (const grant of (data ?? []) as Database["public"]["Tables"]["apple_auth_grants"]["Row"][]) {
    await revokeAppleToken(openAppleToken(grant.refresh_token_encrypted, userId, grant.client_id), grant.client_id);
  }
  // Keep the ciphertext until auth deletion cascades it away. If a process dies
  // here, Apple's revoke endpoint succeeds again for the already-invalid token.
}
