const SKELETON_LINK_CARDS = [0, 1, 2];

export function SettingsLoading() {
  return (
    <main className="home-dashboard pb-8" aria-busy="true" aria-label="Nalaganje nastavitev">
      <section className="dashboard-section">
        <div className="dashboard-section-heading app-loading-header">
          <div className="app-loading-pill app-loading-pill-title" />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div className="app-loading-pill app-loading-pill-section" style={{ width: "4.5rem" }} />
        </div>
        <div className="dashboard-surface-card settings-loading-card">
          <div className="app-loading-row" />
          <div className="app-loading-row short" />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div className="app-loading-pill app-loading-pill-section" style={{ width: "6rem" }} />
        </div>
        <div className="dashboard-surface-card settings-loading-card">
          <div className="app-loading-pill app-loading-pill-subtitle" />
          <div className="app-loading-row short" />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div className="app-loading-pill app-loading-pill-section" style={{ width: "5rem" }} />
        </div>
        <div className="dashboard-surface-card settings-loading-card">
          <div className="app-loading-pill app-loading-pill-subtitle" />
          <div className="app-loading-row short" />
        </div>

        <div className="dashboard-note-list">
          {SKELETON_LINK_CARDS.map((card) => (
            <div key={card} className="dashboard-link-card support-link-card-skeleton">
              <div className="app-loading-row" />
              <div className="app-loading-pill support-chevron-skeleton" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
