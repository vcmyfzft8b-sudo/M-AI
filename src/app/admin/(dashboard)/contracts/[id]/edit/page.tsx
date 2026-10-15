import { notFound } from "next/navigation";

import { ContractForm } from "@/components/admin/contract-form";
import { PendingLink } from "@/components/admin/pending-link";
import { Badge, formatDateTime, Section } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { getEditableContract } from "@/lib/admin/contracts";

export const dynamic = "force-dynamic";

/**
 * Edits any contract by hand: one created for a creator or an accepted applicant's
 * terms, signed or not. Saved in place on the same signing link; a signed contract stays
 * signed and now reads as edited. Nothing is sent to the creator.
 */
export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await params;
  const contract = await getEditableContract(id);

  if (!contract) {
    notFound();
  }

  const { terms } = contract;

  return (
    <>
      <header className="admin-header">
        <div>
          <PendingLink className="admin-link" href={`/admin/contracts/${contract.id}`}>
            ← Back to the contract
          </PendingLink>
          <h1 className="admin-title">Edit {contract.name}&apos;s contract</h1>
          <p className="admin-subtitle">
            {contract.kind === "application" ? "Accepted applicant" : "Creator contract"} · same signing link · nothing is
            sent to them
            {contract.editedAt
              ? ` · last edited ${formatDateTime(contract.editedAt)}${contract.editedBy ? ` by ${contract.editedBy}` : ""}`
              : ""}
          </p>
        </div>
        {contract.status === "signed" ? (
          <Badge tone="green">Signed</Badge>
        ) : contract.status === "void" ? (
          <Badge tone="grey">Withdrawn</Badge>
        ) : (
          <Badge tone="red">Waiting for signature</Badge>
        )}
      </header>

      <Section
        title="Contract"
        hint={
          contract.status === "signed"
            ? "Already signed. It stays signed and its stored text becomes what you save here; the signature record (name, time, IP, browser) is kept as it was."
            : "Not signed yet. The signing link shows the new version as soon as you save."
        }
      >
        {terms.payValid ? null : (
          <p className="admin-help">
            Its stored pay could not be read, so the pay fields below start from the campaign&apos;s standard pay. Check
            them before saving.
          </p>
        )}
        <ContractForm
          defaultName={contract.name}
          defaultEmail={contract.email ?? ""}
          defaultPay={terms.pay}
          contract={{
            id: contract.id,
            kind: contract.kind,
            market: terms.market,
            locale: terms.locale,
            minor: terms.minor,
            signed: terms.signed,
            text: terms.text,
            handWritten: terms.override !== null,
          }}
        />
      </Section>
    </>
  );
}
