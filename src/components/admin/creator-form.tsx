"use client";

import {
  addAccountAction,
  createCreatorAction,
  updateCreatorAction,
} from "@/app/admin/(dashboard)/actions";
import type { UgcCreatorRow } from "@/lib/database.types";

import { ActionForm, SubmitButton } from "./forms";

/** Explains what each account mode does, since it decides what gets counted. */
function ContentModeField({
  defaultValue = "mixed",
  name = "content_mode",
}: {
  defaultValue?: string;
  name?: string;
}) {
  return (
    <div className="admin-field">
      <label className="admin-label" htmlFor={name}>
        What kind of account is it?
      </label>
      <select
        id={name}
        name={name}
        className="admin-select"
        defaultValue={defaultValue}
      >
        <option value="mixed">
          Mixed — personal account that sometimes posts Memo AI
        </option>
        <option value="dedicated">
          Dedicated — everything on it is Memo AI content
        </option>
        <option value="personal">
          Personal — never counts toward campaign totals
        </option>
      </select>
      <span className="admin-help">
        On a mixed account each post is checked individually against the caption,
        hashtags, mentions and the creator&apos;s own promo code.
      </span>
    </div>
  );
}

export function AddCreatorForm() {
  return (
    <ActionForm action={createCreatorAction} resetOnSuccess>
      <div className="admin-form-grid">
        <div className="admin-field">
          <label className="admin-label" htmlFor="creator-name">
            Name
          </label>
          <input
            id="creator-name"
            className="admin-input"
            name="name"
            required
            maxLength={80}
            placeholder="Ema"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="creator-promo">
            Promo codes
          </label>
          <input
            id="creator-promo"
            className="admin-input"
            name="promo_codes"
            placeholder="EMA50"
          />
          <span className="admin-help">
            Their Stripe discount codes. This is what attributes real revenue to
            them, and it is also the strongest signal for spotting their Memo AI
            posts.
          </span>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="creator-email">
            Contact email
          </label>
          <input
            id="creator-email"
            className="admin-input"
            type="email"
            name="contact_email"
            placeholder="optional"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="creator-started">
            Started
          </label>
          <input
            id="creator-started"
            className="admin-input"
            type="date"
            name="started_at"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="creator-rate">
            Rate
          </label>
          <input
            id="creator-rate"
            className="admin-input"
            type="number"
            step="0.01"
            min="0"
            name="rate_amount"
            placeholder="optional"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="creator-rate-kind">
            Rate type
          </label>
          <select
            id="creator-rate-kind"
            name="rate_kind"
            className="admin-select"
            defaultValue=""
          >
            <option value="">—</option>
            <option value="per_video">Per video</option>
            <option value="per_month">Per month</option>
            <option value="per_1k_views">Per 1000 views</option>
          </select>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="creator-share">
            Code bonus %
          </label>
          <input
            id="creator-share"
            className="admin-input"
            type="number"
            step="1"
            min="0"
            max="100"
            name="revenue_share_percent"
            
            placeholder="e.g. 20"
          />
          <span className="admin-help">
            Their share of what their own code sells. Stacks with the rate
            above; leave empty for a flat fee only.
          </span>
        </div>
      </div>

      <div className="admin-field" style={{ marginTop: "0.875rem" }}>
        <label className="admin-label" htmlFor="creator-links">
          TikTok links
        </label>
        <textarea
          id="creator-links"
          className="admin-textarea"
          name="links"
          required
          placeholder={"https://www.tiktok.com/@eemadilema\n@their_second_account"}
        />
        <span className="admin-help">
          One per line. Share-sheet links with tracking parameters, bare handles
          and vm.tiktok.com short links all work. Add several if the creator
          posts from more than one account.
        </span>
      </div>

      <div style={{ marginTop: "0.875rem" }}>
        <ContentModeField />
      </div>

      <div className="admin-field" style={{ marginTop: "0.875rem" }}>
        <label className="admin-label" htmlFor="creator-notes">
          Notes
        </label>
        <textarea
          id="creator-notes"
          className="admin-textarea"
          name="notes"
          placeholder="optional"
        />
      </div>

      <div className="admin-form-actions">
        <SubmitButton pendingLabel="Adding…">Add creator</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditCreatorForm({ creator }: { creator: UgcCreatorRow }) {
  return (
    <ActionForm action={updateCreatorAction}>
      <input type="hidden" name="creator_id" value={creator.id} />

      <div className="admin-form-grid">
        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-name">
            Name
          </label>
          <input
            id="edit-name"
            className="admin-input"
            name="name"
            required
            defaultValue={creator.name}
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-status">
            Status
          </label>
          <select
            id="edit-status"
            name="status"
            className="admin-select"
            defaultValue={creator.status}
          >
            <option value="active">Active</option>
            <option value="paused">Paused — keep data, stop syncing</option>
            <option value="archived">Archived — hide from the list</option>
          </select>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-promo">
            Promo codes
          </label>
          <input
            id="edit-promo"
            className="admin-input"
            name="promo_codes"
            defaultValue={creator.promo_codes.join(", ")}
            placeholder="EMA50"
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-email">
            Contact email
          </label>
          <input
            id="edit-email"
            className="admin-input"
            type="email"
            name="contact_email"
            defaultValue={creator.contact_email ?? ""}
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-started">
            Started
          </label>
          <input
            id="edit-started"
            className="admin-input"
            type="date"
            name="started_at"
            defaultValue={creator.started_at ?? ""}
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-rate">
            Rate
          </label>
          <input
            id="edit-rate"
            className="admin-input"
            type="number"
            step="0.01"
            min="0"
            name="rate_amount"
            defaultValue={creator.rate_amount ?? ""}
          />
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-rate-kind">
            Rate type
          </label>
          <select
            id="edit-rate-kind"
            name="rate_kind"
            className="admin-select"
            defaultValue={creator.rate_kind ?? ""}
          >
            <option value="">—</option>
            <option value="per_video">Per video</option>
            <option value="per_month">Per month</option>
            <option value="per_1k_views">Per 1000 views</option>
          </select>
        </div>

        <div className="admin-field">
          <label className="admin-label" htmlFor="edit-share">
            Code bonus %
          </label>
          <input
            id="edit-share"
            className="admin-input"
            type="number"
            step="1"
            min="0"
            max="100"
            name="revenue_share_percent"
            defaultValue={creator.revenue_share_percent ?? ""}
            placeholder="e.g. 20"
          />
          <span className="admin-help">
            Their share of what their own code sells. Stacks with the rate
            above; leave empty for a flat fee only.
          </span>
        </div>
      </div>

      <div className="admin-field" style={{ marginTop: "0.875rem" }}>
        <label className="admin-label" htmlFor="edit-notes">
          Notes
        </label>
        <textarea
          id="edit-notes"
          className="admin-textarea"
          name="notes"
          defaultValue={creator.notes ?? ""}
        />
      </div>

      <div className="admin-form-actions">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AddAccountForm({ creatorId }: { creatorId: string }) {
  return (
    <ActionForm action={addAccountAction} resetOnSuccess>
      <input type="hidden" name="creator_id" value={creatorId} />

      <div className="admin-field">
        <label className="admin-label" htmlFor="account-links">
          Add another account
        </label>
        <textarea
          id="account-links"
          className="admin-textarea"
          name="links"
          required
          placeholder="https://www.tiktok.com/@their_other_account"
        />
      </div>

      <div style={{ marginTop: "0.875rem" }}>
        <ContentModeField name="content_mode" />
      </div>

      <div className="admin-form-actions">
        <SubmitButton pendingLabel="Adding…">Add account</SubmitButton>
      </div>
    </ActionForm>
  );
}
