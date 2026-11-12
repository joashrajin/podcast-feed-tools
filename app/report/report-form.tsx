"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { rememberedReportUrl } from "@/lib/report-context";

export default function ReportForm({ token }: { token: string }) {
  const params = useSearchParams();
  const formToken = useRef(token);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState((params.get("page") ?? "").slice(0, 500));
  const [url, setUrl] = useState((params.get("url") ?? "").slice(0, 2000));
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (params.get("url")) return;
    const remembered = rememberedReportUrl();
    // The server render can't see this browser's stored link.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill after hydration
    if (remembered) setUrl(remembered);
  }, [params]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          page,
          url,
          email,
          website,
          token: formToken.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "The report couldn't be saved. Try again in a moment.");
        return;
      }
      setDone(typeof data.message === "string" ? data.message : "Thanks, we got it.");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <p className="notice" role="status">
        {done}
      </p>
    );
  }

  return (
    <form className="form" onSubmit={submit} action="#" aria-busy={sending}>
      <div>
        <label htmlFor="report-message">What went wrong</label>
        <textarea
          id="report-message"
          className="input"
          required
          maxLength={2000}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={6}
        />
        <p className="hint">Up to 2000 characters.</p>
      </div>

      <div className="field">
        <label htmlFor="report-page">Page</label>
        <input
          id="report-page"
          className="input"
          type="text"
          value={page}
          onChange={(event) => setPage(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label htmlFor="report-url">Show link or feed URL</label>
        <input
          id="report-url"
          className="input"
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Optional"
        />
      </div>

      <div className="field">
        <label htmlFor="report-email">Email for a reply</label>
        <input
          id="report-email"
          className="input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Optional"
          aria-describedby="report-email-hint"
        />
        <p id="report-email-hint" className="hint">
          Optional. Saved with the note so a reply is possible.
        </p>
      </div>

      <div className="sr-only" aria-hidden="true">
        <label htmlFor="report-website">Website</label>
        <input
          id="report-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button className="button" type="submit" disabled={sending}>
          {sending ? "Sending" : "Send report"}
        </button>
      </div>
    </form>
  );
}
