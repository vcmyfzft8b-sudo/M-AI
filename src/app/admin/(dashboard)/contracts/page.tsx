import { ContractRow } from "@/components/admin/contract-row";
import { PendingLink } from "@/components/admin/pending-link";
import { EmptyState, Section, StatCard } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { listAllContracts, type ContractRecord } from "@/lib/admin/contracts";

export const dynamic = "force-dynamic";

type Filter = "all" | "sent" | "signed" | "void";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "sent", label: "Waiting" },
  { value: "signed", label: "Signed" },
  { value: "void", label: "Withdrawn" },
];

function isFilter(value: unknown): value is Filter {
  return value === "all" || value === "sent" || value === "signed" || value === "void";
}

/**
 * Every creator contract in one place, stored for good: the contracts created for
 * creators already in the program (from their creator page) and the terms every accepted
 * applicant signed. Each signed one links to the exact text that was accepted.
 */
export default async function ContractsPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  // The layout checks too, but this page shows names, emails and signatures.
  await requireAdmin();

  const params = await searchParams;
  const filter: Filter = isFilter(params?.status) ? params.status : "all";
  const contracts = await listAllContracts().catch((): ContractRecord[] => []);
  const count = (status: Filter) => (status === "all" ? contracts.length : contracts.filter((row) => row.status === status).length);
  const shown = contracts.filter((row) => filter === "all" || row.status === filter);

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Contracts</h1>
          <p className="admin-subtitle">
            Every creator contract, kept for good. Create one for a creator already in the program on their{" "}
            <PendingLink className="admin-link" href="/admin/creators">
              creator page
            </PendingLink>
            ; applicants sign theirs when accepted.
          </p>
        </div>
        <nav className="admin-range" aria-label="Status">
          {FILTERS.map((option) => (
            <PendingLink
              key={option.value}
              href={`/admin/contracts?status=${option.value}`}
              className="admin-range-item"
              data-active={option.value === filter}
            >
              {option.label} ({count(option.value)})
            </PendingLink>
          ))}
        </nav>
      </header>

      <div className="admin-grid">
        <StatCard label="Signed" value={String(count("signed"))} meta="Stored with the exact text accepted" />
        <StatCard label="Waiting for signature" value={String(count("sent"))} meta="Signing link not used yet" />
        <StatCard label="Withdrawn" value={String(count("void"))} meta="Links that no longer open" />
      </div>

      <Section title={FILTERS.find((option) => option.value === filter)?.label}>
        {shown.length === 0 ? (
          <EmptyState title="No contracts here yet">Create one from a creator&apos;s page.</EmptyState>
        ) : (
          <div className="admin-contracts">
            {shown.map((contract) => (
              <ContractRow key={`${contract.kind}-${contract.id}`} contract={contract} showCreatorLink />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
