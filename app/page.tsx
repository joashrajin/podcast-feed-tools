import { SITE_NAME } from "@/lib/site";
import ResolverForm from "./resolver-form";

const faqs = [
  {
    q: "Which links work?",
    a: "Pocket Casts share links (pca.st and pocketcasts.com), Apple Podcasts show and episode links, and Spotify show and episode links on open.spotify.com. An Apple episode link still carries the show id. A Spotify episode link is read back to the show.",
  },
  {
    q: "Why would a Spotify link fail?",
    a: "Spotify does not publish RSS. The show name is matched against Apple Podcasts. A Spotify-only show, or a show whose title differs there, cannot be resolved. Paste the Apple Podcasts link if you have it.",
  },
  {
    q: "Can two shows with the same name get mixed up?",
    a: "An exact title is required. If several shows share it, the publisher has to match as well. When it is still ambiguous, the tool stops and names the candidates instead of guessing.",
  },
  {
    q: "What about private or paid feeds?",
    a: "They are refused. Pocket Casts marks private shows in its catalog, and unlisted feeds are not in Apple's directory.",
  },
  {
    q: "Can I check a feed I already have?",
    a: "Yes. The validator reads a public RSS URL and reports missing tags, enclosures, GUID problems, and dates that do not parse.",
  },
];

export default function Home() {
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
              The link carries a show id. The catalog&apos;s address is kept only when
              the response is actually RSS. Some shows store a website there instead.
              Those fall back to an exact title match in Apple Podcasts.
            </p>
          </li>
          <li>
            <strong>Apple Podcasts</strong>
            <p>
              The number after <code>id</code> in the link is the show. Apple&apos;s
              lookup API returns <code>feedUrl</code> directly. No title guessing.
            </p>
          </li>
          <li>
            <strong>Spotify</strong>
            <p>
              Spotify has no feed to give. The show name comes from the page, or from
              the episode embed, and is matched to Apple Podcasts. One exact title is
              accepted. Several, or none, are reported. Exclusives stop here.
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
