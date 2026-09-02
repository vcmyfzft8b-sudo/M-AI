/**
 * The giveaway screen while it loads: the same boxes in the same places, so
 * the hero, the two cards and the board land without moving anything.
 */
export function GiveawayLoading() {
  return (
    <div className="memo-settings-screen memo-giveaway-screen" aria-hidden="true" data-route-skeleton="">
      <div className="memo-settings-topbar memo-giveaway-topbar memo-only-mobile flex">
        <span className="memo-close-button app-loading-pill" />
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          <div className="memo-giveaway-head">
            <span className="memo-giveaway-head-copy">
              <span className="app-loading-pill" style={{ height: "0.78rem", width: "9rem" }} />
              <span className="app-loading-pill" style={{ height: "1.5rem", width: "11rem", marginTop: "0.3rem" }} />
              <span className="app-loading-pill" style={{ height: "0.95rem", width: "min(24rem, 90%)", marginTop: "0.3rem" }} />
            </span>
            <span className="memo-giveaway-prize">
              <span className="app-loading-pill" style={{ width: "9rem", height: "18.4rem", borderRadius: "1.6rem" }} />
            </span>
          </div>

          <div className="memo-card-row memo-giveaway-card">
            <span className="memo-card-row-copy">
              <span className="app-loading-pill" style={{ height: "0.78rem", width: "4.5rem" }} />
              <span className="app-loading-pill" style={{ height: "2rem", width: "10rem", marginTop: "0.5rem" }} />
              <span className="app-loading-pill" style={{ height: "0.95rem", width: "min(18rem, 90%)", marginTop: "0.4rem" }} />
            </span>
            <span className="app-loading-pill" style={{ height: "3rem", width: "100%", borderRadius: "999px" }} />
            <span className="app-loading-pill" style={{ height: "0.7rem", width: "100%", borderRadius: "999px" }} />
          </div>

          <div className="memo-card-row memo-giveaway-card memo-giveaway-board">
            <span className="app-loading-pill" style={{ height: "1.1rem", width: "7rem" }} />
            {[0, 1, 2].map((row) => (
              <span
                key={row}
                className="app-loading-pill"
                style={{ display: "block", height: "2.6rem", width: "100%", marginTop: "0.6rem" }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
