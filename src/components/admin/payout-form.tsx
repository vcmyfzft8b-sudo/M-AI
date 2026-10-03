"use client";

import { savePayoutAction } from "@/app/admin/(dashboard)/actions";

import { ActionForm, SubmitButton } from "./forms";

/**
 * Adds a payout line for a month.
 *
 * Saving the same creator, month and payee again replaces that line, so a
 * corrected amount is entered here too rather than by deleting the old one.
 */
export function PayoutForm({
  creators,
  period,
  creatorId,
}: {
  creators: Array<{ id: string; name: string }>;
  period: string;
  /** Fixes the creator, for the form on a creator's own page. */
  creatorId?: string;
}) {
  return (
    <ActionForm action={savePayoutAction} resetOnSuccess>
      <div className="admin-form-grid">
        {creatorId ? (
          <input type="hidden" name="creator_id" value={creatorId} />
        ) : (
          <div className="admin-field">
            <label className="admin-label" htmlFor="payout-creator">
              Creator
            </label>
            <select
              id="payout-creator"
              name="creator_id"
              className="admin-select"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Pick a creator
              </option>
              {creators.map((creator) => (
                <option key={creator.id} value={creator.id}>
                  {creator.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="admin-field">
          <label className="admin-label" htmlFor="payout-period">
            Month
          </label>
          <input
            id="payout-period"
            className="admin-input"
            type="month"
            name="period"
            required
            defaultValue={period}
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="payout-payee">
            Paid to
          </label>
          <input
            id="payout-payee"
            className="admin-input"
            name="payee"
            maxLength={80}
            placeholder="optional — e.g. David"
          />
          <span className="admin-help">
            Only when one creator row is two people. Each gets their own line.
          </span>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="payout-base">
            Base (€)
          </label>
          <input
            id="payout-base"
            className="admin-input"
            name="base_amount"
            inputMode="decimal"
            placeholder="0"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="payout-bonus">
            Code bonus (€)
          </label>
          <input
            id="payout-bonus"
            className="admin-input"
            name="bonus_amount"
            inputMode="decimal"
            placeholder="0"
          />
        </div>
      </div>

      <div className="admin-field" style={{ marginTop: "0.875rem" }}>
        <label className="admin-label" htmlFor="payout-note">
          How it was worked out
        </label>
        <input
          id="payout-note"
          className="admin-input"
          name="note"
          placeholder="16 videos × €5 · 20% of €65 via NELI50"
        />
      </div>

      <div className="admin-form-actions">
        <SubmitButton pendingLabel="Saving…">Save payout</SubmitButton>
      </div>
    </ActionForm>
  );
}
