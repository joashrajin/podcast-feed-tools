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

// Words that say what kind of publisher it is, not which one.
const FILLER = new Set([
  "a", "an", "and", "by", "co", "company", "entertainment", "group", "inc", "llc",
  "ltd", "media", "network", "networks", "of", "official", "podcast", "podcasts",
  "presents", "production", "productions", "studio", "studios", "the",
]);

function significantWords(normalized: string): string[] {
  return normalized.split(" ").filter((word) => word && !FILLER.has(word));
}

/**
 * Directories word the same publisher differently: "Wondery | Morbid Network"
 * against "Morbid Network | Wondery", "NYT" against "The New York Times",
 * "iHeartPodcasts" against "iHeart Podcasts". Names count as the same when
 * they share a distinctive word or one is the other's acronym.
 */
export function samePublisher(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y || x === y) return true;
  if (x.replace(/ /g, "") === y.replace(/ /g, "")) return true;

  const xs = significantWords(x);
  const ys = significantWords(y);
  // Nothing distinctive on one side, so there is nothing to disagree on.
  if (xs.length === 0 || ys.length === 0) return true;

  const theirs = new Set(ys);
  if (xs.some((word) => word.length >= 3 && theirs.has(word))) return true;

  const initials = (words: string[]) => words.map((word) => word[0]).join("");
  if (xs.length === 1 && ys.length > 1 && initials(ys) === xs[0]) return true;
  if (ys.length === 1 && xs.length > 1 && initials(xs) === ys[0]) return true;
  return false;
}

function publisherConflicts(hit: DirectoryHit, author?: string): boolean {
  if (!author?.trim() || !hit.author?.trim()) return false;
  return !samePublisher(hit.author, author);
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

  // An exact publisher match beats a loose one. "The New York Times" should
  // pick that show over "The New York Times One" with the same title.
  const wantedAuthor = author ? normalizeName(author) : "";
  const sameAuthor = wantedAuthor
    ? exact.filter((hit) => normalizeName(hit.author ?? "") === wantedAuthor)
    : [];
  const compatible = sameAuthor.length
    ? sameAuthor
    : exact.filter((hit) => !publisherConflicts(hit, author));
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
