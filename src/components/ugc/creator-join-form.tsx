"use client";

import { useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { LOCALE_INTL_TAG } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";

type Accepted = { at: string; discordUrl: string };

/**
 * Accepting the creator terms: the typed name is the signature, a guardian signs too
 * for a minor, and the box confirms the version shown above. On success the campaign's
 * Discord invite appears.
 */
export function CreatorJoinForm({
  token,
  version,
  defaultName,
  needsGuardian,
  accepted: initiallyAccepted,
}: {
  token: string;
  version: string;
  defaultName: string;
  needsGuardian: boolean;
  accepted: Accepted | null;
}) {
  const { t, locale } = useTranslations();
  const [name, setName] = useState(defaultName);
  const [guardian, setGuardian] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<Accepted | null>(initiallyAccepted);

  if (accepted) {
    // Croatian, Bosnian and Serbian long dates end in a full stop ("11. listopada 2026."),
    // which the sentence around it already supplies.
    const date = new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { dateStyle: "long" })
      .format(new Date(accepted.at))
      .replace(/\.$/, "");

    return (
      <section className="memo-cp-card memo-cp-join memo-cp-join-done">
        <span className="memo-cp-done-tile">
          <Msym name="check" size="1.8rem" />
        </span>
        <h2 className="memo-cp-title">{t("ugcJoin.doneTitle")}</h2>
        <p className="memo-cp-lead">{t("ugcJoin.doneBody", { date })}</p>
        <a className="memo-cp-cta memo-cp-cta-plain" href={accepted.discordUrl} target="_blank" rel="noreferrer">
          <span>{t("ugcJoin.discordButton")}</span>
          <Msym name="arrow_forward" size="1.25rem" />
        </a>
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

    if (!agree) {
      setError("ugcJoin.error.agree");
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
      const body = (await response.json().catch(() => ({}))) as { discordUrl?: string; acceptedAt?: string; error?: string };

      if (response.ok && body.discordUrl && body.acceptedAt) {
        setAccepted({ at: body.acceptedAt, discordUrl: body.discordUrl });
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

      <div className="memo-cp-consent">
        <label>
          <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
          <span>{t("ugcJoin.agree", { version })}</span>
        </label>
      </div>

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
