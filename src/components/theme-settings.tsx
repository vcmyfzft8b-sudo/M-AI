"use client";

import { useSyncExternalStore } from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import { useI18n } from "@/components/locale-provider";
import type { ThemePreference } from "@/lib/theme";
import {
  readStoredThemePreference,
  setThemePreference,
  subscribeToThemePreference,
} from "@/lib/theme";

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: string;
}> = [
  {
    value: "system",
    label: "Sistem",
    icon: "💻",
  },
  {
    value: "light",
    label: "Svetla",
    icon: "☀️",
  },
  {
    value: "dark",
    label: "Temna",
    icon: "🌙",
  },
];

export function ThemeSettings() {
  const { dictionary } = useI18n();
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readStoredThemePreference,
    () => "system",
  );

  function updatePreference(next: ThemePreference) {
    if (next === preference) {
      return;
    }

    setThemePreference(next);
  }

  return (
    <div className="theme-choice-grid">
      {OPTIONS.map((option) => {
        const active = preference === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => updatePreference(option.value)}
            aria-pressed={active}
            className={`dashboard-link-card settings-link-card theme-choice-card ${active ? "active" : ""}`}
          >
            <span className="note-action-card-icon">
              <EmojiIcon symbol={option.icon} size="1.2rem" />
            </span>
            <span className="note-action-card-copy">
              <span className="note-action-card-label">
                {option.value === "system"
                  ? dictionary.theme.system
                  : option.value === "light"
                    ? dictionary.theme.light
                    : dictionary.theme.dark}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
