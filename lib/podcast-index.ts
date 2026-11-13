// Podcast Index (podcastindex.org), the open podcast directory. The server
// asks it to match a show when Apple's name search would be needed, because
// Apple rate-limits the shared address Spacefast's servers leave from. Server
// only: every request is signed with the API secret.

import type { DirectorySearch } from "./directory";
import { pickDirectoryHit, type DirectoryHit, type MatchOutcome } from "./match";
import type { SafeResponse } from "./net";
import { USER_AGENT } from "./site";
import {
  DirectoryUnavailable,
  fetchWith,
  logUpstream,
  publicFeedUrl,
  responseDetail,
  upstreamError,
  type ResolverDeps,
} from "./upstream";

export type PodcastIndexKeys = { key: string; secret: string };

const API = "https://api.podcastindex.org/api/1.0/";
const TIMEOUT_MS = 6_000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAVAILABLE = "Podcast Index didn't return a readable answer.";

/** Both keys from the environment, or undefined when either is missing. */
export function podcastIndexKeys(env: Record<string, string | undefined> = process.env): PodcastIndexKeys | undefined {
  const key = env.PODCASTINDEX_API_KEY?.trim();
  const secret = env.PODCASTINDEX_API_SECRET?.trim();
  return key && secret ? { key, secret } : undefined;
}

/** The keys a lookup uses: the ones passed in, else the environment's. */
export function keysFor(deps: ResolverDeps): PodcastIndexKeys | undefined {
  return deps.podcastIndex === undefined ? podcastIndexKeys() : deps.podcastIndex ?? undefined;
}

/**
 * The auth headers: the key, the time in whole seconds, and a lower-case hex
 * SHA-1 of key + secret + time. The secret itself is never sent.
 */
export async function signedHeaders(keys: PodcastIndexKeys, nowMs: number): Promise<Record<string, string>> {
  const date = String(Math.floor(nowMs / 1000));
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(keys.key + keys.secret + date));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { "X-Auth-Key": keys.key, "X-Auth-Date": date, Authorization: hash };
}

async function call(path: string, params: Record<string, string>, keys: PodcastIndexKeys, deps: ResolverDeps): Promise<unknown> {
  const url = new URL(path, API);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const endpoint = url.toString();
  let response: SafeResponse;
  try {
    response = await fetchWith(deps)(endpoint, {
      userAgent: USER_AGENT,
      accept: "application/json",
      allowedHosts: ["api.podcastindex.org"],
      timeoutMs: TIMEOUT_MS,
      maxUncompressedBytes: 4_000_000,
      headers: await signedHeaders(keys, (deps.now ?? Date.now)()),
    });
  } catch (err) {
    throw new DirectoryUnavailable(upstreamError(err, UNAVAILABLE, "podcastindex", endpoint).message);
  }
  if (response.status < 200 || response.status >= 300) {
    logUpstream("podcastindex", endpoint, { problem: "status", ...responseDetail(response) });
    throw new DirectoryUnavailable(UNAVAILABLE);
  }
  try {
    return JSON.parse(response.body);
  } catch {
    logUpstream("podcastindex", endpoint, { problem: "not-json", ...responseDetail(response) });
    throw new DirectoryUnavailable(UNAVAILABLE);
  }
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** A live feed with a public address, as a directory hit. Dead feeds and anything else are dropped. */
function feedHit(raw: unknown): DirectoryHit | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const feed = raw as Record<string, unknown>;
  if (feed.dead === 1 || feed.dead === true) return undefined;
  const feedUrl = publicFeedUrl(text(feed.url));
  if (!feedUrl) return undefined;
  return {
    title: text(feed.title),
    author: text(feed.author) ?? text(feed.ownerName),
    feedUrl,
    artwork: text(feed.artwork) ?? text(feed.image),
    itunesId: typeof feed.itunesId === "number" && feed.itunesId > 0 ? feed.itunesId : undefined,
  };
}

/** The feed that declares this podcast GUID, if Podcast Index has it. */
export async function indexByGuid(
  guid: string,
  keys: PodcastIndexKeys,
  deps: ResolverDeps = {}
): Promise<DirectoryHit | undefined> {
  if (!GUID.test(guid)) return undefined;
  const data = await call("podcasts/byguid", { guid }, keys, deps);
  return feedHit(data && typeof data === "object" ? (data as { feed?: unknown }).feed : undefined);
}

/**
 * Match the show by title, with the same rules as the Apple search: an exact
 * title, and a publisher that doesn't conflict. Feeds Apple also lists win,
 * so the answer is the feed Apple and most apps use rather than a mirror or
 * an archive copy. Feeds that share an Apple id are one show.
 */
export async function indexByTitle(
  search: DirectorySearch,
  keys: PodcastIndexKeys,
  deps: ResolverDeps = {}
): Promise<MatchOutcome> {
  const data = await call("search/bytitle", { q: search.title.slice(0, 200), max: "100", similar: "true" }, keys, deps);
  const feeds = data && typeof data === "object" ? (data as { feeds?: unknown }).feeds : undefined;
  const seen = new Set<number>();
  const hits: DirectoryHit[] = [];
  for (const raw of Array.isArray(feeds) ? feeds : []) {
    const hit = feedHit(raw);
    if (!hit) continue;
    if (hit.itunesId) {
      if (seen.has(hit.itunesId)) continue;
      seen.add(hit.itunesId);
    }
    hits.push(hit);
  }
  const listed = pickDirectoryHit(
    hits.filter((hit) => hit.itunesId),
    search.title,
    search.author
  );
  if (listed.status === "match" || listed.status === "ambiguous") return listed;
  return pickDirectoryHit(hits, search.title, search.author);
}
