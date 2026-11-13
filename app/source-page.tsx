import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata, webApplication } from "@/lib/seo";
import { SOURCE_PAGES, sourcePage } from "@/lib/source-pages";
import JsonLd from "./json-ld";
import ResolverForm from "./resolver-form";

export function sourceMetadata(slug: string): Metadata {
  const page = sourcePage(slug);
  return pageMetadata({ title: page.title, absolute: true, description: page.description, path: `/${slug}` });
}

/** A landing page for one kind of link: the finder, then what to expect from it. */
export default function SourcePage({ slug }: { slug: string }) {
  const page = sourcePage(slug);
  const others = SOURCE_PAGES.filter((item) => item.slug !== slug);
  return (
    <>
      <h1>{page.heading}</h1>
      <p className="lede">{page.lede}</p>
      <ResolverForm placeholder={page.hint} />

      <section className="section">
        <h2>Links that work</h2>
        <ul className="prompts">
          {page.links.map((link) => (
            <li key={link}>{link}</li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>How the feed is found</h2>
        <ol className="steps">
          {page.steps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section">
        <h2>Good to know</h2>
        <dl className="faq">
          {page.notes.map((note) => (
            <div key={note.q}>
              <dt>{note.q}</dt>
              <dd>{note.a}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          Got a feed? <Link href="/tools">Check it for problems</Link>. More answers are in the{" "}
          <Link href="/faq">FAQ</Link>.
        </p>
      </section>

      <section className="section">
        <h2>Other feeds</h2>
        <ul className="source-links">
          {others.map((item) => (
            <li key={item.slug}>
              <Link href={`/${item.slug}`}>{item.name}</Link>
            </li>
          ))}
        </ul>
      </section>

      <JsonLd items={[webApplication(page.heading, `/${slug}`, page.description)]} />
    </>
  );
}
