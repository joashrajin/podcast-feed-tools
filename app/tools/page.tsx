import type { Metadata } from "next";
import { Suspense } from "react";
import ToolsForm from "./tools-form";

export const metadata: Metadata = {
  title: "Feed tools",
  description: "Check a public podcast RSS feed and read the show, the files, and the gaps.",
};

export default function ToolsPage() {
  return (
    <>
      <h1>Check a podcast feed</h1>
      <p className="lede">
        Paste a public RSS URL. You get the show, the episode files, and the tags
        that most often stop a feed updating. Audio files are not downloaded.
      </p>
      <Suspense fallback={<p className="status">Loading the form…</p>}>
        <ToolsForm />
      </Suspense>
    </>
  );
}
