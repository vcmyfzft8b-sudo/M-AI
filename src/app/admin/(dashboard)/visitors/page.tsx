import { AreaChart } from "@/components/admin/chart";
import {
  Badge,
  BarRow,
  Card,
  EmptyState,
  formatCount,
  formatExact,
  formatRelative,
  RangeTabs,
  StatCard,
} from "@/components/admin/ui";
import {
  getOnlineVisitors,
  getTrafficBreakdown,
  getTrafficSummary,
  ONLINE_WINDOW_MINUTES,
} from "@/lib/admin/analytics";
import { normalizeRangePreset, resolveRange } from "@/lib/admin/ranges";

type SearchParams = Promise<{ range?: string }>;

export const dynamic = "force-dynamic";

export default async function VisitorsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = await searchParams;
  const preset = normalizeRangePreset(params?.range);
  const range = resolveRange(preset);

  const [summary, breakdown, online] = await Promise.all([
    getTrafficSummary(range),
    getTrafficBreakdown(range),
    getOnlineVisitors(),
  ]);

  const signedIn = online.filter((visitor) => visitor.userId);
  const anonymous = online.length - signedIn.length;

  const hasTraffic = summary.series.some((point) => point.visitors > 0);

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Visitors</h1>
          <p className="admin-subtitle">
            memoai.eu traffic · {range.label.toLowerCase()}
          </p>
        </div>
        <RangeTabs active={preset} basePath="/admin/visitors" />
      </header>

      <div className="admin-grid">
        <StatCard
          label="Online now"
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              {formatExact(online.length)}
              {online.length > 0 && (
                <span
                  className="admin-dot"
                  data-pulse="true"
                  style={{ color: "var(--green)" }}
                />
              )}
            </span>
          }
          meta={`${signedIn.length} signed in · ${anonymous} anonymous`}
        />
        <StatCard
          label="Visits"
          value={formatCount(summary.visitors)}
          current={summary.visitors}
          previous={range.previous ? summary.previousVisitors : undefined}
          meta={`${formatExact(summary.visitors)} exact`}
        />
        <StatCard
          label="Page views"
          value={formatCount(summary.pageViews)}
          meta={
            summary.visitors > 0
              ? `${(summary.pageViews / summary.visitors).toFixed(1)} per visit`
              : undefined
          }
        />
        <StatCard
          label="New visitors"
          value={formatCount(summary.newVisitors)}
          meta="First time on the site"
        />
      </div>

      <div className="admin-section">
        <Card title="Visits per day">
          {hasTraffic ? (
            <AreaChart
              points={summary.series.map((point) => ({
                day: point.day,
                value: point.visitors,
                detail: `${point.pageViews} page views · ${point.newVisitors} new`,
              }))}
              label="visits"
            />
          ) : (
            <EmptyState title="No traffic recorded yet">
              Traffic starts appearing as soon as this build is live and someone
              visits memoai.eu.
            </EmptyState>
          )}
        </Card>
      </div>

      <div className="admin-section">
        <Card
          title={`Who is online (${online.length})`}
          hint={`Anyone active in the last ${ONLINE_WINDOW_MINUTES} minutes.`}
          bodyless
        >
          {online.length === 0 ? (
            <EmptyState title="Nobody on the site right now" />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Visitor</th>
                    <th>On page</th>
                    <th>Country</th>
                    <th>Device</th>
                    <th className="admin-num">Pages</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {online.map((visitor) => (
                    <tr key={visitor.sessionId}>
                      <td>
                        {visitor.email ? (
                          <>
                            <span className="admin-creator-name">
                              {visitor.fullName || visitor.email}
                            </span>
                            {visitor.fullName && (
                              <>
                                <br />
                                <span className="admin-creator-handle">
                                  {visitor.email}
                                </span>
                              </>
                            )}
                          </>
                        ) : (
                          <Badge tone="grey">anonymous</Badge>
                        )}
                      </td>
                      <td className="admin-mono">{visitor.lastPath ?? "—"}</td>
                      <td>{visitor.country ?? "—"}</td>
                      <td>{visitor.deviceType ?? "—"}</td>
                      <td className="admin-num">{visitor.pageViews}</td>
                      <td>{formatRelative(visitor.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="admin-section admin-two-col">
        <Card title="Top pages">
          {breakdown.paths.length === 0 ? (
            <EmptyState title="No page views yet" />
          ) : (
            <div className="admin-list">
              {breakdown.paths.map((row) => (
                <BarRow
                  key={row.value}
                  label={row.value}
                  value={row.hits}
                  max={breakdown.paths[0].hits}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Where they came from">
          {breakdown.referrers.length === 0 ? (
            <EmptyState title="No referrers yet" />
          ) : (
            <div className="admin-list">
              {breakdown.referrers.map((row) => (
                <BarRow
                  key={row.value}
                  label={row.value}
                  value={row.hits}
                  max={breakdown.referrers[0].hits}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Countries">
          {breakdown.countries.length === 0 ? (
            <EmptyState title="No country data yet" />
          ) : (
            <div className="admin-list">
              {breakdown.countries.map((row) => (
                <BarRow
                  key={row.value}
                  label={row.value}
                  value={row.hits}
                  max={breakdown.countries[0].hits}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Devices">
          {breakdown.devices.length === 0 ? (
            <EmptyState title="No device data yet" />
          ) : (
            <div className="admin-list">
              {breakdown.devices.map((row) => (
                <BarRow
                  key={row.value}
                  label={row.value}
                  value={row.hits}
                  max={breakdown.devices[0].hits}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
