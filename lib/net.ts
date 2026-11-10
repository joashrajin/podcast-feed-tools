import { BlockList, isIP } from "node:net";

/**
 * Outbound HTTP for both Node and Spacefast Functions.
 *
 * Spacefast Functions are an OpenNext worker. The documented outbound API is
 * the standard fetch(), which reaches public HTTP(S) hosts on a claimed space
 * (https://spacefast.com/docs/functions/). That runtime does not implement
 * node:dns lookup, and node:http's custom lookup option is not honored, so
 * this module does not use either. Private literal addresses are refused here
 * before fetch. A redirect target is checked the same way. Connect-time
 * blocking of public names that rebind to a private address is the worker
 * fetch itself: Spacefast describes it as reaching public hosts, which is
 * Cloudflare's fetch, and that fetch refuses private networks. A live
 * Functions isolate was not booted in this environment; tests cover the
 * fetch() path with a stub and one public request.
 */

export class FetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid-url"
      | "blocked"
      | "timeout"
      | "too-large"
      | "network"
      | "too-many-redirects"
  ) {
    super(message);
    this.name = "FetchError";
  }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("64:ff9b::", 96, "ipv6");

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

function ipv4FromHextets(high: string, low: string): string | undefined {
  const hi = Number.parseInt(high, 16);
  const lo = Number.parseInt(low, 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi < 0 || lo < 0 || hi > 0xffff || lo > 0xffff) {
    return undefined;
  }
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export function bareHost(hostname: string): string {
  let host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host;
}

export function isBlockedIp(ip: string): boolean {
  const value = bareHost(ip);

  const mappedDotted = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return blocked.check(mappedDotted[1], "ipv4");

  const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const v4 = ipv4FromHextets(mappedHex[1], mappedHex[2]);
    return v4 ? blocked.check(v4, "ipv4") : true;
  }

  if (value.startsWith("2002:")) {
    const parts = value.split(":");
    if (parts[1] && parts[2]) {
      const v4 = ipv4FromHextets(parts[1], parts[2]);
      if (v4 && blocked.check(v4, "ipv4")) return true;
    }
  }

  const kind = isIP(value);
  if (kind === 4) return blocked.check(value, "ipv4");
  if (kind === 6) return blocked.check(value, "ipv6");
  return false;
}

function isNonCanonicalIp(host: string): boolean {
  if (/^\d+$/.test(host)) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^(\d+\.){1,2}\d+$/.test(host)) return true;
  if (/^(\d+\.){3}\d+$/.test(host)) {
    const parts = host.split(".");
    if (parts.some((part) => part.length > 1 && part.startsWith("0"))) return true;
    if (parts.some((part) => Number(part) > 255)) return true;
  }
  return false;
}

export function assertPublicHttpUrl(raw: string, allowedHosts?: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchError("That doesn't look like a valid URL.", "invalid-url");
  }
  if (url.username || url.password) {
    throw new FetchError("URLs with a username or password aren't accepted.", "invalid-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("Only http and https URLs are accepted.", "invalid-url");
  }

  const host = bareHost(url.hostname);
  if (!host || BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new FetchError("That address isn't public.", "blocked");
  }
  if (isNonCanonicalIp(host) || (isIP(host) !== 0 && isBlockedIp(host))) {
    throw new FetchError("That address isn't public.", "blocked");
  }
  if (allowedHosts && !allowedHosts.includes(host)) {
    throw new FetchError("That host isn't allowed for this lookup.", "blocked");
  }
  return url;
}

export function asHttpsUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function assertResolvedPublic(hostname: string, deadline: AbortSignal): Promise<void> {
  const host = bareHost(hostname);
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) throw new FetchError("That address isn't public.", "blocked");
    return;
  }
  if (deadline.aborted) throw new FetchError("The request timed out.", "timeout");

  let lookup: typeof import("node:dns/promises").lookup;
  try {
    lookup = (await import("node:dns/promises")).lookup;
  } catch {
    return;
  }

  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
      throw new FetchError("That address isn't public.", "blocked");
    }
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (deadline.aborted) throw new FetchError("The request timed out.", "timeout");
    const code = (err as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
      throw new FetchError("Couldn't resolve that host.", "network");
    }
    // Workers-style runtimes expose a stub that cannot resolve. fetch() still
    // refuses private destinations, so a missing DNS implementation is not a
    // failed lookup of a real name.
  }
}

export type SafeResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes?: Uint8Array;
  truncated?: boolean;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SafeFetchOptions = {
  userAgent: string;
  accept?: string;
  timeoutMs?: number;
  /** Decoded body cap. Past this, the read stops. */
  maxBytes?: number;
  maxUncompressedBytes?: number;
  maxRedirects?: number;
  allowedHosts?: readonly string[];
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** Keep a prefix instead of failing when the body exceeds maxBytes. */
  allowPartial?: boolean;
  haltWhen?: (url: URL) => boolean;
  fetchImpl?: FetchLike;
};

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readPlain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  max: number,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new FetchError("The request timed out.", "timeout");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > max) {
        const room = max - total;
        if (room > 0) chunks.push(value.subarray(0, room));
        await reader.cancel();
        return { bytes: concat(chunks), truncated: true };
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (signal.aborted) throw new FetchError("The request timed out.", "timeout");
    throw new FetchError("The connection failed.", "network");
  }
  return { bytes: concat(chunks), truncated: false };
}

async function inflateCapped(
  input: Uint8Array,
  encoding: string,
  max: number
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const zlib = await import("node:zlib");
  const stream = encoding.includes("br")
    ? zlib.createBrotliDecompress()
    : encoding.includes("deflate")
      ? zlib.createInflate()
      : zlib.createGunzip();

  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (error?: Error, value?: { bytes: Uint8Array; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value!);
    };
    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (total >= max) {
        stream.destroy();
        finish(undefined, { bytes: concat(chunks), truncated: true });
        return;
      }
      if (total + chunk.length > max) {
        chunks.push(chunk.subarray(0, max - total));
        total = max;
        stream.destroy();
        finish(undefined, { bytes: concat(chunks), truncated: true });
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    stream.on("end", () => finish(undefined, { bytes: concat(chunks), truncated: false }));
    stream.on("error", () => {
      if (!settled) finish(new FetchError("The response could not be decoded.", "network"));
    });
    stream.end(Buffer.from(input));
  });
}

function prepend(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  first: Uint8Array
): ReadableStreamDefaultReader<Uint8Array> {
  let pending: Uint8Array | null = first;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pending) {
        controller.enqueue(pending);
        pending = null;
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else if (next.value) controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return stream.getReader();
}

async function readDecoded(
  response: Response,
  maxDecoded: number,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), truncated: false };
  const encoding = (response.headers.get("content-encoding") ?? "").toLowerCase();
  const rawPreview = await reader.read();
  if (rawPreview.done || !rawPreview.value) {
    return { bytes: rawPreview.value ?? new Uint8Array(), truncated: false };
  }
  const first = rawPreview.value;
  const compressed =
    (first.length >= 2 && first[0] === 0x1f && first[1] === 0x8b) ||
    (/br|deflate/.test(encoding) && first[0] !== 0x7b && first[0] !== 0x3c && first[0] !== 0xef);
  const prefixReader = prepend(reader, first);
  if (!compressed) return readPlain(prefixReader, maxDecoded, signal);

  // Cap the compressed input too, then inflate with an output cap so a small
  // bomb cannot expand without bound.
  const wireCap = Math.min(Math.max(maxDecoded, 65_536), 8_000_000);
  const raw = await readPlain(prefixReader, wireCap, signal);
  try {
    const inflated = await inflateCapped(raw.bytes, encoding, maxDecoded);
    return { bytes: inflated.bytes, truncated: raw.truncated || inflated.truncated };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError("The response could not be decoded.", "network");
  }
}

export async function safeFetch(input: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const maxDecoded = options.maxUncompressedBytes ?? options.maxBytes ?? 1_000_000;
  const allowPartial = options.allowPartial ?? false;
  const maxRedirects = options.maxRedirects ?? 5;
  const fetchImpl = options.fetchImpl ?? fetch;

  let current = assertPublicHttpUrl(input, options.allowedHosts);
  if (options.haltWhen?.(current)) {
    return { url: current.toString(), status: 200, headers: {}, body: "", bytes: new Uint8Array(), truncated: false };
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (deadline.aborted) throw new FetchError("The request timed out.", "timeout");
    await assertResolvedPublic(current.hostname, deadline);

    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: options.method ?? "GET",
        redirect: "manual",
        signal: deadline,
        headers: {
          accept: options.accept ?? "*/*",
          "user-agent": options.userAgent,
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
        body: options.body,
      });
    } catch (err) {
      if (deadline.aborted || (err instanceof Error && err.name === "AbortError")) {
        throw new FetchError("The request timed out.", "timeout");
      }
      throw new FetchError("The connection failed.", "network");
    }

    const headers = headerRecord(response.headers);
    const location = headers.location;
    const redirect = [301, 302, 303, 307, 308].includes(response.status);
    if (redirect && location) {
      await response.body?.cancel();
      if (hop === maxRedirects) throw new FetchError("Too many redirects.", "too-many-redirects");
      const next = assertPublicHttpUrl(new URL(location, current).toString(), options.allowedHosts);
      if (options.haltWhen?.(next)) {
        return { url: next.toString(), status: response.status, headers, body: "", bytes: new Uint8Array(), truncated: false };
      }
      current = next;
      continue;
    }

    const decoded = await readDecoded(response, maxDecoded, deadline);
    if (decoded.truncated && !allowPartial) {
      throw new FetchError("The response is too large.", "too-large");
    }
    return {
      url: current.toString(),
      status: response.status,
      headers,
      body: new TextDecoder().decode(decoded.bytes),
      bytes: decoded.bytes,
      truncated: decoded.truncated,
    };
  }

  throw new FetchError("Too many redirects.", "too-many-redirects");
}
