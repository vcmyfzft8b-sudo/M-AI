export type ThemePreference = "system" | "light" | "dark";

export const THEME_EVENT = "nota-theme-change";
export const THEME_STORAGE_KEY = "nota-theme";

// Safari throws `SecurityError` (DOMException code 18) from every `localStorage` property access
// when the visitor has site data blocked — "Block All Cookies", some Lockdown Mode and managed
// configurations. It is not a quota error and there is no flag to test for it beforehand: reading
// the property is what throws. The inline theme script in src/app/layout.tsx has always wrapped
// its own read for this reason; this module, which the script mirrors, did not — so the first
// thing ThemeController did on mount threw during render and took the page down for those
// visitors. A theme preference is a convenience, so every access degrades to "no preference".
function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTheme(preference: ThemePreference | null) {
  try {
    if (preference === null) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage is blocked, so the choice cannot outlive the page. Applying it still works.
  }
}

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = readStoredTheme();
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }

  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    writeStoredTheme(null);
    return;
  }

  document.documentElement.dataset.theme = preference;
  document.documentElement.style.colorScheme = preference;
  writeStoredTheme(preference);
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
