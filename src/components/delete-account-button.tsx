"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

export function DeleteAccountButton({
  hasActiveSubscription = false,
  subscriptionProvider = "web",
}: {
  hasActiveSubscription?: boolean;
  subscriptionProvider?: "ios-app" | "web";
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAppStoreSubscription = subscriptionProvider === "ios-app";

  async function deleteAccount() {
    if (isDeleting) {
      return;
    }

    const confirmed = window.confirm(
      [
        "Trajno izbrišem račun in vse povezane podatke v Memo AI?",
        hasActiveSubscription
          ? isAppStoreSubscription
            ? "To ne prekliče App Store naročnine. Naročnino upravljaš v nastavitvah App Store."
            : "To ne prekliče aktivne naročnine. Naročnino najprej prekliči v nastavitvah obračunavanja."
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Računa ni bilo mogoče izbrisati.");
      }

      window.location.href = "/";
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Računa ni bilo mogoče izbrisati.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <div className="settings-danger-zone">
      <button
        type="button"
        className="settings-inline-action danger"
        onClick={deleteAccount}
        disabled={isDeleting}
        aria-busy={isDeleting}
      >
        {isDeleting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        )}
        {isDeleting ? "Brišem račun..." : "Izbriši račun"}
      </button>
      {hasActiveSubscription ? (
        <p className="settings-danger-note">
          {isAppStoreSubscription
            ? "Brisanje računa ne prekliče App Store naročnine."
            : "Brisanje računa ne prekliče aktivne naročnine."}
        </p>
      ) : null}
      {error ? <p className="settings-danger-error">{error}</p> : null}
    </div>
  );
}
