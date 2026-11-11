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

export function platformOf(url: URL): Platform | undefined {
  const host = hostname(url);
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

export function parseShowLink(
  input: string
): { url: URL; platform: Platform } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Paste a show link." };
  if (trimmed.length > 2000) return { error: "That URL is too long." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Show links need to be http or https." };
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
  return {
    error:
      "Paste a Pocket Casts, Apple Podcasts, or Spotify link to a show or episode.",
  };
}

export function detectPlatform(input: string): Platform | null {
  const parsed = parseShowLink(input);
  return "platform" in parsed ? parsed.platform : null;
}
