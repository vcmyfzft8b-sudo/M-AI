import type { MetadataRoute } from "next";

import { SEO_SITE_URL } from "@/lib/brand";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SEO_SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
      alternates: {
        languages: {
          "sl-SI": SEO_SITE_URL,
          "cs-CZ": `${SEO_SITE_URL}/cz`,
          "x-default": SEO_SITE_URL,
        },
      },
    },
    {
      url: `${SEO_SITE_URL}/cz`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
      alternates: {
        languages: {
          "sl-SI": SEO_SITE_URL,
          "cs-CZ": `${SEO_SITE_URL}/cz`,
          "x-default": SEO_SITE_URL,
        },
      },
    },
  ];
}
