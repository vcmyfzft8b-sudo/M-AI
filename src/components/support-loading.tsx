const SKELETON_SECTIONS = [
  [0, 1, 2, 3],
  [0, 1, 2],
];

/** The help screen's shapes: one grouped card per section. */
export function SupportIndexLoading() {
  return (
    <div className="memo-support-screen" aria-hidden="true" data-route-skeleton="">
      <div className="memo-page">
        {/* Title and the way back share a row here, as on the real screen. */}
        <div className="memo-support-head">
          <div className="app-loading-pill" style={{ height: "1.75rem", width: "7rem" }} />
          <span className="memo-m-round app-loading-pill memo-only-mobile" />
        </div>

        {SKELETON_SECTIONS.map((section, index) => (
          <div key={index} className="memo-help-section">
            <div
              className="app-loading-pill"
              style={{ height: "1.3rem", width: "10rem", marginBottom: "0.85rem" }}
            />
            <div className="memo-help-group">
              {section.map((row) => (
                <div key={row} className="memo-help-toggle memo-help-item">
                  <span className="app-loading-pill" style={{ height: "1.08rem", width: "45%" }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ARTICLE_LINES = ["full", "full", "short", "full", "full", "short"] as const;

/** A single help article: heading, then body lines on the redesign's card. */
export function SupportArticleLoading() {
  return (
    <div
      className="memo-support-screen"
      data-route-skeleton=""
      aria-busy="true"
      aria-label="Nalaganje članka pomoči"
    >
      <div className="memo-page">
        <div
          className="app-loading-pill"
          style={{ height: "1.75rem", width: "min(24rem, 70%)", marginBottom: "1.2rem" }}
        />

        <div className="memo-help-intro">
          {ARTICLE_LINES.map((line, index) => (
            <span
              key={index}
              className="app-loading-pill"
              style={{ height: "1.02rem", width: line === "short" ? "58%" : "100%" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
