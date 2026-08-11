"use client";

import { useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";

/**
 * In-app account deletion.
 *
 * Required by App Store Guideline 5.1.1(v) — an app offering account creation must offer
 * deletion from inside the app. Deliberately behind a typed confirmation: this cancels billing
 * and destroys every note, and there is no undo.
 */
const CONFIRMATION_WORD = "IZBRIŠI";

export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmation.trim().toUpperCase() === CONFIRMATION_WORD && !deleting;

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/account/delete", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Računa ni bilo mogoče izbrisati.");
      }

      // Full reload rather than a router push: every cached server response belongs to a user
      // that no longer exists.
      window.location.href = "/";
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Računa ni bilo mogoče izbrisati.",
      );
      setDeleting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="dashboard-link-card settings-link-card settings-danger-card"
        onClick={() => setOpen(true)}
      >
        <span className="note-action-card-icon">
          <EmojiIcon symbol="🗑️" size="1.2rem" />
        </span>
        <span className="note-action-card-copy">
          <span className="note-action-card-label">Izbriši račun</span>
          <span className="note-action-card-detail">
            Trajno izbriše račun, zapiske in naročnino
          </span>
        </span>
        <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
      </button>
    );
  }

  return (
    <div className="dashboard-surface-card settings-danger-panel">
      <h3>Izbriši račun</h3>
      <p>
        To dejanje je trajno. Izbrisali bomo tvoj račun, vse zapiske, posnetke in gradiva.
        Morebitna naročnina bo preklicana. Tega ni mogoče razveljaviti.
      </p>
      <label htmlFor="delete-account-confirm">
        Za potrditev vpiši <strong>{CONFIRMATION_WORD}</strong>
      </label>
      <input
        id="delete-account-confirm"
        type="text"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={deleting}
      />

      {error ? <p className="ios-info ios-danger">{error}</p> : null}

      <div className="settings-danger-actions">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirmation("");
            setError(null);
          }}
          disabled={deleting}
        >
          Prekliči
        </button>
        <button
          type="button"
          className="settings-danger-confirm"
          onClick={handleDelete}
          disabled={!canDelete}
        >
          {deleting ? "Brišem…" : "Trajno izbriši"}
        </button>
      </div>
    </div>
  );
}
