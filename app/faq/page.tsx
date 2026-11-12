import type { Metadata } from "next";
import Link from "next/link";
import { faqPage, pageMetadata } from "@/lib/seo";
import JsonLd from "../json-ld";

export const metadata: Metadata = pageMetadata({
  title: "FAQ: how links become RSS feeds",
  description:
    "How Pocket Casts, Apple Podcasts, Spotify, YouTube, SoundCloud, and website links are turned into RSS feeds, and what to do when one fails.",
  path: "/faq",
});

const sources = [
  {
    name: "Pocket Casts",
    how: "The link carries a show id. The Pocket Casts catalog address is used when it answers as RSS. Otherwise the title is matched exactly in Apple Podcasts, from your browser, and a conflicting publisher isn't accepted.",
  },
  {
    name: "Apple Podcasts",
    how: "The number after id in the link is the show. Your browser asks Apple's lookup API for the feed, and this site checks the address is public before showing it.",
  },
  {
    name: "Spotify",
    how: "Spotify doesn't publish RSS. The show name comes from the page or the episode embed and is matched to Apple Podcasts from your browser. One exact title is accepted.",
  },
  {
    name: "YouTube",
    how: "Every channel and public playlist has a feed at youtube.com/feeds/videos.xml. A handle, video, or custom link is read for its channel id first.",
  },
  {
    name: "SoundCloud",
    how: "Each account has a feed at feeds.soundcloud.com. A profile or track link is read for the account id, and the feed is fetched to confirm it.",
  },
  {
    name: "Blogs and websites",
    how: "The page's own feed links are read first. If it lists none, known patterns for hosts like Substack and Medium are tried, then common addresses such as /feed and /rss.xml.",
  },
];

const faqs = [
  {
    q: "Which links work?",
    a: "Pocket Casts (pca.st and pocketcasts.com), Apple Podcasts, and Spotify show or episode links. YouTube channels, handles, playlists, and videos. SoundCloud profiles and tracks. Any blog or website, with or without https:// in front.",
  },
  {
    q: "Why would a Spotify link fail?",
    a: "Spotify doesn't publish RSS. The show name is matched against Apple Podcasts, so a Spotify-only show, or a title that doesn't match, can't be resolved.",
  },
  {
    q: "Why is a SoundCloud feed empty?",
    a: "SoundCloud includes only the tracks a creator adds to RSS, under Settings, then Content. An account that hasn't set that up has a valid feed with no items.",
  },
  {
    q: "Can I get a YouTube feed in a podcast app?",
    a: "YouTube's feed lists videos and links to their pages. It doesn't include audio files, so podcast apps can't play it. Feed readers can.",
  },
  {
    q: "A website says it has no feed. What now?",
    a: "Some sites don't publish one, and some block automated requests. Try the blog or news section's own page rather than the homepage, since feeds are often listed there.",
  },
  {
    q: "Why does my browser contact Apple?",
    a: "Apple's directory often refuses this site's shared server address. Your browser asks Apple for the feed behind an Apple Podcasts link, and searches by name for Pocket Casts and Spotify shows, so Apple sees your address. No cookies are sent with that request.",
  },
  {
    q: "Can two podcasts with the same name get mixed up?",
    a: "An exact title is required. A publisher that points at a different show blocks the match, and when several shows still fit, the tool stops and names them.",
  },
  {
    q: "Does the feed checker work with private feeds?",
    a: "Yes. Paste a private feed link, or add a username and password for a feed behind a login. Show links only resolve to public feeds.",
  },
  {
    q: "Is anything stored?",
    a: "No. Links and feed addresses are used for that one request and not kept. Only a report you send through the report form is saved.",
  },
];

export default function FaqPage() {
  return (
    <>
      <h1>FAQ</h1>
      <p className="lede">
        How a link becomes a feed, and what to do when it doesn&apos;t. <Link href="/">Find a feed</Link>.
      </p>

      <section className="section">
        <h2>How each link becomes a feed</h2>
        <ol className="steps">
          {sources.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>
              <p>{source.how}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section">
        <h2>Questions</h2>
        <dl className="faq">
          {faqs.map((faq) => (
            <div key={faq.q}>
              <dt>{faq.q}</dt>
              <dd>{faq.a}</dd>
            </div>
          ))}
        </dl>
      </section>
      <JsonLd items={[faqPage(faqs)]} />
    </>
  );
}
