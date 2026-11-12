import { USER_AGENT } from "./site";
import type { MatchSource, Platform, ResolveResult } from "./types";
import { appleShowId, parseShowLink, pocketCastsUuid, spotifyRef } from "./platforms";
import type { DirectoryHit } from "./match";
import {
  APPLE_UNREADABLE,
  itunesHits,
  itunesSearchUrl,
  matchSearchResults,
  resultFromHit,
  type DirectorySearch,
} from "./directory";
import {
  looksLikeFeed,
  metaContent,
  spotifyEmbedEntity,
  spotifyPublisher,
} from "./html";
import { asHttpsUrl, assertPublicHttpUrl, FetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from "./net";

export type { ResolveResult } from "./types";
export type { DirectorySearch } from "./directory";

/**
 * Either the feed, or the show's name and publisher still to be matched in
 * Apple Podcasts. The browser runs that search when the host's shared
 * address is rate-limited by Apple.
 */
export type Identified = { result: ResolveResult } | { search: DirectorySearch };
export { detectPlatform } from "./platforms";

export class ResolveError extends Error {}

const POCKETCASTS_WEB = [
  "pca.st",
  "pocketcasts.com",
  "www.pocketcasts.com",
  "play.pocketcasts.com",
] as const;

const POCKETCASTS_API = [
  "podcast-api.pocketcasts.com",
  "podcasts.pocketcasts.com",
  "cache.pocketcasts.com",
] as const;

export type ResolverDeps = {
  fetch?: (input: string, options: SafeFetchOptions) => Promise<SafeResponse>;
};

function fetchWith(deps: ResolverDeps) {
  return deps.fetch ?? safeFetch;
}

function publicFeedUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return assertPublicHttpUrl(raw).toString();
  } catch {
    return undefined;
  }
}

function fromHit(hit: DirectoryHit, matchedBy: MatchSource, platform: Platform): ResolveResult {
  const outcome = resultFromHit(hit, matchedBy, platform, publicFeedUrl);
  if (!outcome.ok) throw new ResolveError(outcome.error);
  return outcome.result;
}

/**
 * One line in the runtime log for each upstream that answered badly, so a
 * failure on the host can be told apart: blocked, rate-limited, or changed.
 * Nothing from the visitor is logged beyond the show URL or title they sent.
 */
export function logUpstream(stage: string, url: string, detail: Record<string, unknown>): void {
  console.warn(`[upstream] ${stage} ${JSON.stringify({ url, ...detail })}`);
}

function responseDetail(response: SafeResponse): Record<string, unknown> {
  const headers = Object.fromEntries(
    Object.entries(response.headers).filter(([name]) => name !== "set-cookie")
  );
  return {
    status: response.status,
    finalUrl: response.url,
    headers,
    body: response.body.replace(/\s+/g, " ").slice(0, 400),
    truncated: response.truncated ?? false,
  };
}

async function readJson(response: SafeResponse, failure: string, stage: string, url: string): Promise<unknown> {
  if (response.status < 200 || response.status >= 300) {
    logUpstream(stage, url, { problem: "status", ...responseDetail(response) });
    throw new ResolveError(failure);
  }
  try {
    return JSON.parse(response.body);
  } catch {
    logUpstream(stage, url, { problem: "not-json", ...responseDetail(response) });
    throw new ResolveError(failure);
  }
}

/** The server-side Apple search. On Spacefast the browser runs it instead. */
export async function searchItunes(search: DirectorySearch, deps: ResolverDeps = {}): Promise<ResolveResult> {
  const fetch = fetchWith(deps);
  const endpoint = itunesSearchUrl(search.title);

  let response: SafeResponse;
  try {
    response = await fetch(endpoint, {
      userAgent: USER_AGENT,
      accept: "application/json",
      allowedHosts: ["itunes.apple.com"],
      timeoutMs: 8000,
      maxUncompressedBytes: 2_000_000,
    });
  } catch (err) {
    throw upstreamError(err, "Apple's directory didn't respond, so the show couldn't be matched.", "apple-search", endpoint);
  }

  const data = await readJson(response, APPLE_UNREADABLE, "apple-search", endpoint);
  const outcome = matchSearchResults(data, search, publicFeedUrl);
  if (!outcome.ok) throw new ResolveError(outcome.error);
  return outcome.result;
}

function upstreamError(err: unknown, fallback: string, stage = "fetch", url = ""): ResolveError {
  if (err instanceof ResolveError) return err;
  logUpstream(stage, url, {
    problem: "fetch-error",
    code: err instanceof FetchError ? err.code : undefined,
    message: err instanceof Error ? err.message : String(err),
  });
  if (err instanceof FetchError) return new ResolveError(fallback);
  return new ResolveError(fallback);
}

async function resolveApple(inputUrl: URL, deps: ResolverDeps): Promise<ResolveResult> {
  const id = appleShowId(inputUrl);
  if (!id) throw new ResolveError("That Apple Podcasts link has no show id.");
  const fetch = fetchWith(deps);
  const endpoint = new URL("https://itunes.apple.com/lookup");
  endpoint.searchParams.set("id", id);
  endpoint.searchParams.set("entity", "podcast");

  let response: SafeResponse;
  try {
    response = await fetch(endpoint.toString(), {
      userAgent: USER_AGENT,
      accept: "application/json",
      allowedHosts: ["itunes.apple.com"],
      timeoutMs: 8000,
      maxBytes: 1_000_000,
    });
  } catch (err) {
    throw upstreamError(err, "Apple's directory didn't respond. Try again in a moment.", "apple-lookup", endpoint.toString());
  }

  const data = await readJson(response, APPLE_UNREADABLE, "apple-lookup", endpoint.toString());
  const podcast = itunesHits(data).find((hit) => hit.feedUrl);
  if (!podcast) {
    throw new ResolveError(
      "Apple Podcasts didn't return an RSS feed for that id. The show may not have a public feed."
    );
  }
  return fromHit(podcast, "itunes-lookup", "apple");
}

async function spotifyShowMeta(
  id: string,
  deps: ResolverDeps
): Promise<{ title?: string; author?: string; artwork?: string }> {
  const fetch = fetchWith(deps);
  let response: SafeResponse;
  try {
    response = await fetch(`https://open.spotify.com/show/${id}`, {
      userAgent: USER_AGENT,
      accept: "text/html",
      allowedHosts: ["open.spotify.com"],
      timeoutMs: 8000,
      // The og: tags are in the head. The body after them can grow without
      // limit (country lists, episode data), so a cut-off page is still usable.
      maxUncompressedBytes: 800_000,
      allowPartial: true,
    });
  } catch (err) {
    throw upstreamError(err, "Spotify didn't respond for that show. Check that the link is public.", "spotify-show", `https://open.spotify.com/show/${id}`);
  }
  if (response.status < 200 || response.status >= 300) {
    logUpstream("spotify-show", `https://open.spotify.com/show/${id}`, { problem: "status", ...responseDetail(response) });
    throw new ResolveError("Spotify didn't return that show. Check that the link is public.");
  }
  return {
    title: metaContent(response.body, "og:title"),
    author: spotifyPublisher(metaContent(response.body, "og:description")),
    artwork: asHttpsUrl(metaContent(response.body, "og:image")),
  };
}

async function identifySpotify(inputUrl: URL, deps: ResolverDeps): Promise<Identified> {
  const ref = spotifyRef(inputUrl);
  if (!ref) throw new ResolveError("That Spotify link isn't a show or an episode.");

  let title: string | undefined;
  let author: string | undefined;
  let artwork: string | undefined;

  if (ref.kind === "show") {
    const meta = await spotifyShowMeta(ref.id, deps);
    title = meta.title;
    author = meta.author;
    artwork = meta.artwork;
  } else {
    const fetch = fetchWith(deps);
    let response: SafeResponse;
    try {
      response = await fetch(`https://open.spotify.com/embed/episode/${ref.id}`, {
        userAgent: USER_AGENT,
        accept: "text/html",
        allowedHosts: ["open.spotify.com"],
        timeoutMs: 8000,
        maxBytes: 150_000,
        maxUncompressedBytes: 400_000,
      });
    } catch (err) {
      throw upstreamError(err, "Spotify didn't respond for that episode. Check that the link is public.", "spotify-episode", `https://open.spotify.com/embed/episode/${ref.id}`);
    }
    if (response.status < 200 || response.status >= 300) {
      logUpstream("spotify-episode", `https://open.spotify.com/embed/episode/${ref.id}`, { problem: "status", ...responseDetail(response) });
      throw new ResolveError("Spotify didn't return that episode. Check that the link is public.");
    }
    const entity = spotifyEmbedEntity(response.body);
    // The embed's name is the episode. The show title is `subtitle`.
    title = entity?.type === "episode" ? entity.subtitle : entity?.name;
    artwork = asHttpsUrl(entity?.image);
    if (!title && entity?.showId) {
      const meta = await spotifyShowMeta(entity.showId, deps);
      title = meta.title;
      author = meta.author;
      artwork = artwork ?? meta.artwork;
    } else if (entity?.showId && title) {
      // Publisher disambiguates duplicate titles. Failure here is not fatal.
      try {
        const meta = await spotifyShowMeta(entity.showId, deps);
        author = meta.author;
        artwork = artwork ?? meta.artwork;
      } catch {
        author = undefined;
      }
    }
  }

  if (!title) {
    throw new ResolveError("Couldn't read the show name from Spotify, so it can't be matched to a feed.");
  }

  return { search: { title, author, platform: "spotify", artwork } };
}

type Catalog = {
  title?: string;
  author?: string;
  feedCandidate?: string;
  isPrivate: boolean;
};

// Two front doors to the same catalog. The second is tried only when the first
// is down, not when it says the show doesn't exist.
const CATALOG_ENDPOINTS = [
  "https://podcast-api.pocketcasts.com/podcast/full/",
  "https://cache.pocketcasts.com/mobile/podcast/full/",
] as const;

async function fetchCatalog(uuid: string, deps: ResolverDeps): Promise<SafeResponse> {
  const fetch = fetchWith(deps);
  let failure = new ResolveError("Pocket Casts didn't respond for that show. Try again in a moment.");
  for (const endpoint of CATALOG_ENDPOINTS) {
    let response: SafeResponse;
    try {
      response = await fetch(`${endpoint}${uuid}`, {
        userAgent: USER_AGENT,
        accept: "application/json",
        allowedHosts: POCKETCASTS_API,
        timeoutMs: 8000,
        maxUncompressedBytes: 6_000_000,
      });
    } catch (err) {
      logUpstream("pocketcasts-catalog", `${endpoint}${uuid}`, {
        problem: "fetch-error",
        code: err instanceof FetchError ? err.code : undefined,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof FetchError && err.code === "too-large") {
        throw new ResolveError("Pocket Casts' listing for that show is too large to read.");
      }
      continue;
    }
    if (response.status === 404) {
      throw new ResolveError(
        "Pocket Casts has no show with that id. Check that the link is to a public show or episode."
      );
    }
    if (response.status >= 500 || response.status === 429) {
      logUpstream("pocketcasts-catalog", `${endpoint}${uuid}`, { problem: "status", ...responseDetail(response) });
      failure = new ResolveError("Pocket Casts' catalog is having trouble. Try again in a moment.");
      continue;
    }
    return response;
  }
  throw failure;
}

async function readCatalog(uuid: string, deps: ResolverDeps): Promise<Catalog> {
  const response = await fetchCatalog(uuid, deps);
  const data = await readJson(response, "Pocket Casts returned something that couldn't be read.", "pocketcasts-catalog", response.url);
  const podcast = (data as { podcast?: Record<string, unknown> }).podcast ?? (data as Record<string, unknown>);
  const title = typeof podcast.title === "string" ? podcast.title.trim() : undefined;
  const author = typeof podcast.author === "string" ? podcast.author.trim() : undefined;
  const url = typeof podcast.url === "string" ? podcast.url.trim() : undefined;
  return {
    title: title || undefined,
    author: author || undefined,
    feedCandidate: url || undefined,
    isPrivate: podcast.is_private === true || podcast.isPrivate === true,
  };
}

async function confirmFeed(candidate: string, deps: ResolverDeps): Promise<string | undefined> {
  const fetch = fetchWith(deps);
  try {
    const response = await fetch(candidate, {
      userAgent: USER_AGENT,
      accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.5",
      timeoutMs: 8000,
      maxBytes: 1_000_000,
      maxUncompressedBytes: 64_000,
      allowPartial: true,
    });
    if (response.status < 200 || response.status >= 300) return undefined;
    const type = String(response.headers["content-type"] ?? "");
    if (!looksLikeFeed(type, response.body)) return undefined;
    // Report where the feed lives, not a signed or expiring address it was
    // temporarily redirected to. Permanent moves are followed.
    return publicFeedUrl(response.permanentUrl ?? candidate);
  } catch {
    return undefined;
  }
}

async function identifyPocketCasts(inputUrl: URL, deps: ResolverDeps): Promise<Identified> {
  const fetch = fetchWith(deps);
  let pageUrl = inputUrl;
  let uuid = pocketCastsUuid(pageUrl);

  if (!uuid) {
    let response: SafeResponse;
    try {
      response = await fetch(pageUrl.toString(), {
        userAgent: USER_AGENT,
        accept: "text/html",
        allowedHosts: POCKETCASTS_WEB,
        timeoutMs: 8000,
        // Only og:url in the head is read, so a cut-off page is fine.
        maxUncompressedBytes: 200_000,
        allowPartial: true,
        // Stops at the first address that names the show. An episode share
        // link redirects to /podcast/<slug>/<show>/<episode-slug>/<episode>.
        haltWhen: (url) => Boolean(pocketCastsUuid(url)),
      });
    } catch (err) {
      throw upstreamError(err, "Pocket Casts didn't respond for that link. Is it public?", "pocketcasts-page", pageUrl.toString());
    }
    pageUrl = new URL(response.url);
    uuid = pocketCastsUuid(pageUrl);
    if (!uuid && response.body) {
      const canonical = metaContent(response.body, "og:url");
      if (canonical) {
        try {
          uuid = pocketCastsUuid(new URL(canonical));
        } catch {
          uuid = undefined;
        }
      }
    }
  }

  if (!uuid) {
    throw new ResolveError("Couldn't find a show id in that Pocket Casts link.");
  }

  const catalog = await readCatalog(uuid, deps);
  if (catalog.isPrivate) {
    throw new ResolveError("That show is private on Pocket Casts, so its feed address isn't available.");
  }

  const artwork = `https://static.pocketcasts.com/discover/images/webp/480/${uuid}.webp`;
  if (catalog.feedCandidate) {
    const confirmed = await confirmFeed(catalog.feedCandidate, deps);
    if (confirmed) {
      return {
        result: {
          feedUrl: confirmed,
          title: catalog.title,
          author: catalog.author,
          artwork,
          platform: "pocketcasts",
          matchedBy: "pocketcasts-catalog",
        },
      };
    }
  }

  if (!catalog.title) {
    throw new ResolveError("Pocket Casts didn't include a title or a feed for that show.");
  }
  return { search: { title: catalog.title, author: catalog.author, platform: "pocketcasts", artwork } };
}

/** Find the show. Stops before the Apple name search, which the caller runs where it can. */
export async function identifyShow(input: string, deps: ResolverDeps = {}): Promise<Identified> {
  const parsed = parseShowLink(input);
  if ("error" in parsed) throw new ResolveError(parsed.error);
  if (parsed.platform === "apple") return { result: await resolveApple(parsed.url, deps) };
  if (parsed.platform === "spotify") return identifySpotify(parsed.url, deps);
  return identifyPocketCasts(parsed.url, deps);
}

/** Find the show and its feed, running the Apple name search on the server. */
export async function resolveShowUrl(input: string, deps: ResolverDeps = {}): Promise<ResolveResult> {
  const identified = await identifyShow(input, deps);
  if ("result" in identified) return identified.result;
  return searchItunes(identified.search, deps);
}
