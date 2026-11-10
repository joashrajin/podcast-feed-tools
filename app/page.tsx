import { SITE_NAME } from "@/lib/site";
import ResolverForm from "./resolver-form";

const faqs = [
  {
    q: "How do I get the RSS feed from a Pocket Casts link?",
    a: "Paste any Pocket Casts share link (like pca.st/abc123) into the box above. We resolve the show behind the link and return its original RSS feed URL, which you can use in any podcast app or tool.",
  },
  {
    q: "Why doesn't Pocket Casts show the RSS feed directly?",
    a: "Like most podcast apps, Pocket Casts uses share links that point to its own catalog pages rather than the underlying feed. This tool cross-references the show against the Pocket Casts catalog and the Apple Podcasts directory to recover the original feed.",
  },
  {
    q: "Does this work for private or paid podcasts?",
    a: "No — private feeds and paid subscriber feeds aren't listed in public directories, so they can't be recovered. Only publicly listed shows resolve.",
  },
  {
    q: "I'm a podcast creator — can I check my feed for problems?",
    a: "Yes! Use the Feed Validator to check your feed for missing tags, broken enclosures, duplicate GUIDs, artwork issues, and other problems that stop your show from appearing (or updating) in Pocket Casts.",
  },
];

export default function Home() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Get the RSS feed from any Pocket Casts link
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-zinc-600 dark:text-zinc-400">
          Paste a <code>pca.st</code> share link and {SITE_NAME} will dig up
          the show&apos;s original RSS feed — free, instant, no signup.
        </p>
        <div className="mt-8">
          <ResolverForm />
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-2xl font-bold">How it works</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
          <li>
            You paste a Pocket Casts share link — from the app, tap Share on
            any show or episode.
          </li>
          <li>
            {SITE_NAME} resolves the show behind the link using the Pocket
            Casts catalog and the Apple Podcasts directory.
          </li>
          <li>
            You get the original RSS feed URL, ready to use in any app,
            aggregator, or script.
          </li>
        </ol>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-bold">Frequently asked questions</h2>
        <dl className="mt-6 space-y-6">
          {faqs.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1 text-zinc-600 dark:text-zinc-400">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </>
  );
}
