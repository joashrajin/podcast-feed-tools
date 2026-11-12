import { USER_AGENT } from "./site";
import type { MatchSource, Platform, ResolveResult } from "./types";
import { appleShowId, parseShowLink, pocketCastsUuid, spotifyRef } from "./platforms";
import type { DirectoryHit } from "./match";
import {
  APPLE_NO_FEED,
  APPLE_TRY_AGAIN,
  itunesHits,
  itunesLookupUrl,
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
import { asHttpsUrl, FetchError, type SafeResponse } from "./net";
import {
  fetchWith,
  logUpstream,
  publicFeedUrl,
  ResolveError,
  responseDetail,
  upstreamError,
  type ResolverDeps,
} from "./upstream";
import { discoverWebsite, resolveSoundCloud, resolveYouTube } from "./discover";

export { logUpstream, ResolveError } from "./upstream";
export type { ResolverDeps } from "./upstream";

export type { ResolveResult } from "./types";
export type { DirectorySearch } from "./directory";

/**
 * Either the feed, or the show's name and publisher still to be matched in
 * Apple Podcasts. The browser runs that search when the host's shared
 * address is rate-limited by Apple.
 */
export type Identified = { result: ResolveResult } | { search: DirectorySearch };
export { detectPlatform } from "./platforms";

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

function fromHit(hit: DirectoryHit, matchedBy: MatchSource, platform: Platform): ResolveResult {
  const outcome = resultFromHit(hit, matchedBy, platform, publicFeedUrl);
  if (!outcome.ok) throw new ResolveError(outcome.error);
  return outcome.result;
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

/** One budget for an Apple call and its single retry. Matches the old per-request timeout. */
const APPLE_DEADLINE_MS = 8_000;
/** Pause before the second attempt. Short enough that both fit in the deadline. */
const APPLE_RETRY_BACKOFF_MS = 400;
/** Don't start an attempt that has no time left to receive an answer. */
const APPLE_MIN_ATTEMPT_MS = 500;

type AppleCall = {
  endpoint: string;
  stage: "apple-lookup" | "apple-search";
  maxBytes?: number;
  maxUncompressedBytes?: number;
  unreachable: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch one Apple endpoint. A non-2xx status or a body that isn't JSON is
 * tried once more, after a short pause, if the original deadline still has
 * room. A connection failure is not retried: the deadline is already the
 * timeout of that attempt.
 */
async function readApple(call: AppleCall, deps: ResolverDeps): Promise<unknown> {
  const fetch = fetchWith(deps);
  const now = deps.now ?? Date.now;
  const wait = deps.sleep ?? delay;
  const started = now();
  const remaining = () => APPLE_DEADLINE_MS - (now() - started);
  let failure = new ResolveError(APPLE_TRY_AGAIN);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      if (remaining() < APPLE_RETRY_BACKOFF_MS + APPLE_MIN_ATTEMPT_MS) break;
      await wait(APPLE_RETRY_BACKOFF_MS);
    }
    const timeoutMs = remaining();
    if (timeoutMs < APPLE_MIN_ATTEMPT_MS) break;

    let response: SafeResponse;
    try {
      response = await fetch(call.endpoint, {
        userAgent: USER_AGENT,
        accept: "application/json",
        allowedHosts: ["itunes.apple.com"],
        timeoutMs,
        maxBytes: call.maxBytes,
        maxUncompressedBytes: call.maxUncompressedBytes,
      });
    } catch (err) {
      throw upstreamError(err, call.unreachable, call.stage, call.endpoint);
    }

    if (response.status >= 200 && response.status < 300) {
      try {
        return JSON.parse(response.body);
      } catch {
        logUpstream(call.stage, call.endpoint, {
          problem: "not-json",
          attempt: attempt + 1,
          ...responseDetail(response),
        });
        failure = new ResolveError(APPLE_TRY_AGAIN);
        continue;
      }
    }
    logUpstream(call.stage, call.endpoint, {
      problem: "status",
      attempt: attempt + 1,
      ...responseDetail(response),
    });
    failure = new ResolveError(APPLE_TRY_AGAIN);
  }
  throw failure;
}

/** The server-side Apple search. On the website the browser runs it instead. */
export async function searchItunes(search: DirectorySearch, deps: ResolverDeps = {}): Promise<ResolveResult> {
  const data = await readApple(
    {
      endpoint: itunesSearchUrl(search.title),
      stage: "apple-search",
      maxUncompressedBytes: 2_000_000,
      unreachable: "Apple's directory didn't respond, so the show couldn't be matched.",
    },
    deps
  );
  const outcome = matchSearchResults(data, search, publicFeedUrl);
  if (!outcome.ok) throw new ResolveError(outcome.error);
  return outcome.result;
}

async function resolveApple(inputUrl: URL, deps: ResolverDeps): Promise<ResolveResult> {
  const id = appleShowId(inputUrl);
  if (!id) throw new ResolveError("That Apple Podcasts link has no show id.");
  const data = await readApple(
    {
      endpoint: itunesLookupUrl(id),
      stage: "apple-lookup",
      maxBytes: 1_000_000,
      unreachable: "Apple's directory didn't respond. Try again in a moment.",
    },
    deps
  );
  const podcast = itunesHits(data).find((hit) => hit.feedUrl);
  if (!podcast) throw new ResolveError(APPLE_NO_FEED);
  return fromHit(podcast, "itunes-lookup", "apple");
}

function textField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Check a lookup the browser already ran. The feed address goes through the
 * same public-URL check as a hit this server fetched. A claim that names a
 * different show is refused. Nothing here contacts Apple.
 */
export function acceptAppleLookup(input: string, claim: unknown): ResolveResult {
  const parsed = parseShowLink(input);
  if ("error" in parsed) throw new ResolveError(parsed.error);
  if (parsed.platform !== "apple") {
    throw new ResolveError("An Apple lookup only applies to an Apple Podcasts link.");
  }
  const id = appleShowId(parsed.url);
  if (!id) throw new ResolveError("That Apple Podcasts link has no show id.");
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new ResolveError("That Apple lookup wasn't usable.");
  }

  const record = claim as Record<string, unknown>;
  let itunesId = Number(id);
  if (record.itunesId !== undefined) {
    if (typeof record.itunesId !== "number" || !Number.isSafeInteger(record.itunesId) || String(record.itunesId) !== id) {
      throw new ResolveError("That Apple lookup doesn't match this show.");
    }
    itunesId = record.itunesId;
  }
  return fromHit(
    {
      feedUrl: textField(record.feedUrl),
      title: textField(record.title),
      author: textField(record.author),
      artwork: textField(record.artwork),
      itunesId,
    },
    "itunes-lookup",
    "apple"
  );
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

export type PocketCastsEpisode = {
  uuid: string;
  title?: string;
  published?: string;
  durationSeconds?: number;
  fileType?: string;
  fileSize?: number;
  url?: string;
  type?: string;
};

/** A show as Pocket Casts' catalog has it. */
export type PocketCastsShow = {
  uuid: string;
  title?: string;
  author?: string;
  /** The catalog's `url`: usually the show's website, sometimes its feed. */
  website?: string;
  isPrivate: boolean;
  showType?: string;
  categories: string[];
  explicit?: boolean;
  episodeCount?: number;
  episodeFrequency?: string;
  estimatedNextEpisodeAt?: string;
  /** True when the catalog left older episodes out of this listing. */
  hasMoreEpisodes?: boolean;
  /** Newest first. */
  episodes: PocketCastsEpisode[];
};

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Read Pocket Casts' catalog entry for a show UUID. */
export async function readPocketCastsShow(uuid: string, deps: ResolverDeps = {}): Promise<PocketCastsShow> {
  const response = await fetchCatalog(uuid, deps);
  const data = await readJson(response, "Pocket Casts returned something that couldn't be read.", "pocketcasts-catalog", response.url);
  const top = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const podcast = (top.podcast && typeof top.podcast === "object" ? top.podcast : top) as Record<string, unknown>;
  const episodes: PocketCastsEpisode[] = [];
  for (const raw of Array.isArray(podcast.episodes) ? podcast.episodes : []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = str(row.uuid);
    if (!id) continue;
    const published = str(row.published);
    episodes.push({
      uuid: id,
      title: str(row.title),
      published: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : published,
      durationSeconds: num(row.duration),
      fileType: str(row.file_type),
      fileSize: num(row.file_size),
      url: str(row.url),
      type: str(row.type),
    });
  }
  episodes.sort((a, b) => (Date.parse(b.published ?? "") || 0) - (Date.parse(a.published ?? "") || 0));
  const category = str(podcast.category);
  return {
    uuid,
    title: str(podcast.title),
    author: str(podcast.author),
    website: str(podcast.url),
    isPrivate: podcast.is_private === true || podcast.isPrivate === true,
    showType: str(podcast.show_type),
    categories: category ? category.split(/\n+/).map((part) => part.trim()).filter(Boolean) : [],
    explicit: typeof podcast.explicit === "boolean" ? podcast.explicit : undefined,
    episodeCount: num(top.episode_count) ?? episodes.length,
    episodeFrequency: str(top.episode_frequency),
    estimatedNextEpisodeAt: str(top.estimated_next_episode_at),
    hasMoreEpisodes: typeof top.has_more_episodes === "boolean" ? top.has_more_episodes : undefined,
    episodes,
  };
}

async function readCatalog(uuid: string, deps: ResolverDeps): Promise<Catalog> {
  const show = await readPocketCastsShow(uuid, deps);
  return { title: show.title, author: show.author, feedCandidate: show.website, isPrivate: show.isPrivate };
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

/**
 * The show UUID behind a Pocket Casts link, or a UUID given as is. Share
 * links that carry only an episode id are followed to the show page.
 */
export async function pocketCastsShowId(input: string, deps: ResolverDeps = {}): Promise<string> {
  const trimmed = input.trim();
  if (UUID_ONLY.test(trimmed)) return trimmed.toLowerCase();
  const parsed = parseShowLink(trimmed);
  if ("error" in parsed || parsed.platform !== "pocketcasts") {
    throw new ResolveError("That isn't a Pocket Casts link. Give a pca.st or pocketcasts.com link, or a show UUID.");
  }
  return pocketCastsLinkUuid(parsed.url, deps);
}

async function pocketCastsLinkUuid(inputUrl: URL, deps: ResolverDeps): Promise<string> {
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
  return uuid.toLowerCase();
}

/**
 * The catalog's address for the show, when it answers as RSS. Pocket Casts
 * usually stores the website there instead.
 */
export async function catalogFeedUrl(show: PocketCastsShow, deps: ResolverDeps = {}): Promise<string | undefined> {
  return show.website ? confirmFeed(show.website, deps) : undefined;
}

async function identifyPocketCasts(inputUrl: URL, deps: ResolverDeps): Promise<Identified> {
  const uuid = await pocketCastsLinkUuid(inputUrl, deps);
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

/** Find the show or feed. Stops before the Apple name search, which the caller runs where it can. */
export async function identifyShow(input: string, deps: ResolverDeps = {}): Promise<Identified> {
  const parsed = parseShowLink(input);
  if ("error" in parsed) throw new ResolveError(parsed.error);
  switch (parsed.platform) {
    case "apple":
      return { result: await resolveApple(parsed.url, deps) };
    case "spotify":
      return identifySpotify(parsed.url, deps);
    case "pocketcasts":
      return identifyPocketCasts(parsed.url, deps);
    case "youtube":
      return { result: await resolveYouTube(parsed.url, deps) };
    case "soundcloud":
      return { result: await resolveSoundCloud(parsed.url, deps) };
    case "website":
      return { result: await discoverWebsite(parsed.url, deps) };
  }
}

/** Find the show and its feed, running the Apple name search on the server. */
export async function resolveShowUrl(input: string, deps: ResolverDeps = {}): Promise<ResolveResult> {
  const identified = await identifyShow(input, deps);
  if ("result" in identified) return identified.result;
  return searchItunes(identified.search, deps);
}
