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
import {
  computeCost,
  describePayTerms,
  payTermsFor,
} from "@/lib/admin/creator-economics";
import {
  formatDayLabel,
  monthsCovered,
  normalizeRangePreset,
  resolveRange,
} from "@/lib/admin/ranges";
import {
  creatorRevenue,
  formatMoney,
  getRevenueBetween,
  loadSalesData,
  projectionAtDayStart,
  promoCodeStats,
  revenueSeries,
  summarizeSales,
  trialForecast,
} from "@/lib/admin/sales";
import {
  getBaselineCampaignViews,
  getCreatorMetrics,
  listCreators,
} from "@/lib/admin/ugc";

type SearchParams = Promise<{ range?: string }>;

export const dynamic = "force-dynamic";

export default async function FinancePage({
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
          <h1 className="admin-title">Finance</h1>
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

  // The projection is a per-day figure, frozen at that day's start, so it only
  // exists for the two single-day windows: Today shows what this morning
  // expected of today, Yesterday reproduces yesterday morning's answer. A
  // multi-day window gets no projected tile — averaging frozen mornings across
  // a week answers no question anyone is asking.
  const dayProjection =
    preset === "today" || preset === "yesterday"
      ? projectionAtDayStart(data, range.from)
      : null;
  const codes = promoCodeStats(data, range);
  const forecast = trialForecast(data, { days: 14 });
  const allCreators = await listCreators({ includeArchived: true }).catch(
    () => [],
  );

  // Archived creators keep their place in the code-ownership map (their old
  // payments still carry their code) but are not billed for the window: a
  // monthly retainer on an archived creator is not owed anything.
  const activeCreators = allCreators.filter(
    (creator) => creator.status !== "archived",
  );

  const metrics = await getCreatorMetrics(activeCreators, range).catch(
    () => null,
  );
  const codeUsage = creatorRevenue(activeCreators, codes, data.codeRedemptions);
  const monthFraction = monthsCovered(range.days);

  const costFor = (creator: (typeof activeCreators)[number]) => {
    const entry = metrics?.get(creator.id);

    return computeCost(payTermsFor(creator), {
      videos: entry?.videosPosted ?? 0,
      views: entry?.viewsGained ?? 0,
      codeRevenue: codeUsage.get(creator.id)?.revenue ?? 0,
      monthFraction,
    });
  };

  const totalCost = activeCreators.reduce(
    (sum, creator) => sum + costFor(creator).total,
    0,
  );
  const totalBase = activeCreators.reduce(
    (sum, creator) => sum + costFor(creator).basePay,
    0,
  );
  const totalBonus = activeCreators.reduce(
    (sum, creator) => sum + costFor(creator).codeBonus,
    0,
  );
  const totalCodeRevenue = activeCreators.reduce(
    (sum, creator) => sum + (codeUsage.get(creator.id)?.revenue ?? 0),
    0,
  );

  // Margin is struck against everything Stripe actually took in this window,
  // not just the payments that carried a code: creator cost is the business's
  // whole acquisition spend, so it is held against the whole revenue it exists
  // to produce.
  const margin = summary.revenue - totalCost;
  const marginRate = summary.revenue > 0 ? margin / summary.revenue : null;

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

  for (const creator of allCreators) {
    for (const code of creator.promo_codes) {
      ownerByCode.set(code.toUpperCase(), creator.name);
    }
  }

  const rankedCodes = Array.from(codes.values())
    .filter((entry) => entry.revenue > 0 || entry.payments > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const maxCodeRevenue = rankedCodes[0]?.revenue ?? 0;

  // The payout run: every paid creator with anything owed or any code activity
  // in the window, biggest obligation first.
  const payoutRows = activeCreators
    .filter((creator) => creator.kind === "creator")
    .map((creator) => ({
      creator,
      cost: costFor(creator),
      codes: codeUsage.get(creator.id),
    }))
    .filter(
      (row) => row.cost.total > 0 || (row.codes?.payments ?? 0) > 0,
    )
    .sort((a, b) => b.cost.total - a.cost.total);

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Finance</h1>
          <p className="admin-subtitle">Live from Stripe · {range.label.toLowerCase()}</p>
        </div>
        <RangeTabs active={preset} basePath="/admin/finance" />
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
          meta={`${summary.trials.trialsDueToday} due to convert today`}
        />
        {dayProjection && (
          <StatCard
            label={
              preset === "today" ? "Projected today" : "Projected yesterday"
            }
            value={formatMoney(dayProjection.projectedRevenue, summary.currency)}
            meta={`${dayProjection.trialsDue} trial${
              dayProjection.trialsDue === 1 ? "" : "s"
            } due to convert · frozen at the start of the day`}
          />
        )}
      </div>

      <div className="admin-grid">
        <StatCard
          label="Creator cost"
          value={formatMoney(totalCost, summary.currency)}
          meta={`${formatMoney(totalBase, summary.currency)} base + ${formatMoney(
            totalBonus,
            summary.currency,
          )} bonus`}
        />
        {/* The rate leads and the money follows: 89% says how healthy the
            window was at a glance, which is what a margin tile is for. */}
        <StatCard
          label="Margin"
          value={
            marginRate === null ? "—" : formatPercent(marginRate, 0)
          }
          meta={
            marginRate === null
              ? "no revenue in this window"
              : `${formatMoney(
                  margin,
                  summary.currency,
                )} of revenue left after creator costs`
          }
        />
        <StatCard
          label="Code revenue"
          value={formatMoney(totalCodeRevenue, summary.currency)}
          meta={
            summary.revenue > 0
              ? `taken via creator codes · ${formatPercent(
                  totalCodeRevenue / summary.revenue,
                  0,
                )} of revenue`
              : "taken via creator codes"
          }
        />
        <StatCard
          label="Est. campaign revenue"
          value={
            metrics === null
              ? "n/a"
              : (() => {
                  const views = Array.from(metrics.values()).reduce(
                    (sum, entry) => sum + entry.viewsGained,
                    0,
                  );
                  const estimated = estimateRevenue(views, viewValue);

                  return estimated === null
                    ? "n/a"
                    : formatMoney(estimated, summary.currency);
                })()
          }
          meta={
            viewValue.revenuePerMille === null
              ? "needs more campaign data"
              : `views × ${formatMoney(
                  Math.round(viewValue.revenuePerMille),
                  summary.currency,
                )} per 1K views · an estimate, not money received`
          }
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
        title="Creator payouts"
        hint="Base pay plus code bonus for the selected period, on each creator's own terms. Payouts run monthly, so select This month before paying anyone."
      >
        {payoutRows.length === 0 ? (
          <EmptyState title="Nothing owed and no code activity in this window" />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th
                    className="admin-num"
                    title="Paid checkouts using this creator's codes, within the selected period."
                  >
                    Codes used
                  </th>
                  <th
                    className="admin-num"
                    title="Money actually taken through this creator's codes in this period, from Stripe."
                  >
                    Code revenue
                  </th>
                  <th
                    className="admin-num"
                    title="Flat fee for the posts in this period."
                  >
                    Base pay
                  </th>
                  <th
                    className="admin-num"
                    title="Their share of what their own code sold in this period."
                  >
                    Code bonus
                  </th>
                  <th className="admin-num">
                    Owed · {range.label.toLowerCase()}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.map(({ creator, cost, codes: usage }) => (
                  <tr key={creator.id}>
                    <td title={describePayTerms(payTermsFor(creator), (minor) =>
                      formatMoney(minor, summary.currency),
                    )}>
                      <span className="admin-creator-name">{creator.name}</span>
                      <br />
                      <span className="admin-creator-handle">
                        {creator.promo_codes.length > 0
                          ? creator.promo_codes.join(", ")
                          : "no promo code"}
                      </span>
                    </td>
                    <td className="admin-num">
                      {usage ? formatExact(usage.payments) : "—"}
                    </td>
                    <td className="admin-num">
                      {usage
                        ? formatMoney(usage.revenue, summary.currency)
                        : "—"}
                    </td>
                    <td className="admin-num">
                      {cost.basePay > 0
                        ? formatMoney(cost.basePay, summary.currency)
                        : "—"}
                    </td>
                    <td className="admin-num">
                      {cost.codeBonus > 0
                        ? formatMoney(cost.codeBonus, summary.currency)
                        : "—"}
                    </td>
                    <td className="admin-num">
                      <strong>{formatMoney(cost.total, summary.currency)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td />
                  <td className="admin-num">
                    <strong>{formatMoney(totalCodeRevenue, summary.currency)}</strong>
                  </td>
                  <td className="admin-num">
                    <strong>{formatMoney(totalBase, summary.currency)}</strong>
                  </td>
                  <td className="admin-num">
                    <strong>{formatMoney(totalBonus, summary.currency)}</strong>
                  </td>
                  <td className="admin-num">
                    <strong>{formatMoney(totalCost, summary.currency)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Projected revenue from trials"
        hint="Every trial still set to convert is valued at its own subscription price multiplied by the conversion rate measured for its own plan, then summed. Trials whose user already requested cancellation are left out, and a yearly trial and a monthly trial are never averaged together."
      >
        {forecast.days.some((day) => day.trialsDue > 0) ? (
          <>
            <BarChart
              points={forecast.days.map((day) => ({
                day: day.day,
                value: day.projectedRevenue,
                rows: [
                  { label: "Due to convert", value: formatExact(day.trialsDue) },
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
                    <th className="admin-num">Due to convert</th>
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
                            (sum, day) => sum + day.trialsDue,
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
          <EmptyState title="No trials are due to convert in the next 14 days" />
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
              <span className="admin-list-label">Due to convert today</span>
              <span className="admin-list-value">
                {formatExact(summary.trials.trialsDueToday)}
              </span>
            </div>
            <div className="admin-list-row">
              <span className="admin-list-label">Due to convert in this window</span>
              <span className="admin-list-value">
                {formatExact(summary.trials.trialsDueInRange)}
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
