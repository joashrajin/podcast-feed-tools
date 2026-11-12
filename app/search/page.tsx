import type { Metadata } from "next";
import SearchForm from "../search-form";

export const metadata: Metadata = {
  title: "Search Pocket Casts",
  description: "Search the Pocket Casts directory and open a show on Pocket Casts.",
};

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
