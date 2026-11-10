import type { Metadata } from "next";
import { Suspense } from "react";
import ValidatorForm from "./validator-form";

export const metadata: Metadata = {
  title: "Feed validator",
  description:
    "Check a public podcast RSS feed for missing tags, enclosures, duplicate GUIDs, artwork, and dates that do not parse.",
};

export default function ValidatorPage() {
  return (
    <>
      <h1>Check a podcast feed</h1>
      <p className="lede">
        Paste a public RSS URL. The report is the short list of problems that keep a
        show from updating: missing tags, bad enclosures, duplicate GUIDs, and dates
        that do not parse.
      </p>
      <Suspense fallback={<p className="status">Loading the form…</p>}>
        <ValidatorForm />
      </Suspense>

      <section className="section">
        <h2>What is checked</h2>
        <ul className="plain-list">
          <li>The feed is reachable, and whether it is served over HTTPS</li>
          <li>Content-Type and a real RSS 2.0 channel</li>
          <li>Title, description, language, artwork, category, and explicit rating</li>
          <li>An enclosure on every episode, and whether that audio is HTTPS</li>
          <li>GUID presence and uniqueness</li>
          <li>Publish dates that parse</li>
          <li>A Podcasting 2.0 GUID, when present</li>
        </ul>
      </section>
    </>
  );
}
