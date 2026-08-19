import Link from "next/link";

import { AreaChart } from "@/components/admin/chart";
import { AddCreatorForm } from "@/components/admin/creator-form";
import { Disclosure } from "@/components/admin/forms";
import { SyncPanel } from "@/components/admin/sync-panel";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  formatCount,
  formatExact,
  formatPercent,
  RangeTabs,
  StatCard,
} from "@/components/admin/ui";
import { VideoReviewList } from "@/components/admin/video-review";
import { normalizeRangePreset, resolveRange } from "@/lib/admin/ranges";
import {
  creatorRevenue,
  formatMoney,
  loadSalesData,
  promoCodeStats,
} from "@/lib/admin/sales";
import {
  getCreatorMetrics,
  getDailyDeltas,
  getEarliestDataDay,
  listCreators,
  listVideos,
  sumMetrics,
  toDailySeries,
} from "@/lib/admin/ugc";
import { getLatestSyncRun } from "@/lib/ugc/sync";

type SearchParams = Promise<{ range?: string }>;

export const dynamic = "force-dynamic";

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const preset = normalizeRangePreset(params?.range);
  const earliest = await getEarliestDataDay();
  const range = resolveRange(preset, { earliestDay: earliest });

  const creators = await listCreators();
  const [metrics, deltas, previousMetrics, reviewQueue, syncRun] = await Promise.all([
    getCreatorMetrics(creators, range),
    getDailyDeltas(range, { onlyMemo: true }),
    range.previous
      ? getCreatorMetrics(creators, range.previous)
      : Promise.resolve(null),
    listVideos({ classification: "unknown", limit: 25 }),
    getLatestSyncRun(),
  ]);

  const totals = sumMetrics(metrics);
  const previousTotals = previousMetrics ? sumMetrics(previousMetrics) : null;
  const series = toDailySeries(deltas, range);

  // Revenue attribution is a bonus panel: if Stripe is unreachable the rest of
  // the page must still render.
  const revenueByCreator = await loadSalesData({ historyDays: 400 })
    .then((data) => creatorRevenue(creators, promoCodeStats(data, range)))
    .catch(() => null);

  const sorted = [...creators].sort((a, b) => {
    const left = metrics.get(a.id)?.viewsGained ?? 0;
    const right = metrics.get(b.id)?.viewsGained ?? 0;
    return right - left;
  });

  const hasData = series.some((point) => point.views > 0);

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Creators</h1>
          <p className="admin-subtitle">
            {creators.length} creator{creators.length === 1 ? "" : "s"} ·{" "}
            {range.label.toLowerCase()}
          </p>
        </div>
        <RangeTabs active={preset} basePath="/admin/creators" />
      </header>

      <div className="admin-grid">
        <StatCard
          label="Views generated"
          value={formatCount(totals.viewsGained)}
          current={totals.viewsGained}
          previous={previousTotals?.viewsGained}
          meta={`${formatExact(totals.viewsGained)} exact`}
        />
        <StatCard
          label="Videos posted"
          value={formatExact(totals.videosPosted)}
          current={totals.videosPosted}
          previous={previousTotals?.videosPosted}
          meta="Memo AI posts only"
        />
        <StatCard
          label="Engagement"
          value={formatPercent(totals.engagementRate)}
          meta={`${formatCount(
            totals.likesGained + totals.commentsGained + totals.sharesGained,
          )} interactions`}
        />
        <StatCard
          label="Combined reach"
          value={formatCount(totals.totalFollowers)}
          meta={`${totals.activeCreators} creator${
            totals.activeCreators === 1 ? "" : "s"
          } active this period`}
        />
      </div>

      <div className="admin-section">
        <Card
          title="Views per day"
          hint="Counts views gained on each day, not the lifetime total of videos posted that day."
        >
          {hasData ? (
            <AreaChart
              points={series.map((point) => ({
                day: point.day,
                value: point.views,
                detail: `${point.videosPosted} posted · ${formatCount(point.likes)} likes`,
              }))}
              label="views"
            />
          ) : (
            <EmptyState title="No view history yet">
              Run a sync to pull each creator&apos;s posts and start building the
              daily history.
            </EmptyState>
          )}
        </Card>
      </div>

      <div className="admin-section">
        <SyncPanel syncRun={syncRun} />
      </div>

      <div className="admin-section">
        <Card
          title="Per creator"
          hint="Sorted by views generated in this period."
          bodyless
          actions={
            <Disclosure label="Add creator">
              <AddCreatorForm />
            </Disclosure>
          }
        >
          {sorted.length === 0 ? (
            <EmptyState title="No creators yet">
              Use “Add creator” to paste in their TikTok links.
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
                    <th className="admin-num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((creator) => {
                    const entry = metrics.get(creator.id);
                    const views = entry?.viewsGained ?? 0;
                    const videos = entry?.videosPosted ?? 0;
                    const revenue = revenueByCreator?.get(creator.id);
                    const primary = creator.accounts[0];

                    return (
                      <tr key={creator.id}>
                        <td>
                          <Link
                            href={`/admin/creators/${creator.id}`}
                            className="admin-creator-cell"
                            style={{ textDecoration: "none", color: "inherit" }}
                          >
                            <Avatar src={primary?.avatar_url} name={creator.name} />
                            <span style={{ minWidth: 0 }}>
                              <span className="admin-creator-name">
                                {creator.name}
                              </span>
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
                        <td className="admin-num">
                          {revenue && revenue.revenue > 0
                            ? formatMoney(revenue.revenue)
                            : revenueByCreator
                              ? "—"
                              : "n/a"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {reviewQueue.length > 0 && (
        <div className="admin-section">
          <Card
            title={`${reviewQueue.length} video${
              reviewQueue.length === 1 ? "" : "s"
            } need a decision`}
            hint="These had a weak Memo AI signal, so they are not counted until you say."
            bodyless
          >
            <VideoReviewList videos={reviewQueue} />
          </Card>
        </div>
      )}
    </>
  );
}
