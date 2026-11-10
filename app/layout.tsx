import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Get the RSS feed from any Pocket Casts link`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Paste a Pocket Casts share link (pca.st) and get the podcast's RSS feed instantly. Free tools for podcast creators: feed validator, debugging, and Pocket Casts submission checks.",
  keywords: [
    "pocket casts rss feed",
    "pca.st rss",
    "podcast rss feed finder",
    "podcast feed validator",
    "podcast feed debugger",
  ],
  openGraph: {
    title: `${SITE_NAME} — Pocket Casts RSS & feed tools for podcasters`,
    description:
      "Turn any Pocket Casts link into an RSS feed, and debug your podcast feed like a pro.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              🐱 {SITE_NAME}
            </Link>
            <div className="flex gap-6 text-sm">
              <Link href="/" className="hover:underline">
                RSS Finder
              </Link>
              <Link href="/validator" className="hover:underline">
                Feed Validator
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
          {children}
        </main>
        <footer className="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
          {SITE_NAME} — free tools for podcast creators.
        </footer>
      </body>
    </html>
  );
}
