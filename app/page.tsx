import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata, webApplication, webSite } from "@/lib/seo";
import JsonLd from "./json-ld";
import ResolverForm from "./resolver-form";

const description =
  "Paste a podcast, YouTube, SoundCloud, or website link and get its RSS feed. Works with Pocket Casts, Apple Podcasts, and Spotify. Free, no sign-up.";

export const metadata: Metadata = pageMetadata({
  // The layout's title template skips a page in its own segment, and the
  // search terms matter more here than the site name.
  title: "Find any RSS feed: podcasts, YouTube, SoundCloud, and websites",
  absolute: true,
  description,
  path: "/",
});

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1 className="hero-title">
          Find any <span className="hero-accent">RSS feed</span>
        </h1>
        <p className="hero-sub">Podcasts, YouTube channels, SoundCloud creators, and blogs.</p>
        <ResolverForm />
        <p className="hero-more">
          <Link href="/faq">How it works</Link>
          <span aria-hidden="true"> · </span>
          <Link href="/tools">Check a feed</Link>
        </p>
      </section>
      <JsonLd items={[webSite(), webApplication("RSS feed finder", "/", description)]} />
    </>
  );
}
