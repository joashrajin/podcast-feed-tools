import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptAppleLookup, identifyShow, ResolveError, resolveShowUrl, type ResolverDeps } from "../lib/resolve";
import { FetchError, type SafeFetchOptions, type SafeResponse } from "../lib/net";

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

  it("identifies a Spotify show by name and leaves the Apple search to the caller", async () => {
    const { fetch, calls } = scripted([
      (url) =>
        url.startsWith("https://open.spotify.com/show/")
          ? ok(url, `<meta property="og:title" content="The Daily"><meta property="og:description" content="Podcast · The New York Times · news"><meta property="og:image" content="https://i.scdn.co/image/abc">`, "text/html")
          : undefined,
    ]);
    const identified = await identifyShow("https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g", { fetch });
    assert.deepEqual(identified, {
      search: { title: "The Daily", author: "The New York Times", platform: "spotify", artwork: "https://i.scdn.co/image/abc" },
    });
    assert.equal(calls.some((url) => url.includes("itunes.apple.com")), false);
  });

  it("identifies a Pocket Casts show whose catalog address isn't a feed", async () => {
    const show = "4eb5b260-c933-0134-10da-25324e2a541d";
    const { fetch, calls } = scripted([
      (url) =>
        url.includes("podcast-api.pocketcasts.com")
          ? ok(url, JSON.stringify({ podcast: { title: "The Daily", author: "The New York Times", url: "https://www.nytimes.com/the-daily" } }), "application/json")
          : undefined,
      (url) => (url.startsWith("https://www.nytimes.com/") ? ok(url, "<!doctype html><html></html>", "text/html") : undefined),
    ]);
    const identified = await identifyShow(`https://pocketcasts.com/podcast/the-daily/${show}`, { fetch });
    assert.ok("search" in identified);
    if ("search" in identified) {
      assert.equal(identified.search.title, "The Daily");
      assert.equal(identified.search.platform, "pocketcasts");
      assert.equal(identified.search.artwork, `https://static.pocketcasts.com/discover/images/webp/480/${show}.webp`);
    }
    assert.equal(calls.some((url) => url.includes("itunes.apple.com")), false);
  });

  it("returns the feed directly when no name search is needed", async () => {
    const { fetch } = scripted([
      (url) =>
        url.startsWith("https://itunes.apple.com/lookup")
          ? ok(url, JSON.stringify({ results: [{ collectionName: "The Daily", artistName: "The New York Times", feedUrl: "https://feeds.simplecast.com/Sl5CSM3S", collectionId: 1200361736 }] }), "application/json")
          : undefined,
    ]);
    const identified = await identifyShow("https://podcasts.apple.com/us/podcast/the-daily/id1200361736", { fetch });
    assert.ok("result" in identified);
    if ("result" in identified) assert.equal(identified.result.feedUrl, "https://feeds.simplecast.com/Sl5CSM3S");
  });
});

const APPLE = "https://podcasts.apple.com/us/podcast/the-daily/id1200361736";
const DAILY_HIT = {
  collectionName: "The Daily",
  artistName: "The New York Times",
  feedUrl: "https://feeds.simplecast.com/Sl5CSM3S",
  artworkUrl600: "https://is1-ssl.mzstatic.com/image/art.jpg",
  collectionId: 1200361736,
};

function lookupBody(): SafeResponse {
  return ok(
    "https://itunes.apple.com/lookup?id=1200361736&entity=podcast",
    JSON.stringify({ results: [DAILY_HIT] }),
    "application/json"
  );
}

describe("Apple directory retry", () => {
  it("retries one unreadable Apple lookup inside the same deadline", async () => {
    let clock = 0;
    let lookups = 0;
    const timeouts: number[] = [];
    const sleeps: number[] = [];
    const fetch = async (input: string, options: SafeFetchOptions) => {
      if (!input.startsWith("https://itunes.apple.com/lookup")) throw new Error(`Unexpected fetch ${input}`);
      timeouts.push(options.timeoutMs ?? 0);
      clock += 100;
      lookups += 1;
      if (lookups === 1) return { url: input, status: 403, headers: {}, body: "blocked" };
      return lookupBody();
    };
    const result = await resolveShowUrl(APPLE, {
      fetch,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    assert.equal(result.feedUrl, DAILY_HIT.feedUrl);
    assert.equal(result.matchedBy, "itunes-lookup");
    assert.equal(lookups, 2);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 0 && sleeps[0] < 1_000);
    assert.equal(timeouts[0], 8_000);
    assert.equal(timeouts[1], 8_000 - 100 - sleeps[0]);
  });

  it("retries a 200 whose body is not JSON", async () => {
    let lookups = 0;
    const fetch = async (input: string) => {
      if (!input.startsWith("https://itunes.apple.com/lookup")) throw new Error(`Unexpected fetch ${input}`);
      lookups += 1;
      if (lookups === 1) return { url: input, status: 200, headers: { "content-type": "text/html" }, body: "<html>no</html>" };
      return lookupBody();
    };
    const result = await resolveShowUrl(APPLE, { fetch, now: () => 0, sleep: async () => undefined });
    assert.equal(result.feedUrl, DAILY_HIT.feedUrl);
    assert.equal(lookups, 2);
  });

  it("does not start a retry once the deadline is gone", async () => {
    let clock = 0;
    let lookups = 0;
    let slept = false;
    const fetch = async (input: string) => {
      lookups += 1;
      clock += 7_600;
      return { url: input, status: 503, headers: {}, body: "" };
    };
    await assert.rejects(
      () => resolveShowUrl(APPLE, {
        fetch,
        now: () => clock,
        sleep: async () => {
          slept = true;
        },
      }),
      (err: unknown) => err instanceof ResolveError && /Try again in a moment/.test(err.message) && !/couldn't be read/.test(err.message)
    );
    assert.equal(lookups, 1);
    assert.equal(slept, false);
  });

  it("does not retry a connection failure", async () => {
    let lookups = 0;
    const fetch = async () => {
      lookups += 1;
      throw new FetchError("The connection failed.", "network");
    };
    await assert.rejects(
      () => resolveShowUrl(APPLE, { fetch, sleep: async () => { throw new Error("slept"); } }),
      (err: unknown) => err instanceof ResolveError && /didn't respond/.test(err.message)
    );
    assert.equal(lookups, 1);
  });

  it("retries a server-side Apple name search the same way", async () => {
    let searches = 0;
    const fetch = async (input: string) => {
      if (input.startsWith("https://open.spotify.com/show/")) {
        return ok(input, `<meta property="og:title" content="The Daily"><meta property="og:description" content="Podcast · The New York Times">`, "text/html");
      }
      if (input.startsWith("https://itunes.apple.com/search")) {
        searches += 1;
        if (searches === 1) return { url: input, status: 429, headers: {}, body: "Rate limit" };
        return ok(input, JSON.stringify({ results: [DAILY_HIT] }), "application/json");
      }
      throw new Error(`Unexpected fetch ${input}`);
    };
    const deps: ResolverDeps = { fetch, now: () => 0, sleep: async () => undefined };
    const result = await resolveShowUrl("https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g", deps);
    assert.equal(result.feedUrl, DAILY_HIT.feedUrl);
    assert.equal(result.matchedBy, "itunes-search");
    assert.equal(searches, 2);
  });
});

describe("acceptAppleLookup", () => {
  const claim = {
    feedUrl: DAILY_HIT.feedUrl,
    title: "The Daily",
    author: "The New York Times",
    artwork: DAILY_HIT.artworkUrl600,
    itunesId: DAILY_HIT.collectionId,
    extra: "ignored",
  };

  it("accepts a browser claim through the same public-URL check as a server hit", () => {
    const result = acceptAppleLookup(APPLE, claim);
    assert.equal(result.feedUrl, DAILY_HIT.feedUrl);
    assert.equal(result.title, "The Daily");
    assert.equal(result.author, "The New York Times");
    assert.equal(result.artwork, DAILY_HIT.artworkUrl600);
    assert.equal(result.itunesId, DAILY_HIT.collectionId);
    assert.equal(result.platform, "apple");
    assert.equal(result.matchedBy, "itunes-lookup");
  });

  it("stamps the show id when the claim omits it and drops artwork that isn't https", () => {
    const result = acceptAppleLookup(`${APPLE}?i=1000800977857`, {
      feedUrl: `  ${DAILY_HIT.feedUrl}  `,
      title: "  The Daily  ",
      artwork: "http://insecure.example/art.jpg",
    });
    assert.equal(result.feedUrl, DAILY_HIT.feedUrl);
    assert.equal(result.title, "The Daily");
    assert.equal(result.artwork, undefined);
    assert.equal(result.itunesId, DAILY_HIT.collectionId);
  });

  it("refuses a feed address that isn't public", () => {
    for (const feedUrl of [
      "http://127.0.0.1/feed.xml",
      "http://169.254.169.254/latest/meta-data",
      "http://localhost/feed.xml",
      "http://10.1.2.3/feed.xml",
      "http://[::1]/feed.xml",
      "https://user:pass@feeds.example.com/feed.xml",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      assert.throws(
        () => acceptAppleLookup(APPLE, { ...claim, feedUrl }),
        (err: unknown) => err instanceof ResolveError && /isn't a public URL/.test(err.message)
      );
    }
  });

  it("refuses a claim for a different show, a non-object, or a non-Apple link", () => {
    assert.throws(
      () => acceptAppleLookup(APPLE, { ...claim, itunesId: 1 }),
      (err: unknown) => err instanceof ResolveError && /doesn't match this show/.test(err.message)
    );
    for (const bad of [null, [], "feed", 5]) {
      assert.throws(
        () => acceptAppleLookup(APPLE, bad),
        (err: unknown) => err instanceof ResolveError && /wasn't usable/.test(err.message)
      );
    }
    assert.throws(
      () => acceptAppleLookup("https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g", claim),
      (err: unknown) => err instanceof ResolveError && /only applies to an Apple Podcasts link/.test(err.message)
    );
  });
});
