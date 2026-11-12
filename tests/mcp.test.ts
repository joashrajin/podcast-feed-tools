import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SafeFetchOptions, SafeResponse } from "../lib/net";
import { errorResult, handleBody, handleMessage, PROTOCOL_VERSIONS, type Context, type ToolResult } from "../lib/mcp/server";
import { INSTRUCTIONS, tools } from "../lib/mcp/tools";

const UUID = "4eb5b260-c933-0134-10da-25324e2a541d";
const FEED = "https://feeds.example.com/show.xml";

const feedXml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Example Show</title>
    <description>About things</description>
    <language>en</language>
    <itunes:explicit>false</itunes:explicit>
    <item>
      <title>Two</title><guid>ep-2</guid><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/2.mp3" type="audio/mpeg" length="2000"/>
      <itunes:duration>1500</itunes:duration><itunes:episode>2</itunes:episode>
    </item>
    <item>
      <title>Three</title><guid>ep-3</guid><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/3.mp3" type="audio/mpeg" length="3000"/>
    </item>
    <item>
      <title>One</title><guid>ep-2</guid><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

const catalog = {
  episode_count: 3,
  episode_frequency: "Weekly",
  estimated_next_episode_at: "2026-11-17T10:00:00Z",
  has_more_episodes: false,
  podcast: {
    uuid: UUID,
    title: "Example Show",
    author: "Example Co",
    url: "https://example.com/",
    is_private: false,
    show_type: "episodic",
    category: "News\n  Daily News",
    explicit: false,
    episodes: [
      { uuid: "e1", title: "One", published: "2026-10-27T10:00:00Z", url: "https://cdn.example.com/1.mp3", duration: 1200, file_type: "audio/mpeg", file_size: 1000, type: "full" },
      { uuid: "e2", title: "Two", published: "2026-11-03T10:00:00Z", url: "https://cdn.example.com/2.mp3", duration: 1500, file_type: "audio/mpeg", file_size: 2000, type: "full" },
      { uuid: "e0", title: "Pilot", published: "2026-10-01T10:00:00Z", url: "https://cdn.example.com/0.mp3", duration: 600, file_type: "audio/mpeg", file_size: 500, type: "trailer" },
    ],
  },
};

const reply = (url: string, status: number, body: string, type = "application/json"): SafeResponse => ({
  url,
  status,
  headers: { "content-type": type },
  body,
});

type Route = (url: string, options: SafeFetchOptions) => SafeResponse | undefined;

function stubFetch(...routes: Route[]) {
  const calls: string[] = [];
  const fetch = async (url: string, options: SafeFetchOptions) => {
    calls.push(url);
    for (const route of routes) {
      const hit = route(url, options);
      if (hit) return hit;
    }
    return reply(url, 404, "not found", "text/plain");
  };
  return { fetch, calls };
}

const defaults: Route[] = [
  (url) => (url === FEED ? reply(url, 200, feedXml, "application/rss+xml") : undefined),
  (url) => (url.endsWith(`/podcast/full/${UUID}`) ? reply(url, 200, JSON.stringify(catalog)) : undefined),
  (url) => (url === "https://example.com/" ? reply(url, 200, "<html><head></head></html>", "text/html") : undefined),
];

function context(routes: Route[] = defaults, extra: Partial<Context> = {}): Context {
  return {
    info: { name: "podcast-tools", title: "Test", version: "1.0.0", instructions: INSTRUCTIONS },
    tools: tools({ fetch: stubFetch(...routes).fetch }),
    ...extra,
  };
}

async function call(name: string, args: Record<string, unknown>, ctx = context()): Promise<ToolResult> {
  const response = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx);
  assert.ok(response && "result" in response, JSON.stringify(response));
  return response.result as ToolResult;
}

function data(result: ToolResult): Record<string, unknown> {
  assert.equal(result.isError, undefined, result.content[0]?.text);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent!;
}

describe("mcp: protocol", () => {
  it("initializes with the client's version when supported, else the newest", async () => {
    const known = await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      context()
    );
    assert.ok(known && "result" in known);
    const result = known.result as Record<string, unknown>;
    assert.equal(result.protocolVersion, "2025-06-18");
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.equal((result.serverInfo as { name: string }).name, "podcast-tools");
    assert.match(String(result.instructions), /compare_feed_with_pocket_casts/);

    const unknown = await handleMessage({ jsonrpc: "2.0", id: "a", method: "initialize", params: { protocolVersion: "1999-01-01" } }, context());
    assert.ok(unknown && "result" in unknown);
    assert.equal((unknown.result as { protocolVersion: string }).protocolVersion, PROTOCOL_VERSIONS[0]);
    assert.equal(unknown.id, "a");
  });

  it("answers notifications and client responses with 202 and no body", async () => {
    assert.deepEqual(await handleBody({ jsonrpc: "2.0", method: "notifications/initialized" }, context()), { status: 202 });
    assert.deepEqual(await handleBody({ jsonrpc: "2.0", id: 9, result: {} }, context()), { status: 202 });
  });

  it("lists six read-only tools with object schemas", async () => {
    const response = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, context());
    assert.ok(response && "result" in response);
    const list = (response.result as {
      tools: Array<{ name: string; description: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }>;
    }).tools;
    assert.deepEqual(
      list.map((tool) => tool.name),
      ["search_pocket_casts", "get_pocket_casts_show", "find_feed_url", "check_feed", "list_feed_episodes", "compare_feed_with_pocket_casts"]
    );
    for (const tool of list) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.ok(tool.description.length > 40);
    }
  });

  it("reports bad requests as JSON-RPC errors", async () => {
    const ping = await handleMessage({ jsonrpc: "2.0", id: 3, method: "ping" }, context());
    assert.deepEqual(ping, { jsonrpc: "2.0", id: 3, result: {} });
    const missing = await handleMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" }, context());
    assert.ok(missing && "error" in missing && missing.error.code === -32601);
    const badTool = await handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }, context());
    assert.ok(badTool && "error" in badTool && badTool.error.code === -32602);
    const badVersion = await handleMessage({ jsonrpc: "1.0", id: 6, method: "ping" }, context());
    assert.ok(badVersion && "error" in badVersion && badVersion.error.code === -32600);
    const badArgs = await handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "check_feed", arguments: [] } }, context());
    assert.ok(badArgs && "error" in badArgs && badArgs.error.code === -32602);
  });

  it("answers a batch with an array, leaving out notifications", async () => {
    const out = await handleBody(
      [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ],
      context()
    );
    assert.equal(out.status, 200);
    assert.deepEqual((out.json as Array<{ id: number }>).map((r) => r.id), [1, 2]);
    assert.equal((await handleBody([], context())).status, 400);
  });

  it("lets a rate limit answer instead of the tool", async () => {
    const result = await call("check_feed", { feed_url: FEED }, context(defaults, { beforeToolCall: () => errorResult("Slow down.") }));
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, "Slow down.");
  });
});

describe("mcp: tools", () => {
  it("search_pocket_casts maps directory results", async () => {
    const ctx = context([
      (url, options) =>
        url === "https://podcast-api.pocketcasts.com/v2/search/combined" && options.method === "POST"
          ? reply(url, 200, JSON.stringify({ results: [{ type: "podcast", uuid: UUID, title: "Example Show", author: "Example Co", slug: "example-show" }, { type: "episode", uuid: "x", title: "Ep" }] }))
          : undefined,
    ]);
    const out = data(await call("search_pocket_casts", { query: "example" }, ctx));
    assert.deepEqual(out.shows, [
      { uuid: UUID, title: "Example Show", author: "Example Co", pocketCastsUrl: `https://pocketcasts.com/podcast/example-show/${UUID}` },
    ]);
  });

  it("get_pocket_casts_show reports the catalog, newest episode first", async () => {
    const out = data(await call("get_pocket_casts_show", { show: `https://pocketcasts.com/podcast/example-show/${UUID}`, episodes: 2 }));
    assert.equal(out.title, "Example Show");
    assert.equal(out.episodeCount, 3);
    assert.equal(out.episodeFrequency, "Weekly");
    assert.equal(out.newestEpisodeAt, "2026-11-03T10:00:00.000Z");
    assert.deepEqual(out.categories, ["News", "Daily News"]);
    const episodes = out.episodes as Array<Record<string, unknown>>;
    assert.deepEqual(episodes.map((e) => e.title), ["Two", "One"]);
    assert.equal(episodes[0].duration, "25m");
    assert.equal("fileUrl" in episodes[0], false);
  });

  it("get_pocket_casts_show accepts a bare UUID and refuses other links", async () => {
    assert.equal(data(await call("get_pocket_casts_show", { show: UUID.toUpperCase(), episodes: 0 })).uuid, UUID);
    const wrong = await call("get_pocket_casts_show", { show: "https://open.spotify.com/show/abc" });
    assert.equal(wrong.isError, true);
    const empty = await call("get_pocket_casts_show", {});
    assert.equal(empty.isError, true);
    assert.equal(empty.content[0].text, "show is required.");
  });

  it("list_feed_episodes sorts newest first, flags duplicate GUIDs, and filters", async () => {
    const out = data(await call("list_feed_episodes", { feed_url: FEED }));
    assert.equal(out.episodeCount, 3);
    const episodes = out.episodes as Array<Record<string, unknown>>;
    assert.deepEqual(episodes.map((e) => e.title), ["Three", "Two", "One"]);
    assert.equal(episodes[1].duplicateGuid, true);
    assert.equal(episodes[0].duplicateGuid, undefined);
    assert.equal(episodes[1].fileBytes, 2000);
    assert.equal(episodes[1].episode, "2");

    const filtered = data(await call("list_feed_episodes", { feed_url: FEED, title_contains: "TW" }));
    assert.equal(filtered.matching, 1);
    const paged = data(await call("list_feed_episodes", { feed_url: FEED, offset: 1, limit: 1 }));
    assert.deepEqual((paged.episodes as Array<{ title: string }>).map((e) => e.title), ["Two"]);
  });

  it("check_feed summarizes the show and lists problems", async () => {
    const out = data(await call("check_feed", { feed_url: FEED }));
    assert.equal(out.title, "Example Show");
    assert.equal(out.episodeCount, 3);
    const problems = out.problems as Array<{ title: string }>;
    assert.ok(problems.some((p) => /duplicate GUID/.test(p.title)));
    assert.ok((out.passed as string[]).includes("Feed is reachable"));
  });

  it("check_feed explains a feed that needs a login", async () => {
    const ctx = context([(url) => reply(url, 401, "", "text/plain")]);
    const out = await call("check_feed", { feed_url: "https://members.example.com/feed" }, ctx);
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /username and password/);
  });

  it("compare_feed_with_pocket_casts finds the episode Pocket Casts hasn't picked up", async () => {
    const out = data(await call("compare_feed_with_pocket_casts", { show: UUID, feed_url: FEED }));
    assert.equal(out.feedSource, "given");
    const missing = out.missingFromPocketCasts as { count: number; episodes: Array<{ title: string }> };
    assert.equal(missing.count, 1);
    assert.equal(missing.episodes[0].title, "Three");
    const gone = out.inPocketCastsNotInFeed as { count: number; episodes: Array<{ title: string }> };
    assert.deepEqual(gone.episodes.map((e) => e.title), ["Pilot"]);
    const findings = out.findings as string[];
    assert.match(findings[0], /hasn't picked up the 1 newest/);
    assert.match(findings.join(" "), /no longer in the feed/);
    assert.ok((out.feedProblems as unknown[]).length > 0);
  });

  it("compare_feed_with_pocket_casts asks for the feed when it can't be worked out", async () => {
    const ctx = context([
      ...defaults,
      (url) => (url.startsWith("https://itunes.apple.com/search") ? reply(url, 429, "Rate limit exceeded", "text/plain") : undefined),
    ]);
    const out = await call("compare_feed_with_pocket_casts", { show: UUID }, ctx);
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /Pass feed_url/);
  });

  it("compare_feed_with_pocket_casts finds the feed through Apple when it can", async () => {
    const ctx = context([
      ...defaults,
      (url) =>
        url.startsWith("https://itunes.apple.com/search")
          ? reply(url, 200, JSON.stringify({ resultCount: 1, results: [{ collectionName: "Example Show", artistName: "Example Co", feedUrl: FEED, collectionId: 1 }] }))
          : undefined,
    ]);
    const out = data(await call("compare_feed_with_pocket_casts", { show: UUID }, ctx));
    assert.equal(out.feedSource, "apple-search");
    assert.equal(out.feedUrl, FEED);
  });
});
