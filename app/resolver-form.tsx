"use client";

import { useRef, useState } from "react";
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

function loadingMessage(value: string): string {
  const platform = detectPlatform(value);
  if (platform === "apple") return "Asking Apple's lookup API…";
  if (platform === "spotify") return "Reading the Spotify show name, then matching Apple Podcasts…";
  if (platform === "pocketcasts") return "Reading the Pocket Casts catalog…";
  return "Resolving…";
}

export default function ResolverForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
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
    setError(null);
    setResult(null);
    setCopied(false);
    setCopyError(false);
    setHideArt(false);
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (current !== requestId.current) return;
      if (!res.ok) setError(typeof data.error === "string" ? data.error : "Something went wrong.");
      else setResult(data as ResolveResult);
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
          {loadingMessage(url)}
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
