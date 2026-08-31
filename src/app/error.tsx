"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";

import { useT } from "@/components/i18n-provider";
import { ErrorScreen } from "@/components/error-screen";

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
          <Link href="/" className="error-screen-secondary">
            {t("error.backHome")}
          </Link>
          {error.digest ? (
            <p className="error-screen-digest">{t("error.digest", { digest: error.digest })}</p>
          ) : null}
        </>
      }
    />
  );
}
