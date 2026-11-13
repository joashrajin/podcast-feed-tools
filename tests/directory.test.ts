import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itunesLookupUrl,
  itunesSearchUrl,
  lookupFromBrowser,
  matchSearchResults,
  searchFromBrowser,
  type DirectorySearch,
} from "../lib/directory";
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
    if (!html.ok) assert.match(html.error, /Try again in a moment/);
  });
});

const appleShow = "https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000800977857";

describe("lookupFromBrowser", () => {
  it("asks Apple without cookies or a referrer and extracts the hit", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return json({
        results: [{
          ...daily,
          artworkUrl600: "https://is1-ssl.mzstatic.com/image/art.jpg",
        }],
      });
    }) as typeof fetch;
    const outcome = await lookupFromBrowser(appleShow, fetchImpl);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(seen?.url, itunesLookupUrl("1200361736"));
    assert.equal(seen?.init?.credentials, "omit");
    assert.equal(seen?.init?.referrerPolicy, "no-referrer");
    assert.equal(outcome.claim.feedUrl, daily.feedUrl);
    assert.equal(outcome.claim.title, "The Daily");
    assert.equal(outcome.claim.author, "The New York Times");
    assert.equal(outcome.claim.artwork, "https://is1-ssl.mzstatic.com/image/art.jpg");
    assert.equal(outcome.claim.itunesId, 1200361736);
  });

  it("parses a lookup body that starts with blank lines", async () => {
    const body = `\n\n${JSON.stringify({ results: [daily] })}`;
    const outcome = await lookupFromBrowser(
      appleShow,
      (async () => new Response(body, { status: 200, headers: { "content-type": "text/javascript" } })) as typeof fetch
    );
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.claim.feedUrl, daily.feedUrl);
  });

  it("reports a readable lookup that lists no feed", async () => {
    const outcome = await lookupFromBrowser(
      appleShow,
      (async () => json({ results: [] })) as typeof fetch
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "empty");
      assert.match(outcome.error, /didn't return an RSS feed/);
    }
  });

  it("reports a failed lookup when Apple can't be read, so the server can try", async () => {
    const blocked = await lookupFromBrowser(appleShow, (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, "failed");

    const html = await lookupFromBrowser(
      appleShow,
      (async () => new Response("<html>", { status: 200 })) as typeof fetch
    );
    assert.equal(html.ok, false);
    if (!html.ok) {
      assert.equal(html.reason, "failed");
      assert.match(html.error, /Try again in a moment/);
    }
  });
});

describe("matchSearchResults with same-named shows", () => {
  it("returns the candidates, so a caller that can read feeds can choose", () => {
    const twin = (feedUrl: string, collectionId: number) => ({ collectionName: "Stuff You Should Know", artistName: "iHeartPodcasts", feedUrl, collectionId });
    const outcome = matchSearchResults(
      { results: [twin("https://a.example.com/rss", 1), twin("https://b.example.com/rss", 2)] },
      { title: "Stuff You Should Know", author: "iHeartPodcasts", platform: "pocketcasts", pocketCastsUuid: "12012c20-0423-012e-f9a0-00163e1b201c" },
      asHttpUrl
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.deepEqual(outcome.candidates?.map((hit) => hit.feedUrl), ["https://a.example.com/rss", "https://b.example.com/rss"]);
    assert.match(outcome.error, /iHeartPodcasts \(https:\/\/a\.example\.com\/rss\); Stuff You Should Know — iHeartPodcasts \(https:\/\/b\.example\.com\/rss\)/);
  });
});
