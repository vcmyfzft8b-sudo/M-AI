const SKELETON_ACTION_TILES = [0, 1, 2, 3];
const SKELETON_NOTE_ROWS = [0, 1, 2, 3];

/**
 * Mirrors the real dashboard's structure — "Nov zapisek" heading over the 2×2 action grid, then
 * "Moji zapiski" with its toolbar and note rows — using the same layout classes, so the swap to
 * real content changes pixels inside the shapes rather than the shapes themselves.
 */
export function DashboardLoading() {
  return (
    <div className="home-dashboard pb-8" aria-hidden="true" data-route-skeleton="">
      <section className="dashboard-section dashboard-create-section">
        <div className="dashboard-section-heading">
          <div className="app-loading-pill app-loading-pill-section" />
        </div>

        <div className="note-action-grid">
          {SKELETON_ACTION_TILES.map((tile) => (
            <div key={tile} className="note-action-card app-loading-card">
              <span className="note-action-card-icon app-loading-pill" />
              <span className="note-action-card-copy">
                <span className="app-loading-pill app-loading-pill-subtitle" />
                <span className="app-loading-row short" />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-section dashboard-library-section mt-4">
        <div className="dashboard-section-heading mb-4">
          <div className="app-loading-pill app-loading-pill-section" />
        </div>

        <div className="dashboard-toolbar library-toolbar">
          <div className="app-loading-pill app-loading-pill-subtitle" />
          <div className="ios-search notes-search app-loading-card" aria-hidden="true" />
        </div>

        {SKELETON_NOTE_ROWS.map((row) => (
          <div key={row} className="ios-row-note-card app-loading-card">
            <div className="app-loading-note" />
            <div className="app-loading-row short" />
          </div>
        ))}
      </section>
    </div>
  );
}
