"use client";

import { createCreatorContractAction, updateCreatorContractAction } from "@/app/admin/(dashboard)/actions";
import type { ContractPay } from "@/lib/ugc/creator-pay";
import type { CampaignLocale, CreatorMarket } from "@/lib/ugc/creator-program";

import { ActionForm, SubmitButton } from "./forms";

/**
 * Creates a contract with its own deal: for a creator already in the program (on their
 * page, with `creatorId`), or for anyone not in the dashboard yet (on `/admin/contracts`,
 * without). Nothing is emailed: the contract list shows its signing link to copy and
 * send them.
 *
 * Every pay field is optional (empty or 0 means "not part of the deal"); the contract's
 * pay section is written from whichever are filled in. On a creator's page the defaults
 * come from what the dashboard already knows about their pay; otherwise from the
 * campaign's standard pay.
 *
 * With `contract`, it edits that contract in place instead (`/admin/contracts/<id>/edit`):
 * every field starts from what it says now, and its full text is in a box to rewrite.
 */
export function ContractForm({
  creatorId,
  defaultName,
  defaultEmail,
  defaultPay,
  contract,
}: {
  creatorId?: string;
  defaultName?: string;
  defaultEmail?: string;
  defaultPay: ContractPay;
  contract?: {
    id: string;
    kind: "contract" | "application";
    market: CreatorMarket;
    locale: CampaignLocale;
    minor: boolean;
    signed: boolean;
    text: string;
    handWritten: boolean;
  };
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
    // Without a creator the next contract is for somebody else, so the fields start over.
    <ActionForm
      action={contract ? updateCreatorContractAction : createCreatorContractAction}
      resetOnSuccess={!creatorId && !contract}
    >
      {creatorId ? <input type="hidden" name="creator_id" value={creatorId} /> : null}
      {contract ? <input type="hidden" name="contract_id" value={contract.id} /> : null}

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
            required={contract?.kind === "application"}
            defaultValue={defaultEmail}
            placeholder="for your records"
          />
          <span className="admin-help">
            {contract?.kind === "application"
              ? "The email they applied with."
              : "Kept with the contract. Nothing is sent to it."}
          </span>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-market">
            Campaign
          </label>
          <select id="contract-market" className="admin-select" name="market" defaultValue={contract?.market ?? "si"}>
            <option value="si">Slovenia (contract in Slovenian)</option>
            <option value="balkans">Balkans</option>
          </select>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="contract-locale">
            Balkan language
          </label>
          <select
            id="contract-locale"
            className="admin-select"
            name="locale"
            defaultValue={contract && contract.locale !== "sl" ? contract.locale : "hr"}
          >
            <option value="hr">Croatian</option>
            <option value="bs">Bosnian</option>
            <option value="sr">Serbian</option>
          </select>
          <span className="admin-help">Only used for the Balkans campaign.</span>
        </div>
      </div>

      <label className="admin-check">
        <input type="checkbox" name="minor" defaultChecked={contract?.minor} />
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

      {contract ? (
        <>
          <p className="admin-subheading">Contract text</p>
          <div className="admin-field">
            <label className="admin-label" htmlFor="contract-terms_text">
              {contract.signed ? "The text they signed, as it will now read" : "The text they will sign"}
            </label>
            {/* Keyed by the text, so a save that rewrote it shows the new text rather than the typed one. */}
            <textarea
              key={contract.text}
              id="contract-terms_text"
              className="admin-textarea admin-contract-editor"
              name="terms_text"
              rows={24}
              spellCheck={false}
              defaultValue={contract.text}
            />
            <span className="admin-help">
              {contract.handWritten
                ? "Written by hand: the details and pay above no longer change it."
                : "Generated from the details and pay above, and rewritten when you change them. Edit it here and your text is kept exactly as written."}{" "}
              Markdown: **bold**, ### heading.
            </span>
          </div>
          <label className="admin-check">
            <input key={contract.text} type="checkbox" name="regenerate" />
            <span>Write the text from the details and pay instead (drops any changes made by hand)</span>
          </label>
        </>
      ) : null}

      <div className="admin-form-actions">
        {contract ? (
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        ) : (
          <SubmitButton pendingLabel="Creating…">Create contract</SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}
