import { NextRequest, NextResponse } from "next/server";
import { rateLimit, retryAfterSeconds } from "./rate-limit";

export function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const candidate = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "local";
  return candidate.slice(0, 100);
}

export async function readSubmittedUrl(req: NextRequest): Promise<string | NextResponse> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 16_384) {
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

  const body = await req.json().catch(() => null);
  const url =
    body && typeof body === "object" && "url" in body ? (body as { url?: unknown }).url : undefined;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }
  if (url.trim().length > 2000) {
    return NextResponse.json({ error: "That URL is too long." }, { status: 400 });
  }
  return url.trim();
}

export function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
