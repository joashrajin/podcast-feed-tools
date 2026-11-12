import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { REPO_URL, SITE_NAME, SITE_URL } from "@/lib/site";
import ReportLink from "./report-link";
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
  applicationName: SITE_NAME,
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Find the RSS feed behind a podcast, YouTube channel, SoundCloud profile, or website. Search Pocket Casts and check a feed.",
  keywords: [
    "podcast rss feed",
    "find podcast rss feed",
    "pocket casts rss",
    "apple podcasts rss",
    "spotify podcast rss",
    "podcast feed validator",
    "podcast rss checker",
    "youtube rss feed",
    "soundcloud rss feed",
    "find rss feed of website",
  ],
  // Lets search results show the full share image and snippet.
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  // Pages set their own; this covers any page that doesn't.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en",
    title: SITE_NAME,
    description:
      "Find the RSS feed behind a podcast, YouTube channel, SoundCloud profile, or website, and check a feed for the problems that stop it updating.",
  },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fa" },
    { media: "(prefers-color-scheme: dark)", color: "#161718" },
  ],
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
          <div className="shell footer-row">
            <p>
              Found a bug or have an idea?{" "}
              <a href={`${REPO_URL}/issues`}>Open an issue on GitHub</a>, or{" "}
              <ReportLink>send a quick report</ReportLink>.
            </p>
            <p className="footer-meta">
              Powered by <a href="https://spacefast.com">Spacefast</a>
              <span aria-hidden="true"> · </span>
              Created by <a href="https://joash.blog">Joash</a>
              <span aria-hidden="true"> · </span>
              <a href={REPO_URL}>Source on GitHub</a>
            </p>
          </div>
        </footer>
        <ThemeToggle />
      </body>
    </html>
  );
}
