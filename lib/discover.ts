// Feeds that aren't in a podcast directory: SoundCloud accounts, YouTube
// channels and playlists, and any blog or website. Server only.

import { attr, decodeEntities, looksLikeFeed, metaContent } from "./html";
import { asHttpsUrl, FetchError, type SafeResponse } from "./net";
import { soundcloudRef, youtubeRef } from "./platforms";
import { USER_AGENT } from "./site";
import type { MatchSource, OtherFeed, ResolveResult } from "./types";
import {
  fetchWith,
  logUpstream,
  publicFeedUrl,
  ResolveError,
  responseDetail,
  upstreamError,
  type ResolverDeps,
} from "./upstream";

const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5";
const PAGE_ACCEPT = "text/html, application/xhtml+xml, application/rss+xml, application/atom+xml;q=0.9, */*;q=0.5";

type FeedRead =
  | { ok: true; feedUrl: string; title?: string; items?: number }
  | { ok: false; status?: number };

/** The feed's own title: the first <title>, which RSS and Atom both put before any item. */
export function feedTitle(xml: string): string | undefined {
  const raw = xml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return undefined;
  const text = decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 300) : undefined;
}

/**
 * Fetch a candidate and keep it only when it answers as RSS or Atom. Reports
 * where the feed lives for good: a permanent redirect is followed, a
 * temporary one is not.
 */
async function readFeed(
  candidate: string,
  deps: ResolverDeps,
  options: { timeoutMs?: number; allowedHosts?: readonly string[] } = {}
): Promise<FeedRead> {
  const fetch = fetchWith(deps);
  let response: SafeResponse;
  try {
    response = await fetch(candidate, {
      userAgent: USER_AGENT,
      accept: FEED_ACCEPT,
      timeoutMs: options.timeoutMs ?? 8000,
      maxUncompressedBytes: 200_000,
      allowPartial: true,
      allowedHosts: options.allowedHosts,
    });
  } catch {
    return { ok: false };
  }
  if (response.status < 200 || response.status >= 300) return { ok: false, status: response.status };
  if (!looksLikeFeed(String(response.headers["content-type"] ?? ""), response.body)) {
    return { ok: false, status: response.status };
  }
  const feedUrl = publicFeedUrl(response.permanentUrl ?? candidate);
  if (!feedUrl) return { ok: false };
  const items = (response.body.match(/<(?:item|entry)[\s>]/gi) ?? []).length;
  return { ok: true, feedUrl, title: feedTitle(response.body), items: response.truncated ? undefined : items };
}

/** A fetch failure that names the address itself (private, malformed) is shown as is. */
function pageError(err: unknown, fallback: string, stage: string, url: string): ResolveError {
  if (err instanceof FetchError && (err.code === "blocked" || err.code === "invalid-url")) {
    return new ResolveError(err.message);
  }
  return upstreamError(err, fallback, stage, url);
}

function jsonString(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(`"${raw}"`) as unknown;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

// YouTube ---------------------------------------------------------------

const YOUTUBE_FEED = "https://www.youtube.com/feeds/videos.xml";
const YOUTUBE_PAGE_HOSTS = ["www.youtube.com", "youtube.com", "m.youtube.com"] as const;
const CHANNEL_ID = /UC[\w-]{22}/;

export type YouTubePage = { channelId?: string; title?: string; artwork?: string };

/** The channel a YouTube page belongs to. Channel pages and video pages say it differently. */
export function readYouTubePage(html: string, isVideo: boolean): YouTubePage {
  if (isVideo) {
    // The player response comes first and describes this video. Later
    // channel ids belong to recommendations, so only videoDetails is read.
    const details = html.match(/"videoDetails":\{[\s\S]{0,8000}?"channelId":"(UC[\w-]{22})"[\s\S]{0,8000}?"author":"((?:[^"\\]|\\.)*)"/);
    return { channelId: details?.[1], title: jsonString(details?.[2]) };
  }
  const channelId =
    html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/)?.[1] ??
    html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/)?.[1] ??
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1];
  return {
    channelId,
    title: metaContent(html, "og:title"),
    artwork: asHttpsUrl(metaContent(html, "og:image")),
  };
}

export async function resolveYouTube(url: URL, deps: ResolverDeps): Promise<ResolveResult> {
  const ref = youtubeRef(url);
  if (!ref) throw new ResolveError("Use a YouTube channel, handle (@name), playlist, or video link.");

  if (ref.kind === "playlist") {
    const feedUrl = `${YOUTUBE_FEED}?playlist_id=${encodeURIComponent(ref.id)}`;
    const feed = await readFeed(feedUrl, deps, { allowedHosts: YOUTUBE_PAGE_HOSTS });
    if (!feed.ok && feed.status === 404) {
      throw new ResolveError("YouTube has no public feed for that playlist. Check that the playlist is public.");
    }
    return { feedUrl, title: feed.ok ? feed.title : undefined, platform: "youtube", matchedBy: "youtube-playlist" };
  }

  let page: YouTubePage = {};
  if (ref.kind === "channel") {
    page = { channelId: ref.id };
  } else {
    const fetch = fetchWith(deps);
    let response: SafeResponse;
    try {
      response = await fetch(ref.url, {
        userAgent: USER_AGENT,
        accept: "text/html",
        allowedHosts: YOUTUBE_PAGE_HOSTS,
        // Declines the cookie banner YouTube shows to some regions, so the
        // page itself comes back rather than a consent redirect.
        headers: { "accept-language": "en", cookie: "SOCS=CAI" },
        timeoutMs: 10_000,
        // Channel pages put the feed link about 850 KB in.
        maxUncompressedBytes: 1_500_000,
        allowPartial: true,
      });
    } catch (err) {
      throw upstreamError(err, "YouTube didn't respond for that link. Try again in a moment.", "youtube-page", ref.url);
    }
    if (response.status === 404) throw new ResolveError("YouTube has no page at that address.");
    if (response.status < 200 || response.status >= 300) {
      logUpstream("youtube-page", ref.url, { problem: "status", ...responseDetail(response) });
      throw new ResolveError("YouTube didn't return that page. Try again in a moment.");
    }
    page = readYouTubePage(response.body, ref.url.includes("/watch?"));
    if (!page.channelId) {
      logUpstream("youtube-page", ref.url, { problem: "no-channel-id", ...responseDetail(response) });
      throw new ResolveError("Couldn't find the channel on that YouTube page.");
    }
  }

  const channelId = page.channelId!;
  if (!CHANNEL_ID.test(channelId)) throw new ResolveError("That isn't a YouTube channel id.");
  const feedUrl = `${YOUTUBE_FEED}?channel_id=${channelId}`;
  const feed = await readFeed(feedUrl, deps, { allowedHosts: YOUTUBE_PAGE_HOSTS });
  if (!feed.ok && feed.status === 404) throw new ResolveError("YouTube has no feed for that channel.");
  return {
    feedUrl,
    title: page.title ?? (feed.ok ? feed.title : undefined),
    artwork: page.artwork,
    platform: "youtube",
    matchedBy: "youtube-channel",
  };
}

// SoundCloud ------------------------------------------------------------

const SOUNDCLOUD_HOSTS = ["soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"] as const;

function soundcloudFeed(userId: string): string {
  return `https://feeds.soundcloud.com/users/soundcloud:users:${userId}/sounds.rss`;
}

const SOUNDCLOUD_EMPTY =
  "The feed is empty. SoundCloud includes only the tracks a creator adds to RSS, under Settings, then Content.";

export async function resolveSoundCloud(url: URL, deps: ResolverDeps): Promise<ResolveResult> {
  let ref = soundcloudRef(url);
  if (!ref) throw new ResolveError("Use a SoundCloud profile or track link.");
  const fetch = fetchWith(deps);

  if (ref.kind === "feed") {
    const feed = await readFeed(soundcloudFeed(ref.userId), deps);
    if (!feed.ok) throw new ResolveError("SoundCloud didn't return that feed.");
    return {
      feedUrl: feed.feedUrl,
      title: feed.title,
      platform: "soundcloud",
      matchedBy: "direct",
      note: feed.items === 0 ? SOUNDCLOUD_EMPTY : undefined,
    };
  }

  if (ref.kind === "short") {
    let response: SafeResponse;
    try {
      response = await fetch(ref.url, {
        userAgent: USER_AGENT,
        accept: "text/html",
        allowedHosts: SOUNDCLOUD_HOSTS,
        timeoutMs: 8000,
        maxUncompressedBytes: 100_000,
        allowPartial: true,
        haltWhen: (next) => next.hostname !== "on.soundcloud.com",
      });
    } catch (err) {
      throw upstreamError(err, "SoundCloud didn't respond for that link. Try again in a moment.", "soundcloud-short", ref.url);
    }
    ref = soundcloudRef(new URL(response.url));
    if (!ref || ref.kind !== "user") throw new ResolveError("That SoundCloud short link doesn't lead to a profile or a track.");
  }

  const profile = `https://soundcloud.com/${ref.username}`;
  let response: SafeResponse;
  try {
    response = await fetch(profile, {
      userAgent: USER_AGENT,
      accept: "text/html",
      allowedHosts: SOUNDCLOUD_HOSTS,
      timeoutMs: 8000,
      // The user id is in the head, a few KB in.
      maxUncompressedBytes: 200_000,
      allowPartial: true,
    });
  } catch (err) {
    throw upstreamError(err, "SoundCloud didn't respond for that profile. Try again in a moment.", "soundcloud-profile", profile);
  }
  if (response.status === 404) throw new ResolveError("SoundCloud has no profile at that address.");
  if (response.status < 200 || response.status >= 300) {
    logUpstream("soundcloud-profile", profile, { problem: "status", ...responseDetail(response) });
    throw new ResolveError("SoundCloud didn't return that profile. Try again in a moment.");
  }
  const userId = response.body.match(/soundcloud:\/\/users:(\d{1,15})/)?.[1];
  if (!userId) {
    logUpstream("soundcloud-profile", profile, { problem: "no-user-id", ...responseDetail(response) });
    throw new ResolveError("Couldn't find the account id on that SoundCloud profile.");
  }

  const feed = await readFeed(soundcloudFeed(userId), deps);
  if (!feed.ok) {
    throw new ResolveError("SoundCloud didn't return an RSS feed for that account.");
  }
  return {
    feedUrl: feed.feedUrl,
    title: metaContent(response.body, "og:title") ?? feed.title,
    artwork: asHttpsUrl(metaContent(response.body, "og:image")),
    platform: "soundcloud",
    matchedBy: "soundcloud-profile",
    note: feed.items === 0 ? SOUNDCLOUD_EMPTY : undefined,
  };
}

// Websites --------------------------------------------------------------

const FEED_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/rdf+xml",
  "application/xml",
  "text/xml",
]);

/** Feeds a page lists with <link rel="alternate">, in page order, comment feeds last. */
export function alternateFeeds(html: string, pageUrl: string): OtherFeed[] {
  const baseHref = html.match(/<base\b[^>]*>/i)?.[0];
  let base = pageUrl;
  if (baseHref) {
    const href = attr(baseHref, "href");
    if (href) {
      try {
        base = new URL(decodeEntities(href), pageUrl).toString();
      } catch {
        base = pageUrl;
      }
    }
  }

  const found: OtherFeed[] = [];
  const seen = new Set<string>();
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const type = (attr(tag, "type") ?? "").toLowerCase().split(";")[0].trim();
    const href = attr(tag, "href");
    if (!rel.includes("alternate") || !FEED_TYPES.has(type) || !href) continue;
    let resolved: string | undefined;
    try {
      resolved = publicFeedUrl(new URL(decodeEntities(href).trim(), base).toString());
    } catch {
      resolved = undefined;
    }
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    const title = attr(tag, "title");
    found.push({ url: resolved, title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() || undefined : undefined });
    if (found.length >= 12) break;
  }
  const isComments = (feed: OtherFeed) => /comment/i.test(`${feed.title ?? ""} ${feed.url}`);
  return [...found.filter((feed) => !isComments(feed)), ...found.filter(isComments)];
}

function pageTitle(html: string): string | undefined {
  const fromMeta = metaContent(html, "og:site_name") ?? metaContent(html, "og:title");
  if (fromMeta) return fromMeta.slice(0, 300);
  const raw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const text = raw ? decodeEntities(raw).replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, 300) : undefined;
}

function pageIcon(html: string, pageUrl: string): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !rel.split(/\s+/).includes("apple-touch-icon")) continue;
    try {
      return asHttpsUrl(new URL(decodeEntities(href), pageUrl).toString());
    } catch {
      continue;
    }
  }
  return asHttpsUrl(metaContent(html, "og:image"));
}

/** Hosts whose feed address follows a pattern, for pages that don't list it. */
export function knownFeedUrls(url: URL): string[] {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const origin = url.origin;
  if (host.endsWith(".substack.com")) return [`${origin}/feed`];
  if (host === "medium.com") {
    if (parts[0]) return [`https://medium.com/feed/${parts[0]}`];
    return [];
  }
  if (host.endsWith(".medium.com")) return [`${origin}/feed`];
  if (host.endsWith(".tumblr.com")) return [`${origin}/rss`];
  if (host.endsWith(".blogspot.com")) return [`${origin}/feeds/posts/default`];
  if (host.endsWith(".wordpress.com")) return [`${origin}/feed/`];
  if (host.endsWith(".ghost.io")) return [`${origin}/rss/`];
  if (host === "reddit.com" || host === "old.reddit.com") {
    if ((parts[0] === "r" || parts[0] === "user" || parts[0] === "u") && parts[1]) {
      return [`https://www.reddit.com/${parts[0]}/${parts[1]}/.rss`];
    }
    return [];
  }
  if (host === "github.com" && parts.length >= 2) {
    return [`https://github.com/${parts[0]}/${parts[1]}/releases.atom`];
  }
  return [];
}

/** Where sites usually put a feed, under the page's own path first, then at the root. */
export function commonFeedUrls(url: URL): string[] {
  const out: string[] = [];
  const add = (path: string) => {
    const next = new URL(path, url.origin).toString();
    if (!out.includes(next)) out.push(next);
  };
  const dir = url.pathname.replace(/\/+$/, "");
  if (dir && dir !== "/" && dir.split("/").length <= 3) {
    for (const leaf of ["feed", "rss", "feed.xml", "rss.xml"]) add(`${dir}/${leaf}`);
  }
  for (const path of ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/feed/", "/?feed=rss2"]) add(path);
  return out.slice(0, 12);
}

/** The first candidate, in the given order, that answers as a feed. All are asked at once. */
async function firstFeed(candidates: string[], deps: ResolverDeps): Promise<{ ok: true; feedUrl: string; title?: string; items?: number } | undefined> {
  const reads = await Promise.all(candidates.map((candidate) => readFeed(candidate, deps, { timeoutMs: 6000 })));
  for (const read of reads) if (read.ok) return read;
  return undefined;
}

export async function discoverWebsite(url: URL, deps: ResolverDeps): Promise<ResolveResult> {
  const fetch = fetchWith(deps);
  const pageUrl = url.toString();
  let response: SafeResponse;
  try {
    response = await fetch(pageUrl, {
      userAgent: USER_AGENT,
      accept: PAGE_ACCEPT,
      timeoutMs: 10_000,
      // <link> tags are in the head. A cut-off page still has them.
      maxUncompressedBytes: 600_000,
      allowPartial: true,
    });
  } catch (err) {
    throw pageError(err, "That site didn't respond. Check the address, or try again in a moment.", "website", pageUrl);
  }

  const ok = response.status >= 200 && response.status < 300;
  const finalUrl = response.url;
  const contentType = String(response.headers["content-type"] ?? "");

  // The link may already be the feed.
  if (ok && looksLikeFeed(contentType, response.body)) {
    const feedUrl = publicFeedUrl(response.permanentUrl ?? pageUrl);
    if (feedUrl) {
      return { feedUrl, title: feedTitle(response.body), platform: "website", matchedBy: "direct" };
    }
  }
  if (response.status === 404 || response.status === 410) {
    throw new ResolveError("That page wasn't found. Check the address.");
  }

  const html = ok ? response.body : "";
  const title = html ? pageTitle(html) : undefined;
  const artwork = html ? pageIcon(html, finalUrl) : undefined;
  const result = (feedUrl: string, matchedBy: MatchSource, feedName?: string, otherFeeds?: OtherFeed[]): ResolveResult => ({
    feedUrl,
    title: title ?? feedName,
    artwork,
    platform: "website",
    matchedBy,
    otherFeeds: otherFeeds?.length ? otherFeeds : undefined,
  });

  const declared = html ? alternateFeeds(html, finalUrl) : [];
  if (declared.length) {
    // The page names its feeds. The first one that answers is the main one.
    // When none answer from here, the page's first is still the best answer.
    const reads = await Promise.all(declared.slice(0, 3).map((feed) => readFeed(feed.url, deps, { timeoutMs: 6000 })));
    const index = reads.findIndex((read) => read.ok);
    const main = index >= 0 ? reads[index] : undefined;
    const mainUrl = main?.ok ? main.feedUrl : declared[0].url;
    const others = declared.filter((feed, i) => i !== (index >= 0 ? index : 0) && feed.url !== mainUrl);
    return result(mainUrl, "page-link", main?.ok ? main.title : declared[0].title, others);
  }

  const finalParsed = new URL(finalUrl);
  const known = knownFeedUrls(finalParsed);
  if (known.length) {
    const hit = await firstFeed(known, deps);
    if (hit) return result(hit.feedUrl, "known-pattern", hit.title);
  }

  const hit = await firstFeed(commonFeedUrls(finalParsed), deps);
  if (hit) return result(hit.feedUrl, "common-path", hit.title);

  if (!ok) {
    logUpstream("website", pageUrl, { problem: "status", ...responseDetail(response) });
    throw new ResolveError(
      `That site answered with HTTP ${response.status} and no feed was found at the usual addresses.`
    );
  }
  throw new ResolveError(
    "No RSS or Atom feed found. The page doesn't list one, and none answered at the usual addresses such as /feed and /rss.xml."
  );
}
