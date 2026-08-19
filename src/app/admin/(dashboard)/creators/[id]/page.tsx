import Link from "next/link";
import { notFound } from "next/navigation";

import {
  refreshAccountAction,
  removeAccountAction,
  updateAccountAction,
} from "@/app/admin/(dashboard)/actions";
import { AreaChart } from "@/components/admin/chart";
import { AddAccountForm, EditCreatorForm } from "@/components/admin/creator-form";
import { ActionForm, Disclosure, InlineAction, SubmitButton } from "@/components/admin/forms";
import {
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
import { VideoReviewList } from "@/components/admin/video-review";
import {
  computeEconomics,
  describePayModel,
  payModelFor,
} from "@/lib/admin/creator-economics";
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
  getCreator,
  getCreatorMetrics,
  getDailyDeltas,
  getEarliestDataDay,
  listVideos,
  toDailySeries,
} from "@/lib/admin/ugc";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ range?: string }>;

export const dynamic = "force-dynamic";

export default async function CreatorDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const { id } = await params;
  const search = await searchParams;
  const preset = normalizeRangePreset(search?.range);
  const earliest = await getEarliestDataDay();
  const range = resolveRange(preset, { earliestDay: earliest });

  const creator = await getCreator(id);

  if (!creator) {
    notFound();
  }

  const [metrics, deltas, videos] = await Promise.all([
    getCreatorMetrics([creator], range),
    getDailyDeltas(range, { creatorId: id, onlyMemo: true }),
    // Scoped to the selected range: listing every post while the tiles above
    // were windowed made the two disagree and looked like a bug.
    listVideos({ creatorId: id, limit: 200, range }),
  ]);

  const entry = metrics.get(creator.id);
  const series = toDailySeries(deltas, range);

  const codes = await loadSalesData({ historyDays: 400 })
    .then((data) =>
      creatorRevenue([creator], promoCodeStats(data, range), data.codeRedemptions).get(
        creator.id,
      ),
    )
    .catch(() => null);

  const baseline = await getBaselineCampaignViews(VALUE_BASELINE_DAYS);
  const baselineRevenue = await getRevenueBetween(baseline.from, baseline.to).catch(
    () => 0,
  );
  const viewValue = computeViewValue({
    revenue: baselineRevenue,
    views: baseline.views,
    days: VALUE_BASELINE_DAYS,
  });
  const estimated = estimateRevenue(entry?.viewsGained ?? 0, viewValue);

  const economics = computeEconomics(payModelFor(creator), {
    videos: entry?.videosPosted ?? 0,
    views: entry?.viewsGained ?? 0,
    codeRevenue: codes?.revenue ?? 0,
    revenue: estimated,
  });

  const memoVideos = videos.filter((video) => video.classification === "memo");
  const otherVideos = videos.filter((video) => video.classification !== "memo");

  return (
    <>
      <header className="admin-header">
        <div>
          <p className="admin-subtitle" style={{ marginBottom: "0.25rem" }}>
            <Link className="admin-link" href="/admin/creators">
              ← All creators
            </Link>
          </p>
          <h1 className="admin-title">{creator.name}</h1>
          <p className="admin-subtitle">
            {creator.accounts.length} account
            {creator.accounts.length === 1 ? "" : "s"}
            {creator.promo_codes.length > 0 && ` · ${creator.promo_codes.join(", ")}`}
          </p>
        </div>
        <RangeTabs active={preset} basePath={`/admin/creators/${creator.id}`} />
      </header>

      <div className="admin-grid">
        <StatCard
          label="Views generated"
          value={formatCount(entry?.viewsGained ?? 0)}
          meta={`${formatExact(entry?.viewsGained ?? 0)} exact`}
        />
        <StatCard
          label="Videos posted"
          value={formatExact(entry?.videosPosted ?? 0)}
          meta={`${entry?.totalVideos ?? 0} Memo AI posts all time`}
        />
        <StatCard
          label="Engagement"
          value={
            entry && entry.viewsGained > 0 ? formatPercent(entry.engagementRate) : "—"
          }
          meta={`${formatCount(entry?.likesGained ?? 0)} likes · ${formatCount(
            entry?.commentsGained ?? 0,
          )} comments`}
        />
        <StatCard
          label="Est. revenue"
          value={estimated === null ? "—" : formatMoney(estimated)}
          meta={
            viewValue.revenuePerMille === null
              ? "Not enough campaign data yet"
              : `Their views at ${formatMoney(
                  Math.round(viewValue.revenuePerMille),
                )} per 1K campaign views`
          }
        />
        <StatCard
          label="Codes used"
          value={codes ? formatExact(codes.payments) : "—"}
          meta={
            codes
              ? `Paid checkouts this period via ${
                  creator.promo_codes.join(", ") || "no code"
                } · ${codes.redemptions} all time`
              : "Stripe unavailable"
          }
        />
        <StatCard
          label="Cost"
          value={
            economics.model.kind === "unpaid" ? "—" : formatMoney(economics.cost)
          }
          meta={describePayModel(economics.model, (minor) => formatMoney(minor))}
        />
        <StatCard
          label="Margin"
          value={
            economics.margin === null ? "—" : formatMoney(economics.margin)
          }
          meta={
            economics.marginRate === null
              ? "Needs a measurable campaign rate"
              : `${formatPercent(economics.marginRate, 0)} of their estimated revenue${
                  economics.returnOnSpend === null
                    ? ""
                    : ` · ${economics.returnOnSpend.toFixed(1)}× on spend`
                }`
          }
        />
      </div>

      <Section title="Views per day" hint="Views gained each day across this creator's Memo AI posts.">
        {series.some((point) => point.views > 0) ? (
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
        ) : (
          <EmptyState title="No view history for this window" />
        )}
      </Section>

      <div className="admin-section admin-two-col">
        <Section
          title="Accounts"
          hint="A dedicated account counts everything; a mixed one is checked post by post."
        >
          {creator.accounts.map((account) => (
            <div
              key={account.id}
              style={{
                paddingBottom: "1rem",
                marginBottom: "1rem",
                borderBottom: "1px solid var(--separator)",
              }}
            >
              <div className="admin-creator-cell" style={{ marginBottom: "0.75rem" }}>
                <Avatar src={account.avatar_url} name={account.handle} />
                <div style={{ minWidth: 0 }}>
                  <a
                    className="admin-link"
                    href={account.profile_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    @{account.handle}
                  </a>
                  <div className="admin-creator-handle">
                    {formatCount(account.follower_count ?? 0)} followers ·{" "}
                    {formatCount(account.total_likes ?? 0)} likes ·{" "}
                    {account.video_count ?? 0} posts
                  </div>
                  <div className="admin-creator-handle">
                    Synced {formatRelative(account.last_synced_at)}
                    {account.last_sync_status === "error" && (
                      <>
                        {" "}
                        <Badge tone="red">sync issue</Badge>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <ActionForm action={updateAccountAction} hideMessage>
                <input type="hidden" name="account_id" value={account.id} />
                <input type="hidden" name="creator_id" value={creator.id} />
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <select
                    name="content_mode"
                    className="admin-select"
                    defaultValue={account.content_mode}
                    style={{ width: "auto", flex: "1 1 12rem" }}
                    aria-label={`Content mode for @${account.handle}`}
                  >
                    <option value="mixed">Mixed</option>
                    <option value="dedicated">Dedicated</option>
                    <option value="personal">Personal</option>
                  </select>
                  <select
                    name="status"
                    className="admin-select"
                    defaultValue={account.status}
                    style={{ width: "auto", flex: "0 1 8rem" }}
                    aria-label={`Status for @${account.handle}`}
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                  <SubmitButton variant="default" size="sm" pendingLabel="Saving…">
                    Save
                  </SubmitButton>
                </div>
              </ActionForm>

              <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.5rem" }}>
                <InlineAction
                  action={refreshAccountAction}
                  fields={{ account_id: account.id, creator_id: creator.id }}
                  title="Re-read followers from the public profile page"
                >
                  Refresh followers
                </InlineAction>
                <InlineAction
                  action={removeAccountAction}
                  fields={{ account_id: account.id, creator_id: creator.id }}
                  variant="danger"
                  confirm={`Remove @${account.handle}? Its videos and view history are deleted too.`}
                >
                  Remove
                </InlineAction>
              </div>
            </div>
          ))}

          <Disclosure label="Add another account">
            <AddAccountForm creatorId={creator.id} />
          </Disclosure>
        </Section>

        <Section title="Details">
          <EditCreatorForm creator={creator} />
        </Section>
      </div>

      <Section
        title={`Memo AI posts (${memoVideos.length})`}
        hint="Everything counted toward this creator's campaign numbers."
      >
        {memoVideos.length === 0 ? (
          <EmptyState title="No Memo AI posts detected yet">
            Run a sync, or mark a post below as Memo AI by hand.
          </EmptyState>
        ) : (
          <VideoReviewList videos={memoVideos} showCreator={false} />
        )}
      </Section>

      {otherVideos.length > 0 && (
        <Section
          title={`Not counted (${otherVideos.length})`}
          hint="Personal posts and anything still unclear. Reclassify any row to move it."
        >
          <VideoReviewList videos={otherVideos} showCreator={false} />
        </Section>
      )}
    </>
  );
}
