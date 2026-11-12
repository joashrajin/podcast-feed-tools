import type { Platform } from "./types";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SPOTIFY_ID_RE = /^[0-9A-Za-z]{22}$/;

export type SpotifyKind = "show" | "episode";

export type SpotifyRef = {
  kind: SpotifyKind;
  id: string;
};

function hostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function appleShowId(url: URL): string | undefined {
  const matches = [...url.pathname.matchAll(/\/id(\d{6,15})(?=\/|$)/g)];
  return matches.at(-1)?.[1];
}

export function spotifyRef(url: URL): SpotifyRef | undefined {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "show" || part === "episode");
  if (index === -1) return undefined;
  const id = parts[index + 1];
  if (!id || !SPOTIFY_ID_RE.test(id)) return undefined;
  return { kind: parts[index] as SpotifyKind, id };
}

/**
 * The show's UUID in a Pocket Casts URL. Show and web-player paths put it
 * first: /podcast/<slug>/<show>/<episode-slug>/<episode> and
 * /podcasts/<show>/<episode>. An /episode/<uuid> share link carries only the
 * episode's UUID, so this returns undefined and the caller follows the
 * redirect, which names the show.
 */
export function pocketCastsUuid(url: URL): string | undefined {
  const first = url.pathname.split("/").find(Boolean)?.toLowerCase();
  if (first === "episode" || first === "episodes") return undefined;
  return url.pathname.match(UUID_RE)?.[0];
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
]);

const SOUNDCLOUD_HOSTS = new Set([
  "soundcloud.com",
  "m.soundcloud.com",
  "on.soundcloud.com",
  "feeds.soundcloud.com",
]);

// First path segments on soundcloud.com that are pages, not profiles.
const SOUNDCLOUD_RESERVED = new Set([
  "discover", "search", "charts", "stream", "upload", "you", "settings", "messages",
  "notifications", "pages", "terms-of-use", "imprint", "jobs", "people", "pro",
  "artists", "creators", "mobile", "popular", "tags", "signin", "signup", "logout",
  "connect", "feed", "home", "player", "oembed", "next", "for-artists", "playlists",
]);

const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/;

export type YouTubeRef =
  | { kind: "channel"; id: string }
  | { kind: "playlist"; id: string }
  /** A handle, custom URL, user, or video page: the channel is read from the page. */
  | { kind: "page"; url: string };

/** What a YouTube link points at, before anything is fetched. */
export function youtubeRef(url: URL): YouTubeRef | undefined {
  const host = hostname(url);
  if (!YOUTUBE_HOSTS.has(host)) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") {
    return parts[0] ? { kind: "page", url: `https://www.youtube.com/watch?v=${encodeURIComponent(parts[0])}` } : undefined;
  }
  const list = url.searchParams.get("list");
  // Mixes (RD…), Watch Later and Liked are per-viewer and have no feed.
  const usableList = list && /^[\w-]{10,}$/.test(list) && !/^(RD|WL|LL)/.test(list) ? list : undefined;
  const first = parts[0] ?? "";
  if (first === "channel" && parts[1] && YOUTUBE_CHANNEL_ID.test(parts[1])) {
    return { kind: "channel", id: parts[1] };
  }
  if (first === "playlist") return usableList ? { kind: "playlist", id: usableList } : undefined;
  if (first === "feeds" && parts[1] === "videos.xml") {
    const channel = url.searchParams.get("channel_id");
    if (channel && YOUTUBE_CHANNEL_ID.test(channel)) return { kind: "channel", id: channel };
    if (usableList) return { kind: "playlist", id: usableList };
    const playlist = url.searchParams.get("playlist_id");
    if (playlist && /^[\w-]{10,}$/.test(playlist)) return { kind: "playlist", id: playlist };
    return undefined;
  }
  if (first === "watch") {
    const video = url.searchParams.get("v");
    if (usableList && !video) return { kind: "playlist", id: usableList };
    return video ? { kind: "page", url: `https://www.youtube.com/watch?v=${encodeURIComponent(video)}` } : undefined;
  }
  if (first.startsWith("@") && first.length > 1) {
    return { kind: "page", url: `https://www.youtube.com/${first}` };
  }
  if ((first === "c" || first === "user") && parts[1]) {
    return { kind: "page", url: `https://www.youtube.com/${first}/${parts[1]}` };
  }
  if ((first === "shorts" || first === "live" || first === "embed") && parts[1]) {
    return { kind: "page", url: `https://www.youtube.com/watch?v=${encodeURIComponent(parts[1])}` };
  }
  return undefined;
}

export type SoundCloudRef =
  | { kind: "user"; username: string }
  /** on.soundcloud.com short link, followed to the full address. */
  | { kind: "short"; url: string }
  | { kind: "feed"; userId: string };

/** The SoundCloud account a link belongs to. A track or set resolves to its uploader. */
export function soundcloudRef(url: URL): SoundCloudRef | undefined {
  const host = hostname(url);
  if (!SOUNDCLOUD_HOSTS.has(host)) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "feeds.soundcloud.com") {
    const id = url.pathname.match(/^\/users\/soundcloud:users:(\d+)\/sounds\.rss$/)?.[1];
    return id ? { kind: "feed", userId: id } : undefined;
  }
  if (host === "on.soundcloud.com") {
    return parts[0] ? { kind: "short", url: `https://on.soundcloud.com/${parts[0]}` } : undefined;
  }
  const first = parts[0]?.toLowerCase();
  if (!first || SOUNDCLOUD_RESERVED.has(first) || !/^[a-z0-9_-]{1,64}$/.test(first)) return undefined;
  return { kind: "user", username: first };
}

export function platformOf(url: URL): Platform | undefined {
  const host = hostname(url);
  if (YOUTUBE_HOSTS.has(host)) return youtubeRef(url) ? "youtube" : undefined;
  if (SOUNDCLOUD_HOSTS.has(host)) return soundcloudRef(url) ? "soundcloud" : undefined;
  if (
    host === "pca.st" ||
    host === "pocketcasts.com" ||
    host === "play.pocketcasts.com"
  ) {
    return "pocketcasts";
  }
  if (
    host === "podcasts.apple.com" ||
    host === "itunes.apple.com" ||
    host === "geo.itunes.apple.com" ||
    host === "embed.podcasts.apple.com"
  ) {
    return appleShowId(url) ? "apple" : undefined;
  }
  if (host === "music.apple.com") {
    return url.pathname.includes("/podcast/") && appleShowId(url)
      ? "apple"
      : undefined;
  }
  if (host === "open.spotify.com" || host === "spotify.com") {
    return spotifyRef(url) ? "spotify" : undefined;
  }
  return undefined;
}

/** A bare domain such as "example.com/blog" gets https:// in front. */
function withScheme(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(input)) {
    return `https://${input}`;
  }
  return input;
}

/**
 * The link and where it's from. A Pocket Casts, Apple Podcasts, Spotify,
 * SoundCloud, or YouTube page has its own route. Any other public address is
 * treated as a website whose feed is discovered.
 */
export function parseShowLink(
  input: string
): { url: URL; platform: Platform } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Paste a link." };
  if (trimmed.length > 2000) return { error: "That URL is too long." };
  let url: URL;
  try {
    url = new URL(withScheme(trimmed));
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Links need to be http or https." };
  }
  const platform = platformOf(url);
  if (platform) return { url, platform };

  const host = hostname(url);
  if (
    host === "podcasts.apple.com" ||
    host === "itunes.apple.com" ||
    host === "geo.itunes.apple.com" ||
    host === "embed.podcasts.apple.com" ||
    host === "music.apple.com"
  ) {
    return {
      error: "That Apple link has no podcast id. Use a show or episode page.",
    };
  }
  if (host === "open.spotify.com" || host === "spotify.com") {
    return {
      error: "That Spotify link isn't a show or an episode.",
    };
  }
  if (YOUTUBE_HOSTS.has(host)) {
    return { error: "Use a YouTube channel, handle (@name), playlist, or video link." };
  }
  if (SOUNDCLOUD_HOSTS.has(host)) {
    return { error: "Use a SoundCloud profile or track link." };
  }
  if (!host.includes(".")) return { error: "That doesn't look like a public website." };
  return { url, platform: "website" };
}

export function detectPlatform(input: string): Platform | null {
  const parsed = parseShowLink(input);
  return "platform" in parsed ? parsed.platform : null;
}
