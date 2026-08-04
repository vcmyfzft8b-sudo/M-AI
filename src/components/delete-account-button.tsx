"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

const CONFIRMATION_TEXT = "IZBRIŠI";

export function DeleteAccountButton() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmation = window.prompt(
      "Brisanje je trajno. Izbrisani bodo račun, zapiski, datoteke in aktivna spletna naročnina. Za potrditev vpiši IZBRIŠI.",
    );

    if (confirmation !== CONFIRMATION_TEXT) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Računa ni bilo mogoče izbrisati.");
      }

      window.location.replace("/auth/continue");
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
    <div className="settings-action-stack">
      <button
        type="button"
        className="settings-inline-action settings-danger-action"
        onClick={handleDelete}
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
      {error ? <p className="settings-action-error">{error}</p> : null}
    </div>
  );
}
