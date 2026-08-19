"use client";

import { useEffect, useRef, useState } from "react";

import { PAY_PLANS, planFor, planValueFor } from "@/lib/admin/pay-plans";
import type { UgcRateKind } from "@/lib/database.types";

/**
 * How a creator is paid, as one explicit choice.
 *
 * The arrangements themselves live in `@/lib/admin/pay-plans`, next to the
 * economics that spend them. This is only the control: pick an arrangement and
 * the amounts it actually needs appear, so a fee with no amount — which pays
 * nothing — cannot be saved by accident.
 */

export function PayTermsFields({
  idPrefix,
  rateKind = null,
  rateAmount = null,
  sharePercent = null,
}: {
  /** Keeps the ids unique when both forms are open on the same page. */
  idPrefix: string;
  rateKind?: UgcRateKind | null;
  rateAmount?: number | string | null;
  sharePercent?: number | string | null;
}) {
  const initial = planValueFor(rateKind, sharePercent);
  const [plan, setPlan] = useState(initial);
  const ref = useRef<HTMLFieldSetElement>(null);

  // The "add" form clears itself after a successful submit. A native reset
  // restores the other fields' defaults but cannot touch React state, so this
  // plan would stay on the last creator's terms while everything around it
  // emptied.
  useEffect(() => {
    const form = ref.current?.closest("form");

    if (!form) {
      return;
    }

    const onReset = () => setPlan(initial);

    form.addEventListener("reset", onReset);

    return () => form.removeEventListener("reset", onReset);
  }, [initial]);

  const current = planFor(plan);

  return (
    <fieldset className="admin-fieldset" ref={ref}>
      <legend className="admin-fieldset-legend">How are they paid?</legend>

      {/* The fee kind the arrangement implies. The select itself is not
          submitted, so the stored columns never learn about the plan names. */}
      <input type="hidden" name="rate_kind" value={current.rateKind} />

      <div className="admin-form-grid">
        <div className="admin-field">
          <label className="admin-label" htmlFor={`${idPrefix}-pay-plan`}>
            Arrangement
          </label>
          <select
            id={`${idPrefix}-pay-plan`}
            className="admin-select"
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
          >
            {PAY_PLANS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <span className="admin-help">{current.hint}</span>
        </div>

        {current.rateKind !== "" && (
          <div className="admin-field">
            <label className="admin-label" htmlFor={`${idPrefix}-rate`}>
              Flat fee (€ {current.unit})
            </label>
            <input
              id={`${idPrefix}-rate`}
              className="admin-input"
              type="number"
              step="0.01"
              min="0.01"
              name="rate_amount"
              required
              defaultValue={rateAmount ?? ""}
              placeholder="e.g. 30"
            />
          </div>
        )}

        {current.bonus && (
          <div className="admin-field">
            <label className="admin-label" htmlFor={`${idPrefix}-share`}>
              Code bonus %
            </label>
            <input
              id={`${idPrefix}-share`}
              className="admin-input"
              type="number"
              step="1"
              min="1"
              max="100"
              name="revenue_share_percent"
              required
              defaultValue={sharePercent ?? ""}
              placeholder="e.g. 20"
            />
            <span className="admin-help">
              Their share of what their own code sells, on tracked revenue only.
            </span>
          </div>
        )}
      </div>
    </fieldset>
  );
}
