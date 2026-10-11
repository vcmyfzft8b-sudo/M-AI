"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { LOCALE_INTL_TAG } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";

type Accepted = {
  at: string;
  discordUrl: string | null;
  /** When they opened the Discord invite from here; null while that step is still to do. */
  discordOpenedAt?: string | null;
};

/**
 * Accepting the creator terms, at the top of the join page so it takes one tap: the name
 * from the application is already filled in (the typed name is the signature), a parent
 * or guardian types theirs for a minor, and the button itself is the agreement, with the
 * sentence above it saying so and a link down to the full terms.
 *
 * Signing is step one. For an applicant, step two follows at once: join the campaign's
 * Discord (`DiscordStep`). The page only says "you're in" once they have opened the
 * invite and come back. A contract (a creator already in the program) ends at signing.
 *
 * Never on page load: mail scanners and link previews open the join link on their own, so
 * accepting always takes the person's own tap (a POST), never a GET.
 */
export function CreatorJoinForm({
  token,
  version,
  defaultName,
  needsGuardian,
  kind = "application",
  accepted: initiallyAccepted,
}: {
  token: string;
  version: string;
  defaultName: string;
  needsGuardian: boolean;
  /** A contract is signed by a creator already in the program: no Discord to hand over. */
  kind?: "application" | "contract";
  accepted: Accepted | null;
}) {
  const { t, locale } = useTranslations();
  const [name, setName] = useState(defaultName);
  const [guardian, setGuardian] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<Accepted | null>(initiallyAccepted);

  if (accepted) {
    // Croatian, Bosnian and Serbian long dates end in a full stop ("11. listopada 2026."),
    // which the sentence around it already supplies.
    const date = new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { dateStyle: "long", timeZone: "Europe/Ljubljana" })
      .format(new Date(accepted.at))
      .replace(/\.$/, "");

    if (kind === "application" && accepted.discordUrl) {
      return <DiscordStep token={token} date={date} discordUrl={accepted.discordUrl} openedAt={accepted.discordOpenedAt ?? null} />;
    }

    return (
      <section className="memo-cp-card memo-cp-join memo-cp-join-done">
        <span className="memo-cp-done-tile">
          <Msym name="check" size="1.8rem" />
        </span>
        <h2 className="memo-cp-title">{t("ugcContract.doneTitle")}</h2>
        <p className="memo-cp-lead">{t("ugcContract.doneBody", { date })}</p>
      </section>
    );
  }

  async function submit() {
    if (name.trim().length < 3) {
      setError("ugcJoin.error.name");
      return;
    }

    if (needsGuardian && guardian.trim().length < 3) {
      setError("ugcJoin.error.guardian");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/ugc/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, version, signedName: name, guardianName: guardian, agree: true }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        discordUrl?: string | null;
        acceptedAt?: string;
        error?: string;
      };

      if (response.ok && body.acceptedAt) {
        setAccepted({ at: body.acceptedAt, discordUrl: body.discordUrl ?? null });
      } else if (body.error === "stale") {
        setError("ugcJoin.error.stale");
        window.setTimeout(() => window.location.reload(), 2500);
      } else if (body.error === "guardian") {
        setError("ugcJoin.error.guardian");
      } else {
        setError("ugcJoin.error.generic");
      }
    } catch {
      setError("ugcJoin.error.generic");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="memo-cp-card memo-cp-join"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="memo-cp-title">{t("ugcJoin.signTitle")}</h2>

      <div className="memo-cp-form-field">
        <label className="memo-cp-form-label" htmlFor="cp-join-name">
          <span>{t("ugcJoin.nameLabel")}</span>
        </label>
        <input
          id="cp-join-name"
          className="memo-cp-input"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="memo-cp-form-hint">{t("ugcJoin.nameHint")}</p>
      </div>

      {needsGuardian ? (
        <div className="memo-cp-form-field">
          <label className="memo-cp-form-label" htmlFor="cp-join-guardian">
            <span>{t("ugcJoin.guardianLabel")}</span>
          </label>
          <input
            id="cp-join-guardian"
            className="memo-cp-input"
            value={guardian}
            onChange={(event) => setGuardian(event.target.value)}
          />
          <p className="memo-cp-form-hint">{t("ugcJoin.guardianHint")}</p>
        </div>
      ) : null}

      <p className="memo-cp-join-statement">
        {t(needsGuardian ? "ugcJoin.agreeGuardian" : "ugcJoin.agree", { button: t("ugcJoin.submit"), version })}{" "}
        <a href="#terms">{t("ugcJoin.readTerms")}</a>
      </p>

      {error ? (
        <p className="memo-cp-form-error memo-cp-form-alert" role="alert">
          {t(error)}
        </p>
      ) : null}

      <button type="submit" className="memo-cp-cta memo-cp-cta-block" disabled={submitting}>
        <span>{submitting ? t("ugcJoin.submitting") : t("ugcJoin.submit")}</span>
      </button>
    </form>
  );
}

/**
 * After signing, the applicant's last step: join the campaign's Discord. Tapping the
 * button opens the invite (Discord's app or a new tab) and records that it was opened;
 * when they come back to this page it says "you're in". Reopening the link later goes
 * straight to "you're in". The site cannot see Discord membership itself, so opening the
 * invite is what counts.
 */
function DiscordStep({
  token,
  date,
  discordUrl,
  openedAt,
}: {
  token: string;
  date: string;
  discordUrl: string;
  openedAt: string | null;
}) {
  const { t } = useTranslations();
  const [opened, setOpened] = useState(openedAt !== null);
  const [inside, setInside] = useState(openedAt !== null);

  // Back from Discord: after the invite opened, the page has to be left (hidden when the
  // Discord app or another tab takes over, or blurred on a desktop) and then come back.
  // A focus event alone is not enough: tapping the button can fire one before they leave.
  useEffect(() => {
    if (!opened || inside) {
      return;
    }

    let left = document.visibilityState === "hidden";

    const leave = () => {
      left = true;
    };
    const back = () => {
      if (left && document.visibilityState === "visible") {
        setInside(true);
      }
    };
    const visibility = () => (document.visibilityState === "hidden" ? leave() : back());

    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);

    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [opened, inside]);

  function openDiscord() {
    setOpened(true);
    void fetch("/api/ugc/join/discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      keepalive: true,
    }).catch(() => undefined);
  }

  const steps = (
    <ol className="memo-cp-join-steps">
      <li data-done="true">
        <Msym name="check" size="1rem" />
        <span>{t("ugcJoin.stepSigned")}</span>
      </li>
      <li data-done={inside || undefined}>
        {inside ? <Msym name="check" size="1rem" /> : <span className="memo-cp-join-step-number">2</span>}
        <span>{t("ugcJoin.stepDiscord")}</span>
      </li>
    </ol>
  );

  if (inside) {
    return (
      <section className="memo-cp-card memo-cp-join memo-cp-join-done">
        {steps}
        <span className="memo-cp-done-tile">
          <Msym name="check" size="1.8rem" />
        </span>
        <h2 className="memo-cp-title">{t("ugcJoin.doneTitle")}</h2>
        <p className="memo-cp-lead">{t("ugcJoin.doneBody", { date })}</p>
        <a className="memo-cp-join-discord-again" href={discordUrl} target="_blank" rel="noreferrer">
          <DiscordLogo />
          <span>{t("ugcJoin.discordAgain")}</span>
        </a>
      </section>
    );
  }

  return (
    <section className="memo-cp-card memo-cp-join memo-cp-join-done">
      {steps}
      <h2 className="memo-cp-title">{t("ugcJoin.discordTitle")}</h2>
      <p className="memo-cp-lead">{t("ugcJoin.discordBody", { date })}</p>
      <a className="memo-cp-discord" href={discordUrl} target="_blank" rel="noreferrer" onClick={openDiscord}>
        <DiscordLogo />
        <span>{t("ugcJoin.discordButton")}</span>
      </a>
    </section>
  );
}

/** Discord's mark (Simple Icons, CC0), in the button's own colour. */
function DiscordLogo() {
  return (
    <svg className="memo-cp-discord-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  );
}
