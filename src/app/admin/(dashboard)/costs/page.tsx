import { toggleFixedCostAction } from "@/app/admin/(dashboard)/actions";
import { FixedCostForm } from "@/components/admin/fixed-cost-form";
import { Disclosure, InlineAction } from "@/components/admin/forms";
import { PendingLink } from "@/components/admin/pending-link";
import {
  Alert,
  Badge,
  EmptyState,
  Section,
  StatCard,
} from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { loadRunningCosts } from "@/lib/admin/costs";
import { monthWindow, totalCosts, type CostKind } from "@/lib/admin/costs-math";
import {
  formatPeriod,
  isPeriodKey,
  periodOf,
  shiftPeriod,
} from "@/lib/admin/payouts-math";
import { todayInReportZone } from "@/lib/admin/ranges";
import { formatMoney } from "@/lib/admin/sales";

type SearchParams = Promise<{ month?: string }>;

export const dynamic = "force-dynamic";

const KIND_BADGE: Record<CostKind, { tone: "blue" | "grey" | "green"; label: string }> = {
  metered: { tone: "blue", label: "live" },
  estimate: { tone: "grey", label: "estimate" },
  fixed: { tone: "grey", label: "fixed" },
  payouts: { tone: "green", label: "payouts" },
};

/**
 * Every running cost for a month, read live where the provider allows it, so
 * a runaway is visible mid-month rather than on the invoice.
 */
export default async function CostsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireAdmin();

  const params = await searchParams;
  const current = periodOf(todayInReportZone());
  // A future month has no costs yet, only charges a provider has scheduled.
  const period =
    isPeriodKey(params?.month) && params.month <= current ? params.month : current;
  const window = monthWindow(period);
  const costs = await loadRunningCosts(window);
  const totals = totalCosts(costs.lines);

  const months = [0, -1, -2, -3].map((offset) => shiftPeriod(current, offset));
  if (!months.includes(period)) {
    months.push(period);
  }

  const money = costs.stripe.ok ? costs.stripe.value : null;
  const netIn = money ? money.gross - money.refunds : null;
  const leftOver = netIn === null ? null : netIn - totals.soFar;
  const lines = [...costs.lines].sort(
    (a, b) => (b.projected ?? b.soFar ?? 0) - (a.projected ?? a.soFar ?? 0),
  );

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Costs</h1>
          <p className="admin-subtitle">
            What running Memo AI costs in {formatPeriod(period)}
            {window.isCurrent
              ? `, ${Math.round(window.elapsed * 100)}% of the way through the month`
              : ""}
            .
          </p>
        </div>
        <nav className="admin-range" aria-label="Month">
          {months.map((month) => (
            <PendingLink
              key={month}
              href={`/admin/costs?month=${month}`}
              className="admin-range-item"
              data-active={month === period}
            >
              {month === current ? "This month" : formatPeriod(month)}
            </PendingLink>
          ))}
        </nav>
      </header>

      <div className="admin-grid">
        <StatCard
          label={window.isCurrent ? "Spent so far" : "Spent"}
          value={formatMoney(totals.soFar)}
          meta={
            totals.missing > 0
              ? `${totals.missing} source${totals.missing === 1 ? "" : "s"} did not answer — at least this much`
              : `${costs.lines.length} cost lines`
          }
        />
        {window.isCurrent && (
          <StatCard
            label="Heading for"
            value={totals.projected === null ? "—" : formatMoney(totals.projected)}
            meta={
              totals.projected === null
                ? "Too early in the month to project"
                : "Usage at this month's pace, fixed costs in full, creators at last month's run"
            }
          />
        )}
        <StatCard
          label="Money in"
          value={netIn === null ? "—" : formatMoney(netIn)}
          meta={
            money
              ? `${formatMoney(money.gross)} paid in, ${formatMoney(money.refunds)} refunded`
              : "Stripe did not answer"
          }
        />
        <StatCard
          label="Left after costs"
          value={leftOver === null ? "—" : formatMoney(leftOver)}
          meta={
            netIn !== null && netIn > 0
              ? `Costs are ${Math.round((totals.soFar / netIn) * 100)}% of the money in`
              : "Money in less everything above"
          }
        />
      </div>

      <Section
        title="Where it goes"
        hint={`Dollar costs at ${costs.eurPerUsd.toFixed(4)} € per $${
          costs.rateDate ? ` (ECB, ${costs.rateDate})` : " (fallback rate — the live rate did not load)"
        }. Live lines refresh every 15 minutes.`}
      >
        {lines.length === 0 ? (
          <EmptyState title="No costs to show" />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Cost</th>
                  <th className="admin-num">{window.isCurrent ? "So far" : "Month"}</th>
                  {window.isCurrent && <th className="admin-num">Heading for</th>}
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <div>{line.label}</div>
                      <Badge tone={KIND_BADGE[line.kind].tone}>{KIND_BADGE[line.kind].label}</Badge>
                    </td>
                    <td className="admin-num">
                      {line.soFar === null ? "—" : formatMoney(line.soFar)}
                    </td>
                    {window.isCurrent && (
                      <td className="admin-num">
                        {line.projected === null ? "—" : formatMoney(line.projected)}
                      </td>
                    )}
                    <td className="admin-help">{line.note}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="admin-num">
                    <strong>{formatMoney(totals.soFar)}</strong>
                  </td>
                  {window.isCurrent && (
                    <td className="admin-num">
                      <strong>
                        {totals.projected === null ? "—" : formatMoney(totals.projected)}
                      </strong>
                    </td>
                  )}
                  <td className="admin-help">
                    {totals.missing > 0
                      ? "Lines marked — are missing from the total."
                      : "Everything above."}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Fixed costs"
        hint="Subscriptions no API reports. Counted in full every month; a yearly fee as a twelfth."
      >
        {costs.fixed === null ? (
          <Alert tone="error">The fixed costs could not be read, so they are missing from the total.</Alert>
        ) : costs.fixed.length === 0 ? (
          <Alert tone="info">No fixed costs recorded yet.</Alert>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="admin-num">Amount</th>
                  <th>Billed</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {costs.fixed.map((cost) => (
                  <tr key={cost.id}>
                    <td>
                      {cost.name}{" "}
                      {!cost.active && <Badge tone="grey">not counted</Badge>}
                    </td>
                    <td className="admin-num">
                      {cost.currency === "usd" ? "$" : "€"}
                      {Number(cost.amount).toFixed(2)}
                    </td>
                    <td>{cost.cadence === "yearly" ? "Yearly" : "Monthly"}</td>
                    <td className="admin-help">{cost.note ?? "—"}</td>
                    <td>
                      <div className="admin-row-actions">
                        <details className="admin-row-edit">
                          <summary className="admin-button" data-variant="ghost" data-size="sm">
                            Edit
                          </summary>
                          <FixedCostForm cost={cost} />
                        </details>
                        <InlineAction
                          action={toggleFixedCostAction}
                          fields={{ cost_id: cost.id, active: cost.active ? "0" : "1" }}
                        >
                          {cost.active ? "Stop counting" : "Count again"}
                        </InlineAction>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-subblock">
          <Disclosure label="Add a fixed cost">
            <FixedCostForm />
          </Disclosure>
        </div>
      </Section>
    </>
  );
}
