"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { rememberReportUrl } from "@/lib/report-context";
import type { CheckLevel, ValidationReport } from "@/lib/types";

const levelLabel: Record<CheckLevel, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
  info: "Note",
};

function when(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function ToolsForm() {
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const usernameField = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const seen = useRef<string | null>(null);

  const run = useCallback(async (feedUrl: string, login?: { username: string; password: string }) => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: feedUrl, ...login }),
      });
      const data = await res.json().catch(() => ({}));
      if (current !== requestId.current) return;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong.");
        if (data.needsLogin === true) {
          setLoginOpen(true);
          requestAnimationFrame(() => usernameField.current?.focus());
        }
      } else setReport(data as ValidationReport);
    } catch {
      if (current !== requestId.current) return;
      setError("Network error. Try again.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  const initialUrl = params.get("url");
  useEffect(() => {
    rememberReportUrl(url);
  }, [url]);

  useEffect(() => {
    if (!initialUrl || seen.current === initialUrl) return;
    seen.current = initialUrl;
    setUrl(initialUrl);
    void run(initialUrl);
  }, [initialUrl, run]);

  const attention = report?.checks.filter((check) => check.level !== "pass") ?? [];
  const passes = report?.checks.filter((check) => check.level === "pass") ?? [];
  const summary = report?.summary;

  return (
    <div className="form">
      <form
        action="#"
        onSubmit={(event) => {
          event.preventDefault();
          void run(url, loginOpen && (username || password) ? { username, password } : undefined);
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
          Private feed links work too. This site doesn&apos;t store or log the address. Local network
          addresses are refused.
        </p>
        <details
          className="login"
          open={loginOpen}
          onToggle={(event) => setLoginOpen(event.currentTarget.open)}
        >
          <summary>Feed needs a username and password?</summary>
          <div className="login-fields">
            <div>
              <label htmlFor="feed-username">Username</label>
              <input
                id="feed-username"
                ref={usernameField}
                className="input"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="feed-password">Password</label>
              <input
                id="feed-password"
                className="input"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>
          <p className="hint">
            Sent once to the feed&apos;s own host over HTTPS, as podcast apps do. Not stored.
          </p>
        </details>
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

      {report && summary && (
        <div aria-live="polite">
          <div className="summary">
            <h2>{summary.title ?? report.podcastTitle ?? "Untitled feed"}</h2>
            {summary.author && <p>{summary.author}</p>}
            <p className="feed-url">{report.feedUrl}</p>
          </div>
          <dl className="facts">
            <dt>Episodes</dt>
            <dd>{summary.episodeCount}</dd>
            {summary.enclosureTypes.length > 0 && (
              <>
                <dt>Files</dt>
                <dd>{summary.enclosureTypes.map((item) => `${item.type} (${item.count})`).join(", ")}</dd>
              </>
            )}
            {summary.lastPublished && (
              <>
                <dt>Last published</dt>
                <dd>{when(summary.lastPublished)}</dd>
              </>
            )}
            {summary.cadence && (
              <>
                <dt>Cadence</dt>
                <dd>{summary.cadence}</dd>
              </>
            )}
            {summary.averageDuration && (
              <>
                <dt>Duration</dt>
                <dd>
                  {summary.averageDuration} average
                  {summary.totalDuration ? `, ${summary.totalDuration} across episodes with a duration` : ""}
                </dd>
              </>
            )}
            {summary.explicit && (
              <>
                <dt>Explicit</dt>
                <dd>{summary.explicit}</dd>
              </>
            )}
            {summary.categories.length > 0 && (
              <>
                <dt>Categories</dt>
                <dd>{summary.categories.join(" · ")}</dd>
              </>
            )}
            {summary.language && (
              <>
                <dt>Language</dt>
                <dd>{summary.language}</dd>
              </>
            )}
            <dt>Artwork</dt>
            <dd>
              {summary.artworkUrl
                ? `${summary.artworkSize ?? "Present"}, ${summary.artworkUrl}`
                : "Missing"}
            </dd>
            {summary.itunesTags.length > 0 && (
              <>
                <dt>iTunes tags</dt>
                <dd>{summary.itunesTags.join(", ")}</dd>
              </>
            )}
            {summary.podcastTags.length > 0 && (
              <>
                <dt>Podcasting 2.0</dt>
                <dd>{summary.podcastTags.join(", ")}</dd>
              </>
            )}
          </dl>

          {attention.length > 0 && (
            <ul className="checks">
              {attention.map((check) => (
                <li key={check.id} className={`check check-${check.level}`}>
                  <span className="check-level">{levelLabel[check.level]}</span>
                  <div>
                    <h3>{check.title}</h3>
                    {check.detail && <p>{check.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {passes.length > 0 && (
            <details className="pass-list">
              <summary>{passes.length} passed</summary>
              <ul className="checks">
                {passes.map((check) => (
                  <li key={check.id} className="check check-pass">
                    <span className="check-level">Pass</span>
                    <div>
                      <h3>{check.title}</h3>
                      {check.detail && <p>{check.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
