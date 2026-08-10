"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import "./globals.css";

/**
 * Replaces the root layout when it is the layout itself that failed, so this
 * file owns <html>/<body> and imports the stylesheet directly. It deliberately
 * avoids next/image and shared components — anything that could be part of the
 * failure — and uses plain anchors instead of next/link.
 */
export default function GlobalError({
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
    <html lang="sl">
      <body>
        <main className="error-screen">
          <div className="error-screen-inner">
            <span className="error-screen-brand" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/memo-lockup.png" alt="Memo AI" width={480} height={148} />
            </span>

            <p className="error-screen-code">500</p>
            <h1 className="error-screen-title">Nekaj je šlo narobe.</h1>
            <p className="error-screen-copy">
              Napako smo zabeležili in jo pregledujemo. Poskusi znova ali se vrni čez nekaj minut.
            </p>

            <div className="error-screen-actions">
              <button type="button" className="error-screen-primary" onClick={reset}>
                Poskusi znova
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="error-screen-secondary">
                Nazaj na domačo stran
              </a>
              {error.digest ? (
                <p className="error-screen-digest">Koda napake: {error.digest}</p>
              ) : null}
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
