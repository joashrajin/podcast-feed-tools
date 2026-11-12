import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader, Public_Sans } from "next/font/google";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import SiteHeader from "./site-header";
import "./globals.css";

const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
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
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
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
            {SITE_NAME}. Public directories only. Private and paid feeds are not returned.
          </div>
        </footer>
      </body>
    </html>
  );
}
