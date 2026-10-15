import { notFound } from "next/navigation";

import { PendingLink } from "@/components/admin/pending-link";
import { Badge, formatDateTime, Section } from "@/components/admin/ui";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { requireAdmin } from "@/lib/admin/auth";
import { getContractRecord } from "@/lib/admin/contracts";
import { loadSignable, signableTerms } from "@/lib/ugc/creator-signing.server";

export const dynamic = "force-dynamic";

/**
 * One contract as it stands: the signature record and, once signed, the exact text that
 * was accepted (stored at the moment of signing, or as an admin last edited it).
 * Unsigned, it shows the text the creator will see.
 */
export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await params;
  const contract = await getContractRecord(id);

  if (!contract) {
    notFound();
  }

  const signable = contract.status === "sent" ? await loadSignable(contract.joinToken) : null;
  const text = contract.snapshot ?? (signable ? signableTerms(signable) : null);

  const facts: Array<[string, string]> = [
    ["Name signed", contract.signedName ?? "—"],
    ["Parent or guardian", contract.guardianName ?? "—"],
    ["Signed at", contract.signedAt ? formatDateTime(contract.signedAt) : "—"],
    ["Terms version", contract.termsVersion ?? "—"],
    ["Pay", contract.pay],
    ["IP address", contract.signedIp ?? "—"],
    ["Browser", contract.signedUserAgent ?? "—"],
    ["Email", contract.email ?? "—"],
    [
      "Last edited",
      contract.editedAt ? `${formatDateTime(contract.editedAt)}${contract.editedBy ? ` by ${contract.editedBy}` : ""}` : "—",
    ],
  ];

  return (
    <>
      <header className="admin-header">
        <div>
          <PendingLink className="admin-link" href="/admin/contracts">
            ← All contracts
          </PendingLink>
          <h1 className="admin-title">{contract.name}</h1>
          <p className="admin-subtitle">
            {contract.kind === "application" ? "Accepted applicant" : "Creator contract"} ·{" "}
            {contract.market === "si" ? "Slovenia" : "Balkans"}
          </p>
        </div>
        <div className="admin-contract-actions">
          {contract.status === "signed" ? (
            <Badge tone="green">Signed</Badge>
          ) : contract.status === "void" ? (
            <Badge tone="grey">Withdrawn</Badge>
          ) : (
            <Badge tone="red">Waiting for signature</Badge>
          )}
          <PendingLink className="admin-button" data-size="sm" href={`/admin/contracts/${contract.id}/edit`}>
            Edit
          </PendingLink>
        </div>
      </header>

      <Section title="Signature">
        <dl className="admin-contract-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        title={contract.snapshot ? "The text that was signed" : contract.status === "sent" ? "The text they will see" : "Text"}
        hint={
          contract.status === "signed" && !contract.snapshot
            ? "Signed before the exact text was kept with each signature; see the terms version above."
            : undefined
        }
      >
        {text ? (
          <div className="admin-contract-text">
            <MarkdownRenderer content={text} />
          </div>
        ) : (
          <p className="admin-help">No text to show.</p>
        )}
      </Section>
    </>
  );
}
