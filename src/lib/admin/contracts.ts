import "server-only";

import { loadEveryRow } from "@/lib/admin/paged-rows";
import type { UgcCreatorApplicationRow, UgcCreatorContractRow } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { applicationRowTerms, contractRowTerms, type ContractTerms } from "@/lib/ugc/contract-rows";
import { describeContractPay } from "@/lib/ugc/creator-pay";

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
  /** When and by whom an admin last edited it (`/admin/contracts/<id>/edit`). */
  editedAt: string | null;
  editedBy: string | null;
};

function fromContract(row: UgcCreatorContractRow): ContractRecord {
  const terms = contractRowTerms(row);

  return {
    kind: "contract",
    id: row.id,
    creatorId: row.creator_id,
    name: row.full_name,
    email: row.email,
    market: row.market,
    status: row.status,
    pay: terms.payValid ? describeContractPay(terms.pay) : "—",
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
    editedAt: row.edited_at,
    editedBy: row.edited_by,
  };
}

function fromApplication(row: UgcCreatorApplicationRow & { market: "si" | "balkans" }): ContractRecord {
  const terms = applicationRowTerms(row);

  return {
    kind: "application",
    id: row.id,
    creatorId: null,
    name: row.full_name,
    email: row.email,
    market: row.market,
    status: row.terms_accepted_at ? "signed" : "sent",
    // The campaign's pay under the terms version they accepted, unless the admin gave them their own.
    pay: `${describeContractPay(terms.pay)}${terms.standardPay ? " (campaign)" : ""}`,
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
    editedAt: row.terms_edited_at,
    editedBy: row.terms_edited_by,
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

/** A contract row or an accepted applicant's row, by id: the two never share one. */
export type ContractSource =
  | { kind: "contract"; row: UgcCreatorContractRow }
  | { kind: "application"; row: UgcCreatorApplicationRow & { market: "si" | "balkans" } };

export async function loadContractSource(id: string): Promise<ContractSource | null> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: contract }, { data: application }] = await Promise.all([
    supabase.from("ugc_creator_contracts").select("*").eq("id", id).maybeSingle(),
    supabase.from("ugc_creator_applications").select("*").eq("id", id).maybeSingle(),
  ]);

  if (contract) {
    return { kind: "contract", row: contract as UgcCreatorContractRow };
  }

  const row = application as UgcCreatorApplicationRow | null;

  return row && (row.status === "approved" || row.terms_accepted_at) && (row.market === "si" || row.market === "balkans")
    ? { kind: "application", row: row as UgcCreatorApplicationRow & { market: "si" | "balkans" } }
    : null;
}

export function contractSourceTerms(source: ContractSource): ContractTerms {
  return source.kind === "contract" ? contractRowTerms(source.row) : applicationRowTerms(source.row);
}

/** One contract or accepted application by id, for its own page. */
export async function getContractRecord(id: string): Promise<ContractRecord | null> {
  const source = await loadContractSource(id);

  return source ? (source.kind === "contract" ? fromContract(source.row) : fromApplication(source.row)) : null;
}

/** Everything the edit form shows and can change. */
export type EditableContract = {
  kind: ContractSource["kind"];
  id: string;
  name: string;
  email: string | null;
  status: ContractRecord["status"];
  terms: ContractTerms;
  editedAt: string | null;
  editedBy: string | null;
};

export async function getEditableContract(id: string): Promise<EditableContract | null> {
  const source = await loadContractSource(id);

  if (!source) {
    return null;
  }

  const record = source.kind === "contract" ? fromContract(source.row) : fromApplication(source.row);

  return {
    kind: source.kind,
    id: record.id,
    name: record.name,
    email: record.email,
    status: record.status,
    terms: contractSourceTerms(source),
    editedAt: record.editedAt,
    editedBy: record.editedBy,
  };
}
