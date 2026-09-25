import { isAuthApiError, isAuthRetryableFetchError, type User } from "@supabase/supabase-js";

/**
 * "Who is this?" asked twice before a moment's trouble at Supabase Auth reads as
 * "nobody".
 *
 * `auth.getUser()` answers `{ user: null, error }` for every failure — a reset
 * connection, a 5xx, a rate-limited token refresh — exactly as it does for a request
 * with no session at all. The tutor routes read only `user`, so on 2026-09-07 one
 * blip at Auth became "Nedovoljen dostop" in the middle of a walkthrough, while the
 * report the page sent 30 ms later, on the very same cookies, was let in.
 *
 * A transient failure is tried once more on a fresh client (a failed refresh removes
 * the session from the old client's storage, so reusing it would ask as nobody), and
 * the client that answered is handed back so the route's queries run as the learner.
 * Still failing after that is `unavailable`, which a route answers as 503, not 401.
 */
export function isTransientAuthError(error: unknown) {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  if (isAuthApiError(error)) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError;
}

type AuthClient = { auth: { getUser(): Promise<{ data: { user: User | null }; error: unknown }> } };

export type UserLookup<C> =
  | { user: User; client: C; unavailable: null }
  | { user: null; client: C; unavailable: null }
  | { user: null; client: C; unavailable: unknown };

export async function getUserWithRetry<C extends AuthClient>(
  makeClient: () => Promise<C> | C,
  { retryDelayMs = 250 }: { retryDelayMs?: number } = {},
): Promise<UserLookup<C>> {
  let client = await makeClient();
  let { data, error } = await client.auth.getUser();

  if (data?.user) return { user: data.user, client, unavailable: null };
  if (!isTransientAuthError(error)) return { user: null, client, unavailable: null };

  await new Promise((settle) => setTimeout(settle, retryDelayMs));
  client = await makeClient();
  ({ data, error } = await client.auth.getUser());

  if (data?.user) return { user: data.user, client, unavailable: null };
  if (!isTransientAuthError(error)) return { user: null, client, unavailable: null };
  return { user: null, client, unavailable: error };
}
