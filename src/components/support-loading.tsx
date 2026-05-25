function SkeletonRow({ short = false }: { short?: boolean }) {
  return <div className={`app-loading-row${short ? " short" : ""}`} />;
}

export function SupportIndexLoading() {
  const sections = [
    { titleWidth: "7rem", items: 4 },
    { titleWidth: "10rem", items: 3 },
    { titleWidth: "9rem", items: 3 },
  ];

  return (
    <main className="home-dashboard pb-8" aria-busy="true" aria-label="Nalaganje pomoči">
      <section className="dashboard-section">
        <div className="dashboard-section-heading app-loading-header">
          <div className="app-loading-pill app-loading-pill-title" />
        </div>
      </section>

      {sections.map((section, sectionIndex) => (
        <section key={sectionIndex} className="dashboard-section">
          <div className="dashboard-section-heading">
            <div className="app-loading-pill app-loading-pill-section" style={{ width: section.titleWidth }} />
          </div>

          <div className="dashboard-note-list">
            {Array.from({ length: section.items }, (_, itemIndex) => (
              <div key={itemIndex} className="dashboard-link-card support-link-card-skeleton">
                <div className="app-loading-row" />
                <div className="app-loading-pill support-chevron-skeleton" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

export function SupportArticleLoading() {
  return (
    <main className="home-dashboard pb-8" aria-busy="true" aria-label="Nalaganje članka pomoči">
      <section className="dashboard-section">
        <div className="app-loading-header">
          <div className="app-loading-pill app-loading-pill-section" />
          <div className="app-loading-pill app-loading-pill-title" />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-surface-card help-article-card support-article-skeleton">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow short />
          <div className="app-loading-pill app-loading-pill-section" />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow short />
        </div>
      </section>
    </main>
  );
}
