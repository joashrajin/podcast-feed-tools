import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { SOURCE_PAGES } from "@/lib/source-pages";

// When each page's content last changed. Update a date when its page changes,
// so search engines can trust it; a build date on every page would not be.
const UPDATED = {
  home: "2026-11-13",
  search: "2026-11-13",
  tools: "2026-11-12",
  faq: "2026-11-13",
  dev: "2026-11-13",
  sources: "2026-11-13",
};

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: UPDATED.home, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: UPDATED.search, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/tools`, lastModified: UPDATED.tools, changeFrequency: "weekly", priority: 0.9 },
    ...SOURCE_PAGES.map((page) => ({
      url: `${SITE_URL}/${page.slug}`,
      lastModified: UPDATED.sources,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/faq`, lastModified: UPDATED.faq, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/dev`, lastModified: UPDATED.dev, changeFrequency: "monthly", priority: 0.5 },
  ];
}
