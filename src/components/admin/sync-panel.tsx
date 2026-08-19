import {
  pollSyncAction,
  reclassifyAction,
  startSyncAction,
} from "@/app/admin/(dashboard)/actions";
import type { UgcSyncRunRow } from "@/lib/database.types";

import { ActionForm, SubmitButton } from "./forms";
import { Badge, Card, formatRelative } from "./ui";

/** Collection status plus the manual controls for running one. */
export function SyncPanel({ syncRun }: { syncRun: UgcSyncRunRow | null }) {
  const running = syncRun?.status === "running";
  const apifyConfigured = Boolean(process.env.APIFY_TOKEN);

  return (
    <Card
      title="TikTok collection"
      hint={
        apifyConfigured
          ? "Pulls each active account's recent posts, then scores every new one for Memo AI content."
          : "APIFY_TOKEN is not set, so posts cannot be collected automatically yet."
      }
      actions={
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <ActionForm action={reclassifyAction} hideMessage>
            <SubmitButton variant="ghost" size="sm" pendingLabel="Re-checking…">
              Re-check detection
            </SubmitButton>
          </ActionForm>
          {running ? (
            <ActionForm action={pollSyncAction} hideMessage>
              <SubmitButton variant="default" pendingLabel="Checking…">
                Check progress
              </SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={startSyncAction} hideMessage>
              <SubmitButton pendingLabel="Starting…">Sync now</SubmitButton>
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
          A collection run takes a couple of minutes. Results are written the
          first time anyone checks progress after it finishes, and the daily cron
          does the same automatically.
        </p>
      )}
    </Card>
  );
}
