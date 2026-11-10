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
  | { status: "conflict"; hit: DirectoryHit }
  | { status: "ambiguous"; candidates: DirectoryHit[] };

/** Fold case, accents, and punctuation. Letters outside Latin, including CJK, stay. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function publisherConflicts(hit: DirectoryHit, author?: string): boolean {
  if (!author?.trim()) return false;
  const wanted = normalizeName(author);
  if (!wanted) return false;
  const got = normalizeName(hit.author ?? "");
  if (!got) return false;
  return got !== wanted;
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

  const compatible = exact.filter((hit) => !publisherConflicts(hit, author));
  if (compatible.length === 0) return { status: "conflict", hit: exact[0] };
  if (compatible.length === 1) return { status: "match", hit: compatible[0] };

  const feeds = new Set(compatible.map((hit) => hit.feedUrl));
  if (feeds.size === 1) return { status: "match", hit: compatible[0] };

  return { status: "ambiguous", candidates: compatible.slice(0, 4) };
}

export function candidateLabel(hit: DirectoryHit): string {
  const name = hit.title?.trim() || "Untitled";
  const author = hit.author?.trim();
  return author ? `${name} — ${author}` : name;
}
