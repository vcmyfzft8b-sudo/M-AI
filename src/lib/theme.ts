export type ThemePreference = "system" | "light" | "dark";

export const THEME_EVENT = "nota-theme-change";
export const THEME_STORAGE_KEY = "nota-theme";

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }

  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    return;
  }

  document.documentElement.dataset.theme = preference;
  document.documentElement.style.colorScheme = preference;
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
}

export function setThemePreference(preference: ThemePreference) {
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeToThemePreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      onStoreChange();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_EVENT, onStoreChange);
  };
}
