import Link from "next/link";

import { BillingPortalButton } from "@/components/billing-portal-button";
import { EmojiIcon } from "@/components/emoji-icon";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoutForm } from "@/components/logout-form";
import { ThemeSettings } from "@/components/theme-settings";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { getRequestDictionary } from "@/lib/i18n-server";
import { formatCalendarDate } from "@/lib/utils";

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
  const dictionary = await getRequestDictionary();
  const appState = await getViewerAppState();
  const email = user.email ?? user.user_metadata.email ?? dictionary.settings.signedInFallback;
  const subscription = appState?.subscription ?? null;

  return (
    <main className="home-dashboard pb-8">
      <section className="dashboard-section">
        <div>
          <h1 className="dashboard-page-title">{dictionary.settings.title}</h1>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">{dictionary.settings.theme}</h2>
        </div>
        <ThemeSettings />
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">{dictionary.settings.languageTitle}</h2>
        </div>
        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">{dictionary.common.language}</p>
            <p className="ios-row-subtitle mt-1">{dictionary.settings.languageDetail}</p>
          </div>
          <LanguageSwitcher />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">{dictionary.settings.subscription}</h2>
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">{dictionary.settings.package}</p>
            <p className="settings-account-value">
              {subscription ? `${subscription.plan} (${subscription.status.replaceAll("_", " ")})` : dictionary.settings.noSubscription}
            </p>
            <p className="ios-row-subtitle mt-1">
              {subscription?.current_period_end
                ? `Aktivno do ${formatCalendarDate(subscription.current_period_end)}`
                : dictionary.settings.onboardingPayment}
            </p>
          </div>

          {subscription ? (
            <BillingPortalButton />
          ) : (
            <Link href="/app/start" className="settings-inline-action">
              <EmojiIcon symbol="✨" size="0.95rem" />
              {dictionary.settings.choosePlan}
            </Link>
          )}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">{dictionary.settings.account}</h2>
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">{dictionary.settings.signedIn}</p>
            <p className="settings-account-value">{email}</p>
          </div>

          <LogoutForm />
        </div>

        <div className="note-action-grid">
          <SettingsLinkCard
            href="/app/support/redeem-code"
            icon="🎟️"
            title={dictionary.settings.redeemCode}
          />
          <SettingsLinkCard
            href="/app/support/privacy-policy"
            icon="🔒"
            title={dictionary.settings.privacy}
          />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">{dictionary.settings.help}</h2>
        </div>

        <div className="note-action-grid">
          <SettingsExternalCard
            href={`mailto:?subject=${encodeURIComponent(dictionary.settings.shareSubject)}&body=${encodeURIComponent(dictionary.settings.shareBody)}`}
            icon="📤"
            title={dictionary.settings.share}
          />
          <SettingsLinkCard
            href="/app/support/feature-request"
            icon="💡"
            title={dictionary.settings.featureRequest}
          />
        </div>
      </section>
    </main>
  );
}
