import type { Metadata } from "next";
import { Suspense } from "react";
import { faqPage, pageMetadata, webApplication } from "@/lib/seo";
import JsonLd from "../json-ld";
import ToolsForm from "./tools-form";

const description =
  "Validate a podcast RSS feed, public or private. Find the missing tags, broken enclosures, and duplicate GUIDs that stop a show updating in podcast apps.";

export const metadata: Metadata = pageMetadata({
  title: "Podcast RSS feed checker and validator",
  description,
  path: "/tools",
});

const faqs = [
  {
    q: "Can I check a private feed?",
    a: "Yes. Paste a private feed link as it is. For a feed behind a username and password, open “Feed needs a username and password?” and enter them. They are sent only to the feed’s own host, over HTTPS, and are not stored.",
  },
  {
    q: "Why isn’t a new episode showing up in podcast apps?",
    a: "Common causes are an episode with no enclosure, a GUID that repeats an older episode, and a publish date that doesn’t parse. The checker flags all three. Apps also refresh feeds on their own schedule, so a fixed feed can take a while to show changes.",
  },
  {
    q: "Does the checker download my audio?",
    a: "No. It reads the feed only. Episode files are listed and their addresses checked, but not fetched.",
  },
  {
    q: "Is the feed address kept?",
    a: "No. This site doesn’t store or log the feed address, or any username and password sent with it.",
  },
];

export default function ToolsPage() {
  return (
    <>
      <h1>Check a podcast RSS feed</h1>
      <p className="lede">
        Paste an RSS URL, public or private. You get the show, the episode files, and
        the tags that most often stop a feed updating. Audio files are not downloaded.
      </p>
      <Suspense fallback={<p className="status">Loading the form…</p>}>
        <ToolsForm />
      </Suspense>
      <section className="section">
        <h2>What gets checked</h2>
        <ol className="steps">
          <li>
            <strong>Access</strong>
            <p>
              The feed loads, over HTTPS, with a content type podcast apps accept. Private
              links and feeds behind a username and password work too.
            </p>
          </li>
          <li>
            <strong>The show</strong>
            <p>
              Valid RSS 2.0 with a title, description, language, artwork, iTunes category,
              and explicit flag. A <code>podcast:guid</code> is noted when it&apos;s missing.
            </p>
          </li>
          <li>
            <strong>Every episode</strong>
            <p>
              An http(s) enclosure, ideally over HTTPS, a GUID no other episode shares, and a
              publish date that parses.
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
      <JsonLd items={[webApplication("Podcast RSS feed checker", "/tools", description), faqPage(faqs)]} />
    </>
  );
}
