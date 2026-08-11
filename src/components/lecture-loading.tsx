const SKELETON_TABS = [0, 1, 2];
const SKELETON_PARAGRAPHS = [
  ["full", "full", "short"],
  ["full", "full", "full", "short"],
  ["full", "short"],
] as const;

export function LectureWorkspaceLoading() {
  return (
    <div
      className="lecture-workspace lecture-workspace-full"
      role="status"
      aria-label="Nalaganje zapiska"
      aria-busy="true"
    >
      <div className="workspace-panel-stack lecture-main-column">
        <div className="lecture-header">
          <div className="lecture-header-row">
            <div className="lecture-loading-title-block">
              <div className="app-loading-pill lecture-loading-title" />
              <div className="app-loading-pill lecture-loading-meta" />
            </div>
          </div>
        </div>

        <div className="ios-segmented lecture-segmented">
          {SKELETON_TABS.map((tab) => (
            <div key={tab} className="ios-segment lecture-loading-segment">
              <div className="app-loading-pill lecture-loading-segment-pill" />
            </div>
          ))}
        </div>

        <div className="ios-card lecture-notes-card lecture-loading-card">
          <div className="app-loading-pill app-loading-pill-section" />

          {SKELETON_PARAGRAPHS.map((paragraph, paragraphIndex) => (
            <div key={paragraphIndex} className="lecture-loading-paragraph">
              {paragraph.map((row, rowIndex) => (
                <div
                  key={rowIndex}
                  className={`app-loading-row${row === "short" ? " short" : ""}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
