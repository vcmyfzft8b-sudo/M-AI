import type { MetadataRoute } from "next";

import { SEO_SITE_URL } from "@/lib/brand";
import { SEO_LAST_MODIFIED, SEO_PUBLIC_PAGES } from "@/lib/seo-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(SEO_LAST_MODIFIED);

  return [
    {
      url: SEO_SITE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...SEO_PUBLIC_PAGES.map((page) => ({
      url: `${SEO_SITE_URL}/${page.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
