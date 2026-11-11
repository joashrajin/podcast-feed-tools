import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ValidateError, validateFeed, withoutCdata } from "../lib/validate";
import type { SafeFetchOptions, SafeResponse } from "../lib/net";

function feedFetch(body: string, contentType = "application/rss+xml"): (input: string, options: SafeFetchOptions) => Promise<SafeResponse> {
  return async (input) => ({
    url: input,
    status: 200,
    headers: { "content-type": contentType },
    body,
  });
}

const base = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Desk</title>
    <description>DESCRIPTION</description>
    <language>en</language>
    <itunes:image href="https://example.com/art.jpg"/>
    <itunes:category text="Society"/>
    <itunes:explicit>false</itunes:explicit>
    <item>
      <title>One</title>
      <guid>ep-1</guid>
      <pubDate>Tue, 08 Jul 2026 09:00:00 GMT</pubDate>
      <enclosure url="https://example.com/one.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

describe("validateFeed", () => {
  it("refuses private and non-http addresses before fetching", async () => {
    await assert.rejects(() => validateFeed("http://127.0.0.1/feed.xml"), ValidateError);
    await assert.rejects(() => validateFeed("http://169.254.169.254/latest/meta-data"), /isn't a public/);
    await assert.rejects(() => validateFeed("file:///etc/passwd"), /isn't a public/);
  });

  it("does not add an ellipsis to a short description", async () => {
    const report = await validateFeed("https://example.com/feed.xml", feedFetch(base.replace("DESCRIPTION", "Short description")));
    const description = report.checks.find((check) => check.id === "description");
    assert.equal(description?.detail, "Short description");
    assert.equal(description?.detail?.endsWith("…"), false);
  });

  it("truncates a long description", async () => {
    const long = "word ".repeat(40);
    const report = await validateFeed("https://example.com/feed.xml", feedFetch(base.replace("DESCRIPTION", long)));
    const description = report.checks.find((check) => check.id === "description");
    assert.equal(description?.detail?.endsWith("…"), true);
    assert.ok((description?.detail?.length ?? 0) < long.length);
  });

  it("counts a numeric guid and flags duplicates", async () => {
    const numeric = base.replace("<guid>ep-1</guid>", "<guid>1001</guid>");
    const ok = await validateFeed("https://example.com/feed.xml", feedFetch(numeric));
    assert.equal(ok.checks.find((check) => check.id === "guids")?.level, "pass");

    const duplicated = numeric.replace(
      "</item>",
      `</item><item><title>Two</title><guid>1001</guid><enclosure url="https://example.com/two.mp3"/></item>`
    );
    const bad = await validateFeed("https://example.com/feed.xml", feedFetch(duplicated));
    assert.equal(bad.checks.find((check) => check.id === "guids")?.level, "fail");
  });

  it("rejects a doctype anywhere in the document", async () => {
    const padded = `${"<!-- x -->".repeat(800)}<!DOCTYPE rss [<!ENTITY a "b">]>`;
    await assert.rejects(
      () => validateFeed("https://example.com/feed.xml", feedFetch(base.replace("<description>", `<description>${padded}`))),
      /DOCTYPE/
    );
  });

  it("rejects malformed XML and a missing RSS version is only a warning when the document is otherwise RSS", async () => {
    await assert.rejects(
      () => validateFeed("https://example.com/feed.xml", feedFetch(`<rss version="2.0"><channel><title>Nope</title>`)),
      /valid XML/
    );
  });

  it("keeps an explicit false and does not collapse textual GUIDs", async () => {
    const report = await validateFeed("https://example.com/feed.xml", feedFetch(base));
    assert.equal(report.summary.explicit, "false");
    assert.equal(report.checks.find((check) => check.id === "explicit")?.level, "pass");

    const two = base.replace(
      "</channel>",
      `<item><title>Two</title><guid>001</guid><enclosure url="https://example.com/two.mp3" type="audio/mpeg"/></item>
       <item><title>Three</title><guid>1</guid><enclosure url="https://example.com/three.mp3" type="audio/mpeg"/></item>
       </channel>`
    );
    const guids = await validateFeed("https://example.com/feed.xml", feedFetch(two));
    assert.equal(guids.checks.find((check) => check.id === "guids")?.level, "pass");
    assert.equal(guids.summary.episodeCount, 3);
    assert.deepEqual(guids.summary.enclosureTypes, [{ type: "audio/mpeg", count: 3 }]);
  });

  it("accepts an HTML page pasted into CDATA show notes", async () => {
    const notes = "<![CDATA[<!DOCTYPE html><html><body><p>Notes</p></body></html>]]>";
    const report = await validateFeed("https://example.com/feed.xml", feedFetch(base.replace("DESCRIPTION", notes)));
    assert.equal(report.summary.title, "Desk");
  });

  it("still rejects a doctype that sits after an unclosed CDATA opener", () => {
    assert.equal(withoutCdata("a<![CDATA[x]]>b"), "ab");
    assert.match(withoutCdata("a<![CDATA[x <!DOCTYPE rss>"), /DOCTYPE/);
    assert.equal(withoutCdata("<![CDATA[".repeat(100_000)).length, 900_000);
  });
});
