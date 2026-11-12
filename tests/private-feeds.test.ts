import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { basicAuthorization, FetchError, safeFetch, type FetchLike, type SafeFetchOptions, type SafeResponse } from "../lib/net";
import { splitCredentials, ValidateError, validateFeed } from "../lib/validate";

const feed = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Members</title>
    <description>Bonus episodes</description>
    <itunes:block>Yes</itunes:block>
    <item><title>One</title><guid>1</guid><enclosure url="https://example.com/1.mp3" type="audio/mpeg"/></item>
  </channel>
</rss>`;

// Public DNS answer for every host, so the pinning step passes offline.
const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];

function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = (init.headers ?? {}) as Record<string, string>;
  return headers[name];
}

describe("private feeds: transport", () => {
  it("sends Basic auth to the feed's origin and drops it after a redirect elsewhere", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push([url, headerOf(init, "authorization")]);
      if (url === "https://members.example.com/feed") {
        return new Response(null, { status: 302, headers: { location: "https://members.example.com/feed.xml" } });
      }
      if (url === "https://members.example.com/feed.xml") {
        return new Response(null, { status: 302, headers: { location: "https://cdn.example.net/feed.xml" } });
      }
      return new Response(feed, { status: 200 });
    };
    const result = await safeFetch("https://members.example.com/feed", {
      userAgent: "test",
      fetchImpl,
      lookupImpl,
      basicAuth: { username: "ann", password: "pässword" },
    });
    assert.equal(result.status, 200);
    const auth = basicAuthorization({ username: "ann", password: "pässword" });
    assert.equal(auth, `Basic ${Buffer.from("ann:pässword", "utf8").toString("base64")}`);
    assert.deepEqual(seen, [
      ["https://members.example.com/feed", auth],
      ["https://members.example.com/feed.xml", auth],
      ["https://cdn.example.net/feed.xml", undefined],
    ]);
  });

  it("drops the login when a redirect goes down to plain HTTP on the same host", async () => {
    const seen: Array<string | undefined> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push(headerOf(init, "authorization"));
      if (url.startsWith("https:")) {
        return new Response(null, { status: 301, headers: { location: "http://members.example.com/feed" } });
      }
      return new Response(feed, { status: 200 });
    };
    await safeFetch("https://members.example.com/feed", {
      userAgent: "test",
      fetchImpl,
      lookupImpl,
      basicAuth: { username: "ann", password: "secret" },
    });
    assert.equal(seen.length, 2);
    assert.ok(seen[0]);
    assert.equal(seen[1], undefined);
  });

  it("refuses to send a login over plain HTTP", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(feed);
    };
    await assert.rejects(
      () =>
        safeFetch("http://members.example.com/feed", {
          userAgent: "test",
          fetchImpl,
          lookupImpl,
          basicAuth: { username: "ann", password: "secret" },
        }),
      (err: unknown) => err instanceof FetchError && err.code === "insecure-auth"
    );
    assert.equal(calls, 0);
  });
});

describe("private feeds: checker", () => {
  it("takes a login out of the URL", () => {
    assert.deepEqual(splitCredentials("https://ann%40home:p%3Ass@members.example.com/feed?key=1"), {
      url: "https://members.example.com/feed?key=1",
      auth: { username: "ann@home", password: "p:ss" },
    });
    assert.deepEqual(splitCredentials("https://members.example.com/feed"), {
      url: "https://members.example.com/feed",
      auth: undefined,
    });
    assert.deepEqual(splitCredentials("https://a:b@members.example.com/feed", { username: "ann", password: "c" }).auth, {
      username: "ann",
      password: "c",
    });
  });

  it("sends the login as a header and keeps it out of the report", async () => {
    let options: SafeFetchOptions | undefined;
    let fetched = "";
    const fetchImpl = async (input: string, opts: SafeFetchOptions): Promise<SafeResponse> => {
      fetched = input;
      options = opts;
      return { url: input, status: 200, headers: { "content-type": "application/rss+xml" }, body: feed };
    };
    const report = await validateFeed("https://ann:secret@members.example.com/feed", fetchImpl);
    assert.equal(fetched, "https://members.example.com/feed");
    assert.deepEqual(options?.basicAuth, { username: "ann", password: "secret" });
    assert.equal(report.feedUrl, "https://members.example.com/feed");
    assert.doesNotMatch(JSON.stringify(report), /secret/);
    assert.ok(report.checks.some((check) => check.id === "login" && check.level === "pass"));
    assert.ok(report.checks.some((check) => check.id === "itunes-block" && check.level === "info"));
  });

  it("asks for a login on a 401, and says when one was refused", async () => {
    const unauthorized = async (input: string): Promise<SafeResponse> => ({
      url: input,
      status: 401,
      headers: { "www-authenticate": 'Basic realm="members"' },
      body: "",
    });
    await assert.rejects(
      () => validateFeed("https://members.example.com/feed", unauthorized),
      (err: unknown) => err instanceof ValidateError && err.needsLogin && /needs a username and password/.test(err.message)
    );
    await assert.rejects(
      () => validateFeed("https://members.example.com/feed", unauthorized, { username: "ann", password: "wrong" }),
      (err: unknown) => err instanceof ValidateError && !err.needsLogin && /refused that username and password/.test(err.message)
    );
  });

  it("names a sign-in scheme it can't send", async () => {
    const bearer = async (input: string): Promise<SafeResponse> => ({
      url: input,
      status: 401,
      headers: { "www-authenticate": "Bearer" },
      body: "",
    });
    await assert.rejects(() => validateFeed("https://members.example.com/feed", bearer), /bearer sign-in/);
  });

  it("explains a refused private link", async () => {
    const gone = async (input: string): Promise<SafeResponse> => ({ url: input, status: 403, headers: {}, body: "" });
    await assert.rejects(() => validateFeed("https://members.example.com/feed?token=x", gone), /link, it may have been reset/);
  });
});
