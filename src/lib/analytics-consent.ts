export const ANALYTICS_COOKIE = "memo-analytics";
export const ANALYTICS_MAX_AGE = 180 * 24 * 60 * 60;
const CHANGE_EVENT = "memo-analytics-change";

/** A versioned, time-limited choice. Missing, old and malformed values deny. */
export function hasAnalyticsConsent(value: string | undefined, now = Date.now()) {
  const match = /^v1\.granted\.(\d{13})$/.exec(value ?? "");
  if (!match) return false;
  const age = now - Number(match[1]);
  return age >= 0 && age < ANALYTICS_MAX_AGE * 1000;
}

export function readAnalyticsConsent() {
  try {
    const value = document.cookie.split(";").map(part => part.trim())
      .find(part => part.startsWith(`${ANALYTICS_COOKIE}=`))?.slice(ANALYTICS_COOKIE.length + 1);
    if (!hasAnalyticsConsent(value)) return false;
    // WebKit can restore an older cookie after the app process exits. The
    // separate preference record may veto that stale grant, but must never
    // recreate a grant when cookies were cleared, blocked or expired.
    try {
      const saved = localStorage.getItem(ANALYTICS_COOKIE);
      const denied = /^v1\.denied\.(\d{13})$/.exec(saved ?? "");
      const grantedAt = Number(value?.split(".")[2]);
      if (denied && Number(denied[1]) >= grantedAt) return false;
    } catch { /* A readable consent cookie still works without localStorage. */ }
    return true;
  } catch {
    return false;
  }
}

export function setAnalyticsConsent(allowed: boolean) {
  const value = `v1.${allowed ? "granted" : "denied"}.${Date.now()}`;
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${ANALYTICS_COOKIE}=${value}; Path=/; Max-Age=${ANALYTICS_MAX_AGE}; SameSite=Lax${secure}`;
    if (!allowed) clearVisitorCookie();
    // Broadcast only the preference, never an account or visitor identifier.
    try { localStorage.setItem(ANALYTICS_COOKIE, value); } catch { /* Cookies remain authoritative. */ }
  } catch { /* A blocked cookie cannot grant consent. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return readAnalyticsConsent() === allowed;
}

export function clearVisitorCookie() {
  try {
    document.cookie = `memo-visit=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* Storage can be blocked. */ }
}

export function subscribeToAnalyticsConsent(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === ANALYTICS_COOKIE) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", storage);
  window.addEventListener("focus", onChange);
  const timer = window.setInterval(onChange, 60_000);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", onChange);
    window.clearInterval(timer);
  };
}
