import { AutoRefresh } from "@/components/admin/auto-refresh";
import { AreaChart, type ChartPoint } from "@/components/admin/chart";
import {
  Alert,
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
import {
  formatHourLabel,
  hourInReportZone,
  normalizeRangePreset,
  REPORT_TIME_ZONE,
  resolveRange,
} from "@/lib/admin/ranges";
import {
  getRealtimeVisitors,
  getVercelTraffic,
  type VercelTrafficHour,
} from "@/lib/admin/vercel-analytics";

type SearchParams = Promise<{ range?: string }>;

/**
 * The day view, charted by hour.
 *
 * A one-day range folds to a single daily point, which draws as a lone dot with
 * nothing to interpolate across. Vercel's buckets are hourly before they are
 * folded into days, so the day is redrawn straight from those: hours that saw
 * no traffic are filled back in so the line stays continuous, and hours that
 * have not happened yet are left off rather than plotted as zero.
 */
function hourlyPoints(hours: VercelTrafficHour[], day: string): ChartPoint[] {
  const byHour = new Map(
    hours.filter((entry) => entry.day === day).map((entry) => [entry.hour, entry]),
  );

  return Array.from({ length: hourInReportZone() + 1 }, (_, hour) => {
    const entry = byHour.get(hour);

    return {
      day,
      label: formatHourLabel(hour),
      value: entry?.visitors ?? 0,
      rows: [{ label: "Page views", value: formatExact(entry?.pageViews ?? 0) }],
    };
  });
}

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

  // Vercel files traffic with no referrer under an empty key, which `readRows`
  // normalises to "unknown". On a card that reads as a failure rather than as
  // what it is.
  const topReferrer = breakdown.referrers[0] ?? null;
  const topReferrerLabel =
    topReferrer && topReferrer.value !== "unknown" ? topReferrer.value : "Direct";

  const signedIn = online.filter((visitor) => visitor.userId);

  // Vercel sees every visitor; our beacon only sees the ones it can name. Trust
  // Vercel for the count and treat the difference as unidentified.
  const onlineCount = liveNow ?? online.length;
  const anonymous = Math.max(onlineCount - signedIn.length, 0);

  // Only the day view goes hourly; every other range is already wide enough to
  // draw a line, and Vercel is the only source with sub-daily buckets.
  const hourlyView = usingVercel && preset === "today";
  const chartPoints = hourlyView
    ? hourlyPoints(vercel.hours, range.to)
    : series.map((point) => ({
        day: point.day,
        value: point.visitors,
        rows: [{ label: "Page views", value: formatExact(point.pageViews) }],
      }));

  const hasTraffic = chartPoints.some((point) => point.value > 0);

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

      {/* Presence is only useful if it is current, so this page polls faster. */}
      <AutoRefresh live />

      {!usingVercel && (
        <Alert tone="info">
          <span>
            <strong>Only showing traffic since the beacon shipped.</strong> Vercel
            Web Analytics holds the full history for memoai.eu, but{" "}
            <code className="admin-mono">VERCEL_ANALYTICS_TOKEN</code> is not set,
            so the figures and the chart below start from today rather than
            months back. Create a token at{" "}
            <a
              className="admin-link"
              href="https://vercel.com/account/tokens"
              target="_blank"
              rel="noreferrer noopener"
            >
              vercel.com/account/tokens
            </a>{" "}
            and add it to the project&apos;s Production environment. Who is online
            below is unaffected.
          </span>
        </Alert>
      )}

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
        {/*
         * This slot held "New visitors" until it turned out nothing could fill
         * it honestly. The beacon counted a new visitor as a `site_sessions`
         * row whose `first_seen_at` fell in the window, and the `memo-visit`
         * cookie behind those rows expires after 24 hours -- so the same person
         * returning tomorrow was counted new again. No amount of accumulated
         * history fixes that, and Vercel does not break new against returning
         * down at all. Top referrer is the most useful thing either source can
         * actually answer for the selected window.
         */}
        <StatCard
          label="Top referrer"
          value={topReferrerLabel}
          meta={
            topReferrer
              ? usingVercel && visitors > 0
                ? `${Math.round((topReferrer.hits / visitors) * 100)}% of visits`
                : `${formatExact(topReferrer.hits)} page views`
              : "Nothing recorded for this window"
          }
        />
      </div>

      <Section
        title={hourlyView ? "Visits per hour" : "Visits per day"}
        hint={
          hourlyView
            ? `From Vercel Web Analytics, by hour in ${REPORT_TIME_ZONE.split("/")[1]} time. Each hour counts distinct devices, so someone active across two hours counts in both; the day total above is deduplicated and exact.`
            : usingVercel
              ? "From Vercel Web Analytics, which has recorded memoai.eu since March. Daily visitor counts are summed from hourly buckets, so someone spanning two hours counts twice; the window total above is deduplicated and exact."
              : "From the on-site beacon only, so this begins the day it shipped rather than months back."
        }
      >
        {hasTraffic ? (
          <AreaChart points={chartPoints} label="visits" />
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
