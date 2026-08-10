"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";

import { ErrorScreen } from "@/components/error-screen";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <ErrorScreen
      code="500"
      title="Nekaj je šlo narobe."
      description="Napako smo zabeležili in jo pregledujemo. Poskusi znova ali se vrni čez nekaj minut."
      actions={
        <>
          <button type="button" className="error-screen-primary" onClick={reset}>
            Poskusi znova
          </button>
          <Link href="/" className="error-screen-secondary">
            Nazaj na domačo stran
          </Link>
          {error.digest ? <p className="error-screen-digest">Koda napake: {error.digest}</p> : null}
        </>
      }
    />
  );
}
