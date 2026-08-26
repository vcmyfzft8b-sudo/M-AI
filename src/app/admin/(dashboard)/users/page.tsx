import { AreaChart } from "@/components/admin/chart";
import { NativeSubmitButton } from "@/components/admin/native-submit";
import { PendingLink } from "@/components/admin/pending-link";
import { SearchForm } from "@/components/admin/search-form";
import {
  Alert,
  Badge,
  Section,
  EmptyState,
  formatCount,
  formatDate,
  formatExact,
  RangeTabs,
  StatCard,
} from "@/components/admin/ui";
import { normalizeRangePreset, resolveRange } from "@/lib/admin/ranges";
import {
  getUserGrowth,
  getUserTotals,
  listUsers,
  normalizeUserFilter,
  USER_FILTERS,
} from "@/lib/admin/users";

type SearchParams = Promise<{
  range?: string;
  q?: string;
  filter?: string;
  page?: string;
  impersonation?: string;
}>;

/** Why a "View as user" press bounced back here, in words the operator can act on. */
const IMPERSONATION_ERRORS: Record<string, string> = {
  "missing-user": "No account was selected.",
  self: "That is your own account — you are already signed in as yourself.",
  "unknown-user": "That account no longer exists, or has no email address to sign in with.",
  "no-admin-session": "Your admin session could not be read. Sign in again and retry.",
  failed: "The session could not be created. The details are in the server logs.",
};

export const dynamic = "force-dynamic";

const FILTER_LABELS: Record<string, string> = {
  all: "All",
  paying: "Paying",
  trialing: "On trial",
  free: "Free",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const preset = normalizeRangePreset(params?.range);
  const range = resolveRange(preset);
  const filter = normalizeUserFilter(params?.filter);
  const search = typeof params?.q === "string" ? params.q.slice(0, 120) : "";
  const page = Math.max(Number(params?.page ?? "1") || 1, 1);
  const impersonationError =
    typeof params?.impersonation === "string"
      ? IMPERSONATION_ERRORS[params.impersonation] ?? null
      : null;

  const [totals, growth, result] = await Promise.all([
    getUserTotals(range),
    getUserGrowth(range),
    listUsers({ page, pageSize: 50, search, filter }),
  ]);

  const totalPages = Math.max(Math.ceil(result.total / result.pageSize), 1);

  const linkTo = (overrides: Record<string, string | number>) => {
    const next = new URLSearchParams();
    next.set("range", preset);

    if (search) {
      next.set("q", search);
    }

    if (filter !== "all") {
      next.set("filter", filter);
    }

    for (const [key, value] of Object.entries(overrides)) {
      next.set(key, String(value));
    }

    return `/admin/users?${next.toString()}`;
  };

  return (
    <>
      {impersonationError && <Alert tone="error">{impersonationError}</Alert>}
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Users</h1>
          <p className="admin-subtitle">
            {formatExact(totals.total)} accounts · {range.label.toLowerCase()}
          </p>
        </div>
        <RangeTabs
          active={preset}
          basePath="/admin/users"
          extraParams={{ q: search || undefined, filter: filter !== "all" ? filter : undefined }}
        />
      </header>

      <div className="admin-grid">
        <StatCard label="Total users" value={formatCount(totals.total)} />
        <StatCard
          label="New sign-ups"
          value={formatExact(totals.newInRange)}
          meta={`${totals.onboardedInRange} completed onboarding`}
        />
        <StatCard
          label="Paying"
          value={formatExact(totals.payingNow)}
          meta={
            totals.total > 0
              ? `${((totals.payingNow / totals.total) * 100).toFixed(1)}% of all users`
              : undefined
          }
        />
        <StatCard label="On trial" value={formatExact(totals.trialingNow)} />
      </div>

      <Section title="Sign-ups per day">
        {growth.some((point) => point.signups > 0) ? (
          <AreaChart
            points={growth.map((point) => ({
              day: point.day,
              value: point.signups,
              rows: [
                { label: "Finished onboarding", value: formatExact(point.onboarded) },
              ],
            }))}
            label="sign-ups"
          />
        ) : (
          <EmptyState title="No sign-ups in this window" />
        )}
      </Section>

      <div className="admin-toolbar">
        <SearchForm
          label="Search users"
          placeholder="Search email or name"
          defaultValue={search}
        />

        <div className="admin-range">
          {USER_FILTERS.map((value) => (
            <PendingLink
              key={value}
              href={linkTo({ filter: value, page: 1 })}
              className="admin-range-item"
              data-active={value === filter}
            >
              {FILTER_LABELS[value]}
            </PendingLink>
          ))}
        </div>
      </div>

      <Section>
        {result.users.length === 0 ? (
          <EmptyState title="No users match this view" />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Joined</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Renews</th>
                  <th>Onboarded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <span
                        style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
                      >
                        {user.isOnline && (
                          <span
                            className="admin-dot"
                            data-pulse="true"
                            style={{ color: "var(--green)" }}
                            title="Online now"
                          />
                        )}
                        <span className="admin-creator-name">
                          {user.fullName || user.email || "—"}
                        </span>
                      </span>
                      {user.fullName && user.email && (
                        <span className="admin-creator-handle">{user.email}</span>
                      )}
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>{user.plan ?? "—"}</td>
                    <td>
                      {user.subscriptionStatus === "trialing" ? (
                        <Badge tone="blue">trial</Badge>
                      ) : user.hasPaidAccess ? (
                        <Badge tone="green">{user.subscriptionStatus}</Badge>
                      ) : user.subscriptionStatus ? (
                        <Badge tone="grey">{user.subscriptionStatus}</Badge>
                      ) : (
                        <Badge tone="grey">free</Badge>
                      )}
                      {user.cancelAtPeriodEnd && (
                        <>
                          {" "}
                          <Badge tone="red">cancelling</Badge>
                        </>
                      )}
                    </td>
                    <td>{formatDate(user.currentPeriodEnd)}</td>
                    <td>{user.onboardingCompletedAt ? "yes" : "no"}</td>
                    <td>
                      {/*
                        Posts to a route handler rather than a server action: starting an
                        impersonation writes session cookies, which only the route-handler
                        Supabase client can do.
                      */}
                      <NativeSubmitButton
                        action="/api/admin/impersonate"
                        className="admin-button"
                        data-size="sm"
                        formClassName="admin-inline-form"
                        fields={{ user_id: user.id }}
                        confirm={`Open the app as ${user.email ?? "this user"}? You will be signed in as them until you press Stop.`}
                        pendingLabel="Opening…"
                      >
                        View as user
                      </NativeSubmitButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {totalPages > 1 && (
        <div
          className="admin-toolbar"
          style={{ marginTop: "1rem", justifyContent: "space-between" }}
        >
          <span className="admin-help">
            Page {page} of {totalPages} · {formatExact(result.total)} matching accounts
          </span>
          <span style={{ display: "flex", gap: "0.5rem" }}>
            {page > 1 && (
              <PendingLink className="admin-button" href={linkTo({ page: page - 1 })}>
                Previous
              </PendingLink>
            )}
            {page < totalPages && (
              <PendingLink className="admin-button" href={linkTo({ page: page + 1 })}>
                Next
              </PendingLink>
            )}
          </span>
        </div>
      )}
    </>
  );
}
