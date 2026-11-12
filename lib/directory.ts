// Matching a show name against Apple Podcasts. No Node imports: the server
// uses this, and so does the browser, which runs the search itself because
// Apple rate-limits the shared address the host's servers leave from.

import { candidateLabel, pickDirectoryHit, type DirectoryHit } from "./match";
import type { MatchSource, Platform, ResolveResult } from "./types";
import { asHttpsUrl, asHttpUrl } from "./url";

/** A show known by name, still to be matched in Apple Podcasts. */
export type DirectorySearch = {
  title: string;
  author?: string;
  platform: Platform;
  /** Artwork from the source platform, used when Apple has none. */
  artwork?: string;
};

export type DirectoryOutcome = { ok: true; result: ResolveResult } | { ok: false; error: string };

/** Returns the feed address to report, or undefined to refuse it. */
export type FeedUrlCheck = (raw: string | undefined) => string | undefined;

export const APPLE_UNREADABLE = "Apple's directory returned something that couldn't be read.";

export function itunesSearchUrl(title: string): string {
  const endpoint = new URL("https://itunes.apple.com/search");
  endpoint.searchParams.set("media", "podcast");
  endpoint.searchParams.set("entity", "podcast");
  endpoint.searchParams.set("limit", "50");
  endpoint.searchParams.set("term", title.slice(0, 200));
  return endpoint.toString();
}

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
    return {
      ok: false,
      error: "Couldn't reach Apple's directory from this browser. Check that nothing is blocking itunes.apple.com, then try again.",
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      error: "Apple's directory is limiting requests from this connection. Wait a minute, then try again.",
    };
  }
  if (!response.ok) return { ok: false, error: APPLE_UNREADABLE };
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: APPLE_UNREADABLE };
  }
  return matchSearchResults(data, search, asHttpUrl);
}
