import type { Metadata } from "next";
import { faqPage, pageMetadata, webApplication, webSite } from "@/lib/seo";
import JsonLd from "./json-ld";
import ResolverForm from "./resolver-form";

const description =
  "Paste a Pocket Casts, Apple Podcasts, or Spotify link and get the show's RSS feed. Free, no sign-up. Then check the feed for problems.";

export const metadata: Metadata = pageMetadata({
  // The layout's title template skips a page in its own segment, and the
  // search terms matter more here than the site name.
  title: "Find a podcast's RSS feed from Pocket Casts, Apple, or Spotify",
  absolute: true,
  description,
  path: "/",
});

const faqs = [
  {
    q: "Which links work?",
    a: "Pocket Casts share links (pca.st and pocketcasts.com), Apple Podcasts show and episode links, and Spotify show and episode links on open.spotify.com.",
  },
  {
    q: "Why would a Spotify link fail?",
    a: "Spotify does not publish RSS. The show name is matched against Apple Podcasts. A Spotify-only show, or a title that does not match, cannot be resolved.",
  },
  {
    q: "Why does my browser contact Apple?",
    a: "Matching a show by name uses Apple's public search. Your browser sends that one request, so Apple sees your address rather than a shared server address it rate-limits. Nothing else is sent, and no cookies go with it.",
  },
  {
    q: "Can two shows with the same name get mixed up?",
    a: "An exact title is required. A supplied publisher that points at a different show blocks the match. When several shows still fit, the tool stops and names them.",
  },
];

export default function Home() {
  return (
    <>
      <h1>Find a podcast&apos;s RSS feed</h1>
      <p className="lede">
        Pocket Casts, Apple Podcasts, and Spotify links point at a catalog page.
        {" "}Paste one here to get the show&apos;s RSS feed, when the show is listed publicly.
      </p>
      <ResolverForm />
      <section className="section">
        <h2>How each link is resolved</h2>
        <ol className="steps">
          <li>
            <strong>Pocket Casts</strong>
            <p>
              The link carries a show id. The catalog address is kept only when the
              response is RSS. A website address falls back to an exact title match
              in Apple Podcasts, run from your browser, and a conflicting publisher
              is not accepted.
            </p>
          </li>
          <li>
            <strong>Apple Podcasts</strong>
            <p>
              The number after <code>id</code> in the link is the show. Apple&apos;s
              lookup API returns <code>feedUrl</code> directly.
            </p>
          </li>
          <li>
            <strong>Spotify</strong>
            <p>
              The show name comes from the page, or from the episode embed, and is
              matched to Apple Podcasts from your browser. One exact title is
              accepted. Several, or none, are reported.
            </p>
          </li>
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
      <JsonLd
        items={[
          webSite(),
          webApplication("Podcast RSS feed finder", "/", description),
          faqPage(faqs),
        ]}
      />
    </>
  );
}
