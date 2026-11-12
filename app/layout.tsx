import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import SiteHeader from "./site-header";
import ThemeToggle from "./theme-toggle";
import "./globals.css";

// Pocket Casts sets its site in Retina and SF Pro, which can't be served
// from here. Inter is the closest open grotesque.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

const themeBoot = `(function(){try{var k="feed-tools-theme";var t=localStorage.getItem(k);if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Search Pocket Casts, turn a show link into an RSS feed, and check a public feed.",
  keywords: [
    "podcast rss feed",
    "pocket casts rss",
    "apple podcasts rss",
    "spotify podcast rss",
    "podcast feed validator",
  ],
  openGraph: {
    title: `${SITE_NAME} — RSS from a show link`,
    description:
      "Resolve a Pocket Casts, Apple Podcasts, or Spotify link to the show's public RSS feed, and check a feed for the problems that stop it updating.",
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <SiteHeader />
        <main id="content" className="shell">
          {children}
        </main>
        <footer className="footer">
          <div className="shell">
            {SITE_NAME}. Show links resolve to public feeds only. The feed checker works with
            private feeds too.
          </div>
        </footer>
        <ThemeToggle />
      </body>
    </html>
  );
}
