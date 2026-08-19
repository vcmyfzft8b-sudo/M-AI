/**
 * Loading skeletons for the admin dashboard.
 *
 * Shaped like the page that is coming rather than a generic spinner, so the
 * layout does not jump when the real content arrives and the eye already knows
 * where to look.
 */

export function AdminSkeletonHeader() {
  return (
    <div className="admin-header" aria-hidden="true">
      <div>
        <div className="admin-skel admin-skel-title" />
        <div className="admin-skel admin-skel-subtitle" />
      </div>
      <div className="admin-skel admin-skel-range" />
    </div>
  );
}

export function AdminSkeletonTiles({ count = 8 }: { count?: number }) {
  return (
    <div className="admin-tiles" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="admin-tile" key={index} data-static="true">
          <div className="admin-skel admin-skel-label" />
          <div className="admin-skel admin-skel-value" />
        </div>
      ))}
    </div>
  );
}

export function AdminSkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="admin-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="admin-stat" key={index}>
          <div className="admin-skel admin-skel-label" />
          <div className="admin-skel admin-skel-value" />
          <div className="admin-skel admin-skel-meta" />
        </div>
      ))}
    </div>
  );
}

export function AdminSkeletonChart() {
  return <div className="admin-skel admin-skel-chart" aria-hidden="true" />;
}

export function AdminSkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <div className="admin-skel admin-skel-thead" />
      {Array.from({ length: rows }, (_, index) => (
        <div className="admin-skel admin-skel-trow" key={index} />
      ))}
    </div>
  );
}

export function AdminSkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="admin-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="admin-list-row" key={index}>
          <div className="admin-skel admin-skel-label" style={{ width: "40%" }} />
          <div className="admin-skel admin-skel-label" style={{ width: "18%" }} />
        </div>
      ))}
    </div>
  );
}

export function AdminSkeletonSection({
  children,
}: {
  children?: React.ReactNode;
}) {
  return (
    <section className="admin-section" aria-hidden="true">
      <div className="admin-section-head">
        <div className="admin-skel admin-skel-section-title" />
      </div>
      {children}
    </section>
  );
}

/** The default page skeleton: header, metrics, a chart and a table. */
export function AdminPageSkeleton({
  tiles = 8,
  chart = true,
  table = true,
}: {
  tiles?: number;
  chart?: boolean;
  table?: boolean;
}) {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      <AdminSkeletonHeader />
      <AdminSkeletonTiles count={tiles} />
      {chart && <AdminSkeletonChart />}
      {table && (
        <AdminSkeletonSection>
          <AdminSkeletonTable />
        </AdminSkeletonSection>
      )}
    </div>
  );
}
