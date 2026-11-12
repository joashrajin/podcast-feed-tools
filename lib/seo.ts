import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "./site";

type Page = {
  /** The page's own title. The layout appends the site name unless `absolute` is set. */
  title: string;
  description: string;
  /** Path of the page, used for its canonical address and og:url. */
  path: string;
  /** Use the title as written, without the site name after it. */
  absolute?: boolean;
};

/**
 * Title, description, canonical address, and social tags for one page.
 * A page's openGraph and twitter objects replace the layout's whole, so every
 * page sets all of them here. Share images come from each segment's
 * opengraph-image.png.
 */
export function pageMetadata({ title, description, path, absolute }: Page): Metadata {
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en",
      url: path,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export const absoluteUrl = (path: string) => new URL(path, SITE_URL).toString();

const websiteId = `${absoluteUrl("/")}#website`;

/** The site itself. Google reads its name from this on the homepage. */
export function webSite() {
  return { "@type": "WebSite", "@id": websiteId, name: SITE_NAME, url: absoluteUrl("/"), inLanguage: "en" };
}

/** A free, browser-based tool, described for search engines. */
export function webApplication(name: string, path: string, description: string) {
  return {
    "@type": "WebApplication",
    name,
    url: absoluteUrl(path),
    description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isPartOf: { "@id": websiteId },
  };
}

export function faqPage(faqs: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
}
