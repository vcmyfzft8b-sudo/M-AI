const SKELETON_ACTION_TILES = [0, 1, 2, 3];
const SKELETON_NOTE_ROWS = [0, 1, 2, 3];

/**
 * The home screen while it loads.
 *
 * Built out of the home screen's own class names rather than out of pills at
 * hand-copied sizes: `.memo-m-topbar`, `.memo-m-search`, `.memo-swipe-surface`
 * and the rest already carry the heights, the radii and the breakpoint rules,
 * so the skeleton lands in the same places as the thing it stands in for and
 * cannot drift away from it the next time one of those changes. Only the text
 * and the icons are replaced with pills.
 *
 * The phone chrome — the top bar and the bar with chat and Nov zapisek — is
 * part of that. It belongs to the home screen rather than to the app shell, so
 * a skeleton that leaves it out makes the controls flicker away and back on
 * every navigation home.
 */
export function DashboardLoading() {
  return (
    <div className="memo-home-screen" aria-hidden="true" data-route-skeleton="">
      {/* Phone: the lockup and the gear, exactly where the real ones sit. */}
      <div className="memo-m-topbar memo-only-mobile flex">
        <span className="app-loading-pill" style={{ height: "2.1rem", width: "10rem" }} />
        <span className="memo-m-round app-loading-pill" />
      </div>

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

        {/* Phone: "Moji zapiski", the search field and the folder chip. */}
        <div className="memo-m-title memo-only-mobile">
          <span className="app-loading-pill" style={{ height: "1.9rem", width: "9rem" }} />
        </div>

        <div className="memo-m-search memo-only-mobile" />

        <div className="memo-m-folderbar memo-only-mobile">
          <span
            className="app-loading-pill"
            style={{
              display: "block",
              height: "2.7rem",
              width: "13.5rem",
              borderRadius: "999px",
            }}
          />
        </div>

        <div className="memo-home-body">
          <div className="memo-note-list">
            {SKELETON_NOTE_ROWS.map((row) => (
              <div key={row} className="memo-swipe-row">
                <div className="memo-swipe-surface" style={{ cursor: "default" }}>
                  <span
                    className="memo-note-emoji app-loading-pill"
                    style={{ borderRadius: "999px" }}
                  />
                  {/* Two title lines and a meta line: note titles wrap on a
                      phone, and a one-line row would make the list jump. */}
                  <span className="memo-note-copy">
                    <span className="app-loading-pill" style={{ height: "1.1rem", width: "92%" }} />
                    <span
                      className="app-loading-pill"
                      style={{ height: "1.1rem", width: "54%", marginTop: "0.3rem" }}
                    />
                    <span
                      className="app-loading-pill"
                      style={{ height: "0.85rem", width: "38%", marginTop: "0.45rem" }}
                    />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phone: chat and the create button, which stay put across the swap. */}
      <div className="memo-m-homebar memo-only-mobile flex">
        <span className="memo-m-chat-fab app-loading-pill" />
        <span className="memo-m-create app-loading-pill" />
      </div>
    </div>
  );
}
