import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

/**
 * Outbound HTTP.
 *
 * On Node (local dev, tests, `next start`) the socket is opened with
 * `http.request` / `https.request` and a connect-time `lookup`. That lookup
 * is the only resolution: any DNS error fails closed, any private address
 * fails closed, and the connection is pinned to the addresses just checked.
 * There is no earlier lookup that fetch() could disagree with.
 *
 * On Spacefast Functions the runtime is a Cloudflare worker. Its `fetch()`
 * is the documented outbound API and it does not honor a custom lookup
 * (https://spacefast.com/docs/functions/). Claimed spaces may call any
 * public HTTP(S) host; the worker fetch refuses private networks. This
 * file uses that fetch only when the isolate looks like a worker
 * (`Cloudflare-Workers` or `WebSocketPair`). Rebinding protection on that
 * path is the platform's, not an in-process pin. Any other runtime, where
 * we can neither pin a connection nor recognise that worker, refuses the
 * request.
 *
 * Decoding: Node's raw response is inflated only when Content-Encoding says
 * gzip, br, or deflate. Inflation uses stream.pipeline, so an error on the
 * socket or the decoder destroys both streams and comes back as a FetchError.
 * The worker fetch has already decoded the body, so that path never inflates,
 * even if the header is still present.
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

export type ResolvedAddress = { address: string; family: number };
export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>;

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

function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

/** One resolution. Errors fail closed. Private answers fail closed. */
export async function resolvePinned(
  hostname: string,
  lookup: AddressLookup,
  signal: AbortSignal
): Promise<ResolvedAddress[]> {
  const host = bareHost(hostname);
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) throw new FetchError("That address isn't public.", "blocked");
    return [{ address: host, family: host.includes(":") ? 6 : 4 }];
  }
  if (signal.aborted) throw new FetchError("The request timed out.", "timeout");

  let records: ResolvedAddress[];
  try {
    records = await new Promise((resolve, reject) => {
      const onAbort = () => reject(new FetchError("The request timed out.", "timeout"));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      lookup(host).then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (err: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(err instanceof FetchError ? err : new FetchError("Couldn't resolve that host.", "network"));
        }
      );
    });
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError("Couldn't resolve that host.", "network");
  }
  if (!records.length || records.some((record) => isBlockedIp(record.address))) {
    throw new FetchError("That address isn't public.", "blocked");
  }
  return records;
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
  maxBytes?: number;
  maxUncompressedBytes?: number;
  maxRedirects?: number;
  allowedHosts?: readonly string[];
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  allowPartial?: boolean;
  haltWhen?: (url: URL) => boolean;
  /** Test double for the HTTP exchange. Bodies are raw; Content-Encoding is honored. */
  fetchImpl?: FetchLike;
  /** Test double for DNS. Production uses node:dns and fails closed. */
  lookupImpl?: AddressLookup;
};

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

function isWorkersRuntime(): boolean {
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  if (ua === "Cloudflare-Workers") return true;
  return typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair === "function";
}

function headerRecord(headers: Headers | http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value)) out[key.toLowerCase()] = value.join(", ");
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

function isDecodeError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code ?? "";
  return code.startsWith("Z_") || code.includes("BROTLI");
}

function streamFailure(err: unknown, signal: AbortSignal): FetchError {
  const error = err instanceof Error ? err : new Error("stream failed");
  if (signal.aborted || error.name === "AbortError") {
    return new FetchError("The request timed out.", "timeout");
  }
  if (isDecodeError(error)) return new FetchError("The response could not be decoded.", "network");
  return new FetchError("The connection failed.", "network");
}

/** Inflate a raw Node response. Failures on either stream become a FetchError, and both streams are destroyed. */
export async function inflateCapped(
  source: Readable,
  encoding: string,
  max: number,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const decoder = encoding.includes("br")
    ? createBrotliDecompress()
    : encoding.includes("deflate")
      ? createInflate()
      : createGunzip();

  const chunks: Buffer[] = [];
  let total = 0;
  let hitCap = false;
  const collector = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (hitCap) {
        callback();
        return;
      }
      if (total + chunk.length > max) {
        const room = max - total;
        if (room > 0) chunks.push(chunk.subarray(0, room));
        hitCap = true;
        callback(new Error("byte cap"));
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
      callback();
    },
  });

  try {
    await pipeline(source, decoder, collector, { signal });
  } catch (err) {
    if (!source.destroyed) source.destroy();
    if (!decoder.destroyed) decoder.destroy();
    if (hitCap) return { bytes: concat(chunks), truncated: true };
    throw streamFailure(err, signal);
  }
  return { bytes: concat(chunks), truncated: false };
}

function readIncoming(
  res: http.IncomingMessage,
  max: number,
  signal: AbortSignal
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (error?: Error, value?: { bytes: Uint8Array; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value!);
    };
    const onAbort = () => {
      res.destroy();
      finish(new FetchError("The request timed out.", "timeout"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort);
    res.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (total + chunk.length > max) {
        const room = max - total;
        if (room > 0) chunks.push(chunk.subarray(0, room));
        res.destroy();
        finish(undefined, { bytes: concat(chunks), truncated: true });
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    res.on("end", () => finish(undefined, { bytes: concat(chunks), truncated: false }));
    res.on("error", () => {
      if (signal.aborted) finish(new FetchError("The request timed out.", "timeout"));
      else finish(new FetchError("The connection failed.", "network"));
    });
  });
}

type Hop = {
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array;
  truncated: boolean;
};

function startDeadline(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function callbackError(err: unknown): NodeJS.ErrnoException {
  const error = (err instanceof Error ? err : new Error("lookup failed")) as NodeJS.ErrnoException;
  if (err instanceof FetchError) {
    error.code = err.code === "blocked" ? "EBLOCKED" : err.code === "timeout" ? "ETIMEDOUT" : "EAI_FAIL";
  }
  return error;
}

function nodeHop(
  url: URL,
  options: SafeFetchOptions,
  lookup: AddressLookup,
  signal: AbortSignal,
  maxDecoded: number
): Promise<Hop> {
  const lib = url.protocol === "https:" ? https : http;
  const host = bareHost(url.hostname);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? "GET",
        servername: host,
        headers: {
          accept: options.accept ?? "*/*",
          "accept-encoding": "gzip, deflate, br",
          "user-agent": options.userAgent,
          host,
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
        lookup: (hostname, optionsOrCallback, maybeCallback) => {
          const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
          const all = typeof optionsOrCallback === "object" && optionsOrCallback?.all === true;
          if (!callback) return;
          resolvePinned(String(hostname), lookup, signal).then(
            (records) => {
              if (all) callback(null, records);
              else callback(null, records[0].address, records[0].family);
            },
            (err: unknown) => callback(callbackError(err), "", 4)
          );
        },
      },
      (res) => {
        const headers = headerRecord(res.headers);
        const redirect = [301, 302, 303, 307, 308].includes(res.statusCode ?? 0);
        if (redirect && headers.location) {
          res.destroy();
          resolve({ status: res.statusCode ?? 0, headers, bytes: new Uint8Array(), truncated: false });
          return;
        }
        const encoding = headers["content-encoding"] ?? "";
        const compressed = /gzip|\bbr\b|deflate/.test(encoding);
        const done = compressed
          ? inflateCapped(res, encoding, maxDecoded, signal)
          : readIncoming(res, maxDecoded, signal);
        done.then(
          (body) => resolve({ status: res.statusCode ?? 0, headers, ...body }),
          (err) => {
            if (!res.destroyed) res.destroy();
            reject(err instanceof FetchError ? err : new FetchError("The connection failed.", "network"));
          }
        );
      }
    );
    const onAbort = () => req.destroy(callbackError(new FetchError("The request timed out.", "timeout")));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EBLOCKED" || err.message.includes("isn't public")) {
        reject(new FetchError("That address isn't public.", "blocked"));
      } else if (code === "ETIMEDOUT" || signal.aborted || err.name === "AbortError") {
        reject(new FetchError("The request timed out.", "timeout"));
      } else {
        reject(new FetchError("The connection failed.", "network"));
      }
    });
    if (options.body && (options.method ?? "GET") !== "GET") req.write(options.body);
    req.end();
  });
}

async function stubHop(
  response: Response,
  maxDecoded: number,
  signal: AbortSignal
): Promise<Hop> {
  const headers = headerRecord(response.headers);
  const encoding = headers["content-encoding"] ?? "";
  if (!response.body) {
    return { status: response.status, headers, bytes: new Uint8Array(), truncated: false };
  }
  if (/gzip|\bbr\b|deflate/.test(encoding)) {
    const reader = response.body.getReader();
    const source = new Readable({
      async read() {
        try {
          if (signal.aborted) {
            this.destroy();
            return;
          }
          const { done, value } = await reader.read();
          if (done) this.push(null);
          else this.push(Buffer.from(value));
        } catch (err) {
          this.destroy(err instanceof Error ? err : new Error("read failed"));
        }
      },
    });
    const body = await inflateCapped(source, encoding, maxDecoded, signal);
    return { status: response.status, headers, ...body };
  }
  const body = await readPlain(response.body.getReader(), maxDecoded, signal);
  return { status: response.status, headers, ...body };
}

async function workersHop(
  url: URL,
  options: SafeFetchOptions,
  signal: AbortSignal,
  maxDecoded: number
): Promise<Hop> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      redirect: "manual",
      signal,
      headers: {
        accept: options.accept ?? "*/*",
        "user-agent": options.userAgent,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body,
    });
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      throw new FetchError("The request timed out.", "timeout");
    }
    throw new FetchError("The connection failed.", "network");
  }
  const headers = headerRecord(response.headers);
  if (!response.body) {
    return { status: response.status, headers, bytes: new Uint8Array(), truncated: false };
  }
  // The worker runtime has already decoded Content-Encoding. Do not inflate again.
  const body = await readPlain(response.body.getReader(), maxDecoded, signal);
  return { status: response.status, headers, ...body };
}

export async function safeFetch(input: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadlineHandle = startDeadline(timeoutMs);
  const deadline = deadlineHandle.signal;
  const maxDecoded = options.maxUncompressedBytes ?? options.maxBytes ?? 1_000_000;
  const allowPartial = options.allowPartial ?? false;
  const maxRedirects = options.maxRedirects ?? 5;
  const lookup = options.lookupImpl ?? defaultLookup;
  const workers = isWorkersRuntime();

  try {
    if (!options.fetchImpl && !workers && !process.versions?.node) {
      throw new FetchError(
        "This runtime cannot pin outbound connections, and it is not the Spacefast worker whose fetch refuses private networks. Feed fetching is refused.",
        "blocked"
      );
    }

    let current = assertPublicHttpUrl(input, options.allowedHosts);
    if (options.haltWhen?.(current)) {
      return { url: current.toString(), status: 200, headers: {}, body: "", bytes: new Uint8Array(), truncated: false };
    }

    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (deadline.aborted) throw new FetchError("The request timed out.", "timeout");
      const result = options.fetchImpl
        ? await (async () => {
            await resolvePinned(current.hostname, lookup, deadline);
            let response: Response;
            try {
              response = await options.fetchImpl!(current.toString(), {
                signal: deadline,
                method: options.method ?? "GET",
              });
            } catch (err) {
              if (deadline.aborted || (err instanceof Error && err.name === "AbortError")) {
                throw new FetchError("The request timed out.", "timeout");
              }
              throw err instanceof FetchError ? err : new FetchError("The connection failed.", "network");
            }
            return stubHop(response, maxDecoded, deadline);
          })()
        : workers
          ? await workersHop(current, options, deadline, maxDecoded)
          : await nodeHop(current, options, lookup, deadline, maxDecoded);

      const location = result.headers.location;
      const redirect = [301, 302, 303, 307, 308].includes(result.status);
      if (redirect && location) {
        if (hop === maxRedirects) throw new FetchError("Too many redirects.", "too-many-redirects");
        const next = assertPublicHttpUrl(new URL(location, current).toString(), options.allowedHosts);
        if (options.haltWhen?.(next)) {
          return {
            url: next.toString(),
            status: result.status,
            headers: result.headers,
            body: "",
            bytes: new Uint8Array(),
            truncated: false,
          };
        }
        current = next;
        continue;
      }

      if (result.truncated && !allowPartial) throw new FetchError("The response is too large.", "too-large");
      return {
        url: current.toString(),
        status: result.status,
        headers: result.headers,
        body: new TextDecoder().decode(result.bytes),
        bytes: result.bytes,
        truncated: result.truncated,
      };
    }
    throw new FetchError("Too many redirects.", "too-many-redirects");
  } finally {
    deadlineHandle.cancel();
  }
}
