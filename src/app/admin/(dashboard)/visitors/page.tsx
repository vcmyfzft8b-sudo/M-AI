import { AreaChart } from "@/components/admin/chart";
import {
  Badge,
  BarRow,
  Section,
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
import {
  getRealtimeVisitors,
  getVercelTraffic,
} from "@/lib/admin/vercel-analytics";

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

  const [summary, ownBreakdown, online, vercel, previousVercel, liveNow] =
    await Promise.all([
    getTrafficSummary(range),
    getTrafficBreakdown(range),
    getOnlineVisitors(),
    getVercelTraffic(range),
    range.previous ? getVercelTraffic(range.previous) : Promise.resolve(null),
    getRealtimeVisitors(),
  ]);

  // Vercel Web Analytics has been recording since long before our own beacon
  // shipped, so it is the source for history. The beacon still owns "who is
  // online", which Vercel does not expose.
  const usingVercel = vercel !== null;
  const series = usingVercel ? vercel.series : summary.series;
  const visitors = usingVercel ? vercel.visitors : summary.visitors;
  const pageViews = usingVercel ? vercel.pageViews : summary.pageViews;
  const previousVisitors = usingVercel
    ? (previousVercel?.visitors ?? 0)
    : summary.previousVisitors;

  const breakdown = usingVercel
    ? {
        paths: vercel.paths.map((row) => ({ value: row.value, hits: row.visitors })),
        referrers: vercel.referrers.map((row) => ({
          value: row.value,
          hits: row.visitors,
        })),
        countries: vercel.countries.map((row) => ({
          value: row.value,
          hits: row.visitors,
        })),
        devices: vercel.browsers.map((row) => ({
          value: row.value,
          hits: row.visitors,
        })),
      }
    : ownBreakdown;

  const signedIn = online.filter((visitor) => visitor.userId);

  // Vercel sees every visitor; our beacon only sees the ones it can name. Trust
  // Vercel for the count and treat the difference as unidentified.
  const onlineCount = liveNow ?? online.length;
  const anonymous = Math.max(onlineCount - signedIn.length, 0);

  const hasTraffic = series.some((point) => point.visitors > 0);

  return (
    <>
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Visitors</h1>
          <p className="admin-subtitle">
            memoai.eu traffic · {range.label.toLowerCase()} ·{" "}
            {usingVercel ? "Vercel Web Analytics" : "on-site beacon"}
          </p>
        </div>
        <RangeTabs active={preset} basePath="/admin/visitors" />
      </header>

      <div className="admin-grid">
        <StatCard
          label="Online now"
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              {formatExact(onlineCount)}
              {onlineCount > 0 && (
                <span
                  className="admin-dot"
                  data-pulse="true"
                  style={{ color: "var(--green)" }}
                />
              )}
            </span>
          }
          meta={
            liveNow === null
              ? `${signedIn.length} signed in · ${anonymous} anonymous`
              : `${signedIn.length} identified · ${anonymous} anonymous · live from Vercel`
          }
        />
        <StatCard
          label="Visits"
          value={formatCount(visitors)}
          current={visitors}
          previous={range.previous ? previousVisitors : undefined}
          meta={`${formatExact(visitors)} exact`}
        />
        <StatCard
          label="Page views"
          value={formatCount(pageViews)}
          meta={
            visitors > 0
              ? `${(pageViews / visitors).toFixed(1)} per visit`
              : undefined
          }
        />
        <StatCard
          label="New visitors"
          value={formatCount(summary.newVisitors)}
          meta={
            usingVercel
              ? "First-time, from the on-site beacon"
              : "First time on the site"
          }
        />
      </div>

      <Section
        title="Visits per day"
        hint={
          usingVercel
            ? "From Vercel Web Analytics, which has recorded memoai.eu since March. Daily visitor counts are summed from hourly buckets, so someone spanning two hours counts twice; the window total above is deduplicated and exact."
            : "From the on-site beacon, which only knows about traffic since it shipped. Set VERCEL_ANALYTICS_TOKEN to chart the full history."
        }
      >
        {hasTraffic ? (
          <AreaChart
            points={series.map((point) => ({
              day: point.day,
              value: point.visitors,
              detail: `${point.pageViews} page views`,
            }))}
            label="visits"
          />
        ) : (
          <EmptyState title="No traffic recorded yet">
            Traffic starts appearing as soon as this build is live and someone
            visits memoai.eu.
          </EmptyState>
        )}
      </Section>

      <Section
        title={`Who is online (${online.length})`}
        hint={`Anyone active in the last ${ONLINE_WINDOW_MINUTES} minutes.`}
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
      </Section>

      <div className="admin-section admin-two-col">
        <Section title="Top pages">
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
        </Section>

        <Section title="Where they came from">
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
        </Section>

        <Section title="Countries">
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
        </Section>

        <Section title={usingVercel ? "Browsers" : "Devices"}>
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
        </Section>
      </div>
    </>
  );
}
