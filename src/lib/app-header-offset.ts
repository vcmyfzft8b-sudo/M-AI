const APP_HEADER_SELECTORS = [".app-topbar", ".desktop-brandline"];

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
  const element = document.querySelector<HTMLElement>(".desktop-sidebar");

  if (!element) {
    return 0;
  }

  const rect = element.getBoundingClientRect();

  return rect.width > 0 && rect.height > 0 ? Math.max(0, rect.right) : 0;
}
