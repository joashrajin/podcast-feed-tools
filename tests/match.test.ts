import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeName, pickDirectoryHit, type DirectoryHit } from "../lib/match";

const daily: DirectoryHit = {
  title: "The Daily",
  author: "The New York Times",
  feedUrl: "https://feeds.simplecast.com/Sl5CSM3S",
  itunesId: 1200361736,
};

const other: DirectoryHit = {
  title: "Today, Explained",
  author: "Vox",
  feedUrl: "https://feeds.megaphone.fm/VMP5705694065",
  itunesId: 1,
};

describe("pickDirectoryHit", () => {
  it("normalizes punctuation and accents", () => {
    assert.equal(normalizeName("Science Vs."), "science vs");
    assert.equal(normalizeName("Conán O'Brien"), "conan o brien");
    assert.equal(normalizeName("中文播客"), "中文播客");
    assert.equal(normalizeName("Наука"), "наука");
  });

  it("matches an exact title and ignores a higher-ranked different show", () => {
    const outcome = pickDirectoryHit([other, daily], "The Daily");
    assert.equal(outcome.status, "match");
    if (outcome.status === "match") assert.equal(outcome.hit.feedUrl, daily.feedUrl);
  });

  it("does not fall back to the first result", () => {
    const outcome = pickDirectoryHit([other, daily], "Missing Show");
    assert.equal(outcome.status, "none");
  });

  it("uses the publisher when several shows share a title", () => {
    const twin: DirectoryHit = {
      title: "The Daily",
      author: "Someone Else",
      feedUrl: "https://example.com/other.xml",
      itunesId: 2,
    };
    const matched = pickDirectoryHit([twin, daily], "The Daily", "The New York Times");
    assert.equal(matched.status, "match");
    if (matched.status === "match") assert.equal(matched.hit.itunesId, 1200361736);

    const ambiguous = pickDirectoryHit([twin, daily], "The Daily");
    assert.equal(ambiguous.status, "ambiguous");
  });

  it("treats the same feed listed twice as one match", () => {
    const outcome = pickDirectoryHit([daily, { ...daily, itunesId: 9 }], "the daily");
    assert.equal(outcome.status, "match");
  });

  it("does not match a single title when the publisher conflicts", () => {
    const outcome = pickDirectoryHit([daily], "The Daily", "Someone Else");
    assert.equal(outcome.status, "conflict");
  });

  it("does not match a shared feed when every publisher conflicts", () => {
    const outcome = pickDirectoryHit(
      [daily, { ...daily, itunesId: 9 }],
      "The Daily",
      "Someone Else"
    );
    assert.equal(outcome.status, "conflict");
  });
});
