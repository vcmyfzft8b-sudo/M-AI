"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { useT } from "@/components/i18n-provider";
import { ErrorScreen } from "@/components/error-screen";
import { InstantLink } from "@/components/instant-link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <ErrorScreen
      code="500"
      title={t("error.500.title")}
      description={t("error.500.copy")}
      actions={
        <>
          <button type="button" className="error-screen-primary" onClick={reset}>
            {t("common.retry")}
          </button>
          {/* Safe here, unlike in `global-error.tsx`: this boundary renders inside a
              root layout that did not fail, so the provider above it exists and the
              router works. If a push somehow does not land, the feedback releases
              itself on the failsafe and the link can be tapped again. */}
          <InstantLink href="/" className="error-screen-secondary">
            {t("error.backHome")}
          </InstantLink>
          {error.digest ? (
            <p className="error-screen-digest">{t("error.digest", { digest: error.digest })}</p>
          ) : null}
        </>
      }
    />
  );
}
