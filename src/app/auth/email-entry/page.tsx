import Image from "next/image";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
import { EmailEntryForm } from "@/components/email-entry-form";
import { getOptionalUser } from "@/lib/auth";
import { getTranslations } from "@/lib/i18n/server";
import { normalizeNextPath, sanitizeUserInput } from "@/lib/validation";

type SearchParams = Promise<{
  email?: string;
  mode?: string;
  next?: string;
}>;

export default async function EmailEntryPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await getOptionalUser();
  const { t } = await getTranslations();
  const params = await searchParams;
  const next = normalizeNextPath(params?.next);
  const mode = params?.mode === "login" ? "login" : "signup";
  const email = typeof params?.email === "string" ? sanitizeUserInput(params.email).slice(0, 320) : "";

  if (user) {
    redirect(next);
  }

  return (
    <AuthScreen>
      <div className="memo-auth-card">
        <div className="memo-auth-head">
          <Image
            src="/memo-mascot.png"
            alt=""
            width={320}
            height={288}
            className="memo-auth-mascot"
            priority
          />
          <p className="memo-eyebrow">{t(mode === "login" ? "auth.signIn" : "auth.signUp")}</p>
          <h1 className="memo-auth-title">{t("auth.emailEntryTitle")}</h1>
          <p className="memo-auth-copy">{t("auth.emailEntryCopy")}</p>
        </div>

        <EmailEntryForm email={email} mode={mode} next={next} />
      </div>
    </AuthScreen>
  );
}
