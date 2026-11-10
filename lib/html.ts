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

export function metaContent(html: string, property: string): string | undefined {
  const prop = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*?(?:property|name)\\s*=\\s*["']${prop}["'][^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta\\b[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${prop}["'][^>]*>`,
      "i"
    ),
  ];
  for (const pattern of patterns) {
    const hit = html.match(pattern)?.[1];
    if (hit) {
      const decoded = decodeEntities(hit).replace(/\s+/g, " ").trim();
      if (decoded) return decoded;
    }
  }
  return undefined;
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

export function looksLikeFeed(contentType: string, body: string): boolean {
  if (/xml|rss|atom/i.test(contentType) && !/html/i.test(contentType)) return true;
  const head = body.trimStart().slice(0, 400).toLowerCase();
  if (!head) return false;
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return false;
  return (
    head.startsWith("<?xml") ||
    head.startsWith("<rss") ||
    head.startsWith("<feed") ||
    /^<\?xml[\s\S]{0,200}<rss/.test(head) ||
    /^<\?xml[\s\S]{0,200}<feed/.test(head)
  );
}
