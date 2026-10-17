import type { ReactNode } from "react";

import { AnimatedLockup } from "@/components/animated-lockup";

/**
 * Shared shell for the 404 and error boundaries. Kept free of client hooks so
 * both the static not-found page and the "use client" error boundaries can use
 * it, and free of app chrome so it renders even when a layout above it failed.
 */
export function ErrorScreen({
  code,
  title,
  description,
  actions,
}: {
  code: string;
  title: string;
  description: string;
  actions: ReactNode;
}) {
  return (
    <main className="error-screen">
      <div className="error-screen-inner">
        <span className="error-screen-brand" aria-hidden="true">
          <AnimatedLockup fill priority />
        </span>

        <p className="error-screen-code">{code}</p>
        <h1 className="error-screen-title">{title}</h1>
        <p className="error-screen-copy">{description}</p>

        <div className="error-screen-actions">{actions}</div>
      </div>
    </main>
  );
}
