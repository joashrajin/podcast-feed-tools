// Shared by the link resolvers in resolve.ts and discover.ts: the fetch they
// use, the error a visitor sees, and the log line for an upstream that
// answered badly. Server only.

import { assertPublicHttpUrl, FetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from "./net";

export class ResolveError extends Error {}

export type ResolverDeps = {
  fetch?: (input: string, options: SafeFetchOptions) => Promise<SafeResponse>;
  /** Clock for the shared Apple deadline. Tests advance it instead of waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function fetchWith(deps: ResolverDeps) {
  return deps.fetch ?? safeFetch;
}

export function publicFeedUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return assertPublicHttpUrl(raw).toString();
  } catch {
    return undefined;
  }
}

/**
 * One line in the runtime log for each upstream that answered badly, so a
 * failure on the host can be told apart: blocked, rate-limited, or changed.
 * Nothing from the visitor is logged beyond the show URL or title they sent.
 */
export function logUpstream(stage: string, url: string, detail: Record<string, unknown>): void {
  console.warn(`[upstream] ${stage} ${JSON.stringify({ url, ...detail })}`);
}

export function responseDetail(response: SafeResponse): Record<string, unknown> {
  const headers = Object.fromEntries(
    Object.entries(response.headers).filter(([name]) => name !== "set-cookie")
  );
  return {
    status: response.status,
    finalUrl: response.url,
    headers,
    body: response.body.replace(/\s+/g, " ").slice(0, 400),
    truncated: response.truncated ?? false,
  };
}

export function upstreamError(err: unknown, fallback: string, stage = "fetch", url = ""): ResolveError {
  if (err instanceof ResolveError) return err;
  logUpstream(stage, url, {
    problem: "fetch-error",
    code: err instanceof FetchError ? err.code : undefined,
    message: err instanceof Error ? err.message : String(err),
  });
  return new ResolveError(fallback);
}
