import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appleShowId, detectPlatform, parseShowLink, pocketCastsUuid, spotifyRef } from "../lib/platforms";

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

  it("rejects unrelated hosts and non-http URLs", () => {
    assert.equal(detectPlatform("https://example.com/feed.xml"), null);
    const parsed = parseShowLink("file:///tmp/feed.xml");
    assert.equal("error" in parsed && parsed.error.includes("http"), true);
  });
});
