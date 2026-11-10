import { XMLParser } from "fast-xml-parser";
import { USER_AGENT } from "./site";
import type { Check, CheckLevel, ValidationReport } from "./types";
import { FetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from "./net";

export type { Check, CheckLevel, ValidationReport } from "./types";

export class ValidateError extends Error {}

type Episode = {
  title?: unknown;
  guid?: unknown;
  enclosure?:
    | { "@_url"?: string; "@_type"?: string; "@_length"?: string }
    | { "@_url"?: string; "@_type"?: string; "@_length"?: string }[];
  pubDate?: unknown;
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    return textOf((value as { "#text"?: unknown })["#text"]);
  }
  return undefined;
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function failure(err: unknown): ValidateError {
  if (err instanceof ValidateError) return err;
  if (err instanceof FetchError) {
    if (err.code === "blocked" || err.code === "invalid-url") {
      return new ValidateError("That address isn't a public http(s) URL. Local and private addresses are refused.");
    }
    if (err.code === "too-large") {
      return new ValidateError("The feed is too large to check (limit is 12 MB uncompressed).");
    }
    if (err.code === "too-many-redirects") {
      return new ValidateError("The feed redirected too many times.");
    }
    return new ValidateError("Couldn't reach the feed URL (timeout or network error).");
  }
  return new ValidateError("Couldn't reach the feed URL (timeout or network error).");
}

export async function validateFeed(
  feedUrl: string,
  fetchImpl: (input: string, options: SafeFetchOptions) => Promise<SafeResponse> = safeFetch
): Promise<ValidationReport> {
  const checks: Check[] = [];
  const push = (id: string, level: CheckLevel, title: string, detail: string) =>
    checks.push({ id, level, title, detail });

  let response;
  try {
    response = await fetchImpl(feedUrl, {
      userAgent: USER_AGENT,
      accept: "application/rss+xml, application/xml, text/xml, */*",
      timeoutMs: 12_000,
      maxBytes: 4_000_000,
      maxUncompressedBytes: 12_000_000,
    });
  } catch (err) {
    throw failure(err);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new ValidateError(
      `Feed returned HTTP ${response.status}. Directories and apps can't ingest a feed that doesn't return 200.`
    );
  }
  push("http", "pass", "Feed is reachable", `HTTP ${response.status} from ${response.url}`);

  let finalUrl: URL;
  try {
    finalUrl = new URL(response.url);
  } catch {
    throw new ValidateError("The feed redirected to an address that isn't a valid URL.");
  }

  if (finalUrl.protocol === "https:") {
    push("https", "pass", "Feed is served over HTTPS", response.url);
  } else {
    push(
      "https",
      "warn",
      "Feed is served over plain HTTP",
      "Serve the feed over HTTPS. Some platforms and mobile systems block or downgrade insecure content."
    );
  }

  const contentType = headerValue(response.headers, "content-type");
  if (/xml|rss/i.test(contentType)) {
    push("content-type", "pass", "Content-Type looks right", contentType);
  } else {
    push(
      "content-type",
      "warn",
      "Unexpected Content-Type",
      `Got "${contentType || "none"}". Feeds should be served as application/rss+xml or text/xml.`
    );
  }

  const xml = response.body;
  if (/<!doctype/i.test(xml.slice(0, 4000))) {
    throw new ValidateError("The feed includes a DOCTYPE declaration. Podcast RSS should be a plain document without one.");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: true,
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new ValidateError(
      "The feed isn't valid XML. A stray unescaped & or an unclosed tag is the usual cause."
    );
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (!channel) {
    throw new ValidateError(
      "No <rss><channel> found. Podcast feeds have to be RSS 2.0. Most apps do not ingest Atom."
    );
  }
  push("rss", "pass", "Valid RSS 2.0 structure", "<rss><channel> found");

  const title = textOf(channel.title);
  if (title) push("title", "pass", "Channel has a title", title);
  else push("title", "fail", "Missing <title>", "Apps will show a blank show name.");

  const description = textOf(channel.description) ?? textOf(channel["itunes:summary"]);
  if (description) {
    const preview = description.length > 120 ? `${description.slice(0, 120)}…` : description;
    push("description", "pass", "Channel has a description", preview);
  } else {
    push(
      "description",
      "fail",
      "Missing <description>",
      "Required by Apple and shown on directory pages."
    );
  }

  const language = textOf(channel.language);
  if (language) push("language", "pass", "Language is set", language);
  else {
    push(
      "language",
      "warn",
      "Missing <language>",
      "Set an ISO 639 code such as en or en-us. Directories use it for regional discovery."
    );
  }

  const image = channel["itunes:image"] as { "@_href"?: string } | undefined;
  const imageHref = image?.["@_href"];
  if (imageHref) {
    const secure = imageHref.startsWith("https://");
    push(
      "artwork",
      secure ? "pass" : "warn",
      secure ? "Artwork URL present (HTTPS)" : "Artwork URL is not HTTPS",
      `${imageHref} — square JPG or PNG, between 1400×1400 and 3000×3000.`
    );
  } else {
    push(
      "artwork",
      "fail",
      "Missing <itunes:image>",
      "Apple and most apps require show artwork (square, 1400–3000px)."
    );
  }

  if (channel["itunes:category"]) push("category", "pass", "iTunes category set", "A category element is present.");
  else {
    push(
      "category",
      "warn",
      "Missing <itunes:category>",
      "Without a category the show is left out of directory browse sections."
    );
  }

  const explicit = textOf(channel["itunes:explicit"]);
  if (explicit) push("explicit", "pass", "Explicit flag set", explicit);
  else {
    push(
      "explicit",
      "warn",
      "Missing <itunes:explicit>",
      "Apple requires an explicit rating on every feed."
    );
  }

  if (channel["podcast:guid"]) {
    push(
      "podcast-guid",
      "pass",
      "Has <podcast:guid>",
      "Podcasting 2.0 GUID present. Useful as a stable identity across directories."
    );
  } else {
    push(
      "podcast-guid",
      "info",
      "No <podcast:guid>",
      "Optional. A Podcasting 2.0 GUID gives the show a stable identity across apps and hosts."
    );
  }

  const items = asArray(channel.item as Episode | Episode[] | undefined);
  if (items.length === 0) {
    push("episodes", "fail", "No episodes found", "The feed has no <item> entries.");
    return { feedUrl: response.url, podcastTitle: title, episodeCount: 0, checks };
  }
  push("episodes", "pass", `${items.length} episode(s) found`, "The channel has item entries.");

  const guids = new Map<string, number>();
  let missingEnclosure = 0;
  let insecureEnclosure = 0;
  let missingGuid = 0;
  let badDate = 0;

  for (const item of items) {
    const enclosure = Array.isArray(item.enclosure) ? item.enclosure[0] : item.enclosure;
    const enc = enclosure?.["@_url"];
    if (!enc) missingEnclosure++;
    else if (enc.startsWith("http://")) insecureEnclosure++;

    const guid = textOf(item.guid);
    if (!guid) missingGuid++;
    else guids.set(guid, (guids.get(guid) ?? 0) + 1);

    const pubDate = textOf(item.pubDate);
    if (pubDate && Number.isNaN(Date.parse(pubDate))) badDate++;
  }

  if (missingEnclosure) {
    push(
      "enclosures",
      "fail",
      `${missingEnclosure} episode(s) missing <enclosure>`,
      "Episodes without an enclosure have no audio and will not play."
    );
  } else {
    push("enclosures", "pass", "Every episode has an audio enclosure", "Each item has an enclosure URL.");
  }

  if (insecureEnclosure) {
    push(
      "enclosure-https",
      "warn",
      `${insecureEnclosure} enclosure(s) served over HTTP`,
      "Move audio to HTTPS. Some clients refuse insecure media."
    );
  }

  const dupes = [...guids.entries()].filter(([, count]) => count > 1);
  if (missingGuid) {
    push(
      "guids",
      "fail",
      `${missingGuid} episode(s) missing <guid>`,
      "Apps use GUIDs to track played state. Missing GUIDs cause duplicate or re-downloaded episodes."
    );
  } else if (dupes.length) {
    push(
      "guids",
      "fail",
      `${dupes.length} duplicate GUID(s)`,
      `"${dupes[0][0]}" appears ${dupes[0][1]} times. Duplicate GUIDs make apps hide or merge episodes.`
    );
  } else {
    push("guids", "pass", "GUIDs present and unique on every episode", "No missing or repeated GUIDs.");
  }

  if (badDate) {
    push(
      "dates",
      "warn",
      `${badDate} episode(s) with unparseable <pubDate>`,
      "Use RFC 822 dates, for example Tue, 08 Jul 2026 09:00:00 GMT. Bad dates break episode ordering."
    );
  } else {
    push("dates", "pass", "All publish dates parse correctly", "Every pubDate that is present parses as a date.");
  }

  return {
    feedUrl: response.url,
    podcastTitle: title,
    episodeCount: items.length,
    checks,
  };
}
