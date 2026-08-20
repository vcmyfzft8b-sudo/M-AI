import { AutoRefresh } from "@/components/admin/auto-refresh";
import { AreaChart, type ChartPoint } from "@/components/admin/chart";
import { PendingLink } from "@/components/admin/pending-link";
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
  computeViewValue,
  VALUE_BASELINE_DAYS,
} from "@/lib/admin/campaign-value";
import {
  getRealtimeVisitors,
  getVercelTraffic,
} from "@/lib/admin/vercel-analytics";
import {
  formatHourLabel,
  hourInReportZone,
  normalizeRangePreset,
  resolveRange,
  todayInReportZone,
} from "@/lib/admin/ranges";
import {
  formatMoney,
  getRevenueBetween,
  loadSalesData,
  type PaymentSnapshot,
  projectionAtDayStart,
  type SalesData,
  summarizeSales,
} from "@/lib/admin/sales";
import {
  countVideosNeedingReview,
  getBaselineCampaignViews,
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

/**
 * Stripe payments on the given day, bucketed by report-zone hour.
 *
 * Views arrive in one nightly scrape, so a single-day window has nothing
 * intraday to chart — but payments carry real timestamps, so revenue does.
 * On today, hours that have not happened yet are left off rather than drawn
 * as zero.
 */
function hourlyRevenuePoints(
  payments: PaymentSnapshot[],
  day: string,
  isToday: boolean,
): ChartPoint[] {
  const byHour = new Map<number, { amount: number; count: number }>();

  for (const payment of payments) {
    const at = new Date(payment.created * 1000);

    if (todayInReportZone(at) !== day) {
      continue;
    }

    const hour = hourInReportZone(at);
    const bucket = byHour.get(hour) ?? { amount: 0, count: 0 };

    bucket.amount += payment.amount;
    bucket.count += 1;
    byHour.set(hour, bucket);
  }

  const hours = isToday ? hourInReportZone() + 1 : 24;

  return Array.from({ length: hours }, (_, hour) => {
    const bucket = byHour.get(hour);

    return {
      day,
      label: formatHourLabel(hour),
      value: bucket?.amount ?? 0,
      rows: [{ label: "Payments", value: formatExact(bucket?.count ?? 0) }],
    };
  });
}

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
    salesData,
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
    loadSalesData().catch(() => null as SalesData | null),
  ]);

  const sales = salesData ? summarizeSales(salesData, range) : null;
  // Frozen at the start of today, so it reads the same all day however many of
  // the trials have already converted or lapsed by now.
  const projectedToday = salesData
    ? projectionAtDayStart(salesData, todayInReportZone())
    : null;

  const totals = sumMetrics(metrics);
  const series = toDailySeries(deltas, range);

  // What a view is worth, for the finance summary below. Both halves degrade
  // to "not enough data" rather than taking the overview down with them.
  const baseline = await getBaselineCampaignViews(VALUE_BASELINE_DAYS).catch(
    () => ({ views: 0, from: range.from, to: range.to }),
  );
  const baselineRevenue = await getRevenueBetween(
    baseline.from,
    baseline.to,
  ).catch(() => 0);
  const viewValue = computeViewValue({
    revenue: baselineRevenue,
    views: baseline.views,
    days: VALUE_BASELINE_DAYS,
  });

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
  // Views arrive in one nightly scrape, so a single-day window has no intraday
  // shape to draw — the per-day chart only means something across days.
  const singleDayWindow = preset === "today" || preset === "yesterday";

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
          <PendingLink className="admin-link" href="/admin/creators">
            Add your creators
          </PendingLink>{" "}
          to start tracking the campaign.
        </Alert>
      )}

      {reviewCount > 0 && (
        <Alert tone="info">
          {reviewCount} video{reviewCount === 1 ? "" : "s"} had an unclear Memo AI
          signal and are not being counted.{" "}
          <PendingLink className="admin-link" href="/admin/creators">
            Review them
          </PendingLink>
          .
        </Alert>
      )}

      <div className="admin-grid">
        {preset === "today" ? (
          // Views only land in the nightly scrape, so today's count reads zero
          // for almost the whole day. Sign-ups actually move during the day.
          <StatCard
            label="New sign-ups"
            value={formatExact(userTotals.newInRange)}
            meta={`${formatExact(userTotals.total)} users in total`}
          />
        ) : (
          <StatCard
            label="Campaign views"
            value={formatCount(totals.viewsGained)}
            meta={`${totals.videosPosted} video${
              totals.videosPosted === 1 ? "" : "s"
            } posted`}
          />
        )}
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
            // The projection is about today only, so it reads as noise under
            // any other window.
            preset === "today" && sales && projectedToday
              ? `${formatMoney(
                  projectedToday.projectedRevenue,
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

      {singleDayWindow ? (
        <Section
          title="Revenue by hour"
          hint={`Stripe payments through ${
            preset === "today" ? "today" : "yesterday"
          }, hour by hour. Views only land in the nightly scrape, so they have no intraday chart.`}
          actions={
            <PendingLink className="admin-button" data-size="sm" href="/admin/finance">
              Finance detail
            </PendingLink>
          }
        >
          {salesData === null ? (
            <EmptyState title="Stripe unavailable" />
          ) : (
            (() => {
              const points = hourlyRevenuePoints(
                salesData.payments,
                range.to,
                preset === "today",
              );

              return !points.some((point) => point.value > 0) ? (
                <EmptyState title="No payments in this window yet" />
              ) : (
                <AreaChart
                  points={points}
                  label="revenue"
                  formatter={(value) =>
                    formatMoney(Math.round(value), sales?.currency)
                  }
                />
              );
            })()
          )}
        </Section>
      ) : (
        <Section
          title="Campaign views per day"
          hint="Views gained each day across every creator's Memo AI posts."
          actions={
            <PendingLink className="admin-button" data-size="sm" href="/admin/creators">
              Creator detail
            </PendingLink>
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
                rows: [
                  { label: "Videos posted", value: formatExact(point.videosPosted) },
                  { label: "Likes", value: formatCount(point.likes) },
                  { label: "Comments", value: formatCount(point.comments) },
                ],
              }))}
              label="views"
            />
          )}
        </Section>
      )}

      <Section
        title="Finance at a glance"
        hint="The headline money figures. The full picture — payouts, margin, codes — is on the Finance page."
        actions={
          <PendingLink className="admin-button" data-size="sm" href="/admin/finance">
            Finance detail
          </PendingLink>
        }
      >
        <div className="admin-list">
          <div className="admin-list-row">
            <span className="admin-list-label">Revenue this window</span>
            <span className="admin-list-value">
              {sales ? formatMoney(sales.revenue, sales.currency) : "Stripe unavailable"}
            </span>
          </div>
          {preset === "today" && (
            <div className="admin-list-row">
              <span className="admin-list-label">
                Projected from trials due today{" "}
                <span className="admin-help">· frozen at the start of the day</span>
              </span>
              <span className="admin-list-value">
                {sales && projectedToday
                  ? formatMoney(projectedToday.projectedRevenue, sales.currency)
                  : "Stripe unavailable"}
              </span>
            </div>
          )}
          <div className="admin-list-row">
            <span className="admin-list-label">Revenue per 1,000 views</span>
            <span className="admin-list-value">
              {viewValue.revenuePerMille === null
                ? "needs more campaign data"
                : formatMoney(
                    Math.round(viewValue.revenuePerMille),
                    sales?.currency,
                  )}
            </span>
          </div>
        </div>
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
                  <PendingLink
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
                  </PendingLink>
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
