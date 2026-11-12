import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alternateFeeds, commonFeedUrls, feedTitle, knownFeedUrls, readYouTubePage } from "../lib/discover";
import { FetchError, type SafeResponse } from "../lib/net";
import { resolveShowUrl, ResolveError } from "../lib/resolve";

type Handler = (url: string) => SafeResponse | undefined;

function scripted(handlers: Handler[]) {
  const calls: string[] = [];
  const fetch = async (input: string) => {
    calls.push(input);
    for (const handler of handlers) {
      const response = handler(input);
      if (response) return response;
    }
    return { url: input, status: 404, headers: {}, body: "" };
  };
  return { fetch, calls };
}

const page = (url: string, body: string, status = 200): SafeResponse => ({
  url,
  status,
  headers: { "content-type": "text/html" },
  body,
});

const rss = (title: string, items = 2) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title><![CDATA[${title}]]></title>${"<item><title>x</title></item>".repeat(items)}</channel></rss>`;

const atom = (title: string) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${title}</title><entry><title>v</title></entry></feed>`;

const xml = (url: string, body: string): SafeResponse => ({
  url,
  status: 200,
  headers: { "content-type": "application/rss+xml" },
  body,
});

const CHANNEL = "UCBJycsmduvYEL83R_U4JriQ";

describe("YouTube", () => {
  it("reads the channel id from a handle page and returns the channel feed", async () => {
    const { fetch, calls } = scripted([
      (url) =>
        url === "https://www.youtube.com/@mkbhd"
          ? page(
              url,
              `<html><head><meta property="og:title" content="Marques Brownlee"><meta property="og:image" content="https://yt3.example/a.jpg"><link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}"></head></html>`
            )
          : undefined,
      (url) => (url.startsWith("https://www.youtube.com/feeds/videos.xml") ? xml(url, atom("Marques Brownlee")) : undefined),
    ]);
    const result = await resolveShowUrl("https://www.youtube.com/@mkbhd/videos", { fetch });
    assert.equal(result.feedUrl, `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`);
    assert.equal(result.title, "Marques Brownlee");
    assert.equal(result.artwork, "https://yt3.example/a.jpg");
    assert.equal(result.platform, "youtube");
    assert.equal(result.matchedBy, "youtube-channel");
    assert.equal(calls.length, 2);
  });

  it("takes a video's channel from videoDetails, not from recommendations", () => {
    const html = `"videoDetails":{"videoId":"abc","title":"T","keywords":["a}"],"channelId":"UCuAXFkgsw1L7xaCfnd5JJOw","isOwnerViewing":false,"author":"Rick Astley"}…"channelId":"UCxxxxxxxxxxxxxxxxxxxxxx"`;
    assert.deepEqual(readYouTubePage(html, true), { channelId: "UCuAXFkgsw1L7xaCfnd5JJOw", title: "Rick Astley" });
  });

  it("needs no page for a channel or playlist link", async () => {
    const { fetch, calls } = scripted([(url) => xml(url, atom("Uploads"))]);
    const channel = await resolveShowUrl(`https://www.youtube.com/channel/${CHANNEL}`, { fetch });
    assert.equal(channel.title, "Uploads");
    const playlist = await resolveShowUrl("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI", { fetch });
    assert.equal(playlist.feedUrl, "https://www.youtube.com/feeds/videos.xml?playlist_id=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI");
    assert.equal(playlist.matchedBy, "youtube-playlist");
    assert.equal(calls.every((url) => url.includes("/feeds/videos.xml")), true);
  });

  it("says so when the page has no channel id", async () => {
    const { fetch } = scripted([(url) => page(url, "<html>consent</html>")]);
    await assert.rejects(resolveShowUrl("https://www.youtube.com/@nobody", { fetch }), /Couldn't find the channel/);
  });
});

describe("SoundCloud", () => {
  const profile = (url: string) =>
    page(url, `<meta property="og:title" content="StarTalk Radio"><meta property="twitter:app:url:iphone" content="soundcloud://users:12345"><meta property="og:image" content="https://i1.sndcdn.com/a.jpg">`);

  it("finds the account id on the profile page behind a track link", async () => {
    const { fetch, calls } = scripted([
      (url) => (url === "https://soundcloud.com/startalk" ? profile(url) : undefined),
      (url) => (url.startsWith("https://feeds.soundcloud.com/") ? xml(url, rss("StarTalk Radio", 3)) : undefined),
    ]);
    const result = await resolveShowUrl("https://soundcloud.com/startalk/some-track", { fetch });
    assert.equal(result.feedUrl, "https://feeds.soundcloud.com/users/soundcloud:users:12345/sounds.rss");
    assert.equal(result.title, "StarTalk Radio");
    assert.equal(result.matchedBy, "soundcloud-profile");
    assert.equal(result.note, undefined);
    assert.deepEqual(calls, ["https://soundcloud.com/startalk", "https://feeds.soundcloud.com/users/soundcloud:users:12345/sounds.rss"]);
  });

  it("notes an empty feed", async () => {
    const { fetch } = scripted([
      (url) => (url === "https://soundcloud.com/startalk" ? profile(url) : undefined),
      (url) => (url.startsWith("https://feeds.soundcloud.com/") ? xml(url, rss("StarTalk Radio", 0)) : undefined),
    ]);
    const result = await resolveShowUrl("soundcloud.com/startalk", { fetch });
    assert.match(result.note ?? "", /empty/);
  });

  it("reports a missing profile", async () => {
    const { fetch } = scripted([]);
    await assert.rejects(resolveShowUrl("https://soundcloud.com/nobody-here", { fetch }), /no profile/);
  });
});

describe("websites", () => {
  it("returns a link that is already a feed", async () => {
    const { fetch } = scripted([(url) => xml(url, rss("The Daily"))]);
    const result = await resolveShowUrl("https://feeds.example.com/daily", { fetch });
    assert.equal(result.feedUrl, "https://feeds.example.com/daily");
    assert.equal(result.title, "The Daily");
    assert.equal(result.matchedBy, "direct");
  });

  it("uses the page's own feed links, main feed first and comments listed after", async () => {
    const { fetch } = scripted([
      (url) =>
        url === "https://blog.example.com/"
          ? page(
              url,
              `<head><title>A &amp; B</title><link rel="alternate" type="application/rss+xml" title="Comments &raquo; Feed" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed/"></head>`
            )
          : undefined,
      (url) => (url === "https://blog.example.com/feed/" ? xml(url, rss("A & B")) : undefined),
    ]);
    const result = await resolveShowUrl("blog.example.com", { fetch });
    assert.equal(result.feedUrl, "https://blog.example.com/feed/");
    assert.equal(result.title, "A & B");
    assert.equal(result.matchedBy, "page-link");
    assert.deepEqual(result.otherFeeds, [{ url: "https://blog.example.com/comments/feed/", title: "Comments » Feed" }]);
  });

  it("falls back to common feed paths, preferring the page's own path", async () => {
    const { fetch } = scripted([
      (url) => (url === "https://news.example.com/blog" ? page(url, "<head><title>News</title></head>") : undefined),
      (url) => (url === "https://news.example.com/blog/rss.xml" ? xml(url, rss("News blog")) : undefined),
      (url) => (url === "https://news.example.com/feed" ? xml(url, rss("Everything")) : undefined),
    ]);
    const result = await resolveShowUrl("https://news.example.com/blog", { fetch });
    assert.equal(result.feedUrl, "https://news.example.com/blog/rss.xml");
    assert.equal(result.matchedBy, "common-path");
    assert.equal(result.title, "News");
  });

  it("says when nothing is found", async () => {
    const { fetch } = scripted([(url) => (url === "https://plain.example.com/" ? page(url, "<p>hi</p>") : undefined)]);
    await assert.rejects(resolveShowUrl("https://plain.example.com/", { fetch }), /No RSS or Atom feed found/);
  });

  it("shows why a private address is refused", async () => {
    const fetch = async () => {
      throw new FetchError("That address isn't public.", "blocked");
    };
    await assert.rejects(resolveShowUrl("http://192.168.1.10/", { fetch }), (err: unknown) => {
      assert.ok(err instanceof ResolveError);
      assert.equal(err.message, "That address isn't public.");
      return true;
    });
  });

  it("reads feed links relative to <base> and skips private ones", () => {
    const html = `<base href="https://cdn.example.com/site/"><link rel="alternate" type="application/atom+xml" href="atom.xml"><link rel="alternate" type="application/rss+xml" href="http://127.0.0.1/feed"><link rel="stylesheet" href="x.css">`;
    assert.deepEqual(alternateFeeds(html, "https://example.com/"), [{ url: "https://cdn.example.com/site/atom.xml", title: undefined }]);
  });

  it("knows the feed patterns of common hosts", () => {
    assert.deepEqual(knownFeedUrls(new URL("https://example.substack.com/p/post")), ["https://example.substack.com/feed"]);
    assert.deepEqual(knownFeedUrls(new URL("https://medium.com/@someone")), ["https://medium.com/feed/@someone"]);
    assert.deepEqual(knownFeedUrls(new URL("https://www.reddit.com/r/podcasts/")), ["https://www.reddit.com/r/podcasts/.rss"]);
    assert.deepEqual(knownFeedUrls(new URL("https://github.com/vercel/next.js")), ["https://github.com/vercel/next.js/releases.atom"]);
    assert.deepEqual(knownFeedUrls(new URL("https://example.com/")), []);
  });

  it("tries a bounded list of common paths", () => {
    const paths = commonFeedUrls(new URL("https://example.com/blog/"));
    assert.equal(paths[0], "https://example.com/blog/feed");
    assert.ok(paths.includes("https://example.com/atom.xml"));
    assert.ok(paths.length <= 12);
  });

  it("reads a feed title through CDATA and entities", () => {
    assert.equal(feedTitle("<rss><channel><title><![CDATA[Tom &amp; Jerry]]></title>"), "Tom & Jerry");
  });
});
