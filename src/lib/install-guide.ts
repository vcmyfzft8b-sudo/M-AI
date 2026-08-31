/*
 * Where the badge's state lives.
 *
 * The account is the source of truth (`profiles.install_guide_seen_at`, read
 * on the server and handed to the screens that draw the dot); this key is a
 * local echo of it, so a browser that has already been answered stays quiet
 * even when the write to the account failed.
 *
 * `-v2` because the old key was the *only* record of it, per browser. Everyone
 * carrying a stale "true" from that arrangement — including people who cleared
 * it on one device and never saw the badge on another — gets one clean look
 * under the account-backed rule.
 */
const INSTALL_GUIDE_SEEN_KEY = "memo-install-guide-seen-v2";

/**
 * Fired when the guide is opened, so the gear's badge and the settings row's
 * badge go out together without either of them polling storage.
 */
export const INSTALL_GUIDE_SEEN_EVENT = "memo-install-guide-seen";

/*
 * Adding Memo to the home screen, in real screenshots taken on a real iPhone.
 *
 * Shared with the onboarding paywall, which is where they came from — one set
 * of images and one set of words, so the two places that explain this cannot
 * drift into explaining it differently.
 *
 * `highlight` is a box drawn over the shot to point at the row being described,
 * in percentages so it survives the image being served at any size.
 */
export const HOME_SCREEN_STEPS = [
  {
    title: "Klikni Share",
    description: "V Safariju odpri meni in pritisni Share.",
    src: "/onboarding/add-home-screen-menu.png",
    alt: "Safari meni z možnostjo Share",
    highlight: { left: "27.4%", top: "58.75%", width: "64.2%", height: "4.15%" },
  },
  {
    title: "Izberi Add to Home Screen",
    description: "V share meniju pritisni Add to Home Screen.",
    src: "/onboarding/add-home-screen-share.png",
    alt: "iPhone delilni meni z možnostjo Add to Home Screen",
    highlight: { left: "5.2%", top: "78.65%", width: "89.6%", height: "5.15%" },
  },
  {
    title: "Pritisni Add",
    description: "Ime lahko pustiš Memo AI in potrdiš z Add.",
    src: "/onboarding/add-home-screen-add.png",
    alt: "Potrditev Add to Home Screen za Memo AI",
    highlight: { left: "78.5%", top: "8.4%", width: "18.2%", height: "5.4%" },
  },
  {
    title: "Memo AI je zdaj na Home Screenu",
    description: "Naslednjič ga odpreš kot aplikacijo.",
    src: "/onboarding/add-home-screen-result.png",
    alt: "Memo AI ikona na začetnem zaslonu iPhona",
    highlight: { left: "3.6%", top: "7.6%", width: "20.4%", height: "9.6%" },
  },
] as const;

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
 * Whether the guide still has something to say to this person.
 *
 * One rule, and only one: the badge is owed to every account until that
 * account opens the guide. `seenOnAccount` comes from the profile and is the
 * answer that travels — once it is true the badge is gone on every device. The
 * local flag only covers the gap where the account could not be told.
 *
 * Notably *not* a condition: whether the app is already running from the home
 * screen. It used to be one, on the reasoning that somebody who has installed
 * it has nothing left to read — but the phone the app was installed on is not
 * the only phone they own, `display-mode: standalone` is a fact about the
 * window rather than about the person, and it silently took the badge away
 * from accounts that had never once been shown it. Everybody gets their one
 * look; opening it is what ends it.
 */
export function shouldOfferInstallGuide(seenOnAccount = false) {
  if (typeof window === "undefined") {
    return false;
  }

  if (seenOnAccount) {
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

/*
 * One write per page load. Opening the guide twice is easy — the row stays
 * there after the sheet is closed — and the second POST would say nothing the
 * first did not.
 */
let seenReported = false;

export function markInstallGuideSeen() {
  try {
    window.localStorage.setItem(INSTALL_GUIDE_SEEN_KEY, "true");
  } catch {
    // Nothing to do: the account write below is the one that has to land.
  }

  window.dispatchEvent(new Event(INSTALL_GUIDE_SEEN_EVENT));

  if (seenReported) {
    return;
  }

  seenReported = true;

  /*
   * Fire and forget. The badge is already gone on screen, and a failure here
   * only means it is offered once more on the next visit — worth nothing to
   * report to somebody who just asked to read about home screens.
   *
   * `keepalive` because the very next thing this person does may be leaving
   * for Safari's share menu.
   */
  void fetch("/api/install-guide", { method: "POST", keepalive: true }).catch(() => {
    seenReported = false;
  });
}
