import type { Metadata } from "next";
import { Suspense } from "react";
import ValidatorForm from "./validator-form";

export const metadata: Metadata = {
  title: "Podcast Feed Validator — debug your RSS feed",
  description:
    "Free podcast RSS feed validator. Find missing iTunes tags, broken enclosures, duplicate GUIDs, artwork problems, and other issues that stop your show from appearing or updating in Pocket Casts.",
};

export default function ValidatorPage() {
  return (
    <>
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Podcast Feed Validator
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-zinc-600 dark:text-zinc-400">
          Paste your RSS feed URL and we&apos;ll check it for the issues
          that most often break shows in Pocket Casts and other apps.
        </p>
        <div className="mt-8">
          <Suspense>
            <ValidatorForm />
          </Suspense>
        </div>
      </section>

      <section className="mt-20 text-sm text-zinc-600 dark:text-zinc-400">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          What we check
        </h2>
        <ul className="mt-4 list-disc space-y-1 pl-5">
          <li>Feed reachability, HTTPS, and Content-Type headers</li>
          <li>Valid RSS 2.0 structure</li>
          <li>Required channel tags: title, description, language, artwork, category, explicit rating</li>
          <li>Per-episode audio enclosures and HTTPS delivery</li>
          <li>GUID presence and uniqueness (the #1 cause of duplicate episodes)</li>
          <li>Publish date formatting</li>
          <li>Podcasting 2.0 namespace adoption</li>
        </ul>
      </section>
    </>
  );
}
