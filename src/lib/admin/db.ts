import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Typed write helpers for the service-role client.
 *
 * `Database` in this project predates `@supabase/supabase-js`'s requirement
 * that every table carry a `Relationships` key. Without it the generated schema
 * fails the client's `GenericSchema` constraint, so every `insert`/`update`/
 * `upsert` payload degrades to `never` and the existing code works around it
 * with inline `as never` casts (see `src/lib/billing.ts`).
 *
 * These wrappers keep that single cast in one place while still checking the
 * payload against the generated `Insert`/`Update` types, so a mistyped column
 * name in the admin dashboard is caught at build time rather than at runtime.
 *
 * Adding `Relationships: []` to every table in `database.types.ts` would remove
 * the need for this entirely; that is a repo-wide change worth doing separately.
 */

type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;

type InsertOf<T extends TableName> = Tables[T]["Insert"];
type UpdateOf<T extends TableName> = Tables[T]["Update"];

type Functions = Database["public"]["Functions"];
export type FunctionName = keyof Functions;

export type ServiceClient = SupabaseClient<Database>;

export function insertInto<T extends TableName>(
  client: ServiceClient,
  table: T,
  values: InsertOf<T> | InsertOf<T>[],
) {
  return client.from(table).insert(values as never);
}

export function updateIn<T extends TableName>(
  client: ServiceClient,
  table: T,
  values: UpdateOf<T>,
) {
  return client.from(table).update(values as never);
}

export function upsertInto<T extends TableName>(
  client: ServiceClient,
  table: T,
  values: InsertOf<T> | InsertOf<T>[],
  options?: { onConflict?: string; ignoreDuplicates?: boolean },
) {
  return client.from(table).upsert(values as never, options);
}

/** Calls a Postgres function with its arguments checked against the schema. */
export async function callRpc<F extends FunctionName>(
  client: ServiceClient,
  fn: F,
  args: Functions[F]["Args"],
): Promise<{
  data: Functions[F]["Returns"] | null;
  error: { message: string } | null;
}> {
  const result = await (
    client.rpc as unknown as (
      name: string,
      params: unknown,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn as string, args);

  return {
    data: (result.data ?? null) as Functions[F]["Returns"] | null,
    error: result.error,
  };
}
