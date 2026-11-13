"use client";

import { useEffect, useRef, useState } from "react";
import { lookupFromBrowser, searchFromBrowser, type AppleLookupClaim, type DirectorySearch } from "@/lib/directory";
import { rememberReportUrl } from "@/lib/report-context";
import { detectPlatform } from "@/lib/platforms";
import type { MatchSource, Platform, ResolveResult } from "@/lib/types";

const platformLabel: Record<Platform, string> = {
  pocketcasts: "Pocket Casts",
  apple: "Apple Podcasts",
  spotify: "Spotify",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  website: "Website",
};

const sourceLabel: Record<MatchSource, string> = {
  "pocketcasts-catalog": "Feed address taken from the Pocket Casts catalog.",
  "itunes-lookup": "Feed address returned by Apple's lookup API.",
  "itunes-search": "Matched by show name in the Apple Podcasts directory.",
  "soundcloud-profile": "SoundCloud's feed for this account.",
  "youtube-channel": "YouTube's feed for this channel. It lists videos, not audio files.",
  "youtube-playlist": "YouTube's feed for this playlist. It lists videos, not audio files.",
  direct: "This link is already a feed.",
  "page-link": "Listed by the page itself.",
  "known-pattern": "The usual feed address for this host.",
  "common-path": "Found at a common feed address on the site.",
};

// The sources the finder knows. A chip puts the cursor in the box and shows
// what that source's link looks like, without changing what's typed.
const sources: { label: string; color: string; hint: string }[] = [
  { label: "Pocket Casts", color: "#f43e37", hint: "pca.st/… or pocketcasts.com/podcast/…" },
  { label: "Apple Podcasts", color: "#a35cf0", hint: "podcasts.apple.com/…/id123456789" },
  { label: "Spotify", color: "#1db954", hint: "open.spotify.com/show/…" },
  { label: "YouTube", color: "#ff2a2a", hint: "youtube.com/@channel" },
  { label: "SoundCloud", color: "#ff6a1a", hint: "soundcloud.com/artist" },
  { label: "Blogs & websites", color: "#3d8bfd", hint: "example.com" },
];

function isSearch(data: unknown): data is { search: DirectorySearch } {
  if (!data || typeof data !== "object") return false;
  const search = (data as { search?: unknown }).search;
  return Boolean(search && typeof search === "object" && typeof (search as DirectorySearch).title === "string");
}

function loadingMessage(value: string, matching: boolean): string {
  if (matching) return "Matching the show name in Apple Podcasts…";
  switch (detectPlatform(value)) {
    case "apple":
      return "Asking Apple's lookup API…";
    case "spotify":
      return "Reading the Spotify show name…";
    case "pocketcasts":
      return "Reading the Pocket Casts catalog…";
    case "youtube":
      return "Finding the YouTube channel…";
    case "soundcloud":
      return "Reading the SoundCloud profile…";
    case "website":
      return "Looking for feeds on that site…";
    default:
      return "Finding the feed…";
  }
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
  const [hint, setHint] = useState<string | null>(null);
  const requestId = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    rememberReportUrl(url);
  }, [url]);

  async function run(link: string) {
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
      if (detectPlatform(link) === "apple") {
        const lookedUp = await lookupFromBrowser(link);
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
        body: JSON.stringify(apple ? { url: link, apple } : { url: link }),
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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run(url);
  }

  function pickSource(sourceHint: string) {
    setHint(sourceHint);
    input.current?.focus();
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
    <div className="finder">
      <form
        onSubmit={submit}
        aria-busy={loading}
        // A native submit reloads the page. The handler always cancels it.
        action="#"
      >
        <label htmlFor="show-url" className="sr-only">
          Link to a podcast, YouTube channel, SoundCloud profile, or website
        </label>
        <div className="finder-box">
          <input
            ref={input}
            id="show-url"
            className="finder-input"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={hint ?? "Paste any link"}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "resolve-error" : undefined}
          />
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Finding" : "Find feed"}
          </button>
        </div>
      </form>

      <ul className="examples" aria-label="Supported sources">
        {sources.map((source) => (
          <li key={source.label}>
            <button
              type="button"
              className="chip"
              onClick={() => pickSource(source.hint)}
              aria-pressed={hint === source.hint}
              aria-label={`Paste a ${source.label} link`}
              style={{ "--dot": source.color } as React.CSSProperties}
            >
              <span className="chip-dot" aria-hidden="true" />
              {source.label}
            </button>
          </li>
        ))}
      </ul>

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
          <div className={result.artwork && !hideArt ? undefined : "result-wide"}>
            <p className="result-kicker">{platformLabel[result.platform]}</p>
            <h2>{result.title ?? "Feed"}</h2>
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
            {result.note && <p className="hint">{result.note}</p>}
            {result.otherFeeds && result.otherFeeds.length > 0 && (
              <details className="other-feeds">
                <summary>
                  {result.otherFeeds.length === 1
                    ? "1 more feed on this page"
                    : `${result.otherFeeds.length} more feeds on this page`}
                </summary>
                <ul>
                  {result.otherFeeds.map((feed) => (
                    <li key={feed.url}>
                      {feed.title && <span>{feed.title}</span>}
                      <a className="feed-url" href={feed.url} rel="noopener noreferrer" target="_blank">
                        {feed.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
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
