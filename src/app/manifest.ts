import type { MetadataRoute } from "next";

import { SEO_BRAND_NAME } from "@/lib/brand";
import { getTranslations } from "@/lib/i18n/server";
import { SPLASH_BACKGROUNDS } from "@/lib/splash-screens";

/**
 * The installed app's identity, served at /manifest.webmanifest.
 *
 * iOS reads the name and the display mode; the launch screen it draws comes
 * from the `apple-touch-startup-image` links in the root layout. Android has
 * no equivalent link — it builds its splash from `background_color` and the
 * 512px icon here, which is why both must stay in step with the PNGs that
 * scripts/generate-splash-screens.mjs writes.
 *
 * `start_url` is the app, not the landing page: someone who kept Memo on their
 * home screen has already been sold. Signed out, /app sends them to / anyway.
 *
 * There is deliberately no `orientation`. Declaring one locks rotation on
 * Android, and the app has a landscape answer on both sides of its breakpoint:
 * a tablet turned sideways reaches the desktop rail layout at 1100px, and the
 * launch screens below cover landscape too. Which way to hold the device is the
 * reader's call.
 *
 * Async, because the description and `lang` follow the visitor's language.
 *
 * A `<link rel="manifest">` is fetched without cookies unless the tag opts in,
 * so the language cookie is usually absent here and detection falls through to
 * the country header — which Vercel does attach. That is the right outcome
 * anyway: the manifest describes the app to the operating system at install
 * time, where the country the device is in is the better signal.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { locale, t } = await getTranslations();

  return {
    name: SEO_BRAND_NAME,
    // The label under the home-screen icon. `short_name` beats the
    // `apple-mobile-web-app-title` that used to supply it, so the bare "Memo"
    // this once held quietly renamed the installed app.
    short_name: SEO_BRAND_NAME,
    description: t("meta.description"),
    lang: locale,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: SPLASH_BACKGROUNDS.light,
    theme_color: SPLASH_BACKGROUNDS.light,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
