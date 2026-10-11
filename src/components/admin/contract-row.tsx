import { voidCreatorContractAction } from "@/app/admin/(dashboard)/actions";
import { CopyLink } from "@/components/admin/copy-link";
import { InlineAction } from "@/components/admin/forms";
import { PendingLink } from "@/components/admin/pending-link";
import { Badge, formatDateTime } from "@/components/admin/ui";
import type { ContractRecord } from "@/lib/admin/contracts";
import { creatorJoinUrl } from "@/lib/ugc/send-acceptance-email";

const CAMPAIGN = { si: "Slovenia", balkans: "Balkans" } as const;

/**
 * One contract: who, the deal, and where it stands. Unsigned, it shows the signing link
 * to copy and send (nothing is emailed from here); signed, who signed when, and a link to
 * the exact text they accepted.
 */
export function ContractRow({ contract, showCreatorLink = false }: { contract: ContractRecord; showCreatorLink?: boolean }) {
  return (
    <div className="admin-contract" data-status={contract.status}>
      <div className="admin-contract-head">
        <strong>{contract.name}</strong>
        {contract.status === "signed" ? (
          <Badge tone="green">Signed</Badge>
        ) : contract.status === "void" ? (
          <Badge tone="grey">Withdrawn</Badge>
        ) : (
          <Badge tone="red">Waiting for signature</Badge>
        )}
        <Badge tone="blue">{contract.kind === "application" ? `Applicant · ${CAMPAIGN[contract.market]}` : CAMPAIGN[contract.market]}</Badge>
        {showCreatorLink && contract.creatorId ? (
          <PendingLink className="admin-link" href={`/admin/creators/${contract.creatorId}`}>
            Creator page
          </PendingLink>
        ) : null}
      </div>

      <p className="admin-contract-pay">{contract.pay}</p>

      {contract.status === "signed" ? (
        <p className="admin-help">
          Signed {contract.signedAt ? formatDateTime(contract.signedAt) : ""} as “{contract.signedName}”
          {contract.guardianName ? `, with parent or guardian “${contract.guardianName}”` : ""} · terms version{" "}
          {contract.termsVersion ?? "—"} ·{" "}
          <PendingLink className="admin-link" href={`/admin/contracts/${contract.id}`}>
            View the signed contract
          </PendingLink>
        </p>
      ) : contract.status === "sent" ? (
        <div className="admin-contract-link">
          <span className="admin-help">Signing link, to send them yourself:</span>
          <CopyLink href={creatorJoinUrl(contract.joinToken)} />
        </div>
      ) : null}

      <p className="admin-help">
        {contract.kind === "application" ? "Accepted" : "Created"} {formatDateTime(contract.createdAt)}
        {contract.createdBy ? ` by ${contract.createdBy}` : ""}
        {contract.email ? ` · ${contract.email}` : ""}
      </p>

      {contract.kind === "contract" && contract.status === "sent" ? (
        <InlineAction
          action={voidCreatorContractAction}
          fields={{ contract_id: contract.id }}
          variant="danger"
          confirm={`Withdraw the contract for ${contract.name}? Its link stops working.`}
        >
          Withdraw
        </InlineAction>
      ) : null}
    </div>
  );
}
