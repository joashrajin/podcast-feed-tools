import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import { FetchError, safeFetch, type FetchLike } from "../lib/net";

describe("safeFetch transport", () => {
  it("does not follow a redirect onto a private address", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
    };
    await assert.rejects(
      () => safeFetch("https://example.com/start", { userAgent: "test", fetchImpl, timeoutMs: 2000 }),
      (err: unknown) => err instanceof FetchError && err.code === "blocked"
    );
    assert.equal(calls, 1);
  });

  it("follows a public redirect and returns the final URL", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith("/start")) {
        return new Response(null, { status: 302, headers: { location: "https://example.com/feed.xml" } });
      }
      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    };
    const result = await safeFetch("https://example.com/start", { userAgent: "test", fetchImpl, timeoutMs: 2000 });
    assert.equal(result.status, 200);
    assert.equal(result.url, "https://example.com/feed.xml");
    assert.match(result.body, /<channel>/);
  });

  it("leaves gzip magic bytes alone when Content-Encoding is absent", async () => {
    const raw = gzipSync(Buffer.from("   <rss><channel></channel></rss>"));
    const fetchImpl: FetchLike = async () =>
      new Response(raw, { status: 200, headers: { "content-type": "image/jpeg" } });
    const result = await safeFetch("https://example.com/art.jpg", { userAgent: "test", fetchImpl, timeoutMs: 2000 });
    assert.equal(result.bytes?.[0], 0x1f);
    assert.equal(result.bytes?.[1], 0x8b);
    assert.equal(result.body.includes("<channel>"), false);
  });

  it("inflates from Content-Encoding even when the decoded body starts with whitespace", async () => {
    const raw = gzipSync(Buffer.from("   <rss><channel></channel></rss>"));
    const fetchImpl: FetchLike = async () =>
      new Response(raw, { status: 200, headers: { "content-encoding": "gzip", "content-type": "application/xml" } });
    const result = await safeFetch("https://example.com/feed.xml", { userAgent: "test", fetchImpl, timeoutMs: 2000 });
    assert.equal(result.body.trim(), "<rss><channel></channel></rss>");
  });

  it("stops a gzip bomb while inflating", async () => {
    const bomb = gzipSync(Buffer.alloc(250_000, 7));
    const fetchImpl: FetchLike = async () =>
      new Response(bomb, { status: 200, headers: { "content-encoding": "gzip" } });
    await assert.rejects(
      () =>
        safeFetch("https://example.com/feed.xml", {
          userAgent: "test",
          fetchImpl,
          timeoutMs: 5000,
          maxBytes: 8_000,
          maxUncompressedBytes: 8_000,
        }),
      (err: unknown) => err instanceof FetchError && err.code === "too-large"
    );
  });

  it("uses one deadline for a slow response", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("hung")), 5_000);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    await assert.rejects(
      () => safeFetch("https://example.com/slow", { userAgent: "test", fetchImpl, timeoutMs: 100 }),
      (err: unknown) => err instanceof FetchError && err.code === "timeout"
    );
  });

  it("refuses an IPv6 loopback literal before calling fetch", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response("no");
    };
    await assert.rejects(
      () => safeFetch("http://[::1]/feed", { userAgent: "test", fetchImpl }),
      (err: unknown) => err instanceof FetchError && err.code === "blocked"
    );
    assert.equal(calls, 0);
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    for (const address of ["10.1.2.3", "fd00::1"]) {
      await assert.rejects(
        () =>
          safeFetch("https://rebind.example/feed", {
            userAgent: "test",
            timeoutMs: 2000,
            lookupImpl: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
          }),
        (err: unknown) => err instanceof FetchError && err.code === "blocked"
      );
    }
  });

  it("fails closed when DNS errors", async () => {
    await assert.rejects(
      () =>
        safeFetch("https://rebind.example/feed", {
          userAgent: "test",
          timeoutMs: 2000,
          lookupImpl: async () => {
            throw new Error("servfail");
          },
        }),
      (err: unknown) => err instanceof FetchError && err.code === "network"
    );
  });

  it("aborts a DNS lookup that never returns", async () => {
    const started = Date.now();
    await assert.rejects(
      () =>
        safeFetch("https://rebind.example/feed", {
          userAgent: "test",
          timeoutMs: 150,
          lookupImpl: () => new Promise(() => undefined),
        }),
      (err: unknown) => err instanceof FetchError && err.code === "timeout"
    );
    assert.ok(Date.now() - started < 1000);
  });

  it("aborts decompression that stalls", async () => {
    const started = Date.now();
    const fetchImpl: FetchLike = async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-encoding": "gzip" } });
    };
    await assert.rejects(
      () => safeFetch("https://example.com/feed", { userAgent: "test", fetchImpl, timeoutMs: 150 }),
      (err: unknown) => err instanceof FetchError && err.code === "timeout"
    );
    assert.ok(Date.now() - started < 1000);
  });
});
