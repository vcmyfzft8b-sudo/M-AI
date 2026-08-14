import { CreatorDemoReset } from "@/components/creator-demo/creator-demo-reset";
import { EmojiIcon } from "@/components/emoji-icon";
import { SettingsLinkCard } from "@/components/settings-link-card";
import { ThemeSettings } from "@/components/theme-settings";
import { BRAND_NAME } from "@/lib/brand";

function SettingsExternalCard(props: {
  href: string;
  icon: string;
  title: string;
  detail?: string;
}) {
  return (
    <a href={props.href} className="dashboard-link-card settings-link-card">
      <span className="note-action-card-icon">
        <EmojiIcon symbol={props.icon} size="1.2rem" />
      </span>
      <span className="note-action-card-copy">
        <span className="note-action-card-label">{props.title}</span>
        {props.detail ? <span className="note-action-card-detail">{props.detail}</span> : null}
      </span>
      <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
    </a>
  );
}

export default function CreatorDemoSettingsPage() {
  return (
    <main className="home-dashboard pb-8">
      <section className="dashboard-section">
        <div>
          <h1 className="dashboard-page-title">Nastavitve</h1>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Tema</h2>
        </div>
        <ThemeSettings />
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Naročnina</h2>
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">Paket</p>
            <p className="settings-account-value">Letni paket (aktiven)</p>
            <p className="ios-row-subtitle mt-1">Demo račun za snemanje – plačila niso vključena.</p>
          </div>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Račun</h2>
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">Prijavljen</p>
            <p className="settings-account-value">demo@memoai.eu</p>
          </div>

          <CreatorDemoReset />
        </div>

        <div className="note-action-grid">
          <SettingsLinkCard href="/app/support/redeem-code" icon="🎟️" title="Unovči kodo" />
          <SettingsLinkCard href="/legal/privacy-policy" icon="🔒" title="Zasebnost" />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Pomoč</h2>
        </div>

        <div className="note-action-grid">
          <SettingsExternalCard
            href={`mailto:?subject=${encodeURIComponent(`Preizkusi ${BRAND_NAME}`)}&body=${encodeURIComponent(`Uporabljam ${BRAND_NAME} za zapiske predavanj in mislim, da bi ti lahko prišel prav.`)}`}
            icon="📤"
            title="Deli"
          />
          <SettingsLinkCard href="/app/support/feature-request" icon="💡" title="Predlagaj funkcijo" />
        </div>
      </section>
    </main>
  );
}
