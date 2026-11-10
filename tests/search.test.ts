import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POCKET_CASTS_SUBMIT_URL, pocketCastsShowUrl, podcastHitsFromSearch } from "../lib/search";
import { describeCadence, durationSeconds } from "../lib/feed-stats";

describe("Pocket Casts search mapping", () => {
  it("links a podcast result to its show page and drops episodes", () => {
    const hits = podcastHitsFromSearch({
      results: [
        {
          type: "episode",
          uuid: "44f432c6-da1e-4ab0-86d8-799a02ae653a",
          title: "An episode",
        },
        {
          type: "podcast",
          uuid: "3782b780-0bc5-012e-fb02-00163e1b201c",
          title: "This American Life",
          author: "This American Life",
          slug: "this-american-life",
          explicit: false,
        },
      ],
    });
    assert.ok(hits);
    assert.equal(hits.length, 1);
    assert.equal(
      hits[0].url,
      "https://pocketcasts.com/podcast/this-american-life/3782b780-0bc5-012e-fb02-00163e1b201c"
    );
    assert.equal(pocketCastsShowUrl("3782b780-0bc5-012e-fb02-00163e1b201c"), "https://pocketcasts.com/podcasts/3782b780-0bc5-012e-fb02-00163e1b201c");
  });

  it("points missing shows at the official submit form", () => {
    assert.equal(POCKET_CASTS_SUBMIT_URL, "https://pocketcasts.com/submit/");
    assert.deepEqual(podcastHitsFromSearch({ results: [] }), []);
    assert.equal(podcastHitsFromSearch({}), null);
    assert.equal(podcastHitsFromSearch(null), null);
    assert.equal(podcastHitsFromSearch({ error: "upstream" }), null);
  });
});

describe("feed stats", () => {
  it("parses clock durations and describes a weekly cadence", () => {
    assert.equal(durationSeconds("1:02:03"), 3723);
    assert.equal(durationSeconds("12:30"), 750);
    const dates = [0, 7, 14, 21].map((days) => new Date(Date.UTC(2026, 0, 22 - days)));
    assert.equal(describeCadence(dates), "About weekly");
  });
});
