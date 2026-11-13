import { USER_AGENT } from "./site";
import type { MatchSource, Platform, ResolveResult } from "./types";
import { appleShowId, parseShowLink, pocketCastsUuid, spotifyRef } from "./platforms";
import { candidateLabel, candidateList, normalizeName, type DirectoryHit } from "./match";
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
  attr,
  decodeEntities,
  looksLikeFeed,
  metaContent,
  spotifyEmbedEntity,
  spotifyPublisher,
} from "./html";
import { asHttpsUrl, FetchError, type SafeResponse } from "./net";
import { indexByGuid, indexByTitle, keysFor } from "./podcast-index";
import {
  DirectoryUnavailable,
  fetchWith,
  logUpstream,
  publicFeedUrl,
  ResolveError,
  responseDetail,
  upstreamError,
  type ResolverDeps,
} from "./upstream";
import { discoverWebsite, resolveSoundCloud, resolveYouTube } from "./discover";

export { DirectoryUnavailable, logUpstream, ResolveError } from "./upstream";
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
  let failure: ResolveError = new DirectoryUnavailable(APPLE_TRY_AGAIN);

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
      throw new DirectoryUnavailable(upstreamError(err, call.unreachable, call.stage, call.endpoint).message);
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
        failure = new DirectoryUnavailable(APPLE_TRY_AGAIN);
        continue;
      }
    }
    logUpstream(call.stage, call.endpoint, {
      problem: "status",
      attempt: attempt + 1,
      ...responseDetail(response),
    });
    failure = new DirectoryUnavailable(APPLE_TRY_AGAIN);
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
  if (!outcome.ok) {
    throw outcome.candidates
      ? new AmbiguousShow(outcome.error, outcome.candidates, "itunes-search")
      : new ResolveError(outcome.error);
  }
  return outcome.result;
}

/** Several shows fit the name and publisher. The candidates let a caller tell them apart. */
export class AmbiguousShow extends ResolveError {
  constructor(
    message: string,
    readonly candidates: DirectoryHit[],
    readonly source: MatchSource
  ) {
    super(message);
  }
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
  podcastGuid?: string;
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
  /** The feed's podcast:guid, when it declares one. */
  podcastGuid?: string;
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
    podcastGuid: str(podcast.guid),
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
  return {
    title: show.title,
    author: show.author,
    feedCandidate: show.website,
    podcastGuid: show.podcastGuid,
    isPrivate: show.isPrivate,
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
  return {
    search: {
      title: catalog.title,
      author: catalog.author,
      platform: "pocketcasts",
      artwork,
      podcastGuid: catalog.podcastGuid,
      pocketCastsUuid: uuid,
    },
  };
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

/**
 * Neither directory could be asked: the show is known by name, but nothing
 * matched it to a feed. The caller can run Apple's search from an address
 * Apple doesn't turn away.
 */
export class NameSearchIncomplete extends ResolveError {
  constructor(
    message: string,
    readonly search: DirectorySearch
  ) {
    super(message);
  }

  /** Apple's search for the show, for a client to run from its own address. */
  get searchUrl(): string {
    return itunesSearchUrl(this.search.title);
  }
}

/** Apple's own feed address for an Apple id, or undefined when Apple doesn't answer. */
async function appleFeedFor(itunesId: number, deps: ResolverDeps): Promise<string | undefined> {
  try {
    const data = await readApple(
      {
        endpoint: itunesLookupUrl(String(itunesId)),
        stage: "apple-lookup",
        maxBytes: 1_000_000,
        unreachable: "Apple's directory didn't respond.",
      },
      deps
    );
    return publicFeedUrl(itunesHits(data).find((hit) => hit.feedUrl)?.feedUrl);
  } catch (err) {
    if (err instanceof ResolveError) return undefined;
    throw err;
  }
}

function indexResult(hit: DirectoryHit, feedUrl: string, matchedBy: MatchSource, search: DirectorySearch): ResolveResult {
  return {
    feedUrl,
    title: hit.title ?? search.title,
    author: hit.author ?? search.author,
    artwork: asHttpsUrl(hit.artwork) ?? search.artwork,
    itunesId: hit.itunesId,
    platform: search.platform,
    matchedBy,
  };
}

function byLine(search: DirectorySearch): string {
  return search.author ? `"${search.title}" by ${search.author}` : `"${search.title}"`;
}

/**
 * Match a show known only by name on the server. Podcast Index answers first:
 * by the feed's podcast GUID when Pocket Casts has one, then by title. A title
 * match that Apple also lists takes Apple's feed address, so this agrees with
 * the website, whose browser asks Apple. Apple's search, which usually turns
 * this server away, is tried only when Podcast Index has no such show or
 * isn't set up.
 */
export async function findFeedByName(search: DirectorySearch, deps: ResolverDeps = {}): Promise<ResolveResult> {
  try {
    return await matchByName(search, deps);
  } catch (err) {
    if (!(err instanceof AmbiguousShow) || !search.pocketCastsUuid) throw err;
    const picked = await resolveAmongCandidates(search, err.candidates, err.source, deps);
    if (picked) return picked;
    throw err;
  }
}

async function matchByName(search: DirectorySearch, deps: ResolverDeps): Promise<ResolveResult> {
  const keys = keysFor(deps);
  let index: "off" | "none" | "unavailable" = "off";
  if (keys) {
    try {
      const byGuid = search.podcastGuid ? await indexByGuid(search.podcastGuid, keys, deps) : undefined;
      if (byGuid?.feedUrl) return indexResult(byGuid, byGuid.feedUrl, "podcastindex-guid", search);

      const outcome = await indexByTitle(search, keys, deps);
      if (outcome.status === "match") {
        const { hit } = outcome;
        const appleFeed = hit.itunesId ? await appleFeedFor(hit.itunesId, deps) : undefined;
        const feedUrl = appleFeed ?? hit.feedUrl;
        if (feedUrl) return indexResult(hit, feedUrl, "podcastindex-search", search);
      }
      if (outcome.status === "conflict") {
        throw new ResolveError(
          `The publisher doesn't match. Podcast Index has "${candidateLabel(outcome.hit)}", not ${byLine(search)}. Use the show's Apple Podcasts link or feed URL if that is the one you want.`
        );
      }
      if (outcome.status === "ambiguous") {
        throw new AmbiguousShow(
          `Several shows are named "${search.title}": ${candidateList(outcome.candidates)}. Use the Apple Podcasts link or the feed URL for the one you want.`,
          outcome.candidates,
          "podcastindex-search"
        );
      }
      index = "none";
    } catch (err) {
      if (!(err instanceof DirectoryUnavailable)) throw err;
      index = "unavailable";
    }
  }

  try {
    return await searchItunes(search, deps);
  } catch (err) {
    if (!(err instanceof DirectoryUnavailable)) throw err;
    const spotify = search.platform === "spotify" ? " Spotify doesn't publish RSS, so it may be a Spotify exclusive." : "";
    const message = {
      off: `Apple's directory turned down the name search from this server, so ${byLine(search)} couldn't be matched to a feed.`,
      none: `Podcast Index has no show named ${byLine(search)}, and Apple's directory turned down the name search from this server.${spotify}`,
      unavailable: `Neither Podcast Index nor Apple's directory answered this server, so ${byLine(search)} couldn't be matched to a feed.`,
    }[index];
    throw new NameSearchIncomplete(message, search);
  }
}

const withoutQuery = (url: string) => url.split(/[?#]/, 1)[0];

/** Whether the feed lists one of these audio files. Only the start of a long feed is read. */
async function feedCarries(feedUrl: string, files: Set<string>, deps: ResolverDeps): Promise<boolean> {
  try {
    const response = await fetchWith(deps)(feedUrl, {
      userAgent: USER_AGENT,
      accept: "application/rss+xml, application/xml, text/xml",
      timeoutMs: 8000,
      maxBytes: 2_000_000,
      maxUncompressedBytes: 2_000_000,
      allowPartial: true,
    });
    if (response.status < 200 || response.status >= 300) return false;
    for (const tag of response.body.match(/<enclosure\b[^>]*>/gi) ?? []) {
      const raw = attr(tag, "url");
      if (!raw) continue;
      const file = decodeEntities(raw).trim();
      if (files.has(file) || files.has(withoutQuery(file))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Candidates the browser sent back, read field by field. Anything else is dropped. */
export function candidateHits(raw: unknown[]): DirectoryHit[] {
  const hits: DirectoryHit[] = [];
  for (const item of raw.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const field = (key: string) =>
      typeof record[key] === "string" && (record[key] as string).length <= 2000 ? (record[key] as string) : undefined;
    hits.push({
      title: field("title"),
      author: field("author"),
      feedUrl: field("feedUrl"),
      artwork: field("artwork"),
      itunesId: typeof record.itunesId === "number" && Number.isInteger(record.itunesId) ? record.itunesId : undefined,
    });
  }
  return hits;
}

const NEWEST_EPISODE_NOTE =
  "Several shows share this name. This is the one whose feed has Pocket Casts' newest episode.";

/**
 * Pick, among same-named shows, the feed that has the audio files of the
 * Pocket Casts show's newest episodes. That is the feed Pocket Casts reads.
 * Undefined unless exactly one candidate has them. Candidates must carry the
 * show's own title, so a claim from the browser can't swap in another show.
 */
export async function resolveAmongCandidates(
  search: DirectorySearch,
  candidates: DirectoryHit[],
  source: MatchSource,
  deps: ResolverDeps = {}
): Promise<ResolveResult | undefined> {
  if (!search.pocketCastsUuid) return undefined;
  const wanted = normalizeName(search.title);
  const usable: DirectoryHit[] = [];
  for (const candidate of candidates.slice(0, 4)) {
    const feedUrl = publicFeedUrl(candidate.feedUrl);
    if (!feedUrl || !candidate.title || normalizeName(candidate.title) !== wanted) continue;
    if (usable.some((hit) => hit.feedUrl === feedUrl)) continue;
    usable.push({ ...candidate, feedUrl });
  }
  if (usable.length < 2) return undefined;

  const show = await readPocketCastsShow(search.pocketCastsUuid, deps);
  const files = new Set<string>();
  for (const episode of show.episodes.filter((item) => item.url).slice(0, 3)) {
    files.add(episode.url!);
    files.add(withoutQuery(episode.url!));
  }
  if (files.size === 0) return undefined;

  const carries = await Promise.all(usable.map((hit) => feedCarries(hit.feedUrl!, files, deps)));
  const matching = usable.filter((_, index) => carries[index]);
  if (matching.length !== 1) return undefined;
  return { ...indexResult(matching[0], matching[0].feedUrl!, source, search), note: NEWEST_EPISODE_NOTE };
}

/** Find the show and its feed, matching a name on the server. */
export async function resolveShowUrl(input: string, deps: ResolverDeps = {}): Promise<ResolveResult> {
  const identified = await identifyShow(input, deps);
  if ("result" in identified) return identified.result;
  return findFeedByName(identified.search, deps);
}
