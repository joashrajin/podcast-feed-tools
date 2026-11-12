import { XMLParser, XMLValidator } from "fast-xml-parser";
import { USER_AGENT } from "./site";
import type { Check, CheckLevel, EnclosureKind, FeedSummary, ValidationReport } from "./types";
import { describeCadence, durationSeconds, formatDuration } from "./feed-stats";
import { imageSize } from "./image-size";
import { FetchError, safeFetch, type BasicAuth, type SafeFetchOptions, type SafeResponse } from "./net";

export type { Check, CheckLevel, ValidationReport } from "./types";
export type { BasicAuth } from "./net";

export class ValidateError extends Error {
  /** True when the feed asked for a username and password. */
  constructor(message: string, readonly needsLogin = false) {
    super(message);
  }
}

/**
 * Take a username and password out of the URL (https://user:pass@host/feed),
 * so they travel as a header and never appear in the report. Credentials
 * given separately win over ones in the URL.
 */
export function splitCredentials(raw: string, given?: Partial<BasicAuth>): { url: string; auth?: BasicAuth } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { url: raw, auth: completeAuth(given) };
  }
  let inUrl: BasicAuth | undefined;
  if (url.username || url.password) {
    try {
      inUrl = { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
    } catch {
      inUrl = { username: url.username, password: url.password };
    }
    url.username = "";
    url.password = "";
  }
  return { url: url.toString(), auth: completeAuth(given) ?? inUrl };
}

function completeAuth(given?: Partial<BasicAuth>): BasicAuth | undefined {
  if (!given?.username && !given?.password) return undefined;
  return { username: given.username ?? "", password: given.password ?? "" };
}

const ITUNES_TAGS = [
  "itunes:author",
  "itunes:owner",
  "itunes:image",
  "itunes:category",
  "itunes:explicit",
  "itunes:type",
  "itunes:complete",
  "itunes:new-feed-url",
  "itunes:block",
  "itunes:subtitle",
  "itunes:summary",
];

const PODCAST_TAGS = [
  "podcast:guid",
  "podcast:medium",
  "podcast:locked",
  "podcast:funding",
  "podcast:txt",
  "podcast:trailer",
  "podcast:podroll",
  "podcast:images",
  "podcast:person",
  "podcast:location",
  "podcast:id",
];

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
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

/** Drop CDATA sections. Linear, so a feed full of unclosed openers can't stall it. */
export function withoutCdata(xml: string): string {
  let out = "";
  let from = 0;
  while (true) {
    const start = xml.indexOf("<![CDATA[", from);
    if (start === -1) return out + xml.slice(from);
    out += xml.slice(from, start);
    const end = xml.indexOf("]]>", start + 9);
    // Unclosed: keep the rest, so nothing after it escapes the check.
    if (end === -1) return out + xml.slice(start);
    from = end + 3;
  }
}

function failure(err: unknown): ValidateError {
  if (err instanceof ValidateError) return err;
  if (err instanceof FetchError) {
    if (err.code === "bad-redirect") {
      return new ValidateError("The feed redirected to an address that isn't a valid URL.");
    }
    if (err.code === "blocked" || err.code === "invalid-url") {
      return new ValidateError("That address isn't a public http(s) URL. Local and private addresses are refused.");
    }
    if (err.code === "too-large") {
      return new ValidateError("The feed is too large to check (limit is 12 MB uncompressed).");
    }
    if (err.code === "too-many-redirects") {
      return new ValidateError("The feed redirected too many times.");
    }
    if (err.code === "insecure-auth") {
      return new ValidateError(
        "A username and password are only sent over HTTPS, and this feed's address is plain HTTP. Serve the feed over HTTPS so the login can't be read in transit."
      );
    }
    return new ValidateError("Couldn't reach the feed URL (timeout or network error).");
  }
  return new ValidateError("Couldn't reach the feed URL (timeout or network error).");
}

function categoriesOf(value: unknown, out: string[] = []): string[] {
  for (const node of asArray(value as object | object[] | undefined)) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const text = textOf(record["@_text"]);
    if (text) out.push(text);
    if (record["itunes:category"]) categoriesOf(record["itunes:category"], out);
  }
  return out;
}

function ownerName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return textOf(value);
  const record = value as Record<string, unknown>;
  return textOf(record["itunes:name"]) ?? textOf(record["#text"]);
}

function presentTags(channel: Record<string, unknown>, names: string[]): string[] {
  return names.filter((name) => channel[name] !== undefined && channel[name] !== null && channel[name] !== "");
}

async function artworkDimensions(
  href: string | undefined,
  fetchImpl: (input: string, options: SafeFetchOptions) => Promise<SafeResponse>
): Promise<string | undefined> {
  if (!href || !href.startsWith("https://")) return undefined;
  try {
    const response = await fetchImpl(href, {
      userAgent: USER_AGENT,
      accept: "image/*",
      timeoutMs: 8000,
      maxBytes: 65_536,
      maxUncompressedBytes: 65_536,
      allowPartial: true,
    });
    if (response.status < 200 || response.status >= 300) return undefined;
    const bytes = response.bytes;
    if (!bytes) return undefined;
    const size = imageSize(bytes);
    return size ? `${size.width}×${size.height}` : undefined;
  } catch {
    return undefined;
  }
}

function refusedAccess(response: SafeResponse, auth: BasicAuth | undefined): ValidateError | undefined {
  if (response.status === 401) {
    const scheme = headerValue(response.headers, "www-authenticate").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (scheme && scheme !== "basic") {
      return new ValidateError(
        `The feed asks for ${scheme} sign-in (HTTP 401). This checker can send a username and password (Basic) only, which is what podcast apps support.`
      );
    }
    return new ValidateError(
      auth
        ? "The feed refused that username and password (HTTP 401). Check them, then try again."
        : "The feed needs a username and password (HTTP 401). Enter them, then check again.",
      !auth
    );
  }
  if (response.status === 403 || response.status === 404 || response.status === 410) {
    return new ValidateError(
      `Feed returned HTTP ${response.status}. Apps can't ingest a feed that doesn't return 200. If this is a private feed link, it may have been reset, or the membership behind it may have ended.`
    );
  }
  return undefined;
}

export async function validateFeed(
  feedUrl: string,
  fetchImpl: (input: string, options: SafeFetchOptions) => Promise<SafeResponse> = safeFetch,
  login?: Partial<BasicAuth>
): Promise<ValidationReport> {
  const checks: Check[] = [];
  const push = (id: string, level: CheckLevel, title: string, detail: string) =>
    checks.push({ id, level, title, detail });

  const { url: target, auth } = splitCredentials(feedUrl, login);

  let response;
  try {
    response = await fetchImpl(target, {
      userAgent: USER_AGENT,
      accept: "application/rss+xml, application/xml, text/xml, */*",
      timeoutMs: 12_000,
      maxBytes: 12_000_000,
      maxUncompressedBytes: 12_000_000,
      ...(auth ? { basicAuth: auth } : {}),
    });
  } catch (err) {
    throw failure(err);
  }

  const refused = refusedAccess(response, auth);
  if (refused) throw refused;
  if (response.status < 200 || response.status >= 300) {
    throw new ValidateError(
      `Feed returned HTTP ${response.status}. Directories and apps can't ingest a feed that doesn't return 200.`
    );
  }
  if (auth) {
    push("login", "pass", "Username and password accepted", "The feed returned 200 with the login you gave.");
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
  // A DTD can declare entities, so a feed with one is refused. Show notes
  // often paste a whole HTML page, <!DOCTYPE html> included, inside CDATA.
  // The parser reads CDATA as text, so it is left out of the check.
  if (/<!doctype/i.test(withoutCdata(xml))) {
    throw new ValidateError(
      "The feed includes a DOCTYPE declaration. Podcast RSS should be a plain document without one."
    );
  }

  const validated = XMLValidator.validate(xml);
  if (validated !== true) {
    const line = validated.err?.line;
    throw new ValidateError(
      `The feed isn't valid XML${line ? ` (line ${line})` : ""}. A stray unescaped & or an unclosed tag is the usual cause.`
    );
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new ValidateError("The feed isn't valid XML. A stray unescaped & or an unclosed tag is the usual cause.");
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (!channel) {
    throw new ValidateError(
      "No <rss><channel> found. Podcast feeds have to be RSS 2.0. Most apps do not ingest Atom."
    );
  }
  const version = textOf(rss?.["@_version"]);
  if (version === "2.0") {
    push("rss", "pass", "Valid RSS 2.0", "<rss version=\"2.0\"><channel> found.");
  } else {
    push(
      "rss",
      "warn",
      version ? `RSS version is ${version}` : "RSS version is not set",
      "Podcast apps expect <rss version=\"2.0\">."
    );
  }

  const title = textOf(channel.title);
  if (title) push("title", "pass", "Channel has a title", title);
  else push("title", "fail", "Missing <title>", "Apps will show a blank show name.");

  if (textOf(channel["itunes:block"])?.trim().toLowerCase() === "yes") {
    push(
      "itunes-block",
      "info",
      "Hidden from Apple Podcasts",
      "<itunes:block> is Yes, so Apple won't list the show. That's right for a private feed. Remove it if the show should be public."
    );
  }

  const description = textOf(channel.description) ?? textOf(channel["itunes:summary"]);
  if (description) {
    const preview = description.length > 160 ? `${description.slice(0, 160)}…` : description;
    push("description", "pass", "Channel has a description", preview);
  } else {
    push("description", "fail", "Missing <description>", "Required by Apple and shown on directory pages.");
  }

  const language = textOf(channel.language);
  if (language) push("language", "pass", "Language is set", language);
  else {
    push("language", "warn", "Missing <language>", "Set an ISO 639 code such as en or en-us.");
  }

  const author = textOf(channel["itunes:author"]) ?? ownerName(channel["itunes:owner"]);
  const explicit = textOf(channel["itunes:explicit"]);
  const categories = categoriesOf(channel["itunes:category"]);
  const image = channel["itunes:image"] as { "@_href"?: string } | string | undefined;
  const imageHref = typeof image === "string" ? image : image?.["@_href"];
  const artworkSize = await artworkDimensions(imageHref, fetchImpl);

  if (imageHref) {
    const secure = imageHref.startsWith("https://");
    push(
      "artwork",
      secure ? "pass" : "warn",
      secure ? "Artwork URL present (HTTPS)" : "Artwork URL is not HTTPS",
      artworkSize ? `${imageHref} — ${artworkSize}.` : `${imageHref}. Size was not read from the file.`
    );
  } else {
    push("artwork", "fail", "Missing <itunes:image>", "Apple and most apps require square show artwork, 1400–3000px.");
  }

  if (categories.length) push("category", "pass", "iTunes category set", categories.join(" · "));
  else push("category", "warn", "Missing <itunes:category>", "Without a category the show is left out of directory browse sections.");

  if (explicit) push("explicit", "pass", "Explicit flag set", explicit);
  else push("explicit", "warn", "Missing <itunes:explicit>", "Apple requires an explicit rating on every feed.");

  const podcastTags = presentTags(channel, PODCAST_TAGS);
  const itunesTags = presentTags(channel, ITUNES_TAGS);
  if (podcastTags.includes("podcast:guid")) {
    push("podcast-guid", "pass", "Has <podcast:guid>", "Podcasting 2.0 GUID present.");
  } else {
    push("podcast-guid", "info", "No <podcast:guid>", "Optional. A Podcasting 2.0 GUID is a stable identity across apps.");
  }

  const items = asArray(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const enclosureTypes = new Map<string, number>();
  const durations: number[] = [];
  const published: Date[] = [];
  const guids = new Map<string, number>();
  let missingEnclosure = 0;
  let insecureEnclosure = 0;
  let badEnclosure = 0;
  let missingGuid = 0;
  let badDate = 0;

  for (const item of items) {
    const enclosure = Array.isArray(item.enclosure) ? item.enclosure[0] : item.enclosure;
    const enc = enclosure && typeof enclosure === "object" ? textOf((enclosure as { "@_url"?: unknown })["@_url"]) : undefined;
    const encType = enclosure && typeof enclosure === "object"
      ? textOf((enclosure as { "@_type"?: unknown })["@_type"])?.toLowerCase()
      : undefined;
    if (!enc) missingEnclosure++;
    else if (!/^https?:\/\//i.test(enc)) badEnclosure++;
    else if (enc.startsWith("http://")) insecureEnclosure++;
    const typeKey = encType || (enc ? "unspecified" : "missing");
    enclosureTypes.set(typeKey, (enclosureTypes.get(typeKey) ?? 0) + 1);

    const seconds = durationSeconds(textOf(item["itunes:duration"]));
    if (seconds !== undefined) durations.push(seconds);

    const guid = textOf(item.guid);
    if (!guid) missingGuid++;
    else guids.set(guid, (guids.get(guid) ?? 0) + 1);

    const pubDate = textOf(item.pubDate);
    if (pubDate) {
      const parsed = new Date(pubDate);
      if (Number.isNaN(parsed.getTime())) badDate++;
      else published.push(parsed);
    }
  }

  if (items.length === 0) push("episodes", "fail", "No episodes found", "The feed has no <item> entries.");
  else push("episodes", "pass", `${items.length} episode(s) found`, "The channel has item entries.");

  if (missingEnclosure) {
    push("enclosures", "fail", `${missingEnclosure} episode(s) missing <enclosure>`, "Episodes without an enclosure have no audio and will not play.");
  } else if (badEnclosure) {
    push("enclosures", "fail", `${badEnclosure} enclosure URL(s) are not http(s)`, "The enclosure address has to be an http or https URL. The audio files were not downloaded.");
  } else {
    push("enclosures", "pass", "Every episode has an http(s) enclosure", "Presence only. The audio files were not downloaded.");
  }

  if (insecureEnclosure) {
    push("enclosure-https", "warn", `${insecureEnclosure} enclosure(s) served over HTTP`, "Move audio to HTTPS. Some clients refuse insecure media.");
  }

  const dupes = [...guids.entries()].filter(([, count]) => count > 1);
  if (missingGuid) {
    push("guids", "fail", `${missingGuid} episode(s) missing <guid>`, "Apps use GUIDs to track played state.");
  } else if (dupes.length) {
    push("guids", "fail", `${dupes.length} duplicate GUID(s)`, `"${dupes[0][0]}" appears ${dupes[0][1]} times.`);
  } else if (items.length) {
    push("guids", "pass", "GUIDs present and unique", "Values are compared as text, so 001 and 1 stay distinct.");
  }

  if (badDate) {
    push("dates", "warn", `${badDate} episode(s) with unparseable <pubDate>`, "Use RFC 822 dates, for example Tue, 08 Jul 2026 09:00:00 GMT.");
  } else if (items.length) {
    push("dates", "pass", "Publish dates parse", "Every pubDate that is present parses as a date.");
  }

  const last = published.sort((a, b) => b.getTime() - a.getTime())[0];
  const totalSeconds = durations.reduce((sum, value) => sum + value, 0);
  const enclosureList: EnclosureKind[] = [...enclosureTypes.entries()]
    .filter(([type]) => type !== "missing")
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const summary: FeedSummary = {
    title,
    author,
    description: description ? (description.length > 280 ? `${description.slice(0, 280)}…` : description) : undefined,
    language,
    explicit,
    categories,
    artworkUrl: imageHref,
    artworkSize,
    lastPublished: last ? last.toISOString() : textOf(channel.lastBuildDate),
    cadence: describeCadence(published),
    episodeCount: items.length,
    episodesWithDuration: durations.length,
    averageDuration: durations.length ? formatDuration(totalSeconds / durations.length) : undefined,
    totalDuration: durations.length ? formatDuration(totalSeconds) : undefined,
    enclosureTypes: enclosureList,
    itunesTags,
    podcastTags,
  };

  return {
    feedUrl: response.url,
    podcastTitle: title,
    episodeCount: items.length,
    summary,
    checks,
  };
}
