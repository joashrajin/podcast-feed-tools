import { XMLParser } from "fast-xml-parser";
import { USER_AGENT } from "./site";

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

export class ValidateError extends Error {}

type Episode = {
  title?: string;
  guid?: { "#text"?: string; "@_isPermaLink"?: string } | string;
  enclosure?: { "@_url"?: string; "@_type"?: string; "@_length"?: string };
  pubDate?: string;
  "itunes:duration"?: string | number;
};

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export async function validateFeed(feedUrl: string): Promise<ValidationReport> {
  let url: URL;
  try {
    url = new URL(feedUrl.trim());
  } catch {
    throw new ValidateError("That doesn't look like a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ValidateError("Feed URL must be http(s).");
  }

  const checks: Check[] = [];
  const push = (id: string, level: CheckLevel, title: string, detail: string) =>
    checks.push({ id, level, title, detail });

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ValidateError(
      "Couldn't reach the feed URL (timeout or network error). Pocket Casts' crawler would fail here too."
    );
  }

  if (!res.ok) {
    throw new ValidateError(
      `Feed returned HTTP ${res.status}. Directories and apps can't ingest a feed that doesn't return 200.`
    );
  }
  push("http", "pass", "Feed is reachable", `HTTP ${res.status} from ${res.url}`);

  if (url.protocol === "http:" && res.url.startsWith("http:")) {
    push(
      "https",
      "warn",
      "Feed is served over plain HTTP",
      "Serve your feed over HTTPS. Some platforms and mobile OSes block or downgrade insecure content."
    );
  } else {
    push("https", "pass", "Feed is served over HTTPS", res.url);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (/xml|rss/i.test(contentType)) {
    push("content-type", "pass", "Content-Type looks right", contentType);
  } else {
    push(
      "content-type",
      "warn",
      "Unexpected Content-Type",
      `Got "${contentType || "none"}" — feeds should be served as application/rss+xml or text/xml.`
    );
  }

  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new ValidateError(
      "The feed isn't valid XML. Run it through an XML linter — a stray unescaped & or unclosed tag is the usual culprit."
    );
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (!channel) {
    throw new ValidateError(
      "No <rss><channel> found. Podcast feeds must be RSS 2.0 (Atom is not supported by most podcast apps)."
    );
  }
  push("rss", "pass", "Valid RSS 2.0 structure", "<rss><channel> found");

  // Channel-level checks
  const title = channel.title as string | undefined;
  if (title) push("title", "pass", "Channel has a title", String(title));
  else push("title", "fail", "Missing <title>", "Apps will show a blank show name.");

  const description =
    (channel.description as string) ?? (channel["itunes:summary"] as string);
  if (description)
    push("description", "pass", "Channel has a description", `${String(description).slice(0, 120)}…`);
  else
    push(
      "description",
      "fail",
      "Missing <description>",
      "Required by Apple and shown on your Pocket Casts show page."
    );

  if (channel.language)
    push("language", "pass", "Language is set", String(channel.language));
  else
    push(
      "language",
      "warn",
      "Missing <language>",
      "Set an ISO 639 code like en or en-us. Directories use it for regional discovery."
    );

  const img = channel["itunes:image"] as { "@_href"?: string } | undefined;
  const imgHref = img?.["@_href"];
  if (imgHref) {
    const secure = imgHref.startsWith("https://");
    push(
      "artwork",
      secure ? "pass" : "warn",
      secure ? "Artwork URL present (HTTPS)" : "Artwork URL is not HTTPS",
      `${imgHref} — make sure it's a square JPG/PNG between 1400×1400 and 3000×3000.`
    );
  } else {
    push(
      "artwork",
      "fail",
      "Missing <itunes:image>",
      "Pocket Casts and Apple require show artwork (square, 1400–3000px)."
    );
  }

  if (channel["itunes:category"])
    push("category", "pass", "iTunes category set", "");
  else
    push(
      "category",
      "warn",
      "Missing <itunes:category>",
      "Without a category your show won't appear in directory browse sections."
    );

  if (channel["itunes:explicit"] !== undefined)
    push("explicit", "pass", "Explicit flag set", String(channel["itunes:explicit"]));
  else
    push(
      "explicit",
      "warn",
      "Missing <itunes:explicit>",
      "Apple requires an explicit rating on every feed."
    );

  if (channel["podcast:guid"])
    push(
      "podcast-guid",
      "pass",
      "Has <podcast:guid>",
      "Podcasting 2.0 GUID present — good for cross-directory identity."
    );
  else
    push(
      "podcast-guid",
      "info",
      "No <podcast:guid>",
      "Optional, but a Podcasting 2.0 GUID gives your show a stable identity across apps and hosts."
    );

  // Episode-level checks
  const items = asArray(channel.item as Episode | Episode[] | undefined);
  if (items.length === 0) {
    push("episodes", "fail", "No episodes found", "The feed has no <item> entries.");
    return { feedUrl: res.url, podcastTitle: title, episodeCount: 0, checks };
  }
  push("episodes", "pass", `${items.length} episode(s) found`, "");

  const guids = new Map<string, number>();
  let missingEnclosure = 0;
  let insecureEnclosure = 0;
  let missingGuid = 0;
  let badDate = 0;

  for (const item of items) {
    const enc = item.enclosure?.["@_url"];
    if (!enc) missingEnclosure++;
    else if (enc.startsWith("http://")) insecureEnclosure++;

    const guid =
      typeof item.guid === "string" ? item.guid : item.guid?.["#text"];
    if (!guid) missingGuid++;
    else guids.set(guid, (guids.get(guid) ?? 0) + 1);

    if (item.pubDate && isNaN(Date.parse(item.pubDate))) badDate++;
  }

  if (missingEnclosure)
    push(
      "enclosures",
      "fail",
      `${missingEnclosure} episode(s) missing <enclosure>`,
      "Episodes without an enclosure have no audio and won't play anywhere."
    );
  else push("enclosures", "pass", "Every episode has an audio enclosure", "");

  if (insecureEnclosure)
    push(
      "enclosure-https",
      "warn",
      `${insecureEnclosure} enclosure(s) served over HTTP`,
      "Move audio to HTTPS — some clients refuse mixed content."
    );

  const dupes = [...guids.entries()].filter(([, n]) => n > 1);
  if (missingGuid)
    push(
      "guids",
      "fail",
      `${missingGuid} episode(s) missing <guid>`,
      "Apps use GUIDs to track played state; missing GUIDs cause duplicate or re-downloaded episodes."
    );
  else if (dupes.length)
    push(
      "guids",
      "fail",
      `${dupes.length} duplicate GUID(s)`,
      `e.g. "${dupes[0][0]}" appears ${dupes[0][1]} times. Duplicate GUIDs make apps hide or merge episodes.`
    );
  else
    push("guids", "pass", "GUIDs present and unique on every episode", "");

  if (badDate)
    push(
      "dates",
      "warn",
      `${badDate} episode(s) with unparseable <pubDate>`,
      "Use RFC 822 dates, e.g. Tue, 08 Jul 2026 09:00:00 GMT. Bad dates break episode ordering."
    );
  else push("dates", "pass", "All publish dates parse correctly", "");

  return { feedUrl: res.url, podcastTitle: title, episodeCount: items.length, checks };
}
