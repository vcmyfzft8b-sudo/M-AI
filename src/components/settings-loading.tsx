const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * Nastavitve while it loads.
 *
 * Drawn from the settings screen's own classes, headings and all: the phone
 * lays this screen out as heading / card / heading / card, and a skeleton of
 * two anonymous cards and a list moved every one of them on arrival.
 *
 * The phone's close button is part of it, so the way out of the screen is
 * there for as long as the screen is.
 */
export function SettingsLoading() {
  return (
    <div className="memo-settings-screen" aria-hidden="true" data-route-skeleton="">
      <div className="memo-settings-topbar memo-only-mobile flex">
        <span className="memo-close-button app-loading-pill" />
      </div>

      <div className="memo-page">
        <div
          className="app-loading-pill"
          style={{ height: "1.75rem", width: "11rem", marginBottom: "1.2rem" }}
        />

        <div className="memo-settings-heading memo-only-mobile" style={{ minHeight: "1.875rem" }}>
          <span className="app-loading-pill" style={{ display: "block", height: "1.15rem", width: "5rem" }} />
        </div>

        {/* Tema. The real card keeps its copy on desktop only and hands the
            whole row to the segmented control on a phone, where it also drops
            its padding — so the class does that here too rather than a guess. */}
        <div className="memo-card-row memo-settings-theme">
          <span className="memo-card-row-copy memo-only-desktop">
            <span className="app-loading-pill" style={{ display: "block", height: "1.08rem", width: "5rem" }} />
            <span
              className="app-loading-pill"
              style={{ display: "block", height: "0.95rem", width: "11rem", marginTop: "0.3rem" }}
            />
          </span>
          <span
            className="app-loading-pill"
            style={{ display: "block", height: "3.5rem", width: "100%", borderRadius: "999px" }}
          />
        </div>

        <div className="memo-settings-heading memo-only-mobile" style={{ minHeight: "1.875rem" }}>
          <span className="app-loading-pill" style={{ display: "block", height: "1.15rem", width: "6.5rem" }} />
        </div>

        {/* Naročnina: overline, plan, detail, then the action. */}
        <div className="memo-card-row">
          <span className="memo-card-row-copy">
            <span className="app-loading-pill" style={{ height: "0.78rem", width: "4rem" }} />
            <span
              className="app-loading-pill"
              style={{ height: "1.08rem", width: "11rem", marginTop: "0.4rem" }}
            />
            <span
              className="app-loading-pill"
              style={{ height: "0.95rem", width: "min(20rem, 90%)", marginTop: "0.35rem" }}
            />
          </span>
          <span
            className="app-loading-pill"
            style={{ height: "3.3rem", width: "100%", borderRadius: "999px" }}
          />
        </div>

        <div
          className="app-loading-pill"
          style={{ height: "0.95rem", width: "15rem", marginTop: "0.9rem" }}
        />

        <div className="memo-settings-heading memo-only-mobile" style={{ minHeight: "1.875rem" }}>
          <span className="app-loading-pill" style={{ display: "block", height: "1.15rem", width: "4.5rem" }} />
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
