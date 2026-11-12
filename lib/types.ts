export type Platform = "pocketcasts" | "apple" | "spotify" | "soundcloud" | "youtube" | "website";

export type MatchSource =
  | "pocketcasts-catalog"
  | "itunes-lookup"
  | "itunes-search"
  | "soundcloud-profile"
  | "youtube-channel"
  | "youtube-playlist"
  /** The link itself answered as RSS or Atom. */
  | "direct"
  /** A <link rel="alternate"> in the page names the feed. */
  | "page-link"
  /** A host whose feed address follows a known pattern (Substack, Medium, …). */
  | "known-pattern"
  /** A common feed path on the site answered as RSS or Atom. */
  | "common-path";

/** Another feed the same page lists, such as comments or a category. */
export type OtherFeed = { url: string; title?: string };

export type ResolveResult = {
  feedUrl: string;
  title?: string;
  author?: string;
  artwork?: string;
  itunesId?: number;
  platform: Platform;
  matchedBy: MatchSource;
  /** Website discovery only: the other feeds the page lists. */
  otherFeeds?: OtherFeed[];
  /** Something worth knowing about the feed, such as it having no items yet. */
  note?: string;
};

export type CheckLevel = "pass" | "warn" | "fail" | "info";

export type Check = {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
};

export type EnclosureKind = { type: string; count: number };

export type FeedSummary = {
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  explicit?: string;
  categories: string[];
  artworkUrl?: string;
  artworkSize?: string;
  lastPublished?: string;
  cadence?: string;
  episodeCount: number;
  episodesWithDuration: number;
  averageDuration?: string;
  totalDuration?: string;
  enclosureTypes: EnclosureKind[];
  itunesTags: string[];
  podcastTags: string[];
};

export type ValidationReport = {
  feedUrl: string;
  podcastTitle?: string;
  episodeCount: number;
  summary: FeedSummary;
  checks: Check[];
};

/** One <item> as the feed states it. */
export type FeedEpisode = {
  title?: string;
  guid?: string;
  /** ISO time, when <pubDate> parses. */
  published?: string;
  /** The raw <pubDate>, kept only when it doesn't parse. */
  pubDate?: string;
  enclosureUrl?: string;
  enclosureType?: string;
  enclosureLength?: number;
  durationSeconds?: number;
  episode?: string;
  season?: string;
  episodeType?: string;
  /** <itunes:block>yes</itunes:block> on the item. */
  blocked?: boolean;
};
