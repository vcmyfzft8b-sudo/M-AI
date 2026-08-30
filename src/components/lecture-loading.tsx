const SKELETON_TABS = [0, 1, 2, 3, 4];
const SKELETON_PARAGRAPHS = [
  ["full", "full", "short"],
  ["full", "full", "full", "short"],
  ["full", "short"],
] as const;

/** The note screen's shapes: pill row, emoji + title, then the body. */
export function LectureWorkspaceLoading() {
  return (
    <div
      className="memo-note-screen"
      data-route-skeleton=""
      role="status"
      aria-label="Nalaganje zapiska"
      aria-busy="true"
    >
      <div className="memo-note-card">
        <div className="memo-note-scroll">
          <div className="memo-tabs">
            {SKELETON_TABS.map((tab) => (
              <span
                key={tab}
                className="app-loading-pill"
                style={{ height: "3.1rem", width: "7.5rem", borderRadius: "999px", flex: "0 0 auto" }}
              />
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
      </div>
    </div>
  );
}
