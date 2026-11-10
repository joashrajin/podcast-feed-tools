export type DirectoryHit = {
  title?: string;
  author?: string;
  feedUrl?: string;
  artwork?: string;
  itunesId?: number;
};

export type MatchOutcome =
  | { status: "match"; hit: DirectoryHit }
  | { status: "none" }
  | { status: "ambiguous"; candidates: DirectoryHit[] };

/** Fold case, accents, and punctuation so "Science Vs." and "science vs" compare equal. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Pick a directory hit only when the title matches exactly (after
 * normalization). The first search result is never a match on its own.
 * When several shows share a title, the publisher has to break the tie,
 * or every remaining hit has to point at the same feed.
 */
export function pickDirectoryHit(
  hits: DirectoryHit[],
  title: string,
  author?: string
): MatchOutcome {
  const wanted = normalizeName(title);
  if (!wanted) return { status: "none" };

  const exact = hits.filter(
    (hit) => hit.feedUrl && hit.title && normalizeName(hit.title) === wanted
  );
  if (exact.length === 0) return { status: "none" };
  if (exact.length === 1) return { status: "match", hit: exact[0] };

  const feeds = new Set(exact.map((hit) => hit.feedUrl));
  if (feeds.size === 1) return { status: "match", hit: exact[0] };

  if (author) {
    const wantedAuthor = normalizeName(author);
    if (wantedAuthor) {
      const byAuthor = exact.filter(
        (hit) => normalizeName(hit.author ?? "") === wantedAuthor
      );
      if (byAuthor.length === 1) return { status: "match", hit: byAuthor[0] };
      if (byAuthor.length > 1) {
        const authorFeeds = new Set(byAuthor.map((hit) => hit.feedUrl));
        if (authorFeeds.size === 1) return { status: "match", hit: byAuthor[0] };
        return { status: "ambiguous", candidates: byAuthor.slice(0, 4) };
      }
    }
  }

  return { status: "ambiguous", candidates: exact.slice(0, 4) };
}

export function candidateLabel(hit: DirectoryHit): string {
  const name = hit.title?.trim() || "Untitled";
  const author = hit.author?.trim();
  return author ? `${name} — ${author}` : name;
}
