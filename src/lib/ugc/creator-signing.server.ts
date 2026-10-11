import "server-only";

import { cache } from "react";

import { updateIn } from "@/lib/admin/db";
import type { UgcCreatorApplicationRow, UgcCreatorContractRow } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { CREATOR_TERMS } from "@/lib/ugc/creator-campaigns";
import { campaignPay, parseContractPay, type ContractPay } from "@/lib/ugc/creator-pay";
import { campaignLocale, type CampaignLocale, type CreatorMarket } from "@/lib/ugc/creator-program";
import { CREATOR_TERMS_VERSION, creatorTermsMarkdown } from "@/lib/ugc/creator-terms";

/**
 * What a join link (`/ugc/join/<token>`) can be signed for.
 *
 * - An **application** the admin accepted: the campaign's standard pay, and the
 *   campaign's Discord once signed.
 * - A **contract** the admin sent to a creator already in the program: that creator's
 *   own deal (`ugc_creator_contracts.pay`). Voided contracts open nothing.
 *
 * Both are signed the same way, in one tap, and both keep the same record.
 */
export type Signable = {
  kind: "application" | "contract";
  id: string;
  fullName: string;
  market: CreatorMarket;
  locale: CampaignLocale;
  minor: boolean;
  pay: ContractPay;
  /** Applied with a sample video (the terms compare later videos to it). */
  applied: boolean;
  acceptedAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readSignable(token: string): Promise<Signable | null> {
  if (!UUID.test(token)) {
    return null;
  }

  const supabase = createSupabaseServiceRoleClient();
  const [{ data: applicationData }, { data: contractData }] = await Promise.all([
    supabase.from("ugc_creator_applications").select("*").eq("join_token", token).maybeSingle(),
    supabase.from("ugc_creator_contracts").select("*").eq("join_token", token).maybeSingle(),
  ]);
  const application = applicationData as UgcCreatorApplicationRow | null;
  const contract = contractData as UgcCreatorContractRow | null;

  if (application && application.status === "approved" && (application.market === "si" || application.market === "balkans")) {
    return {
      kind: "application",
      id: application.id,
      fullName: application.full_name,
      market: application.market,
      locale: campaignLocale(application.market, application.locale),
      minor: application.age !== null && application.age < 18,
      pay: campaignPay(CREATOR_TERMS[application.market]),
      applied: true,
      acceptedAt: application.terms_accepted_at,
    };
  }

  const pay = contract ? parseContractPay(contract.pay) : null;

  if (contract && pay && contract.status !== "void") {
    return {
      kind: "contract",
      id: contract.id,
      fullName: contract.full_name,
      market: contract.market,
      locale: campaignLocale(contract.market, contract.locale),
      minor: contract.minor,
      pay,
      applied: false,
      acceptedAt: contract.signed_at,
    };
  }

  return null;
}

/** Cached per request, so the page and its metadata read the link once. */
export const loadSignable = Object.assign(cache(readSignable), {
  /** A fresh read, for after a write in the same request. */
  uncached: readSignable,
});

/** The exact terms this link is signed for. */
export function signableTerms(signable: Signable): string {
  return creatorTermsMarkdown(signable.locale, signable.market, { pay: signable.pay, applied: signable.applied });
}

/**
 * Records the signature, with the full text that was signed, word for word, so every
 * signed contract can be shown exactly as accepted later. Never overwrites an earlier
 * signature (two tabs at once), and `stored` is false when nothing was written (already
 * signed in another tab, or withdrawn in the meantime).
 */
export async function recordSignature(
  signable: Signable,
  signature: { signedName: string; guardianName: string | null; ip: string | null; userAgent: string | null; at: string },
): Promise<{ error: { message: string } | null; stored: boolean }> {
  const supabase = createSupabaseServiceRoleClient();

  if (signable.kind === "application") {
    const { data, error } = await updateIn(supabase, "ugc_creator_applications", {
      terms_version: CREATOR_TERMS_VERSION,
      terms_accepted_at: signature.at,
      terms_signed_name: signature.signedName,
      terms_guardian_name: signature.guardianName,
      terms_accepted_ip: signature.ip,
      terms_accepted_user_agent: signature.userAgent,
      terms_snapshot: signableTerms(signable),
    })
      .eq("id", signable.id)
      .eq("status", "approved")
      .is("terms_accepted_at", null)
      .select("id");

    return { error, stored: (data?.length ?? 0) > 0 };
  }

  const { data, error } = await updateIn(supabase, "ugc_creator_contracts", {
    status: "signed",
    terms_version: CREATOR_TERMS_VERSION,
    signed_at: signature.at,
    signed_name: signature.signedName,
    guardian_name: signature.guardianName,
    signed_ip: signature.ip,
    signed_user_agent: signature.userAgent,
    terms_snapshot: signableTerms(signable),
  })
    .eq("id", signable.id)
    .eq("status", "sent")
    .is("signed_at", null)
    .select("id");

  return { error, stored: (data?.length ?? 0) > 0 };
}
