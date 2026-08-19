import "server-only";

import { type DateRange, eachDay, rangeToTimestamps, todayInReportZone } from "@/lib/admin/ranges";
import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";
import {
  ACTIVE_STATUS_LIST,
  ACTIVE_STATUSES,
  classifyPlanMembership,
  type PlanMembership,
} from "@/lib/admin/user-plans";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type AdminUserListItem = {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  onboardingCompletedAt: string | null;
  plan: string | null;
  subscriptionStatus: BillingSubscriptionRow["status"] | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasPaidAccess: boolean;
  trialConsumedAt: string | null;
  lastSeenAt: string | null;
  isOnline: boolean;
};

export type UserListResult = {
  users: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export const USER_FILTERS = ["all", "paying", "trialing", "free"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export function normalizeUserFilter(value: string | null | undefined): UserFilter {
  return USER_FILTERS.includes(value as UserFilter) ? (value as UserFilter) : "all";
}

/**
 * Every live subscription, classified.
 *
 * Reading them all to filter one page is only reasonable because there are a
 * few hundred against a few thousand profiles. If paid subscriptions ever
 * approach the same order as profiles this wants to become a database-side
 * join, since the ids travel to PostgREST on the query string.
 */
async function loadPlanMembership(
  serviceRole: ReturnType<typeof createSupabaseServiceRoleClient>,
): Promise<PlanMembership> {
  const { data, error } = await serviceRole
    .from("billing_subscriptions")
    .select("user_id, status")
    .in("status", [...ACTIVE_STATUS_LIST]);

  if (error) {
    throw new Error(`Could not load subscription plans: ${error.message}`);
  }

  return classifyPlanMembership(
    (data ?? []) as Array<{ user_id: string; status: string }>,
  );
}

export async function listUsers(options: {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: UserFilter;
}): Promise<UserListResult> {
  const serviceRole = createSupabaseServiceRoleClient();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const page = Math.max(options.page ?? 1, 1);
  const filter = options.filter ?? "all";
  const search = options.search?.trim();

  let query = serviceRole
    .from("profiles")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  // Narrow before paginating, not after. Filtering the page that came back
  // returned an empty table on every plan except "all" -- profiles are ordered
  // newest first, and the newest few dozen signups are almost never paying --
  // while the count carried on describing all accounts.
  if (filter !== "all") {
    const { paying, trialing } = await loadPlanMembership(serviceRole);

    if (filter === "paying") {
      query = query.in("id", [...paying]);
    } else if (filter === "trialing") {
      query = query.in("id", [...trialing]);
    } else {
      const subscribed = [...paying, ...trialing];

      // With nobody subscribed every account is free, so the exclusion has
      // nothing to exclude. PostgREST does accept an empty `not.in.()` and
      // returns everything, so this is for clarity rather than to avoid an
      // error.
      if (subscribed.length > 0) {
        query = query.not("id", "in", `(${subscribed.join(",")})`);
      }
    }
  }

  if (search) {
    // Escape the PostgREST `or` filter separators so a comma or paren in the
    // search box cannot break out of the expression.
    const safe = search.replace(/[,()]/g, " ").trim();

    if (safe) {
      query = query.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`);
    }
  }

  const { data, error, count } = await query.range(
    (page - 1) * pageSize,
    page * pageSize - 1,
  );

  if (error) {
    throw new Error(`Could not load users: ${error.message}`);
  }

  const profiles = (data ?? []) as ProfileRow[];
  const ids = profiles.map((profile) => profile.id);

  const subscriptions = new Map<string, BillingSubscriptionRow>();
  const online = new Set<string>();

  if (ids.length > 0) {
    const [subscriptionResult, sessionResult] = await Promise.all([
      serviceRole
        .from("billing_subscriptions")
        .select("*")
        .in("user_id", ids)
        .order("updated_at", { ascending: false }),
      serviceRole
        .from("site_sessions")
        .select("user_id")
        .in("user_id", ids)
        .gte("last_seen_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()),
    ]);

    for (const row of (subscriptionResult.data ?? []) as BillingSubscriptionRow[]) {
      const existing = subscriptions.get(row.user_id);

      // Prefer a live subscription over a stale cancelled one.
      if (!existing || (!ACTIVE_STATUSES.has(existing.status) && ACTIVE_STATUSES.has(row.status))) {
        subscriptions.set(row.user_id, row);
      }
    }

    for (const row of (sessionResult.data ?? []) as Array<{ user_id: string | null }>) {
      if (row.user_id) {
        online.add(row.user_id);
      }
    }
  }

  const users: AdminUserListItem[] = profiles.map((profile) => {
    const subscription = subscriptions.get(profile.id) ?? null;
    const hasPaidAccess = subscription
      ? ACTIVE_STATUSES.has(subscription.status)
      : false;

    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      createdAt: profile.created_at,
      onboardingCompletedAt: profile.onboarding_completed_at,
      plan: subscription?.plan ?? null,
      subscriptionStatus: subscription?.status ?? null,
      currentPeriodEnd: subscription?.current_period_end ?? null,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
      hasPaidAccess,
      trialConsumedAt: profile.trial_consumed_at,
      lastSeenAt: null,
      isOnline: online.has(profile.id),
    };
  });

  return {
    users,
    // Now describes the filtered set, because the filter reached the query.
    total: count ?? users.length,
    page,
    pageSize,
  };
}

export type UserGrowthPoint = {
  day: string;
  signups: number;
  onboarded: number;
};

export async function getUserGrowth(range: DateRange): Promise<UserGrowthPoint[]> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { fromIso, toIso } = rangeToTimestamps(range);

  const [signupResult, onboardedResult] = await Promise.all([
    serviceRole
      .from("profiles")
      .select("created_at")
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    serviceRole
      .from("profiles")
      .select("onboarding_completed_at")
      .gte("onboarding_completed_at", fromIso)
      .lt("onboarding_completed_at", toIso),
  ]);

  const byDay = new Map<string, UserGrowthPoint>();

  for (const day of eachDay(range.from, range.to)) {
    byDay.set(day, { day, signups: 0, onboarded: 0 });
  }

  for (const row of (signupResult.data ?? []) as Array<{ created_at: string }>) {
    const point = byDay.get(todayInReportZone(new Date(row.created_at)));

    if (point) {
      point.signups += 1;
    }
  }

  for (const row of (onboardedResult.data ?? []) as Array<{
    onboarding_completed_at: string | null;
  }>) {
    if (!row.onboarding_completed_at) {
      continue;
    }

    const point = byDay.get(
      todayInReportZone(new Date(row.onboarding_completed_at)),
    );

    if (point) {
      point.onboarded += 1;
    }
  }

  return Array.from(byDay.values());
}

export type UserTotals = {
  total: number;
  newInRange: number;
  onboardedInRange: number;
  payingNow: number;
  trialingNow: number;
};

export async function getUserTotals(range: DateRange): Promise<UserTotals> {
  const serviceRole = createSupabaseServiceRoleClient();
  const { fromIso, toIso } = rangeToTimestamps(range);

  const [total, newInRange, onboardedInRange, subscriptions] = await Promise.all([
    serviceRole.from("profiles").select("id", { count: "exact", head: true }),
    serviceRole
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    serviceRole
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("onboarding_completed_at", fromIso)
      .lt("onboarding_completed_at", toIso),
    serviceRole
      .from("billing_subscriptions")
      .select("user_id, status")
      .in("status", [...ACTIVE_STATUS_LIST]),
  ]);

  const { paying, trialing } = classifyPlanMembership(
    (subscriptions.data ?? []) as Array<{ user_id: string; status: string }>,
  );

  return {
    total: total.count ?? 0,
    newInRange: newInRange.count ?? 0,
    onboardedInRange: onboardedInRange.count ?? 0,
    payingNow: paying.size,
    trialingNow: trialing.size,
  };
}
