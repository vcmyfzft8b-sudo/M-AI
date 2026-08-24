const SKELETON_ACTION_TILES = [0, 1, 2, 3];
const SKELETON_NOTE_ROWS = [0, 1, 2, 3];

/**
 * Mirrors the real dashboard, sized from measurements of the live page (desktop, 2026-08-22):
 * action card 108px with a 48px icon, note row 101px with a 24px title and 18px subtitle line,
 * section heading 29px, toolbar row 48px. The containers reuse the real layout classes so the
 * swap to content changes pixels inside the shapes, never the shapes themselves.
 */
export function DashboardLoading() {
  return (
    <div className="home-dashboard pb-8" aria-hidden="true" data-route-skeleton="">
      <section className="dashboard-section dashboard-create-section">
        <div className="dashboard-section-heading" style={{ minHeight: "1.8rem" }}>
          <div className="app-loading-pill" style={{ height: "1.35rem", width: "7.5rem" }} />
        </div>

        <div className="note-action-grid">
          {SKELETON_ACTION_TILES.map((tile) => (
            <div key={tile} className="note-action-card">
              <span className="note-action-card-icon app-loading-pill" style={{ borderRadius: "50%" }} />
              <span className="note-action-card-copy" style={{ gap: "0.4rem" }}>
                <span className="app-loading-pill" style={{ height: "1rem", width: "55%" }} />
                <span className="app-loading-pill" style={{ height: "0.7rem", width: "80%" }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-section dashboard-library-section mt-4">
        <div className="dashboard-section-heading mb-4" style={{ minHeight: "1.8rem" }}>
          <div className="app-loading-pill" style={{ height: "1.35rem", width: "7rem" }} />
        </div>

        <div className="dashboard-toolbar library-toolbar" style={{ alignItems: "center" }}>
          <div
            className="app-loading-pill"
            style={{ height: "3rem", width: "8.5rem", borderRadius: "0.8rem", alignSelf: "flex-start" }}
          />
          <div className="ios-search notes-search" style={{ minHeight: "2.7rem" }} />
        </div>

        {SKELETON_NOTE_ROWS.map((row) => (
          <div
            key={row}
            className="ios-row-note-card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              minHeight: "6.3rem",
            }}
          >
            <div
              className="app-loading-pill"
              style={{ width: "3.2rem", height: "3.2rem", borderRadius: "50%", flexShrink: 0 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", flex: 1 }}>
              <div className="app-loading-pill" style={{ height: "1rem", width: "55%" }} />
              <div className="app-loading-pill" style={{ height: "0.7rem", width: "32%" }} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
