"use client";

import { EmailAuthForm } from "@/components/email-auth-form";
import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";

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
      buttonClassName="memo-button-coral memo-auth-submit"
      defaultEmail={email}
      formClassName="memo-auth-form"
      icon={<Msym name="mail" fill={false} weight={500} />}
      inputWrapperClassName="memo-auth-field"
      mode={mode}
      next={next}
      placeholder={t("auth.enterEmailPlaceholder")}
      pendingLabel={t("auth.sendingCode")}
      readOnlyWhileSubmitting
      submitLabel={t("common.continue")}
    />
  );
}
