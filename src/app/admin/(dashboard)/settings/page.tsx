import {
  addAdminAction,
  addRuleAction,
  deleteRuleAction,
  removeAdminAction,
  toggleRuleAction,
} from "@/app/admin/(dashboard)/actions";
import { ActionForm, InlineAction, SubmitButton } from "@/components/admin/forms";
import { SyncPanel } from "@/components/admin/sync-panel";
import { Badge, EmptyState, Section, formatDate, formatRelative } from "@/components/admin/ui";
import { listAdminUsers, requireAdmin } from "@/lib/admin/auth";
import type { UgcClassificationRuleRow } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getLatestSyncRun } from "@/lib/ugc/sync";

export const dynamic = "force-dynamic";

const KIND_HELP: Record<string, string> = {
  keyword: "Matched as a whole word anywhere in the caption",
  hashtag: "Matched against the post's hashtags",
  mention: "Matched against the accounts the post @-mentions",
  link: "Matched as a substring, for domains",
};

export default async function SettingsPage() {
  const context = await requireAdmin();
  const serviceRole = createSupabaseServiceRoleClient();

  const [admins, ruleResult, syncRun] = await Promise.all([
    listAdminUsers(),
    serviceRole
      .from("ugc_classification_rules")
      .select("*")
      .order("weight", { ascending: false })
      .order("kind", { ascending: true }),
    getLatestSyncRun(),
  ]);

  const rules = (ruleResult.data ?? []) as UgcClassificationRuleRow[];

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Settings</h1>
          <p className="admin-subtitle">
            Access, Memo AI detection rules and data collection
          </p>
        </div>
      </header>

      <SyncPanel syncRun={syncRun} />

      <Section
        title="Who can open this dashboard"
        hint="Anyone listed here can sign in with that email and see everything, including revenue."
      >
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Label</th>
                <th>Role</th>
                <th>Added</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td className="admin-mono">{admin.email}</td>
                  <td>{admin.label ?? "—"}</td>
                  <td>
                    <Badge tone={admin.role === "owner" ? "blue" : "grey"}>
                      {admin.role}
                    </Badge>
                  </td>
                  <td>{formatDate(admin.created_at)}</td>
                  <td>{formatRelative(admin.last_seen_at)}</td>
                  <td>
                    {admin.role === "owner" ? (
                      <span className="admin-help">cannot be removed</span>
                    ) : admin.id === context.admin.id ? (
                      <span className="admin-help">you</span>
                    ) : (
                      <InlineAction
                        action={removeAdminAction}
                        fields={{ admin_id: admin.id }}
                        variant="danger"
                        confirm={`Remove admin access for ${admin.email}?`}
                      >
                        Remove
                      </InlineAction>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-subblock">
          <ActionForm action={addAdminAction} resetOnSuccess>
            <div className="admin-form-grid">
              <div className="admin-field">
                <label className="admin-label" htmlFor="admin-add-email">
                  Email
                </label>
                <input
                  id="admin-add-email"
                  className="admin-input"
                  type="email"
                  name="email"
                  required
                  placeholder="teammate@example.com"
                />
                <span className="admin-help">
                  They sign in with the normal Memo AI login; the address just
                  has to match exactly.
                </span>
              </div>
              <div className="admin-field">
                <label className="admin-label" htmlFor="admin-add-label">
                  Label
                </label>
                <input
                  id="admin-add-label"
                  className="admin-input"
                  name="label"
                  placeholder="optional"
                />
              </div>
            </div>
            <div className="admin-form-actions">
              <SubmitButton pendingLabel="Adding…">Add admin</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </Section>

      <Section
        title="Memo AI detection rules"
        hint="Signals are added up per post. A post scoring 1.0 counts; 0.4–0.99 goes to the review queue; below that it is treated as personal."
      >
        {rules.length === 0 ? (
          <EmptyState title="No rules configured" />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th>Kind</th>
                  <th className="admin-num">Weight</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="admin-mono">
                      {rule.kind === "hashtag" ? "#" : rule.kind === "mention" ? "@" : ""}
                      {rule.pattern}
                    </td>
                    <td title={KIND_HELP[rule.kind]}>{rule.kind}</td>
                    <td className="admin-num">{Number(rule.weight).toFixed(2)}</td>
                    <td>
                      {rule.active ? (
                        <Badge tone="green">on</Badge>
                      ) : (
                        <Badge tone="grey">off</Badge>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <InlineAction
                          action={toggleRuleAction}
                          fields={{
                            rule_id: rule.id,
                            active: rule.active ? "false" : "true",
                          }}
                        >
                          {rule.active ? "Disable" : "Enable"}
                        </InlineAction>
                        <InlineAction
                          action={deleteRuleAction}
                          fields={{ rule_id: rule.id }}
                          variant="danger"
                          confirm={`Delete the "${rule.pattern}" rule and re-check every video?`}
                        >
                          Delete
                        </InlineAction>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-subblock">
          <ActionForm action={addRuleAction} resetOnSuccess>
            <div className="admin-form-grid">
              <div className="admin-field">
                <label className="admin-label" htmlFor="rule-pattern">
                  Pattern
                </label>
                <input
                  id="rule-pattern"
                  className="admin-input"
                  name="pattern"
                  required
                  placeholder="memoaislo"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label" htmlFor="rule-kind">
                  Kind
                </label>
                <select
                  id="rule-kind"
                  name="kind"
                  className="admin-select"
                  defaultValue="keyword"
                >
                  <option value="keyword">Keyword in caption</option>
                  <option value="hashtag">Hashtag</option>
                  <option value="mention">Mentioned account</option>
                  <option value="link">Link or domain</option>
                </select>
              </div>
              <div className="admin-field">
                <label className="admin-label" htmlFor="rule-weight">
                  Weight
                </label>
                <input
                  id="rule-weight"
                  className="admin-input"
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="1"
                  name="weight"
                  defaultValue="1"
                />
                <span className="admin-help">
                  1.0 counts a post on its own. Use less for an ambiguous word.
                </span>
              </div>
            </div>
            <div className="admin-form-actions">
              <SubmitButton pendingLabel="Adding…">Add rule</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </Section>

      <Section title="How detection works">
        <div className="admin-list">
          <div className="admin-list-row">
            <span className="admin-list-label">Dedicated account</span>
            <span className="admin-list-value">Every post counts</span>
          </div>
          <div className="admin-list-row">
            <span className="admin-list-label">Personal account</span>
            <span className="admin-list-value">No post ever counts</span>
          </div>
          <div className="admin-list-row">
            <span className="admin-list-label">Mixed account</span>
            <span className="admin-list-value">Scored post by post</span>
          </div>
          <div className="admin-list-row">
            <span className="admin-list-label">Creator&apos;s promo code in caption</span>
            <span className="admin-list-value">Counts on its own</span>
          </div>
          <div className="admin-list-row">
            <span className="admin-list-label">Manual decision</span>
            <span className="admin-list-value">Always wins, never overwritten</span>
          </div>
        </div>
        <p className="admin-help" style={{ marginTop: "0.875rem" }}>
          Changing a rule or an account&apos;s mode re-runs detection over every
          stored post, except the ones you have decided by hand.
        </p>
      </Section>
    </>
  );
}
