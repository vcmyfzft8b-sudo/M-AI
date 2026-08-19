import Link from "next/link";

import { AutoRefresh } from "@/components/admin/auto-refresh";
import { AreaChart } from "@/components/admin/chart";
import {
  Alert,
  Avatar,
  Badge,
  Section,
  EmptyState,
  formatCount,
  formatExact,
  formatPercent,
  formatRelative,
  RangeTabs,
  StatCard,
} from "@/components/admin/ui";
import { getOnlineVisitors, getTrafficSummary } from "@/lib/admin/analytics";
import {
  getRealtimeVisitors,
  getVercelTraffic,
} from "@/lib/admin/vercel-analytics";
import { normalizeRangePreset, resolveRange } from "@/lib/admin/ranges";
import {
  formatMoney,
  loadSalesData,
  type SalesSummary,
  summarizeSales,
} from "@/lib/admin/sales";
import {
  countVideosNeedingReview,
  getCreatorMetrics,
  getDailyDeltas,
  getEarliestDataDay,
  listCreators,
  sumMetrics,
  toDailySeries,
} from "@/lib/admin/ugc";
import { getUserTotals } from "@/lib/admin/users";
import { getLatestSyncRun } from "@/lib/ugc/sync";

type SearchParams = Promise<{ range?: string }>;

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const preset = normalizeRangePreset(params?.range);
  const earliest = await getEarliestDataDay();
  const range = resolveRange(preset, { earliestDay: earliest });

  const creators = await listCreators();

  const [
    metrics,
    deltas,
    beaconTraffic,
    online,
    vercelTraffic,
    liveNow,
    userTotals,
    reviewCount,
    syncRun,
    sales,
  ] = await Promise.all([
    getCreatorMetrics(creators, range),
    getDailyDeltas(range, { onlyMemo: true }),
    getTrafficSummary(range),
    getOnlineVisitors(),
    getVercelTraffic(range),
    getRealtimeVisitors(),
    getUserTotals(range),
    countVideosNeedingReview(),
    getLatestSyncRun(),
    // Stripe is the one dependency that can be slow or down; the overview has
    // to render without it.
    loadSalesData({ historyDays: 120 })
      .then((data) => summarizeSales(data, range))
      .catch(() => null as SalesSummary | null),
  ]);

  const totals = sumMetrics(metrics);
  const series = toDailySeries(deltas, range);

  // Vercel Web Analytics holds the traffic history; the beacon only knows what
  // it has seen since shipping, and only it can name who is online.
  const traffic = vercelTraffic
    ? {
        visitors: vercelTraffic.visitors,
        pageViews: vercelTraffic.pageViews,
        newVisitors: beaconTraffic.newVisitors,
      }
    : beaconTraffic;
  const onlineCount = liveNow ?? online.length;

  const topCreators = [...creators]
    .map((creator) => ({ creator, entry: metrics.get(creator.id) }))
    .filter((row) => (row.entry?.viewsGained ?? 0) > 0)
    .sort((a, b) => (b.entry?.viewsGained ?? 0) - (a.entry?.viewsGained ?? 0))
    .slice(0, 6);

  const needsSetup = creators.length === 0;
  const noViewData = !series.some((point) => point.views > 0);

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Overview</h1>
          <p className="admin-subtitle">{range.label} · memoai.eu</p>
        </div>
        <RangeTabs active={preset} basePath="/admin" />
      </header>

      {/* The overview carries the live online count, so it polls faster too. */}
      <AutoRefresh live />

      {needsSetup && (
        <Alert tone="info">
          No creators yet.{" "}
          <Link className="admin-link" href="/admin/creators">
            Add your creators
          </Link>{" "}
          to start tracking the campaign.
        </Alert>
      )}

      {reviewCount > 0 && (
        <Alert tone="info">
          {reviewCount} video{reviewCount === 1 ? "" : "s"} had an unclear Memo AI
          signal and are not being counted.{" "}
          <Link className="admin-link" href="/admin/creators">
            Review them
          </Link>
          .
        </Alert>
      )}

      <div className="admin-grid">
        <StatCard
          label="Campaign views"
          value={formatCount(totals.viewsGained)}
          meta={`${totals.videosPosted} video${
            totals.videosPosted === 1 ? "" : "s"
          } posted`}
        />
        <StatCard
          label="Revenue"
          value={sales ? formatMoney(sales.revenue, sales.currency) : "n/a"}
          current={sales?.revenue}
          previous={sales && range.previous ? sales.previousRevenue : undefined}
          meta={sales ? `${formatMoney(Math.round(sales.mrr), sales.currency)} MRR` : "Stripe unavailable"}
        />
        <StatCard
          label="Active trials"
          value={sales ? formatExact(sales.trials.activeTrials) : "n/a"}
          meta={
            sales
              ? `${formatMoney(
                  sales.trials.projectedRevenueToday,
                  sales.currency,
                )} projected today`
              : undefined
          }
        />
        <StatCard
          label="Online now"
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              {formatExact(onlineCount)}
              {onlineCount > 0 && (
                <span
                  className="admin-dot"
                  data-pulse="true"
                  style={{ color: "var(--green)" }}
                />
              )}
            </span>
          }
          meta={`${formatCount(traffic.visitors)} visits this period`}
        />
      </div>

      <Section
        title="Campaign views per day"
        hint="Views gained each day across every creator's Memo AI posts."
        actions={
          <Link className="admin-button" data-size="sm" href="/admin/creators">
            Creator detail
          </Link>
        }
      >
        {noViewData ? (
          <EmptyState title="No view data yet">
            {needsSetup
              ? "Add your creators, then run a sync."
              : "Run a sync from the Creators page to pull each account's posts."}
          </EmptyState>
        ) : (
          <AreaChart
            points={series.map((point) => ({
              day: point.day,
              value: point.views,
              detail: `${point.videosPosted} posted · ${formatCount(point.likes)} likes`,
            }))}
            label="views"
          />
        )}
      </Section>

      <div className="admin-section admin-two-col">
        <Section
          title="Top creators"
          hint={`By views generated ${range.label.toLowerCase()}.`}
        >
          {topCreators.length === 0 ? (
            <EmptyState title="No creator activity in this window" />
          ) : (
            <div className="admin-list">
              {topCreators.map(({ creator, entry }) => (
                <div className="admin-list-row" key={creator.id}>
                  <Link
                    href={`/admin/creators/${creator.id}`}
                    className="admin-creator-cell"
                    style={{ textDecoration: "none", color: "inherit", flex: 1 }}
                  >
                    <Avatar src={creator.accounts[0]?.avatar_url} name={creator.name} />
                    <span style={{ minWidth: 0 }}>
                      <span className="admin-creator-name">{creator.name}</span>
                      <br />
                      <span className="admin-creator-handle">
                        {entry?.videosPosted ?? 0} post
                        {(entry?.videosPosted ?? 0) === 1 ? "" : "s"} ·{" "}
                        {entry && entry.viewsGained > 0
                          ? formatPercent(entry.engagementRate)
                          : "0%"}{" "}
                        engagement
                      </span>
                    </span>
                  </Link>
                  <span className="admin-list-value">
                    {formatCount(entry?.viewsGained ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Traffic and users">
          <div className="admin-list">
            <div className="admin-list-row">
              <span className="admin-list-label">Visits</span>
              <span className="admin-list-value">{formatCount(traffic.visitors)}</span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Page views</span>
              <span className="admin-list-value">{formatCount(traffic.pageViews)}</span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">New visitors</span>
              <span className="admin-list-value">{formatCount(traffic.newVisitors)}</span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">New sign-ups</span>
              <span className="admin-list-value">{formatExact(userTotals.newInRange)}</span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Total users</span>
              <span className="admin-list-value">{formatExact(userTotals.total)}</span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Paying users</span>
              <span className="admin-list-value">{formatExact(userTotals.payingNow)}</span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Last TikTok sync</span>
              <span className="admin-list-value">
                {syncRun?.status === "running" ? (
                  <Badge tone="blue" pulse>
                    running
                  </Badge>
                ) : (
                  formatRelative(syncRun?.finished_at ?? null)
                )}
              </span>
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}
