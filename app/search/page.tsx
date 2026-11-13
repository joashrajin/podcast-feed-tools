import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import SearchForm from "../search-form";

export const metadata: Metadata = pageMetadata({
  title: "Search Pocket Casts for a podcast",
  description:
    "Search the Pocket Casts podcast directory by show name and open any show on Pocket Casts. Free, no sign-up, nothing to install.",
  path: "/search",
});

export default function SearchPage() {
  return (
    <>
      <h1>Find a show on Pocket Casts</h1>
      <p className="lede">
        Search the Pocket Casts directory. Each result opens that show on Pocket Casts,
        and nowhere else.
      </p>
      <SearchForm />
    </>
  );
}
