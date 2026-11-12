import type { MetadataRoute } from "next";
import { SITE_MARK, SITE_NAME } from "@/lib/site";

// Icons are drawn by scripts/brand-images.py.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_MARK,
    description: "Turn a show link into its RSS feed, search Pocket Casts, and check a feed.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f9fa",
    theme_color: "#f43e37",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
