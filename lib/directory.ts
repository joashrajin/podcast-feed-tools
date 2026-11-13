// Matching a show against Apple Podcasts. No Node imports: the server uses
// this, and so does the browser, which runs the lookup and the name search
// itself because Apple rate-limits the shared address the host's servers
// leave from.

import { candidateLabel, pickDirectoryHit, type DirectoryHit } from "./match";
import { appleShowId } from "./platforms";
import type { MatchSource, Platform, ResolveResult } from "./types";
import { asHttpsUrl, asHttpUrl } from "./url";

/** A show known by name, still to be matched in Apple Podcasts. */
export type DirectorySearch = {
  title: string;
  author?: string;
  platform: Platform;
  /** Artwork from the source platform, used when Apple has none. */
  artwork?: string;
  /** The feed's podcast:guid, when Pocket Casts has it. Lets Podcast Index skip the name match. */
  podcastGuid?: string;
};

export type DirectoryOutcome = { ok: true; result: ResolveResult } | { ok: false; error: string };

/** Returns the feed address to report, or undefined to refuse it. */
export type FeedUrlCheck = (raw: string | undefined) => string | undefined;

/** Apple answered with a non-success status or a body that isn't JSON. */
export const APPLE_TRY_AGAIN =
  "Apple's directory didn't return a readable answer. Try again in a moment.";

export const APPLE_NO_FEED =
  "Apple Podcasts didn't return an RSS feed for that id. The show may not have a public feed.";

const APPLE_BROWSER_UNREACHABLE =
  "Couldn't reach Apple's directory from this browser. Check that nothing is blocking itunes.apple.com, then try again.";

export function itunesSearchUrl(title: string): string {
  const endpoint = new URL("https://itunes.apple.com/search");
  endpoint.searchParams.set("media", "podcast");
  endpoint.searchParams.set("entity", "podcast");
  endpoint.searchParams.set("limit", "50");
  endpoint.searchParams.set("term", title.slice(0, 200));
  return endpoint.toString();
}

export function itunesLookupUrl(id: string): string {
  const endpoint = new URL("https://itunes.apple.com/lookup");
  endpoint.searchParams.set("id", id);
  endpoint.searchParams.set("entity", "podcast");
  return endpoint.toString();
}

/** What the browser extracted from an Apple lookup, before the server checks it. */
export type AppleLookupClaim = {
  feedUrl: string;
  title?: string;
  author?: string;
  artwork?: string;
  itunesId?: number;
};

export type BrowserLookup =
  | { ok: true; claim: AppleLookupClaim }
  | { ok: false; reason: "empty" | "failed"; error: string };

export function mapItunes(entry: unknown): DirectoryHit {
  if (!entry || typeof entry !== "object") return {};
  const record = entry as Record<string, unknown>;
  return {
    title: typeof record.collectionName === "string" ? record.collectionName : undefined,
    author: typeof record.artistName === "string" ? record.artistName : undefined,
    feedUrl: typeof record.feedUrl === "string" ? record.feedUrl : undefined,
    artwork: typeof record.artworkUrl600 === "string" ? record.artworkUrl600 : undefined,
    itunesId: typeof record.collectionId === "number" ? record.collectionId : undefined,
  };
}

/** The hits in an Apple search or lookup response. Anything unexpected is no hits. */
export function itunesHits(data: unknown): DirectoryHit[] {
  const results = data && typeof data === "object" ? (data as { results?: unknown }).results : undefined;
  return Array.isArray(results) ? results.map(mapItunes) : [];
}

export function resultFromHit(
  hit: DirectoryHit,
  matchedBy: MatchSource,
  platform: Platform,
  acceptFeedUrl: FeedUrlCheck
): DirectoryOutcome {
  const feedUrl = acceptFeedUrl(hit.feedUrl);
  if (!feedUrl) {
    return { ok: false, error: "The directory returned a feed address that isn't a public URL." };
  }
  return {
    ok: true,
    result: {
      feedUrl,
      title: hit.title,
      author: hit.author,
      artwork: asHttpsUrl(hit.artwork),
      itunesId: hit.itunesId,
      platform,
      matchedBy,
    },
  };
}

/** Match a search response to the show. Every outcome that isn't a match explains itself. */
export function matchSearchResults(
  data: unknown,
  search: DirectorySearch,
  acceptFeedUrl: FeedUrlCheck
): DirectoryOutcome {
  const { title, author, platform } = search;
  const outcome = pickDirectoryHit(itunesHits(data), title, author);

  if (outcome.status === "match") {
    const found = resultFromHit(outcome.hit, "itunes-search", platform, acceptFeedUrl);
    if (!found.ok) return found;
    const result = found.result;
    return {
      ok: true,
      result: {
        ...result,
        title: result.title ?? title,
        author: result.author ?? author,
        artwork: result.artwork ?? search.artwork,
      },
    };
  }
  if (outcome.status === "conflict") {
    const listed = candidateLabel(outcome.hit);
    return {
      ok: false,
      error: `The publisher does not match. Apple Podcasts has "${listed}", not "${title}" by ${author ?? "the supplied publisher"}. Paste the Apple Podcasts link if that is the show you want.`,
    };
  }
  if (outcome.status === "ambiguous") {
    const listed = outcome.candidates.map(candidateLabel).join("; ");
    return {
      ok: false,
      error: `Several Apple Podcasts shows are named "${title}": ${listed}. Paste the Apple Podcasts link for the one you want.`,
    };
  }
  if (platform === "spotify") {
    return {
      ok: false,
      error: `Spotify doesn't publish an RSS feed, and Apple Podcasts has no show named "${title}". It may be a Spotify exclusive, or the title may differ there.`,
    };
  }
  const by = author ? ` ("${title}" by ${author})` : ` ("${title}")`;
  return {
    ok: false,
    error: `No public feed was listed for this show${by}. It may be private, paid, or missing from Apple Podcasts.`,
  };
}

/**
 * Run the search from the visitor's browser, so Apple sees the visitor's own
 * address and its per-address limit. `fetchImpl` is for tests.
 */
export async function searchFromBrowser(
  search: DirectorySearch,
  fetchImpl: typeof fetch = fetch
): Promise<DirectoryOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(itunesSearchUrl(search.title), {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, error: APPLE_BROWSER_UNREACHABLE };
  }
  if (response.status === 429) {
    return {
      ok: false,
      error: "Apple's directory is limiting requests from this connection. Wait a minute, then try again.",
    };
  }
  if (!response.ok) return { ok: false, error: APPLE_TRY_AGAIN };
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: APPLE_TRY_AGAIN };
  }
  return matchSearchResults(data, search, asHttpUrl);
}

/**
 * Look up one Apple Podcasts show from the visitor's browser. Apple answers
 * this cross-origin. The claim is not trusted: the server checks the feed
 * address before anything is shown. `fetchImpl` is for tests.
 *
 * `empty` means Apple's JSON was readable and listed no feed. `failed` means
 * the browser never got a readable answer, so the caller can ask the server.
 */
export async function lookupFromBrowser(
  showUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<BrowserLookup> {
  let id: string | undefined;
  try {
    id = appleShowId(new URL(showUrl.trim()));
  } catch {
    id = undefined;
  }
  if (!id) {
    return { ok: false, reason: "failed", error: "That Apple Podcasts link has no show id." };
  }

  let response: Response;
  try {
    response = await fetchImpl(itunesLookupUrl(id), {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: "failed", error: APPLE_BROWSER_UNREACHABLE };
  }
  if (!response.ok) return { ok: false, reason: "failed", error: APPLE_TRY_AGAIN };
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: "failed", error: APPLE_TRY_AGAIN };
  }

  const hit = itunesHits(data).find((item) => item.feedUrl);
  if (!hit?.feedUrl) return { ok: false, reason: "empty", error: APPLE_NO_FEED };
  return {
    ok: true,
    claim: {
      feedUrl: hit.feedUrl,
      title: hit.title,
      author: hit.author,
      artwork: hit.artwork,
      itunesId: hit.itunesId,
    },
  };
}
