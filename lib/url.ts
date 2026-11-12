// URL checks with no Node imports, so the browser bundle can use them too.

function parsed(raw: string | undefined, protocols: readonly string[]): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!protocols.includes(url.protocol) || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The address if it is https without credentials. */
export function asHttpsUrl(raw: string | undefined): string | undefined {
  return parsed(raw, ["https:"]);
}

/**
 * The address if it is http or https without credentials. This is the
 * browser's check on a feed address. The server refuses private addresses
 * on its own when the feed is fetched.
 */
export function asHttpUrl(raw: string | undefined): string | undefined {
  return parsed(raw, ["http:", "https:"]);
}
