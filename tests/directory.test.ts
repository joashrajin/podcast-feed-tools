import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { itunesSearchUrl, matchSearchResults, searchFromBrowser, type DirectorySearch } from "../lib/directory";
import { asHttpUrl } from "../lib/url";

const daily = {
  collectionName: "The Daily",
  artistName: "The New York Times",
  feedUrl: "https://feeds.simplecast.com/Sl5CSM3S",
  collectionId: 1200361736,
};

const search: DirectorySearch = {
  title: "The Daily",
  author: "The New York Times",
  platform: "pocketcasts",
  artwork: "https://static.pocketcasts.com/discover/images/webp/480/x.webp",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("matchSearchResults", () => {
  it("keeps the platform and falls back to the source artwork", () => {
    const outcome = matchSearchResults({ results: [daily] }, search, asHttpUrl);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.feedUrl, daily.feedUrl);
    assert.equal(outcome.result.platform, "pocketcasts");
    assert.equal(outcome.result.matchedBy, "itunes-search");
    assert.equal(outcome.result.artwork, search.artwork);
  });

  it("explains a Spotify show that Apple doesn't list", () => {
    const outcome = matchSearchResults({ results: [] }, { title: "Only Here", platform: "spotify" }, asHttpUrl);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.error, /Spotify exclusive/);
  });

  it("refuses a feed address that isn't http(s) or carries credentials", () => {
    for (const feedUrl of ["ftp://example.com/feed.xml", "https://user:pass@example.com/feed.xml"]) {
      const outcome = matchSearchResults({ results: [{ ...daily, feedUrl }] }, search, asHttpUrl);
      assert.equal(outcome.ok, false);
    }
  });

  it("treats a malformed response as no results", () => {
    const outcome = matchSearchResults("nope", search, asHttpUrl);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.error, /No public feed/);
  });
});

describe("searchFromBrowser", () => {
  it("asks Apple without cookies or a referrer and matches the result", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return json({ results: [daily] });
    }) as typeof fetch;
    const outcome = await searchFromBrowser(search, fetchImpl);
    assert.equal(outcome.ok, true);
    assert.equal(seen?.url, itunesSearchUrl("The Daily"));
    assert.equal(seen?.init?.credentials, "omit");
    assert.equal(seen?.init?.referrerPolicy, "no-referrer");
  });

  it("says when Apple is limiting the visitor's connection", async () => {
    const outcome = await searchFromBrowser(search, (async () => new Response("Rate limit", { status: 429 })) as typeof fetch);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.error, /limiting requests/);
  });

  it("says when Apple can't be reached or answers with something unreadable", async () => {
    const blocked = await searchFromBrowser(search, (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /Couldn't reach Apple/);

    const html = await searchFromBrowser(search, (async () => new Response("<html>", { status: 200 })) as typeof fetch);
    assert.equal(html.ok, false);
    if (!html.ok) assert.match(html.error, /couldn't be read/);
  });
});
