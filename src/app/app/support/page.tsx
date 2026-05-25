import { SupportArticleLink } from "@/components/support-article-link";
import { HELP_SECTIONS } from "@/lib/help-center";

export default function SupportPage() {
  return (
    <main className="home-dashboard pb-8">
      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div>
            <h1 className="dashboard-page-title">Pomoč</h1>
          </div>
        </div>
      </section>

      {HELP_SECTIONS.map((section) => (
        <section key={section.title} className="dashboard-section">
          <div className="dashboard-section-heading">
            <h2 className="dashboard-section-title">{section.title}</h2>
          </div>

          <div className="dashboard-note-list">
            {section.items.map((item) => (
              <SupportArticleLink
                key={item.slug}
                href={`/app/support/${item.slug}`}
                title={item.title}
              />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
