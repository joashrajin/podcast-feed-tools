"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ValidationReport, CheckLevel } from "@/lib/validate";

const levelStyles: Record<CheckLevel, string> = {
  pass: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  fail: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  info: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
};

const levelIcons: Record<CheckLevel, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✕",
  info: "ℹ",
};

export default function ValidatorForm() {
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);

  async function run(feedUrl: string) {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: feedUrl }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong.");
      else setReport(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = params.get("url");
    if (initial) run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fails = report?.checks.filter((c) => c.level === "fail").length ?? 0;
  const warns = report?.checks.filter((c) => c.level === "warn").length ?? 0;

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(url);
        }}
        className="flex gap-2"
      >
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/feed.xml"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-red-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Validate"}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {report && (
        <div className="mt-6 text-left">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="font-semibold">
              {report.podcastTitle ?? report.feedUrl}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {report.episodeCount} episodes ·{" "}
              {fails === 0 && warns === 0
                ? "no issues found 🎉"
                : `${fails} error(s), ${warns} warning(s)`}
            </p>
          </div>
          <ul className="mt-4 space-y-2">
            {report.checks.map((c) => (
              <li
                key={c.id}
                className={`rounded-lg p-3 text-sm ${levelStyles[c.level]}`}
              >
                <span className="font-semibold">
                  {levelIcons[c.level]} {c.title}
                </span>
                {c.detail && <p className="mt-1 opacity-80">{c.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
