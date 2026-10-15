/**
 * The app page before this one, as this tab moved between them.
 *
 * A screen that sits on top of another one (the paywall) closes by stepping
 * back when it was opened from the page it returns to: the router then shows
 * that page from what it already has, at once and where it was scrolled,
 * instead of loading it again behind a skeleton. A full load starts with no
 * previous page, and the screen falls back to navigating.
 *
 * Module state rather than storage: it must forget on a reload, which is
 * exactly when there is no in-app page to step back to.
 */
let current: string | null = null;
let previous: string | null = null;

let nextReplaces = false;

const QUIET_ENTRANCE = "data-paywall-closing";
let quietUntilArrival = false;
let quietSafety: number | undefined;

/** Called with every page the app shell shows. */
export function noteAppPath(path: string) {
  if (path === current) {
    return;
  }

  // A page that replaced the one before it has nothing behind it to step
  // back to; stepping back would leave past it.
  previous = nextReplaces ? null : current;
  current = path;
  nextReplaces = false;

  // The page a closing screen returned to is up: let its fades back once they
  // would have finished, so they do not start then instead.
  if (quietUntilArrival) {
    quietUntilArrival = false;
    window.setTimeout(endQuietEntrance, 400);
  }
}

/** Call before `router.replace`: the next page has no page of ours behind it. */
export function replacingNextPage() {
  nextReplaces = true;
}

function endQuietEntrance() {
  window.clearTimeout(quietSafety);
  document.documentElement.removeAttribute(QUIET_ENTRANCE);
}

/**
 * The next page shows without its entrance fades (`redesign.css`): a screen
 * closing should simply reveal what is under it.
 */
export function quietNextEntrance() {
  document.documentElement.setAttribute(QUIET_ENTRANCE, "");
  quietUntilArrival = true;
  window.clearTimeout(quietSafety);
  quietSafety = window.setTimeout(endQuietEntrance, 4000);
}

/** Whether the page just before this one in the tab is `href`'s. */
export function cameFromAppPath(href: string) {
  if (!previous) {
    return false;
  }

  try {
    return new URL(href, "https://memo.invalid").pathname === previous;
  } catch {
    return false;
  }
}
