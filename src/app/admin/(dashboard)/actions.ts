"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/admin/action-state";

import {
  addAdminUser,
  removeAdminUser,
  requireAdmin,
} from "@/lib/admin/auth";
import { setVideoClassification } from "@/lib/admin/ugc";
import type {
  UgcContentMode,
  UgcPlatform,
  UgcRateKind,
  UgcRuleKind,
  UgcStatus,
} from "@/lib/database.types";
import { insertInto, updateIn } from "@/lib/admin/db";
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

/**
 * Server actions behind the admin dashboard.
 *
 * Every action re-checks the allowlist: a server action is a public endpoint,
 * so the layout guard alone would not protect it.
 */

function ok(message: string): ActionState {
  return { status: "success", message };
}

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

  // Fill in followers and avatar straight away so the new card is not blank
  // while waiting for the next scrape. Free, and failure is harmless.
  const { data: accounts } = await serviceRole
    .from("ugc_creator_accounts")
    .select("id")
    .eq("creator_id", creatorId);

  await Promise.all(
    ((accounts ?? []) as Array<{ id: string }>).map((account) =>
      refreshAccountProfile(account.id).catch(() => false),
    ),
  );

  revalidatePath("/admin/creators");
  revalidatePath("/admin");

  return ok(
    `Added ${name} with ${handles.length} account${handles.length === 1 ? "" : "s"}.${
      invalid.length > 0 ? ` Skipped unreadable link: ${invalid[0]}` : ""
    }`,
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

  revalidatePath("/admin/creators");
  revalidatePath(`/admin/creators/${id}`);

  return ok("Saved.");
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

  await Promise.all(
    ((inserted ?? []) as Array<{ id: string }>).map((account) =>
      refreshAccountProfile(account.id).catch(() => false),
    ),
  );

  revalidatePath(`/admin/creators/${creatorId}`);
  revalidatePath("/admin/creators");

  return ok(`Added ${handles.map((entry) => `@${entry.handle}`).join(", ")}.`);
}

export async function updateAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const accountId = readString(formData, "account_id");
  const creatorId = readString(formData, "creator_id");
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

  revalidatePath(`/admin/creators/${creatorId}`);
  revalidatePath("/admin/creators");

  return ok("Account updated and videos re-checked.");
}

export async function removeAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const accountId = readString(formData, "account_id");
  const creatorId = readString(formData, "creator_id");

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

  revalidatePath(`/admin/creators/${creatorId}`);
  revalidatePath("/admin/creators");

  return ok("Account removed along with its video history.");
}

export async function refreshAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const accountId = readString(formData, "account_id");
  const creatorId = readString(formData, "creator_id");

  if (!accountId) {
    return fail("Missing account.");
  }

  const refreshed = await refreshAccountProfile(accountId);

  revalidatePath(`/admin/creators/${creatorId}`);

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

  revalidatePath("/admin/creators");
  revalidatePath("/admin");

  return ok("Video updated.");
}

// -------------------------------------------------------------------- sync --

export async function pollSyncAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const result = await pollAndIngest();

  revalidatePath("/admin/creators");
  revalidatePath("/admin");
  revalidatePath("/admin/settings");

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

  revalidatePath("/admin/creators");
  revalidatePath("/admin");

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

  revalidatePath("/admin/settings");
  revalidatePath("/admin/creators");

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

  revalidatePath("/admin/settings");
  revalidatePath("/admin/creators");

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

  revalidatePath("/admin/settings");

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

  revalidatePath("/admin/settings");

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

  revalidatePath("/admin/settings");

  return ok("Admin access removed.");
}
