import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { SafeFetchOptions, SafeResponse } from "../lib/net";
import { podcastIndexKeys, signedHeaders, type PodcastIndexKeys } from "../lib/podcast-index";
import { findFeedByName, NameSearchIncomplete, ResolveError, resolveShowUrl, type ResolverDeps } from "../lib/resolve";
import type { DirectorySearch } from "../lib/directory";

const KEYS: PodcastIndexKeys = { key: "UXKCGDSYGUUEVQJSYDZH", secret: "yzJe2eE7XV-3eY576dyRZ6wXyAbndh6LUrCZ8KN|" };
const NOW = 1_613_713_388_000;
const APPLE_FEED = "https://feeds.simplecast.com/Sl5CSM3S";
const ARCHIVE_FEED = "https://feeds.simplecast.com/54nAGcIl";
const INDEX_FEED = "https://feeds.example.com/the-daily.xml";
const GUID = "9b024349-ccf0-5f69-a609-6b82873eab3c";
const DAILY: DirectorySearch = { title: "The Daily", author: "The New York Times", platform: "pocketcasts" };

const json = (url: string, body: unknown, status = 200): SafeResponse => ({
  url,
  status,
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

type Route = (url: string, options: SafeFetchOptions) => SafeResponse | undefined;

function stub(...routes: Route[]) {
  const calls: { url: string; options: SafeFetchOptions }[] = [];
  const fetch = async (url: string, options: SafeFetchOptions) => {
    calls.push({ url, options });
    for (const route of routes) {
      const hit = route(url, options);
      if (hit) return hit;
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const deps = (podcastIndex: PodcastIndexKeys | null = KEYS): ResolverDeps => ({
    fetch,
    podcastIndex,
    now: () => NOW,
    sleep: async () => undefined,
  });
  const to = (prefix: string) => calls.filter((call) => call.url.startsWith(prefix)).length;
  return { deps, calls, to };
}

const indexSearch = (feeds: unknown[], status = 200): Route => (url) =>
  url.startsWith("https://api.podcastindex.org/api/1.0/search/bytitle")
    ? json(url, status === 200 ? { status: "true", feeds, count: feeds.length } : "Unauthorized", status)
    : undefined;

const appleLookup = (feedUrl: string | undefined, status = 200): Route => (url) =>
  url.startsWith("https://itunes.apple.com/lookup")
    ? json(url, status === 200 ? { results: feedUrl ? [{ collectionName: "The Daily", artistName: "The New York Times", feedUrl, collectionId: 1200361736 }] : [] } : "Rate limit", status)
    : undefined;

const appleSearch = (status: number, results: unknown[] = []): Route => (url) =>
  url.startsWith("https://itunes.apple.com/search")
    ? json(url, status === 200 ? { results } : "Rate limit has been exceeded", status)
    : undefined;

const nyt = (url: string, itunesId: number | null, extra: Record<string, unknown> = {}) => ({
  id: Math.floor(Math.random() * 1e6),
  title: "The Daily",
  author: "The New York Times",
  url,
  artwork: "https://images.example.com/daily.jpg",
  itunesId,
  dead: 0,
  ...extra,
});

describe("Podcast Index keys and signing", () => {
  it("needs both the key and the secret", () => {
    assert.equal(podcastIndexKeys({ PODCASTINDEX_API_KEY: "k" }), undefined);
    assert.equal(podcastIndexKeys({ PODCASTINDEX_API_SECRET: "s" }), undefined);
    assert.deepEqual(podcastIndexKeys({ PODCASTINDEX_API_KEY: " k ", PODCASTINDEX_API_SECRET: " s " }), { key: "k", secret: "s" });
  });

  it("signs with a lower-case SHA-1 of key, secret, and whole seconds, and never sends the secret", async () => {
    const headers = await signedHeaders(KEYS, NOW + 999);
    const expected = createHash("sha1").update(`${KEYS.key}${KEYS.secret}1613713388`).digest("hex");
    assert.deepEqual(headers, { "X-Auth-Key": KEYS.key, "X-Auth-Date": "1613713388", Authorization: expected });
    assert.equal(JSON.stringify(headers).includes(KEYS.secret), false);
  });
});

describe("findFeedByName", () => {
  it("takes the feed that declares the podcast GUID, without a name match or Apple", async () => {
    const { deps, calls, to } = stub((url) =>
      url.startsWith("https://api.podcastindex.org/api/1.0/podcasts/byguid")
        ? json(url, { status: "true", feed: nyt(INDEX_FEED, 1200361736) })
        : undefined
    );
    const result = await findFeedByName({ ...DAILY, podcastGuid: GUID }, deps());
    assert.equal(result.feedUrl, INDEX_FEED);
    assert.equal(result.matchedBy, "podcastindex-guid");
    assert.equal(result.platform, "pocketcasts");
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).searchParams.get("guid"), GUID);
    assert.equal(to("https://itunes.apple.com"), 0);
  });

  it("signs every request and sends it only to Podcast Index", async () => {
    const { deps, calls } = stub(indexSearch([nyt(INDEX_FEED, null)]));
    await findFeedByName(DAILY, deps());
    const call = calls[0];
    assert.deepEqual(call.options.allowedHosts, ["api.podcastindex.org"]);
    assert.equal(call.options.headers?.["X-Auth-Key"], KEYS.key);
    assert.match(call.options.headers?.Authorization ?? "", /^[0-9a-f]{40}$/);
    assert.equal(call.url.includes(KEYS.secret), false);
    assert.equal(JSON.stringify(call.options).includes(KEYS.secret), false);
  });

  it("prefers the feed Apple lists and reports Apple's address for it", async () => {
    const { deps, to } = stub(
      indexSearch([
        nyt(ARCHIVE_FEED, null),
        nyt("http://10.0.0.5/feed.xml", 1),
        nyt("https://feeds.example.com/gone.xml", 2, { dead: 1 }),
        nyt(INDEX_FEED, 1200361736),
        nyt("https://feeds.example.com/mirror.xml", 1200361736),
      ]),
      appleLookup(APPLE_FEED)
    );
    const result = await findFeedByName(DAILY, deps());
    assert.equal(result.feedUrl, APPLE_FEED);
    assert.equal(result.matchedBy, "podcastindex-search");
    assert.equal(result.itunesId, 1200361736);
    assert.equal(to("https://itunes.apple.com/search"), 0);
  });

  it("keeps Podcast Index's address when Apple's lookup doesn't answer", async () => {
    const { deps } = stub(indexSearch([nyt(INDEX_FEED, 1200361736)]), appleLookup(undefined, 429));
    const result = await findFeedByName(DAILY, deps());
    assert.equal(result.feedUrl, INDEX_FEED);
    assert.equal(result.matchedBy, "podcastindex-search");
  });

  it("refuses two different shows with the same name and publisher, without asking Apple", async () => {
    const { deps, to } = stub(
      indexSearch([
        { ...nyt("https://a.example.com/feed.xml", 11), author: "North Station" },
        { ...nyt("https://b.example.com/feed.xml", 12), author: "South Station" },
      ])
    );
    await assert.rejects(
      () => findFeedByName({ title: "The Daily", platform: "spotify" }, deps()),
      (err: unknown) => err instanceof ResolveError && !(err instanceof NameSearchIncomplete) && /Several shows are named "The Daily"/.test(err.message)
    );
    assert.equal(to("https://itunes.apple.com"), 0);
  });

  it("refuses a show whose publisher conflicts", async () => {
    const { deps } = stub(indexSearch([{ ...nyt(INDEX_FEED, 1), author: "Someone Else Entirely" }]));
    await assert.rejects(
      () => findFeedByName(DAILY, deps()),
      (err: unknown) => err instanceof ResolveError && /publisher doesn't match/.test(err.message)
    );
  });

  it("asks Apple when Podcast Index has no such show", async () => {
    const { deps, to } = stub(
      indexSearch([]),
      appleSearch(200, [{ collectionName: "The Daily", artistName: "The New York Times", feedUrl: APPLE_FEED, collectionId: 1200361736 }])
    );
    const result = await findFeedByName(DAILY, deps());
    assert.equal(result.feedUrl, APPLE_FEED);
    assert.equal(result.matchedBy, "itunes-search");
    assert.equal(to("https://itunes.apple.com/search"), 1);
  });

  it("asks Apple when Podcast Index refuses the keys", async () => {
    const { deps } = stub(
      indexSearch([], 401),
      appleSearch(200, [{ collectionName: "The Daily", artistName: "The New York Times", feedUrl: APPLE_FEED, collectionId: 1200361736 }])
    );
    const result = await findFeedByName(DAILY, deps());
    assert.equal(result.matchedBy, "itunes-search");
  });

  it("says what each directory did when neither could match the show, and gives the Apple search to run elsewhere", async () => {
    const cases: [Route, RegExp][] = [
      [indexSearch([]), /Podcast Index has no show named "The Daily" by The New York Times, and Apple's directory turned down/],
      [indexSearch([], 503), /Neither Podcast Index nor Apple's directory answered this server/],
    ];
    for (const [index, message] of cases) {
      const { deps } = stub(index, appleSearch(429));
      await assert.rejects(
        () => findFeedByName(DAILY, deps()),
        (err: unknown) => {
          assert.ok(err instanceof NameSearchIncomplete);
          assert.match(err.message, message);
          assert.equal(/try again/i.test(err.message), false);
          assert.equal(err.searchUrl, "https://itunes.apple.com/search?media=podcast&entity=podcast&limit=50&term=The+Daily");
          return true;
        }
      );
    }
  });

  it("uses only Apple when Podcast Index isn't set up", async () => {
    const { deps, to } = stub(appleSearch(429));
    await assert.rejects(
      () => findFeedByName(DAILY, deps(null)),
      (err: unknown) => err instanceof NameSearchIncomplete && /^Apple's directory turned down the name search from this server/.test(err.message)
    );
    assert.equal(to("https://api.podcastindex.org"), 0);
  });

  it("passes a Pocket Casts show's podcast GUID through to Podcast Index", async () => {
    const uuid = "3782b780-0bc5-012e-fb02-00163e1b201c";
    const { deps } = stub(
      (url) =>
        url.includes(`/podcast/full/${uuid}`)
          ? json(url, { podcast: { title: "The Daily", author: "The New York Times", url: "https://www.nytimes.com/the-daily", guid: GUID, is_private: false } })
          : undefined,
      (url) => (url.startsWith("https://www.nytimes.com/") ? { url, status: 200, headers: { "content-type": "text/html" }, body: "<html></html>" } : undefined),
      (url) =>
        url.startsWith(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${GUID}`)
          ? json(url, { status: "true", feed: nyt(INDEX_FEED, null) })
          : undefined
    );
    const result = await resolveShowUrl(`https://pocketcasts.com/podcast/the-daily/${uuid}`, deps());
    assert.equal(result.feedUrl, INDEX_FEED);
    assert.equal(result.matchedBy, "podcastindex-guid");
  });

  it("falls back to the title when Podcast Index doesn't know the GUID", async () => {
    const { deps } = stub(
      (url) =>
        url.startsWith("https://api.podcastindex.org/api/1.0/podcasts/byguid")
          ? json(url, { status: "true", feed: [], description: "No feeds match this guid." })
          : undefined,
      indexSearch([nyt(INDEX_FEED, null)])
    );
    const result = await findFeedByName({ ...DAILY, podcastGuid: GUID }, deps());
    assert.equal(result.feedUrl, INDEX_FEED);
    assert.equal(result.matchedBy, "podcastindex-search");
  });
});
