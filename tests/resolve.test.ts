import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResolveError, resolveShowUrl } from "../lib/resolve";
import type { SafeResponse } from "../lib/net";

function scripted(handlers: ((url: string) => SafeResponse | undefined)[]) {
  const calls: string[] = [];
  const fetch = async (input: string) => {
    calls.push(input);
    for (const handler of handlers) {
      const response = handler(input);
      if (response) return response;
    }
    throw new Error(`Unexpected fetch ${input}`);
  };
  return { fetch, calls };
}

function ok(url: string, body: string, contentType: string): SafeResponse {
  return { url, status: 200, headers: { "content-type": contentType }, body };
}

describe("resolveShowUrl", () => {
  it("uses the Apple lookup id and ignores a search fallback", async () => {
    const { fetch, calls } = scripted([
      (url) =>
        url.startsWith("https://itunes.apple.com/lookup")
          ? ok(url, JSON.stringify({
              results: [{
                collectionName: "The Daily",
                artistName: "The New York Times",
                feedUrl: "https://feeds.simplecast.com/Sl5CSM3S",
                artworkUrl600: "https://is1-ssl.mzstatic.com/image/art.jpg",
                collectionId: 1200361736,
              }],
            }), "application/json")
          : undefined,
    ]);
    const result = await resolveShowUrl(
      "https://podcasts.apple.com/us/podcast/secrets/id1200361736?i=1000800977857",
      { fetch }
    );
    assert.equal(result.feedUrl, "https://feeds.simplecast.com/Sl5CSM3S");
    assert.equal(result.platform, "apple");
    assert.equal(result.matchedBy, "itunes-lookup");
    assert.equal(result.itunesId, 1200361736);
    assert.equal(calls.length, 1);
  });

  it("says so when Apple has no feed for the id", async () => {
    const { fetch } = scripted([
      (url) => ok(url, JSON.stringify({ results: [] }), "application/json"),
    ]);
    await assert.rejects(
      () => resolveShowUrl("https://podcasts.apple.com/us/podcast/example/id1200361736", { fetch }),
      (err: unknown) => err instanceof ResolveError && /didn't return an RSS feed/.test(err.message)
    );
  });

  it("matches a Spotify show by exact title and skips a higher-ranked different show", async () => {
    const { fetch } = scripted([
      (url) =>
        url === "https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g"
          ? ok(
              url,
              `<meta property="og:title" content="The Daily"><meta property="og:description" content="Podcast · The New York Times · news">`,
              "text/html"
            )
          : undefined,
      (url) =>
        url.startsWith("https://itunes.apple.com/search")
          ? ok(url, JSON.stringify({
              results: [
                { collectionName: "Today, Explained", artistName: "Vox", feedUrl: "https://example.com/wrong.xml", collectionId: 1 },
                { collectionName: "The Daily", artistName: "The New York Times", feedUrl: "https://feeds.simplecast.com/Sl5CSM3S", collectionId: 1200361736 },
              ],
            }), "application/json")
          : undefined,
    ]);
    const result = await resolveShowUrl("https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g?si=tracking", { fetch });
    assert.equal(result.feedUrl, "https://feeds.simplecast.com/Sl5CSM3S");
    assert.equal(result.platform, "spotify");
    assert.equal(result.matchedBy, "itunes-search");
  });

  it("uses the episode embed subtitle as the show name", async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity: {
        type: "episode",
        name: "Secrets, Chips and Spycraft",
        subtitle: "The Daily",
        relatedEntityUri: "spotify:show:3IM0lmZxpFAY7CwMuv9H4g",
      } } } } },
    })}</script>`;
    const { fetch, calls } = scripted([
      (url) => (url.includes("/embed/episode/") ? ok(url, html, "text/html") : undefined),
      (url) =>
        url.startsWith("https://open.spotify.com/show/")
          ? ok(url, `<meta property="og:title" content="The Daily"><meta property="og:description" content="Podcast · The New York Times · news">`, "text/html")
          : undefined,
      (url) =>
        url.startsWith("https://itunes.apple.com/search")
          ? ok(url, JSON.stringify({
              results: [{ collectionName: "The Daily", artistName: "The New York Times", feedUrl: "https://feeds.simplecast.com/Sl5CSM3S", collectionId: 1200361736 }],
            }), "application/json")
          : undefined,
    ]);
    const result = await resolveShowUrl("https://open.spotify.com/episode/3ICJjfeFqS170A1P7UXOOW", { fetch });
    assert.equal(result.title, "The Daily");
    const search = calls.find((url) => url.includes("itunes.apple.com/search"));
    assert.match(search ?? "", /The%20Daily|The\+Daily/);
    assert.doesNotMatch(search ?? "", /Spycraft/);
  });

  it("reports an ambiguous Spotify title instead of guessing", async () => {
    const { fetch } = scripted([
      (url) =>
        url.startsWith("https://open.spotify.com/show/")
          ? ok(url, `<meta property="og:title" content="Daily News">`, "text/html")
          : undefined,
      (url) =>
        url.startsWith("https://itunes.apple.com/search")
          ? ok(url, JSON.stringify({
              results: [
                { collectionName: "Daily News", artistName: "North Station", feedUrl: "https://example.com/a.xml", collectionId: 1 },
                { collectionName: "Daily News", artistName: "South Station", feedUrl: "https://example.com/b.xml", collectionId: 2 },
              ],
            }), "application/json")
          : undefined,
    ]);
    await assert.rejects(
      () => resolveShowUrl("https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g", { fetch }),
      (err: unknown) => err instanceof ResolveError && /Several Apple Podcasts shows/.test(err.message) && /North Station/.test(err.message)
    );
  });

  it("says when a Spotify show is not in Apple Podcasts", async () => {
    const { fetch } = scripted([
      (url) =>
        url.startsWith("https://open.spotify.com/show/")
          ? ok(url, `<meta property="og:title" content="Studio Exclusive">`, "text/html")
          : undefined,
      (url) =>
        url.startsWith("https://itunes.apple.com/search")
          ? ok(url, JSON.stringify({ results: [{ collectionName: "Something Else", artistName: "X", feedUrl: "https://example.com/a.xml" }] }), "application/json")
          : undefined,
    ]);
    await assert.rejects(
      () => resolveShowUrl("https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g", { fetch }),
      (err: unknown) => err instanceof ResolveError && /Spotify exclusive/.test(err.message)
    );
  });

  it("keeps a Pocket Casts catalog address only when it is a feed", async () => {
    const show = "https://pocketcasts.com/podcast/this-american-life/3782b780-0bc5-012e-fb02-00163e1b201c";
    const { fetch, calls } = scripted([
      (url) =>
        url.includes("podcast-api.pocketcasts.com")
          ? ok(url, JSON.stringify({ podcast: { title: "This American Life", author: "This American Life", url: "https://www.thisamericanlife.org/podcast/rss.xml", is_private: false } }), "application/json")
          : undefined,
      (url) =>
        url.startsWith("https://www.thisamericanlife.org/")
          ? ok(url, "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel></channel></rss>", "application/rss+xml")
          : undefined,
    ]);
    const result = await resolveShowUrl(show, { fetch });
    assert.equal(result.feedUrl, "https://www.thisamericanlife.org/podcast/rss.xml");
    assert.equal(result.matchedBy, "pocketcasts-catalog");
    assert.equal(calls.some((url) => url.includes("itunes.apple.com")), false);
  });

  it("does not treat a Pocket Casts website URL as the feed", async () => {
    const show = "https://pca.st/pwb9z4cq";
    const { fetch } = scripted([
      (url) =>
        url.startsWith("https://pca.st/")
          ? { url: "https://pocketcasts.com/podcast/the-suspense-is-killing-us/341d1660-fcf5-0136-324e-08b04944ede4", status: 302, headers: {}, body: "" }
          : undefined,
      (url) =>
        url.includes("podcast-api.pocketcasts.com")
          ? ok(url, JSON.stringify({ podcast: { title: "The Suspense is Killing Us", author: "The Suspense is Killing Us", url: "https://soundcloud.com/kevlar-c", is_private: false } }), "application/json")
          : undefined,
      (url) =>
        url.startsWith("https://soundcloud.com/")
          ? ok(url, "<!doctype html><html></html>", "text/html")
          : undefined,
      (url) =>
        url.startsWith("https://itunes.apple.com/search")
          ? ok(url, JSON.stringify({
              results: [
                { collectionName: "Unrelated", artistName: "Other", feedUrl: "https://example.com/no.xml", collectionId: 9 },
                { collectionName: "The Suspense is Killing Us", artistName: "The Suspense is Killing Us", feedUrl: "https://feeds.soundcloud.com/users/soundcloud:users:32959450/sounds.rss", collectionId: 1449810690 },
              ],
            }), "application/json")
          : undefined,
    ]);
    const result = await resolveShowUrl(show, { fetch });
    assert.equal(result.feedUrl, "https://feeds.soundcloud.com/users/soundcloud:users:32959450/sounds.rss");
    assert.equal(result.matchedBy, "itunes-search");
    assert.equal(result.platform, "pocketcasts");
  });

  it("refuses a private Pocket Casts show", async () => {
    const { fetch, calls } = scripted([
      (url) =>
        url.includes("podcast-api.pocketcasts.com")
          ? ok(url, JSON.stringify({ podcast: { title: "Secret", url: "https://example.com/secret.xml?token=abc", is_private: true } }), "application/json")
          : undefined,
    ]);
    await assert.rejects(
      () => resolveShowUrl("https://pocketcasts.com/podcast/secret/3782b780-0bc5-012e-fb02-00163e1b201c", { fetch }),
      (err: unknown) => err instanceof ResolveError && /private/.test(err.message)
    );
    assert.equal(calls.length, 1);
  });

  it("follows a Pocket Casts episode share link to its show", async () => {
    const show = "4eb5b260-c933-0134-10da-25324e2a541d";
    const episode = "1d9d0634-f27a-4b93-b83f-8a300f943c61";
    const { fetch, calls } = scripted([
      (url) =>
        url === `https://pca.st/episode/${episode}`
          ? { url: `https://pocketcasts.com/podcast/the-daily/${show}/secrets-chips/${episode}`, status: 302, headers: {}, body: "" }
          : undefined,
      (url) =>
        url === `https://podcast-api.pocketcasts.com/podcast/full/${show}`
          ? ok(url, JSON.stringify({ podcast: { title: "The Daily", author: "The New York Times", url: "https://www.nytimes.com/the-daily" } }), "application/json")
          : undefined,
      (url) => (url.startsWith("https://www.nytimes.com/") ? ok(url, "<!doctype html><html></html>", "text/html") : undefined),
      (url) =>
        url.startsWith("https://itunes.apple.com/search")
          ? ok(url, JSON.stringify({
              results: [{ collectionName: "The Daily", artistName: "The New York Times", feedUrl: "https://feeds.simplecast.com/Sl5CSM3S", collectionId: 1200361736 }],
            }), "application/json")
          : undefined,
    ]);
    const result = await resolveShowUrl(`https://pca.st/episode/${episode}`, { fetch });
    assert.equal(result.feedUrl, "https://feeds.simplecast.com/Sl5CSM3S");
    assert.equal(calls.some((url) => url.includes(`/podcast/full/${episode}`)), false);
  });

  it("tries the second catalog host when the first is down", async () => {
    const show = "3782b780-0bc5-012e-fb02-00163e1b201c";
    const { fetch, calls } = scripted([
      (url) => (url.includes("podcast-api.pocketcasts.com") ? { url, status: 503, headers: {}, body: "" } : undefined),
      (url) =>
        url === `https://cache.pocketcasts.com/mobile/podcast/full/${show}`
          ? ok(url, JSON.stringify({ podcast: { title: "This American Life", author: "This American Life", url: "https://www.thisamericanlife.org/podcast/rss.xml" } }), "application/json")
          : undefined,
      (url) =>
        url.startsWith("https://www.thisamericanlife.org/")
          ? ok(url, "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel></channel></rss>", "application/rss+xml")
          : undefined,
    ]);
    const result = await resolveShowUrl(`https://pocketcasts.com/podcast/this-american-life/${show}`, { fetch });
    assert.equal(result.feedUrl, "https://www.thisamericanlife.org/podcast/rss.xml");
    assert.equal(calls.filter((url) => url.includes("/podcast/full/")).length, 2);
  });

  it("says when Pocket Casts has no show with that id, without retrying", async () => {
    const { fetch, calls } = scripted([
      (url) => (url.includes("pocketcasts.com/") ? { url, status: 404, headers: {}, body: "" } : undefined),
    ]);
    await assert.rejects(
      () => resolveShowUrl("https://pocketcasts.com/podcast/gone/3782b780-0bc5-012e-fb02-00163e1b201c", { fetch }),
      (err: unknown) => err instanceof ResolveError && /no show with that id/.test(err.message)
    );
    assert.equal(calls.length, 1);
  });

  it("reports the catalog's feed address, not a signed address it redirects to", async () => {
    const { fetch } = scripted([
      (url) =>
        url.includes("podcast-api.pocketcasts.com")
          ? ok(url, JSON.stringify({ podcast: { title: "Desk", author: "Desk", url: "https://example.com/feed.xml" } }), "application/json")
          : undefined,
      (url) =>
        url === "https://example.com/feed.xml"
          ? {
              ...ok("https://cdn.example.com/feed.xml?Expires=1&Signature=abc", "<rss version=\"2.0\"><channel></channel></rss>", "application/rss+xml"),
              permanentUrl: "https://example.com/feed.xml",
            }
          : undefined,
    ]);
    const result = await resolveShowUrl("https://pocketcasts.com/podcast/desk/3782b780-0bc5-012e-fb02-00163e1b201c", { fetch });
    assert.equal(result.feedUrl, "https://example.com/feed.xml");
  });
});
