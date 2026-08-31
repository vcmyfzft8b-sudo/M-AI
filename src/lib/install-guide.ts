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
 * Adding Memo to the home screen, step by step.
 *
 * Shot on an iPhone 17 Pro simulator running iOS 26.5, from `/creator` — the
 * signed-out view of the app itself, so the screen behind the menus is the
 * library rather than the marketing page. That is where someone reading this
 * actually is. Recapture with `xcrun simctl io <udid> screenshot` after any
 * iOS release that moves these controls, then re-measure `highlight`.
 *
 * Six steps, not four. iOS 26 moved Share into the `...` menu and collapses
 * the share sheet, so "Add to Home Screen" is two taps further down than it
 * used to be — the old four-step guide sent people looking for a button that
 * is no longer on screen. The View More step is written as a conditional
 * because the sheet stays expanded once it has been opened before.
 *
 * Shared with the onboarding paywall, which shows the same set: one set of
 * images and one set of words, so the two places that explain this cannot
 * drift into explaining it differently.
 *
 * `highlight` is a box drawn over the shot to point at the control being
 * described, in percentages so it survives the image being served at any size.
 */
export const HOME_SCREEN_STEPS = [
  {
    title: "Odpri meni v Safariju",
    description: "Spodaj desno pritisni gumb s tremi pikami.",
    src: "/onboarding/add-to-home-1-menu.webp",
    alt: "Memo v Safariju, z gumbom menija spodaj desno",
    highlight: { left: "80%", top: "90.8%", width: "12%", height: "5%" },
  },
  {
    title: "Pritisni Share",
    description: "V meniju izberi Share.",
    src: "/onboarding/add-to-home-2-share.webp",
    alt: "Safari meni z možnostjo Share",
    highlight: { left: "33%", top: "59.6%", width: "63%", height: "4.8%" },
  },
  {
    title: "Razširi seznam",
    description: "Če Add to Home Screen ne vidiš, pritisni View More.",
    src: "/onboarding/add-to-home-3-more.webp",
    alt: "Delilni meni z gumbom View More",
    highlight: { left: "75.8%", top: "85.8%", width: "18%", height: "11.2%" },
  },
  {
    title: "Izberi Add to Home Screen",
    description: "Na seznamu pritisni Add to Home Screen.",
    src: "/onboarding/add-to-home-4-add.webp",
    alt: "Razširjen delilni meni z možnostjo Add to Home Screen",
    highlight: { left: "4.8%", top: "71%", width: "90.4%", height: "4.8%" },
  },
  {
    title: "Potrdi z Add",
    description: "Ime lahko pustiš, kot je, in zgoraj desno pritisneš Add.",
    src: "/onboarding/add-to-home-5-confirm.webp",
    alt: "Potrditveno okno Add to Home Screen za Memo",
    highlight: { left: "79.2%", top: "9.6%", width: "16.6%", height: "5.6%" },
  },
  {
    title: "Memo je na začetnem zaslonu",
    description: "Od tod se odpre čez cel zaslon, brez vrstice brskalnika.",
    src: "/onboarding/add-to-home-6-done.webp",
    alt: "Ikona Memo na začetnem zaslonu iPhona",
    highlight: { left: "51.8%", top: "21.8%", width: "17.6%", height: "11.8%" },
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
