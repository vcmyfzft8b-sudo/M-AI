import type { CSSProperties, ReactNode } from "react";

/*
 * The app, drawn on the marketing page.
 *
 * Everything under `src/components/landing/app/` renders the product's own markup —
 * the `.memo-*` classes from redesign.css and, where one exists, the app's own
 * component — rather than a hand-made likeness of it. This wrapper is what makes
 * that possible outside the app: it opens the `.memo` token scope, and picks the
 * appearance from the landing's rules instead of the app's saved preference.
 *
 * - "os" follows the operating system, as the rest of the landing page does.
 * - "light" / "dark" pin one, for the hero phone, whose Appearance setting the
 *   visitor can change inside the demo.
 * - "app" is the plain `.memo` scope, following the saved preference like the app
 *   itself — for a landing component mounted inside the app (the onboarding's tutor).
 *
 * See docs/landing-page-sync.md for why the landing must never draw its own copy
 * of an app screen.
 */
export type LandingAppTheme = "os" | "light" | "dark" | "app";

const THEME_CLASS: Record<LandingAppTheme, string> = {
  os: "memo-os-theme",
  light: "memo-theme-light",
  dark: "memo-theme-dark",
  app: "",
};

export function LandingAppScope({
  theme = "os",
  className,
  style,
  children,
}: {
  theme?: LandingAppTheme;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={["memo memo-embed", THEME_CLASS[theme], className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}
