"use client";

import { EmailAuthForm } from "@/components/email-auth-form";
import { useI18n } from "@/components/locale-provider";

export function EmailEntryForm({
  email,
  mode,
  next,
}: {
  email: string;
  mode: "login" | "signup";
  next: string;
}) {
  const { dictionary } = useI18n();

  return (
    <EmailAuthForm
      buttonClassName="email-entry-submit"
      defaultEmail={email}
      formClassName="email-entry-form"
      inputClassName="email-entry-input"
      mode={mode}
      next={next}
      placeholder={dictionary.auth.emailPlaceholder}
      pendingLabel={dictionary.auth.sendingCode}
      readOnlyWhileSubmitting
      submitLabel={dictionary.auth.continueEmail}
    />
  );
}
