import Link from "next/link";

import { BillingPortalButton } from "@/components/billing-portal-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { EmojiIcon } from "@/components/emoji-icon";
import { LogoutForm } from "@/components/logout-form";
import { ThemeSettings } from "@/components/theme-settings";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import { formatCalendarDate } from "@/lib/utils";
import { isIOSWebWrapperRequest } from "@/lib/ios-web-wrapper";

function SettingsLinkCard(props: {
  href: string;
  icon: string;
  title: string;
  detail?: string;
}) {
  return (
    <Link href={props.href} className="dashboard-link-card settings-link-card">
      <span className="note-action-card-icon">
        <EmojiIcon symbol={props.icon} size="1.2rem" />
      </span>
      <span className="note-action-card-copy">
        <span className="note-action-card-label">{props.title}</span>
        {props.detail ? <span className="note-action-card-detail">{props.detail}</span> : null}
      </span>
      <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
    </Link>
  );
}

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

export default async function SettingsPage() {
  const user = await requireUser();
  const appState = await getViewerAppState();
  const isIOSWebWrapper = await isIOSWebWrapperRequest();
  const email = user.email ?? user.user_metadata.email ?? "Prijavljen uporabnik";
  const subscription = appState?.subscription ?? null;

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
            <p className="settings-account-value">
              {subscription ? `${subscription.plan} (${subscription.status.replaceAll("_", " ")})` : "Brez naročnine"}
            </p>
            <p className="ios-row-subtitle mt-1">
              {subscription?.current_period_end
                ? `Aktivno do ${formatCalendarDate(subscription.current_period_end)}`
                : "Pred vstopom v glavno aplikacijo uporabnik najprej opravi onboarding in plačilo."}
            </p>
          </div>

          {isIOSWebWrapper ? (
            <p className="ios-row-subtitle settings-billing-note">
              Naročnino upravljaj tam, kjer je bila sklenjena.
            </p>
          ) : subscription ? (
            <BillingPortalButton />
          ) : (
            <Link href="/app/start" className="settings-inline-action">
              <EmojiIcon symbol="✨" size="0.95rem" />
              Izberi paket
            </Link>
          )}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Račun</h2>
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">Prijavljen</p>
            <p className="settings-account-value">{email}</p>
          </div>

          <LogoutForm />
        </div>

        <div className="note-action-grid">
          <SettingsLinkCard
            href="/app/support/redeem-code"
            icon="🎟️"
            title="Unovči kodo"
          />
          <SettingsLinkCard
            href="/app/support/privacy-policy"
            icon="🔒"
            title="Zasebnost"
          />
          <SettingsLinkCard
            href="/app/support/terms-of-use"
            icon="📄"
            title="Pogoji uporabe"
          />
        </div>

        <div className="dashboard-surface-card settings-account-card settings-danger-card">
          <div className="min-w-0">
            <p className="dashboard-overline">Trajno dejanje</p>
            <p className="settings-account-value">Izbris računa in vseh podatkov</p>
            <p className="ios-row-subtitle mt-1">
              Izbris prekliče aktivno spletno naročnino ter odstrani zapiske in naložene datoteke.
            </p>
          </div>
          <DeleteAccountButton />
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
          <SettingsLinkCard
            href="/app/support/feature-request"
            icon="💡"
            title="Predlagaj funkcijo"
          />
        </div>
      </section>
    </main>
  );
}
