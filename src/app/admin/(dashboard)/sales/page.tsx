import { BarChart } from "@/components/admin/chart";
import {
  Alert,
  BarRow,
  Card,
  EmptyState,
  formatExact,
  formatPercent,
  RangeTabs,
  StatCard,
} from "@/components/admin/ui";
import { normalizeRangePreset, resolveRange } from "@/lib/admin/ranges";
import {
  formatMoney,
  loadSalesData,
  promoCodeStats,
  revenueSeries,
  summarizeSales,
} from "@/lib/admin/sales";
import { listCreators } from "@/lib/admin/ugc";

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
    data = await loadSalesData({ historyDays: 400 });
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
  const creators = await listCreators({ includeArchived: true }).catch(() => []);

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
          meta={`${summary.trials.trialsEndingToday} × ${formatPercent(
            summary.trials.conversionRate,
          )} × ${formatMoney(
            Math.round(summary.trials.averageConvertedValue),
            summary.currency,
          )}`}
        />
      </div>

      <div className="admin-section">
        <Card
          title="Revenue per day"
          hint="Paid invoices only. Trial starts and 100%-off comps show as zero."
        >
          {series.some((point) => point.revenue > 0) ? (
            <BarChart
              points={series.map((point) => ({
                day: point.day,
                value: point.revenue,
                detail: `${point.newSubscriptions} new subs · ${point.trialsStarted} trials started`,
              }))}
              label="revenue"
              formatter={(value) => formatMoney(Math.round(value), summary.currency)}
            />
          ) : (
            <EmptyState title="No paid invoices in this window" />
          )}
        </Card>
      </div>

      <div className="admin-section admin-two-col">
        <Card
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
            <div className="admin-list-row">
              <span className="admin-list-label">Average converted value</span>
              <span className="admin-list-value">
                {formatMoney(
                  Math.round(summary.trials.averageConvertedValue),
                  summary.currency,
                )}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Projected from this window</span>
              <span className="admin-list-value">
                {formatMoney(
                  summary.trials.projectedRevenueInRange,
                  summary.currency,
                )}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Subscriptions">
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
        </Card>
      </div>

      <div className="admin-section">
        <Card
          title="Revenue by discount code"
          hint="Every paid invoice carrying a creator's code counts as revenue they drove."
          bodyless
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
        </Card>
      </div>

      {rankedCodes.length > 0 && (
        <div className="admin-section">
          <Card title="Top codes by payments">
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
          </Card>
        </div>
      )}
    </>
  );
}
