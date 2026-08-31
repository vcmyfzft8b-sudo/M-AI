import type { MetadataRoute } from "next";

import {
  BRAND_NAME,
  SEO_BRAND_NAME,
  SEO_SITE_DESCRIPTION,
} from "@/lib/brand";
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
 * home screen has already been sold.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SEO_BRAND_NAME,
    short_name: BRAND_NAME,
    description: SEO_SITE_DESCRIPTION,
    lang: "sl",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
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
