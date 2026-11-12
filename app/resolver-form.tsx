"use client";

import { useRef, useState } from "react";
import { lookupFromBrowser, searchFromBrowser, type AppleLookupClaim, type DirectorySearch } from "@/lib/directory";
import { detectPlatform } from "@/lib/platforms";
import type { MatchSource, Platform, ResolveResult } from "@/lib/types";

const platformLabel: Record<Platform, string> = {
  pocketcasts: "Pocket Casts",
  apple: "Apple Podcasts",
  spotify: "Spotify",
};

const sourceLabel: Record<MatchSource, string> = {
  "pocketcasts-catalog": "Feed address taken from the Pocket Casts catalog.",
  "itunes-lookup": "Feed address returned by Apple's lookup API.",
  "itunes-search": "Matched by show name in the Apple Podcasts directory.",
};

function isSearch(data: unknown): data is { search: DirectorySearch } {
  if (!data || typeof data !== "object") return false;
  const search = (data as { search?: unknown }).search;
  return Boolean(search && typeof search === "object" && typeof (search as DirectorySearch).title === "string");
}

function loadingMessage(value: string, matching: boolean): string {
  if (matching) return "Matching the show name in Apple Podcasts…";
  const platform = detectPlatform(value);
  if (platform === "apple") return "Asking Apple's lookup API…";
  if (platform === "spotify") return "Reading the Spotify show name, then matching Apple Podcasts…";
  if (platform === "pocketcasts") return "Reading the Pocket Casts catalog…";
  return "Resolving…";
}

export default function ResolverForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [hideArt, setHideArt] = useState(false);
  const requestId = useRef(0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const current = ++requestId.current;
    setLoading(true);
    setMatching(false);
    setError(null);
    setResult(null);
    setCopied(false);
    setCopyError(false);
    setHideArt(false);
    try {
      // Apple's lookup runs here, the same way the name search does, because
      // the host's address is often refused. The server only checks the claim.
      // A readable "no feed" stands. Any other miss falls through so the
      // server can try, including its one retry.
      let apple: AppleLookupClaim | undefined;
      if (detectPlatform(url) === "apple") {
        const lookedUp = await lookupFromBrowser(url);
        if (current !== requestId.current) return;
        if (lookedUp.ok) apple = lookedUp.claim;
        else if (lookedUp.reason === "empty") {
          setError(lookedUp.error);
          return;
        }
      }

      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(apple ? { url, apple } : { url }),
      });
      const data = await res.json().catch(() => ({}));
      if (current !== requestId.current) return;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong.");
      } else if (isSearch(data)) {
        // The server found the show but leaves the name search to this browser.
        setMatching(true);
        const outcome = await searchFromBrowser(data.search);
        if (current !== requestId.current) return;
        if (outcome.ok) setResult(outcome.result);
        else setError(outcome.error);
      } else {
        setResult(data as ResolveResult);
      }
    } catch {
      if (current !== requestId.current) return;
      setError("Network error. Try again.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }

  async function copyFeed() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.feedUrl);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <div className="form">
      <form
        onSubmit={submit}
        aria-busy={loading}
        // A native submit reloads the page. The handler always cancels it.
        action="#"
      >
        <label htmlFor="show-url">Show link</label>
        <div className="form-row">
          <input
            id="show-url"
            className="input"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://podcasts.apple.com/…"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "resolve-error" : "resolve-hint"}
          />
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Resolving" : "Resolve"}
          </button>
        </div>
        <p id="resolve-hint" className="hint">
          pca.st · pocketcasts.com · podcasts.apple.com · open.spotify.com
        </p>
      </form>

      {loading && (
        <p className="status" role="status">
          {loadingMessage(url, matching)}
        </p>
      )}

      {error && (
        <p id="resolve-error" className="notice" role="alert">
          {error}
        </p>
      )}

      {result && (
        <article className="result" aria-live="polite">
          {result.artwork && !hideArt && (
            // Artwork hosts vary by directory. next/image would require a remote allow-list we don't control.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="result-art"
              src={result.artwork}
              alt=""
              width={72}
              height={72}
              referrerPolicy="no-referrer"
              onError={() => setHideArt(true)}
            />
          )}
          <div>
            <p className="result-kicker">{platformLabel[result.platform]}</p>
            <h2>{result.title ?? "Podcast"}</h2>
            {result.author && <p className="byline">{result.author}</p>}
            <div className="feed-line">
              <p className="feed-label">RSS feed</p>
              <div className="feed-value">
                <p className="feed-url">{result.feedUrl}</p>
                <button type="button" className="text-button" onClick={copyFeed}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            {copyError && (
              <p className="hint" role="status">
                Copy failed. Select the address above.
              </p>
            )}
            <p className="result-meta">
              {sourceLabel[result.matchedBy]}{" "}
              <a href={`/tools?url=${encodeURIComponent(result.feedUrl)}`}>Check this feed</a>
            </p>
          </div>
        </article>
      )}
    </div>
  );
}
