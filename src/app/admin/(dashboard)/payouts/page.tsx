import {
  deletePayoutAction,
  setPayoutPaidAction,
} from "@/app/admin/(dashboard)/actions";
import { Disclosure, InlineAction } from "@/components/admin/forms";
import { PayoutForm } from "@/components/admin/payout-form";
import { PendingLink } from "@/components/admin/pending-link";
import { requireAdmin } from "@/lib/admin/auth";
import {
  Badge,
  EmptyState,
  formatDate,
  Section,
  StatCard,
} from "@/components/admin/ui";
import {
  listPayoutPeriods,
  listPayoutsForPeriod,
} from "@/lib/admin/payouts";
import {
  defaultPayoutPeriod,
  formatPeriod,
  isPeriodKey,
  payoutDetailsFor,
  payoutTotalCents,
  shiftPeriod,
  summarizePayouts,
  toCents,
} from "@/lib/admin/payouts-math";
import { formatMoney } from "@/lib/admin/sales";
import { listCreators } from "@/lib/admin/ugc";

type SearchParams = Promise<{ month?: string }>;

export const dynamic = "force-dynamic";

/**
 * Who is owed what for a month, where to send it, and what has gone out.
 *
 * The amounts are entered, not computed: the base comes from a hand count of
 * the videos (the scrape misses posts and reads captions only) and the bonus
 * from Stripe, and the page records the run as it was agreed.
 */
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  // The layout checks too, but this page shows bank details: check here as
  // well rather than rely on a layout guard alone.
  await requireAdmin();

  const params = await searchParams;
  const fallback = defaultPayoutPeriod();
  const period = isPeriodKey(params?.month) ? params.month : fallback;

  const [payouts, periods, creators] = await Promise.all([
    listPayoutsForPeriod(period),
    listPayoutPeriods(),
    // Archived creators can still be owed for a month they worked.
    listCreators({ includeArchived: true }),
  ]);

  const summary = summarizePayouts(payouts);

  // The months with something recorded, plus the current run and the one
  // being viewed, so an empty month can still be opened and filled in.
  const recent = [...new Set([fallback, ...periods])].sort().reverse().slice(0, 7);
  const months = [...new Set([period, ...recent])].sort().reverse();
  const earliest = months[months.length - 1];

  const rows = [...payouts].sort(
    (a, b) =>
      Number(Boolean(a.paid_at)) - Number(Boolean(b.paid_at)) ||
      payoutTotalCents(b) - payoutTotalCents(a),
  );

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Payouts</h1>
          <p className="admin-subtitle">
            What each creator is owed for {formatPeriod(period)}, and where to send it.
          </p>
        </div>
        <nav className="admin-range" aria-label="Month">
          {months.map((month) => (
            <PendingLink
              key={month}
              href={`/admin/payouts?month=${month}`}
              className="admin-range-item"
              data-active={month === period}
            >
              {formatPeriod(month)}
            </PendingLink>
          ))}
          <PendingLink
            href={`/admin/payouts?month=${shiftPeriod(earliest, -1)}`}
            className="admin-range-item"
          >
            Earlier
          </PendingLink>
        </nav>
      </header>

      <div className="admin-grid">
        <StatCard
          label="Total"
          value={formatMoney(summary.total)}
          meta={`${summary.lines} payment${summary.lines === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Still to pay"
          value={formatMoney(summary.owed)}
          meta={`${summary.lines - summary.paidLines} not sent yet`}
        />
        <StatCard
          label="Paid"
          value={formatMoney(summary.paid)}
          meta={`${summary.paidLines} sent`}
        />
        <StatCard
          label="Base · code bonus"
          value={`${formatMoney(summary.base)} · ${formatMoney(summary.bonus)}`}
          meta="Flat fees · share of their codes' sales"
        />
      </div>

      <Section
        title={`${formatPeriod(period)} run`}
        hint="Unpaid first. Payment details come from each creator's page — edit them there. A paid line can only be changed or removed after undoing the payment."
      >
        {rows.length === 0 ? (
          <EmptyState title={`Nothing recorded for ${formatPeriod(period)} yet`}>
            Add each creator&apos;s payout below.
          </EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th className="admin-num">Base</th>
                  <th className="admin-num">Bonus</th>
                  <th className="admin-num">Total</th>
                  <th>How</th>
                  <th>Send to</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((payout) => {
                  const name = payout.creator?.name ?? "Removed creator";
                  const label = payout.payee ? `${payout.payee} (${name})` : name;

                  return (
                    <tr key={payout.id}>
                      <td>
                        {payout.creator ? (
                          <PendingLink
                            className="admin-link"
                            href={`/admin/creators/${payout.creator.id}`}
                          >
                            {payout.payee || name}
                          </PendingLink>
                        ) : (
                          name
                        )}
                        {payout.payee && (
                          <div className="admin-creator-handle">{name}</div>
                        )}
                      </td>
                      <td className="admin-num">
                        {formatMoney(toCents(payout.base_amount))}
                      </td>
                      <td className="admin-num">
                        {formatMoney(toCents(payout.bonus_amount))}
                      </td>
                      <td className="admin-num">
                        <strong>{formatMoney(payoutTotalCents(payout))}</strong>
                      </td>
                      <td className="admin-help">{payout.note ?? "—"}</td>
                      <td className="admin-mono admin-payout-details">
                        {payoutDetailsFor(payout.creator?.payout_details ?? null, payout.payee) ?? (
                          <span className="admin-help">not recorded</span>
                        )}
                      </td>
                      <td>
                        {payout.paid_at ? (
                          <Badge tone="green">Paid {formatDate(payout.paid_at)}</Badge>
                        ) : (
                          <Badge tone="red">Owed</Badge>
                        )}
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          {payout.paid_at ? (
                            <InlineAction
                              action={setPayoutPaidAction}
                              fields={{ payout_id: payout.id, paid: "0" }}
                              confirm={`Mark ${label} as not paid?`}
                            >
                              Undo
                            </InlineAction>
                          ) : (
                            <InlineAction
                              action={setPayoutPaidAction}
                              fields={{ payout_id: payout.id, paid: "1" }}
                              variant="primary"
                            >
                              Mark paid
                            </InlineAction>
                          )}
                          {!payout.paid_at && (
                            <InlineAction
                              action={deletePayoutAction}
                              fields={{ payout_id: payout.id }}
                              variant="danger"
                              confirm={`Remove the ${formatPeriod(period)} payout for ${label}?`}
                            >
                              Remove
                            </InlineAction>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-subblock">
          <Disclosure label="Add a payout">
            <PayoutForm
              creators={creators
                .filter((creator) => creator.kind !== "owned")
                .map((creator) => ({ id: creator.id, name: creator.name }))}
              period={period}
            />
          </Disclosure>
        </div>
      </Section>
    </>
  );
}
