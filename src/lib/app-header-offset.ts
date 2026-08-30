/*
 * The redesigned shell's header and rail come first; the two after them are the
 * old shell's and are kept for the routes still on it. Without the `memo-`
 * selectors both helpers answered 0 everywhere, so the fallback overlay covered
 * the header and the rail it is meant to leave alone.
 */
const APP_HEADER_SELECTORS = [".memo-header", ".app-topbar", ".desktop-brandline"];
const APP_SIDEBAR_SELECTORS = [".memo-rail", ".desktop-sidebar"];

/**
 * Bottom edge of whichever app header is currently visible, so a full-screen
 * navigation overlay can start below the chrome instead of covering it.
 */
export function getVisibleAppHeaderBottom() {
  for (const selector of APP_HEADER_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);

    if (!element) {
      continue;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width > 0 && rect.height > 0) {
      return Math.max(0, rect.bottom);
    }
  }

  return 0;
}

/**
 * Right edge of the desktop sidebar when one is visible, so the navigation overlay leaves the
 * sidebar (Domov / Pomoč / Nastavitve) interactive and visible instead of blanking it — the
 * route skeleton it stands in for renders inside the layout, next to the sidebar, never over it.
 * On mobile the sidebar is hidden and the offset is 0.
 */
export function getVisibleAppSidebarRight() {
  for (const selector of APP_SIDEBAR_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);

    if (!element) {
      continue;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width > 0 && rect.height > 0) {
      return Math.max(0, rect.right);
    }
  }

  return 0;
}
