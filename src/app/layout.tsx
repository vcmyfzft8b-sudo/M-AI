import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import { BrowserChromeColor } from "@/components/browser-chrome-color";
import { ThemeController } from "@/components/theme-controller";
import {
  BRAND_SHORTLINE,
  SEO_BRAND_NAME,
  SEO_SITE_DESCRIPTION,
  SEO_SITE_URL,
} from "@/lib/brand";
import {
  CANVAS_COLOR_DARK,
  CANVAS_COLOR_LIGHT,
  THEME_COLOR_META_ATTRIBUTE,
} from "@/lib/browser-chrome-color";

import "katex/dist/katex.min.css";
import "./globals.css";

const siteTitle = `${SEO_BRAND_NAME} | ${BRAND_SHORTLINE}`;

export const metadata: Metadata = {
  metadataBase: new URL(SEO_SITE_URL),
  title: {
    default: siteTitle,
    template: `%s | ${SEO_BRAND_NAME}`,
  },
  description: SEO_SITE_DESCRIPTION,
  applicationName: SEO_BRAND_NAME,
  openGraph: {
    title: siteTitle,
    description: SEO_SITE_DESCRIPTION,
    url: "/",
    siteName: SEO_BRAND_NAME,
    locale: "sl_SI",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: siteTitle,
    description: SEO_SITE_DESCRIPTION,
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var resolved = "";
                try {
                  var theme = localStorage.getItem("nota-theme");
                  if (theme === "light" || theme === "dark") {
                    document.documentElement.dataset.theme = theme;
                    document.documentElement.style.colorScheme = theme;
                    resolved = theme;
                  } else {
                    document.documentElement.removeAttribute("data-theme");
                    document.documentElement.style.colorScheme = "";
                    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
                      ? "dark"
                      : "light";
                  }
                } catch (error) {}
                // Tint the browser toolbars before the first paint; once
                // hydrated, BrowserChromeColor keeps this meta in step with
                // whatever the app paints at the bottom of the viewport. It is
                // created here rather than through Next's viewport metadata so
                // React never claims it back during hydration.
                try {
                  var canvas =
                    resolved === "dark" ? "${CANVAS_COLOR_DARK}" : "${CANVAS_COLOR_LIGHT}";
                  var meta = document.createElement("meta");
                  meta.setAttribute("name", "theme-color");
                  meta.setAttribute("${THEME_COLOR_META_ATTRIBUTE}", "");
                  meta.setAttribute("content", canvas);
                  document.head.prepend(meta);
                } catch (error) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeController />
        {children}
        <BrowserChromeColor />
        <Analytics />
      </body>
    </html>
  );
}
