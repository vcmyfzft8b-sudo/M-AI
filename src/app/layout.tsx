import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { I18nProvider } from "@/components/i18n-provider";
import { KeyboardInset } from "@/components/keyboard-inset";
import { LaunchScreen } from "@/components/launch-screen";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import { ThemeController } from "@/components/theme-controller";
import { VisitTracker } from "@/components/visit-tracker";
import { SEO_BRAND_NAME, SEO_SITE_URL } from "@/lib/brand";
import { LOCALE_BCP47, LOCALE_OG_TAG } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/messages";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { splashScreens } from "@/lib/splash-screens";

import "katex/dist/katex.min.css";
import "./globals.css";
import "./redesign.css";

/**
 * The redesign draws every glyph from Material Symbols Rounded. `next/font`
 * has no icon fonts in its catalogue, so the family is requested straight from
 * Google — subset to the icons we actually render (`icon_names`), because the
 * unsubset variable font is several megabytes. `display=block` stops ligature
 * names ("chevron_right") flashing as literal words before the font arrives.
 *
 * Add any new icon to this list, or `.msym` will render its name as text.
 */
const MATERIAL_SYMBOL_NAMES = [
  "account_tree",
  "add",
  "add_photo_alternate",
  "arrow_back",
  "arrow_drop_down",
  "arrow_forward",
  "arrow_upward",
  "assignment",
  "battery_full",
  "bolt",
  "cancel",
  "center_focus_strong",
  "chat_bubble",
  "check",
  "check_circle",
  "chevron_right",
  "close",
  "close_fullscreen",
  "cloud_upload",
  "delete",
  "description",
  "download",
  "drag_handle",
  "drive_file_rename_outline",
  "edit",
  "edit_square",
  "expand_less",
  "expand_more",
  "folder",
  "folder_delete",
  "forum",
  "forward_10",
  "graphic_eq",
  "headphones",
  "help",
  "home",
  "ink_highlighter",
  "ios_share",
  "language",
  "link",
  "menu",
  "mic",
  "mic_off",
  "more_horiz",
  "open_in_full",
  "palette",
  "pause",
  "person",
  "photo_camera",
  "photo_library",
  "play_arrow",
  "progress_activity",
  "quiz",
  "radio_button_checked",
  "refresh",
  "remove",
  "replay",
  "replay_10",
  "restart_alt",
  "schedule",
  "search",
  "settings",
  "signal_cellular_alt",
  "skip_previous",
  "speed",
  "stop",
  "style",
  "text_fields",
  "text_snippet",
  "tune",
  "unfold_less",
  "unfold_more",
  "warning",
  "wifi",
].join(",");

const MATERIAL_SYMBOLS_HREF =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..700,0..1,-50..200" +
  `&icon_names=${MATERIAL_SYMBOL_NAMES}&display=block`;

/**
 * The launch screens an installed Memo shows before its first paint. iOS only
 * accepts an image whose pixel size matches the device exactly, so there is one
 * per screen, per orientation, per colour scheme — see src/lib/splash-screens.ts.
 * Next's metadata API has no field for these, so they go in the head by hand.
 */
const APPLE_STARTUP_IMAGES = splashScreens();

/**
 * The colour the installed app's own chrome takes on Android — its title bar
 * and, together with the CSS canvas above, what Chrome may draw the launch
 * screen on. The manifest can only carry one `background_color`, so a media
 * query here is the only way the two appearances differ there at all.
 *
 * These are `--bg` from redesign.css, the same pair the iOS launch screens are
 * drawn on. iOS ignores the tag outright (measured in #178), so it costs
 * nothing there and is the whole mechanism on Android.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f1f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121214" },
  ],
};

/**
 * Title, description and Open Graph in the language this visitor is being
 * served, which is a cookie read — so this is `generateMetadata` rather than a
 * static `metadata` object. Everything that is not language (icons, manifest,
 * the Apple web-app flags) is unchanged.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getTranslations();
  const siteTitle = `${SEO_BRAND_NAME} | ${t("meta.shortline")}`;
  const description = t("meta.description");

  return {
    metadataBase: new URL(SEO_SITE_URL),
    manifest: "/manifest.webmanifest",
    title: {
      default: siteTitle,
      template: `%s | ${SEO_BRAND_NAME}`,
    },
    description,
    applicationName: SEO_BRAND_NAME,
    openGraph: {
      title: siteTitle,
      description,
      url: "/",
      siteName: SEO_BRAND_NAME,
      locale: LOCALE_OG_TAG[locale],
      type: "website",
    },
    twitter: {
      card: "summary",
      title: siteTitle,
      description,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: SEO_BRAND_NAME,
    },
    icons: {
      icon: [
        {
          url: "/favicon.ico",
          sizes: "any",
          type: "image/x-icon",
        },
        {
          url: "/memo-favicon-96x96.png",
          sizes: "96x96",
          type: "image/png",
        },
        {
          url: "/memo-favicon-32x32.png",
          sizes: "32x32",
          type: "image/png",
        },
        {
          url: "/memo-favicon-16x16.png",
          sizes: "16x16",
          type: "image/png",
        },
      ],
      shortcut: "/favicon.ico",
      apple: [
        {
          url: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={LOCALE_BCP47[locale]} suppressHydrationWarning>
      <head>
        {/*
          * iOS will not use an `apple-touch-startup-image` unless the page also
          * claims `apple-mobile-web-app-capable`, and Next no longer emits it:
          * `appleWebApp.capable` renders the standards-track
          * `mobile-web-app-capable` instead, which iOS ignores. The launch
          * screens were served, correctly sized, matched by their media
          * queries, and silently unused because of this one missing line.
          *
          * Measured by taking production's own HTML, serving it unchanged from
          * localhost — blank launch screen — and then adding only this tag:
          * the mark appeared. Do not remove it on the grounds that the
          * metadata API already covers it. It does not.
          */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={MATERIAL_SYMBOLS_HREF} />
        {APPLE_STARTUP_IMAGES.map((screen) => (
          <link
            key={screen.media}
            rel="apple-touch-startup-image"
            href={screen.url}
            media={screen.media}
          />
        ))}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var theme = localStorage.getItem("nota-theme");
                  if (theme === "light" || theme === "dark") {
                    document.documentElement.dataset.theme = theme;
                    document.documentElement.style.colorScheme = theme;
                  } else {
                    document.documentElement.removeAttribute("data-theme");
                    document.documentElement.style.colorScheme = "";
                  }
                } catch (error) {}
                try {
                  /*
                   * iOS's own standalone flag, mirrored onto the element so
                   * CSS can read it. The display-mode media query covers this
                   * on every current iOS, and both gate the launch screen;
                   * this is the older test, kept because the launch screen is
                   * the one thing that has to be right before anything else
                   * runs.
                   */
                  if (window.navigator.standalone === true) {
                    document.documentElement.dataset.standalone = "";
                  }
                } catch (error) {}
                try {
                  // Which promo card the home screen last showed, so its
                  // skeleton can draw that card instead of a hole where it
                  // goes. See src/lib/home-promo-hint.ts.
                  var promo = localStorage.getItem("memo-home-promo");
                  if (promo === "wheel" || promo === "upgrade") {
                    document.documentElement.dataset.homePromo = promo;
                  } else {
                    document.documentElement.removeAttribute("data-home-promo");
                  }
                } catch (error) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        {/*
          * First in the body: the launch screen is the only thing on screen
          * while the app arrives, and being first is what lets the HTML parser
          * start its one image before it reaches anything else.
          */}
        <LaunchScreen />
        <I18nProvider locale={locale} messages={getMessages(locale)}>
          <ThemeController />
          <ServiceWorkerRegistration />
          <KeyboardInset />
          {children}
          <VisitTracker />
        </I18nProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
