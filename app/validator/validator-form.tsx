"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CheckLevel, ValidationReport } from "@/lib/types";

const levelLabel: Record<CheckLevel, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
  info: "Note",
};

function tally(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function ValidatorForm() {
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const requestId = useRef(0);
  const seen = useRef<string | null>(null);

  const run = useCallback(async (feedUrl: string) => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: feedUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (current !== requestId.current) return;
      if (!res.ok) setError(typeof data.error === "string" ? data.error : "Something went wrong.");
      else setReport(data as ValidationReport);
    } catch {
      if (current !== requestId.current) return;
      setError("Network error. Try again.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  const initialUrl = params.get("url");
  useEffect(() => {
    if (!initialUrl || seen.current === initialUrl) return;
    seen.current = initialUrl;
    setUrl(initialUrl);
    void run(initialUrl);
  }, [initialUrl, run]);

  const fails = report?.checks.filter((check) => check.level === "fail").length ?? 0;
  const warns = report?.checks.filter((check) => check.level === "warn").length ?? 0;
  const summary =
    fails === 0 && warns === 0
      ? "No failures or warnings."
      : `${tally(fails, "failure", "failures")}, ${tally(warns, "warning", "warnings")}.`;

  return (
    <div className="form">
      <form
        action="#"
        onSubmit={(event) => {
          event.preventDefault();
          void run(url);
        }}
        aria-busy={loading}
      >
        <label htmlFor="feed-url">Feed URL</label>
        <div className="form-row">
          <input
            id="feed-url"
            className="input"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/feed.xml"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "validate-error" : "validate-hint"}
          />
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Checking" : "Check"}
          </button>
        </div>
        <p id="validate-hint" className="hint">
          Public http(s) feeds only. Private addresses are refused.
        </p>
      </form>

      {loading && (
        <p className="status" role="status">
          Fetching the feed…
        </p>
      )}

      {error && (
        <p id="validate-error" className="notice" role="alert">
          {error}
        </p>
      )}

      {report && (
        <div aria-live="polite">
          <div className="summary">
            <h2>{report.podcastTitle ?? "Untitled feed"}</h2>
            <p>
              {tally(report.episodeCount, "episode", "episodes")}. {summary}
            </p>
            <p className="feed-url">{report.feedUrl}</p>
          </div>
          <ul className="checks">
            {report.checks.map((check) => (
              <li key={check.id} className={`check check-${check.level}`}>
                <span className="check-level">{levelLabel[check.level]}</span>
                <div>
                  <h3>{check.title}</h3>
                  {check.detail && <p>{check.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
