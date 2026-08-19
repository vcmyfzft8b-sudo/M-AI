import { pollSyncAction, reclassifyAction } from "@/app/admin/(dashboard)/actions";
import type { UgcSyncRunRow } from "@/lib/database.types";

import { ActionForm, SubmitButton } from "./forms";
import { Badge, formatRelative, Section } from "./ui";

/**
 * Collection status.
 *
 * There is deliberately no button that starts a scrape. Collection is billed
 * per post and belongs to the nightly job, which runs late enough to capture
 * the day that is ending; a button anyone could press turns a fixed cost into
 * an unpredictable one and can produce a second snapshot for a day that already
 * has one.
 *
 * The two controls that remain touch TikTok not at all: re-checking detection
 * re-scores posts already stored, and checking progress only finishes ingesting
 * a run the nightly job already paid for.
 */
export function SyncPanel({ syncRun }: { syncRun: UgcSyncRunRow | null }) {
  const running = syncRun?.status === "running";
  const apifyConfigured = Boolean(process.env.APIFY_TOKEN);

  return (
    <Section
      title="TikTok collection"
      hint={
        apifyConfigured
          ? "Runs once a night at 23:50, pulling each active account's recent posts and scoring every new one for Memo AI content. That is the only time TikTok is read."
          : "APIFY_TOKEN is not set, so posts cannot be collected automatically yet."
      }
      actions={
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <ActionForm action={reclassifyAction} hideMessage>
            <SubmitButton variant="ghost" size="sm" pendingLabel="Re-checking…">
              Re-check detection
            </SubmitButton>
          </ActionForm>
          {/* Only reachable if a nightly run outlived its budget. It ingests
              what was already collected; it never starts a new scrape. */}
          {running && (
            <ActionForm action={pollSyncAction} hideMessage>
              <SubmitButton variant="default" pendingLabel="Checking…">
                Finish ingesting
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      }
    >
      <div className="admin-list">
        <div className="admin-list-row">
          <span className="admin-list-label">Status</span>
          <span className="admin-list-value">
            {!syncRun ? (
              <Badge tone="grey">never run</Badge>
            ) : running ? (
              <Badge tone="blue" pulse>
                collecting
              </Badge>
            ) : syncRun.status === "ok" ? (
              <Badge tone="green">ok</Badge>
            ) : syncRun.status === "partial" ? (
              <Badge tone="grey">partial</Badge>
            ) : (
              <Badge tone="red">failed</Badge>
            )}
          </span>
        </div>

        <div className="admin-list-row">
          <span className="admin-list-label">Last run</span>
          <span className="admin-list-value">
            {formatRelative(syncRun?.finished_at ?? syncRun?.started_at ?? null)}
          </span>
        </div>

        {syncRun && !running && (
          <div className="admin-list-row">
            <span className="admin-list-label">Collected</span>
            <span className="admin-list-value">
              {syncRun.videos_seen} videos · {syncRun.videos_created} new ·{" "}
              {syncRun.accounts_synced}/{syncRun.accounts_total} accounts
            </span>
          </div>
        )}

        {syncRun?.error && (
          <div className="admin-list-row">
            <span className="admin-list-label">Note</span>
            <span
              className="admin-list-value"
              style={{ color: "var(--red)", whiteSpace: "normal", textAlign: "right" }}
            >
              {syncRun.error}
            </span>
          </div>
        )}
      </div>

      {running && (
        <p className="admin-help" style={{ marginTop: "0.875rem" }}>
          The nightly run is still collecting, or ran out of time before it could
          store what it collected. Nothing is lost either way — the next run
          ingests it, and “Finish ingesting” does the same now without scraping
          anything again.
        </p>
      )}
    </Section>
  );
}
