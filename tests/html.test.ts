import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeEntities, looksLikeFeed, metaContent, spotifyEmbedEntity, spotifyPublisher } from "../lib/html";

describe("html helpers", () => {
  it("decodes entities and reads meta tags in either attribute order", () => {
    const html = `<meta property="og:title" content="The Daily &amp; Co &#39;cast&#39;">
      <meta content="Podcast · The New York Times · hello" property="og:description">`;
    assert.equal(metaContent(html, "og:title"), "The Daily & Co 'cast'");
    assert.equal(spotifyPublisher(metaContent(html, "og:description")), "The New York Times");
    assert.equal(decodeEntities("&#60;script&#62;"), "<script>");
  });

  it("reads the show name from an episode embed, not the episode title", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                type: "episode",
                name: "Secrets, Chips and Spycraft",
                subtitle: "The Daily",
                relatedEntityUri: "spotify:show:3IM0lmZxpFAY7CwMuv9H4g",
                relatedEntityCoverArt: [{ url: "https://i.scdn.co/image/ab" }],
              },
            },
          },
        },
      },
    })}</script>`;
    const entity = spotifyEmbedEntity(html);
    assert.equal(entity?.subtitle, "The Daily");
    assert.equal(entity?.name, "Secrets, Chips and Spycraft");
    assert.equal(entity?.showId, "3IM0lmZxpFAY7CwMuv9H4g");
    assert.equal(entity?.image, "https://i.scdn.co/image/ab");
  });

  it("tells a feed from a website", () => {
    assert.equal(looksLikeFeed("application/rss+xml", ""), true);
    assert.equal(looksLikeFeed("text/html", "<!doctype html><html>"), false);
    assert.equal(looksLikeFeed("application/octet-stream", "<?xml version=\"1.0\"?><rss version=\"2.0\">"), true);
    assert.equal(looksLikeFeed("text/plain", "hello"), false);
  });
});
