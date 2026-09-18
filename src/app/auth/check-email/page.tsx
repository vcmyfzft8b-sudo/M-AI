import Image from "next/image";

import { AuthScreen } from "@/components/auth-screen";
import { CheckEmailCard } from "@/components/check-email-card";
import { getTranslations } from "@/lib/i18n/server";
import { normalizeNextPath, sanitizeUserInput } from "@/lib/validation";

type SearchParams = Promise<{
  email?: string;
  message?: string;
  messageType?: string;
  mode?: string;
  next?: string;
  sentAt?: string;
  cooldownSeconds?: string;
}>;

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const { t } = await getTranslations();
  const params = await searchParams;
  const normalizedEmail = typeof params?.email === "string"
    ? sanitizeUserInput(params.email).slice(0, 320)
    : "";
  const email = normalizedEmail || t("auth.yourEmail");
  const mode = params?.mode === "signup" ? "signup" : "login";
  const next = normalizeNextPath(params?.next);
  const message = typeof params?.message === "string"
    ? sanitizeUserInput(params.message).slice(0, 240)
    : undefined;
  const messageType = params?.messageType === "error" ? "error" : "info";
  const sentAt = Number(params?.sentAt);
  const cooldownSeconds = Number(params?.cooldownSeconds);

  return (
    <AuthScreen backHref="/auth/continue">
      <div className="memo-auth-card">
        {/* The heading belongs to the page rather than the card component, and
            it stays here — but on the card's head, so this screen reads as the
            same object as the one it was reached from. */}
        <div className="memo-auth-head">
          <Image
            src="/memo-mascot.png"
            alt=""
            width={320}
            height={288}
            className="memo-auth-mascot"
            priority
          />
          <p className="memo-eyebrow">{t("auth.checkEmail.eyebrow")}</p>
          <h1 className="memo-auth-title">{t("auth.checkEmail.title")}</h1>
          <p className="memo-auth-copy long">
            {t("auth.checkEmail.copyBefore")}
            <strong>{email}</strong>
            {t("auth.checkEmail.copyAfter")}
          </p>
        </div>

        <CheckEmailCard
          email={normalizedEmail}
          mode={mode}
          next={next}
          message={message}
          messageType={messageType}
          sentAt={Number.isFinite(sentAt) ? sentAt : 0}
          cooldownSeconds={Number.isFinite(cooldownSeconds) ? cooldownSeconds : 60}
        />
      </div>
    </AuthScreen>
  );
}
