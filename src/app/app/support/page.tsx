import Link from "next/link";

import { EmojiIcon } from "@/components/emoji-icon";
import { getHelpSections } from "@/lib/help-center";
import { getRequestDictionary, getRequestLocale } from "@/lib/i18n-server";

export default async function SupportPage() {
  const locale = await getRequestLocale();
  const dictionary = await getRequestDictionary();
  const helpSections = getHelpSections(locale);

  return (
    <main className="home-dashboard pb-8">
      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div>
            <h1 className="dashboard-page-title">{dictionary.help.pageTitle}</h1>
          </div>
        </div>
      </section>

      {helpSections.map((section) => (
        <section key={section.title} className="dashboard-section">
          <div className="dashboard-section-heading">
            <h2 className="dashboard-section-title">{section.title}</h2>
          </div>

          <div className="dashboard-note-list">
            {section.items.map((item) => (
              <Link
                key={item.slug}
                href={`/app/support/${item.slug}`}
                className="dashboard-link-card"
              >
                <p className="dashboard-link-card-title">{item.title}</p>
                <EmojiIcon className="ios-chevron" symbol="›" size="1.1rem" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
