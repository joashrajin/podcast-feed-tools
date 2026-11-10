import { USER_AGENT } from "./site";
import type { MatchSource, Platform, ResolveResult } from "./types";
import { appleShowId, parseShowLink, pocketCastsUuid, spotifyRef } from "./platforms";
import { candidateLabel, pickDirectoryHit, type DirectoryHit } from "./match";
import {
  looksLikeFeed,
  metaContent,
  spotifyEmbedEntity,
  spotifyPublisher,
} from "./html";
import { asHttpsUrl, assertPublicHttpUrl, FetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from "./net";

export type { ResolveResult } from "./types";
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
  const feedUrl = publicFeedUrl(hit.feedUrl);
  if (!feedUrl) {
    throw new ResolveError("The directory returned a feed address that isn't a public URL.");
  }
  return {
    feedUrl,
    title: hit.title,
    author: hit.author,
    artwork: asHttpsUrl(hit.artwork),
    itunesId: hit.itunesId,
    platform,
    matchedBy,
  };
}

function ambiguousMessage(title: string, candidates: DirectoryHit[]): string {
  const listed = candidates.map(candidateLabel).join("; ");
  return `Several Apple Podcasts shows are named "${title}": ${listed}. Paste the Apple Podcasts link for the one you want.`;
}

async function readJson(response: SafeResponse, failure: string): Promise<unknown> {
  if (response.status < 200 || response.status >= 300) {
    throw new ResolveError(failure);
  }
  try {
    return JSON.parse(response.body);
  } catch {
    throw new ResolveError(failure);
  }
}

function mapItunes(entry: unknown): DirectoryHit {
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

async function searchItunes(
  title: string,
  author: string | undefined,
  platform: Platform,
  deps: ResolverDeps
): Promise<ResolveResult> {
  const fetch = fetchWith(deps);
  const endpoint = new URL("https://itunes.apple.com/search");
  endpoint.searchParams.set("media", "podcast");
  endpoint.searchParams.set("entity", "podcast");
  endpoint.searchParams.set("limit", "50");
  endpoint.searchParams.set("term", title.slice(0, 200));

  let response: SafeResponse;
  try {
    response = await fetch(endpoint.toString(), {
      userAgent: USER_AGENT,
      accept: "application/json",
      allowedHosts: ["itunes.apple.com"],
      timeoutMs: 8000,
      maxBytes: 2_000_000,
    });
  } catch (err) {
    throw upstreamError(err, "Apple's directory didn't respond, so the show couldn't be matched.");
  }

  const data = await readJson(response, "Apple's directory returned something that couldn't be read.");
  const results = (data as { results?: unknown }).results;
  const hits = Array.isArray(results) ? results.map(mapItunes) : [];
  const outcome = pickDirectoryHit(hits, title, author);

  if (outcome.status === "match") return fromHit(outcome.hit, "itunes-search", platform);
  if (outcome.status === "conflict") {
    const listed = candidateLabel(outcome.hit);
    throw new ResolveError(
      `The publisher does not match. Apple Podcasts has "${listed}", not "${title}" by ${author ?? "the supplied publisher"}. Paste the Apple Podcasts link if that is the show you want.`
    );
  }
  if (outcome.status === "ambiguous") {
    throw new ResolveError(ambiguousMessage(title, outcome.candidates));
  }
  if (platform === "spotify") {
    throw new ResolveError(
      `Spotify doesn't publish an RSS feed, and Apple Podcasts has no show named "${title}". It may be a Spotify exclusive, or the title may differ there.`
    );
  }
  const by = author ? ` ("${title}" by ${author})` : ` ("${title}")`;
  throw new ResolveError(
    `No public feed was listed for this show${by}. It may be private, paid, or missing from Apple Podcasts.`
  );
}

function upstreamError(err: unknown, fallback: string): ResolveError {
  if (err instanceof ResolveError) return err;
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
    throw upstreamError(err, "Apple's directory didn't respond. Try again in a moment.");
  }

  const data = await readJson(response, "Apple's directory returned something that couldn't be read.");
  const results = (data as { results?: unknown }).results;
  const hits = Array.isArray(results) ? results.map(mapItunes) : [];
  const podcast = hits.find((hit) => hit.feedUrl);
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
      // The show page inlines a long list of country tags. The title is near the top,
      // but the response is gzipped, so the compressed body has to be read whole.
      maxBytes: 500_000,
      maxUncompressedBytes: 800_000,
    });
  } catch (err) {
    if (err instanceof FetchError && err.code === "too-large") {
      throw new ResolveError("Spotify's page was too large to read the show name from.");
    }
    throw upstreamError(err, "Spotify didn't respond for that show. Check that the link is public.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ResolveError("Spotify didn't return that show. Check that the link is public.");
  }
  return {
    title: metaContent(response.body, "og:title"),
    author: spotifyPublisher(metaContent(response.body, "og:description")),
    artwork: asHttpsUrl(metaContent(response.body, "og:image")),
  };
}

async function resolveSpotify(inputUrl: URL, deps: ResolverDeps): Promise<ResolveResult> {
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
      throw upstreamError(err, "Spotify didn't respond for that episode. Check that the link is public.");
    }
    if (response.status < 200 || response.status >= 300) {
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

  const matched = await searchItunes(title, author, "spotify", deps);
  return { ...matched, artwork: matched.artwork ?? artwork, platform: "spotify" };
}

type Catalog = {
  title?: string;
  author?: string;
  feedCandidate?: string;
  isPrivate: boolean;
};

async function readCatalog(uuid: string, deps: ResolverDeps): Promise<Catalog> {
  const fetch = fetchWith(deps);
  let response: SafeResponse;
  try {
    response = await fetch(`https://podcast-api.pocketcasts.com/podcast/full/${uuid}`, {
      userAgent: USER_AGENT,
      accept: "application/json",
      allowedHosts: POCKETCASTS_API,
      timeoutMs: 8000,
      maxBytes: 2_000_000,
      maxUncompressedBytes: 6_000_000,
    });
  } catch (err) {
    throw upstreamError(err, "Pocket Casts didn't respond for that show.");
  }
  const data = await readJson(response, "Pocket Casts returned something that couldn't be read.");
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
    return publicFeedUrl(response.url);
  } catch {
    return undefined;
  }
}

async function resolvePocketCasts(inputUrl: URL, deps: ResolverDeps): Promise<ResolveResult> {
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
        maxBytes: 48_000,
        maxUncompressedBytes: 200_000,
        haltWhen: (url) => Boolean(pocketCastsUuid(url)),
      });
    } catch (err) {
      throw upstreamError(err, "Pocket Casts didn't respond for that link. Is it public?");
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

  if (catalog.feedCandidate) {
    const confirmed = await confirmFeed(catalog.feedCandidate, deps);
    if (confirmed) {
      return {
        feedUrl: confirmed,
        title: catalog.title,
        author: catalog.author,
        artwork: `https://static.pocketcasts.com/discover/images/webp/480/${uuid}.webp`,
        platform: "pocketcasts",
        matchedBy: "pocketcasts-catalog",
      };
    }
  }

  if (!catalog.title) {
    throw new ResolveError("Pocket Casts didn't include a title or a feed for that show.");
  }
  const matched = await searchItunes(catalog.title, catalog.author, "pocketcasts", deps);
  return {
    ...matched,
    title: matched.title ?? catalog.title,
    author: matched.author ?? catalog.author,
    artwork:
      matched.artwork ??
      `https://static.pocketcasts.com/discover/images/webp/480/${uuid}.webp`,
    platform: "pocketcasts",
  };
}

export async function resolveShowUrl(input: string, deps: ResolverDeps = {}): Promise<ResolveResult> {
  const parsed = parseShowLink(input);
  if ("error" in parsed) throw new ResolveError(parsed.error);
  if (parsed.platform === "apple") return resolveApple(parsed.url, deps);
  if (parsed.platform === "spotify") return resolveSpotify(parsed.url, deps);
  return resolvePocketCasts(parsed.url, deps);
}
