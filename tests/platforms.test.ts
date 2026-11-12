import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appleShowId, detectPlatform, parseShowLink, pocketCastsUuid, soundcloudRef, spotifyRef, youtubeRef } from "../lib/platforms";

describe("parseShowLink", () => {
  it("recognises Pocket Casts hosts", () => {
    assert.equal(detectPlatform("https://pca.st/9e6hvl11"), "pocketcasts");
    assert.equal(detectPlatform("https://www.pocketcasts.com/podcast/this-american-life/3782b780-0bc5-012e-fb02-00163e1b201c"), "pocketcasts");
    assert.equal(detectPlatform("https://play.pocketcasts.com/podcasts/3782b780-0bc5-012e-fb02-00163e1b201c"), "pocketcasts");
  });

  it("reads the show id from Apple show and episode links", () => {
    const show = new URL("https://podcasts.apple.com/us/podcast/the-daily/id1200361736");
    const episode = new URL("https://podcasts.apple.com/na/podcast/secrets/id1200361736?i=1000800977857");
    const legacy = new URL("https://itunes.apple.com/us/podcast/the-daily/id1200361736?mt=2");
    const music = new URL("https://music.apple.com/us/podcast/the-daily/id1200361736");
    assert.equal(appleShowId(show), "1200361736");
    assert.equal(appleShowId(episode), "1200361736");
    assert.equal(detectPlatform(show.toString()), "apple");
    assert.equal(detectPlatform(episode.toString()), "apple");
    assert.equal(detectPlatform(legacy.toString()), "apple");
    assert.equal(detectPlatform(music.toString()), "apple");
    assert.equal(detectPlatform("https://geo.itunes.apple.com/us/podcast/the-daily/id1200361736"), "apple");
  });

  it("rejects Apple links that are not podcasts", () => {
    const parsed = parseShowLink("https://music.apple.com/us/album/example/id123456789");
    assert.equal("error" in parsed, true);
    assert.equal(detectPlatform("https://podcasts.apple.com/us/home"), null);
  });

  it("reads Spotify show and episode ids, including intl and embed paths", () => {
    const show = spotifyRef(new URL("https://open.spotify.com/show/3IM0lmZxpFAY7CwMuv9H4g?si=abc"));
    const episode = spotifyRef(new URL("https://open.spotify.com/intl-de/episode/3ICJjfeFqS170A1P7UXOOW"));
    const embed = spotifyRef(new URL("https://open.spotify.com/embed/show/3IM0lmZxpFAY7CwMuv9H4g"));
    assert.deepEqual(show, { kind: "show", id: "3IM0lmZxpFAY7CwMuv9H4g" });
    assert.deepEqual(episode, { kind: "episode", id: "3ICJjfeFqS170A1P7UXOOW" });
    assert.deepEqual(embed, { kind: "show", id: "3IM0lmZxpFAY7CwMuv9H4g" });
    assert.equal(detectPlatform("https://open.spotify.com/playlist/3IM0lmZxpFAY7CwMuv9H4g"), null);
  });

  it("pulls a Pocket Casts uuid out of the path and ignores other text", () => {
    const url = new URL("https://pocketcasts.com/podcast/this-american-life/3782b780-0bc5-012e-fb02-00163e1b201c");
    assert.equal(pocketCastsUuid(url), "3782b780-0bc5-012e-fb02-00163e1b201c");
    assert.equal(pocketCastsUuid(new URL("https://pca.st/9e6hvl11")), undefined);
  });

  it("takes the show uuid, not the episode uuid, from Pocket Casts links", () => {
    const show = "4eb5b260-c933-0134-10da-25324e2a541d";
    const episode = "1d9d0634-f27a-4b93-b83f-8a300f943c61";
    assert.equal(pocketCastsUuid(new URL(`https://pca.st/episode/${episode}`)), undefined);
    assert.equal(pocketCastsUuid(new URL(`https://pocketcasts.com/episode/${episode}?t=30`)), undefined);
    assert.equal(
      pocketCastsUuid(new URL(`https://pocketcasts.com/podcast/the-daily/${show}/some-episode/${episode}`)),
      show
    );
    assert.equal(pocketCastsUuid(new URL(`https://play.pocketcasts.com/podcasts/${show}/${episode}`)), show);
    assert.equal(pocketCastsUuid(new URL(`https://pca.st/podcast/${show}`)), show);
  });

  it("treats any other public address as a website and refuses non-http URLs", () => {
    assert.equal(detectPlatform("https://example.com/feed.xml"), "website");
    const parsed = parseShowLink("file:///tmp/feed.xml");
    assert.equal("error" in parsed && parsed.error.includes("http"), true);
    assert.equal("error" in parseShowLink("http://intranet/"), true);
  });

  it("adds https:// to a bare domain", () => {
    const parsed = parseShowLink("joash.blog/about");
    assert.equal("url" in parsed && parsed.url.toString(), "https://joash.blog/about");
    assert.equal("platform" in parsed && parsed.platform, "website");
    assert.equal(detectPlatform("youtube.com/@NASA"), "youtube");
    assert.equal("error" in parseShowLink("not a link"), true);
  });
});

describe("youtubeRef", () => {
  const ref = (link: string) => youtubeRef(new URL(link));
  const channel = "UCBJycsmduvYEL83R_U4JriQ";

  it("reads channel ids and playlists without a fetch", () => {
    assert.deepEqual(ref(`https://www.youtube.com/channel/${channel}`), { kind: "channel", id: channel });
    assert.deepEqual(ref(`https://www.youtube.com/channel/${channel}/videos`), { kind: "channel", id: channel });
    assert.deepEqual(ref("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"), {
      kind: "playlist",
      id: "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    });
    assert.deepEqual(ref(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`), { kind: "channel", id: channel });
  });

  it("sends handles, custom links, and videos to their page", () => {
    assert.deepEqual(ref("https://www.youtube.com/@mkbhd/videos"), { kind: "page", url: "https://www.youtube.com/@mkbhd" });
    assert.deepEqual(ref("https://m.youtube.com/c/Example"), { kind: "page", url: "https://www.youtube.com/c/Example" });
    assert.deepEqual(ref("https://youtu.be/dQw4w9WgXcQ?si=abc"), { kind: "page", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    assert.deepEqual(ref("https://www.youtube.com/shorts/abcdefghijk"), { kind: "page", url: "https://www.youtube.com/watch?v=abcdefghijk" });
    assert.deepEqual(ref("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"), {
      kind: "page",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("refuses pages that aren't a channel, playlist, or video", () => {
    assert.equal(ref("https://www.youtube.com/feed/trending"), undefined);
    assert.equal(ref("https://www.youtube.com/playlist?list=WL"), undefined);
    const parsed = parseShowLink("https://www.youtube.com/results?search_query=x");
    assert.equal("error" in parsed && parsed.error.includes("YouTube"), true);
  });
});

describe("soundcloudRef", () => {
  const ref = (link: string) => soundcloudRef(new URL(link));

  it("finds the account behind a profile, track, or set", () => {
    assert.deepEqual(ref("https://soundcloud.com/StarTalk"), { kind: "user", username: "startalk" });
    assert.deepEqual(ref("https://m.soundcloud.com/forss/flickermood"), { kind: "user", username: "forss" });
    assert.deepEqual(ref("https://soundcloud.com/forss/sets/soulhack"), { kind: "user", username: "forss" });
  });

  it("keeps short links and feed addresses apart", () => {
    assert.deepEqual(ref("https://on.soundcloud.com/AbC123"), { kind: "short", url: "https://on.soundcloud.com/AbC123" });
    assert.deepEqual(ref("https://feeds.soundcloud.com/users/soundcloud:users:183/sounds.rss"), { kind: "feed", userId: "183" });
  });

  it("refuses SoundCloud's own pages", () => {
    assert.equal(ref("https://soundcloud.com/discover"), undefined);
    assert.equal(ref("https://soundcloud.com/"), undefined);
    assert.equal(detectPlatform("https://soundcloud.com/search?q=x"), null);
  });
});
