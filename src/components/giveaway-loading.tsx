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
          <h1>
            <span className="app-loading-pill" style={{ display: "inline-block", height: "1.15rem", width: "13rem" }} />
          </h1>
          <span className="app-loading-pill" style={{ display: "block", height: "0.95rem", width: "min(26rem, 90%)", margin: "-0.4rem 0 1.4rem" }} />

          <div className="memo-giveaway-board">
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
