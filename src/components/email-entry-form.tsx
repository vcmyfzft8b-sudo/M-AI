"use client";

import { EmailAuthForm } from "@/components/email-auth-form";
import { useT } from "@/components/i18n-provider";

export function EmailEntryForm({
  email,
  mode,
  next,
}: {
  email: string;
  mode: "login" | "signup";
  next: string;
}) {
  const t = useT();

  return (
    <EmailAuthForm
      buttonClassName="email-entry-submit"
      defaultEmail={email}
      formClassName="email-entry-form"
      inputClassName="email-entry-input"
      mode={mode}
      next={next}
      placeholder={t("auth.enterEmailPlaceholder")}
      pendingLabel={t("auth.sendingCode")}
      readOnlyWhileSubmitting
      submitLabel={t("common.continue")}
    />
  );
}
