import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import SearchForm from "./search-form";

export const metadata: Metadata = {
  // The layout's title template skips a page in its own segment, so this
  // page names the site itself.
  title: { absolute: `Search Pocket Casts · ${SITE_NAME}` },
  description: "Search the Pocket Casts directory and open a show on Pocket Casts.",
};

export default function Home() {
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
