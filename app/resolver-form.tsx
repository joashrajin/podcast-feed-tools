"use client";

import { useState } from "react";
import type { ResolveResult } from "@/lib/resolve";

export default function ResolverForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong.");
      else setResult(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://pca.st/…"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-red-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Sniffing…" : "Get RSS"}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-6 flex gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {result.artwork && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.artwork}
              alt=""
              className="h-20 w-20 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{result.title ?? "Podcast"}</p>
            {result.author && (
              <p className="text-sm text-zinc-500">{result.author}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <code className="block flex-1 truncate rounded bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
                {result.feedUrl}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(result.feedUrl);
                  setCopied(true);
                }}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Resolved via{" "}
              {result.source === "pocketcasts" ? "Pocket Casts" : "Apple Podcasts directory"}
              {" · "}
              <a
                href={`/validator?url=${encodeURIComponent(result.feedUrl)}`}
                className="underline"
              >
                validate this feed →
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
