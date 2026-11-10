const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

import { USER_AGENT } from "./site";

const FETCH_HEADERS = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml",
};

export type ResolveResult = {
  feedUrl: string;
  title?: string;
  author?: string;
  artwork?: string;
  itunesId?: number;
  uuid?: string;
  source: "pocketcasts" | "itunes";
};

export class ResolveError extends Error {}

function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i"
  );
  return html.match(re)?.[1] ?? html.match(alt)?.[1];
}

async function lookupPocketCasts(
  uuid: string
): Promise<{ title?: string; author?: string }> {
  // Unauthenticated cache endpoint used by the Pocket Casts web player.
  // Note: its `url` field is the show's website, NOT the RSS feed — the
  // public API never exposes the feed URL, so we only take metadata here.
  try {
    const res = await fetch(
      `https://podcast-api.pocketcasts.com/podcast/full/${uuid}`,
      { headers: FETCH_HEADERS, redirect: "follow", signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const p = data?.podcast ?? data;
    return { title: p?.title, author: p?.author };
  } catch {
    return {};
  }
}

type ItunesResult = {
  collectionName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  collectionId?: number;
};

async function lookupItunes(
  title: string,
  author?: string
): Promise<Partial<ResolveResult> & { feedUrl?: string }> {
  const res = await fetch(
    `https://itunes.apple.com/search?media=podcast&limit=10&term=${encodeURIComponent(title)}`,
    { headers: FETCH_HEADERS, signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) return {};
  const data = await res.json();
  const results: ItunesResult[] = (data?.results ?? []).filter(
    (r: ItunesResult) => r.feedUrl
  );
  const norm = (s?: string) => s?.trim().toLowerCase() ?? "";
  const hit =
    results.find(
      (r) => norm(r.collectionName) === norm(title) && norm(r.artistName) === norm(author)
    ) ??
    results.find((r) => norm(r.collectionName) === norm(title)) ??
    results[0];
  if (!hit) return {};
  return {
    feedUrl: hit.feedUrl,
    title: hit.collectionName,
    author: hit.artistName,
    artwork: hit.artworkUrl600,
    itunesId: hit.collectionId,
  };
}

export async function resolvePocketCastsUrl(
  input: string
): Promise<ResolveResult> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ResolveError("That doesn't look like a valid URL.");
  }
  const allowedHosts = ["pca.st", "pocketcasts.com", "www.pocketcasts.com", "play.pocketcasts.com"];
  if (!allowedHosts.includes(url.hostname)) {
    throw new ResolveError(
      "Please paste a Pocket Casts link (pca.st or pocketcasts.com)."
    );
  }

  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new ResolveError(
      `Pocket Casts returned ${res.status} for that link. Is it public?`
    );
  }
  const html = await res.text();

  const uuid = res.url.match(UUID_RE)?.[0] ?? html.match(UUID_RE)?.[0];
  const ogTitle = metaContent(html, "og:title")?.replace(/\s*[-–|].*$/, "");
  const artwork = metaContent(html, "og:image");

  // The Pocket Casts catalog gives us exact title/author, which makes the
  // iTunes directory match (the only public source of the feed URL) reliable.
  const pc = uuid ? await lookupPocketCasts(uuid) : {};
  const title = pc.title ?? ogTitle;

  if (title) {
    const it = await lookupItunes(title, pc.author);
    if (it.feedUrl) {
      return {
        feedUrl: it.feedUrl,
        title: it.title ?? title,
        author: it.author ?? pc.author,
        artwork: it.artwork ?? artwork,
        itunesId: it.itunesId,
        uuid,
        source: "itunes",
      };
    }
  }

  throw new ResolveError(
    "Couldn't recover the RSS feed for this show. It may be private or not listed in any directory."
  );
}
