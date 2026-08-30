export const INSTALL_GUIDE_SEEN_KEY = "memo-install-guide-seen";

export type InstallPlatform = "ios" | "android" | "other";

/**
 * Which set of instructions to show.
 *
 * The two platforms put the control in different places and call it different
 * things — iOS hides it behind Share, Android behind the overflow menu — so a
 * single generic set of steps would be wrong on both. Anything else gets the
 * desktop wording, which is honest rather than pretending there is a home
 * screen to add to.
 *
 * iPad is the reason this looks at touch points rather than only at the user
 * agent: iPadOS reports itself as a Mac, and has done since iPadOS 13.
 */
export function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") {
    return "other";
  }

  const ua = navigator.userAgent;
  const isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;

  if (/iPad|iPhone|iPod/.test(ua) || isIpad) {
    return "ios";
  }

  if (/Android/.test(ua)) {
    return "android";
  }

  return "other";
}

/**
 * True when the app is already running from the home screen, in which case
 * there is nothing to explain and no reason to draw attention to it.
 *
 * `standalone` is the iOS-only property; the media query covers everyone else.
 */
export function isInstalled() {
  if (typeof window === "undefined") {
    return false;
  }

  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;

  return Boolean(iosStandalone) || window.matchMedia("(display-mode: standalone)").matches;
}

/** Whether the guide still has something to say to this person. */
export function shouldOfferInstallGuide() {
  if (typeof window === "undefined") {
    return false;
  }

  if (isInstalled()) {
    return false;
  }

  try {
    return window.localStorage.getItem(INSTALL_GUIDE_SEEN_KEY) !== "true";
  } catch {
    // Safari throws on storage access in some privacy modes. Offering the
    // guide again is a smaller cost than crashing the settings screen.
    return true;
  }
}

export function markInstallGuideSeen() {
  try {
    window.localStorage.setItem(INSTALL_GUIDE_SEEN_KEY, "true");
    window.dispatchEvent(new Event(INSTALL_GUIDE_SEEN_KEY));
  } catch {
    // Nothing to do: the guide simply offers itself again next time.
  }
}
