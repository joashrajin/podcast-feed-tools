import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import ResolverForm from "../resolver-form";

export const metadata: Metadata = {
  title: "Feed locator",
  description: "Turn a Pocket Casts, Apple Podcasts, or Spotify link into the show's public RSS feed.",
};

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

export default function LocatePage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <h1>The feed behind a show link</h1>
      <p className="lede">
        Pocket Casts, Apple Podcasts, and Spotify links point at a catalog page.
        {" "}{SITE_NAME} returns the RSS feed when the show is listed publicly.
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
