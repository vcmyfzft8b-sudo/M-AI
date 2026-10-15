"use server";

import { after } from "next/server";
import { z } from "zod";

import type { ActionState } from "@/lib/admin/action-state";

import {
  addAdminUser,
  removeAdminUser,
  requireAdmin,
} from "@/lib/admin/auth";
import { getOnlineVisitors } from "@/lib/admin/analytics";
import { setVideoClassification } from "@/lib/admin/ugc";
import { getRealtimeVisitors } from "@/lib/admin/vercel-analytics";
import type {
  UgcContentMode,
  UgcPlatform,
  UgcRateKind,
  UgcRuleKind,
  UgcStatus,
} from "@/lib/database.types";
import { insertInto, updateIn } from "@/lib/admin/db";
import {
  formatEuros,
  formatPeriod,
  isPeriodKey,
  normalizePayee,
  payoutTotalCents,
  periodStart,
  toCents,
} from "@/lib/admin/payouts-math";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  isTikTokShortLink,
  parseTikTokProfile,
  resolveShortLink,
} from "@/lib/ugc/tiktok";
import {
  pollAndIngest,
  reclassifyAll,
  refreshAccountProfile,
} from "@/lib/ugc/sync";
import type { Json, UgcCreatorApplicationRow } from "@/lib/database.types";
import { campaignLocale, type CreatorMarket } from "@/lib/ugc/creator-program";
import { contractPaySchema, sameContractPay, type ContractPay } from "@/lib/ugc/creator-pay";
import { editedContractText, normalizeContractText } from "@/lib/ugc/contract-edit";
import { applicationCampaignPay } from "@/lib/ugc/contract-rows";
import { CREATOR_TERMS_VERSION } from "@/lib/ugc/creator-terms";
import { contractSourceTerms, loadContractSource } from "@/lib/admin/contracts";
import { sendAcceptanceEmail } from "@/lib/ugc/send-acceptance-email";

/**
 * Server actions behind the admin dashboard.
 *
 * Every action re-checks the allowlist: a server action is a public endpoint,
 * so the layout guard alone would not protect it.
 *
 * None of the actions call `revalidatePath`. A revalidation inside an action
 * makes Next re-render the page before the action can answer — and, because
 * the Stripe cache entries are tagged with the path, it also threw the whole
 * Stripe read away, so "Saved." used to wait on a full creators-page render
 * plus a fresh Stripe scan before it could appear. The forms refresh the page
 * themselves once the answer is back, in a transition that leaves the current
 * screen usable while the fresh one streams in. The TikTok profile scrape on
 * a new account is not needed for the answer and is handed to `after()`.
 */

function ok(message: string, options?: { refreshAfterMs?: number }): ActionState {
  return { status: "success", message, ...options };
}

/**
 * How long the page waits before refreshing again to pick up background work.
 *
 * Only the TikTok profile scrape on a new account runs in the background: a
 * single page fetch per account, comfortably done in this time, and a
 * refresh that lands a little early only costs one more a moment later.
 * Re-checking every video is awaited instead — it can involve a model call
 * over every post on a mixed account, so no fixed wait would be honest, and
 * two passes running at once would race each other's writes.
 */
const BACKGROUND_WORK_MS = 8000;

function fail(message: string): ActionState {
  return { status: "error", message };
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "creator"
  );
}

/** Appends a numeric suffix until the slug is free. */
async function uniqueSlug(base: string): Promise<string> {
  const serviceRole = createSupabaseServiceRoleClient();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await serviceRole
      .from("ugc_creators")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (!data) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Turns whatever an admin pasted into the links box into TikTok handles.
 *
 * Accepts full profile URLs with share tracking parameters, bare handles, and
 * `vm.tiktok.com` short links, one per line or comma separated.
 */
async function parseProfileLinks(
  raw: string,
): Promise<{ handles: Array<{ handle: string; profileUrl: string }>; invalid: string[] }> {
  const entries = raw
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const handles: Array<{ handle: string; profileUrl: string }> = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    let parsed = parseTikTokProfile(entry);

    if (!parsed && isTikTokShortLink(entry)) {
      parsed = await resolveShortLink(entry);
    }

    if (!parsed) {
      invalid.push(entry);
      continue;
    }

    const key = parsed.handle.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      handles.push(parsed);
    }
  }

  return { handles, invalid };
}

function readPromoCodes(raw: string | null): string[] {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[\s,;]+/)
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

const contentModeSchema = z.enum(["dedicated", "mixed", "personal"]);
const statusSchema = z.enum(["active", "paused", "archived"]);
const rateKindSchema = z.enum([
  "per_video",
  "per_month",
  "per_1k_views",
  "revenue_share",
]);

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readOptional(formData: FormData, key: string): string | null {
  const value = readString(formData, key);
  return value.length > 0 ? value : null;
}


/**
 * The pay arrangement, as the two columns that store it.
 *
 * The form picks an arrangement by name and submits only the amounts that
 * arrangement uses, so a missing field means "not part of this deal" rather
 * than "left blank". The pairs are therefore normalised together: a fee kind
 * with no amount pays nothing and a stray amount with no kind is dead weight,
 * and both used to be saved without complaint — the creator then read as free
 * reach on every payout screen.
 */
type PayTerms = {
  rateKind: UgcRateKind | null;
  rateAmount: number | null;
  sharePercent: number | null;
};

function readPayTerms(formData: FormData): PayTerms | { error: string } {
  const rateKindRaw = readOptional(formData, "rate_kind");
  const parsed = rateKindRaw ? rateKindSchema.safeParse(rateKindRaw) : null;
  const rateKind =
    parsed?.success && parsed.data !== "revenue_share"
      ? (parsed.data as UgcRateKind)
      : null;

  const amountRaw = readOptional(formData, "rate_amount");
  const amount = amountRaw === null ? null : Number(amountRaw);

  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    return { error: "The flat fee has to be a positive number." };
  }

  if (rateKind && (amount === null || amount <= 0)) {
    return { error: "Enter the flat fee for the arrangement you picked." };
  }

  const shareRaw = readOptional(formData, "revenue_share_percent");
  const share = shareRaw === null ? null : Number(shareRaw);

  if (
    share !== null &&
    (!Number.isFinite(share) || share <= 0 || share > 100)
  ) {
    return { error: "The code bonus has to be between 1 and 100 percent." };
  }

  return {
    rateKind,
    // An amount without a kind cannot be charged for anything, so it is not
    // kept: it would sit in the row looking like agreed terms.
    rateAmount: rateKind ? amount : null,
    sharePercent: share,
  };
}

/**
 * Payment details, only when the form carried the field: the column arrives
 * with migration 0056, and a form without it must not write it.
 */
function readPayoutDetails(formData: FormData): { payout_details?: string | null } {
  return formData.has("payout_details")
    ? { payout_details: readOptional(formData, "payout_details") }
    : {};
}

// ---------------------------------------------------------------- creators --

export async function createCreatorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const name = readString(formData, "name");

  if (name.length < 1 || name.length > 80) {
    return fail("Enter the creator's name.");
  }

  const { handles, invalid } = await parseProfileLinks(readString(formData, "links"));

  if (handles.length === 0) {
    return fail(
      invalid.length > 0
        ? `Could not read a TikTok profile from: ${invalid.slice(0, 3).join(", ")}`
        : "Add at least one TikTok profile link.",
    );
  }

  const contentMode = contentModeSchema.safeParse(readString(formData, "content_mode"));
  const pay = readPayTerms(formData);

  if ("error" in pay) {
    return fail(pay.error);
  }

  const slug = await uniqueSlug(slugify(name));

  const { data: created, error } = await insertInto(serviceRole, "ugc_creators", {
      name,
      slug,
      status: "active",
      contact_email: readOptional(formData, "contact_email"),
      notes: readOptional(formData, "notes"),
      ...readPayoutDetails(formData),
      promo_codes: readPromoCodes(readOptional(formData, "promo_codes")),
      rate_amount: pay.rateAmount,
      rate_kind: pay.rateKind,
      revenue_share_percent: pay.sharePercent,
      started_at: readOptional(formData, "started_at"),
      created_by: context.user.email ?? null,
    })
    .select("id")
    .single();

  if (error || !created) {
    return fail(`Could not add the creator: ${error?.message ?? "unknown error"}`);
  }

  const creatorId = (created as { id: string }).id;
  const mode: UgcContentMode = contentMode.success ? contentMode.data : "mixed";

  const { error: accountError } = await insertInto(serviceRole, "ugc_creator_accounts", 
      handles.map((entry) => ({
        creator_id: creatorId,
        platform: "tiktok" as UgcPlatform,
        handle: entry.handle,
        profile_url: entry.profileUrl,
        content_mode: mode,
        status: "active" as UgcStatus,
      })),
    );

  if (accountError) {
    // Leaving a creator with no accounts would strand a row nothing can sync.
    await serviceRole.from("ugc_creators").delete().eq("id", creatorId);

    return fail(
      accountError.code === "23505"
        ? "One of those TikTok accounts is already assigned to another creator."
        : `Could not save the accounts: ${accountError.message}`,
    );
  }

  // Fill in followers and avatar so the new card is not blank while waiting
  // for the next scrape. Free, and failure is harmless — but it is a TikTok
  // page fetch per account, so it runs after the answer has gone back.
  after(async () => {
    const { data: accounts } = await serviceRole
      .from("ugc_creator_accounts")
      .select("id")
      .eq("creator_id", creatorId);

    await Promise.all(
      ((accounts ?? []) as Array<{ id: string }>).map((account) =>
        refreshAccountProfile(account.id).catch(() => false),
      ),
    );
  });

  return ok(
    `Added ${name} with ${handles.length} account${handles.length === 1 ? "" : "s"}.${
      invalid.length > 0 ? ` Skipped unreadable link: ${invalid[0]}` : ""
    } Follower counts are being fetched.`,
    { refreshAfterMs: BACKGROUND_WORK_MS },
  );
}

export async function updateCreatorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const id = readString(formData, "creator_id");

  if (!id) {
    return fail("Missing creator.");
  }

  const name = readString(formData, "name");

  if (!name) {
    return fail("Enter the creator's name.");
  }

  const status = statusSchema.safeParse(readString(formData, "status"));
  const pay = readPayTerms(formData);

  if ("error" in pay) {
    return fail(pay.error);
  }

  const { error } = await updateIn(serviceRole, "ugc_creators", {
      name,
      status: status.success ? status.data : "active",
      contact_email: readOptional(formData, "contact_email"),
      notes: readOptional(formData, "notes"),
      ...readPayoutDetails(formData),
      promo_codes: readPromoCodes(readOptional(formData, "promo_codes")),
      rate_amount: pay.rateAmount,
      rate_kind: pay.rateKind,
      revenue_share_percent: pay.sharePercent,
      started_at: readOptional(formData, "started_at"),
    })
    .eq("id", id);

  if (error) {
    return fail(`Could not save: ${error.message}`);
  }

  return ok("Saved.");
}

// ----------------------------------------------------------------- payouts --

/** Euros from a form field, or an error naming the field. */
function readEuros(
  formData: FormData,
  key: string,
  label: string,
): { cents: number } | { error: string } {
  const cents = toCents(readString(formData, key));

  if (!Number.isFinite(cents) || cents < 0) {
    return { error: `${label} has to be an amount in euros, 0 or more.` };
  }

  return { cents };
}

/**
 * Adds a payout line, or corrects the one already recorded for the same
 * creator, month and payee — so re-entering an amount does not leave a second
 * line behind it.
 *
 * A line that has been paid is never changed here: its amount is what was
 * sent, and quietly replacing it would leave a "Paid" badge on a sum nobody
 * transferred. Undo the payment first.
 */
export async function savePayoutAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const creatorId = readString(formData, "creator_id");
  const period = readString(formData, "period");

  if (!creatorId) {
    return fail("Pick the creator this payout is for.");
  }

  if (!isPeriodKey(period)) {
    return fail("Pick the month this payout is for.");
  }

  const base = readEuros(formData, "base_amount", "The base");
  const bonus = readEuros(formData, "bonus_amount", "The code bonus");

  if ("error" in base) {
    return fail(base.error);
  }

  if ("error" in bonus) {
    return fail(bonus.error);
  }

  if (base.cents + bonus.cents === 0) {
    return fail("Enter what they are owed — a line of €0 pays nobody.");
  }

  const payee = normalizePayee(readString(formData, "payee"));
  const note = readOptional(formData, "note");

  const { data: existingRows, error: readError } = await serviceRole
    .from("ugc_creator_payouts")
    .select("id, base_amount, bonus_amount, note, paid_at")
    .eq("creator_id", creatorId)
    .eq("period", periodStart(period))
    .eq("payee", payee)
    .limit(1);

  if (readError) {
    return fail(`Could not save the payout: ${readError.message}`);
  }

  const existing = (existingRows ?? [])[0] as
    | { id: string; base_amount: number | string; bonus_amount: number | string; note: string | null; paid_at: string | null }
    | undefined;

  if (existing?.paid_at) {
    return fail(
      `${payee || "This creator"} is already marked as paid for ${formatPeriod(period)}. Undo that first if the amount was wrong.`,
    );
  }

  if (existing) {
    const { error } = await updateIn(serviceRole, "ugc_creator_payouts", {
      base_amount: base.cents / 100,
      bonus_amount: bonus.cents / 100,
      // A blank note on a correction keeps the working that was there.
      note: note ?? existing.note,
    }).eq("id", existing.id);

    if (error) {
      return fail(`Could not save the payout: ${error.message}`);
    }

    return ok(
      `Replaced ${formatEuros(payoutTotalCents(existing))} with ${formatEuros(
        base.cents + bonus.cents,
      )}.`,
    );
  }

  const { error } = await insertInto(serviceRole, "ugc_creator_payouts", {
    creator_id: creatorId,
    period: periodStart(period),
    payee,
    base_amount: base.cents / 100,
    bonus_amount: bonus.cents / 100,
    note,
    created_by: context.user.email ?? null,
  });

  if (error) {
    return fail(`Could not save the payout: ${error.message}`);
  }

  return ok("Payout added.");
}

export async function setPayoutPaidAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const id = readString(formData, "payout_id");
  const paid = readString(formData, "paid") === "1";

  if (!id) {
    return fail("Missing payout.");
  }

  const { data, error } = await updateIn(serviceRole, "ugc_creator_payouts", {
    paid_at: paid ? new Date().toISOString() : null,
    paid_by: paid ? (context.user.email ?? null) : null,
  })
    .eq("id", id)
    .select("id");

  if (error) {
    return fail(`Could not update the payout: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return fail("That payout no longer exists — reload the page.");
  }

  return ok(paid ? "Marked as paid." : "Marked as not paid.");
}

/** Removes an unpaid line. A paid one is a record of money sent and stays. */
export async function deletePayoutAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const id = readString(formData, "payout_id");

  if (!id) {
    return fail("Missing payout.");
  }

  const { data, error } = await serviceRole
    .from("ugc_creator_payouts")
    .delete()
    .eq("id", id)
    .is("paid_at", null)
    .select("id");

  if (error) {
    return fail(`Could not remove the payout: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return fail("Only an unpaid payout can be removed. Undo the payment first.");
  }

  return ok("Payout removed.");
}

// ------------------------------------------------------------ fixed costs --

/**
 * Adds a fixed cost, or edits one when an id comes with the form. These are
 * the subscriptions no API reports — the Costs page counts them in full every
 * month.
 */
export async function saveFixedCostAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const id = readString(formData, "cost_id");
  const name = readString(formData, "name").slice(0, 80);

  if (!name) {
    return fail("Name the cost.");
  }

  const amount = toCents(readString(formData, "amount"));

  if (!Number.isFinite(amount) || amount < 0) {
    return fail("The amount has to be a number, 0 or more.");
  }

  const currency = readString(formData, "currency") === "usd" ? "usd" : "eur";
  const cadence = readString(formData, "cadence") === "yearly" ? "yearly" : "monthly";
  const values = {
    name,
    amount: amount / 100,
    currency,
    cadence,
    note: readOptional(formData, "note"),
  } as const;

  const { error } = id
    ? await updateIn(serviceRole, "admin_fixed_costs", values).eq("id", id)
    : await insertInto(serviceRole, "admin_fixed_costs", {
        ...values,
        created_by: context.user.email ?? null,
      });

  if (error) {
    return fail(`Could not save the cost: ${error.message}`);
  }

  return ok(id ? "Saved." : `Added ${name}.`);
}

export async function toggleFixedCostAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const id = readString(formData, "cost_id");
  const active = readString(formData, "active") === "1";

  if (!id) {
    return fail("Missing cost.");
  }

  const { error } = await updateIn(serviceRole, "admin_fixed_costs", { active }).eq("id", id);

  if (error) {
    return fail(`Could not update the cost: ${error.message}`);
  }

  return ok(active ? "Counting it again." : "No longer counted.");
}

export async function addAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const creatorId = readString(formData, "creator_id");
  const { handles, invalid } = await parseProfileLinks(readString(formData, "links"));

  if (!creatorId) {
    return fail("Missing creator.");
  }

  if (handles.length === 0) {
    return fail(
      invalid.length > 0
        ? `Could not read a TikTok profile from: ${invalid[0]}`
        : "Paste a TikTok profile link.",
    );
  }

  const contentMode = contentModeSchema.safeParse(readString(formData, "content_mode"));

  const { data: inserted, error } = await insertInto(serviceRole, "ugc_creator_accounts", 
      handles.map((entry) => ({
        creator_id: creatorId,
        platform: "tiktok" as UgcPlatform,
        handle: entry.handle,
        profile_url: entry.profileUrl,
        content_mode: contentMode.success ? contentMode.data : "mixed",
        status: "active" as UgcStatus,
      })),
    )
    .select("id");

  if (error) {
    return fail(
      error.code === "23505"
        ? "That TikTok account is already tracked."
        : `Could not add the account: ${error.message}`,
    );
  }

  // The profile scrape is a TikTok page fetch per account; it runs once the
  // answer has gone back and the page picks the counts up on its next refresh.
  after(() =>
    Promise.all(
      ((inserted ?? []) as Array<{ id: string }>).map((account) =>
        refreshAccountProfile(account.id).catch(() => false),
      ),
    ),
  );

  return ok(
    `Added ${handles.map((entry) => `@${entry.handle}`).join(", ")}. Follower counts are being fetched.`,
    { refreshAfterMs: BACKGROUND_WORK_MS },
  );
}

export async function updateAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const accountId = readString(formData, "account_id");
  const contentMode = contentModeSchema.safeParse(readString(formData, "content_mode"));
  const status = statusSchema.safeParse(readString(formData, "status"));

  if (!accountId) {
    return fail("Missing account.");
  }

  const { error } = await updateIn(serviceRole, "ugc_creator_accounts", {
      content_mode: contentMode.success ? contentMode.data : "mixed",
      status: status.success ? status.data : "active",
    })
    .eq("id", accountId);

  if (error) {
    return fail(`Could not save: ${error.message}`);
  }

  // Changing the account's mode changes what counts, so re-run detection.
  await reclassifyAll().catch(() => ({ updated: 0 }));

  return ok("Account updated and videos re-checked.");
}

export async function removeAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const accountId = readString(formData, "account_id");

  if (!accountId) {
    return fail("Missing account.");
  }

  const { error } = await serviceRole
    .from("ugc_creator_accounts")
    .delete()
    .eq("id", accountId);

  if (error) {
    return fail(`Could not remove the account: ${error.message}`);
  }

  return ok("Account removed along with its video history.");
}

export async function refreshAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const accountId = readString(formData, "account_id");

  if (!accountId) {
    return fail("Missing account.");
  }

  const refreshed = await refreshAccountProfile(accountId);

  return refreshed
    ? ok("Follower counts refreshed from the public profile.")
    : fail("TikTok did not return a readable profile page. Try again shortly.");
}

// ------------------------------------------------------------------ videos --

export async function classifyVideoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();

  const videoId = readString(formData, "video_id");
  const decision = readString(formData, "decision");

  if (!videoId) {
    return fail("Missing video.");
  }

  if (decision === "auto") {
    await setVideoClassification({
      videoId,
      classification: "unknown",
      lock: false,
      actor: context.user.email ?? "admin",
    });

    // Immediately re-score it so it does not sit in the review queue.
    await reclassifyAll().catch(() => ({ updated: 0 }));
  } else if (decision === "memo" || decision === "personal") {
    await setVideoClassification({
      videoId,
      classification: decision,
      lock: true,
      actor: context.user.email ?? "admin",
    });
  } else {
    return fail("Unknown decision.");
  }

  return ok("Video updated.");
}

// -------------------------------------------------------------------- sync --

export async function pollSyncAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const result = await pollAndIngest();

  if (result.status === "running") {
    return ok("Still collecting. Check again in a minute.");
  }

  if (result.status === "error") {
    return fail(result.error ?? "The sync failed.");
  }

  if (result.syncRunId === null) {
    return ok("Nothing to collect — no sync is running.");
  }

  return ok(
    `Collected ${result.videosSeen} videos (${result.videosCreated} new) across ${result.accountsSynced} accounts.`,
  );
}

export async function reclassifyAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const { updated } = await reclassifyAll();

  return ok(
    updated === 0
      ? "Every video already matches the current rules."
      : `Re-checked every video and updated ${updated}.`,
  );
}

// ------------------------------------------------------------------- rules --

const ruleKindSchema = z.enum(["keyword", "hashtag", "mention", "link"]);

export async function addRuleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const pattern = readString(formData, "pattern");
  const kind = ruleKindSchema.safeParse(readString(formData, "kind"));
  const weight = Number(readString(formData, "weight") || "1");

  if (!pattern) {
    return fail("Enter the word, hashtag, mention or domain to match.");
  }

  if (!kind.success) {
    return fail("Pick what kind of signal this is.");
  }

  if (!Number.isFinite(weight) || weight <= 0 || weight > 1) {
    return fail("Weight has to be between 0 and 1.");
  }

  const { error } = await insertInto(serviceRole, "ugc_classification_rules", {
    kind: kind.data as UgcRuleKind,
    pattern: pattern.replace(/^[#@]/, ""),
    weight,
    active: true,
  });

  if (error) {
    return fail(
      error.code === "23505"
        ? "That rule already exists."
        : `Could not add the rule: ${error.message}`,
    );
  }

  await reclassifyAll().catch(() => ({ updated: 0 }));

  return ok("Rule added and every video re-checked.");
}

export async function toggleRuleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const id = readString(formData, "rule_id");
  const active = readString(formData, "active") === "true";

  if (!id) {
    return fail("Missing rule.");
  }

  const { error } = await updateIn(serviceRole, "ugc_classification_rules", { active })
    .eq("id", id);

  if (error) {
    return fail(`Could not update the rule: ${error.message}`);
  }

  await reclassifyAll().catch(() => ({ updated: 0 }));

  return ok(active ? "Rule enabled." : "Rule disabled.");
}

export async function deleteRuleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const id = readString(formData, "rule_id");

  if (!id) {
    return fail("Missing rule.");
  }

  const { error } = await serviceRole
    .from("ugc_classification_rules")
    .delete()
    .eq("id", id);

  if (error) {
    return fail(`Could not delete the rule: ${error.message}`);
  }

  await reclassifyAll().catch(() => ({ updated: 0 }));

  return ok("Rule deleted and every video re-checked.");
}

// ------------------------------------------------------------------ admins --

export async function addAdminAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();

  const email = readString(formData, "email");
  const parsed = z.string().email().safeParse(email);

  if (!parsed.success) {
    return fail("Enter a valid email address.");
  }

  try {
    await addAdminUser({
      email: parsed.data,
      label: readOptional(formData, "label"),
      createdBy: context.user.email ?? "admin",
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not add the admin.");
  }

  return ok(`${parsed.data} can now sign in to the dashboard.`);
}

export async function removeAdminAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();

  const id = readString(formData, "admin_id");

  if (!id) {
    return fail("Missing admin.");
  }

  if (id === context.admin.id) {
    return fail("You cannot remove your own access.");
  }

  try {
    await removeAdminUser(id);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not remove the admin.");
  }

  return ok("Admin access removed.");
}

// ------------------------------------------------------------ applications --

async function loadApplication(id: string): Promise<UgcCreatorApplicationRow | null> {
  if (!id) {
    return null;
  }

  const { data } = await createSupabaseServiceRoleClient()
    .from("ugc_creator_applications")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return (data as UgcCreatorApplicationRow | null) ?? null;
}

/**
 * Sends the acceptance email and records how it went on the row, so a failed send
 * is visible on the card and can be retried rather than silently lost.
 */
async function deliverAcceptance(
  application: UgcCreatorApplicationRow,
  market: CreatorMarket,
  idempotencyKey: string,
): Promise<{ sent: true } | { sent: false; error: string }> {
  const result = await sendAcceptanceEmail({
    to: application.email,
    fullName: application.full_name,
    // The language of the campaign's pages, which the join link opens on.
    locale: campaignLocale(market, application.locale),
    market,
    joinToken: application.join_token,
    idempotencyKey,
    // Under 18: the email tells them a parent signs on the same page.
    needsGuardian: application.age !== null && application.age < 18,
  });

  const { error } = await updateIn(createSupabaseServiceRoleClient(), "ugc_creator_applications", {
    accepted_email_sent_at: result.sent ? new Date().toISOString() : null,
    accepted_email_error: result.sent ? null : result.error,
  }).eq("id", application.id);

  if (error) {
    return {
      sent: false,
      error: result.sent
        ? `The email was sent, but recording that failed: ${error.message}`
        : `${result.error} Recording that also failed: ${error.message}`,
    };
  }

  return result;
}

/**
 * Accept, reject or reopen an application.
 *
 * Accepting sends the welcome email with the Discord invite of the campaign the
 * creator joins: their own market, or — for an applicant from outside both — the one
 * the admin picked with the button. The status is saved first, so an email that
 * fails to send never undoes the decision.
 */
export async function reviewApplicationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();
  const application = await loadApplication(readString(formData, "application_id"));

  if (!application) {
    return fail("That application no longer exists.");
  }

  const decision = readString(formData, "decision");
  const serviceRole = createSupabaseServiceRoleClient();
  const reviewer = context.user.email ?? null;

  // A signed agreement is on record for good: no rejecting, reopening or moving it to
  // the other campaign afterwards.
  if (application.terms_accepted_at) {
    return fail(`${application.full_name} already signed the terms, so this application can no longer be changed.`);
  }

  if (decision === "reject" || decision === "reopen") {
    const { error } = await updateIn(serviceRole, "ugc_creator_applications", {
      status: decision === "reject" ? "rejected" : "new",
      reviewed_at: decision === "reject" ? new Date().toISOString() : null,
      reviewed_by: decision === "reject" ? reviewer : null,
    }).eq("id", application.id);

    return error
      ? fail(`Could not save: ${error.message}`)
      : ok(decision === "reject" ? `Rejected ${application.full_name}.` : `${application.full_name} is back in the queue.`);
  }

  if (decision !== "approve") {
    return fail("Unknown decision.");
  }

  const campaign = readString(formData, "campaign");
  const market: CreatorMarket | null =
    campaign === "si" || campaign === "balkans"
      ? campaign
      : application.market === "si" || application.market === "balkans"
        ? application.market
        : null;

  if (!market) {
    return fail("Pick the campaign (Slovenia or Balkans) this creator joins.");
  }

  const { error } = await updateIn(serviceRole, "ugc_creator_applications", {
    status: "approved",
    market,
    reviewed_at: new Date().toISOString(),
    reviewed_by: reviewer,
  }).eq("id", application.id);

  if (error) {
    return fail(`Could not save: ${error.message}`);
  }

  if (application.accepted_email_sent_at) {
    return ok(`Accepted ${application.full_name}. The welcome email had already been sent.`);
  }

  const sent = await deliverAcceptance(application, market, `ugc-accept-${application.id}`);

  // The decision is saved either way, so a failed send still answers as a success: the
  // page must refresh to show the accepted card, which carries the send error and a
  // "send again" button. (The buttons hide their message; an error would leave the card
  // looking untouched, as if the click had done nothing.)
  return ok(
    sent.sent
      ? `Accepted ${application.full_name} and emailed ${application.email} the terms and the ${market === "si" ? "Slovenia" : "Balkan"} Discord invite.`
      : `Accepted ${application.full_name}, but the email was not sent: ${sent.error}`,
  );
}

/** Sends the welcome email again: after a failed send, or when they say it never came. */
export async function resendAcceptanceEmailAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const application = await loadApplication(readString(formData, "application_id"));

  if (!application || application.status !== "approved") {
    return fail("Only an accepted application gets the welcome email.");
  }

  if (application.market !== "si" && application.market !== "balkans") {
    return fail("This application has no campaign yet.");
  }

  // A fresh key: this is a deliberate second send, not a double click.
  const sent = await deliverAcceptance(application, application.market, `ugc-accept-${application.id}-${Date.now()}`);

  // Recorded on the row either way; answered as a success so the card refreshes to show it.
  return ok(sent.sent ? `Email sent to ${application.email}.` : `The email was not sent: ${sent.error}`);
}

export async function saveApplicationNotesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const id = readString(formData, "application_id");

  if (!id) {
    return fail("Missing application.");
  }

  const { error } = await updateIn(createSupabaseServiceRoleClient(), "ugc_creator_applications", {
    admin_notes: readOptional(formData, "admin_notes"),
  }).eq("id", id);

  return error ? fail(`Could not save the note: ${error.message}`) : ok("Note saved.");
}

/**
 * The live visitor count on its own.
 *
 * The overview used to re-render the whole page every minute to keep this
 * one number current — every Supabase read, the Stripe summary and the full
 * page payload, for a figure that fits in an integer. The tile now polls this
 * instead, and the page refreshes on the ordinary fifteen-minute beat.
 */
export async function readOnlineCountAction(): Promise<number> {
  await requireAdmin();

  // Vercel is the authority on the number; the beacon only stands in when
  // Vercel is unavailable, so its query is not run for nothing on every tick.
  const live = await getRealtimeVisitors();

  return live ?? (await getOnlineVisitors()).length;
}

/* ----------------------------------------------------------- contracts -- */

const CONTRACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The longest contract text the admin may write by hand (the generated terms are ~15,000). */
const CONTRACT_TEXT_MAX = 100000;

type ContractFields = {
  fullName: string;
  email: string;
  market: CreatorMarket;
  requestedLocale: string;
  minor: boolean;
  pay: ContractPay;
};

/** The details and pay the contract form sends, checked; a message to show when they are not right. */
function readContractFields(formData: FormData): ContractFields | string {
  const fullName = readString(formData, "full_name");
  const email = readString(formData, "email").toLowerCase();
  const market = readString(formData, "market");

  if (fullName.length < 3 || fullName.length > 120) {
    return "Enter their full name as it should appear on the contract.";
  }

  if (email && (!CONTRACT_EMAIL.test(email) || email.length > 254)) {
    return "That email address does not look right (or leave it empty).";
  }

  if (market !== "si" && market !== "balkans") {
    return "Pick the campaign: Slovenia or Balkans.";
  }

  const pay = contractPaySchema.safeParse({
    perTikTok: readString(formData, "per_tiktok") || 0,
    perInstagram: readString(formData, "per_instagram") || 0,
    viewRatePer1k: readString(formData, "view_rate") || 0,
    codeSharePercent: readString(formData, "code_share") || 0,
    monthlyFee: readString(formData, "monthly_fee") || 0,
    bonusCap: readString(formData, "bonus_cap"),
    videosPerMonth: readString(formData, "videos_per_month"),
    note: readString(formData, "note"),
  });

  if (!pay.success) {
    return "Check the pay: amounts are 0 or more, the deal has to pay something, and the note fits in 2,000 characters.";
  }

  return {
    fullName,
    email,
    market,
    requestedLocale: readString(formData, "locale"),
    minor: formData.get("minor") === "on",
    pay: pay.data,
  };
}

/**
 * Creates a contract with the deal entered here (`ContractPay`), either for a creator
 * already in the program (from their page, `creator_id` set) or for anyone else (from
 * `/admin/contracts`, no creator). Nothing is emailed: the page shows the signing link
 * (`/ugc/join/<token>`), and the admin sends it to them themselves. It can be edited
 * later (`updateCreatorContractAction`).
 */
export async function createCreatorContractAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();
  const creatorId = readString(formData, "creator_id");
  const fields = readContractFields(formData);

  if (typeof fields === "string") {
    return fail(fields);
  }

  const serviceRole = createSupabaseServiceRoleClient();

  if (creatorId) {
    const { data: creator } = await serviceRole.from("ugc_creators").select("id").eq("id", creatorId).maybeSingle();

    if (!creator) {
      return fail("That creator no longer exists.");
    }
  }

  const { error } = await insertInto(serviceRole, "ugc_creator_contracts", {
    creator_id: creatorId || null,
    email: fields.email || null,
    full_name: fields.fullName,
    market: fields.market,
    locale: campaignLocale(fields.market, fields.requestedLocale),
    minor: fields.minor,
    pay: fields.pay as unknown as Json,
    created_by: context.user.email ?? null,
  });

  if (error) {
    return fail(`Could not save the contract: ${error.message}`);
  }

  return ok(`Contract for ${fields.fullName} created. Copy its signing link below and send it to them.`);
}

/**
 * Edits any contract in place, on the same signing link: one created here or an accepted
 * applicant's terms. Details, pay and the text itself can all change. A signed contract
 * stays signed and its stored text becomes the edited one (the terms allow Memo AI to
 * change them; no new signature is asked for). The signature record (typed name,
 * guardian, time, IP, browser) is never touched. Nothing is sent to the creator.
 *
 * The text follows `editedContractText`: what the admin typed in the text box wins;
 * untouched, generated text is generated again when the pay, campaign or language changed.
 */
export async function updateCreatorContractAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireAdmin();
  const id = readString(formData, "contract_id");
  const fields = readContractFields(formData);

  if (typeof fields === "string") {
    return fail(fields);
  }

  const source = id ? await loadContractSource(id) : null;

  if (!source) {
    return fail("That contract no longer exists.");
  }

  if (source.kind === "application" && !fields.email) {
    return fail("An applicant's contract needs their email: it is how they applied.");
  }

  const before = contractSourceTerms(source);
  const locale = campaignLocale(fields.market, fields.requestedLocale);
  const edited = editedContractText({
    submitted: readString(formData, "terms_text"),
    current: before.text,
    handWritten: before.override !== null,
    before,
    after: { locale, market: fields.market, pay: fields.pay, applied: before.applied },
    regenerate: formData.get("regenerate") === "on",
  });

  if (edited.text.trim().length === 0) {
    return fail("The contract text cannot be empty. Tick “Write the text from the details and pay” to get it back.");
  }

  if (edited.text.length > CONTRACT_TEXT_MAX) {
    return fail("The contract text is too long.");
  }

  const override = edited.handWritten ? edited.text : null;
  const editedAt = new Date().toISOString();
  const editor = context.user.email ?? null;
  const serviceRole = createSupabaseServiceRoleClient();

  // A signed contract's stored text is what the creator now has; regenerated text is
  // written at the current terms version. A signature from before the text was kept gets
  // one only when the text actually changes: fixing an email must not invent the words
  // they signed.
  const textChanged = edited.text !== normalizeContractText(before.text);
  const storedVersion = before.signed && edited.regenerated ? CREATOR_TERMS_VERSION : null;
  const signedText =
    before.signed && (before.signedText !== null || textChanged)
      ? { terms_snapshot: edited.text, ...(storedVersion ? { terms_version: storedVersion } : {}) }
      : {};

  const { data, error } =
    source.kind === "contract"
      ? await updateIn(serviceRole, "ugc_creator_contracts", {
          full_name: fields.fullName,
          email: fields.email || null,
          market: fields.market,
          locale,
          minor: fields.minor,
          pay: fields.pay as unknown as Json,
          terms_override: override,
          edited_at: editedAt,
          edited_by: editor,
          ...signedText,
        })
          .eq("id", source.row.id)
          .select("id")
      : await updateIn(serviceRole, "ugc_creator_applications", {
          full_name: fields.fullName,
          email: fields.email,
          market: fields.market,
          // An applicant's page language stays as it was unless the contract's language changes.
          ...(locale !== before.locale ? { locale } : {}),
          // Their age decides unless the admin says otherwise.
          contract_minor: fields.minor === (source.row.age !== null && source.row.age < 18) ? null : fields.minor,
          // Campaign pay stays implicit, so a campaign pay change still reaches them.
          contract_pay: sameContractPay(
            fields.pay,
            applicationCampaignPay(fields.market, before.signed ? (storedVersion ?? source.row.terms_version) : null),
          )
            ? null
            : (fields.pay as unknown as Json),
          terms_override: override,
          terms_edited_at: editedAt,
          terms_edited_by: editor,
          ...signedText,
        })
          .eq("id", source.row.id)
          .select("id");

  if (error) {
    return fail(
      error.code === "23505" ? "Another application already uses that email." : `Could not save the contract: ${error.message}`,
    );
  }

  if (!data || data.length === 0) {
    return fail("That contract no longer exists.");
  }

  return ok(
    before.signed
      ? `Saved. ${fields.fullName}'s signed contract now says this, on the same link. Nothing was sent to them.`
      : `Saved. The signing link shows the new version. Nothing was sent to ${fields.fullName}.`,
  );
}

/** Withdraws an unsigned contract: its link stops working. A signed one stays on record. */
export async function voidCreatorContractAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const id = readString(formData, "contract_id");

  if (!id) {
    return fail("Missing contract.");
  }

  const { data, error } = await updateIn(createSupabaseServiceRoleClient(), "ugc_creator_contracts", { status: "void" })
    .eq("id", id)
    .eq("status", "sent")
    .select("id");

  if (error) {
    return fail(`Could not withdraw it: ${error.message}`);
  }

  return data && data.length > 0 ? ok("Contract withdrawn; its link no longer opens.") : fail("Only an unsigned contract can be withdrawn.");
}
