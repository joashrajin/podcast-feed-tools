import { formatDuration } from "../feed-stats";
import { safeFetch, type SafeFetchOptions, type SafeResponse } from "../net";
import {
  catalogFeedUrl,
  identifyShow,
  pocketCastsShowId,
  readPocketCastsShow,
  ResolveError,
  searchItunes,
  type PocketCastsEpisode,
  type PocketCastsShow,
} from "../resolve";
import { pocketCastsShowUrl } from "../search";
import { SearchError, searchPocketCasts } from "../search-server";
import type { FeedEpisode } from "../types";
import { inspectFeed, ValidateError } from "../validate";
import { errorResult, textResult, type Tool, type ToolResult } from "./server";

type Fetch = (input: string, options: SafeFetchOptions) => Promise<SafeResponse>;
export type ToolDeps = { fetch?: Fetch };

class ArgError extends Error {}

function text(args: Record<string, unknown>, key: string, max: number, required: true): string;
function text(args: Record<string, unknown>, key: string, max: number, required?: false): string | undefined;
function text(args: Record<string, unknown>, key: string, max: number, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new ArgError(`${key} is required.`);
    return undefined;
  }
  if (typeof value !== "string") throw new ArgError(`${key} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new ArgError(`${key} is required.`);
  if (trimmed.length > max) throw new ArgError(`${key} is longer than ${max} characters.`);
  return trimmed || undefined;
}

function count(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new ArgError(`${key} must be a whole number.`);
  return Math.min(max, Math.max(min, n));
}

function flag(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  return value === true || value === "true";
}

function login(args: Record<string, unknown>) {
  const username = text(args, "username", 500);
  const password = text(args, "password", 500);
  if (username?.includes(":")) throw new ArgError("A username for HTTP sign-in can't contain a colon.");
  return username || password ? { username: username ?? "", password: password ?? "" } : undefined;
}

const duration = (seconds: number | undefined) => (seconds && seconds > 0 ? formatDuration(seconds) : undefined);

const LOGIN_PROPERTIES = {
  username: { type: "string", description: "Only for a feed behind HTTP Basic sign-in. Sent once, over HTTPS, to the feed's own host." },
  password: { type: "string", description: "Only for a feed behind HTTP Basic sign-in." },
};

const SHOW_PROPERTY = {
  type: "string",
  description: "A Pocket Casts link (pca.st/…, pocketcasts.com/podcast/…, episode share links work too) or a show UUID.",
};

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

/** Run a tool body, turning expected failures into a tool error the model can read. */
async function attempt(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof ArgError || err instanceof ResolveError || err instanceof SearchError) {
      return errorResult(err.message);
    }
    if (err instanceof ValidateError) {
      return errorResult(
        err.needsLogin
          ? `${err.message} Pass username and password if you have them.`
          : err.message
      );
    }
    throw err;
  }
}

function showSummary(show: PocketCastsShow) {
  const newest = show.episodes[0];
  return {
    uuid: show.uuid,
    title: show.title,
    author: show.author,
    pocketCastsUrl: pocketCastsShowUrl(show.uuid),
    website: show.website,
    private: show.isPrivate,
    showType: show.showType,
    categories: show.categories,
    explicit: show.explicit,
    episodeCount: show.episodeCount,
    listingIsPartial: show.hasMoreEpisodes || undefined,
    episodeFrequency: show.episodeFrequency,
    newestEpisodeAt: newest?.published,
    estimatedNextEpisodeAt: show.estimatedNextEpisodeAt,
  };
}

function pocketCastsEpisode(episode: PocketCastsEpisode, withFile: boolean) {
  return {
    title: episode.title,
    published: episode.published,
    duration: duration(episode.durationSeconds),
    type: episode.type,
    fileType: episode.fileType,
    fileBytes: episode.fileSize,
    ...(withFile ? { fileUrl: episode.url } : {}),
    uuid: episode.uuid,
  };
}

function feedEpisode(episode: FeedEpisode, duplicateGuids?: Set<string>) {
  return {
    title: episode.title,
    published: episode.published ?? (episode.pubDate ? `unparseable: ${episode.pubDate}` : undefined),
    guid: episode.guid,
    ...(episode.guid && duplicateGuids?.has(episode.guid) ? { duplicateGuid: true } : {}),
    episode: episode.episode,
    season: episode.season,
    type: episode.episodeType,
    duration: duration(episode.durationSeconds),
    fileUrl: episode.enclosureUrl,
    fileType: episode.enclosureType,
    fileBytes: episode.enclosureLength,
    ...(episode.blocked ? { blocked: true } : {}),
  };
}

const normalTitle = (title: string | undefined) =>
  title?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim() || undefined;

export function tools(deps: ToolDeps = {}): Tool[] {
  const fetch = deps.fetch ?? safeFetch;
  const resolverDeps = { fetch };

  return [
    {
      name: "search_pocket_casts",
      title: "Search Pocket Casts",
      description:
        "Search the Pocket Casts directory by show name, the same search the Pocket Casts website runs. Returns each show's UUID and Pocket Casts link, for the other tools.",
      inputSchema: schema(
        {
          query: { type: "string", description: "Show name, or words from it." },
          limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
        },
        ["query"]
      ),
      run: (args) =>
        attempt(async () => {
          const query = text(args, "query", 200, true);
          const shows = await searchPocketCasts(query, count(args, "limit", 10, 1, 25), fetch);
          return textResult({
            query,
            shows: shows.map((show) => ({
              uuid: show.uuid,
              title: show.title,
              author: show.author,
              pocketCastsUrl: show.url,
              explicit: show.explicit ?? undefined,
            })),
          });
        }),
    },
    {
      name: "get_pocket_casts_show",
      title: "Show in Pocket Casts",
      description:
        "What Pocket Casts' catalog has for a show: title, author, whether it's private, episode count, publishing frequency, newest episode date, when the next episode is expected, and the newest episodes. Use it to see what Pocket Casts currently shows listeners.",
      inputSchema: schema(
        {
          show: SHOW_PROPERTY,
          episodes: { type: "integer", minimum: 0, maximum: 100, default: 10, description: "How many of the newest episodes to list." },
          include_file_urls: { type: "boolean", default: false, description: "Add each episode's audio file URL." },
        },
        ["show"]
      ),
      run: (args) =>
        attempt(async () => {
          const uuid = await pocketCastsShowId(text(args, "show", 2000, true), resolverDeps);
          const show = await readPocketCastsShow(uuid, resolverDeps);
          const limit = count(args, "episodes", 10, 0, 100);
          const withFile = flag(args, "include_file_urls");
          return textResult({
            ...showSummary(show),
            episodes: show.episodes.slice(0, limit).map((episode) => pocketCastsEpisode(episode, withFile)),
          });
        }),
    },
    {
      name: "find_feed_url",
      title: "Find a show's RSS feed",
      description:
        "Turn a Pocket Casts, Apple Podcasts, or Spotify show or episode link into the show's public RSS feed URL.",
      inputSchema: schema({ link: { type: "string", description: "A show or episode link." } }, ["link"]),
      run: (args) =>
        attempt(async () => {
          const link = text(args, "link", 2000, true);
          const identified = await identifyShow(link, resolverDeps);
          if ("result" in identified) return textResult(identified.result);
          try {
            return textResult(await searchItunes(identified.search, resolverDeps));
          } catch (err) {
            if (!(err instanceof ResolveError)) throw err;
            return errorResult(
              `${err.message} The show is "${identified.search.title}"${
                identified.search.author ? ` by ${identified.search.author}` : ""
              }. Matching it to a feed needs Apple's search, which can refuse this server. If the feed URL is known some other way, use it with the feed tools.`
            );
          }
        }),
    },
    {
      name: "check_feed",
      title: "Check an RSS feed",
      description:
        "Fetch a podcast RSS feed, public or private, and report the show (title, author, episode count, last published, cadence, durations, artwork, categories) and every problem found: missing tags, episodes without audio files, duplicate or missing GUIDs, bad dates, HTTP instead of HTTPS. Audio files are not downloaded.",
      inputSchema: schema(
        { feed_url: { type: "string", description: "The RSS feed URL. Private links work." }, ...LOGIN_PROPERTIES },
        ["feed_url"]
      ),
      run: (args) =>
        attempt(async () => {
          const { report } = await inspectFeed(text(args, "feed_url", 2000, true), fetch, login(args));
          const summary = report.summary;
          return textResult({
            feedUrl: report.feedUrl,
            title: summary.title,
            author: summary.author,
            episodeCount: summary.episodeCount,
            lastPublished: summary.lastPublished,
            cadence: summary.cadence,
            averageDuration: summary.averageDuration,
            language: summary.language,
            explicit: summary.explicit,
            categories: summary.categories,
            artwork: summary.artworkUrl ? { url: summary.artworkUrl, size: summary.artworkSize } : undefined,
            fileTypes: summary.enclosureTypes,
            problems: report.checks
              .filter((check) => check.level !== "pass")
              .map((check) => ({ level: check.level, title: check.title, detail: check.detail })),
            passed: report.checks.filter((check) => check.level === "pass").map((check) => check.title),
          });
        }),
    },
    {
      name: "list_feed_episodes",
      title: "List a feed's episodes",
      description:
        "List the episodes in a podcast RSS feed as the feed states them, newest first: title, publish date, GUID, episode and season numbers, type, duration, and audio file URL, type and size. Duplicate GUIDs are flagged.",
      inputSchema: schema(
        {
          feed_url: { type: "string", description: "The RSS feed URL. Private links work." },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
          offset: { type: "integer", minimum: 0, default: 0, description: "Skip this many of the newest episodes first." },
          title_contains: { type: "string", description: "Only episodes whose title contains this text, ignoring case." },
          ...LOGIN_PROPERTIES,
        },
        ["feed_url"]
      ),
      run: (args) =>
        attempt(async () => {
          const { report, episodes } = await inspectFeed(text(args, "feed_url", 2000, true), fetch, login(args));
          const seen = new Map<string, number>();
          for (const episode of episodes) if (episode.guid) seen.set(episode.guid, (seen.get(episode.guid) ?? 0) + 1);
          const duplicates = new Set([...seen].filter(([, n]) => n > 1).map(([guid]) => guid));
          const needle = text(args, "title_contains", 200)?.toLowerCase();
          const matching = needle ? episodes.filter((episode) => episode.title?.toLowerCase().includes(needle)) : episodes;
          const offset = count(args, "offset", 0, 0, 100_000);
          const page = matching.slice(offset, offset + count(args, "limit", 20, 1, 200));
          return textResult({
            feedUrl: report.feedUrl,
            title: report.summary.title,
            episodeCount: episodes.length,
            ...(needle ? { matching: matching.length } : {}),
            offset,
            returned: page.length,
            episodes: page.map((episode) => feedEpisode(episode, duplicates)),
          });
        }),
    },
    {
      name: "compare_feed_with_pocket_casts",
      title: "Compare a feed with Pocket Casts",
      description:
        "Compare a show's RSS feed with what Pocket Casts' catalog has, to explain a missing or late episode. Reports both episode counts, the newest episode on each side, feed episodes Pocket Casts doesn't have, Pocket Casts episodes no longer in the feed, and the feed's own problems. Episodes are matched by audio file URL or exact title.",
      inputSchema: schema(
        {
          show: SHOW_PROPERTY,
          feed_url: {
            type: "string",
            description: "The show's RSS feed. Optional: when left out it's worked out from Pocket Casts and Apple, which doesn't always succeed.",
          },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Most episodes to list on each side." },
          ...LOGIN_PROPERTIES,
        },
        ["show"]
      ),
      run: (args) =>
        attempt(async () => {
          const uuid = await pocketCastsShowId(text(args, "show", 2000, true), resolverDeps);
          const show = await readPocketCastsShow(uuid, resolverDeps);
          const limit = count(args, "limit", 20, 1, 100);

          let feedUrl = text(args, "feed_url", 2000);
          let feedSource = "given";
          if (!feedUrl) {
            feedUrl = await catalogFeedUrl(show, resolverDeps);
            feedSource = "pocket-casts-catalog";
          }
          if (!feedUrl && show.title) {
            try {
              feedUrl = (await searchItunes({ title: show.title, author: show.author, platform: "pocketcasts" }, resolverDeps)).feedUrl;
              feedSource = "apple-search";
            } catch (err) {
              if (!(err instanceof ResolveError)) throw err;
            }
          }
          if (!feedUrl) {
            return errorResult(
              `Couldn't work out the RSS feed for "${show.title ?? uuid}". Pocket Casts lists ${show.website ?? "no address"} for it, which isn't a feed, and Apple's search didn't give one. Pass feed_url.`
            );
          }

          const { report, episodes: feed } = await inspectFeed(feedUrl, fetch, login(args));
          const pc = show.episodes;
          const pcUrls = new Set(pc.map((episode) => episode.url).filter(Boolean));
          const pcTitles = new Set(pc.map((episode) => normalTitle(episode.title)).filter(Boolean));
          const feedUrls = new Set(feed.map((episode) => episode.enclosureUrl).filter(Boolean));
          const feedTitles = new Set(feed.map((episode) => normalTitle(episode.title)).filter(Boolean));

          // When the catalog lists only recent episodes, older feed episodes can't be judged.
          const oldestListed = show.hasMoreEpisodes ? pc[pc.length - 1]?.published : undefined;
          const compared = oldestListed
            ? feed.filter((episode) => !episode.published || episode.published >= oldestListed)
            : feed;
          const missing = compared.filter(
            (episode) =>
              !(episode.enclosureUrl && pcUrls.has(episode.enclosureUrl)) &&
              !(normalTitle(episode.title) && pcTitles.has(normalTitle(episode.title)))
          );
          const gone = pc.filter(
            (episode) =>
              !(episode.url && feedUrls.has(episode.url)) &&
              !(normalTitle(episode.title) && feedTitles.has(normalTitle(episode.title)))
          );

          const newestPc = pc[0];
          const newestFeed = feed[0];
          const newerThanPc = newestPc?.published
            ? missing.filter((episode) => episode.published && episode.published > newestPc.published!)
            : missing;
          const findings: string[] = [];
          if (!missing.length) {
            findings.push(
              oldestListed
                ? `Pocket Casts has every feed episode published since ${oldestListed}, the oldest it lists.`
                : "Pocket Casts has every episode in the feed."
            );
          } else if (newerThanPc.length === missing.length) {
            findings.push(
              `Pocket Casts hasn't picked up the ${missing.length} newest feed episode(s) yet. Its newest is "${newestPc?.title ?? "none"}" (${newestPc?.published ?? "no date"}).`
            );
          } else {
            findings.push(
              `${missing.length} feed episode(s) aren't in Pocket Casts' listing, including ones older than its newest. A changed title and file URL, a blocked episode, or an episode Pocket Casts couldn't read are the usual reasons.`
            );
          }
          if (gone.length) {
            findings.push(
              `${gone.length} episode(s) in Pocket Casts are no longer in the feed under the same file URL or title. They were removed from the feed or changed both.`
            );
          }
          const problems = report.checks.filter((check) => check.level === "fail" || check.level === "warn");
          if (problems.length) findings.push(`The feed has ${problems.length} problem(s) of its own, listed under feedProblems.`);

          return textResult({
            findings,
            show: { uuid, title: show.title, pocketCastsUrl: pocketCastsShowUrl(uuid) },
            feedUrl: report.feedUrl,
            feedSource,
            feed: {
              episodeCount: feed.length,
              newest: newestFeed ? { title: newestFeed.title, published: newestFeed.published } : undefined,
            },
            pocketCasts: {
              episodeCount: show.episodeCount,
              listed: pc.length,
              listingIsPartial: show.hasMoreEpisodes || undefined,
              newest: newestPc ? { title: newestPc.title, published: newestPc.published } : undefined,
              episodeFrequency: show.episodeFrequency,
              estimatedNextEpisodeAt: show.estimatedNextEpisodeAt,
            },
            missingFromPocketCasts: {
              count: missing.length,
              episodes: missing.slice(0, limit).map((episode) => feedEpisode(episode)),
            },
            inPocketCastsNotInFeed: {
              count: gone.length,
              episodes: gone.slice(0, limit).map((episode) => pocketCastsEpisode(episode, true)),
            },
            feedProblems: problems.map((check) => ({ level: check.level, title: check.title, detail: check.detail })),
          });
        }),
    },
  ];
}

export const INSTRUCTIONS = [
  "Read-only tools for debugging podcasts, especially in Pocket Casts.",
  "Start from a Pocket Casts link, a show UUID, or search_pocket_casts.",
  "get_pocket_casts_show shows what Pocket Casts has. check_feed finds problems in the RSS feed. list_feed_episodes shows what the feed itself says.",
  "When an episode is missing or Pocket Casts looks out of date, use compare_feed_with_pocket_casts.",
  "find_feed_url turns a Pocket Casts, Apple Podcasts, or Spotify link into the feed URL.",
  "Feed URLs can be private links. Nothing sent to these tools is stored.",
].join(" ");
