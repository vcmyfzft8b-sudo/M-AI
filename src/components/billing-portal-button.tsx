"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import { useT } from "@/components/i18n-provider";

export function BillingPortalButton() {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? t("billing.portalFailed"));
      }

      window.location.href = payload.url;
    } catch (portalError) {
      setError(
        portalError instanceof Error
          ? portalError.message
          : t("billing.portalFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings-action-stack">
      <button type="button" className="settings-inline-action" onClick={handleClick} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <EmojiIcon symbol="💳" size="0.95rem" />}
        {/*
         * The label is wrapped rather than written as bare text. Pressing this swaps
         * the card icon for the spinner, and React places the new node by inserting
         * before the host sibling it remembers — the label. Chrome's page
         * translation rewrites a bare text node into a pair of <font> wrappers and
         * so takes it out of the button; the insert then throws NotFoundError and
         * drops settings onto the error screen, the way it did on onboarding
         * (Sentry MEMOAI-WEB-3A). Translation rewrites the inside of an element and
         * never moves the element itself, so a <span> stays where React left it.
         */}
        <span>{t("billing.manageSubscription")}</span>
      </button>
      {error ? (
        <p className="settings-action-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
