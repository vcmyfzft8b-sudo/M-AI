const SKELETON_ROWS = [0, 1, 2, 3, 4];

/** The settings screen's shapes: two cards, then the row list. */
export function SettingsLoading() {
  return (
    <div className="memo-settings-screen" aria-hidden="true" data-route-skeleton="">
      <div className="memo-page">
        <div
          className="app-loading-pill"
          style={{ height: "1.75rem", width: "11rem", marginBottom: "1.2rem" }}
        />

        <div className="memo-card-row" style={{ minHeight: "5.4rem" }}>
          <span className="memo-card-row-copy">
            <span className="app-loading-pill" style={{ height: "1.08rem", width: "5rem" }} />
            <span
              className="app-loading-pill"
              style={{ height: "0.95rem", width: "14rem", marginTop: "0.35rem" }}
            />
          </span>
          <span
            className="app-loading-pill"
            style={{ height: "3.1rem", width: "17rem", borderRadius: "999px" }}
          />
        </div>

        <div className="memo-card-row" style={{ minHeight: "6.5rem" }}>
          <span className="memo-card-row-copy">
            <span className="app-loading-pill" style={{ height: "0.78rem", width: "4rem" }} />
            <span
              className="app-loading-pill"
              style={{ height: "1.08rem", width: "9rem", marginTop: "0.35rem" }}
            />
          </span>
          <span
            className="app-loading-pill"
            style={{ height: "3rem", width: "10rem", borderRadius: "999px" }}
          />
        </div>

        <div className="memo-settings-list">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="memo-settings-row" style={{ cursor: "default" }}>
              <span
                className="memo-settings-tile app-loading-pill"
                style={{ borderRadius: "999px" }}
              />
              <span className="memo-settings-copy">
                <span className="app-loading-pill" style={{ height: "1.08rem", width: "9rem" }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
