"use client";

import { saveFixedCostAction } from "@/app/admin/(dashboard)/actions";
import type { AdminFixedCostRow } from "@/lib/database.types";

import { ActionForm, SubmitButton } from "./forms";

/** Adds a fixed cost, or edits `cost` when one is given. */
export function FixedCostForm({ cost }: { cost?: AdminFixedCostRow }) {
  const prefix = cost ? `fixed-${cost.id}` : "fixed-new";

  return (
    <ActionForm action={saveFixedCostAction} resetOnSuccess={!cost}>
      {cost && <input type="hidden" name="cost_id" value={cost.id} />}

      <div className="admin-form-grid">
        <div className="admin-field">
          <label className="admin-label" htmlFor={`${prefix}-name`}>
            Name
          </label>
          <input
            id={`${prefix}-name`}
            className="admin-input"
            name="name"
            required
            maxLength={80}
            defaultValue={cost?.name ?? ""}
            placeholder="memoai.eu domain"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor={`${prefix}-amount`}>
            Amount
          </label>
          <input
            id={`${prefix}-amount`}
            className="admin-input"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={cost ? String(cost.amount) : ""}
            placeholder="20"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor={`${prefix}-currency`}>
            Currency
          </label>
          <select
            id={`${prefix}-currency`}
            name="currency"
            className="admin-select"
            defaultValue={cost?.currency ?? "eur"}
          >
            <option value="eur">€ euro</option>
            <option value="usd">$ dollar</option>
          </select>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor={`${prefix}-cadence`}>
            Billed
          </label>
          <select
            id={`${prefix}-cadence`}
            name="cadence"
            className="admin-select"
            defaultValue={cost?.cadence ?? "monthly"}
          >
            <option value="monthly">Every month</option>
            <option value="yearly">Once a year — counted as a twelfth a month</option>
          </select>
        </div>
      </div>

      <div className="admin-field" style={{ marginTop: "0.875rem" }}>
        <label className="admin-label" htmlFor={`${prefix}-note`}>
          Note
        </label>
        <input
          id={`${prefix}-note`}
          className="admin-input"
          name="note"
          defaultValue={cost?.note ?? ""}
          placeholder="optional — what it is, where the invoice comes from"
        />
      </div>

      <div className="admin-form-actions">
        <SubmitButton pendingLabel="Saving…">{cost ? "Save" : "Add cost"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
