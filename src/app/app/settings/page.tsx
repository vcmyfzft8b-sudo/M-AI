import Link from "next/link";
import { headers } from "next/headers";

import { BillingPortalButton } from "@/components/billing-portal-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { EmojiIcon } from "@/components/emoji-icon";
import { LogoutForm } from "@/components/logout-form";
import { ThemeSettings } from "@/components/theme-settings";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import {
  BRAND_NAME,
  PUBLIC_PRIVACY_POLICY_PATH,
  PUBLIC_SUPPORT_PATH,
  PUBLIC_TERMS_OF_USE_PATH,
} from "@/lib/brand";
import { isMemoIosAppUserAgent } from "@/lib/native-platform";
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
  const requestHeaders = await headers();
  const isIosApp = isMemoIosAppUserAgent(requestHeaders.get("user-agent"));
  const user = await requireUser();
  const appState = await getViewerAppState();
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

          {subscription && isIosApp ? (
            <a href="itms-apps://apps.apple.com/account/subscriptions" className="settings-inline-action">
              <EmojiIcon symbol="✨" size="0.95rem" />
              App Store
            </a>
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
          {isIosApp ? null : (
            <SettingsLinkCard
              href="/app/support/redeem-code"
              icon="🎟️"
              title="Unovči kodo"
            />
          )}
          <SettingsLinkCard
            href={PUBLIC_PRIVACY_POLICY_PATH}
            icon="🔒"
            title="Zasebnost"
          />
          <SettingsLinkCard
            href={PUBLIC_TERMS_OF_USE_PATH}
            icon="📄"
            title="Pogoji uporabe"
          />
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">Brisanje racuna</p>
            <p className="ios-row-subtitle mt-1">
              Trajno odstrani racun in podatke, povezane s tvojim uporabnikom.
            </p>
          </div>

          <DeleteAccountButton
            hasActiveSubscription={Boolean(subscription)}
            subscriptionProvider={isIosApp ? "ios-app" : "web"}
          />
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
          <SettingsLinkCard
            href="/app/support/contact-support"
            icon="🛟"
            title="Kontakt in podpora"
          />
          <SettingsExternalCard
            href={PUBLIC_SUPPORT_PATH}
            icon="🌐"
            title="Javna stran podpore"
          />
        </div>
      </section>
    </main>
  );
}
