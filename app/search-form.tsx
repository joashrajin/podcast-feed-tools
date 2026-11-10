"use client";

import { useState } from "react";
import type { PocketCastsHit } from "@/lib/search";
import { POCKET_CASTS_SUBMIT_URL } from "@/lib/search";

export default function SearchForm() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shows, setShows] = useState<PocketCastsHit[] | null>(null);
  const [submitUrl, setSubmitUrl] = useState(POCKET_CASTS_SUBMIT_URL);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setShows(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong.");
        return;
      }
      setShows(Array.isArray(data.shows) ? data.shows : []);
      if (typeof data.submitUrl === "string") setSubmitUrl(data.submitUrl);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="form">
      <form onSubmit={submit} action="#" aria-busy={loading}>
        <label htmlFor="show-query">Show name</label>
        <div className="form-row">
          <input
            id="show-query"
            className="input"
            type="search"
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="This American Life"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "search-error" : "search-hint"}
          />
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Searching" : "Search"}
          </button>
        </div>
        <p id="search-hint" className="hint">
          Results link only to Pocket Casts. Other directories are not listed here.
        </p>
      </form>

      {loading && (
        <p className="status" role="status">
          Asking the Pocket Casts directory…
        </p>
      )}

      {error && (
        <p id="search-error" className="notice" role="alert">
          {error}
        </p>
      )}

      {shows && shows.length === 0 && (
        <p className="notice" role="status">
          Nothing on Pocket Casts matches “{query.trim()}”. If this is your show,{" "}
          <a href={submitUrl}>submit the feed to Pocket Casts</a>.
        </p>
      )}

      {shows && shows.length > 0 && (
        <ul className="shows" aria-live="polite">
          {shows.map((show) => (
            <li key={show.uuid}>
              {show.artwork && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="result-art"
                  src={show.artwork}
                  alt=""
                  width={72}
                  height={72}
                  referrerPolicy="no-referrer"
                />
              )}
              <div>
                <h2>{show.title}</h2>
                {show.author && <p>{show.author}</p>}
                <p>
                  <a href={show.url}>Open in Pocket Casts</a>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
