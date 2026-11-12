// Name and origin. NEXT_PUBLIC_SITE_NAME and NEXT_PUBLIC_SITE_URL override them.
// The URL is used for metadata, robots, the sitemap, and the User-Agent.
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Podcast: Search and Tools";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "production" ? "https://podcast.space.fast" : "http://localhost:3000");

// Where the code lives and where issues and ideas go.
export const REPO_URL = "https://github.com/joashrajin/podcast-feed-tools";

// "Mark: Tagline" shows as a large mark with the tagline beneath it.
const colon = SITE_NAME.indexOf(": ");
export const SITE_MARK = colon > 0 ? SITE_NAME.slice(0, colon) : SITE_NAME;
export const SITE_TAGLINE = colon > 0 ? SITE_NAME.slice(colon + 2) : undefined;

// A User-Agent product name may only contain token characters (RFC 9110).
export const USER_AGENT = `${SITE_NAME.replace(/[^A-Za-z0-9!#$%&'*+.^_`|~-]/g, "")}/1.0 (+${SITE_URL})`;
