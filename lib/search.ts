// Shared with the browser (app/search-form.tsx), so nothing here may import
// server-only code. The server-side search is in search-server.ts.
/** Pocket Casts support, "Submitting Podcasts" and "Linking to my show", both name this form. */
export const POCKET_CASTS_SUBMIT_URL = "https://pocketcasts.com/submit/";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PocketCastsHit = {
  uuid: string;
  title: string;
  author?: string;
  url: string;
  artwork?: string;
  explicit: boolean | null;
};

export function pocketCastsShowUrl(uuid: string, slug?: string): string | undefined {
  if (!UUID_RE.test(uuid)) return undefined;
  if (slug && SLUG_RE.test(slug)) {
    return `https://pocketcasts.com/podcast/${slug}/${uuid}`;
  }
  return `https://pocketcasts.com/podcasts/${uuid}`;
}

export function artworkUrl(uuid: string): string {
  return `https://static.pocketcasts.com/discover/images/webp/480/${uuid}.webp`;
}

type RawResult = {
  type?: unknown;
  uuid?: unknown;
  title?: unknown;
  author?: unknown;
  slug?: unknown;
  explicit?: unknown;
};

/** `null` means the payload is not a search result. An empty array means no shows. */
export function podcastHitsFromSearch(payload: unknown, limit = 12): PocketCastsHit[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const seen = new Set<string>();
  const hits: PocketCastsHit[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const row = item as RawResult;
    if (row.type !== "podcast") continue;
    if (typeof row.uuid !== "string" || typeof row.title !== "string") continue;
    const title = row.title.trim();
    if (!title || seen.has(row.uuid)) continue;
    const url = pocketCastsShowUrl(row.uuid, typeof row.slug === "string" ? row.slug : undefined);
    if (!url) continue;
    seen.add(row.uuid);
    hits.push({
      uuid: row.uuid,
      title,
      author: typeof row.author === "string" && row.author.trim() ? row.author.trim() : undefined,
      url,
      artwork: artworkUrl(row.uuid),
      explicit: typeof row.explicit === "boolean" ? row.explicit : null,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

