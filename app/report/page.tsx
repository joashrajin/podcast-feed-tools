import type { Metadata } from "next";
import { Suspense } from "react";
import { issueReportToken } from "@/lib/report";
import { pageMetadata } from "@/lib/seo";
import ReportForm from "./report-form";

const description = "Tell us what went wrong with a show link or a feed check.";

export const metadata: Metadata = {
  ...pageMetadata({ title: "Report an issue", description, path: "/report" }),
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const token = await issueReportToken();
  return (
    <>
      <h1>Report an issue</h1>
      <p className="lede">
        Say what you tried and what happened. The note is saved for the people who run this site.
        It isn&apos;t shown on the site.
      </p>
      <Suspense fallback={<p className="status">Loading the form…</p>}>
        <ReportForm token={token} />
      </Suspense>
    </>
  );
}
