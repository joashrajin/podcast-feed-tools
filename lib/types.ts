export type Platform = "pocketcasts" | "apple" | "spotify";

export type MatchSource = "pocketcasts-catalog" | "itunes-lookup" | "itunes-search";

export type ResolveResult = {
  feedUrl: string;
  title?: string;
  author?: string;
  artwork?: string;
  itunesId?: number;
  platform: Platform;
  matchedBy: MatchSource;
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
