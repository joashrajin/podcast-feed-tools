import { NextResponse } from "next/server";
import { rateLimit, retryAfterSeconds } from "./rate-limit";

type HeaderBag = { get(name: string): string | null };

/**
 * Spacefast Functions run on Cloudflare. That network sets CF-Connecting-IP
 * and does not let the caller choose it. The first X-Forwarded-For hop is
 * whatever the client wrote, so it is not used. Local `next dev` has neither
 * header and shares one bucket.
 */
export function clientKey(req: { headers: HeaderBag }): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf && isPlausibleIp(cf)) return cf.slice(0, 100);
  return "local";
}

function isPlausibleIp(value: string): boolean {
  return /^[0-9a-f:.]+$/i.test(value) && value.length <= 64;
}

export async function readLimitedBytes(
  stream: ReadableStream<Uint8Array> | null,
  max: number
): Promise<Uint8Array | "too-large"> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return "too-large";
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return "too-large";
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readJsonObject(
  req: { headers: HeaderBag; body: ReadableStream<Uint8Array> | null }
): Promise<Record<string, unknown> | NextResponse> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 16_384) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  const key = clientKey(req);
  if (!rateLimit(key)) {
    return NextResponse.json(
      { error: "Too many requests. Wait a minute and try again." },
      {
        status: 429,
        headers: { "retry-after": String(retryAfterSeconds(key)), "cache-control": "no-store" },
      }
    );
  }

  const bytes = await readLimitedBytes(req.body, 16_384);
  if (bytes === "too-large") {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }
  if (bytes.byteLength === 0) return {};
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function urlField(body: Record<string, unknown>): string | NextResponse {
  const url = body.url;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }
  if (url.trim().length > 2000) {
    return NextResponse.json({ error: "That URL is too long." }, { status: 400 });
  }
  return url.trim();
}

export async function readSubmittedUrl(
  req: { headers: HeaderBag; body: ReadableStream<Uint8Array> | null }
): Promise<string | NextResponse> {
  const body = await readJsonObject(req);
  if (body instanceof NextResponse) return body;
  return urlField(body);
}

export type SubmittedResolve = { url: string; apple?: unknown };

/**
 * A show link, plus the optional Apple lookup the browser already ran.
 * `apple` is absent when the browser didn't get a claim. The caller checks
 * a claim; it is not trusted as a feed on its own.
 */
export async function readSubmittedResolve(
  req: { headers: HeaderBag; body: ReadableStream<Uint8Array> | null }
): Promise<SubmittedResolve | NextResponse> {
  const body = await readJsonObject(req);
  if (body instanceof NextResponse) return body;
  const url = urlField(body);
  if (typeof url !== "string") return url;
  if (!("apple" in body) || body.apple == null) return { url };
  return { url, apple: body.apple };
}

export type SubmittedFeed = { url: string; username?: string; password?: string };

/** A feed URL plus an optional HTTP Basic login for a password-protected feed. */
export async function readSubmittedFeed(
  req: { headers: HeaderBag; body: ReadableStream<Uint8Array> | null }
): Promise<SubmittedFeed | NextResponse> {
  const body = await readJsonObject(req);
  if (body instanceof NextResponse) return body;
  const url = urlField(body);
  if (typeof url !== "string") return url;
  const feed: SubmittedFeed = { url };
  for (const key of ["username", "password"] as const) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || value.length > 500) {
      return NextResponse.json({ error: `That ${key} isn't usable.` }, { status: 400 });
    }
    feed[key] = value;
  }
  if (feed.username?.includes(":")) {
    return NextResponse.json({ error: "A username for HTTP sign-in can't contain a colon." }, { status: 400 });
  }
  return feed;
}

export function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
