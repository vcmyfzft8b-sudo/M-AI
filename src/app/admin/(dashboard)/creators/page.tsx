import Link from "next/link";

import { AreaChart, type ChartPoint, toCumulative } from "@/components/admin/chart";
import { AddCreatorForm } from "@/components/admin/creator-form";
import { FilterBar } from "@/components/admin/filter-bar";
import { Disclosure } from "@/components/admin/forms";
import {
  METRIC_LABELS,
  MetricTiles,
  type MetricKey,
  normalizeMetric,
} from "@/components/admin/metric-tiles";
import { SyncPanel } from "@/components/admin/sync-panel";
import {
  Avatar,
  Badge,
  EmptyState,
  formatCount,
  formatExact,
  formatPercent,
  RangeTabs,
  Section,
} from "@/components/admin/ui";
import { VideoReviewList } from "@/components/admin/video-review";
import {
  computeViewValue,
  estimateRevenue,
  VALUE_BASELINE_DAYS,
} from "@/lib/admin/campaign-value";
import { normalizeRangePreset, resolveRange } from "@/lib/admin/ranges";
import {
  creatorRevenue,
  formatMoney,
  getRevenueBetween,
  loadSalesData,
  promoCodeStats,
} from "@/lib/admin/sales";
import {
  getBaselineCampaignViews,
  getCreatorMetrics,
  getDailyDeltas,
  getEarliestDataDay,
  listCreators,
  listVideos,
  sumMetrics,
  toDailySeries,
} from "@/lib/admin/ugc";
import { getLatestSyncRun } from "@/lib/ugc/sync";

type SearchParams = Promise<{
  range?: string;
  metric?: string;
  creator?: string;
  mode?: string;
  kind?: string;
  view?: string;
  compare?: string;
}>;

export const dynamic = "force-dynamic";

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const preset = normalizeRangePreset(params?.range);
  const metric = normalizeMetric(params?.metric);
  const cumulative = params?.view === "cumulative";
  const compare = params?.compare !== "off";
  const creatorFilter = params?.creator ?? "";
  const modeFilter = params?.mode ?? "";
  const kindFilter = params?.kind ?? "";

  const earliest = await getEarliestDataDay();
  const range = resolveRange(preset, { earliestDay: earliest });

  const allCreators = await listCreators();

  // Filters narrow which creators feed every number on the page, so the tiles,
  // the chart and the table can never disagree about what is being shown.
  const creators = allCreators.filter((creator) => {
    if (creatorFilter && creator.id !== creatorFilter) {
      return false;
    }

    if (kindFilter && creator.kind !== kindFilter) {
      return false;
    }

    if (modeFilter) {
      return creator.accounts.some((account) => account.content_mode === modeFilter);
    }

    return true;
  });

  const creatorIds = new Set(creators.map((creator) => creator.id));

  const [metrics, deltas, previousDeltas, previousMetrics, reviewQueue, syncRun] =
    await Promise.all([
      getCreatorMetrics(creators, range),
      getDailyDeltas(range, { onlyMemo: true }),
      range.previous
        ? getDailyDeltas(range.previous, { onlyMemo: true })
        : Promise.resolve([]),
      range.previous
        ? getCreatorMetrics(creators, range.previous)
        : Promise.resolve(null),
      listVideos({ classification: "unknown", limit: 25 }),
      getLatestSyncRun(),
    ]);

  const scoped = deltas.filter((row) => creatorIds.has(row.creator_id));
  const scopedPrevious = previousDeltas.filter((row) => creatorIds.has(row.creator_id));

  const totals = sumMetrics(metrics);
  const previousTotals = previousMetrics ? sumMetrics(previousMetrics) : null;
  const series = toDailySeries(scoped, range);
  const previousSeries = range.previous
    ? toDailySeries(scopedPrevious, range.previous)
    : [];

  // Code usage is kept as a measure of *tracked* signups, but revenue is no
  // longer attributed that way: most people who see a video and subscribe never
  // type the code, so code revenue is a floor rather than a measure.
  const codeUsage = await loadSalesData({ historyDays: 400 })
    .then((data) =>
      creatorRevenue(creators, promoCodeStats(data, range), data.codeRedemptions),
    )
    .catch(() => null);

  // What a view is worth: campaign revenue over a rolling baseline window
  // divided by campaign views over the same window.
  const baseline = await getBaselineCampaignViews(VALUE_BASELINE_DAYS);
  const baselineRevenue = await getRevenueBetween(baseline.from, baseline.to).catch(
    () => 0,
  );
  const viewValue = computeViewValue({
    revenue: baselineRevenue,
    views: baseline.views,
    days: VALUE_BASELINE_DAYS,
  });

  const totalRevenue = estimateRevenue(totals.viewsGained, viewValue);

  const link = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    next.set("range", preset);
    if (metric !== "views") next.set("metric", metric);
    if (creatorFilter) next.set("creator", creatorFilter);
    if (modeFilter) next.set("mode", modeFilter);
    if (kindFilter) next.set("kind", kindFilter);
    if (cumulative) next.set("view", "cumulative");
    if (!compare) next.set("compare", "off");

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }

    return `/admin/creators?${next.toString()}`;
  };

  const seriesFor = (
    rows: ReturnType<typeof toDailySeries>,
    key: MetricKey,
  ): ChartPoint[] =>
    rows.map((point) => ({
      day: point.day,
      value:
        key === "likes"
          ? point.likes
          : key === "comments"
            ? point.comments
            : key === "shares"
              ? point.shares
              : key === "videos"
                ? point.videosPosted
                : point.views,
      rows: [
        { label: "Videos posted", value: formatExact(point.videosPosted) },
        { label: "Likes", value: formatCount(point.likes) },
        { label: "Comments", value: formatCount(point.comments) },
        { label: "Shares", value: formatCount(point.shares) },
      ],
    }));

  const chartable: MetricKey[] = ["views", "likes", "comments", "shares", "videos"];
  const chartMetric = chartable.includes(metric) ? metric : "views";

  const primary = cumulative
    ? toCumulative(seriesFor(series, chartMetric))
    : seriesFor(series, chartMetric);
  const secondary =
    compare && previousSeries.length > 0
      ? cumulative
        ? toCumulative(seriesFor(previousSeries, chartMetric))
        : seriesFor(previousSeries, chartMetric)
      : undefined;

  const hasData = primary.some((point) => point.value > 0);

  const sorted = [...creators].sort(
    (a, b) =>
      (metrics.get(b.id)?.viewsGained ?? 0) - (metrics.get(a.id)?.viewsGained ?? 0),
  );

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Creators</h1>
          <p className="admin-subtitle">
            {creators.length} of {allCreators.length} accounts ·{" "}
            {range.label.toLowerCase()}
          </p>
        </div>
        <RangeTabs
          active={preset}
          basePath="/admin/creators"
          extraParams={{
            metric: metric !== "views" ? metric : undefined,
            creator: creatorFilter || undefined,
            mode: modeFilter || undefined,
            kind: kindFilter || undefined,
            view: cumulative ? "cumulative" : undefined,
            compare: compare ? undefined : "off",
          }}
        />
      </header>

      <FilterBar
        filters={[
          {
            name: "creator",
            allLabel: "All creators",
            options: allCreators.map((creator) => ({
              value: creator.id,
              label: creator.name,
            })),
          },
          {
            name: "kind",
            allLabel: "Creators and brand",
            options: [
              { value: "creator", label: "Creators only" },
              { value: "owned", label: "Brand account only" },
            ],
          },
          {
            name: "mode",
            allLabel: "All account types",
            options: [
              { value: "dedicated", label: "Dedicated" },
              { value: "mixed", label: "Mixed" },
              { value: "personal", label: "Personal" },
            ],
          },
        ]}
      >
        {(creatorFilter || modeFilter || kindFilter) && (
          <Link
            className="admin-button"
            data-variant="ghost"
            data-size="sm"
            href={link({ creator: undefined, mode: undefined, kind: undefined })}
          >
            Clear filters
          </Link>
        )}
      </FilterBar>

      <MetricTiles
        active={chartMetric}
        hrefFor={(next) => link({ metric: next })}
        tiles={[
          {
            key: "views",
            value: formatCount(totals.viewsGained),
            hint: previousTotals
              ? `${formatCount(previousTotals.viewsGained)} before`
              : undefined,
          },
          { key: "likes", value: formatCount(totals.likesGained) },
          { key: "comments", value: formatCount(totals.commentsGained) },
          { key: "shares", value: formatCount(totals.sharesGained) },
          {
            key: "saves",
            value: formatCount(totals.totalSaves),
            hint: "lifetime",
            chartable: false,
          },
          {
            key: "videos",
            value: formatExact(totals.videosPosted),
            hint: "Memo AI posts",
          },
          {
            key: "engagement",
            value: formatPercent(totals.engagementRate),
            hint: "per view",
            chartable: false,
          },
          {
            key: "revenue",
            value: totalRevenue === null ? "—" : formatMoney(totalRevenue),
            hint:
              viewValue.revenuePerMille === null
                ? "needs more data"
                : `${formatMoney(
                    Math.round(viewValue.revenuePerMille),
                  )} per 1K tracked views`,
            chartable: false,
          },
        ]}
      />

      <div className="admin-chart-bar-row">
        <nav className="admin-range">
          <Link
            className="admin-range-item"
            data-active={!cumulative}
            href={link({ view: undefined })}
            prefetch={false}
          >
            Daily
          </Link>
          <Link
            className="admin-range-item"
            data-active={cumulative}
            href={link({ view: "cumulative" })}
            prefetch={false}
          >
            Cumulative
          </Link>
        </nav>

        {range.previous && (
          <Link
            className="admin-button"
            data-variant={compare ? "default" : "ghost"}
            data-size="sm"
            href={link({ compare: compare ? "off" : undefined })}
            prefetch={false}
          >
            {compare ? "Hide previous period" : "Compare previous period"}
          </Link>
        )}

        <span className="admin-toolbar-spacer" />

        <span className="admin-legend">
          <span className="admin-legend-swatch" />
          {METRIC_LABELS[chartMetric]}
        </span>
        {secondary && (
          <span className="admin-legend">
            <span className="admin-legend-swatch" data-variant="compare" />
            Previous period
          </span>
        )}
      </div>

      <div className="admin-chart-wrap">
        {hasData ? (
          <AreaChart
            points={primary}
            comparison={secondary}
            label={METRIC_LABELS[chartMetric].toLowerCase()}
            formatter={chartMetric === "videos" ? formatExact : formatCount}
          />
        ) : (
          <EmptyState title="No history for this view">
            Run a sync to pull each creator&apos;s posts, or widen the range.
          </EmptyState>
        )}
      </div>

      <Section
        title="Per creator"
        hint="Sorted by views generated in this period."
        actions={
          <Disclosure label="Add creator">
            <AddCreatorForm />
          </Disclosure>
        }
      >
        {sorted.length === 0 ? (
          <EmptyState title="No creators match this view">
            Clear the filters, or use “Add creator” to paste in their TikTok links.
          </EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th>Accounts</th>
                  <th className="admin-num">Views</th>
                  <th className="admin-num">Videos</th>
                  <th className="admin-num">Avg / video</th>
                  <th className="admin-num">Engagement</th>
                  <th className="admin-num">Followers</th>
                  <th className="admin-num">Codes used</th>
                  <th className="admin-num">Est. revenue</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((creator) => {
                  const entry = metrics.get(creator.id);
                  const views = entry?.viewsGained ?? 0;
                  const videos = entry?.videosPosted ?? 0;
                  const codes = codeUsage?.get(creator.id);
                  const estimated = estimateRevenue(views, viewValue);

                  return (
                    <tr key={creator.id}>
                      <td>
                        <Link
                          href={`/admin/creators/${creator.id}`}
                          className="admin-creator-cell"
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <Avatar
                            src={creator.accounts[0]?.avatar_url}
                            name={creator.name}
                          />
                          <span style={{ minWidth: 0 }}>
                            <span className="admin-creator-name">{creator.name}</span>
                            {creator.kind === "owned" && (
                              <>
                                {" "}
                                <Badge tone="blue">brand</Badge>
                              </>
                            )}
                            {creator.status !== "active" && (
                              <>
                                {" "}
                                <Badge tone="grey">{creator.status}</Badge>
                              </>
                            )}
                            <br />
                            <span className="admin-creator-handle">
                              {creator.promo_codes.length > 0
                                ? creator.promo_codes.join(", ")
                                : "no promo code"}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="admin-handle-list">
                          {creator.accounts.map((account) => (
                            <Badge
                              key={account.id}
                              tone={
                                account.content_mode === "dedicated"
                                  ? "blue"
                                  : account.content_mode === "personal"
                                    ? "grey"
                                    : "green"
                              }
                            >
                              @{account.handle}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      <td className="admin-num">{formatCount(views)}</td>
                      <td className="admin-num">{formatExact(videos)}</td>
                      <td className="admin-num">
                        {videos > 0 ? formatCount(views / videos) : "—"}
                      </td>
                      <td className="admin-num">
                        {entry && entry.viewsGained > 0
                          ? formatPercent(entry.engagementRate)
                          : "—"}
                      </td>
                      <td className="admin-num">
                        {formatCount(entry?.followers ?? 0)}
                        {entry && entry.followersGained !== 0 && (
                          <>
                            {" "}
                            <span
                              className="admin-delta"
                              data-direction={
                                entry.followersGained > 0 ? "up" : "down"
                              }
                            >
                              {entry.followersGained > 0 ? "+" : ""}
                              {formatExact(entry.followersGained)}
                            </span>
                          </>
                        )}
                      </td>
                      <td
                        className="admin-num"
                        title={
                          codes
                            ? `${codes.redemptions} lifetime redemptions · ${codes.customers} paying customers in this period`
                            : undefined
                        }
                      >
                        {codes ? formatExact(codes.redemptions) : "—"}
                      </td>
                      <td className="admin-num">
                        {estimated === null ? "—" : formatMoney(estimated)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {reviewQueue.length > 0 && (
        <Section
          title={`${reviewQueue.length} video${
            reviewQueue.length === 1 ? "" : "s"
          } need a decision`}
          hint="These had a weak Memo AI signal, so they are not counted until you say."
        >
          <VideoReviewList videos={reviewQueue} />
        </Section>
      )}

      <SyncPanel syncRun={syncRun} />
    </>
  );
}
