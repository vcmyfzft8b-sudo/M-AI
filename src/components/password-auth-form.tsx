"use client";

import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";

export function PasswordAuthForm({ next }: { next: string }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  return (
    <form action="/auth/password/verify" method="post" className="memo-auth-form" onSubmit={event => {
      if (pending) { event.preventDefault(); return; }
      setPending(true);
    }}>
      <input type="hidden" name="next" value={next} />
      <label className="memo-auth-field">
        <input type="email" name="email" autoComplete="username" required maxLength={320}
          aria-label={t("auth.enterEmailPlaceholder")} placeholder={t("auth.enterEmailPlaceholder")} readOnly={pending} />
      </label>
      <label className="memo-auth-field">
        <input type="password" name="password" autoComplete="current-password" required maxLength={1024}
          aria-label={t("auth.password.label")} placeholder={t("auth.password.label")} readOnly={pending} />
      </label>
      <button type="submit" className="memo-button-coral memo-auth-submit" disabled={pending} aria-busy={pending}>
        {pending ? <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" /> : null}
        <span>{t(pending ? "auth.password.pending" : "auth.signIn")}</span>
      </button>
    </form>
  );
}
