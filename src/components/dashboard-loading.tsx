const SKELETON_ACTION_TILES = [0, 1, 2, 3];
const SKELETON_NOTE_ROWS = [0, 1, 2, 3];

/**
 * The home screen's shapes, so the swap to real content changes pixels inside
 * the shapes rather than the shapes themselves. Sized from the redesign: quick
 * action 5.1rem, note row 5.4rem, both 20px radius.
 */
export function DashboardLoading() {
  return (
    <div className="memo-home-screen" aria-hidden="true" data-route-skeleton="">
      <div className="memo-home-scroll">
        <div className="memo-only-desktop">
          <div className="app-loading-pill" style={{ height: "1.4rem", width: "9rem" }} />
          <div
            className="app-loading-pill"
            style={{ height: "0.95rem", width: "21rem", marginTop: "0.5rem" }}
          />

          <div className="memo-quick-grid">
            {SKELETON_ACTION_TILES.map((tile) => (
              <div key={tile} className="memo-quick-card">
                <span
                  className="memo-quick-tile app-loading-pill"
                  style={{ borderRadius: "999px" }}
                />
                <span className="app-loading-pill" style={{ height: "1.1rem", width: "9rem" }} />
              </div>
            ))}
          </div>

          <div
            className="app-loading-pill"
            style={{ height: "1.4rem", width: "8rem", marginTop: "2.6rem" }}
          />
        </div>

        <div className="memo-library-bar memo-only-desktop">
          <div
            className="app-loading-pill"
            style={{ height: "3.4rem", width: "11rem", borderRadius: "18px" }}
          />
        </div>

        <div className="memo-home-body">
          <div className="memo-note-list">
            {SKELETON_NOTE_ROWS.map((row) => (
              <div key={row} className="memo-note-row" style={{ cursor: "default" }}>
                <span
                  className="memo-note-emoji app-loading-pill"
                  style={{ borderRadius: "999px" }}
                />
                <span className="memo-note-copy">
                  <span className="app-loading-pill" style={{ height: "1.1rem", width: "62%" }} />
                  <span
                    className="app-loading-pill"
                    style={{ height: "0.85rem", width: "38%", marginTop: "0.35rem" }}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
