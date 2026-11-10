import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

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

function bareHost(hostname: string): string {
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

  // Node's URL.hostname keeps the brackets on IPv6 literals, and isIP() rejects that form.
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

async function assertResolvedPublic(hostname: string): Promise<void> {
  if (isIP(hostname) !== 0) return;
  let records: { address: string }[];
  try {
    records = await dnsLookupAsync(hostname, { all: true, verbatim: true });
  } catch {
    throw new FetchError("Couldn't resolve that host.", "network");
  }
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    throw new FetchError("That address isn't public.", "blocked");
  }
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) {
      callback(err, "", 4);
      return;
    }
    const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
    if (addresses.some((item) => isBlockedIp(item))) {
      callback(Object.assign(new Error("blocked address"), { code: "ECONNREFUSED" }), "", 4);
      return;
    }
    if (Array.isArray(address)) callback(null, address);
    else callback(null, address, family);
  });
};

export type SafeResponse = {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

export type SafeFetchOptions = {
  userAgent: string;
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxUncompressedBytes?: number;
  maxRedirects?: number;
  allowedHosts?: readonly string[];
  /** Stop before requesting a URL that already has what the caller needs. */
  haltWhen?: (url: URL) => boolean;
};

function headerValue(headers: http.IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function decodeBody(buffer: Buffer, encoding: string | undefined): Buffer {
  const enc = (encoding ?? "").toLowerCase();
  try {
    if (enc.includes("br")) return brotliDecompressSync(buffer);
    if (enc.includes("gzip") || enc.includes("x-gzip")) return gunzipSync(buffer);
    if (enc.includes("deflate")) return inflateSync(buffer);
  } catch {
    throw new FetchError("The response could not be decoded.", "network");
  }
  return buffer;
}

function requestOnce(url: URL, options: SafeFetchOptions): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const lib = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: { status: number; headers: http.IncomingHttpHeaders; body: Buffer }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: bareHost(url.hostname),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          accept: options.accept ?? "*/*",
          "accept-encoding": "gzip, deflate, br",
          "user-agent": options.userAgent,
        },
        lookup: guardedLookup,
        servername: bareHost(url.hostname),
      },
      (res) => {
        const declared = Number(headerValue(res.headers, "content-length") ?? 0);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          finish(new FetchError("The response is too large.", "too-large"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            finish(new FetchError("The response is too large.", "too-large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish(undefined, {
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", () => finish(new FetchError("The connection failed.", "network")));
      }
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(new FetchError("The request timed out.", "timeout"));
    }, timeoutMs);

    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.message === "blocked address") {
        finish(new FetchError("That address isn't public.", "blocked"));
        return;
      }
      finish(new FetchError("The connection failed.", "network"));
    });
    req.end();
  });
}

export async function safeFetch(input: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = assertPublicHttpUrl(input, options.allowedHosts);
  if (options.haltWhen?.(current)) {
    return { url: current.toString(), status: 200, headers: {}, body: "" };
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertResolvedPublic(current.hostname);
    const response = await requestOnce(current, options);
    const location = headerValue(response.headers, "location");
    const redirect = [301, 302, 303, 307, 308].includes(response.status);
    if (redirect && location) {
      if (hop === maxRedirects) {
        throw new FetchError("Too many redirects.", "too-many-redirects");
      }
      const next = assertPublicHttpUrl(new URL(location, current).toString(), options.allowedHosts);
      if (options.haltWhen?.(next)) {
        return { url: next.toString(), status: response.status, headers: response.headers, body: "" };
      }
      current = next;
      continue;
    }

    const uncompressedLimit = options.maxUncompressedBytes ?? options.maxBytes ?? 1_000_000;
    const decoded = decodeBody(response.body, headerValue(response.headers, "content-encoding"));
    if (decoded.length > uncompressedLimit) {
      throw new FetchError("The response is too large.", "too-large");
    }
    return {
      url: current.toString(),
      status: response.status,
      headers: response.headers,
      body: decoded.toString("utf8"),
    };
  }

  throw new FetchError("Too many redirects.", "too-many-redirects");
}
