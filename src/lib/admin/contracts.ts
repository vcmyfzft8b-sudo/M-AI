import "server-only";

import { loadEveryRow } from "@/lib/admin/paged-rows";
import type { UgcCreatorApplicationRow, UgcCreatorContractRow } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { campaignTermsAt } from "@/lib/ugc/creator-campaigns";
import { campaignPay, describeContractPay, parseContractPay } from "@/lib/ugc/creator-pay";

/**
 * Every creator contract, for `/admin/contracts` and each creator's page: the contracts
 * created for creators already in the program (`ugc_creator_contracts`, their own deal)
 * and the terms accepted applicants signed (`ugc_creator_applications`, campaign pay).
 * Service role only, after the allowlist check.
 */

export type ContractRecord = {
  kind: "contract" | "application";
  id: string;
  creatorId: string | null;
  name: string;
  email: string | null;
  market: "si" | "balkans";
  status: "sent" | "signed" | "void";
  pay: string;
  joinToken: string;
  createdAt: string;
  signedAt: string | null;
  signedName: string | null;
  guardianName: string | null;
  signedIp: string | null;
  signedUserAgent: string | null;
  termsVersion: string | null;
  /** The exact text that was signed; null until signed (and for signatures from before it was kept). */
  snapshot: string | null;
  createdBy: string | null;
};

function fromContract(row: UgcCreatorContractRow): ContractRecord {
  const pay = parseContractPay(row.pay);

  return {
    kind: "contract",
    id: row.id,
    creatorId: row.creator_id,
    name: row.full_name,
    email: row.email,
    market: row.market,
    status: row.status,
    pay: pay ? describeContractPay(pay) : "—",
    joinToken: row.join_token,
    createdAt: row.created_at,
    signedAt: row.signed_at,
    signedName: row.signed_name,
    guardianName: row.guardian_name,
    signedIp: row.signed_ip,
    signedUserAgent: row.signed_user_agent,
    termsVersion: row.terms_version,
    snapshot: row.terms_snapshot,
    createdBy: row.created_by,
  };
}

function fromApplication(row: UgcCreatorApplicationRow & { market: "si" | "balkans" }): ContractRecord {
  return {
    kind: "application",
    id: row.id,
    creatorId: null,
    name: row.full_name,
    email: row.email,
    market: row.market,
    status: row.terms_accepted_at ? "signed" : "sent",
    // What they signed: the campaign's pay under the terms version they accepted.
    pay: `${describeContractPay(campaignPay(campaignTermsAt(row.market, row.terms_accepted_at ? row.terms_version : null)))} (campaign)`,
    joinToken: row.join_token,
    createdAt: row.reviewed_at ?? row.created_at,
    signedAt: row.terms_accepted_at,
    signedName: row.terms_signed_name,
    guardianName: row.terms_guardian_name,
    signedIp: row.terms_accepted_ip,
    signedUserAgent: row.terms_accepted_user_agent,
    termsVersion: row.terms_version,
    snapshot: row.terms_snapshot,
    createdBy: row.reviewed_by,
  };
}

export async function listCreatorContracts(creatorId: string): Promise<ContractRecord[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("ugc_creator_contracts")
    .select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Contracts could not be read: ${error.message}`);
  }

  return ((data ?? []) as UgcCreatorContractRow[]).map(fromContract);
}

/** Every contract and every accepted applicant's terms, newest first. */
export async function listAllContracts(): Promise<ContractRecord[]> {
  const supabase = createSupabaseServiceRoleClient();
  const [contracts, applications] = await Promise.all([
    loadEveryRow<UgcCreatorContractRow>((from, to) =>
      supabase
        .from("ugc_creator_contracts")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
        .then(({ data, error }) => ({ data: data as UgcCreatorContractRow[] | null, error })),
    ),
    loadEveryRow<UgcCreatorApplicationRow>((from, to) =>
      supabase
        .from("ugc_creator_applications")
        .select("*")
        .or("status.eq.approved,terms_accepted_at.not.is.null")
        .in("market", ["si", "balkans"])
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
        .then(({ data, error }) => ({ data: data as UgcCreatorApplicationRow[] | null, error })),
    ),
  ]);

  return [
    ...contracts.map(fromContract),
    ...applications.map((row) => fromApplication(row as UgcCreatorApplicationRow & { market: "si" | "balkans" })),
  ].sort((a, b) => (b.signedAt ?? b.createdAt).localeCompare(a.signedAt ?? a.createdAt));
}

/** One contract or accepted application by id, for its own page. */
export async function getContractRecord(id: string): Promise<ContractRecord | null> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: contract }, { data: application }] = await Promise.all([
    supabase.from("ugc_creator_contracts").select("*").eq("id", id).maybeSingle(),
    supabase.from("ugc_creator_applications").select("*").eq("id", id).maybeSingle(),
  ]);

  if (contract) {
    return fromContract(contract as UgcCreatorContractRow);
  }

  const row = application as UgcCreatorApplicationRow | null;

  return row && (row.status === "approved" || row.terms_accepted_at) && (row.market === "si" || row.market === "balkans")
    ? fromApplication(row as UgcCreatorApplicationRow & { market: "si" | "balkans" })
    : null;
}
