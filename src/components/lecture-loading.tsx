const SKELETON_TABS = [0, 1, 2, 3, 4];
const SKELETON_PARAGRAPHS = [
  ["full", "full", "short"],
  ["full", "full", "full", "short"],
  ["full", "short"],
] as const;

/**
 * The note screen while it loads.
 *
 * Same idea as the home skeleton: the screen's own class names carry the sizes,
 * so `.memo-tab` is whatever a tab is at this width rather than a pill someone
 * measured once on desktop and left behind when the phone got shorter ones.
 *
 * The phone's nav row and the dock are drawn too. Both belong to the note
 * screen rather than to the app shell, and a skeleton without them takes the
 * way back off the screen for as long as the note takes to arrive.
 */
export function LectureWorkspaceLoading() {
  return (
    <div
      className="memo-note-screen"
      data-route-skeleton=""
      role="status"
      aria-label="Nalaganje zapiska"
      aria-busy="true"
    >
      {/* Phone: back, the note's emoji, actions. */}
      <div className="memo-m-navbar memo-only-mobile flex">
        <span className="memo-m-navbtn app-loading-pill" />
        <span
          className="app-loading-pill"
          style={{ display: "block", height: "1.5rem", width: "1.5rem", borderRadius: "999px" }}
        />
        <span className="memo-m-navbtn app-loading-pill" />
      </div>

      <div className="memo-note-card">
        <div className="memo-note-scroll">
          <div className="memo-tabs">
            {SKELETON_TABS.map((tab) => (
              <span key={tab} className="memo-tab app-loading-pill" style={{ width: "7.5rem" }} />
            ))}
          </div>

          <div className="memo-note-head">
            <span
              className="memo-note-head-emoji app-loading-pill"
              style={{ borderRadius: "999px" }}
            />
            <span
              className="app-loading-pill"
              style={{ height: "1.85rem", width: "min(28rem, 70%)", marginTop: "0.1rem" }}
            />
          </div>

          <div className="memo-note-body">
            {SKELETON_PARAGRAPHS.map((paragraph, index) => (
              <div key={index} style={{ marginBottom: "1.9rem" }}>
                <span
                  className="app-loading-pill"
                  style={{ height: "1.32rem", width: "11rem", display: "block" }}
                />
                {paragraph.map((line, lineIndex) => (
                  <span
                    key={lineIndex}
                    className="app-loading-pill"
                    style={{
                      display: "block",
                      height: "1.05rem",
                      width: line === "short" ? "58%" : "100%",
                      marginTop: "0.8rem",
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Phone: the listen pill and the way into chat, where they always are. */}
        <div className="memo-dock">
          <span className="memo-dock-pill app-loading-pill" />
          <span className="memo-m-chatbar app-loading-pill memo-only-mobile" />
        </div>
      </div>
    </div>
  );
}
