import Link from "next/link";

import { AreaChart } from "@/components/admin/chart";
import {
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
}>;

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
              detail: `${point.onboarded} finished onboarding`,
            }))}
            label="sign-ups"
          />
        ) : (
          <EmptyState title="No sign-ups in this window" />
        )}
      </Section>

      <div className="admin-toolbar">
        <form method="get" style={{ display: "flex", gap: "0.5rem" }}>
          <input type="hidden" name="range" value={preset} />
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <input
            className="admin-input"
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search email or name"
            style={{ width: "16rem" }}
            aria-label="Search users"
          />
          <button type="submit" className="admin-button">
            Search
          </button>
        </form>

        <div className="admin-range">
          {USER_FILTERS.map((value) => (
            <Link
              key={value}
              href={linkTo({ filter: value, page: 1 })}
              className="admin-range-item"
              data-active={value === filter}
              prefetch={false}
            >
              {FILTER_LABELS[value]}
            </Link>
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
              <Link className="admin-button" href={linkTo({ page: page - 1 })} prefetch={false}>
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link className="admin-button" href={linkTo({ page: page + 1 })} prefetch={false}>
                Next
              </Link>
            )}
          </span>
        </div>
      )}

      {filter !== "all" && (
        <p className="admin-help" style={{ marginTop: "0.75rem" }}>
          The plan filter is applied to the current page of results, so the count
          above describes all matching accounts rather than the filtered rows.
        </p>
      )}
    </>
  );
}
