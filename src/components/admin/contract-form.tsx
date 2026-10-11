"use client";

import { createCreatorContractAction } from "@/app/admin/(dashboard)/actions";
import type { ContractPay } from "@/lib/ugc/creator-pay";

import { ActionForm, SubmitButton } from "./forms";

/**
 * Creates a contract for a creator already in the program, with their own deal. Nothing
 * is emailed: the contract list shows its signing link to copy and send them.
 *
 * Every pay field is optional (empty or 0 means "not part of the deal"); the contract's
 * pay section is written from whichever are filled in. The defaults come from what the
 * dashboard already knows about this creator's pay.
 */
export function ContractForm({
  creatorId,
  defaultName,
  defaultEmail,
  defaultPay,
}: {
  creatorId: string;
  defaultName: string;
  defaultEmail: string;
  defaultPay: ContractPay;
}) {
  const amount = (value: number) => (value > 0 ? String(value) : "");

  const money = (name: string, label: string, value: number, help?: string) => (
    <div className="admin-field">
      <label className="admin-label" htmlFor={`contract-${name}`}>
        {label}
      </label>
      <input
        id={`contract-${name}`}
        className="admin-input"
        name={name}
        inputMode="decimal"
        placeholder="0"
        defaultValue={amount(value)}
      />
      {help ? <span className="admin-help">{help}</span> : null}
    </div>
  );

  return (
    <ActionForm action={createCreatorContractAction}>
      <input type="hidden" name="creator_id" value={creatorId} />

      <div className="admin-form-grid">
        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-name">
            Name on the contract
          </label>
          <input id="contract-name" className="admin-input" name="full_name" required defaultValue={defaultName} />
          <span className="admin-help">One person per contract. Two people sharing an account get one each.</span>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-email">
            Email (optional)
          </label>
          <input
            id="contract-email"
            className="admin-input"
            type="email"
            name="email"
            defaultValue={defaultEmail}
            placeholder="for your records"
          />
          <span className="admin-help">Kept with the contract. Nothing is sent to it.</span>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-market">
            Campaign
          </label>
          <select id="contract-market" className="admin-select" name="market" defaultValue="si">
            <option value="si">Slovenia (contract in Slovenian)</option>
            <option value="balkans">Balkans</option>
          </select>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-locale">
            Balkan language
          </label>
          <select id="contract-locale" className="admin-select" name="locale" defaultValue="hr">
            <option value="hr">Croatian</option>
            <option value="bs">Bosnian</option>
            <option value="sr">Serbian</option>
          </select>
          <span className="admin-help">Only used for the Balkans campaign.</span>
        </div>
      </div>

      <label className="admin-check">
        <input type="checkbox" name="minor" />
        <span>Under 18: a parent or guardian signs too</span>
      </label>

      <p className="admin-subheading">Pay</p>
      <div className="admin-form-grid">
        {money("per_tiktok", "Per TikTok video (€)", defaultPay.perTikTok)}
        {money("per_instagram", "Same video on Instagram (€)", defaultPay.perInstagram, "Extra per video also posted as a Reel.")}
        {money("view_rate", "Per 1,000 views (€)", defaultPay.viewRatePer1k)}
        {money("code_share", "Share of code sales (%)", defaultPay.codeSharePercent, "Of what customers actually paid with their code.")}
        {money("monthly_fee", "Fixed fee per month (€)", defaultPay.monthlyFee)}
        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-bonus_cap">
            Bonus cap per month (€)
          </label>
          <input
            id="contract-bonus_cap"
            className="admin-input"
            name="bonus_cap"
            inputMode="decimal"
            placeholder="No cap"
            defaultValue={defaultPay.bonusCap ?? ""}
          />
          <span className="admin-help">Limits the view and code bonuses. Empty for no cap.</span>
        </div>
        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-videos_per_month">
            Paid videos per month
          </label>
          <input
            id="contract-videos_per_month"
            className="admin-input"
            name="videos_per_month"
            inputMode="numeric"
            placeholder="No limit"
            defaultValue={defaultPay.videosPerMonth ?? ""}
          />
        </div>
      </div>

      <div className="admin-field" style={{ marginTop: "0.875rem" }}>
        <label className="admin-label" htmlFor="contract-note">
          Special agreement (optional)
        </label>
        <textarea
          id="contract-note"
          className="admin-textarea"
          name="note"
          maxLength={2000}
          defaultValue={defaultPay.note ?? ""}
          placeholder="Printed as its own clause, in the language you write it in. E.g. “The DAVID50 code is shared with Martin; its bonus is split in half.”"
        />
      </div>

      <div className="admin-form-actions">
        <SubmitButton pendingLabel="Creating…">Create contract</SubmitButton>
      </div>
    </ActionForm>
  );
}
