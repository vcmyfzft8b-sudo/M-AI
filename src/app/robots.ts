import type { MetadataRoute } from "next";

import { SEO_SITE_URL } from "@/lib/brand";

/**
 * What is worth crawling: the landing page in its five languages, the public
 * legal documents, and the share cards under /og.
 *
 * Everything disallowed below either needs a session or is not a page at all,
 * so crawling it spends budget and indexes nothing. None of them has a
 * language prefix — src/proxy.ts redirects `/sl/app` back to `/app`
 * permanently — so one rule each still covers every address they have.
 *
 * `/admin` was missing here until this file was revised, which left the
 * dashboard's login page crawlable. It is not a secret and the pages behind it
 * are guarded, but there is no reason for it to be in an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/app/", "/auth/", "/creator", "/admin"],
    },
    sitemap: `${SEO_SITE_URL}/sitemap.xml`,
    host: SEO_SITE_URL,
  };
}
