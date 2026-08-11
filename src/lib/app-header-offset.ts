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
