import { BarChart } from "@/components/admin/chart";
import {
  Alert,
  BarRow,
  Section,
  EmptyState,
  formatExact,
  formatPercent,
  RangeTabs,
  StatCard,
} from "@/components/admin/ui";
import {
  computeViewValue,
  estimateRevenue,
  VALUE_BASELINE_DAYS,
  viewsForRevenue,
} from "@/lib/admin/campaign-value";
import { formatDayLabel, normalizeRangePreset, resolveRange } from "@/lib/admin/ranges";
import {
  formatMoney,
  getRevenueBetween,
  loadSalesData,
  promoCodeStats,
  revenueSeries,
  summarizeSales,
  trialForecast,
} from "@/lib/admin/sales";
import { getBaselineCampaignViews, listCreators } from "@/lib/admin/ugc";

type SearchParams = Promise<{ range?: string }>;

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const preset = normalizeRangePreset(params?.range);
  const range = resolveRange(preset);

  let data;

  try {
    data = await loadSalesData();
  } catch (error) {
    return (
      <>
        <header className="admin-header">
          <h1 className="admin-title">Sales</h1>
        </header>
        <Alert tone="error">
          Could not reach Stripe:{" "}
          {error instanceof Error ? error.message : "unknown error"}. Check that
          STRIPE_SECRET_KEY is set for this environment.
        </Alert>
      </>
    );
  }

  const summary = summarizeSales(data, range);
  const series = revenueSeries(data, range);
  const codes = promoCodeStats(data, range);
  const forecast = trialForecast(data, { days: 14 });
  const creators = await listCreators({ includeArchived: true }).catch(() => []);

  const baseline = await getBaselineCampaignViews(VALUE_BASELINE_DAYS).catch(() => ({
    views: 0,
    from: range.from,
    to: range.to,
  }));
  const baselineRevenue = await getRevenueBetween(baseline.from, baseline.to).catch(
    () => 0,
  );
  const viewValue = computeViewValue({
    revenue: baselineRevenue,
    views: baseline.views,
    days: VALUE_BASELINE_DAYS,
  });

  // Map each promo code back to the creator who owns it, so the table reads as
  // "who drove this revenue" rather than a list of bare codes.
  const ownerByCode = new Map<string, string>();

  for (const creator of creators) {
    for (const code of creator.promo_codes) {
      ownerByCode.set(code.toUpperCase(), creator.name);
    }
  }

  const rankedCodes = Array.from(codes.values())
    .filter((entry) => entry.revenue > 0 || entry.payments > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const maxCodeRevenue = rankedCodes[0]?.revenue ?? 0;

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Sales</h1>
          <p className="admin-subtitle">Live from Stripe · {range.label.toLowerCase()}</p>
        </div>
        <RangeTabs active={preset} basePath="/admin/sales" />
      </header>

      {summary.truncated && (
        <Alert tone="info">
          Stripe returned more records than a single dashboard load reads, so
          these totals are based on the most recent pages only.
        </Alert>
      )}

      <div className="admin-grid">
        <StatCard
          label="Revenue"
          value={formatMoney(summary.revenue, summary.currency)}
          current={summary.revenue}
          previous={range.previous ? summary.previousRevenue : undefined}
          meta="Paid invoices, net of discounts"
        />
        <StatCard
          label="MRR"
          value={formatMoney(Math.round(summary.mrr), summary.currency)}
          meta={`${summary.payingSubscriptions} paying subscription${
            summary.payingSubscriptions === 1 ? "" : "s"
          }`}
        />
        <StatCard
          label="Active trials"
          value={formatExact(summary.trials.activeTrials)}
          meta={`${summary.trials.trialsEndingToday} converting today`}
        />
        <StatCard
          label="Projected today"
          value={formatMoney(summary.trials.projectedRevenueToday, summary.currency)}
          meta={`${summary.trials.trialsEndingToday} trial${
            summary.trials.trialsEndingToday === 1 ? "" : "s"
          } ending, each at its own plan price × that plan's conversion rate`}
        />
      </div>

      <Section
        title="Revenue per day"
        hint="Paid invoices only. Trial starts and 100%-off comps show as zero."
      >
        {series.some((point) => point.revenue > 0) ? (
          <BarChart
            points={series.map((point) => ({
              day: point.day,
              value: point.revenue,
              rows: [
                { label: "New subscriptions", value: formatExact(point.newSubscriptions) },
                { label: "Trials started", value: formatExact(point.trialsStarted) },
              ],
            }))}
            label="revenue"
            formatter={(value) => formatMoney(Math.round(value), summary.currency)}
          />
        ) : (
          <EmptyState title="No paid invoices in this window" />
        )}
      </Section>

      <Section
        title="What a view is worth"
        hint={`Campaign revenue over the last ${VALUE_BASELINE_DAYS} days divided by the campaign views over the same days. This is what the creator revenue figures are built on, and it sharpens on its own as more days accumulate.`}
      >
        {viewValue.revenuePerMille === null ? (
          <EmptyState title="Not enough campaign data yet">
            The rate needs both revenue and a meaningful number of tracked views
            before it means anything.
          </EmptyState>
        ) : (
          <div className="admin-list">
            <div className="admin-list-row">
              <span className="admin-list-label">Revenue per 1,000 views</span>
              <span className="admin-list-value">
                {formatMoney(Math.round(viewValue.revenuePerMille), summary.currency)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Measured over</span>
              <span className="admin-list-value">
                {formatMoney(viewValue.revenue, summary.currency)} from{" "}
                {formatExact(viewValue.views)} views · {viewValue.days} days
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">10,000 views is worth about</span>
              <span className="admin-list-value">
                {formatMoney(
                  estimateRevenue(10_000, viewValue) ?? 0,
                  summary.currency,
                )}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Views needed for €1,000</span>
              <span className="admin-list-value">
                {formatExact(viewsForRevenue(100_000, viewValue) ?? 0)}
              </span>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Projected revenue from trials"
        hint="Every trial due to end is valued at its own subscription price multiplied by the conversion rate measured for its own plan, then summed. A yearly trial and a monthly trial are worth very different amounts and do not convert alike, so they are never averaged together."
      >
        {forecast.days.some((day) => day.trialsEnding > 0) ? (
          <>
            <BarChart
              points={forecast.days.map((day) => ({
                day: day.day,
                value: day.projectedRevenue,
                rows: [
                  { label: "Trials ending", value: formatExact(day.trialsEnding) },
                ],
              }))}
              label="projected"
              formatter={(value) =>
                formatMoney(Math.round(value), summary.currency)
              }
            />
            <div className="admin-table-wrap" style={{ marginTop: "1rem" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th className="admin-num">Trials ending</th>
                    <th className="admin-num">Price</th>
                    <th className="admin-num">Converts at</th>
                    <th className="admin-num">Projected</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.planBreakdown.map((row) => (
                    <tr key={row.plan}>
                      <td>{row.plan}</td>
                      <td className="admin-num">{formatExact(row.trials)}</td>
                      <td className="admin-num">
                        {formatMoney(row.unitAmount, summary.currency)}
                      </td>
                      <td className="admin-num">{formatPercent(row.rate)}</td>
                      <td className="admin-num">
                        {formatMoney(row.projected, summary.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>
                      <strong>Next 14 days</strong>
                    </td>
                    <td className="admin-num">
                      <strong>
                        {formatExact(
                          forecast.days.reduce(
                            (sum, day) => sum + day.trialsEnding,
                            0,
                          ),
                        )}
                      </strong>
                    </td>
                    <td />
                    <td />
                    <td className="admin-num">
                      <strong>
                        {formatMoney(
                          forecast.days.reduce(
                            (sum, day) => sum + day.projectedRevenue,
                            0,
                          ),
                          summary.currency,
                        )}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="No trials are due to end in the next 14 days" />
        )}
      </Section>

      <div className="admin-section admin-two-col">
        <Section
          title="Trial pipeline"
          hint="The conversion rate is measured over trials that have already ended."
        >
          <div className="admin-list">
            <div className="admin-list-row">
              <span className="admin-list-label">Active trials right now</span>
              <span className="admin-list-value">
                {formatExact(summary.trials.activeTrials)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Ending today</span>
              <span className="admin-list-value">
                {formatExact(summary.trials.trialsEndingToday)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Ending in this window</span>
              <span className="admin-list-value">
                {formatExact(summary.trials.trialsEndingInRange)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Trial conversion rate</span>
              <span className="admin-list-value">
                {formatPercent(summary.trials.conversionRate)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Measured over</span>
              <span className="admin-list-value">
                {formatExact(summary.trials.conversionSampleSize)} finished trials
              </span>
            </div>
            {Array.from(summary.trials.ratesByPlan.byPlan.entries()).map(
              ([plan, entry]) => (
                <div className="admin-list-row" key={plan}>
                  <span className="admin-list-label">
                    {plan} conversion rate
                  </span>
                  <span className="admin-list-value">
                    {formatPercent(entry.rate)} over {entry.sample} trials
                  </span>
                </div>
              ),
            )}
            <div className="admin-list-row">
              <span className="admin-list-label">
                Projected from this window
                {summary.trials.projectedFrom !== range.to && (
                  <>
                    {" "}
                    <span className="admin-help">
                      · forecast on {formatDayLabel(summary.trials.projectedFrom)},
                      before the window opened
                    </span>
                  </>
                )}
              </span>
              <span className="admin-list-value">
                {formatMoney(
                  summary.trials.projectedRevenueInRange,
                  summary.currency,
                )}
              </span>
            </div>
          </div>
        </Section>

        <Section title="Subscriptions">
          <div className="admin-list">
            <div className="admin-list-row">
              <span className="admin-list-label">Live subscriptions</span>
              <span className="admin-list-value">
                {formatExact(summary.activeSubscriptions)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Paying (not on trial)</span>
              <span className="admin-list-value">
                {formatExact(summary.payingSubscriptions)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Started in this window</span>
              <span className="admin-list-value">
                {formatExact(summary.newSubscriptionsInRange)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Cancelled in this window</span>
              <span className="admin-list-value">
                {formatExact(summary.canceledInRange)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Committed MRR</span>
              <span className="admin-list-value">
                {formatMoney(Math.round(summary.mrr), summary.currency)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Annualised</span>
              <span className="admin-list-value">
                {formatMoney(Math.round(summary.mrr * 12), summary.currency)}
              </span>
            </div>
          </div>
        </Section>
      </div>

      <Section
        title="Revenue by discount code"
        hint="Every paid invoice carrying a creator's code counts as revenue they drove."
      >
        {rankedCodes.length === 0 ? (
          <EmptyState title="No discounted payments in this window" />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Creator</th>
                  <th className="admin-num">Revenue</th>
                  <th className="admin-num">Payments</th>
                  <th className="admin-num">Customers</th>
                  <th style={{ width: "30%" }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {rankedCodes.map((entry) => (
                  <tr key={entry.code}>
                    <td className="admin-mono">{entry.code}</td>
                    <td>{ownerByCode.get(entry.code) ?? "—"}</td>
                    <td className="admin-num">
                      {formatMoney(entry.revenue, summary.currency)}
                    </td>
                    <td className="admin-num">{formatExact(entry.payments)}</td>
                    <td className="admin-num">{formatExact(entry.customers)}</td>
                    <td>
                      <span className="admin-bar-track">
                        <span
                          className="admin-bar-fill"
                          style={{
                            width: `${
                              maxCodeRevenue > 0
                                ? Math.max((entry.revenue / maxCodeRevenue) * 100, 2)
                                : 0
                            }%`,
                          }}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {rankedCodes.length > 0 && (
        <Section title="Top codes by payments">
          <div className="admin-list">
            {[...rankedCodes]
              .sort((a, b) => b.payments - a.payments)
              .slice(0, 8)
              .map((entry) => (
                <BarRow
                  key={entry.code}
                  label={`${entry.code}${
                    ownerByCode.has(entry.code)
                      ? ` · ${ownerByCode.get(entry.code)}`
                      : ""
                  }`}
                  value={entry.payments}
                  max={Math.max(...rankedCodes.map((row) => row.payments))}
                />
              ))}
          </div>
        </Section>
      )}
    </>
  );
}
