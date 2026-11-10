function safeChar(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  if (code < 32 && code !== 9 && code !== 10 && code !== 13) return "";
  return String.fromCodePoint(code);
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => safeChar(Number.parseInt(digits, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function metaTag(html: string, property: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const wanted = property.toLowerCase();
  for (const tag of tags) {
    const name = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
    if (name === wanted) return attr(tag, "content");
  }
  return undefined;
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match?.[2];
}

export function metaContent(html: string, property: string): string | undefined {
  const raw = metaTag(html, property);
  if (!raw) return undefined;
  const decoded = decodeEntities(raw).replace(/\s+/g, " ").trim();
  return decoded || undefined;
}

/** "Podcast · The New York Times · …" → "The New York Times". */
export function spotifyPublisher(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const parts = description
    .split(/\s+[·•|]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  if (!/^podcasts?$/i.test(parts[0])) return undefined;
  const publisher = parts[1];
  if (!publisher || publisher.length > 120) return undefined;
  return publisher;
}

export type SpotifyEmbedEntity = {
  type?: string;
  name?: string;
  subtitle?: string;
  showId?: string;
  image?: string;
};

export function spotifyEmbedEntity(html: string): SpotifyEmbedEntity | undefined {
  const raw = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  )?.[1];
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const entity = (
    parsed as {
      props?: { pageProps?: { state?: { data?: { entity?: Record<string, unknown> } } } };
    }
  ).props?.pageProps?.state?.data?.entity;
  if (!entity || typeof entity !== "object") return undefined;

  const showUri =
    typeof entity.relatedEntityUri === "string" ? entity.relatedEntityUri : "";
  const showId = showUri.match(/^spotify:show:([0-9A-Za-z]{22})$/)?.[1];
  const cover = entity.relatedEntityCoverArt;
  let image: string | undefined;
  if (Array.isArray(cover)) {
    const first = cover.find(
      (item) => item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string"
    ) as { url?: string } | undefined;
    image = first?.url;
  }

  return {
    type: typeof entity.type === "string" ? entity.type : undefined,
    name: typeof entity.name === "string" ? entity.name.trim() : undefined,
    subtitle: typeof entity.subtitle === "string" ? entity.subtitle.trim() : undefined,
    showId,
    image,
  };
}

export function looksLikeFeed(_contentType: string, body: string): boolean {
  const sample = stripCommentsAndCdata(body.slice(0, 64_000));
  const root = firstElementName(sample);
  if (root === "rss") return /<channel(?:\s|>|\/)/i.test(sample);
  if (root === "feed") return true;
  return false;
}

function stripCommentsAndCdata(xml: string): string {
  let out = "";
  let index = 0;
  while (index < xml.length) {
    if (xml.startsWith("<!--", index)) {
      const end = xml.indexOf("-->", index + 4);
      index = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", index)) {
      const end = xml.indexOf("]]>", index + 9);
      index = end === -1 ? xml.length : end + 3;
      continue;
    }
    out += xml[index];
    index += 1;
  }
  return out;
}

function firstElementName(xml: string): string | undefined {
  const match = xml.match(/<([A-Za-z_][\w:.-]*)\b/);
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  const local = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
  return local;
}
