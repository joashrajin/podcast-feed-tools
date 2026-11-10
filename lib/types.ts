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

export type ValidationReport = {
  feedUrl: string;
  podcastTitle?: string;
  episodeCount: number;
  checks: Check[];
};
